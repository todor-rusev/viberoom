// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { ChatMessage } from "./room.js";
import { Logger } from "./log.js";

export const HISTORY_DB_FILE = "history.db";
export const SCHEMA_VERSION = 1;

const AGENT_VISIBLE_SQL = "m.deleted_at is null and m.kind in ('chat','system') and coalesce(json_extract(m.body, '$.audience'), '') != 'human'";

export type StoredMessage = ChatMessage;

export interface SearchQuery {
  text: string;
  rooms?: string[];
  kinds?: Array<"chat" | "system">;
  author?: string;
  limit?: number;
  offset?: number;
  sort?: "rank" | "newest" | "oldest";
  perRoom?: number;
  includeDeleted?: boolean;
  agentVisible?: boolean;
}

export interface SearchHit {
  roomId: string;
  seq: number;
  id: string;
  kind: ChatMessage["kind"];
  from: string;
  fromName: string;
  toNames: string[];
  ts: number;
  snippet: string;
  rank: number;
  deleted: boolean;
}

export interface SearchResult {
  hits: SearchHit[];
  query: string;
  usedTrigram: boolean;
}

export interface ImportReport {
  imported: number;
  skipped: number;
}

export interface MessageFeatures {
  chars: number;
  tableRows: number;
  fences: number;
  diagrams: number;
  images: number;
  toolCalls: number;
  quotes: number;
}

export function messageFeatures(message: StoredMessage): MessageFeatures {
  const text = message.text ?? "";
  const lines = text.split("\n");
  return {
    chars: text.length,
    tableRows: lines.filter((l) => /^\s*\|.*\|\s*$/.test(l)).length,
    fences: (text.match(/^\s*```/gm) ?? []).length >> 1,
    diagrams: (text.match(/^\s*```\s*mermaid/gim) ?? []).length,
    images: message.images?.length ?? 0,
    toolCalls: message.toolCalls?.length ?? 0,
    quotes: message.quotes?.length ?? 0,
  };
}

export function messageWeight(features: MessageFeatures): number {
  return features.chars + 120 * features.tableRows + 400 * features.fences + 2500 * features.diagrams + 1500 * features.images + 400 * features.toolCalls + 200 * features.quotes;
}

export interface FoldBoundary {
  fromSeq: number;
  shown: number;
  hidden: number;
  weight: number;
}

const LATER_COLUMNS: Array<[string, string]> = [
  ["features", "text"],
  ["weight", "integer"],
];

export type PendingOp =
  | { kind: "upsert"; message: StoredMessage }
  | { kind: "truncate"; fromSeq: number; deletedAt: number }
  | { kind: "rewrite"; fromSeq: number; deletedAt: number; message: StoredMessage };
export type DivertOp = PendingOp & { opId: string };

export interface MigrationMark {
  at: number;
  source: "jsonl" | "none" | "mirror";
  skipped: number;
  size: number;
  mtimeMs: number;
  imported: number;
  marked: number;
  confirmedAt?: number;
}

export interface Cursor {
  order: number;
  seq: number;
}

export const cursorOf = (m: { seq: number; displayOrder?: number }): Cursor => ({ order: m.displayOrder ?? m.seq, seq: m.seq });

const ORDER_KEY = "coalesce(display_order, seq)";

export interface PageQuery {
  before?: Cursor;
  after?: Cursor;
  limit: number;
}

const SCHEMA = `
create table if not exists meta(key text primary key, value text not null);
create table if not exists applied_ops(op_id text primary key, room text not null, applied_at integer not null);
create table if not exists messages(
  rowid integer primary key,
  room text not null,
  id text not null,
  seq integer not null,
  display_order integer,
  kind text not null,
  author text,
  author_name text,
  ts integer not null,
  text text not null,
  pinned integer not null default 0,
  deleted_at integer,
  body text not null,
  unique(room, id)
);
create index if not exists idx_messages_room_seq on messages(room, seq);
create virtual table if not exists messages_fts using fts5(
  text, author_name, content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
create virtual table if not exists messages_trigram using fts5(
  text, content='messages', content_rowid='rowid', tokenize='trigram');
create trigger if not exists messages_ai after insert on messages when new.kind in ('chat', 'system') begin
  insert into messages_fts(rowid, text, author_name) values (new.rowid, new.text, new.author_name);
  insert into messages_trigram(rowid, text) values (new.rowid, new.text);
end;
create trigger if not exists messages_ad after delete on messages when old.kind in ('chat', 'system') begin
  insert into messages_fts(messages_fts, rowid, text, author_name) values ('delete', old.rowid, old.text, old.author_name);
  insert into messages_trigram(messages_trigram, rowid, text) values ('delete', old.rowid, old.text);
end;
create trigger if not exists messages_au after update of text, author_name on messages when new.kind in ('chat', 'system') begin
  insert into messages_fts(messages_fts, rowid, text, author_name) values ('delete', old.rowid, old.text, old.author_name);
  insert into messages_fts(rowid, text, author_name) values (new.rowid, new.text, new.author_name);
  insert into messages_trigram(messages_trigram, rowid, text) values ('delete', old.rowid, old.text);
  insert into messages_trigram(rowid, text) values (new.rowid, new.text);
end;
`;

const FTS_OPERATORS = new Set(["AND", "OR", "NOT", "NEAR"]);
const QUERY_TOKEN = /"[^"]*"?|\S+/g;

export function sanitizeQuery(raw: string): string {
  const tokens = (raw.match(QUERY_TOKEN) ?? []).map((t) => t.trim()).filter(Boolean);
  const out: string[] = [];
  for (const token of tokens) {
    if (FTS_OPERATORS.has(token)) {
      if (token === "NEAR") continue;
      if (out.length && !FTS_OPERATORS.has(out[out.length - 1])) out.push(token);
      continue;
    }
    if (token.startsWith('"')) {
      const inner = token.replace(/^"|"$/g, "").replace(/"/g, "").trim();
      if (inner) out.push(`"${inner}"`);
      continue;
    }
    const prefix = token.endsWith("*");
    const word = (prefix ? token.slice(0, -1) : token).replace(/"/g, "").trim();
    if (!word) continue;
    out.push(prefix ? `"${word}"*` : `"${word}"`);
  }
  while (out.length && FTS_OPERATORS.has(out[out.length - 1])) out.pop();
  return out.join(" ");
}

function trigramQuery(raw: string): string {
  const words = (raw.match(QUERY_TOKEN) ?? [])
    .map((t) => t.replace(/"/g, "").replace(/\*$/, "").trim())
    .filter((t) => t.length >= 3 && !FTS_OPERATORS.has(t));
  return words.map((w) => `"${w}"`).join(" ");
}

function hasOperators(query: string): boolean {
  return /(^|\s)(AND|OR|NOT)(\s|$)|\*$/.test(query);
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

type Row = Record<string, unknown>;

export class HistoryStore {
  private readonly db: DatabaseSync;
  private readonly log: Logger;

  constructor(readonly path: string, log?: Logger) {
    this.log = log ?? new Logger("history");
    this.db = new DatabaseSync(path);
    this.db.function("unicode_lower", { deterministic: true }, (value) => typeof value === "string" ? value.toLowerCase() : null);
    this.db.exec("pragma journal_mode = wal");
    this.db.exec("pragma synchronous = full");
    this.db.exec("pragma foreign_keys = on");
    this.db.exec(SCHEMA);
    this.reconcileColumns();
    const version = this.meta("schema_version");
    if (version === null) this.setMeta("schema_version", String(SCHEMA_VERSION));
    else if (Number(version) > SCHEMA_VERSION) {
      this.db.close();
      throw new Error(`history.db was written by a newer viberoom (schema ${version}, this one knows ${SCHEMA_VERSION})`);
    }
  }

  private reconcileColumns(): void {
    const have = new Set((this.db.prepare("pragma table_info(messages)").all() as Row[]).map((r) => String(r.name)));
    const added = LATER_COLUMNS.filter(([name]) => !have.has(name));
    if (!added.length) return;
    for (const [name, type] of added) this.db.exec(`alter table messages add column ${name} ${type}`);
    this.transaction(() => {
      const fill = this.db.prepare("update messages set features = ?, weight = ? where rowid = ?");
      for (const row of this.db.prepare("select rowid, body from messages").all() as Row[]) {
        const features = messageFeatures(this.decode(row));
        fill.run(JSON.stringify(features), messageWeight(features), row.rowid as number);
      }
    });
    this.log.info(`history.db: added ${added.map(([n]) => n).join(", ")} and filled the existing rows`);
  }

  meta(key: string): string | null {
    const row = this.db.prepare("select value from meta where key = ?").get(key) as Row | undefined;
    return row ? String(row.value) : null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("insert into meta(key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, value);
  }

  deleteMeta(key: string): void {
    this.db.prepare("delete from meta where key = ?").run(key);
  }

  private transactionDepth = 0;

  transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) return work();
    this.db.exec("begin immediate");
    this.transactionDepth++;
    try {
      const result = work();
      this.db.exec("commit");
      return result;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }


  upsert(roomId: string, message: StoredMessage): void {
    const features = messageFeatures(message);
    this.db
      .prepare(
        `insert into messages(room, id, seq, display_order, kind, author, author_name, ts, text, pinned, body, features, weight)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(room, id) do update set
           seq = excluded.seq, display_order = excluded.display_order, kind = excluded.kind, author = excluded.author,
           author_name = excluded.author_name, ts = excluded.ts, text = excluded.text, pinned = excluded.pinned, body = excluded.body,
           features = excluded.features, weight = excluded.weight, deleted_at = null`,
      )
      .run(
        roomId,
        message.id,
        message.seq,
        message.displayOrder ?? null,
        message.kind,
        message.from ?? null,
        message.fromName ?? null,
        message.ts,
        message.text ?? "",
        message.pinned ? 1 : 0,
        JSON.stringify(message),
        JSON.stringify(features),
        messageWeight(features),
      );
  }

  upsertMany(roomId: string, messages: StoredMessage[]): void {
    this.transaction(() => {
      for (const m of messages) this.upsert(roomId, m);
    });
  }

  reconcile(roomId: string, live: StoredMessage[], deletedAt = Date.now(), opts: { markUpToSeq?: number } = {}): { upserted: number; marked: number } {
    return this.transaction(() => {
      const known = new Map<string, { body: string; seq: number }>();
      for (const row of this.db.prepare("select id, seq, body from messages where room = ? and deleted_at is null").all(roomId) as Row[]) known.set(String(row.id), { body: String(row.body), seq: Number(row.seq) });
      let upserted = 0;
      const liveIds = new Set<string>();
      for (const m of live) {
        liveIds.add(m.id);
        if (known.get(m.id)?.body === JSON.stringify(m)) continue;
        this.upsert(roomId, m);
        upserted++;
      }
      const gone = [...known.entries()].filter(([id, row]) => !liveIds.has(id) && (opts.markUpToSeq === undefined || row.seq <= opts.markUpToSeq)).map(([id]) => id);
      let marked = 0;
      for (let i = 0; i < gone.length; i += 500) marked += this.markDeleted(roomId, gone.slice(i, i + 500), deletedAt);
      return { upserted, marked };
    });
  }

  truncateFrom(roomId: string, fromSeq: number, deletedAt = Date.now()): number {
    return this.db.prepare("update messages set deleted_at = ? where room = ? and seq > ? and deleted_at is null").run(deletedAt, roomId, fromSeq).changes as number;
  }

  rewrite(roomId: string, message: StoredMessage, fromSeq: number, deletedAt = Date.now()): number {
    return this.transaction(() => {
      const marked = this.truncateFrom(roomId, fromSeq, deletedAt);
      this.upsert(roomId, message);
      return marked;
    });
  }

  markDeleted(roomId: string, ids: string[], deletedAt = Date.now()): number {
    if (!ids.length) return 0;
    return this.db.prepare(`update messages set deleted_at = ? where room = ? and id in (${placeholders(ids.length)}) and deleted_at is null`).run(deletedAt, roomId, ...ids).changes as number;
  }

  dropRoom(roomId: string): void {
    this.db.prepare("delete from messages where room = ?").run(roomId);
  }


  private decode(row: Row): StoredMessage {
    return JSON.parse(String(row.body)) as StoredMessage;
  }

  count(roomId: string, options: { includeDeleted?: boolean } = {}): number {
    const row = this.db.prepare(`select count(*) as n from messages where room = ?${options.includeDeleted ? "" : " and deleted_at is null"}`).get(roomId) as Row;
    return Number(row.n);
  }

  indexedCount(): number {
    return Number((this.db.prepare("select count(*) as n from messages_fts_docsize").get() as Row).n);
  }

  rooms(): string[] {
    return (this.db.prepare("select distinct room from messages order by room").all() as Row[]).map((r) => String(r.room));
  }

  get(roomId: string, seq: number): StoredMessage | null {
    const row = this.db.prepare("select body from messages where room = ? and seq = ? and deleted_at is null").get(roomId, seq) as Row | undefined;
    return row ? this.decode(row) : null;
  }

  all(roomId: string): StoredMessage[] {
    return (this.db.prepare("select body from messages where room = ? and deleted_at is null order by seq").all(roomId) as Row[]).map((r) => this.decode(r));
  }

  countBefore(roomId: string, cursor: Cursor): number {
    return Number((this.db.prepare(`select count(*) as n from messages where room = ? and deleted_at is null and (${ORDER_KEY} < ? or (${ORDER_KEY} = ? and seq < ?))`).get(roomId, cursor.order, cursor.order, cursor.seq) as Row).n);
  }

  deleted(roomId: string): Array<{ message: StoredMessage; deletedAt: number }> {
    return (this.db.prepare("select body, deleted_at from messages where room = ? and deleted_at is not null order by seq").all(roomId) as Row[]).map((r) => ({ message: this.decode(r), deletedAt: Number(r.deleted_at) }));
  }

  page(roomId: string, query: PageQuery): StoredMessage[] {
    const limit = Math.max(1, Math.floor(query.limit));
    if (query.after) {
      const a = query.after;
      return (this.db.prepare(`select body from messages where room = ? and deleted_at is null and (${ORDER_KEY} > ? or (${ORDER_KEY} = ? and seq > ?)) order by ${ORDER_KEY}, seq limit ?`).all(roomId, a.order, a.order, a.seq, limit) as Row[]).map((r) => this.decode(r));
    }
    const b = query.before;
    const rows = b
      ? (this.db.prepare(`select body from messages where room = ? and deleted_at is null and (${ORDER_KEY} < ? or (${ORDER_KEY} = ? and seq < ?)) order by ${ORDER_KEY} desc, seq desc limit ?`).all(roomId, b.order, b.order, b.seq, limit) as Row[])
      : (this.db.prepare(`select body from messages where room = ? and deleted_at is null order by ${ORDER_KEY} desc, seq desc limit ?`).all(roomId, limit) as Row[]);
    return rows.reverse().map((r) => this.decode(r));
  }

  foldBoundary(roomId: string, budget: { maxMessages: number; maxWeight?: number; atLeastSeq?: number }): FoldBoundary {
    const rows = this.db.prepare(`select seq, coalesce(weight, length(text)) as weight from messages where room = ? and deleted_at is null order by ${ORDER_KEY} desc, seq desc`).all(roomId) as Row[];
    let requiredThrough = -1;
    if (budget.atLeastSeq !== undefined) rows.forEach((row, index) => { if (Number(row.seq) >= budget.atLeastSeq!) requiredThrough = index; });
    let shown = 0;
    let weight = 0;
    let fromSeq = 0;
    for (const row of rows) {
      const seq = Number(row.seq);
      const w = Number(row.weight);
      const over = shown >= budget.maxMessages || (budget.maxWeight !== undefined && weight + w > budget.maxWeight && shown > 0);
      if (over && shown > requiredThrough) break;
      shown++;
      weight += w;
      fromSeq = seq;
    }
    return { fromSeq, shown, hidden: rows.length - shown, weight };
  }

  around(roomId: string, seq: number, window: number): StoredMessage[] {
    const w = Math.max(0, Math.floor(window));
    return (this.db.prepare("select body from messages where room = ? and deleted_at is null and seq between ? and ? order by seq").all(roomId, seq - w, seq + w) as Row[]).map((r) => this.decode(r));
  }

  pinned(roomId: string): StoredMessage[] {
    return (this.db.prepare(`select body from messages where room = ? and deleted_at is null and pinned = 1 order by ${ORDER_KEY}, seq`).all(roomId) as Row[]).map((r) => this.decode(r));
  }

  maxSeq(roomId: string): number {
    return Number((this.db.prepare("select coalesce(max(seq), 0) as n from messages where room = ?").get(roomId) as Row).n);
  }


  private migrationKey(roomId: string): string {
    return `migrated:${roomId}`;
  }

  migration(roomId: string): MigrationMark | null {
    const raw = this.meta(this.migrationKey(roomId));
    return raw ? (JSON.parse(raw) as MigrationMark) : null;
  }

  migrateRoom(roomId: string, files: { jsonl: string; deleted?: string }): MigrationMark {
    const failedKey = `migration-failed:${roomId}`;
    try {
      return this.migrateRoomOnce(roomId, files, failedKey);
    } catch (error) {
      if (this.meta(failedKey) === null) this.setMeta(failedKey, JSON.stringify({ at: Date.now(), maxSeq: this.maxSeq(roomId) }));
      throw error;
    }
  }

  private migrateRoomOnce(roomId: string, files: { jsonl: string; deleted?: string }, failedKey: string): MigrationMark {
    return this.transaction(() => {
      const at = Date.now();
      let imported = 0;
      let marked = 0;
      let size = 0;
      let mtimeMs = 0;
      let skipped = 0;
      let source: MigrationMark["source"] = "none";
      if (existsSync(files.jsonl)) {
        const stat = statSync(files.jsonl);
        size = stat.size;
        mtimeMs = stat.mtimeMs;
        const live: StoredMessage[] = [];
        for (const line of readFileSync(files.jsonl, "utf8").split("\n")) {
          if (!line.trim()) continue;
          try {
            const record = JSON.parse(line) as StoredMessage;
            if (typeof record.id === "string" && typeof record.seq === "number" && typeof record.kind === "string") live.push(record);
            else skipped++;
          } catch {
            skipped++;
          }
        }
        if (size > 0 && !live.length) throw new Error(`history.jsonl has ${size} bytes but not one readable message (${skipped} unreadable lines); not moved`);
        const failed = this.meta(failedKey);
        const result = this.reconcile(roomId, live, at, failed ? { markUpToSeq: (JSON.parse(failed) as { maxSeq: number }).maxSeq } : {});
        imported = result.upserted;
        marked = result.marked;
        if (files.deleted && existsSync(files.deleted)) this.importDeletedJsonl(roomId, files.deleted);
        source = "jsonl";
      } else if (this.count(roomId, { includeDeleted: true }) > 0) {
        source = "mirror";
      }
      const mark: MigrationMark = { at, source, skipped, size, mtimeMs, imported, marked };
      if (source === "mirror") return mark;
      this.setMeta(this.migrationKey(roomId), JSON.stringify(mark));
      this.deleteMeta(failedKey);
      return mark;
    });
  }

  adoptMirror(roomId: string): MigrationMark {
    return this.transaction(() => {
      if (this.migration(roomId)) throw new Error("this room's record is already settled");
      const at = Date.now();
      const mark: MigrationMark = { at, source: "mirror", skipped: 0, size: 0, mtimeMs: 0, imported: 0, marked: 0, confirmedAt: at };
      this.setMeta(this.migrationKey(roomId), JSON.stringify(mark));
      this.deleteMeta(`migration-failed:${roomId}`);
      return mark;
    });
  }

  sourceChangedSince(roomId: string, jsonl: string): boolean {
    const mark = this.migration(roomId);
    if (!mark || !existsSync(jsonl)) return false;
    const stat = statSync(jsonl);
    return stat.size !== mark.size || Math.abs(stat.mtimeMs - mark.mtimeMs) > 1;
  }


  applyOp(roomId: string, op: DivertOp): "applied" | "skipped" {
    return this.transaction(() => {
      if (this.db.prepare("select 1 from applied_ops where op_id = ?").get(op.opId)) return "skipped";
      if (op.kind === "upsert") this.upsert(roomId, op.message);
      else if (op.kind === "rewrite") this.rewrite(roomId, op.message, op.fromSeq, op.deletedAt);
      else this.truncateFrom(roomId, op.fromSeq, op.deletedAt);
      this.db.prepare("insert into applied_ops(op_id, room, applied_at) values (?, ?, ?)").run(op.opId, roomId, Date.now());
      return "applied";
    });
  }

  isApplied(opId: string): boolean {
    return !!this.db.prepare("select 1 from applied_ops where op_id = ?").get(opId);
  }

  appliedOps(roomId: string): number {
    return Number((this.db.prepare("select count(*) as n from applied_ops where room = ?").get(roomId) as Row).n);
  }


  importJsonl(roomId: string, file: string): ImportReport {
    return this.importLines(roomId, readFileSync(file, "utf8").split("\n"), null);
  }

  importDeletedJsonl(roomId: string, file: string): ImportReport {
    return this.importLines(roomId, readFileSync(file, "utf8").split("\n"), Date.now());
  }

  private importLines(roomId: string, lines: string[], deletedFallback: number | null): ImportReport {
    const report: ImportReport = { imported: 0, skipped: 0 };
    let deletedAt = deletedFallback;
    this.transaction(() => {
      for (const line of lines) {
        if (!line.trim()) continue;
        let record: Record<string, unknown>;
        try {
          record = JSON.parse(line) as Record<string, unknown>;
        } catch {
          report.skipped++;
          continue;
        }
        if (deletedFallback !== null && typeof record.deletedAt === "number" && record.id === undefined) {
          deletedAt = record.deletedAt;
          continue;
        }
        if (typeof record.id !== "string" || typeof record.seq !== "number" || typeof record.kind !== "string") {
          report.skipped++;
          continue;
        }
        const message = record as unknown as StoredMessage;
        if (deletedAt === null) {
          this.upsert(roomId, message);
        } else {
          this.db
            .prepare(
              `insert into messages(room, id, seq, display_order, kind, author, author_name, ts, text, pinned, deleted_at, body, features, weight)
               values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               on conflict(room, id) do update set deleted_at = excluded.deleted_at where messages.deleted_at is not null`,
            )
            .run(roomId, message.id, message.seq, message.displayOrder ?? null, message.kind, message.from ?? null, message.fromName ?? null, message.ts, message.text ?? "", message.pinned ? 1 : 0, deletedAt, JSON.stringify(message), JSON.stringify(messageFeatures(message)), messageWeight(messageFeatures(message)));
        }
        report.imported++;
      }
    });
    return report;
  }

  exportJsonl(roomId: string): string {
    const rows = this.db.prepare("select body from messages where room = ? and deleted_at is null order by seq").all(roomId) as Row[];
    return rows.map((r) => String(r.body)).join("\n") + (rows.length ? "\n" : "");
  }

  exportMarkdown(roomId: string, roomName = roomId): string {
    const lines: string[] = [`# ${roomName}`, ""];
    for (const m of this.all(roomId)) {
      if (m.kind === "hidden") continue;
      const when = new Date(m.ts).toISOString().replace("T", " ").slice(0, 16);
      if (m.kind === "system") {
        lines.push(`> · ${m.text}  `, `> _${when}_`, "");
        continue;
      }
      const to = m.toNames?.length ? ` → @${m.toNames.join(" @")}` : "";
      lines.push(`## #${m.seq} · ${m.fromName}${to} · ${when}${m.pinned ? " · 📌" : ""}${m.edited ? " · edited" : ""}`, "", m.text, "");
    }
    return lines.join("\n");
  }


  agentSearchCount(roomId: string, kinds: Array<"chat" | "system">): number {
    return Number((this.db.prepare(`select count(*) as n from messages m where m.room = ? and ${AGENT_VISIBLE_SQL} and m.kind in (${placeholders(kinds.length)})`).get(roomId, ...kinds) as Row).n);
  }

  agentSearchContext(roomId: string, seq: number, kinds: Array<"chat" | "system">): StoredMessage[] {
    const where = `m.room = ? and ${AGENT_VISIBLE_SQL} and m.kind in (${placeholders(kinds.length)})`;
    const before = this.db.prepare(`select body from messages m where ${where} and seq < ? order by seq desc limit 2`).all(roomId, ...kinds, seq) as Row[];
    const after = this.db.prepare(`select body from messages m where ${where} and seq >= ? order by seq limit 3`).all(roomId, ...kinds, seq) as Row[];
    return [...before.reverse(), ...after].map((r) => this.decode(r));
  }

  search(query: SearchQuery): SearchResult {
    const sanitized = sanitizeQuery(query.text);
    if (!sanitized) return { hits: [], query: sanitized, usedTrigram: false };
    let hits = this.match("messages_fts", sanitized, query, true);
    if (hits === null) {
      hits = this.match("messages_fts", quoteEverything(query.text), query, true);
      if (hits === null) throw new Error("the conversation search could not execute the query");
    }
    let usedTrigram = false;
    if (!hits.length && !hasOperators(sanitized)) {
      const substring = trigramQuery(query.text);
      if (substring) {
        const viaTrigram = this.match("messages_trigram", substring, query, false);
        if (viaTrigram === null) throw new Error("the conversation substring search could not execute the query");
        if (viaTrigram && viaTrigram.length) {
          hits = viaTrigram;
          usedTrigram = true;
        }
      }
    }
    return { hits, query: sanitized, usedTrigram };
  }

  private match(table: "messages_fts" | "messages_trigram", ftsQuery: string, query: SearchQuery, withAuthor: boolean): SearchHit[] | null {
    const kinds = query.kinds?.length ? query.kinds : ["chat"];
    const where: string[] = [`${table} match ?`, `m.kind in (${placeholders(kinds.length)})`];
    const params: unknown[] = [ftsQuery, ...kinds];
    if (!query.includeDeleted) where.push("m.deleted_at is null");
    if (query.agentVisible) where.push(AGENT_VISIBLE_SQL);
    if (query.rooms?.length) {
      where.push(`m.room in (${placeholders(query.rooms.length)})`);
      params.push(...query.rooms);
    }
    if (query.author) {
      where.push("unicode_lower(m.author_name) = ?");
      params.push(query.author.toLowerCase());
    }
    const rankExpr = withAuthor ? `bm25(${table}, 1.0, 0.4)` : `bm25(${table})`;
    const order = query.sort === "newest" ? "m.ts desc, rank" : query.sort === "oldest" ? "m.ts asc, rank" : "rank";
    const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 20)), 200);
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const base = `select m.room, m.id, m.seq, m.kind, m.author, m.author_name, m.ts, m.body, m.deleted_at,
        snippet(${table}, 0, '[', ']', '…', 12) as snippet, ${rankExpr} as rank
      from ${table} join messages m on m.rowid = ${table}.rowid where ${where.join(" and ")}`;
    const sql = query.perRoom
      ? `with ranked as (select *, row_number() over (partition by room order by rank) as rn, min(rank) over (partition by room) as best from (${base}))
         select * from ranked where rn <= ? order by ${query.sort && query.sort !== "rank" ? order.replace(/m\./g, "") : "best, rank"} limit ? offset ?`
      : `${base} order by ${order} limit ? offset ?`;
    params.push(...(query.perRoom ? [Math.max(1, Math.floor(query.perRoom))] : []), limit, offset);
    let rows: Row[];
    try {
      rows = this.db.prepare(sql).all(...(params as never[])) as Row[];
    } catch (error) {
      if (/fts5: syntax error|unterminated string|malformed MATCH|no such column:/i.test(String(error))) return null;
      throw error;
    }
    return rows.map((r) => {
      const body = this.decode(r);
      return {
        roomId: String(r.room),
        seq: Number(r.seq),
        id: String(r.id),
        kind: body.kind,
        from: body.from,
        fromName: body.fromName,
        toNames: body.toNames ?? [],
        ts: Number(r.ts),
        snippet: String(r.snippet),
        rank: Number(r.rank),
        deleted: r.deleted_at !== null && r.deleted_at !== undefined,
      };
    });
  }


  async backup(toPath: string): Promise<void> {
    await sqliteBackup(this.db, toPath);
    this.setMeta("last_backup_at", String(Date.now()));
  }

  close(): void {
    try {
      this.db.close();
    } catch (error) {
      this.log.warn(`history.db did not close cleanly: ${String(error)}`);
    }
  }
}

function quoteEverything(raw: string): string {
  return (raw.match(QUERY_TOKEN) ?? [])
    .map((t) => t.replace(/"/g, "").replace(/\*$/, "").trim())
    .filter(Boolean)
    .map((w) => `"${w}"`)
    .join(" ");
}
