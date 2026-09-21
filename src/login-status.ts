// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { runManaged } from "./managed-process.js";
import { AcpAgent } from "./acp-client.js";
import type { LoginState } from "./agent-health.js";
import { RemoteError } from "./jsonrpc.js";

export interface LoginCheck {
  state: LoginState;
  how: "command" | "acp";
  at: number;
  detail: string;
}

export type StatusReader = (out: string, code: number | null) => LoginState | { state: LoginState; detail: string };

export type LoginStatusSpec =
  | { kind: "command"; command?: string | null; args: string[]; read: StatusReader; timeoutMs?: number }
  | { kind: "acp" };

const ANSI = /\[[0-9;?]*[ -/]*[@-~]/g;
export const stripAnsi = (s: string): string => s.replace(ANSI, "");


export const readClaudeStatus: StatusReader = (out, code) => {
  const start = out.indexOf("{");
  if (start < 0) return "unknown";
  try {
    const json = JSON.parse(out.slice(start, out.lastIndexOf("}") + 1)) as { loggedIn?: unknown; authMethod?: unknown; email?: unknown };
    if (json.loggedIn === true && code === 0) return { state: "ok", detail: `logged in${typeof json.authMethod === "string" ? ` with ${json.authMethod}` : ""}${typeof json.email === "string" ? ` as ${json.email}` : ""}` };
    return json.loggedIn === false ? { state: "missing", detail: "loggedIn: false" } : "unknown";
  } catch {
    return "unknown";
  }
};

export const readCodexStatus: StatusReader = (out, code) => {
  const text = stripAnsi(out);
  if (/\bnot logged in\b/i.test(text)) return { state: "missing", detail: firstWords(text) };
  if (code === 0 && /\blogged in\b/i.test(text)) return { state: "ok", detail: firstWords(text) };
  return "unknown";
};

export const readGrokStatus: StatusReader = (out, code) => {
  const text = stripAnsi(out);
  if (/\bnot authenticated\b/i.test(text)) return { state: "missing", detail: firstWords(text) };
  if (code === 0 && /\blogged in\b/i.test(text)) return { state: "ok", detail: firstWords(text) };
  return "unknown";
};

export const readOpenCodeStatus: StatusReader = (out, code) => {
  if (code !== 0) return "unknown";
  const m = /(\d+)\s+credentials?\b/i.exec(stripAnsi(out));
  if (!m) return "unknown";
  return { state: Number(m[1]) > 0 ? "configured" : "missing", detail: `${m[1]} credential${m[1] === "1" ? "" : "s"}` };
};

export const readHermesStatus: StatusReader = (out, code) => {
  if (code !== 0) return "unknown";
  const m = /^\s*Provider:\s*(.+?)\s*$/m.exec(stripAnsi(out));
  if (!m) return "unknown";
  return { state: /^(none|not (set|configured)|-+|—)$/i.test(m[1]) ? "missing" : "configured", detail: `provider: ${m[1]}` };
};


export async function runStatusCommand(command: string, args: string[], timeoutMs: number, signal?: AbortSignal, context?: { cwd: string; env?: Record<string, string> }): Promise<{ code: number | null; out: string; timedOut: boolean }> {
  const result = await runManaged({ command, args, env: context?.env }, context?.cwd ?? process.cwd(), { signal, timeoutMs });
  return { code: result.code, out: result.error ? result.output + "\n" + result.error : result.output, timedOut: result.timedOut };
}

export function firstWords(out: string, max = 120): string {
  const line = stripAnsi(out).split(/\r?\n/).map((l) => l.trim()).find((l) => l && !/^[{}\[\]]$/.test(l) && !/^\s*"?\w*"?:\s*[{\[]?$/.test(l)) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export async function probeLoginViaAcp(launch: { command: string; args: string[]; env?: Record<string, string> }, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<LoginCheck> {
  const at = Date.now();
  if (signal?.aborted) return { state: "unknown", how: "acp", at, detail: "check cancelled" };
  let agent: AcpAgent | null = null;
  let timeout: NodeJS.Timeout | undefined;
  const stderr: string[] = [];
  const stopOnAbort = (): void => {
    try {
      agent?.kill();
    } catch {
    }
  };
  signal?.addEventListener("abort", stopOnAbort, { once: true });
  try {
    agent = new AcpAgent(
      { ...launch, cwd },
      {
        onSessionUpdate: () => undefined,
        onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } }),
        onStderr: (line) => { if (stderr.length < 40) stderr.push(line); },
        onExit: () => undefined,
      },
    );
    const a = agent;
    const result = await Promise.race([
      (async (): Promise<LoginCheck> => {
        await a.initialize({ name: "viberoom", version: "0.2.0" });
        try {
          const session = await a.newSession(cwd, []);
          try { await Promise.race([a.closeSession(session.sessionId), delay(1000)]); } catch { }
          return { state: "ok", how: "acp", at, detail: "a session opens" };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const authRequired = (error instanceof RemoteError && error.rpc.code === -32000) || /auth|not logged in|no (llm )?provider (configured|available)|api key/i.test(message);
          return { state: authRequired ? "missing" : "unknown", how: "acp", at, detail: firstWords(message, 160) };
        }
      })(),
      new Promise<LoginCheck>(resolve => { timeout = setTimeout(() => resolve({ state: "unknown", how: "acp", at, detail: `no answer in ${Math.round(timeoutMs / 1000)} s` }), timeoutMs); }),
    ]);
    return result;
  } catch (error) {
    return { state: "unknown", how: "acp", at, detail: firstWords([error instanceof Error ? error.message : String(error), ...stderr].join("\n"), 160) };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", stopOnAbort);
    try { await agent?.kill(); } catch { }
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function checkLogin(spec: LoginStatusSpec, launch: { command: string; args: string[]; env?: Record<string, string> } | null, cwd: string, signal?: AbortSignal): Promise<LoginCheck> {
  const at = Date.now();
  if (!launch || !launch.command) return { state: "unknown", how: "command", at, detail: "not installed" };
  if (spec.kind === "command") {
    const command = spec.command ?? launch.command;
    if (!command) return { state: "unknown", how: "command", at, detail: "no status command" };
    const { code, out, timedOut } = await runStatusCommand(command, spec.args, spec.timeoutMs ?? 15_000, signal, { cwd, env: launch.env });
    if (timedOut) return { state: "unknown", how: "command", at, detail: `${spec.args.join(" ")}: no answer in ${Math.round((spec.timeoutMs ?? 15_000) / 1000)} s` };
    const read = spec.read(out, code);
    const state = typeof read === "string" ? read : read.state;
    const detail = typeof read === "string" ? firstWords(out) || `exit ${code}` : read.detail;
    return { state, how: "command", at, detail };
  }
  return probeLoginViaAcp(launch, cwd, 25_000, signal);
}
