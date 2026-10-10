// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID } from "node:crypto";
import type { SqliteConnection } from "../sqlite-capabilities.js";
import type { ListedEpisode } from "./delivery.js";

export const EPISODE_INDEX_POLICY = Object.freeze({ overlapMs: 5 * 60_000, cursorMs: 60 * 60_000,
  fullEveryMs: 24 * 60 * 60_000, continueMs: 30_000 });
interface IndexPolicy { overlapMs: number; cursorMs: number; fullEveryMs: number; continueMs: number }
export const EPISODE_INDEX_CLOCK_MARGIN_MS = 10 * 60_000;
export interface IndexedEpisode { id: string; createdAt: number; opId: string | null; source: ListedEpisode | null }
export interface IndexPage { episodes: IndexedEpisode[]; next: string | null }
export interface IndexReader { page(direction: "asc" | "desc", cursor: string | null, signal: AbortSignal): Promise<IndexPage> }
export class IndexReadError extends Error {
  constructor(reason: string, readonly restart = false, readonly throttled = false, readonly retryAfterMs: number | null = null) { super(reason); }
}
export const THROTTLE_WAIT_MS = Object.freeze({ first: 30_000, max: 10 * 60_000, least: 1000 });
export const throttledIndexRead = (reason: string): boolean => reason === "index_read_failed_429";
interface Walk { id: string; kind: "full" | "recent"; startedAt: number; cursor: string | null; cursorAt: number | null;
  previous: number | null; newest: number | null; target: number | null; from: number | null; pages: number }
interface Head { baselineAt: number | null; newest: number | null; nextFull: number; walk: Walk | null;
  nextAt: number | null; reason: string | null; revision: string; throttles?: number }
export interface IndexRead { complete: boolean; startedAt: number; finishedAt: number; from: number | null; reason: string | null }

export class MemoryEpisodeIndex {
  constructor(private readonly db: SqliteConnection, readonly policy: Readonly<IndexPolicy> = EPISODE_INDEX_POLICY) {
    for (const n of Object.values(policy)) if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Invalid episode index policy");
    db.exec(`create table if not exists memory_episode_index_head(
      scope text not null, graph text not null, state text not null, primary key(scope,graph));
      create table if not exists memory_episode_index_entry(
      scope text not null, graph text not null, bucket text not null, id text not null,
      created_at integer not null, op_id text, source text, primary key(scope,graph,bucket,id));
      create table if not exists memory_episode_index_cursor(
      scope text not null, graph text not null, walk text not null, cursor text not null, primary key(scope,graph,walk,cursor));
      create table if not exists memory_episode_index_room(room text not null, graph text not null, primary key(room,graph));
      create index if not exists memory_episode_index_op on memory_episode_index_entry(scope,graph,bucket,op_id);
      create index if not exists memory_episode_index_source on memory_episode_index_entry(scope,graph,bucket,json_extract(source,'$.sourceId'));`);
  }

  private head(scope: string, graph: string): Head {
    const row = this.db.prepare("select state from memory_episode_index_head where scope=? and graph=?").get(scope, graph);
    return row ? JSON.parse(String(row.state)) as Head : { baselineAt: null, newest: null, nextFull: 0, walk: null, nextAt: null, reason: null, revision: "" };
  }
  private save(scope: string, graph: string, head: Head): void {
    const revision = head.revision;
    const nextRevision = randomUUID();
    if (this.db.prepare(`insert into memory_episode_index_head values(?,?,?) on conflict(scope,graph) do update set state=excluded.state
      where json_extract(memory_episode_index_head.state,'$.revision')=?`).run(scope, graph, JSON.stringify({ ...head, revision: nextRevision }), revision).changes !== 1)
      throw new Error("index_changed");
    head.revision = nextRevision;
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("savepoint memory_episode_index");
    try { const result = fn(); this.db.exec("release memory_episode_index"); return result; }
    catch (e) { this.db.exec("rollback to memory_episode_index; release memory_episode_index"); throw e; }
  }
  private put(scope: string, graph: string, bucket: string, e: IndexedEpisode): void {
    this.db.prepare(`insert into memory_episode_index_entry values(?,?,?,?,?,?,?)
      on conflict(scope,graph,bucket,id) do update set created_at=excluded.created_at,op_id=excluded.op_id,source=excluded.source`)
      .run(scope, graph, bucket, e.id, e.createdAt, e.opId, e.source ? JSON.stringify(e.source) : null);
  }
  private start(head: Head, now: number, requiredFrom?: number): Walk {
    const full = head.baselineAt === null || now >= head.nextFull;
    return { id: randomUUID(), kind: full ? "full" : "recent", startedAt: now, cursor: null, cursorAt: null,
      previous: null, newest: null, target: full ? null : head.newest === null ? null : Math.min(head.newest - this.policy.overlapMs, requiredFrom ?? Infinity),
      from: null, pages: 0 };
  }

  async read(scope: string, graph: string, reader: IndexReader, signal: AbortSignal, now: () => number, maxPages: number, requiredFrom?: number): Promise<IndexRead> {
    const startedAt = now();
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || requiredFrom !== undefined && !Number.isSafeInteger(requiredFrom)) throw new Error("Invalid index read");
    const head = this.head(scope, graph);
    const result = (complete: boolean, from: number | null, reason: string | null): IndexRead => ({ complete, startedAt, finishedAt: now(), from, reason });
    if (head.nextAt !== null && startedAt < head.nextAt) return result(false, null, head.reason ?? "index_building");
    if (head.walk?.cursorAt !== null && head.walk?.cursorAt !== undefined &&
        (startedAt < head.walk.cursorAt || startedAt - head.walk.cursorAt >= this.policy.cursorMs)) {
      this.resetWalk(scope, graph, head, "index_cursor_expired", startedAt);
    }
    if (!head.walk) { head.walk = this.start(head, startedAt, requiredFrom); this.save(scope, graph, head); }
    if (head.walk.kind === "recent" && requiredFrom !== undefined) {
      head.walk.target = Math.min(head.walk.target ?? requiredFrom, requiredFrom);
      this.save(scope, graph, head);
    }
    try {
      for (let n = 0; n < maxPages; n++) {
        signal.throwIfAborted();
        const walk = head.walk!;
        if (walk.cursorAt !== null && (now() < walk.cursorAt || now() - walk.cursorAt >= this.policy.cursorMs)) {
          this.resetWalk(scope, graph, head, "index_cursor_expired", now());
          return result(false, null, head.reason);
        }
        const page = await reader.page(walk.kind === "full" ? "asc" : "desc", walk.cursor, signal);
        signal.throwIfAborted();
        if (this.head(scope, graph).revision !== head.revision) return result(false, null, "index_changed");
        head.throttles = 0;
        const pageAt = now(), seen = new Set<string>();
        for (const e of page.episodes) {
          if (!e.id || !Number.isSafeInteger(e.createdAt) || seen.has(e.id) ||
              this.db.prepare("select 1 from memory_episode_index_entry where scope=? and graph=? and bucket=? and id=?").get(scope, graph, walk.id, e.id) ||
              walk.previous !== null && (walk.kind === "full" ? e.createdAt < walk.previous : e.createdAt > walk.previous)) throw new IndexReadError("index_unstable", true);
          seen.add(e.id); walk.previous = e.createdAt;
          walk.newest = Math.max(walk.newest ?? e.createdAt, e.createdAt);
          walk.from = Math.min(walk.from ?? e.createdAt, e.createdAt);
        }
        if (page.next !== null && (!page.next || page.next === walk.cursor ||
            this.db.prepare("select 1 from memory_episode_index_cursor where scope=? and graph=? and walk=? and cursor=?").get(scope, graph, walk.id, page.next))) throw new IndexReadError("index_cursor_loop", true);
        const done = page.next === null || walk.kind === "recent" && walk.target !== null && walk.from !== null && walk.from < walk.target;
        const coveredFrom = page.next === null ? Number.MIN_SAFE_INTEGER : walk.from;
        this.transaction(() => {
          for (const e of page.episodes) this.put(scope, graph, walk.id, e);
          if (page.next !== null) this.db.prepare("insert into memory_episode_index_cursor values(?,?,?,?)").run(scope, graph, walk.id, page.next);
          walk.pages++; walk.cursor = page.next; walk.cursorAt = pageAt;
          if (done) {
            if (walk.kind === "full") this.db.prepare("delete from memory_episode_index_entry where scope=? and graph=? and bucket='live'").run(scope, graph);
            this.db.prepare(`insert or replace into memory_episode_index_entry select scope,graph,'live',id,created_at,op_id,source
              from memory_episode_index_entry where scope=? and graph=? and bucket=?`).run(scope, graph, walk.id);
            this.db.prepare("delete from memory_episode_index_entry where scope=? and graph=? and bucket=?").run(scope, graph, walk.id);
            this.db.prepare("delete from memory_episode_index_cursor where scope=? and graph=? and walk=?").run(scope, graph, walk.id);
            if (walk.newest !== null) head.newest = Math.max(head.newest ?? walk.newest, walk.newest);
            head.walk = null; head.nextAt = null; head.reason = null;
            if (walk.kind === "full") {
              head.baselineAt = pageAt; head.newest = walk.newest; head.nextFull = pageAt + this.policy.fullEveryMs;
              head.walk = this.start(head, pageAt, requiredFrom);
            }
          }
          this.save(scope, graph, head);
        });
        if (done && walk.kind === "recent") return { complete: true, startedAt: walk.startedAt, finishedAt: now(), from: coveredFrom, reason: null };
      }
      this.continueAt(head, now()); head.reason = head.walk?.kind === "full" ? "index_building" : "index_recent_incomplete";
      this.save(scope, graph, head);
      return result(false, null, head.reason);
    } catch (error) {
      if (this.head(scope, graph).revision !== head.revision) return result(false, null, "index_changed");
      const reason = signal.aborted ? "index_read_interrupted" : error instanceof IndexReadError ? error.message : "index_read_failed";
      if (error instanceof IndexReadError && error.restart) this.resetWalk(scope, graph, head, reason, now());
      else if (error instanceof IndexReadError && error.throttled) {
        head.throttles = (head.throttles ?? 0) + 1;
        const wait = error.retryAfterMs ?? THROTTLE_WAIT_MS.first * 2 ** (head.throttles - 1);
        head.reason = reason; head.nextAt = now() + Math.max(THROTTLE_WAIT_MS.least, Math.min(THROTTLE_WAIT_MS.max, wait));
        this.save(scope, graph, head);
      } else { head.reason = reason; this.continueAt(head, now()); this.save(scope, graph, head); }
      return result(false, null, reason);
    }
  }

  private continueAt(head: Head, now: number): void {
    head.nextAt = Math.max(now, Math.min(now + this.policy.continueMs,
      (head.walk?.cursorAt ?? now) + this.policy.cursorMs - 1));
  }

  private resetWalk(scope: string, graph: string, head: Head, reason: string, now: number): void {
    this.transaction(() => {
      if (head.walk) this.db.prepare("delete from memory_episode_index_entry where scope=? and graph=? and bucket=?").run(scope, graph, head.walk.id);
      if (head.walk) this.db.prepare("delete from memory_episode_index_cursor where scope=? and graph=? and walk=?").run(scope, graph, head.walk.id);
      head.walk = null; head.nextAt = now + this.policy.continueMs; head.reason = reason; this.save(scope, graph, head);
    });
  }
  entries(scope: string, graph: string, opId?: string, sourceId?: string): IndexedEpisode[] {
    return this.db.prepare(`select * from memory_episode_index_entry where scope=? and graph=? and bucket='live'${opId ? " and op_id=?" : ""}${sourceId ? " and json_extract(source,'$.sourceId')=?" : ""}`)
      .all(scope, graph, ...(opId ? [opId] : []), ...(sourceId ? [sourceId] : [])).map(row => ({ id: String(row.id), createdAt: Number(row.created_at),
        opId: row.op_id === null ? null : String(row.op_id), source: row.source === null ? null : JSON.parse(String(row.source)) as ListedEpisode }));
  }
  refresh(scope: string, graph: string, e: IndexedEpisode): void {
    this.put(scope, graph, "live", e);
  }
  remove(scope: string, graph: string, id: string): void {
    this.db.prepare("delete from memory_episode_index_entry where scope=? and graph=? and id=?").run(scope, graph, id);
  }
  removeReceipt(scope: string, id: string): void {
    this.db.prepare("delete from memory_episode_index_entry where scope=? and id=?").run(scope, id);
  }
  attachRoom(room: string, graph: string): void {
    this.db.prepare("insert or ignore into memory_episode_index_room values(?,?)").run(room, graph);
  }
  dropRoom(room: string): void {
    this.transaction(() => {
      const graphs = this.db.prepare("select graph from memory_episode_index_room where room=?").all(room);
      this.db.prepare("delete from memory_episode_index_room where room=?").run(room);
      for (const row of graphs) if (!this.db.prepare("select 1 from memory_episode_index_room where graph=?").get(row.graph)) {
        for (const table of ["memory_episode_index_head", "memory_episode_index_entry", "memory_episode_index_cursor"])
          this.db.prepare("delete from " + table + " where graph=?").run(row.graph);
      }
    });
  }
  nextAt(scope: string, graph: string): number | null {
    const h = this.head(scope, graph);
    return h.walk || h.reason ? h.nextAt : h.baselineAt === null ? null : h.nextFull;
  }
  drop(scope: string, graph: string): void {
    this.transaction(() => {
      this.db.prepare("delete from memory_episode_index_head where scope=? and graph=?").run(scope, graph);
      this.db.prepare("delete from memory_episode_index_entry where scope=? and graph=?").run(scope, graph);
      this.db.prepare("delete from memory_episode_index_cursor where scope=? and graph=?").run(scope, graph);
    });
  }
}
