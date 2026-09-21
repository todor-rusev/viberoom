// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { spawn } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { processCommand, stopManaged } from "./managed-process.js";
import { childEnvironment } from "./child-environment.js";
import type { TerminalTicket, TerminalReceipt } from "./agent-terminal.js";

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file || !file.endsWith(".json")) throw new Error("Missing terminal ticket");
  const ticket = JSON.parse(readFileSync(file, "utf8")) as TerminalTicket;
  if (ticket.version !== 1 || !/^[a-f0-9-]{36}$/.test(ticket.id) || !file.endsWith(ticket.id + ".json") || !ticket.cwd) throw new Error("Invalid terminal ticket");
  const base = file.slice(0, -5), result = base + ".result";
  let state: TerminalReceipt["state"] = "running", cancelled = false, childPid: number | undefined;
  const record = (code?: number | null, detail?: string) => {
    const receipt: TerminalReceipt = { id: ticket.id, pid: process.pid, childPid, at: Date.now(), state, code, detail };
    writeFileSync(result + ".tmp", JSON.stringify(receipt), { mode: 0o600 }); renameSync(result + ".tmp", result);
  };
  record();
  if (existsSync(base + ".cancel")) { state = "cancelled"; record(null); return; }
  const spec = ticket.command ?? (process.platform === "win32"
    ? ticket.shell === "powershell" ? { command: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ticket.line!] }
      : { command: "cmd.exe", args: ["/d", "/s", "/c", ticket.line!] }
    : { command: ticket.shell === "bash" ? "bash" : "sh", args: ["-c", ticket.line!] });
  const launch = processCommand(spec);
  const env = childEnvironment({ ...ticket.env, ...launch.env });
  if (!launch.env?.ELECTRON_RUN_AS_NODE) delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(launch.command, launch.args, { cwd: ticket.cwd, env, stdio: "inherit", windowsHide: false, windowsVerbatimArguments: launch.verbatim, detached: false });
  childPid = child.pid; record();
  const cancel = async () => {
    if (cancelled) return; cancelled = true;
    try { await stopManaged(child, false); }
    catch (error) { cancelled = false; record(null, String(error)); }
  };
  const timer = setInterval(() => {
    let hubGone = false;
    if (ticket.hubPid) try { process.kill(ticket.hubPid, 0); } catch { hubGone = true; }
    if (hubGone || existsSync(base + ".cancel")) void cancel();
  }, 200);
  process.once("SIGINT", () => { void cancel(); }); process.once("SIGTERM", () => { void cancel(); });
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    state = cancelled ? "cancelled" : code === 0 ? "done" : "failed"; record(code);
    process.stdout.write(`\nviberoom: ${state === "done" ? "the command finished; return to the room" : "the command did not finish successfully; see the output above"}.\n`);
  } catch (error) { state = "failed"; record(null, error instanceof Error ? error.message : String(error)); }
  finally { clearInterval(timer); }
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
