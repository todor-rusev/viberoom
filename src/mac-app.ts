// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const MAC_APP_ID = "com.viberoom.app";
export function releasesOf(pkg: { repository?: unknown }): string {
  const repository = pkg.repository as string | { url?: unknown } | undefined;
  const url = typeof repository === "string" ? repository : typeof repository?.url === "string" ? repository.url : "";
  const m = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Error("the package names no GitHub repository to take the application from");
  return `https://github.com/${m[1]}/${m[2]}/releases/download`;
}
const packageReleases = (): string => releasesOf(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { repository?: unknown });
export const MAC_TEAM_ID = "67265D844B";
export const MAC_LAUNCHER_ID = "dev.viberoom.launcher";
export const SYSTEM_APPLICATIONS = "/Applications";
export const SOURCE_LAUNCHER_NAME = "viberoom (source)";

export interface MacArchive {
  url: string;
  sha512: string;
  size: number;
}
export interface MacRelease {
  version: string;
  files: MacArchive[];
}

export function macAppPath(home: string): string {
  return join(home, "Applications", "viberoom.app");
}

export function sourceLauncherPath(home: string): string {
  return join(home, "Applications", `${SOURCE_LAUNCHER_NAME}.app`);
}

export function macAppPlaces(home: string, system: string = SYSTEM_APPLICATIONS): string[] {
  return [join(system, "viberoom.app"), macAppPath(home)];
}

export function installedMacApp(home: string, o: { system?: string; run?: Run } = {}): { app: string; version: string } | null {
  for (const app of macAppPlaces(home, o.system)) {
    const bundle = bundleOf(app, o.run);
    if (bundle?.id === MAC_APP_ID) return { app, version: bundle.version };
  }
  return null;
}

export interface RetiredLauncher {
  action: "removed" | "renamed";
  from: string;
  to?: string;
}

export function retireLauncher(home: string, o: { run?: Run } = {}): RetiredLauncher | null {
  const from = macAppPath(home);
  if (bundleOf(from, o.run)?.id !== MAC_LAUNCHER_ID) return null;
  let script = "";
  try {
    script = readFileSync(join(from, "Contents", "MacOS", "viberoom"), "utf8");
  } catch {
    return null;
  }
  const main = /^exec "[^"]*" "([^"]+)" start$/m.exec(script)?.[1];
  if (!main) return null;
  if (startsInstalledCopy(main)) {
    rmSync(from, { recursive: true, force: true });
    return { action: "removed", from };
  }
  const to = sourceLauncherPath(home);
  rmSync(to, { recursive: true, force: true });
  renameSync(from, to);
  const plist = join(to, "Contents", "Info.plist");
  if (existsSync(plist)) writeFileSync(plist, readFileSync(plist, "utf8").replace(/(<key>CFBundle(?:Display)?Name<\/key>\s*<string>)[^<]*(<\/string>)/g, `$1${SOURCE_LAUNCHER_NAME}$2`));
  return { action: "renamed", from, to };
}

function writablePlace(app: string): boolean {
  try {
    accessSync(dirname(app), constants.W_OK);
    if (existsSync(app)) accessSync(app, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function parseLatestMac(text: string): MacRelease {
  const unquote = (raw: string) => raw.trim().replace(/^(['"])(.*)\1$/, "$2");
  let version = "";
  let inFiles = false;
  const items: Record<string, string>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const top = /^([A-Za-z]\w*):\s*(.*)$/.exec(line);
    if (top) {
      inFiles = top[1] === "files";
      if (top[1] === "version") version = unquote(top[2]);
      continue;
    }
    if (!inFiles) continue;
    const opening = /^\s+-\s+([A-Za-z]\w*):\s*(.*)$/.exec(line);
    const inside = /^\s+([A-Za-z]\w*):\s*(.*)$/.exec(line);
    if (opening) items.push({ [opening[1]]: unquote(opening[2]) });
    else if (inside && items.length) items[items.length - 1][inside[1]] = unquote(inside[2]);
  }
  const files = items
    .map((f) => ({ url: f.url ?? "", sha512: f.sha512 ?? "", size: Number(f.size) }))
    .filter((f) => f.url && f.sha512 && Number.isSafeInteger(f.size) && f.size > 0);
  if (!version || !files.length) throw new Error("the release's latest-mac.yml names no version or no archive");
  return { version, files };
}

export function archiveFor(release: MacRelease, arch: string): MacArchive | null {
  return release.files.find((f) => f.url.endsWith(`-mac-${arch}.zip`)) ?? null;
}

export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[.+-]/).map((p) => Number.parseInt(p, 10)).map((n) => (Number.isFinite(n) ? n : 0));
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export type Run = (command: string, args: string[]) => { status: number | null; stdout: string; stderr: string };
const runCommand: Run = (command, args) => {
  const r = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? String(r.error) : "") };
};
const firstLine = (text: string) => text.trim().split(/\r?\n/)[0] || "no word from it";

export function bundleOf(app: string, run: Run = runCommand): { id: string; version: string } | null {
  const plist = join(app, "Contents", "Info.plist");
  if (!existsSync(plist)) return null;
  let xml: string | null = null;
  try {
    const text = readFileSync(plist, "utf8");
    if (text.includes("<plist")) xml = text;
  } catch {
  }
  const read = (key: string) => {
    if (xml !== null) return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml)?.[1]?.trim() ?? "";
    const r = run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist]);
    return r.status === 0 ? r.stdout.trim() : "";
  };
  return { id: read("CFBundleIdentifier"), version: read("CFBundleShortVersionString") || read("CFBundleVersion") };
}

export function startsInstalledCopy(main: string): boolean {
  return /[\\/]node_modules[\\/]viberoom[\\/]/.test(main);
}

export function signatureProblem(app: string, version: string | null, run: Run = runCommand): string | null {
  const verify = run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  if (verify.status !== 0) return `its signature does not hold (${firstLine(verify.stderr)})`;
  const details = run("/usr/bin/codesign", ["-dv", app]).stderr;
  if (/^Identifier=(.+)$/m.exec(details)?.[1] !== MAC_APP_ID) return `it is not ${MAC_APP_ID}`;
  if (/^TeamIdentifier=(.+)$/m.exec(details)?.[1] !== MAC_TEAM_ID) return `it is not signed by viberoom's team (${MAC_TEAM_ID})`;
  const gate = run("/usr/sbin/spctl", ["--assess", "--type", "execute", app]);
  if (gate.status !== 0) return `Gatekeeper does not accept it (${firstLine(gate.stderr)})`;
  if (version === null) return null;
  const bundle = bundleOf(app, run);
  if (bundle?.version !== version) return `it is version ${bundle?.version || "unknown"}, not ${version}`;
  return null;
}

function move(from: string, to: string, run: Run): void {
  try {
    renameSync(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    const copy = run("/usr/bin/ditto", [from, to]);
    if (copy.status !== 0) throw new Error(`${to} could not be written (${firstLine(copy.stderr)})`);
    rmSync(from, { recursive: true, force: true });
  }
}

export interface MacAppOptions {
  version: string;
  arch: string;
  home: string;
  dataDir: string;
  releases?: string;
  fetch?: typeof fetch;
  run?: Run;
  progress?: (received: number, total: number) => void;
  checking?: () => void;
  system?: string;
}

export interface MacAppPlaced {
  app: string;
  version: string;
  fetched: boolean;
  retired: RetiredLauncher | null;
}

async function download(url: string, dest: string, archive: MacArchive, fetchImpl: typeof fetch, progress?: MacAppOptions["progress"]): Promise<void> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`the application could not be downloaded (${res.status} from ${url})`);
  const hash = createHash("sha512");
  let received = 0;
  const count = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      received += chunk.length;
      progress?.(received, archive.size);
      done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), count, createWriteStream(dest));
  if (received !== archive.size) throw new Error(`the download ended at ${received} of ${archive.size} bytes`);
  if (hash.digest("base64") !== archive.sha512) throw new Error("the download does not match the sha512 the release gives");
}

export async function ensureMacApp(o: MacAppOptions): Promise<MacAppPlaced> {
  const run = o.run ?? runCommand;
  const fetchImpl = o.fetch ?? fetch;
  const retired = retireLauncher(o.home, { run });
  const there = installedMacApp(o.home, { system: o.system, run });
  const app = there?.app ?? macAppPath(o.home);
  if (there && (compareVersions(there.version, o.version) >= 0 || !writablePlace(app))) return { app, version: there.version, fetched: false, retired };
  const here = there ? null : bundleOf(app, run);
  if (here && here.id !== MAC_LAUNCHER_ID) throw new Error(`${app} is another application (${here.id || "no identifier"}), and it was left as it is`);
  const base = `${o.releases ?? packageReleases()}/v${o.version}`;
  const meta = await fetchImpl(`${base}/latest-mac.yml`, { signal: AbortSignal.timeout(30_000) });
  if (!meta.ok) throw new Error(`the release ${o.version} gives no latest-mac.yml (${meta.status})`);
  const release = parseLatestMac(await meta.text());
  if (release.version !== o.version) throw new Error(`the release of ${o.version} says it is ${release.version}`);
  const archive = archiveFor(release, o.arch);
  if (!archive) throw new Error(`the release ${o.version} has no application for ${o.arch}`);
  const work = join(o.dataDir, "launcher", "mac-app");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    const zip = join(work, "download.zip");
    await download(`${base}/${archive.url}`, zip, archive, fetchImpl, o.progress);
    o.checking?.();
    const unpacked = join(work, "unpacked");
    const ditto = run("/usr/bin/ditto", ["-x", "-k", zip, unpacked]);
    if (ditto.status !== 0) throw new Error(`the archive did not unpack (${firstLine(ditto.stderr)})`);
    const fresh = join(unpacked, "viberoom.app");
    if (!existsSync(fresh)) throw new Error("the archive holds no viberoom.app");
    const problem = signatureProblem(fresh, o.version, run);
    if (problem) throw new Error(`the downloaded application was not placed: ${problem}`);
    mkdirSync(dirname(app), { recursive: true });
    const aside = join(work, "previous.app");
    if (existsSync(app)) move(app, aside, run);
    try {
      move(fresh, app, run);
    } catch (error) {
      if (existsSync(aside) && !existsSync(app)) move(aside, app, run);
      throw error;
    }
    return { app, version: o.version, fetched: true, retired };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
