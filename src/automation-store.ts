// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dayInZone, nextOccurrence, parseAutomation, type AutomationDefinition } from "./automation-schedule.js";

export interface AutomationJob extends AutomationDefinition {
  id: string; roomKey: string; revision: number; createdAt: number; updatedAt: number;
  anchor: number; nextAt: number | null; lastEvent: string | null;
}
export type AutomationRunStatus = "waiting" | "running" | "completed" | "failed" | "cancelled" | "interrupted" | "skipped";
export interface AutomationRun {
  id: string; jobId: string; roomKey: string; job: AutomationJob; source: "schedule" | "manual" | "event";
  occurrence: string; scheduledAt: number; queuedAt: number; startedAt: number | null; finishedAt: number | null;
  status: AutomationRunStatus; detail: string; messageId?: string; coalescedThrough?: number;
  delivery: "pending" | "posted" | "silent" | "unconfirmed" | "none";
}
export interface AutomationProposal {
  id: string; roomKey: string; by: string; why: string; definition: AutomationDefinition;
  jobId: string | null; expectedRevision: number | null; createdAt: number; status: "pending" | "applied" | "rejected";
}

const liveOwners = new Set<string>();
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

export class AutomationStore {
  private readonly db: DatabaseSync;
  private readonly owner = randomUUID();
  private closed = false;
  constructor(file: string, now = Date.now()) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    try {
      const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version);
      if (version > 1) throw new Error("This automation store requires a newer viberoom.");
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
        CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL, token TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, room TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, job TEXT NOT NULL, room TEXT NOT NULL, occurrence TEXT NOT NULL, status TEXT NOT NULL, queued INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(job,occurrence));
        CREATE UNIQUE INDEX IF NOT EXISTS active_job ON runs(job) WHERE status IN ('waiting','running');
        CREATE INDEX IF NOT EXISTS room_runs ON runs(room,queued DESC);
        CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, room TEXT NOT NULL, body TEXT NOT NULL);
        PRAGMA user_version=1;`);
      this.transaction(() => {
        const old = this.db.prepare("SELECT pid, token FROM owner WHERE id=1").get() as {pid:number;token:string} | undefined;
        if (old && (Number(old.pid) === process.pid ? liveOwners.has(old.token) : alive(Number(old.pid)))) throw new Error("Another running viberoom owns these automations.");
        this.db.prepare("INSERT OR REPLACE INTO owner VALUES(1,?,?)").run(process.pid, this.owner);
        for (const run of this.runs(undefined, "running")) this.writeRun({ ...run, status: "interrupted", delivery: "unconfirmed", finishedAt: now, detail: "The previous run ended without a confirmed result. Review it before running again." });
      });
      liveOwners.add(this.owner);
    } catch (error) { this.db.close(); throw error; }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = fn(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private writeJob(job: AutomationJob): void { this.db.prepare("INSERT OR REPLACE INTO jobs VALUES(?,?,?)").run(job.id, job.roomKey, JSON.stringify(job)); }
  private writeRun(run: AutomationRun): void {
    this.db.prepare("INSERT INTO runs VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,body=excluded.body").run(run.id, run.jobId, run.roomKey, run.occurrence, run.status, run.queuedAt, JSON.stringify(run));
  }
  jobs(roomKey?: string): AutomationJob[] {
    return (roomKey ? this.db.prepare("SELECT body FROM jobs WHERE room=?").all(roomKey) : this.db.prepare("SELECT body FROM jobs").all()).map(row => JSON.parse(String(row.body)));
  }
  get(roomKey: string, id: string): AutomationJob {
    const row = this.db.prepare("SELECT body FROM jobs WHERE id=? AND room=?").get(id, roomKey);
    if (!row) throw new Error("This automation no longer exists in this room.");
    return JSON.parse(String(row.body));
  }
  runs(roomKey?: string, status?: AutomationRunStatus, limit = 200): AutomationRun[] {
    const where: string[] = [], args: (string | number)[] = [];
    if (roomKey) { where.push("room=?"); args.push(roomKey); }
    if (status) { where.push("status=?"); args.push(status); }
    const sql = `SELECT body FROM runs${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY queued ${status ? "ASC" : "DESC"}${status ? "" : " LIMIT ?"}`;
    if (!status) args.push(limit);
    return this.db.prepare(sql).all(...args).map(row => JSON.parse(String(row.body)));
  }
  run(roomKey: string, id: string): AutomationRun {
    const row = this.db.prepare("SELECT body FROM runs WHERE id=? AND room=?").get(id, roomKey);
    if (!row) throw new Error("This run no longer exists in this room.");
    return JSON.parse(String(row.body));
  }
  save(roomKey: string, raw: unknown, id: string | null, revision: number | null, now: number): AutomationJob {
    const old = id ? this.get(roomKey, id) : null;
    const definition = parseAutomation(raw, now, !old);
    return this.transaction(() => this.saveInside(roomKey, definition, id, revision, now));
  }
  private saveInside(roomKey: string, definition: AutomationDefinition, id: string | null, revision: number | null, now: number): AutomationJob {
    const old = id ? this.get(roomKey, id) : null;
    if (old && old.revision !== revision) throw new Error("This automation changed. Refresh it before saving.");
    if (!old && this.jobs(roomKey).length >= 100) throw new Error("This room already has 100 automations.");
    const scheduleChanged = !old || JSON.stringify(old.schedule) !== JSON.stringify(definition.schedule);
    if (scheduleChanged) parseAutomation(definition, now);
    const anchor = scheduleChanged ? now : old!.anchor;
    let nextAt = scheduleChanged ? nextOccurrence(definition.schedule, now, anchor) : old!.nextAt;
    if (old && !old.enabled && definition.enabled && definition.schedule.kind !== "event") nextAt = definition.schedule.kind === "once" ? definition.schedule.at : nextOccurrence(definition.schedule, now, anchor);
    const job: AutomationJob = { ...definition, id: old?.id ?? randomUUID(), roomKey, revision: (old?.revision ?? 0) + 1,
      createdAt: old?.createdAt ?? now, updatedAt: now, anchor, nextAt, lastEvent: scheduleChanged ? null : old!.lastEvent };
    for (const run of this.runs(roomKey, "waiting").filter(r => r.jobId === job.id)) this.writeRun({ ...run, status: "cancelled", finishedAt: now, detail: "The automation was changed before this run started." });
    this.writeJob(job); return job;
  }
  remove(roomKey: string, id: string, revision: number, now: number): void {
    this.transaction(() => {
      if (this.get(roomKey, id).revision !== revision) throw new Error("This automation changed. Refresh it before deleting.");
      for (const run of this.runs(roomKey, "waiting").filter(r => r.jobId === id)) this.writeRun({ ...run, status: "cancelled", finishedAt: now, detail: "The automation was deleted." });
      this.db.prepare("DELETE FROM jobs WHERE id=? AND room=?").run(id, roomKey);
    });
  }
  removeRoom(roomKey: string): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM jobs WHERE room=?").run(roomKey);
      this.db.prepare("DELETE FROM proposals WHERE room=?").run(roomKey);
      this.db.prepare("DELETE FROM runs WHERE room=?").run(roomKey);
    });
  }
  private enqueue(job: AutomationJob, source: AutomationRun["source"], occurrence: string, at: number, now: number, skip = ""): AutomationRun {
    const seen = this.db.prepare("SELECT body FROM runs WHERE job=? AND occurrence=?").get(job.id, occurrence);
    if (seen) return JSON.parse(String(seen.body));
    const activeRow = this.db.prepare("SELECT body FROM runs WHERE job=? AND status IN ('waiting','running')").get(job.id);
    if (activeRow && !skip) {
      const active: AutomationRun = JSON.parse(String(activeRow.body));
      if (source === "manual") return active;
      if (active.status === "waiting") { active.coalescedThrough = at; this.writeRun(active); return active; }
      skip = "The previous run was still working; this occurrence was skipped.";
    }
    const run: AutomationRun = { id: randomUUID(), jobId: job.id, roomKey: job.roomKey, job: structuredClone(job), source, occurrence,
      scheduledAt: at, queuedAt: now, startedAt: null, finishedAt: skip ? now : null, status: skip ? "skipped" : "waiting", delivery: skip ? "none" : "pending", detail: skip };
    this.writeRun(run); return run;
  }
  due(now: number): boolean {
    return this.transaction(() => {
      let changed = false;
      for (const job of this.jobs()) {
        if (!job.enabled || job.nextAt === null || job.nextAt > now) continue;
        const at = job.nextAt;
        this.enqueue(job, "schedule", `schedule:${job.revision}:${at}`, at, now, job.catchUp === "skip" && at < now - 60000 ? "The scheduled time passed while work could not start." : "");
        job.nextAt = nextOccurrence(job.schedule, now, job.anchor);
        if (job.schedule.kind === "once") job.enabled = false;
        this.writeJob(job); changed = true;
      }
      this.prune(); return changed;
    });
  }
  event(roomKey: string, event: "first-human-message" | "room-start", key: string, now: number): boolean {
    return this.transaction(() => {
      let changed = false;
      for (const job of this.jobs(roomKey)) {
        if (!job.enabled || job.schedule.kind !== "event" || job.schedule.event !== event) continue;
        const occurrence = event === "first-human-message" ? dayInZone(now, job.schedule.timeZone) : key;
        if (job.lastEvent === occurrence) continue;
        this.enqueue(job, "event", `event:${job.revision}:${occurrence}`, now, now);
        job.lastEvent = occurrence; this.writeJob(job); changed = true;
      }
      return changed;
    });
  }
  manual(roomKey: string, id: string, now: number): AutomationRun {
    return this.transaction(() => this.enqueue(this.get(roomKey, id), "manual", `manual:${randomUUID()}`, now, now));
  }
  waiting(id: string, roomKey: string, detail: string): boolean {
    const run = this.run(roomKey, id);
    if (run.status !== "waiting" || run.detail === detail) return false;
    this.writeRun({ ...run, detail }); return true;
  }
  start(id: string, roomKey: string, now: number): AutomationRun | null {
    return this.transaction(() => {
      const run = this.run(roomKey, id);
      if (run.status !== "waiting") return null;
      const started: AutomationRun = { ...run, status: "running", startedAt: now, detail: "" };
      this.writeRun(started); return started;
    });
  }
  defer(id: string, roomKey: string, detail: string): void {
    if (this.closed) return;
    if (!this.db.prepare("SELECT id FROM runs WHERE id=? AND room=?").get(id, roomKey)) return;
    const run = this.run(roomKey, id);
    if (run.status === "running") this.writeRun({ ...run, status: "waiting", startedAt: null, detail });
  }
  finish(id: string, roomKey: string, status: Exclude<AutomationRunStatus, "waiting" | "running">, detail: string, now: number, messageId?: string, delivery?: AutomationRun["delivery"]): void {
    if (this.closed) return;
    if (!this.db.prepare("SELECT id FROM runs WHERE id=? AND room=?").get(id, roomKey)) return;
    const run = this.run(roomKey, id);
    if (run.status !== "running" && run.status !== "waiting") return;
    this.writeRun({ ...run, status, delivery: delivery ?? (messageId ? "posted" : status === "interrupted" ? "unconfirmed" : "none"), detail: detail.slice(0, 1000), finishedAt: now, ...(messageId ? { messageId } : {}) });
    this.prune();
  }
  propose(roomKey: string, by: string, why: string, raw: unknown, jobId: string | null, revision: number | null, now: number): AutomationProposal {
    if (!why.trim() || why.length > 1000) throw new Error("Explain the proposal in 1–1000 characters.");
    if (this.proposals(roomKey).filter(p => p.status === "pending").length >= 20) throw new Error("Review the pending automation proposals first.");
    if (jobId && this.get(roomKey, jobId).revision !== revision) throw new Error("This automation changed. Read it again before proposing an edit.");
    const proposal: AutomationProposal = { id: randomUUID(), roomKey, by, why: why.trim(), definition: parseAutomation(raw, now), jobId, expectedRevision: revision, createdAt: now, status: "pending" };
    this.db.prepare("INSERT INTO proposals VALUES(?,?,?)").run(proposal.id, roomKey, JSON.stringify(proposal));
    return proposal;
  }
  proposals(roomKey: string): AutomationProposal[] { return this.db.prepare("SELECT body FROM proposals WHERE room=?").all(roomKey).map(r => JSON.parse(String(r.body))); }
  resolve(roomKey: string, id: string, apply: boolean, now: number): AutomationJob | null {
    return this.transaction(() => {
      const proposal = this.proposals(roomKey).find(p => p.id === id);
      if (!proposal || proposal.status !== "pending") throw new Error("This proposal is no longer pending.");
      const job = apply ? this.saveInside(roomKey, parseAutomation(proposal.definition, now), proposal.jobId, proposal.expectedRevision, now) : null;
      proposal.status = apply ? "applied" : "rejected";
      this.db.prepare("UPDATE proposals SET body=? WHERE id=?").run(JSON.stringify(proposal), id);
      return job;
    });
  }
  private prune(): void {
    this.db.exec("DELETE FROM runs WHERE status NOT IN ('waiting','running') AND id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY room ORDER BY queued DESC) AS n FROM runs WHERE status NOT IN ('waiting','running')) WHERE n>200)");
    this.db.exec("DELETE FROM proposals WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY room ORDER BY json_extract(body,'$.createdAt') DESC) AS n FROM proposals WHERE json_extract(body,'$.status')<>'pending') WHERE n>50)");
  }
  close(now = Date.now()): void {
    if (this.closed) return;
    this.transaction(() => {
      for (const run of this.runs(undefined, "running")) this.writeRun({ ...run, status: "interrupted", delivery: "unconfirmed", finishedAt: now, detail: "The room stopped before this run had a confirmed result." });
      this.db.prepare("DELETE FROM owner WHERE token=?").run(this.owner);
    });
    this.closed = true; liveOwners.delete(this.owner); this.db.close();
  }
}
