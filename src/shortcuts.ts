// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, win32 } from "node:path";
import { renameWithRetry } from "./atomic.js";
import { findChromium, hubUrl } from "./launcher.js";
import { ensureDataRoot } from "./data-root.js";

export interface ShortcutOptions {
  root: string;
  dataDir: string;
  node: string;
  port: number;
  version: string;
  desktop: boolean;
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
  browser?: string | null;
}

export interface ShortcutResult {
  files: string[];
  notes: string[];
}

export function vbsLauncher(node: string, main: string, workingDir: string): string {
  return ["' viberoom: start the room without a console window and open the app window.", 'Set sh = CreateObject("WScript.Shell")', `sh.CurrentDirectory = "${workingDir}"`, `sh.Run """${node}"" ""${main}"" start", 0, False`, ""].join("\r\n");
}

const AUMID_BASE: Record<string, string> = { "chrome.exe": "Chrome", "msedge.exe": "MSEdge", "brave.exe": "Brave", "chromium.exe": "Chromium" };

export function appUserModelId(browserPath: string | null, url: string, profileDirName = "browser"): string | null {
  if (!browserPath) return null;
  const base = AUMID_BASE[win32.basename(browserPath).toLowerCase()];
  if (!base) return null;
  const u = new URL(url);
  const clean = profileDirName.replace(/[^A-Za-z0-9]/g, "");
  const profile = clean.length > 12 ? `${clean.slice(0, 10)}${clean.slice(-2)}` : clean;
  return `${base}.${u.hostname}_${u.pathname}.${profile}.Default`;
}

export const LNK_AUMID_TYPE = `using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class LnkAumid {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLink {}
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore { int GetCount(out uint c); int GetAt(uint i, out PROPERTYKEY k); int GetValue(ref PROPERTYKEY k, out PROPVARIANT v); int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v); int Commit(); }
  [StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Sequential)] struct PROPVARIANT { public ushort vt; public ushort r1; public ushort r2; public ushort r3; public IntPtr p; public int p2; }
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid riid, out IPropertyStore ppv);
  static PROPERTYKEY Key() { PROPERTYKEY k = new PROPERTYKEY(); k.fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); k.pid = 5; return k; }
  static string Read(IPropertyStore store) { PROPERTYKEY key = Key(); PROPVARIANT v; store.GetValue(ref key, out v); return v.vt == 31 ? Marshal.PtrToStringUni(v.p) : ""; }
  public static string GetWindow(IntPtr hwnd) { Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); IPropertyStore store; if (SHGetPropertyStoreForWindow(hwnd, ref iid, out store) != 0) return ""; return Read(store); }
  public static string Get(string lnk) { IPersistFile link = (IPersistFile)new ShellLink(); link.Load(lnk, 0); return Read((IPropertyStore)link); }
  public static void Set(string lnk, string aumid) {
    IPersistFile link = (IPersistFile)new ShellLink(); link.Load(lnk, 2); // STGM_READWRITE, or Commit fails with STG_E_ACCESSDENIED
    IPropertyStore store = (IPropertyStore)link; PROPERTYKEY key = Key();
    PROPVARIANT v = new PROPVARIANT(); v.vt = 31; v.p = Marshal.StringToCoTaskMemUni(aumid);
    Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref v)); Marshal.ThrowExceptionForHR(store.Commit());
    link.Save(lnk, true); Marshal.FreeCoTaskMem(v.p);
  }
}`;

const psq = (s: string): string => s.replace(/'/g, "''");

export interface PowershellResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runPowershell(script: string): PowershellResult {
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr || r.error?.message || "" };
}

export function shortcutScript(lnk: string, wscript: string, vbs: string, workingDir: string, ico: string | null, aumid: string | null = null): string {
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${psq(lnk)}')`,
    `$s.TargetPath = '${psq(wscript)}'`,
    `$s.Arguments = '"${psq(vbs)}"'`,
    `$s.WorkingDirectory = '${psq(workingDir)}'`,
    `$s.Description = 'viberoom: rooms for you and your coding agents'`,
    ico ? `$s.IconLocation = '${psq(ico)},0'` : "",
    "$s.Save()",
  ].filter(Boolean);
  if (aumid) lines.push("Add-Type -TypeDefinition @'", LNK_AUMID_TYPE, "'@", `[LnkAumid]::Set('${psq(lnk)}', '${psq(aumid)}')`);
  return lines.join("\n");
}

export function aumidSyncScript(profileDir: string, shortcuts: string[]): string {
  const list = shortcuts.map((s) => `'${psq(s)}'`).join(", ");
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "Add-Type -TypeDefinition @'",
    LNK_AUMID_TYPE,
    "'@",
    `$marker = '${psq(profileDir)}'`,
    "$aumid = ''",
    "for ($i = 0; $i -lt 20 -and -not $aumid; $i++) {",
    "  Start-Sleep -Milliseconds 500",
    "  foreach ($p in (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like ('*' + $marker + '*') -and $_.CommandLine -like '*--app=*' })) {",
    "    $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue",
    "    if ($proc -and $proc.MainWindowHandle -ne 0) { $aumid = [LnkAumid]::GetWindow($proc.MainWindowHandle); if ($aumid) { break } }",
    "  }",
    "}",
    `if ($aumid) { foreach ($lnk in @(${list})) { if ((Test-Path $lnk) -and ([LnkAumid]::Get($lnk) -ne $aumid)) { [LnkAumid]::Set($lnk, $aumid) } } }`,
  ].join("\n");
}

const roaming = (home: string, env: NodeJS.ProcessEnv): string => env.APPDATA ?? join(home, "AppData", "Roaming");

export function windowsShortcutPaths(home: string, env: NodeJS.ProcessEnv, desktop: boolean): string[] {
  const targets = [join(roaming(home, env), "Microsoft", "Windows", "Start Menu", "Programs", "viberoom.lnk")];
  if (desktop) targets.push(join(home, "Desktop", "viberoom.lnk"));
  return targets;
}

export function windowsStartupShortcutPath(home: string, env: NodeJS.ProcessEnv): string {
  return join(roaming(home, env), "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "viberoom.lnk");
}

export function windowsLauncherShortcuts(home: string, env: NodeJS.ProcessEnv): string[] {
  const pin = join(roaming(home, env), "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar", "viberoom.lnk");
  return [...windowsShortcutPaths(home, env, true), pin, windowsStartupShortcutPath(home, env)];
}

export function desktopEntry(node: string, main: string, icon: string | null, workingDir: string): string {
  return ["[Desktop Entry]", "Type=Application", "Name=viberoom", "Comment=Rooms for you and your coding agents", `Exec="${node}" "${main}" start`, `Path=${workingDir}`, ...(icon ? [`Icon=${icon}`] : []), "Terminal=false", "StartupWMClass=viberoom", "Categories=Development;Chat;", ""].join("\n");
}

export function entryIcon(entry: string): string | null {
  return /^Icon=(.*)$/m.exec(entry)?.[1] ?? null;
}

export function withEntryIcon(entry: string, icon: string): string {
  return entryIcon(entry) === null ? entry.replace(/^Terminal=/m, `Icon=${icon}\nTerminal=`) : entry.replace(/^Icon=.*$/m, `Icon=${icon}`);
}

export function macPlist(version: string, icon = "icon"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>viberoom</string>
  <key>CFBundleDisplayName</key><string>viberoom</string>
  <key>CFBundleIdentifier</key><string>dev.viberoom.launcher</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>viberoom</string>
  <key>CFBundleIconFile</key><string>${icon}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict></plist>
`;
}

export function installShortcuts(o: ShortcutOptions): ShortcutResult {
  const platform = o.platform ?? process.platform;
  const home = o.home ?? homedir();
  const env = o.env ?? process.env;
  const main = join(o.root, "dist", "main.js");
  const launcherDir = join(o.dataDir, "launcher");
  const result: ShortcutResult = { files: [], notes: [] };
  ensureDataRoot(o.dataDir);
  mkdirSync(launcherDir, { recursive: true });
  const icoSrc = join(o.root, "assets", "icon.ico");
  const pngSrc = join(o.root, "assets", "icon-256.png");
  const icnsSrc = join(o.root, "assets", "icon.icns");

  if (platform === "win32") {
    const vbs = join(launcherDir, "viberoom.vbs");
    writeFileSync(vbs, vbsLauncher(o.node, main, o.dataDir));
    result.files.push(vbs);
    const ico = placeLauncherIcon(icoSrc, launcherDir);
    if (ico) result.files.push(ico);
    const wscript = join(env.SystemRoot ?? "C:\\Windows", "System32", "wscript.exe");
    const browser = o.browser === undefined ? findChromium(env, platform) : o.browser;
    const aumid = appUserModelId(browser, hubUrl(o.port), basename(join(o.dataDir, "browser")));
    for (const lnk of windowsShortcutPaths(home, env, o.desktop)) {
      mkdirSync(join(lnk, ".."), { recursive: true });
      const r = runPowershell(shortcutScript(lnk, wscript, vbs, o.dataDir, ico, aumid));
      if (r.status === 0) result.files.push(lnk);
      else result.notes.push(`could not create ${lnk}: ${(r.stderr || "").split("\n")[0]}`);
    }
    result.notes.push("Start Menu: viberoom" + (o.desktop ? "; Desktop: viberoom" : "") + " (double-click opens the app window)");
    result.notes.push(aumid ? `taskbar icon: the shortcuts carry the app window's id (${aumid}); reopen the window to see it` : "taskbar icon: no Chromium found, the window will open in the default browser");
    return result;
  }

  if (platform === "darwin") {
    const app = join(home, "Applications", "viberoom.app");
    mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
    mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
    const icns = placeLauncherIcon(icnsSrc, join(app, "Contents", "Resources"));
    writeFileSync(join(app, "Contents", "Info.plist"), macPlist(o.version, icns ? basename(icns) : undefined));
    const exe = join(app, "Contents", "MacOS", "viberoom");
    writeFileSync(exe, `#!/bin/sh\ncd "${o.dataDir}" 2>/dev/null\nexec "${o.node}" "${main}" start\n`);
    chmodSync(exe, 0o755);
    result.files.push(app);
    result.notes.push(`${app}: open it from Launchpad or Finder (drag it to the Dock if you like)`);
    return result;
  }

  const icon = placeLauncherIcon(pngSrc, linuxIconDir(home));
  if (icon) result.files.push(icon);
  const entry = desktopEntry(o.node, main, icon, o.dataDir);
  const appsDir = join(home, ".local", "share", "applications");
  mkdirSync(appsDir, { recursive: true });
  const menuEntry = join(appsDir, "viberoom.desktop");
  writeFileSync(menuEntry, entry);
  chmodSync(menuEntry, 0o755);
  result.files.push(menuEntry);
  if (o.desktop) {
    mkdirSync(join(home, "Desktop"), { recursive: true });
    const d = join(home, "Desktop", "viberoom.desktop");
    writeFileSync(d, entry);
    chmodSync(d, 0o755);
    result.files.push(d);
  }
  result.notes.push("applications menu: viberoom" + (o.desktop ? "; Desktop: viberoom.desktop (some desktops ask once to trust it)" : ""));
  return result;
}


const WINDOWS_ICON = /^viberoom(-[0-9a-f]{12})?\.ico$/;
const MAC_ICON = /^(icon|viberoom-[0-9a-f]{12})\.icns$/;
const LINUX_ICON = /^viberoom(-[0-9a-f]{12})?\.png$/;

const linuxIconDir = (home: string): string => join(home, ".local", "share", "icons", "hicolor", "256x256", "apps");

export function launcherIconName(source: string): string {
  return `viberoom-${createHash("sha256").update(readFileSync(source)).digest("hex").slice(0, 12)}${extname(source)}`;
}

export function placeLauncherIcon(source: string, dir: string): string | null {
  if (!existsSync(source)) return null;
  const copy = join(dir, launcherIconName(source));
  if (existsSync(copy)) return copy;
  mkdirSync(dir, { recursive: true });
  const tmp = `${copy}.tmp`;
  copyFileSync(source, tmp);
  if (!renameWithRetry(tmp, copy)) {
    copyFileSync(source, copy);
    rmSync(tmp, { force: true });
  }
  return copy;
}

function otherCopies(dir: string, pattern: RegExp, keep: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((name) => pattern.test(name)).map((name) => join(dir, name)).filter((path) => path !== keep) : [];
}

function removeCopies(copies: string[]): string[] {
  return copies.filter((copy) => {
    try {
      rmSync(copy, { force: true });
      return true;
    } catch {
      return false;
    }
  });
}

export interface LauncherIconOptions {
  root: string;
  dataDir: string;
  version: string;
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
  powershell?: (script: string) => PowershellResult;
  notify?: (paths: string[]) => void;
}

export interface LauncherIconChange {
  icon: string;
  launchers: string[];
  removed: string[];
}

export function refreshLauncherIcons(o: LauncherIconOptions): LauncherIconChange | null {
  const platform = o.platform ?? process.platform;
  const home = o.home ?? homedir();
  const main = join(o.root, "dist", "main.js");
  const same = platform === "win32" ? (s: string) => s.toLowerCase() : (s: string) => s;
  const startsThisBuild = (launcher: string): boolean => existsSync(launcher) && same(readFileSync(launcher, "utf8")).includes(same(main));
  if (platform === "win32") {
    const launcherDir = join(o.dataDir, "launcher");
    if (!startsThisBuild(join(launcherDir, "viberoom.vbs"))) return null;
    const ico = placeLauncherIcon(join(o.root, "assets", "icon.ico"), launcherDir);
    const older = ico ? otherCopies(launcherDir, WINDOWS_ICON, ico) : [];
    if (!ico || !older.length) return null;
    const shortcuts = windowsLauncherShortcuts(home, o.env ?? process.env).filter((path) => existsSync(path));
    let launchers: string[] = [];
    if (shortcuts.length) {
      const r = (o.powershell ?? runPowershell)(repointShortcutsScript(shortcuts, launcherDir, ico));
      if (r.status !== 0) throw new Error(`the shortcuts could not be pointed at ${ico}: ${r.stderr.trim().split(/\r?\n/)[0] || `PowerShell ended with ${r.status}`}`);
      launchers = r.stdout.split(/\s+/).filter(Boolean).map(Number).map((i) => shortcuts[i]).filter(Boolean);
    }
    return { icon: ico, launchers, removed: removeCopies(older) };
  }
  if (platform === "darwin") {
    const app = join(home, "Applications", "viberoom.app");
    if (!startsThisBuild(join(app, "Contents", "MacOS", "viberoom"))) return null;
    const resources = join(app, "Contents", "Resources");
    const icns = placeLauncherIcon(join(o.root, "assets", "icon.icns"), resources);
    if (!icns) return null;
    const plist = join(app, "Contents", "Info.plist");
    const named = existsSync(plist) && readFileSync(plist, "utf8").includes(`<key>CFBundleIconFile</key><string>${basename(icns)}</string>`);
    const older = otherCopies(resources, MAC_ICON, icns);
    if (named && !older.length) return null;
    if (!named) {
      writeFileSync(plist, macPlist(o.version, basename(icns)));
      (o.notify ?? touch)([app]);
    }
    return { icon: icns, launchers: named ? [] : [app], removed: removeCopies(older) };
  }
  const entries = [join(home, ".local", "share", "applications", "viberoom.desktop"), join(home, "Desktop", "viberoom.desktop")];
  const ours = entries.filter(startsThisBuild);
  if (!ours.length) return null;
  const icon = placeLauncherIcon(join(o.root, "assets", "icon-256.png"), linuxIconDir(home));
  if (!icon) return null;
  const launchers = ours.filter((entry) => entryIcon(readFileSync(entry, "utf8")) !== icon);
  for (const entry of launchers) writeFileSync(entry, withEntryIcon(readFileSync(entry, "utf8"), icon));
  const named = new Set(entries.filter((entry) => existsSync(entry)).map((entry) => entryIcon(readFileSync(entry, "utf8"))));
  const removed = removeCopies(otherCopies(linuxIconDir(home), LINUX_ICON, icon).filter((copy) => !named.has(copy)));
  return launchers.length || removed.length ? { icon, launchers, removed } : null;
}

function touch(paths: string[]): void {
  const now = new Date();
  for (const path of paths) utimesSync(path, now, now);
}

export function repointShortcutsScript(shortcuts: string[], launcherDir: string, ico: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$shell = New-Object -ComObject WScript.Shell",
    `$paths = @(${shortcuts.map((s) => `'${psq(s)}'`).join(", ")})`,
    `$folder = '${psq(launcherDir.replace(/[\\/]+$/, ""))}\\'`,
    `$icon = '${psq(ico)},0'`,
    "$changed = @()",
    "for ($i = 0; $i -lt $paths.Count; $i++) {",
    "  $s = $shell.CreateShortcut($paths[$i])",
    "  if ($s.Arguments.IndexOf($folder, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }",
    "  if (-not [string]::Equals($s.IconLocation, $icon, [StringComparison]::OrdinalIgnoreCase)) { $s.IconLocation = $icon; $s.Save(); $changed += $i }",
    "}",
    "if (-not $changed.Count) { exit 0 }",
    "Add-Type -TypeDefinition @'",
    SHELL_NOTIFY_TYPE,
    "'@",
    "foreach ($i in $changed) { [ShellNotify]::Item($paths[$i]); $i }",
    "[ShellNotify]::Icons()",
  ].join("\n");
}

const SHELL_NOTIFY_TYPE = [
  "using System;",
  "using System.Runtime.InteropServices;",
  "public static class ShellNotify {",
  '  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern void SHChangeNotify(int eventId, uint flags, string item1, IntPtr item2);',
  '  [DllImport("shell32.dll")] static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);',
  "  const int SHCNE_UPDATEITEM = 0x00002000, SHCNE_ASSOCCHANGED = 0x08000000;",
  "  const uint SHCNF_IDLIST = 0x0000, SHCNF_PATHW = 0x0005;",
  "  public static void Item(string path) { SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, path, IntPtr.Zero); }",
  "  public static void Icons() { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, IntPtr.Zero, IntPtr.Zero); }",
  "}",
].join("\n");
