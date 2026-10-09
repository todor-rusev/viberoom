// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID } from "node:crypto";
import type { SqliteConnection } from "../sqlite-capabilities.js";

export interface IngestionEvent {
  kind: string;
  sourceId?: string;
  data: unknown;
}
export type IngestionObserver = (event: IngestionEvent) => void;

export function observe(observer: IngestionObserver | undefined, event: IngestionEvent): void {
  try { if (observer) observer(structuredClone(event)); } catch { }
}

export interface IngestionSource { id: string; seq: number; role: "message" | "context"; fingerprint?: string }
export interface IngestionSourceState { fingerprint: string; revision: string | null }
export interface IngestionTrace {
  readonly id: string;
  event: IngestionObserver;
  link(sources: IngestionSource[]): void;
}
export interface IngestionDebugRun {
  id: string;
  provider: string;
  startedAt: number;
  recording?: boolean;
  sources: IngestionSource[];
  events: Array<IngestionEvent & { at: number }>;
}

export const INGESTION_DEBUG_RUNS = 100;
export const INGESTION_DEBUG_DAYS = 7;
export const INGESTION_DEBUG_BYTES = 16 * 1024 * 1024;
export const INGESTION_DEBUG_EVENT_BYTES = 1024 * 1024;
export const INGESTION_DEBUG_RUN_BYTES = 4 * 1024 * 1024;
export const INGESTION_DEBUG_ACTIVE_RUNS = 64;
export const INGESTION_DEBUG_BUFFER_BYTES = 16 * 1024 * 1024;

interface BufferedRun {
  id: string; room: string; provider: string; startedAt: number; enabled: () => boolean;
  sources: Map<string, IngestionSource & { version: string | null }>;
  events: Array<{ kind: string; sourceId?: string; at: number; data: string; bytes: number }>;
  bytes: number; omitted: number; limits: Set<string>; finished: boolean; requests: Set<string>;
}

export class IngestionDebugStore {
  private readonly expiry: ReturnType<typeof setInterval>;
  private readonly pending = new Map<string, BufferedRun>();
  private bufferedBytes = 0;
  private closed = false;
  constructor(private readonly db: SqliteConnection, private readonly now: () => number = Date.now,
    private readonly sourceState?: (room: string, sourceId: string) => IngestionSourceState | null) {
    db.exec(`create table if not exists memory_debug_runs(
      id text primary key, room text not null, provider text not null, started_at integer not null, bytes integer not null);
      create index if not exists memory_debug_room on memory_debug_runs(room, started_at);
      create table if not exists memory_debug_sources(
      run_id text not null, source_id text not null, seq integer not null, role text not null,
      version text, primary key(run_id, source_id, role));
      create index if not exists memory_debug_source on memory_debug_sources(source_id, run_id);
      create table if not exists memory_debug_events(
      id integer primary key, run_id text not null, at integer not null, kind text not null,
      source_id text, data text not null, bytes integer not null);
      create index if not exists memory_debug_event_run on memory_debug_events(run_id, id);`);
    if (!db.prepare("pragma table_info(memory_debug_runs)").all().some(column => column.name === "bytes"))
      db.exec(`alter table memory_debug_runs add column bytes integer not null default 0;
        update memory_debug_runs set bytes=(select coalesce(sum(bytes),0) from memory_debug_events where run_id=memory_debug_runs.id)`);
    this.prune();
    this.expiry = setInterval(() => { try { this.prune(); } catch { } }, 60_000);
    this.expiry.unref();
  }

  close(): void { clearInterval(this.expiry); this.closed = true; this.clearPending(); }

  private discard(id: string): void {
    const run = this.pending.get(id);
    if (run) { this.bufferedBytes -= run.bytes; run.events.length = 0; run.sources.clear(); run.requests.clear(); }
    this.pending.delete(id);
  }

  private clearPending(): void { for (const id of this.pending.keys()) this.discard(id); }

  private atomic<T>(write: () => T): T {
    this.db.exec("savepoint memory_debug_write");
    try {
      const result = write();
      this.db.exec("release memory_debug_write");
      return result;
    } catch (error) {
      this.db.exec("rollback to memory_debug_write; release memory_debug_write");
      throw error;
    }
  }

  begin(room: string, provider: string, sources: IngestionSource[], enabled: () => boolean): IngestionTrace | undefined {
    if (this.closed || !enabled()) return undefined;
    const id = randomUUID();
    try {
      const run: BufferedRun = { id, room, provider, startedAt: this.now(), enabled, sources: new Map(), events: [], bytes: 0, omitted: 0, limits: new Set(), finished: false, requests: new Set() };
      this.pending.set(id, run);
      const live = () => !this.closed && enabled() && this.pending.get(id) === run;
      const link = (items: IngestionSource[]) => {
        try {
          if (!live()) return;
          for (const item of items) {
            const state = this.sourceState?.(room, item.id);
            if (this.sourceState && (!state || (item.fingerprint && item.fingerprint !== state.fingerprint))) { this.discard(id); return; }
            const version = state ? JSON.stringify(state) : null;
            const key = `${item.role}:${item.id}`;
            const old = run.sources.get(key);
            if (old && old.version !== version) { this.discard(id); return; }
            run.sources.set(key, { ...item, version });
            if (run.sources.size > 1024) { this.discard(id); return; }
          }
        } catch { this.discard(id); }
      };
      link(sources);
      this.prune();
      if (!live()) return undefined;
      if (this.pending.size > INGESTION_DEBUG_ACTIVE_RUNS) {
        run.omitted = 1;
        run.limits.add("64 active batches; this batch was not recorded");
        this.flush(run);
        return undefined;
      }
      return { id, link, event: event => {
        try {
          if (!live()) return;
          const requestId = (event.data as { requestId?: unknown } | null)?.requestId;
          if (typeof requestId === "string") {
            if (event.kind === "sieve.request") run.requests.add(requestId);
            if (event.kind === "sieve.response" || event.kind === "sieve.error") run.requests.delete(requestId);
            if (run.requests.size > 1024) { this.discard(id); return; }
          }
          let data = JSON.stringify(event.data ?? null);
          const size = Buffer.byteLength(data, "utf8");
          if (size > INGESTION_DEBUG_EVENT_BYTES) data = JSON.stringify({ omitted: true, bytes: size, reason: "This event exceeded the 1 MiB diagnostic limit; its content was not recorded." });
          const bytes = Buffer.byteLength(data, "utf8");
          const terminal = event.kind === "batch.finished" || event.kind === "batch.failed";
          if (terminal && run.finished) return;
          if (terminal && bytes > 1024) data = JSON.stringify({ omitted: true, bytes, reason: "Oversized batch completion diagnostic." });
          const limit = run.events.length >= 1024 ? "1024 events per batch" :
            run.bytes + bytes > INGESTION_DEBUG_RUN_BYTES - 4096 ? "4 MiB per batch" :
            this.bufferedBytes + bytes > INGESTION_DEBUG_BUFFER_BYTES - INGESTION_DEBUG_ACTIVE_RUNS * 4096 ? "16 MiB of active diagnostic payload" : undefined;
          if (terminal || !limit) {
            const storedBytes = Buffer.byteLength(data, "utf8");
            run.events.push({ kind: event.kind, ...(event.sourceId ? { sourceId: event.sourceId } : {}), at: this.now(), data, bytes: storedBytes });
            run.bytes += storedBytes;
            this.bufferedBytes += storedBytes;
          } else { run.omitted++; run.limits.add(limit); }
          if (terminal) run.finished = true;
          if (run.finished && run.requests.size === 0) this.flush(run);
        } catch { this.discard(id); }
      } };
    } catch { this.discard(id); return undefined; }
  }

  private valid(run: BufferedRun): boolean {
    if (this.closed || !run.enabled() || run.startedAt < this.now() - INGESTION_DEBUG_DAYS * 86_400_000) return false;
    return !this.sourceState || [...run.sources.values()].every(s => s.version === JSON.stringify(this.sourceState!(run.room, s.id)));
  }

  private flush(run: BufferedRun): void {
    try {
      this.atomic(() => {
        if (this.pending.get(run.id) !== run || !this.valid(run)) return;
        const events = this.events(run);
        this.db.prepare("insert into memory_debug_runs values(?,?,?,?,?)").run(run.id, run.room, run.provider, run.startedAt, events.reduce((sum, e) => sum + e.bytes, 0));
        const source = this.db.prepare("insert into memory_debug_sources(run_id,source_id,seq,role,version) values(?,?,?,?,?)");
        for (const s of run.sources.values()) source.run(run.id, s.id, s.seq, s.role, s.version);
        const event = this.db.prepare("insert into memory_debug_events(run_id,at,kind,source_id,data,bytes) values(?,?,?,?,?,?)");
        for (const e of events) event.run(run.id, e.at, e.kind, e.sourceId ?? null, e.data, e.bytes);
        this.pruneRecorded(true);
      });
    } finally { this.discard(run.id); }
  }

  private events(run: BufferedRun): BufferedRun["events"] {
    if (!run.omitted) return run.events;
    const data = JSON.stringify({ omitted: run.omitted, reason: "Diagnostic recording limit reached; event contents were omitted.", limits: [...run.limits] });
    return [...run.events, { kind: "diagnostic.omitted", at: this.now(), data, bytes: Buffer.byteLength(data, "utf8") }];
  }

  read(room: string, sourceId: string): IngestionDebugRun[] {
    const runs = this.db.prepare(`select r.* from memory_debug_runs r where r.room=? and exists
      (select 1 from memory_debug_sources s where s.run_id=r.id and s.source_id=? and s.role='message')
      order by r.started_at, r.rowid`).all(room, sourceId);
    const recorded = runs.filter(r => Number(r.started_at) >= this.now() - INGESTION_DEBUG_DAYS * 86_400_000).flatMap(r => {
      const sources = this.db.prepare("select * from memory_debug_sources where run_id=? order by seq,role").all(String(r.id));
      if (this.sourceState && sources.some(s => s.version !== JSON.stringify(this.sourceState!(room, String(s.source_id))))) {
        this.remove([String(r.id)]); return [];
      }
      return [{
        id: String(r.id), provider: String(r.provider), startedAt: Number(r.started_at),
        sources: sources
          .map(s => ({ id: String(s.source_id), seq: Number(s.seq), role: String(s.role) as IngestionSource["role"] })),
        events: this.db.prepare("select * from memory_debug_events where run_id=? order by id").all(String(r.id))
          .map(e => ({ at: Number(e.at), kind: String(e.kind), ...(e.source_id ? { sourceId: String(e.source_id) } : {}), data: JSON.parse(String(e.data)) as unknown })),
      }];
    });
    const active: IngestionDebugRun[] = [];
    for (const run of this.pending.values()) {
      if (run.room !== room || !run.sources.has(`message:${sourceId}`)) continue;
      if (!this.valid(run)) { this.discard(run.id); continue; }
      active.push({ id: run.id, provider: run.provider, startedAt: run.startedAt, recording: true,
        sources: [...run.sources.values()].map(({ id, seq, role }) => ({ id, seq, role })),
        events: this.events(run).map(({ bytes: _bytes, data, ...event }) => ({ ...event, data: JSON.parse(data) as unknown })),
      });
    }
    return [...recorded, ...active].sort((a, b) => a.startedAt - b.startedAt);
  }

  hasSource(room: string, sourceId: string): boolean {
    return [...this.pending.values()].some(r => r.room === room && [...r.sources.values()].some(s => s.id === sourceId)) ||
      !!this.db.prepare("select 1 from memory_debug_sources s join memory_debug_runs r on r.id=s.run_id where r.room=? and s.source_id=? limit 1").get(room, sourceId);
  }

  forgetMessages(room: string, ids: string[]): void {
    const wanted = new Set(ids);
    for (const run of this.pending.values()) if (run.room === room && [...run.sources.values()].some(s => wanted.has(s.id))) this.discard(run.id);
    const linked = this.db.prepare(`select distinct r.id from memory_debug_sources s
      join memory_debug_runs r on r.id=s.run_id where s.source_id=? and r.room=?`);
    const runs = new Set<string>();
    for (const id of wanted) for (const row of linked.all(id, room)) runs.add(String(row.id));
    this.remove([...runs]);
  }

  forgetRoom(room: string): void {
    for (const run of this.pending.values()) if (run.room === room) this.discard(run.id);
    this.remove(this.db.prepare("select id from memory_debug_runs where room=?").all(room).map(r => String(r.id)));
  }

  clear(): void {
    this.clearPending();
    this.atomic(() => this.db.exec("delete from memory_debug_events; delete from memory_debug_sources; delete from memory_debug_runs;"));
  }

  private remove(ids: string[], inTransaction = false): void {
    if (!ids.length) return;
    const events = this.db.prepare("delete from memory_debug_events where run_id=?");
    const sources = this.db.prepare("delete from memory_debug_sources where run_id=?");
    const runs = this.db.prepare("delete from memory_debug_runs where id=?");
    const remove = () => { for (const id of ids) { events.run(id); sources.run(id); runs.run(id); } };
    if (inTransaction) remove(); else this.atomic(remove);
  }

  private prune(): void {
    const cutoff = this.now() - INGESTION_DEBUG_DAYS * 86_400_000;
    for (const run of this.pending.values()) if (run.startedAt < cutoff || !run.enabled()) this.discard(run.id);
    this.pruneRecorded();
  }

  private pruneRecorded(inTransaction = false): void {
    const cutoff = this.now() - INGESTION_DEBUG_DAYS * 86_400_000;
    const runs = this.db.prepare("select id,room,started_at,bytes from memory_debug_runs order by started_at desc,rowid desc").all();
    let bytes = 0;
    const rooms = new Map<string, number>();
    const gone: string[] = [];
    for (const row of runs) {
      const room = String(row.room);
      const count = (rooms.get(room) ?? 0) + 1;
      if (Number(row.started_at) < cutoff || count > INGESTION_DEBUG_RUNS || bytes + Number(row.bytes) > INGESTION_DEBUG_BYTES) gone.push(String(row.id));
      else { rooms.set(room, count); bytes += Number(row.bytes); }
    }
    this.remove(gone, inTransaction);
  }
}
