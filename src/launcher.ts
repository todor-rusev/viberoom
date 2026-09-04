// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, posix, win32 } from "node:path";

export type Command = "run" | "serve" | "start" | "stop" | "status" | "open" | "logs" | "help";

const COMMANDS = new Set<Command>(["run", "serve", "start", "stop", "status", "open", "logs", "help"]);

export function splitCommand(argv: string[]): { command: Command; rest: string[] } {
  const first = argv[0];
  if (first && !first.startsWith("-") && COMMANDS.has(first as Command)) return { command: first as Command, rest: argv.slice(1) };
  return { command: "run", rest: argv };
}

export function pidFilePath(dataDir: string): string {
  return join(dataDir, "hub.pid");
}

export function browserProfileDir(dataDir: string): string {
  return join(dataDir, "browser");
}

export function logFilePath(dataDir: string): string {
  return join(dataDir, "hub.log");
}

export interface PidRecord {
  pid: number;
  port: number;
  build: string;
  startedAt: number;
}

export function writePidFile(dataDir: string, record: PidRecord): void {
  writeFileSync(pidFilePath(dataDir), JSON.stringify(record));
}

export function readPidFile(dataDir: string): PidRecord | null {
  try {
    const raw = readFileSync(pidFilePath(dataDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<PidRecord>;
    if (typeof parsed.pid !== "number") return null;
    return { pid: parsed.pid, port: Number(parsed.port ?? 0), build: String(parsed.build ?? ""), startedAt: Number(parsed.startedAt ?? 0) };
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

const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

export function rotateLog(path: string, limit = LOG_ROTATE_BYTES): boolean {
  try {
    if (!existsSync(path) || statSync(path).size < limit) return false;
    renameSync(path, `${path}.1`);
    return true;
  } catch {
    return false;
  }
}

export function tailFile(path: string, lines: number): string {
  try {
    const text = readFileSync(path, "utf8");
    return text.split(/\r?\n/).filter((l) => l.length).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

export function findChromium(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync): string | null {
  const candidates: string[] = [];
  const P = platform === "win32" ? win32 : posix;
  if (platform === "win32") {
    const roots = [env["ProgramFiles"], env["ProgramFiles(x86)"], env["LOCALAPPDATA"]].filter((r): r is string => !!r);
    for (const root of roots) candidates.push(P.join(root, "Google", "Chrome", "Application", "chrome.exe"));
    for (const root of roots) candidates.push(P.join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
    for (const root of roots) candidates.push(P.join(root, "Chromium", "Application", "chrome.exe"));
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    );
  } else {
    const dirs = (env.PATH ?? "").split(P.delimiter).filter(Boolean);
    for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]) {
      for (const dir of dirs) candidates.push(P.join(dir, name));
    }
  }
  return candidates.find((c) => exists(c)) ?? null;
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

export function openUrlCommand(url: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return `start "" "${url}"`;
  if (platform === "darwin") return `open "${url}"`;
  return `xdg-open "${url}"`;
}
