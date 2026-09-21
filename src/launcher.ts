// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, posix, resolve, win32 } from "node:path";
import { OPERATIONAL_LOG_KEEP, rollAside } from "./log.js";

export type Command = "run" | "serve" | "start" | "stop" | "status" | "open" | "logs" | "doctor" | "autostart" | "help";

const COMMANDS = new Set<Command>(["run", "serve", "start", "stop", "status", "open", "logs", "doctor", "autostart", "help"]);

export function splitCommand(argv: string[]): { command: Command; rest: string[] } {
  const first = argv[0];
  if (first && !first.startsWith("-") && COMMANDS.has(first as Command)) return { command: first as Command, rest: argv.slice(1) };
  return { command: "run", rest: argv };
}

export type StartReason = "at-login" | "replacing-another" | "by-hand";

export const runId = (pid: number, startedAt: number): string => `${pid}.${startedAt}`;

export function startReason(options: { autostart?: boolean; force?: boolean }): StartReason {
  if (options.autostart) return "at-login";
  if (options.force) return "replacing-another";
  return "by-hand";
}

export function pidFilePath(dataDir: string): string {
  return join(dataDir, "hub.pid");
}

export function browserProfileDir(dataDir: string): string {
  return join(dataDir, "browser");
}

export function runtimeLogPath(dataDir: string): string {
  return join(dataDir, "hub.stderr.log");
}
export function logFilePath(dataDir: string): string {
  return join(dataDir, "hub.log");
}

export interface PidRecord {
  pid: number;
  port: number;
  build: string;
  startedAt: number;
  foreground?: boolean;
}

export function writePidFile(dataDir: string, record: PidRecord): void {
  writeFileSync(pidFilePath(dataDir), JSON.stringify(record));
}

export function readPidFile(dataDir: string): PidRecord | null {
  try {
    const raw = readFileSync(pidFilePath(dataDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<PidRecord>;
    if (typeof parsed.pid !== "number") return null;
    return { pid: parsed.pid, port: Number(parsed.port ?? 0), build: String(parsed.build ?? ""), startedAt: Number(parsed.startedAt ?? 0), ...(parsed.foreground ? { foreground: true } : {}) };
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}

export interface HubIdentity {
  build: string | null;
  dataDir: string | null;
  pid: number | null;
}

export interface ForeignHub {
  dataDir: string | null;
}

export function sameDataDir(a: string, b: string): boolean {
  const norm = (p: string): string => {
    const r = resolve(p).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

export function hubPortFor(port: number, portGiven: boolean, liveRecord: PidRecord | null): number {
  if (portGiven || !liveRecord || !liveRecord.port) return port;
  return liveRecord.port;
}

export function foreignHub(identity: HubIdentity | null, dataDir: string): ForeignHub | null {
  if (!identity) return null;
  if (!identity.dataDir) return { dataDir: null };
  return sameDataDir(identity.dataDir, dataDir) ? null : { dataDir: identity.dataDir };
}

export const HUB_HOST = "127.0.0.1";

export function hubUrl(port: number): string {
  return `http://${HUB_HOST}:${port}/`;
}

const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

export function rotateLog(path: string, limit = LOG_ROTATE_BYTES): boolean {
  try {
    if (!existsSync(path) || statSync(path).size < limit) return false;
  } catch {
    return false;
  }
  return rollAside(path, OPERATIONAL_LOG_KEEP);
}

export function tailFile(path: string, lines: number): string {
  try {
    const text = readFileSync(path, "utf8");
    return text.split(/\r?\n/).filter((l) => l.length).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

const APP_WINDOW_BROWSERS: { name: string; win32: string[]; darwin: string[]; linux: string[] }[] = [
  {
    name: "Google Chrome",
    win32: ["Google/Chrome/Application/chrome.exe", "Google/Chrome Beta/Application/chrome.exe", "Google/Chrome Dev/Application/chrome.exe", "Google/Chrome SxS/Application/chrome.exe"],
    darwin: ["Google Chrome.app/Contents/MacOS/Google Chrome", "Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta", "Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev", "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"],
    linux: ["google-chrome", "google-chrome-stable", "google-chrome-beta", "google-chrome-unstable"],
  },
  {
    name: "Microsoft Edge",
    win32: ["Microsoft/Edge/Application/msedge.exe", "Microsoft/Edge Beta/Application/msedge.exe", "Microsoft/Edge Dev/Application/msedge.exe"],
    darwin: ["Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta", "Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev"],
    linux: ["microsoft-edge", "microsoft-edge-stable", "microsoft-edge-beta", "microsoft-edge-dev"],
  },
  {
    name: "Brave",
    win32: ["BraveSoftware/Brave-Browser/Application/brave.exe"],
    darwin: ["Brave Browser.app/Contents/MacOS/Brave Browser"],
    linux: ["brave-browser", "brave"],
  },
  {
    name: "Vivaldi",
    win32: ["Vivaldi/Application/vivaldi.exe", "Programs/Vivaldi/Application/vivaldi.exe"],
    darwin: ["Vivaldi.app/Contents/MacOS/Vivaldi"],
    linux: ["vivaldi", "vivaldi-stable"],
  },
  {
    name: "Opera",
    win32: ["Opera/opera.exe", "Programs/Opera/opera.exe"],
    darwin: ["Opera.app/Contents/MacOS/Opera"],
    linux: ["opera"],
  },
  {
    name: "Chromium",
    win32: ["Chromium/Application/chrome.exe"],
    darwin: ["Chromium.app/Contents/MacOS/Chromium"],
    linux: ["chromium", "chromium-browser"],
  },
];

export const APP_WINDOW_BROWSER_NAMES = APP_WINDOW_BROWSERS.map((browser) => browser.name);

export function findChromium(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync): string | null {
  const P = platform === "win32" ? win32 : posix;
  const roots =
    platform === "win32"
      ? [env["ProgramFiles"], env["ProgramFiles(x86)"], env["LOCALAPPDATA"]].filter((root): root is string => !!root)
      : platform === "darwin"
      ? ["/Applications", ...(env.HOME ? [P.join(env.HOME, "Applications")] : [])]
      : (env.PATH ?? "").split(P.delimiter).filter(Boolean);
  for (const browser of APP_WINDOW_BROWSERS) {
    const wanted = platform === "win32" ? browser.win32 : platform === "darwin" ? browser.darwin : browser.linux;
    for (const name of wanted) {
      for (const root of roots) {
        const candidate = P.join(root, ...name.split("/"));
        if (exists(candidate)) return candidate;
      }
    }
  }
  return null;
}

export interface WindowPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
  maximized: boolean;
  workArea?: { left: number; top: number; right: number; bottom: number };
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  maximized?: boolean;
  work_area_left?: number;
  work_area_top?: number;
  work_area_right?: number;
  work_area_bottom?: number;
}

function findBounds(node: unknown): Bounds | null {
  if (!node || typeof node !== "object") return null;
  const o = node as Record<string, unknown>;
  if (["left", "top", "right", "bottom"].every((k) => typeof o[k] === "number")) return o as unknown as Bounds;
  for (const value of Object.values(o)) {
    const found = findBounds(value);
    if (found) return found;
  }
  return null;
}

export function savedWindowPlacement(profileDir: string): WindowPlacement | null {
  try {
    const prefs = JSON.parse(readFileSync(join(profileDir, "Default", "Preferences"), "utf8")) as Record<string, unknown>;
    const browser = prefs.browser as Record<string, unknown> | undefined;
    const bounds = findBounds(browser?.app_window_placement);
    if (!bounds) return null;
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    if (width < 200 || height < 150) return null;
    const placement: WindowPlacement = { left: bounds.left, top: bounds.top, width, height, maximized: !!bounds.maximized };
    const wa = [bounds.work_area_left, bounds.work_area_top, bounds.work_area_right, bounds.work_area_bottom];
    if (wa.every((v) => typeof v === "number")) placement.workArea = { left: wa[0]!, top: wa[1]!, right: wa[2]!, bottom: wa[3]! };
    return placement;
  } catch {
    return null;
  }
}

export function windowFilePath(dataDir: string): string {
  return join(dataDir, "window.json");
}

export function recordedWindowPlacement(dataDir: string): WindowPlacement | null {
  try {
    const o = JSON.parse(readFileSync(windowFilePath(dataDir), "utf8")) as Record<string, unknown>;
    const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    if (!num(o.left) || !num(o.top) || !num(o.width) || !num(o.height)) return null;
    if (o.width < 200 || o.height < 150) return null;
    const placement: WindowPlacement = { left: o.left, top: o.top, width: o.width, height: o.height, maximized: !!o.maximized };
    const s = o.screen as Record<string, unknown> | undefined;
    if (s && num(s.left) && num(s.top) && num(s.width) && num(s.height) && s.width >= 200 && s.height >= 150) {
      placement.workArea = { left: s.left, top: s.top, right: s.left + s.width, bottom: s.top + s.height };
    }
    return placement;
  } catch {
    return null;
  }
}

export function windowFlags(placement: WindowPlacement): string[] {
  const wa = placement.workArea;
  if (placement.maximized && wa && wa.right - wa.left >= 200 && wa.bottom - wa.top >= 150) {
    return [`--window-position=${wa.left},${wa.top}`, `--window-size=${wa.right - wa.left},${wa.bottom - wa.top}`];
  }
  let { left, top, width, height } = placement;
  if (wa) {
    width = Math.min(width, wa.right - wa.left);
    height = Math.min(height, wa.bottom - wa.top);
    left = Math.max(wa.left, Math.min(left, wa.right - width));
    top = Math.max(wa.top, Math.min(top, wa.bottom - height));
  }
  return [`--window-position=${left},${top}`, `--window-size=${width},${height}`];
}

export function appWindowArgs(url: string, profileDir: string, freshProfile: boolean, placement: WindowPlacement | null = null, platform: NodeJS.Platform = process.platform): string[] {
  const args = [
    `--app=${url}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-mode",
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
  ];
  if (placement) args.push(...windowFlags(placement));
  else if (freshProfile) args.push("--window-size=1500,950");
  if (platform === "linux") args.push("--class=viberoom");
  return args;
}

export function browserAdvice(chromium: string | null, platform: NodeJS.Platform = process.platform): string | null {
  if (chromium) return null;
  const all = APP_WINDOW_BROWSER_NAMES;
  const names = `${all.slice(0, -1).join(", ")} or ${all[all.length - 1]}`;
  const where = platform === "linux" ? " on PATH" : "";
  return `No Chromium-based browser found (${names}${where}); viberoom opens in a tab of your default browser instead. Install one of them for the app window.`;
}

export function openUrlCommand(url: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return `start "" "${url}"`;
  if (platform === "darwin") return `open "${url}"`;
  return `xdg-open "${url}"`;
}
