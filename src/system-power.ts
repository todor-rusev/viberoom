// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import type { NoPower, Power, WakeHold } from "./keep-awake.js";
import { findOnPath } from "./open.js";

export type Ask = (command: string, args: string[]) => Promise<string>;

export interface SystemPowerOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  pid?: number;
  exists?: (path: string) => boolean;
  read?: (path: string) => string;
  list?: (path: string) => string[];
  spawn?: (command: string, args: string[], options: { stdio: ("pipe" | "ignore")[]; windowsHide: true }) => ChildProcess;
  ask?: Ask;
}

const CAFFEINATE = "/usr/bin/caffeinate";
const PMSET = "/usr/bin/pmset";
const WSL_POWERSHELL = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";

const HOLD_SCRIPT = [
  `Add-Type -Namespace Viberoom -Name Sleep -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'`,
  `if ([Viberoom.Sleep]::SetThreadExecutionState([uint32]2147483649) -eq 0) { [Console]::Error.WriteLine('SetThreadExecutionState refused'); exit 3 }`,
  `[void][Console]::In.ReadToEnd()`,
].join("\n");
const POWER_LINE_SCRIPT = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SystemInformation]::PowerStatus.PowerLineStatus`;

export function encodedCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}
const powershellArgs = (script: string) => ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand(script)];

export function macOnBattery(pmset: string): boolean | null {
  const source = /Now drawing from '([^']+)'/.exec(pmset)?.[1];
  if (source === "AC Power") return false;
  if (source === "Battery Power" || source === "UPS Power") return true;
  return null;
}

export function windowsOnBattery(line: string): boolean | null {
  const status = line.trim();
  if (status === "Online") return false;
  if (status === "Offline") return true;
  return null;
}

export function linuxOnBattery(list: (path: string) => string[], read: (path: string) => string): boolean | null {
  const root = "/sys/class/power_supply";
  let names: string[];
  try {
    names = list(root);
  } catch {
    return null;
  }
  const field = (name: string, key: string) => {
    try {
      return read(posix.join(root, name, key)).trim();
    } catch {
      return "";
    }
  };
  let supplies = 0, online = 0, batteries = 0, discharging = 0;
  for (const name of names) {
    const type = field(name, "type");
    if (type === "Mains" || type === "USB") {
      supplies++;
      if (field(name, "online") === "1") online++;
    } else if (type === "Battery" && field(name, "scope") !== "Device") {
      batteries++;
      if (field(name, "status") === "Discharging") discharging++;
    }
  }
  if (supplies) return online === 0;
  if (batteries) return discharging > 0;
  return false;
}

export function isWsl(exists: (path: string) => boolean, read: (path: string) => string): boolean {
  if (exists("/proc/sys/fs/binfmt_misc/WSLInterop")) return true;
  try {
    return /microsoft/i.test(read("/proc/sys/kernel/osrelease"));
  } catch {
    return false;
  }
}

const lastLine = (text: string) => text.trim().split(/\r?\n/).pop()?.trim() ?? "";

function helperHold(child: ChildProcess, endBy: "input" | "signal", ended: (why: string) => void): WakeHold {
  let released = false;
  let over = false;
  let said = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => { said = (said + chunk).slice(-600); });
  child.stdin?.on("error", () => {});
  const finish = (why: string) => {
    if (over) return;
    over = true;
    if (!released) ended(why);
  };
  child.on("error", (error) => finish(`its helper did not start (${error.message})`));
  child.on("exit", (code, signal) => finish(`its helper stopped (${lastLine(said) || (signal ? `signal ${signal}` : `exit ${code}`)})`));
  child.unref();
  for (const stream of [child.stdin, child.stderr]) (stream as { unref?: () => void } | null)?.unref?.();
  return {
    release() {
      if (released) return;
      released = true;
      if (endBy === "input") child.stdin?.end();
      else child.kill();
      const deadline = setTimeout(() => { if (!over) child.kill("SIGKILL"); }, 3000);
      deadline.unref();
    },
  };
}

const defaultAsk: Ask = (command, args) => new Promise((resolve, reject) => {
  execFile(command, args, { encoding: "utf8", timeout: 15_000, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
});

export function systemPower(o: SystemPowerOptions = {}): Power | NoPower {
  const platform = o.platform ?? process.platform;
  const env = o.env ?? process.env;
  const exists = o.exists ?? existsSync;
  const read = o.read ?? ((path: string) => readFileSync(path, "utf8"));
  const list = o.list ?? ((path: string) => readdirSync(path));
  const run = o.spawn ?? ((command, args, options) => spawn(command, args, { ...options, windowsHide: true }));
  const ask = o.ask ?? defaultAsk;
  const pid = o.pid ?? process.pid;

  const windows = (powershell: string, means: string): Power => ({
    means,
    hold: (_reason, ended) => helperHold(run(powershell, powershellArgs(HOLD_SCRIPT), { stdio: ["pipe", "ignore", "pipe"], windowsHide: true }), "input", ended),
    onBattery: async () => windowsOnBattery(await ask(powershell, powershellArgs(POWER_LINE_SCRIPT))),
  });

  if (platform === "darwin") {
    if (!exists(CAFFEINATE)) return { means: null, missing: `${CAFFEINATE} is missing from this Mac` };
    return {
      means: "caffeinate",
      hold: (_reason, ended) => helperHold(run(CAFFEINATE, ["-i", "-w", String(pid)], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true }), "signal", ended),
      onBattery: async () => macOnBattery(await ask(PMSET, ["-g", "ps"])),
    };
  }
  if (platform === "win32") return windows("powershell.exe", "PowerShell");
  if (platform === "linux") {
    if (isWsl(exists, read)) {
      const powershell = findOnPath("powershell.exe", env, "linux", exists) ?? (exists(WSL_POWERSHELL) ? WSL_POWERSHELL : null);
      if (!powershell) return { means: null, missing: "in WSL Windows decides when the computer sleeps, and its PowerShell cannot be reached from here" };
      return windows(powershell, "PowerShell of Windows");
    }
    const inhibit = findOnPath("systemd-inhibit", env, "linux", exists) ?? findOnPath("elogind-inhibit", env, "linux", exists);
    if (!inhibit) return { means: null, missing: "this Linux has neither systemd-inhibit nor elogind-inhibit to ask with" };
    const cat = findOnPath("cat", env, "linux", exists) ?? "/bin/cat";
    return {
      means: posix.basename(inhibit),
      hold: (reason, ended) => helperHold(run(inhibit, ["--what=sleep", "--who=viberoom", `--why=${reason}`, "--mode=block", cat], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true }), "input", ended),
      onBattery: async () => linuxOnBattery(list, read),
    };
  }
  return { means: null, missing: `viberoom has no way to hold ${platform} awake` };
}
