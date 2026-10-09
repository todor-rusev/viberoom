// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { execFile } from "node:child_process";
import type { Logger } from "./log.js";

export interface MacState {
  systemState: string | null;
  clamshell: string | null;
}

export function shouldWakeFully(state: MacState): boolean {
  const capabilities = /Capabilities are:\s*(.*)$/m.exec(state.systemState ?? "")?.[1];
  if (capabilities === undefined) return false;
  if (/\bGraphics\b/.test(capabilities)) return false;
  if (state.clamshell === null) return false;
  const lid = /"AppleClamshellState"\s*=\s*(Yes|No)\b/.exec(state.clamshell)?.[1];
  if (lid === undefined) return !/AppleClamshellState/.test(state.clamshell);
  if (lid === "No") return true;
  return /"AppleClamshellCausesSleep"\s*=\s*No\b/.test(state.clamshell);
}

export type Ask = (file: string, args: string[]) => Promise<string | null>;
const ask: Ask = (file, args) => new Promise((resolve) => {
  execFile(file, args, { encoding: "utf8", timeout: 3000, windowsHide: true }, (error, stdout) => resolve(error ? null : stdout));
});

export async function wakeFullyIfDark(log: Logger, o: { platform?: NodeJS.Platform; stillHeld?: () => boolean; ask?: Ask } = {}): Promise<boolean> {
  if ((o.platform ?? process.platform) !== "darwin") return false;
  const run = o.ask ?? ask;
  const [systemState, clamshell] = await Promise.all([
    run("/usr/bin/pmset", ["-g", "systemstate"]),
    run("/usr/sbin/ioreg", ["-r", "-k", "AppleClamshellState", "-d", "4"]),
  ]);
  if (!shouldWakeFully({ systemState, clamshell })) return false;
  if (o.stillHeld && !o.stillHeld()) return false;
  if (await run("/usr/bin/caffeinate", ["-u", "-t", "1"]) === null) {
    log.warn("the Mac is in a maintenance wake and could not be woken fully: the vibemates work only while it stays up");
    return false;
  }
  log.info("the Mac was in a maintenance wake: woken fully for the vibemates' work");
  return true;
}
