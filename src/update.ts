// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { withRunAsNode } from "./own-runtime.js";
import { semanticVersion, compareSemanticVersions } from "./agent-version.js";

export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  checkedAt: string | null;
  error: string | null;
}

interface CheckRecord {
  checkedAt: string;
  latest: string | null;
  error: string | null;
}

export const REGISTRY_URL = "https://registry.npmjs.org/viberoom/latest";
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_FILE = "update-check.json";

export function parseVersion(v: string): { parts: number[]; prerelease: boolean } | null {
  const parsed = semanticVersion(v);
  return parsed ? { parts: parsed.parts, prerelease: parsed.pre.length > 0 } : null;
}

export function compareVersions(a: string, b: string): number {
  return compareSemanticVersions(a, b) ?? 0;
}

export function readCheckRecord(dataDir: string): CheckRecord | null {
  const file = join(dataDir, CHECK_FILE);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<CheckRecord>;
    if (typeof raw.checkedAt !== "string") return null;
    return { checkedAt: raw.checkedAt, latest: typeof raw.latest === "string" ? raw.latest : null, error: typeof raw.error === "string" ? raw.error : null };
  } catch {
    return null;
  }
}

export function toInfo(current: string, record: CheckRecord | null): UpdateInfo {
  const latest = record?.latest ?? null;
  return { current, latest, available: latest !== null && compareVersions(latest, current) > 0, checkedAt: record?.checkedAt ?? null, error: record?.error ?? null };
}

export interface CheckOptions {
  force?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export async function checkForUpdate(dataDir: string, current: string, options: CheckOptions = {}): Promise<UpdateInfo> {
  const now = options.now ?? Date.now;
  const previous = readCheckRecord(dataDir);
  if (!options.force && previous && now() - Date.parse(previous.checkedAt) < CHECK_INTERVAL_MS) return toInfo(current, previous);
  const doFetch = options.fetchImpl ?? fetch;
  let record: CheckRecord;
  try {
    const res = await doFetch(REGISTRY_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(options.timeoutMs ?? 6000) });
    if (!res.ok) throw new Error(`registry answered ${res.status}`);
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version !== "string" || !parseVersion(body.version)) throw new Error("registry answer had no version");
    record = { checkedAt: new Date(now()).toISOString(), latest: body.version, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record = { checkedAt: new Date(now()).toISOString(), latest: previous?.latest ?? null, error: message.replace(/\s+/g, " ").slice(0, 200) };
  }
  writeFileSync(join(dataDir, CHECK_FILE), JSON.stringify(record, null, 2));
  return toInfo(current, record);
}

export function runsFromSourceCheckout(mainModuleUrl: string): boolean {
  const path = decodeURIComponent(new URL(mainModuleUrl).pathname);
  return !/\/node_modules\/viberoom\//.test(path);
}

export function newerSourceThanBuild(mainModuleUrl: string): string | null {
  if (!runsFromSourceCheckout(mainModuleUrl)) return null;
  const root = fileURLToPath(new URL("../", mainModuleUrl));
  const src = join(root, "src");
  if (!existsSync(src)) return null;
  let built: number;
  try {
    built = statSync(fileURLToPath(mainModuleUrl)).mtimeMs;
  } catch {
    return null;
  }
  let newest: { path: string; mtime: number } | null = null;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts")) {
        const mtime = statSync(path).mtimeMs;
        if (mtime > built + 1000 && (!newest || mtime > newest.mtime)) newest = { path, mtime };
      }
    }
  };
  walk(src);
  return newest ? relative(root, (newest as { path: string }).path).split("\\").join("/") : null;
}

export function newerBuildThanRunning(mainModuleUrl: string, runningBuild: string): string | null {
  const running = Date.parse(runningBuild);
  if (!Number.isFinite(running)) return null;
  const dir = join(fileURLToPath(mainModuleUrl), "..");
  let newest: { path: string; mtime: number } | null = null;
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".js")) {
        const mtime = statSync(path).mtimeMs;
        if (mtime > running + 1000 && (!newest || mtime > newest.mtime)) newest = { path, mtime };
      }
    }
  };
  try { walk(dir); } catch { return null; }
  return newest ? (newest as { path: string }).path : null;
}

export function installCommandLine(version: string): string {
  if (!parseVersion(version)) throw new Error(`not a version: ${version}`);
  return `npm install -g viberoom@${version} --no-audit --no-fund`;
}

export function installUpdate(version: string, cwd: string): Promise<{ ok: boolean; output: string }> {
  const line = installCommandLine(version);
  return new Promise((resolve) => {
    const child = process.platform === "win32" ? spawn(line, { cwd, shell: true, windowsHide: true }) : spawn("npm", line.split(" ").slice(1), { cwd });
    let output = "";
    const collect = (chunk: Buffer): void => {
      output = (output + chunk.toString()).slice(-4000);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", (error) => resolve({ ok: false, output: `${output}\n${error.message}`.trim() }));
    child.on("close", (code) => resolve({ ok: code === 0, output: output.trim() }));
  });
}

export function restartWithNewBuild(mainModuleUrl: string, port: number, dataDir: string): void {
  const main = fileURLToPath(mainModuleUrl);
  const child = spawn(process.execPath, [main, "start", "--port", String(port), "--data-dir", dataDir, "--no-open"], { cwd: dataDir, detached: true, stdio: "ignore", windowsHide: true, env: withRunAsNode() });
  child.unref();
}
