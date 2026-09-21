// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { JsonRpcPeer, MethodNotFound } from "./jsonrpc.js";
import type {
  ContentBlock,
  InitializeResult,
  McpServer,
  NewSessionResult,
  PromptResult,
  RequestPermissionParams,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionNotificationParams,
  SessionUpdate,
} from "./acp-types.js";

export const PROTOCOL_VERSION = 1;

export interface AgentLaunch {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface AgentHooks {
  onSessionUpdate(sessionId: string, update: SessionUpdate): void;
  onPermissionRequest(params: RequestPermissionParams): Promise<RequestPermissionResponse>;
  onStderr(text: string): void;
  onExit(code: number | null, signal: NodeJS.Signals | null): void;
  onRaw?(direction: "in" | "out", message: unknown): void;
  onProtocolError?(text: string): void;
}

export function childEnvironment(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE_") || key === "CLAUDE_PID" || key === "CLAUDE_EFFORT") continue;
    env[key] = value;
  }
  return { ...env, ...(extra ?? {}) };
}

export class AcpAgent {
  readonly child: ChildProcess;
  private readonly peer: JsonRpcPeer;
  private initResult: InitializeResult | null = null;
  private exited = false;
  private received = 0;
  private readonly replyOrder = new WeakMap<object, number>();
  private readonly reportedConfig = new Map<string, { order: number; options: SessionConfigOption[] }>();
  private readonly reportedMode = new Map<string, { order: number; value: string }>();

  constructor(readonly launch: AgentLaunch, private readonly hooks: AgentHooks) {
    this.child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: childEnvironment(launch.env),
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });

    if (!this.child.stdin || !this.child.stdout || !this.child.stderr) {
      throw new Error("agent process has no stdio pipes");
    }

    this.peer = new JsonRpcPeer(this.child.stdin, this.child.stdout, {
      onRequest: (method, params) => this.handleRequest(method, params),
      onNotification: (method, params) => this.handleNotification(method, params),
      onRaw: (direction, message) => {
        if (direction === "in") {
          const order = ++this.received;
          const result = (message as { result?: unknown })?.result;
          if (result && typeof result === "object") this.replyOrder.set(result, order);
        }
        hooks.onRaw?.(direction, message);
      },
      onProtocolError: hooks.onProtocolError,
    });

    const stderr = createInterface({ input: this.child.stderr });
    stderr.on("line", (line) => hooks.onStderr(line));

    this.child.on("exit", (code, signal) => {
      this.exited = true;
      this.peer.close(`agent exited (code ${code}, signal ${signal})`);
      hooks.onExit(code, signal);
    });
    this.child.on("error", (error) => {
      this.exited = true;
      this.peer.close(`agent process error: ${error.message}`);
      hooks.onStderr(`spawn error: ${error.message}`);
      hooks.onExit(null, null);
    });
  }

  get capabilities(): InitializeResult | null {
    return this.initResult;
  }

  get alive(): boolean {
    return !this.exited && !this.peer.isClosed;
  }

  hasSessionCapability(name: string): boolean {
    const caps = this.initResult?.agentCapabilities?.sessionCapabilities;
    return !!caps && Object.prototype.hasOwnProperty.call(caps, name);
  }

  async initialize(clientInfo: { name: string; version: string }): Promise<InitializeResult> {
    const result = (await this.peer.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo,
    })) as InitializeResult;
    this.initResult = result;
    return result;
  }

  get authMethods(): { id: string; name?: string; description?: string | null }[] {
    return (this.initResult?.authMethods ?? []) as { id: string; name?: string; description?: string | null }[];
  }

  async authenticate(methodId: string): Promise<void> {
    await this.peer.request("authenticate", { methodId });
  }

  newSession(cwd: string, mcpServers: McpServer[] = []): Promise<NewSessionResult> {
    return this.peer.request("session/new", { cwd, mcpServers }) as Promise<NewSessionResult>;
  }

  get supportsLoadSession(): boolean {
    return this.initResult?.agentCapabilities?.loadSession === true;
  }

  get acceptsImages(): boolean {
    return this.initResult?.agentCapabilities?.promptCapabilities?.image === true;
  }

  loadSession(sessionId: string, cwd: string, mcpServers: McpServer[] = []): Promise<NewSessionResult> {
    return this.peer.request("session/load", { sessionId, cwd, mcpServers }).then((result) => ({
      ...((result as Partial<NewSessionResult>) ?? {}),
      sessionId,
    }));
  }

  prompt(sessionId: string, prompt: ContentBlock[]): Promise<PromptResult> {
    return this.peer.request("session/prompt", { sessionId, prompt }) as Promise<PromptResult>;
  }

  cancel(sessionId: string): void {
    this.peer.notify("session/cancel", { sessionId });
  }

  async setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<SessionConfigOption[]> {
    const params = typeof value === "boolean" ? { sessionId, configId, type: "boolean", value } : { sessionId, configId, value };
    const result = (await this.peer.request("session/set_config_option", params)) as { configOptions: SessionConfigOption[] };
    if (!result || typeof result !== "object") throw new Error("the agent did not return its updated settings");
    const newer = this.reportedConfig.get(sessionId);
    let order = this.replyOrder.get(result) ?? 0;
    let options = result.configOptions;
    if (newer && newer.order > order) { options = newer.options; order = newer.order; }
    if (!Array.isArray(options)) throw new Error("the agent did not return its updated settings");
    const mode = this.reportedMode.get(sessionId);
    return mode && mode.order > order ? options.map(option => option.category === "mode" ? { ...option, currentValue: mode.value } : option) : options;
  }

  async setMode(sessionId: string, modeId: string): Promise<{ currentModeId?: string }> {
    const since = this.received;
    await this.peer.request("session/set_mode", { sessionId, modeId });
    const reported = this.reportedMode.get(sessionId);
    return reported && reported.order > since ? { currentModeId: reported.value } : {};
  }

  async closeSession(sessionId: string): Promise<void> {
    if (!this.hasSessionCapability("close")) return;
    await this.peer.request("session/close", { sessionId });
    this.reportedConfig.delete(sessionId);
    this.reportedMode.delete(sessionId);
  }

  kill(): void {
    if (this.exited) return;
    try {
      this.child.stdin?.end();
    } catch {
    }
    this.child.kill();
  }

  private async handleRequest(method: string, params: unknown): Promise<unknown> {
    if (method === "session/request_permission") {
      return this.hooks.onPermissionRequest(params as RequestPermissionParams);
    }
    throw new MethodNotFound(method);
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === "session/update") {
      const p = params as SessionNotificationParams;
      if (p.update.sessionUpdate === "config_option_update") {
        const options = (p.update as { configOptions: SessionConfigOption[] }).configOptions;
        if (Array.isArray(options)) {
          this.reportedConfig.set(p.sessionId, { order: this.received, options });
          const mode = options.find(option => option.category === "mode");
          if (mode && typeof mode.currentValue === "string") this.reportedMode.set(p.sessionId, { order: this.received, value: mode.currentValue });
        }
      } else if (p.update.sessionUpdate === "current_mode_update") {
        this.reportedMode.set(p.sessionId, { order: this.received, value: (p.update as { currentModeId: string }).currentModeId });
      }
      this.hooks.onSessionUpdate(p.sessionId, p.update);
      return;
    }
    this.hooks.onProtocolError?.(`unhandled notification ${method}`);
  }
}
