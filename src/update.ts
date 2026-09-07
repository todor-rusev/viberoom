// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
  const m = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return null;
  return { parts: [Number(m[1]), Number(m[2]), Number(m[3])], prerelease: !!m[4] };
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa.parts[i] !== pb.parts[i]) return pa.parts[i] - pb.parts[i];
  if (pa.prerelease !== pb.prerelease) return pa.prerelease ? -1 : 1;
  return 0;
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

export function installCommandLine(version: string): string {
  if (!parseVersion(version)) throw new Error(`not a version: ${version}`);
  return `npm install -g viberoom@${version} --no-audit --no-fund`;
}

export function installUpdate(version: string): Promise<{ ok: boolean; output: string }> {
  const line = installCommandLine(version);
  return new Promise((resolve) => {
    const child = process.platform === "win32" ? spawn(line, { shell: true, windowsHide: true }) : spawn("npm", line.split(" ").slice(1));
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
  const child = spawn(process.execPath, [main, "start", "--port", String(port), "--data-dir", dataDir, "--no-open"], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}
