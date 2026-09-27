// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute } from "node:path";
import { machineEnvironment } from "../child-environment.js";
import { spawnManaged, stopManaged } from "../managed-process.js";
import { findOnPath } from "../open.js";
import type { LocalLaunch } from "./local-launch.js";
import { declined, McpError, McpSession, parseMessage, type JsonRpcResponse } from "./mcp-session.js";

export interface McpLocalOptions {
  clientVersion: string;
  cwd: string;
  env: () => Record<string, string>;
  idleMs?: number;
  resolve?: (command: string) => string | null;
  spawn?: (spec: { command: string; args: string[]; env: Record<string, string> }, cwd: string) => ChildProcess;
  stop?: (child: ChildProcess) => Promise<void>;
}

const SAID_KEEP = 2_000;
const IDLE_MS = 10 * 60_000;
const LINE_MAX = 16 * 1024 * 1024;

export function resolveLocalCommand(command: string): string | null {
  if (isAbsolute(command)) return existsSync(command) ? command : null;
  return findOnPath(command, machineEnvironment(), process.platform, existsSync);
}

interface Waiting { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

export class McpLocal extends McpSession {
  private child: ChildProcess | null = null;
  private waiting = new Map<number, Waiting>();
  private nextId = 1;
  private buffer = "";
  private stderr = "";
  private noise = "";
  private idle: NodeJS.Timeout | null = null;

  constructor(readonly launch: LocalLaunch, private readonly options: McpLocalOptions) {
    super(options.clientVersion);
  }

  get running(): boolean {
    return this.child !== null;
  }

  private started(): ChildProcess {
    if (this.child) return this.child;
    const path = (this.options.resolve ?? resolveLocalCommand)(this.launch.command);
    if (!path) throw new McpError(`"${this.launch.command}" is not installed on this computer, or not on its PATH`, "server");
    mkdirSync(this.options.cwd, { recursive: true });
    let child: ChildProcess;
    try {
      child = (this.options.spawn ?? spawnManaged)({ command: path, args: this.launch.args, env: this.options.env() }, this.options.cwd);
    } catch (error) {
      throw new McpError(`the server could not be started: ${(error as Error).message}`, "server");
    }
    this.child = child;
    this.buffer = "";
    this.stderr = "";
    this.noise = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => this.read(child, chunk));
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-SAID_KEEP); });
    child.stdin!.on("error", () => { });
    child.once("error", (error) => this.ended(child, `could not be started: ${error.message}`));
    child.once("exit", (code, signal) => this.ended(child, signal ? `stopped (${signal})` : `stopped with code ${code}`));
    return child;
  }

  private read(child: ChildProcess, chunk: string): void {
    if (child !== this.child) return;
    this.buffer += chunk;
    if (this.buffer.length > LINE_MAX) {
      void this.stopChild(child);
      return;
    }
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      const message = parseMessage(line);
      if (!message) {
        this.noise = `${this.noise}${line}\n`.slice(-SAID_KEEP);
        continue;
      }
      if (typeof message.method === "string") {
        if ("id" in message) this.write(child, declined(message));
        continue;
      }
      const waiting = typeof message.id === "number" ? this.waiting.get(message.id) : undefined;
      if (!waiting) continue;
      this.waiting.delete(message.id as number);
      clearTimeout(waiting.timer);
      const answer = message as unknown as JsonRpcResponse;
      if (answer.error) waiting.reject(new McpError(`the server refused: ${String(answer.error.message ?? answer.error.code)}`, "server"));
      else waiting.resolve(answer.result);
    }
  }

  private ended(child: ChildProcess, how: string): void {
    if (child !== this.child) return;
    this.child = null;
    this.forget();
    this.clearIdle();
    const said = (this.stderr.trim() || this.noise.trim()).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-3).join(" ");
    const error = new McpError(`the server ${how}${said ? `: ${said}` : ""}`, "unreachable");
    for (const waiting of this.waiting.values()) { clearTimeout(waiting.timer); waiting.reject(error); }
    this.waiting.clear();
  }

  private write(child: ChildProcess, message: Record<string, unknown>): void {
    child.stdin!.write(`${JSON.stringify(message)}\n`);
  }

  private clearIdle(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
  }

  private touched(): void {
    this.clearIdle();
    if (this.waiting.size || !this.child) return;
    const child = this.child;
    this.idle = setTimeout(() => { if (!this.waiting.size) void this.stopChild(child); }, this.options.idleMs ?? IDLE_MS);
    this.idle.unref();
  }

  protected request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const child = this.started();
    this.clearIdle();
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new McpError(`no answer within ${Math.round(timeoutMs / 1000)} s`, "unreachable"));
        this.touched();
      }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      this.write(child, { jsonrpc: "2.0", id, method, params });
    }).finally(() => this.touched());
  }

  protected async notify(method: string): Promise<void> {
    this.write(this.started(), { jsonrpc: "2.0", method });
  }

  private async stopChild(child: ChildProcess): Promise<void> {
    await (this.options.stop ?? stopManaged)(child).catch(() => undefined);
    this.ended(child, "was stopped");
  }

  async close(): Promise<void> {
    this.clearIdle();
    if (this.child) await this.stopChild(this.child);
  }
}
