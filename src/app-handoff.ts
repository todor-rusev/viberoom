// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { readFileSync, rmSync } from "node:fs";
import { isAbsolute, join, posix, win32 } from "node:path";
import { writeFileAtomicAsync } from "./atomic.js";
import { runByApp, type AppKind, type Host } from "./host.js";

export interface Holder {
  build: string | null;
  host: Host;
}

export type StartOver = "start" | "already" | "replace" | "in-application" | "another-application";

export function startOver(holder: Holder | null, me: { build: string; force: boolean; byApp: boolean }): StartOver {
  if (!holder) return "start";
  if (runByApp(holder.host)) return me.byApp ? "another-application" : "in-application";
  if (me.byApp) return "replace";
  return holder.build === me.build && !me.force ? "already" : "replace";
}

export const APP_RECORD_FILE = "app.json";

export interface AppRecord {
  kind: AppKind;
  platform: string;
  version: string;
  opener: string;
}

interface ToldHost {
  kind: AppKind;
  version: string;
  platform: string;
  opener?: string;
}

export async function recordApplication(dataDir: string, told: ToldHost, log: { warn(line: string): void }): Promise<void> {
  const path = join(dataDir, APP_RECORD_FILE);
  try {
    if (!told.opener) {
      if (told.kind === "store") rmSync(path, { force: true });
      return;
    }
    const record: AppRecord = { kind: told.kind, platform: told.platform, version: told.version, opener: told.opener };
    await writeFileAtomicAsync(path, JSON.stringify(record, null, 2) + "\n");
  } catch (error) {
    log.warn(`the application's record in ${path} could not be written: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function readAppRecord(dataDir: string, read: (path: string) => string = (path) => readFileSync(path, "utf8")): AppRecord | null {
  let said: Partial<Record<keyof AppRecord, unknown>>;
  try { said = JSON.parse(read(join(dataDir, APP_RECORD_FILE))); } catch { return null; }
  if (!said || typeof said !== "object") return null;
  const { kind, platform, version, opener } = said;
  if (kind !== "store" && kind !== "installer" && kind !== "source") return null;
  if (typeof platform !== "string" || typeof version !== "string" || typeof opener !== "string") return null;
  if (!opener || opener.length > 4096 || /[\0\r\n]/.test(opener) || !(isAbsolute(opener) || /^[A-Za-z]:[\\/]/.test(opener))) return null;
  return { kind, platform, version, opener };
}

export interface AppOpening {
  command: string;
  args: string[];
  waits?: boolean;
}

export interface CheckHost {
  platform: string;
  dataDir: string;
  env: Record<string, string | undefined>;
  uid: number | null;
  real(path: string): string | null;
  stat(path: string): { file: boolean; mode: number; uid: number } | null;
  macSignature(bundle: string): string | null;
}

export function checkAppRecord(record: AppRecord, host: CheckHost): { opening: AppOpening } | { refused: string } {
  if (record.platform !== host.platform) return { refused: `it was written on ${record.platform}` };
  if (record.kind !== "installer") return { refused: `a ${record.kind} application is not opened by a path` };
  const path = host.real(record.opener);
  if (!path) return { refused: `${record.opener} is not there any more` };
  const p = host.platform === "win32" ? win32 : posix;
  const folder = host.real(host.dataDir) ?? host.dataDir;
  const within = p.relative(folder, path);
  const outside = within === ".." || within.startsWith(`..${p.sep}`) || p.isAbsolute(within);
  if (!outside) return { refused: `${path} is inside the data folder` };
  if (host.platform === "darwin") {
    if (!/\.app$/.test(path)) return { refused: `${path} is not an application bundle` };
    const problem = host.macSignature(path);
    return problem ? { refused: `${path}: ${problem}` } : { opening: { command: "/usr/bin/open", args: ["-a", path], waits: true } };
  }
  const stat = host.stat(path);
  if (!stat?.file) return { refused: `${path} is not a file` };
  if (host.platform === "win32") {
    const own = host.env.LOCALAPPDATA ? win32.join(host.env.LOCALAPPDATA, "Programs", "viberoom", "viberoom.exe") : null;
    if (!own || win32.resolve(own).toLowerCase() !== win32.resolve(path).toLowerCase()) return { refused: `${path} is not the installer's copy (${own ?? "LOCALAPPDATA is not set"})` };
    return { opening: { command: path, args: [] } };
  }
  if (!(stat.mode & 0o111)) return { refused: `${path} is not executable` };
  if (stat.mode & 0o022) return { refused: `${path} may be written by others` };
  const ours = (uid: number) => uid === host.uid || uid === 0;
  if (!ours(stat.uid)) return { refused: `${path} belongs to another user` };
  for (let entry = path, dir = p.dirname(path); ; entry = dir, dir = p.dirname(dir)) {
    const above = host.stat(dir);
    if (!above || above.file) return { refused: `${dir} cannot be looked at` };
    if (!ours(above.uid)) return { refused: `${dir} belongs to another user` };
    if (above.mode & 0o022) {
      const below = host.stat(entry);
      if (!(above.mode & 0o1000) || !below || !ours(below.uid)) return { refused: `${dir} may be written by others` };
    }
    if (p.dirname(dir) === dir) break;
  }
  return { opening: { command: path, args: [] } };
}

export function versionSaid(room: string | null, command: string, compare: (a: string, b: string) => number): string | null {
  if (!room || room === command) return null;
  const behind = compare(room, command) < 0;
  return `the room runs viberoom ${room} in the application, and this command is ${command}${behind ? ": the application takes the newer version after its own checks" : ""}`;
}

export function applicationEnvironment(machine: Record<string, string>, ours: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(machine)) {
    if (/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS)$/i.test(key) || /^VIBEROOM_/i.test(key)) continue;
    env[key] = value;
  }
  return { ...env, ...ours };
}

export const APP_TAKES_ROOM_MS = 30_000;

export interface FoundApplication {
  name: string;
  opening: AppOpening;
  env?: Record<string, string>;
}

export interface HandOver {
  holder(): Promise<Holder | null>;
  open(opening: AppOpening, env: Record<string, string>): Promise<boolean>;
  taken(ms: number): Promise<boolean>;
  giveUp(): void;
  say(line: string): void;
  log: { info(line: string): void; warn(line: string): void };
}

export async function handOver(found: FoundApplication, h: HandOver): Promise<"taken" | "kept" | "none"> {
  const before = await h.holder();
  const commandHeld = !!before && !runByApp(before.host);
  const opened = await h.open(found.opening, found.env ?? {});
  if (opened && (await h.taken(APP_TAKES_ROOM_MS))) {
    h.giveUp();
    h.log.info(`the room is in ${found.name}`);
    h.say(`viberoom: the room is open in ${found.name}.`);
    return "taken";
  }
  const why = opened ? `${found.name} did not take the room within ${APP_TAKES_ROOM_MS / 1000} s` : `${found.name} did not start`;
  const later = opened ? ", and the application takes it over by itself if it starts later" : "";
  h.log.warn(why);
  h.say(`viberoom: ${why}; ${commandHeld ? "the room stays with this command" : "this command starts the room itself"}${later}.`);
  return commandHeld ? "kept" : "none";
}
