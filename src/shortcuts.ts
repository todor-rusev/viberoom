// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { findChromium } from "./launcher.js";

export interface ShortcutOptions {
  root: string;
  dataDir: string;
  node: string;
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

export function vbsLauncher(node: string, main: string): string {
  return ["' viberoom: start the hub without a console window and open the app window.", 'Set sh = CreateObject("WScript.Shell")', `sh.Run """${node}"" ""${main}"" start", 0, False`, ""].join("\r\n");
}

const AUMID_BASE: Record<string, string> = { "chrome.exe": "Chrome", "msedge.exe": "MSEdge", "brave.exe": "Brave", "chromium.exe": "Chromium" };

export function appUserModelId(browserPath: string | null, url = "http://127.0.0.1:4810/", profileDirName = "browser"): string | null {
  if (!browserPath) return null;
  const base = AUMID_BASE[basename(browserPath).toLowerCase()];
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

export function shortcutScript(lnk: string, wscript: string, vbs: string, root: string, ico: string | null, aumid: string | null = null): string {
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${psq(lnk)}')`,
    `$s.TargetPath = '${psq(wscript)}'`,
    `$s.Arguments = '"${psq(vbs)}"'`,
    `$s.WorkingDirectory = '${psq(root)}'`,
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

export function windowsShortcutPaths(home: string, env: NodeJS.ProcessEnv, desktop: boolean): string[] {
  const targets = [join(env.APPDATA ?? join(home, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "viberoom.lnk")];
  if (desktop) targets.push(join(home, "Desktop", "viberoom.lnk"));
  return targets;
}

export function desktopEntry(node: string, main: string, icon: string): string {
  return ["[Desktop Entry]", "Type=Application", "Name=viberoom", "Comment=Rooms for you and your coding agents", `Exec="${node}" "${main}" start`, `Icon=${icon}`, "Terminal=false", "StartupWMClass=viberoom", "Categories=Development;Chat;", ""].join("\n");
}

export function macPlist(version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>viberoom</string>
  <key>CFBundleDisplayName</key><string>viberoom</string>
  <key>CFBundleIdentifier</key><string>dev.viberoom.launcher</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>viberoom</string>
  <key>CFBundleIconFile</key><string>icon</string>
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
  mkdirSync(launcherDir, { recursive: true });
  const icoSrc = join(o.root, "assets", "icon.ico");
  const pngSrc = join(o.root, "assets", "icon-256.png");
  const icnsSrc = join(o.root, "assets", "icon.icns");

  if (platform === "win32") {
    const vbs = join(launcherDir, "viberoom.vbs");
    writeFileSync(vbs, vbsLauncher(o.node, main));
    result.files.push(vbs);
    let ico: string | null = null;
    if (existsSync(icoSrc)) {
      ico = join(launcherDir, "viberoom.ico");
      copyFileSync(icoSrc, ico);
      result.files.push(ico);
    }
    const wscript = join(env.SystemRoot ?? "C:\\Windows", "System32", "wscript.exe");
    const browser = o.browser === undefined ? findChromium(env, platform) : o.browser;
    const aumid = appUserModelId(browser, "http://127.0.0.1:4810/", basename(join(o.dataDir, "browser")));
    for (const lnk of windowsShortcutPaths(home, env, o.desktop)) {
      mkdirSync(join(lnk, ".."), { recursive: true });
      const r = spawnSync("powershell", ["-NoProfile", "-Command", shortcutScript(lnk, wscript, vbs, o.root, ico, aumid)], { encoding: "utf8" });
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
    writeFileSync(join(app, "Contents", "Info.plist"), macPlist(o.version));
    const exe = join(app, "Contents", "MacOS", "viberoom");
    writeFileSync(exe, `#!/bin/sh\nexec "${o.node}" "${main}" start\n`);
    chmodSync(exe, 0o755);
    if (existsSync(icnsSrc)) copyFileSync(icnsSrc, join(app, "Contents", "Resources", "icon.icns"));
    result.files.push(app);
    result.notes.push(`${app}: open it from Launchpad or Finder (drag it to the Dock if you like)`);
    return result;
  }

  const iconDir = join(home, ".local", "share", "icons", "hicolor", "256x256", "apps");
  mkdirSync(iconDir, { recursive: true });
  const icon = join(iconDir, "viberoom.png");
  if (existsSync(pngSrc)) {
    copyFileSync(pngSrc, icon);
    result.files.push(icon);
  }
  const entry = desktopEntry(o.node, main, icon);
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
