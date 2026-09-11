// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { spawn } from "node:child_process";
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


export const readClaudeStatus: StatusReader = (out) => {
  const start = out.indexOf("{");
  if (start < 0) return "unknown";
  try {
    const json = JSON.parse(out.slice(start, out.lastIndexOf("}") + 1)) as { loggedIn?: unknown; authMethod?: unknown; email?: unknown };
    if (json.loggedIn === true) return { state: "ok", detail: `logged in${typeof json.authMethod === "string" ? ` with ${json.authMethod}` : ""}${typeof json.email === "string" ? ` as ${json.email}` : ""}` };
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

export const readGrokStatus: StatusReader = (out) => {
  const text = stripAnsi(out);
  if (/\bnot authenticated\b/i.test(text)) return { state: "missing", detail: firstWords(text) };
  if (/\blogged in\b/i.test(text)) return { state: "ok", detail: firstWords(text) };
  return "unknown";
};

export const readOpenCodeStatus: StatusReader = (out) => {
  const m = /(\d+)\s+credentials?\b/i.exec(stripAnsi(out));
  if (!m) return "unknown";
  return { state: Number(m[1]) > 0 ? "ok" : "missing", detail: `${m[1]} credential${m[1] === "1" ? "" : "s"}` };
};

export const readHermesStatus: StatusReader = (out) => {
  const m = /^\s*Provider:\s*(.+?)\s*$/m.exec(stripAnsi(out));
  if (!m) return "unknown";
  return { state: /^(none|not (set|configured)|-+|—)$/i.test(m[1]) ? "missing" : "ok", detail: `provider: ${m[1]}` };
};


export function runStatusCommand(command: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const isJs = /\.(mjs|cjs|js)$/i.test(command);
    const isShim = /\.(cmd|bat)$/i.test(command);
    const [file, spawnArgs] = isJs ? [process.execPath, [command, ...args]] : isShim ? ["cmd.exe", ["/d", "/s", "/c", `"${command}" ${args.join(" ")}`]] : [command, args];
    const child = spawn(file, spawnArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: isShim,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    let out = "";
    let done = false;
    let timedOut = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      setTimeout(() => finish(null), 300);
    }, timeoutMs);
    child.stdout?.on("data", (d) => { out += String(d); });
    child.stderr?.on("data", (d) => { out += String(d); });
    child.on("error", (e) => { out += `\n${e.message}`; finish(null); });
    child.on("exit", (code) => finish(code));
  });
}

export function firstWords(out: string, max = 120): string {
  const line = stripAnsi(out).split(/\r?\n/).map((l) => l.trim()).find((l) => l && !/^[{}\[\]]$/.test(l) && !/^\s*"?\w*"?:\s*[{\[]?$/.test(l)) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export async function probeLoginViaAcp(launch: { command: string; args: string[]; env?: Record<string, string> }, cwd: string, timeoutMs: number): Promise<LoginCheck> {
  const at = Date.now();
  let agent: AcpAgent | null = null;
  const stderr: string[] = [];
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
      delay(timeoutMs).then((): LoginCheck => ({ state: "unknown", how: "acp", at, detail: `no answer in ${Math.round(timeoutMs / 1000)} s` })),
    ]);
    return result;
  } catch (error) {
    return { state: "unknown", how: "acp", at, detail: firstWords([error instanceof Error ? error.message : String(error), ...stderr].join("\n"), 160) };
  } finally {
    try { agent?.kill(); } catch { }
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function checkLogin(spec: LoginStatusSpec, launch: { command: string; args: string[]; env?: Record<string, string> } | null, cwd: string): Promise<LoginCheck> {
  const at = Date.now();
  if (!launch || !launch.command) return { state: "unknown", how: "command", at, detail: "not installed" };
  if (spec.kind === "command") {
    const command = spec.command ?? launch.command;
    if (!command) return { state: "unknown", how: "command", at, detail: "no status command" };
    const { code, out, timedOut } = await runStatusCommand(command, spec.args, spec.timeoutMs ?? 15_000);
    if (timedOut) return { state: "unknown", how: "command", at, detail: `${spec.args.join(" ")}: no answer in ${Math.round((spec.timeoutMs ?? 15_000) / 1000)} s` };
    const read = spec.read(out, code);
    const state = typeof read === "string" ? read : read.state;
    const detail = typeof read === "string" ? firstWords(out) || `exit ${code}` : read.detail;
    return { state, how: "command", at, detail };
  }
  return probeLoginViaAcp(launch, cwd, 25_000);
}
