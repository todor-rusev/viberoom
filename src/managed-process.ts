// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { childEnvironment } from "./child-environment.js";
import { RUN_AS_NODE } from "./own-runtime.js";

export interface AgentCommand { command: string; args: string[]; env?: Record<string, string> }
export interface ProcessResult { code: number | null; output: string; timedOut: boolean; cancelled: boolean; error?: string }

export function processCommand(spec: AgentCommand, platform: NodeJS.Platform = process.platform): AgentCommand & { verbatim?: boolean } {
  if (/\.(?:mjs|cjs|js)$/i.test(spec.command)) return { command: process.execPath, args: [spec.command, ...spec.args], env: { ...spec.env, ...RUN_AS_NODE } };
  if (platform === "win32" && /\.ps1$/i.test(spec.command)) return { command: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", spec.command, ...spec.args], env: spec.env };
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(spec.command)) {
    const parts = [spec.command, ...spec.args];
    if (parts.some(x => /["\r\n%!]/.test(x))) throw new Error("This Windows command contains characters a command shim cannot preserve. Use the executable behind the shim.");
    return { command: "cmd.exe", args: ["/d", "/v:off", "/s", "/c", `"${parts.map(x => `"${x}"`).join(" ")}"`], env: spec.env, verbatim: true };
  }
  return spec;
}

export async function stopManaged(child: ChildProcess, group = true): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    await new Promise<void>(resolve => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      const timer = setTimeout(() => { killer.kill(); child.kill(); resolve(); }, 4000);
      const done = () => { clearTimeout(timer); resolve(); };
      killer.once("error", done); killer.once("close", done);
    });
  } else {
    if (!group) {
      const listing = spawnSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8", timeout: 2000, maxBuffer: 1024 * 1024 });
      const rows = (listing.stdout || "").split("\n").map(row => row.trim().split(/\s+/).map(Number)).filter(row => row.length === 2 && row.every(Number.isSafeInteger));
      const descendants: number[] = [];
      const collect = (parent: number) => { for (const [pid, ppid] of rows) if (ppid === parent && pid !== parent) { collect(pid); descendants.push(pid); } };
      collect(child.pid);
      for (const pid of descendants) try { process.kill(pid, "SIGKILL"); } catch { }
    }
    try { if (group) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); }
    catch { try { child.kill("SIGKILL"); } catch { } }
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { child.off("exit", done); reject(new Error(`Process ${child.pid} did not confirm it stopped`)); }, 2000);
    child.once("exit", done);
    if (child.exitCode !== null || child.signalCode !== null) { child.off("exit", done); done(); }
  });
}

export function spawnManaged(spec: AgentCommand, cwd: string): ChildProcess {
  const launch = processCommand(spec);
  return spawn(launch.command, launch.args, {
    cwd, env: childEnvironment({ ...launch.env, NO_COLOR: "1", FORCE_COLOR: "0", TERM: "dumb" }),
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    windowsVerbatimArguments: launch.verbatim, detached: process.platform !== "win32",
  });
}

export function runManaged(spec: AgentCommand, cwd: string, options: {
  signal?: AbortSignal; timeoutMs?: number; maxBytes?: number; onOutput?: (text: string) => void;
} = {}): Promise<ProcessResult> {
  if (options.signal?.aborted) return Promise.resolve({ code: null, output: "", timedOut: false, cancelled: true });
  return new Promise(resolve => {
    let child: ChildProcess;
    try { child = spawnManaged(spec, cwd); }
    catch (error) { resolve({ code: null, output: "", timedOut: false, cancelled: false, error: String(error) }); return; }
    child.stdin?.end();
    let output = "", timedOut = false, cancelled = false, settled = false;
    let cleanup: Promise<void> | undefined;
    const finish = async (code: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
      try { await cleanup; } catch (failure) { error = String(failure); }
      resolve({ code, output, timedOut, cancelled, ...(error ? { error } : {}) });
    };
    const stop = () => { if (!cleanup) { cleanup = stopManaged(child); void cleanup.then(() => finish(null), error => finish(null, String(error))); } };
    const abort = () => { cancelled = true; stop(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs ?? 20_000);
    const collect = (data: Buffer) => {
      const text = String(data);
      output = (output + text).slice(-(options.maxBytes ?? 64 * 1024)); options.onOutput?.(text);
    };
    child.stdout?.on("data", collect); child.stderr?.on("data", collect);
    child.once("error", e => { void finish(null, e.message); });
    child.once("close", code => { void finish(code); });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}
