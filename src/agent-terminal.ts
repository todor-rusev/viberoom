// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { openTerminal, commandLine, type TerminalShell } from "./terminal.js";
import { RUN_AS_NODE } from "./own-runtime.js";
import type { AgentCommand } from "./managed-process.js";

export interface TerminalTicket {
  version: 1; id: string; cwd: string; command?: AgentCommand; line?: string; shell?: TerminalShell;
  hubPid?: number;
  env?: Record<string, string>;
  recipeId: string; vendor: string; purpose: "login" | "install";
}
export interface TerminalReceipt { id: string; pid: number; childPid?: number; at: number; state: "running" | "done" | "failed" | "cancelled"; code?: number | null; detail?: string }
export interface WatchedTerminal {
  open: Promise<{ how: string }>;
  finished: Promise<TerminalReceipt>;
  cancel(): Promise<void>;
}
export function readTerminalReceipt(file: string, id: string): TerminalReceipt | null {
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return data.id === id && Number.isSafeInteger(data.pid) && Number.isFinite(data.at) && ["running", "done", "failed", "cancelled"].includes(data.state) ? data : null;
  } catch { return null; }
}
export function watchTerminal(dataDir: string, spec: Omit<TerminalTicket, "id" | "version">, launch = openTerminal): WatchedTerminal {
  const dir = join(dataDir, "agent-terminals"); mkdirSync(dir, { recursive: true });
  const id = randomUUID(), base = join(dir, id), file = base + ".json";
  writeFileSync(file, JSON.stringify({ ...spec, version: 1, id, hubPid: process.pid } satisfies TerminalTicket), { mode: 0o600 });
  const worker = fileURLToPath(new URL("./agent-terminal-worker.js", import.meta.url));
  const open = launch(commandLine([process.execPath, worker, file]), `viberoom: ${spec.vendor} ${spec.purpose}`, spec.cwd, { env: RUN_AS_NODE, keepOpen: true });
  return observeTerminal(file, id, open);
}

export function recoverTerminals(dataDir: string): { ticket: TerminalTicket; watch: WatchedTerminal }[] {
  const dir = join(dataDir, "agent-terminals"), recovered: { ticket: TerminalTicket; watch: WatchedTerminal }[] = [];
  let files: string[]; try { files = readdirSync(dir); } catch { return recovered; }
  for (const name of files.filter(name => /^[a-f0-9-]{36}\.result$/.test(name))) {
    const file = join(dir, name);
    try { if (!existsSync(file.replace(/\.result$/, ".json")) && Date.now() - statSync(file).mtimeMs > 86400000) rmSync(file); } catch { }
  }
  for (const name of files.filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
    try {
      const file = join(dir, name), ticket = JSON.parse(readFileSync(file, "utf8")) as TerminalTicket;
      if (ticket.version !== 1 || name !== ticket.id + ".json" || !ticket.recipeId || !["login", "install"].includes(ticket.purpose)) continue;
      recovered.push({ ticket, watch: observeTerminal(file, ticket.id, Promise.resolve({ how: "the existing terminal window" })) });
    } catch { }
  }
  return recovered;
}
function alive(pid?: number): boolean { if (!pid || pid < 1) return false; try { process.kill(pid, 0); return true; } catch { return false; } }
function observeTerminal(file: string, id: string, open: Promise<{ how: string }>): WatchedTerminal {
  const base = file.slice(0, -5);
  let cancelled = false, settled = false;
  const began = Date.now();
  let complete!: (receipt: TerminalReceipt) => void;
  const finished = new Promise<TerminalReceipt>(resolve => { complete = resolve; });
  const finish = (receipt: TerminalReceipt) => {
    if (settled) return; settled = true; clearInterval(timer); complete(receipt);
    for (const suffix of [".json", ".cancel"]) try { rmSync(base + suffix, { force: true }); } catch { }
  };
  const failure = (detail: string): TerminalReceipt => ({ id, pid: 0, at: Date.now(), state: "failed", detail });
  const timer = setInterval(() => {
    const receipt = readTerminalReceipt(base + ".result", id);
    if (receipt && receipt.state !== "running") { finish(receipt); return; }
    if (receipt) {
      if (!alive(receipt.pid) && !alive(receipt.childPid)) finish(failure("The terminal closed before reporting a result. Check the vendor's state before retrying."));
    } else if (Date.now() - began > 30_000) {
      finish(failure("The terminal did not start the command. Close that window before retrying."));
    }
  }, 200);
  void open.catch(error => finish(failure(error instanceof Error ? error.message : String(error))));
  return { open, finished, cancel: async () => {
    if (settled) return;
    if (!cancelled) { cancelled = true; writeFileSync(base + ".cancel", id, { mode: 0o600 }); }
    let timeout: NodeJS.Timeout | undefined;
    try { await Promise.race([finished, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("The terminal has not confirmed cancellation")), 6500); })]); }
    finally { clearTimeout(timeout); }
  } };
}
