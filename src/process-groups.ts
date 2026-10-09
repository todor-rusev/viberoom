// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { execFile, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomicAsync } from "./atomic.js";

export const PROCESS_GROUPS_FILE = "process-groups.json";
export const GROUPS_REVIEW_MS = 60_000;
const MEMBERS_KEPT = 32;
const LEADER_EXIT_PROOF_MS = 5_000;

export interface SeenProcess { pid: number; started: string }

export interface GroupRecord {
  pgid: number;
  started: string;
  label: string;
  members: SeenProcess[];
}

export interface PsRow { pid: number; pgid: number; started: string }

const same = (a: SeenProcess, b: SeenProcess): boolean => a.pid === b.pid && a.started === b.started;

export function leftoverDecision(record: GroupRecord, rows: readonly PsRow[]): "gone" | "ours" | "not-ours" | "unproven" {
  const members = rows.filter((row) => row.pgid === record.pgid);
  if (!members.length) return "gone";
  const leader = members.find((row) => row.pid === record.pgid);
  if (leader) return leader.started === record.started ? "ours" : "not-ours";
  return members.some((row) => record.members.some((seen) => same(seen, row))) ? "ours" : "unproven";
}

export function withMembers(record: GroupRecord, rows: readonly PsRow[]): GroupRecord {
  const now = rows.filter((row) => row.pgid === record.pgid && row.pid !== record.pgid).map(({ pid, started }) => ({ pid, started }));
  const lasted = now.filter((row) => record.members.some((seen) => same(seen, row)));
  const joined = now.filter((row) => !lasted.some((seen) => same(seen, row)));
  return { ...record, members: [...lasted, ...joined].slice(0, MEMBERS_KEPT) };
}

export function parsePs(text: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (match) rows.push({ pid: Number(match[1]), pgid: Number(match[2]), started: match[3] });
  }
  return rows;
}

function ps(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("ps", args, { encoding: "utf8", timeout: 3000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, LC_ALL: "C", TZ: "UTC0" } }, (error, stdout) => resolve(error ? null : stdout));
  });
}

class GroupRegistry {
  private readonly groups = new Map<number, GroupRecord>();
  private writing: Promise<void> = Promise.resolve();
  private written = "";
  private reviewing: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly leaderExits = new Map<number, number>();
  constructor(private readonly path: string) {}

  async add(child: ChildProcess, label: string): Promise<void> {
    const pgid = child.pid;
    if (!pgid || this.closed) return;
    let exited = false;
    child.once("exit", () => {
      exited = true;
      if (this.groups.has(pgid)) this.leaderExits.set(pgid, performance.now());
      void this.review();
    });
    const started = (await ps(["-o", "lstart=", "-p", String(pgid)]))?.trim();
    if (!started || exited || this.closed) return;
    this.groups.set(pgid, { pgid, started, label, members: [] });
    this.save();
    if (!this.timer) this.timer = setInterval(() => void this.review(), GROUPS_REVIEW_MS).unref();
  }

  review(): Promise<void> {
    this.reviewing = this.reviewing.then(() => this.reviewNow()).catch(() => {});
    return this.reviewing;
  }

  private async reviewNow(): Promise<void> {
    if (!this.groups.size || this.closed) return;
    const known = new Set(this.groups.keys());
    const listing = await ps(["-eo", "pid=,pgid=,lstart="]);
    if (listing === null || this.closed) return;
    const answeredAt = performance.now();
    const rows = parsePs(listing);
    for (const record of [...this.groups.values()]) {
      if (!known.has(record.pgid)) continue;
      const exitedAt = this.leaderExits.get(record.pgid);
      const leaderListed = rows.some((row) => row.pid === record.pgid && row.pgid === record.pgid);
      const justExited = exitedAt !== undefined && !leaderListed && answeredAt - exitedAt <= LEADER_EXIT_PROOF_MS;
      if (exitedAt !== undefined && !leaderListed) this.leaderExits.delete(record.pgid);
      const decision = justExited ? (rows.some((row) => row.pgid === record.pgid) ? "ours" : "gone") : leftoverDecision(record, rows);
      if (decision === "ours") this.groups.set(record.pgid, withMembers(record, rows));
      else this.groups.delete(record.pgid);
    }
    for (const pgid of this.leaderExits.keys()) if (!this.groups.has(pgid)) this.leaderExits.delete(pgid);
    if (!this.groups.size) this.stopReviews();
    this.save();
  }

  forget(pgid: number): void {
    this.leaderExits.delete(pgid);
    if (this.groups.delete(pgid)) this.save();
  }

  close(): void {
    this.closed = true;
    this.leaderExits.clear();
    this.stopReviews();
  }

  private stopReviews(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private save(): void {
    if (this.closed) return;
    const text = `${JSON.stringify({ version: 2, groups: [...this.groups.values()] }, null, 2)}\n`;
    if (text === this.written) return;
    this.written = text;
    this.writing = this.writing.then(() => writeFileAtomicAsync(this.path, text)).catch(() => {});
  }
}

let registry: GroupRegistry | null = null;

export function recordGroupsIn(dataDir: string): void {
  registry?.close();
  registry = process.platform === "win32" ? null : new GroupRegistry(join(dataDir, PROCESS_GROUPS_FILE));
}

export function groupStarted(child: ChildProcess, label: string): void {
  void registry?.add(child, label);
}

export function groupStopped(pgid: number | undefined): void {
  if (pgid) registry?.forget(pgid);
}

export function reviewGroups(): Promise<void> {
  return registry?.review() ?? Promise.resolve();
}

const seenProcess = (p: unknown): p is SeenProcess =>
  !!p && Number.isSafeInteger((p as SeenProcess).pid) && (p as SeenProcess).pid > 1 && typeof (p as SeenProcess).started === "string" && (p as SeenProcess).started.length > 0;

async function readRecords(path: string): Promise<GroupRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { groups?: unknown };
    if (!Array.isArray(parsed.groups)) return [];
    const records: GroupRecord[] = [];
    for (const g of parsed.groups as Partial<GroupRecord>[]) {
      if (!g || !seenProcess({ pid: g.pgid, started: g.started })) continue;
      const members = Array.isArray(g.members) ? g.members.filter(seenProcess).map(({ pid, started }) => ({ pid, started })) : [];
      records.push({ pgid: g.pgid!, started: g.started!, label: typeof g.label === "string" ? g.label : "", members });
    }
    return records;
  } catch {
    return [];
  }
}

export interface Leftovers {
  stopped: GroupRecord[];
  leftAlone: GroupRecord[];
}

export async function stopLeftoverGroups(dataDir: string, kill: (pgid: number) => void = (pgid) => process.kill(-pgid, "SIGKILL")): Promise<Leftovers> {
  const leftovers: Leftovers = { stopped: [], leftAlone: [] };
  if (process.platform === "win32") return leftovers;
  const path = join(dataDir, PROCESS_GROUPS_FILE);
  const records = await readRecords(path);
  if (!records.length) return leftovers;
  const listing = await ps(["-eo", "pid=,pgid=,lstart="]);
  if (listing === null) return leftovers;
  const rows = parsePs(listing);
  for (const record of records) {
    const decision = leftoverDecision(record, rows);
    if (decision === "gone") continue;
    if (decision !== "ours") {
      leftovers.leftAlone.push(record);
      continue;
    }
    try {
      kill(record.pgid);
      leftovers.stopped.push(record);
    } catch {
    }
  }
  try {
    await writeFileAtomicAsync(path, `${JSON.stringify({ version: 2, groups: [] }, null, 2)}\n`);
  } catch {
  }
  return leftovers;
}
