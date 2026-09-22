// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { shortcutScript } from "./shortcuts.js";

export interface AutostartOptions {
  root: string;
  dataDir: string;
  node: string;
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
  launchctl?: (args: string[]) => { status: number | null; stderr: string };
  powershell?: (script: string) => { status: number | null; stderr: string };
  uid?: number;
}

export interface AutostartStatus {
  enabled: boolean;
  entry: string;
  script: string;
  target: string | null;
  targetMissing: boolean;
  stale: boolean;
  foreign: boolean;
  installedAt: number | null;
  lastAutoStartAt: number | null;
  log: string;
  note?: string;
}

export interface AutostartControl {
  status(): AutostartStatus;
  setEnabled(enabled: boolean): AutostartStatus | Promise<AutostartStatus>;
}

export function cliAutostartControl(options: AutostartOptions): AutostartControl {
  return { status: () => autostartStatus(options), setEnabled: enabled => installAutostart(options, enabled) };
}

export const LAUNCH_AGENT_LABEL = "dev.viberoom.hub";

export function autostartEntryPath(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string {
  if (platform === "win32") return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "viberoom.lnk");
  if (platform === "darwin") return join(home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
  return join(home, ".config", "autostart", "viberoom.desktop");
}

export function autostartRecordPath(dataDir: string): string {
  return join(dataDir, "autostart.json");
}

export function autostartLogPath(dataDir: string): string {
  return join(dataDir, "launcher", "autostart.log");
}

export function autostartScriptPath(dataDir: string, platform: NodeJS.Platform): string {
  return join(dataDir, "launcher", platform === "win32" ? "viberoom-autostart.vbs" : "viberoom-autostart.sh");
}

export function autostartVbs(node: string, main: string, dataDir: string): string {
  return [
    "' viberoom: start the room at sign-in, without a console window and without opening a window.",
    "' Nothing happens when viberoom was removed: switch autostart off in Settings before removing it.",
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    `If fso.FileExists("${main}") And fso.FileExists("${node}") Then`,
    '  Set sh = CreateObject("WScript.Shell")',
    `  sh.CurrentDirectory = "${dataDir}"`,
    `  sh.Run """${node}"" ""${main}"" start --no-open --autostart --data-dir ""${dataDir}""", 0, False`,
    "End If",
    "",
  ].join("\r\n");
}

export function autostartShell(node: string, main: string, dataDir: string): string {
  return [
    "#!/bin/sh",
    "# viberoom: start the room at sign-in, without opening a window.",
    "# Nothing happens when viberoom was removed: switch autostart off in Settings before removing it.",
    `[ -f "${main}" ] && [ -x "${node}" ] || exit 0`,
    `cd "${dataDir}" 2>/dev/null`,
    `exec "${node}" "${main}" start --no-open --autostart --data-dir "${dataDir}"`,
    "",
  ].join("\n");
}

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function launchAgentPlist(script: string, dataDir: string, log: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>${xml(script)}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>WorkingDirectory</key><string>${xml(dataDir)}</string>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`;
}

export function autostartDesktopEntry(script: string, dataDir: string): string {
  return ["[Desktop Entry]", "Type=Application", "Name=viberoom", "Comment=Start the rooms at sign-in, without a window", `Exec="${script}"`, `Path=${dataDir}`, "Terminal=false", "Hidden=false", "X-GNOME-Autostart-enabled=true", ""].join("\n");
}

interface AutostartRecord {
  installedAt?: number | null;
  lastAutoStartAt?: number | null;
}

function readRecord(dataDir: string): AutostartRecord {
  try {
    return JSON.parse(readFileSync(autostartRecordPath(dataDir), "utf8")) as AutostartRecord;
  } catch {
    return {};
  }
}

function writeRecord(dataDir: string, patch: AutostartRecord): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(autostartRecordPath(dataDir), JSON.stringify({ ...readRecord(dataDir), ...patch }, null, 2) + "\n");
}

export function recordAutoStart(dataDir: string, at = Date.now()): void {
  writeRecord(dataDir, { lastAutoStartAt: at });
}

function entryNames(entry: string, script: string): boolean {
  let bytes: Buffer;
  try {
    bytes = readFileSync(entry);
  } catch {
    return false;
  }
  for (const encoding of ["utf8", "utf16le"] as const) {
    const wanted = Buffer.from(script, encoding);
    if (bytes.includes(wanted)) return true;
    if (bytes.toString("latin1").toLowerCase().includes(wanted.toString("latin1").toLowerCase())) return true;
  }
  return false;
}

function targetOf(script: string): string | null {
  if (!existsSync(script)) return null;
  const m = /"([^"]*main\.js)"/.exec(readFileSync(script, "utf8"));
  return m ? m[1] : null;
}

function uidOf(o: AutostartOptions): number {
  return o.uid ?? (process.getuid ? process.getuid() : 501);
}

const runLaunchctl = (args: string[]): { status: number | null; stderr: string } => {
  const r = spawnSync("launchctl", args, { encoding: "utf8" });
  return { status: r.status, stderr: r.stderr ?? "" };
};

const runPowershell = (script: string): { status: number | null; stderr: string } => {
  const r = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8", windowsHide: true });
  return { status: r.status, stderr: r.stderr ?? "" };
};

export function autostartStatus(o: AutostartOptions): AutostartStatus {
  const platform = o.platform ?? process.platform;
  const home = o.home ?? homedir();
  const env = o.env ?? process.env;
  const entry = autostartEntryPath(platform, home, env);
  const script = autostartScriptPath(o.dataDir, platform);
  const main = join(o.root, "dist", "main.js");
  const present = existsSync(entry);
  const enabled = present && entryNames(entry, script);
  const target = enabled ? targetOf(script) : null;
  const wanted = platform === "win32" ? autostartVbs(o.node, main, o.dataDir) : autostartShell(o.node, main, o.dataDir);
  const stale = enabled && (!existsSync(script) || readFileSync(script, "utf8") !== wanted);
  const record = readRecord(o.dataDir);
  return {
    enabled,
    entry,
    script,
    target,
    targetMissing: enabled && (!target || !existsSync(target)),
    stale,
    foreign: present && !enabled,
    installedAt: record.installedAt ?? null,
    lastAutoStartAt: record.lastAutoStartAt ?? null,
    log: autostartLogPath(o.dataDir),
  };
}

export function installAutostart(o: AutostartOptions, on: boolean): AutostartStatus {
  const platform = o.platform ?? process.platform;
  const home = o.home ?? homedir();
  const env = o.env ?? process.env;
  const entry = autostartEntryPath(platform, home, env);
  const script = autostartScriptPath(o.dataDir, platform);
  const main = join(o.root, "dist", "main.js");
  let note: string | undefined;
  if (!on) {
    if (existsSync(entry) && !entryNames(entry, script)) {
      rmSync(script, { force: true });
      writeRecord(o.dataDir, { installedAt: null });
      return autostartStatus(o);
    }
    if (platform === "darwin" && existsSync(entry)) {
      (o.launchctl ?? runLaunchctl)(["bootout", `gui/${uidOf(o)}/${LAUNCH_AGENT_LABEL}`]);
    }
    rmSync(entry, { force: true });
    rmSync(script, { force: true });
    writeRecord(o.dataDir, { installedAt: null });
    return autostartStatus(o);
  }
  mkdirSync(dirname(script), { recursive: true });
  mkdirSync(dirname(entry), { recursive: true });
  if (platform === "win32") {
    writeFileSync(script, autostartVbs(o.node, main, o.dataDir));
    const wscript = join(env.SystemRoot ?? "C:\\Windows", "System32", "wscript.exe");
    const ico = join(o.dataDir, "launcher", "viberoom.ico");
    const r = (o.powershell ?? runPowershell)(shortcutScript(entry, wscript, script, o.dataDir, existsSync(ico) ? ico : null, null));
    if (r.status !== 0) throw new Error(`the Startup shortcut could not be created: ${(r.stderr || "").split("\n")[0] || "PowerShell refused"}`);
  } else {
    writeFileSync(script, autostartShell(o.node, main, o.dataDir));
    chmodSync(script, 0o755);
    if (platform === "darwin") {
      writeFileSync(entry, launchAgentPlist(script, o.dataDir, autostartLogPath(o.dataDir)));
      const r = (o.launchctl ?? runLaunchctl)(["bootstrap", `gui/${uidOf(o)}`, entry]);
      if (r.status !== 0 && !/already/i.test(r.stderr)) note = `launchctl did not load it now (${(r.stderr || "").split("\n")[0] || `status ${r.status}`}); it runs at the next sign-in`;
    } else {
      writeFileSync(entry, autostartDesktopEntry(script, o.dataDir));
      chmodSync(entry, 0o755);
    }
  }
  writeRecord(o.dataDir, { installedAt: Date.now() });
  return { ...autostartStatus(o), ...(note ? { note } : {}) };
}

export function refreshAutostart(o: AutostartOptions): boolean {
  const status = autostartStatus(o);
  if (!status.enabled || !status.stale) return false;
  installAutostart(o, true);
  return true;
}
