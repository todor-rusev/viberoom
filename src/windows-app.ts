// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { rmSync } from "node:fs";
import { win32 } from "node:path";
import { runPowershell, type PowershellResult } from "./shortcuts.js";

export interface WindowsAppIdentity {
  identityName: string;
  applicationId: string;
}

export const WINDOWS_APP: WindowsAppIdentity | null = { identityName: "TodorRusev.viberoom", applicationId: "Viberoom" };

export interface WindowsAppFound {
  familyName: string;
  version: string;
  appUserModelId: string;
}

const psq = (s: string): string => s.replace(/'/g, "''");

export function findScript(identity: WindowsAppIdentity): string {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$p = Get-AppxPackage -Name '${psq(identity.identityName)}' | Sort-Object Version -Descending | Select-Object -First 1`,
    'if ($p) { "$($p.PackageFamilyName)|$($p.Version)" }',
  ].join("\n");
}

export function parseFound(stdout: string, identity: WindowsAppIdentity): WindowsAppFound | null {
  const m = /^([\w.-]+_[a-z0-9]{13})\|(\d+(?:\.\d+){1,3})\s*$/m.exec(stdout.trim());
  if (!m) return null;
  return { familyName: m[1]!, version: m[2]!, appUserModelId: `${m[1]}!${identity.applicationId}` };
}

export function findWindowsApp(identity: WindowsAppIdentity | null, run: (script: string) => PowershellResult = runPowershell): WindowsAppFound | null {
  if (!identity) return null;
  return parseFound(run(findScript(identity)).stdout, identity);
}

export function openAppCommand(found: WindowsAppFound): { command: string; args: string[] } {
  return { command: "explorer.exe", args: [`shell:AppsFolder\\${found.appUserModelId}`] };
}

export function sharesTheWindowsApp(o: { platform: NodeJS.Platform; sourceCheckout?: boolean; dataDir: string; home: string; portGiven: boolean }): boolean {
  const same = (a: string, b: string): boolean => win32.resolve(a).toLowerCase() === win32.resolve(b).toLowerCase();
  return o.platform === "win32" && !o.sourceCheckout && same(o.dataDir, win32.resolve(o.home, ".viberoom")) && !o.portGiven;
}

export function isOwnShortcut(target: string, args: string, launcherScript: string): boolean {
  const norm = (s: string): string => win32.resolve(s.replace(/^"|"$/g, "")).toLowerCase();
  const arg = args.trim().replace(/^"|"$/g, "");
  return win32.basename(target).toLowerCase() === "wscript.exe" && arg !== "" && norm(arg) === norm(launcherScript);
}

export function readShortcutsScript(paths: string[]): string {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$shell = New-Object -ComObject WScript.Shell",
    `foreach ($p in @(${paths.map((p) => `'${psq(p)}'`).join(", ")})) { if (Test-Path -LiteralPath $p) { $s = $shell.CreateShortcut($p); "$p|$($s.TargetPath)|$($s.Arguments)" } }`,
  ].join("\n");
}

export function removeOwnShortcuts(paths: string[], launcherScript: string, run: (script: string) => PowershellResult = runPowershell, remove: (path: string) => void = (p) => rmSync(p, { force: true })): string[] {
  if (!paths.length) return [];
  const removed: string[] = [];
  for (const line of run(readShortcutsScript(paths)).stdout.split(/\r?\n/)) {
    const [path, target, args] = line.split("|");
    if (!path || target === undefined || args === undefined) continue;
    if (!isOwnShortcut(target, args, launcherScript)) continue;
    remove(path);
    removed.push(path);
  }
  return removed;
}
