// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { DatabaseSync, backup as sqliteBackup, type StatementSync } from "node:sqlite";
import { CarryHistory, carryHash, type CarryRevision } from "./carry-history.js";
import type { PortableMemoryRepair } from "./memory/carry.js";
import { memoryVersion } from "./memory/version.js";
import { visibleToAgents } from "./quotes.js";
import { SharedMemory } from "./shared-memory.js";
import { MemoryOutbox } from "./memory/outbox.js";
import { systemClock, type MemoryClock } from "./memory/clock.js";
import { IngestionDebugStore } from "./memory/ingestion-debug.js";
import { RoomCards } from "./room-cards.js";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { renameWithRetry } from "./atomic.js";
import type { ChatMessage } from "./room.js";
import { Logger } from "./log.js";
import { TimedDatabase, type TimedStatement } from "./timed-db.js";
import { openObservedTestDatabase } from "./owned-native-test-resources.js";
import type { NameUse } from "./name-directory.js";
import { NativeReportError, nativeDataHash, nativeInteger, nativeObligationTransition, parseNativeDecision,
  parseNativeEnvelope, parseNativeHoldReason, parseNativeOperation, parseNativeRecord, parseNativeSubject,
  type NativeDecision, type NativeDivertOp, type NativeEnvelope, type NativeHoldReason, type NativeObligation, type NativeObligationPhase,
  type NativePendingOp, type NativeReceipt, type NativeRecord, type NativeSubject } from "./native-reports.js";

export const HISTORY_DB_FILE = "history.db";

export function storeOpenFailure(error: unknown): Error {
  return new Error(`the conversation store could not be opened (${error instanceof Error ? error.message : String(error)}); viberoom needs Node 22.16 or newer with node:sqlite`);
}

export type HistoryUpgradeStep =
  | { step: "copy"; file: string; bytes: number }
  | { step: "upgrade" }
  | { step: "fill"; done: number; total: number };

export interface HistoryUpgradeWatch {
  onStep?(step: HistoryUpgradeStep): void;
}

const HALF_COPY = ".partial";
const FILL_STEP = 2_000;

function storeBytes(path: string): number {
  let bytes = 0;
  for (const file of [path, `${path}-wal`]) {
    try { bytes += statSync(file).size; } catch { }
  }
  return bytes;
}

const HALF_COPY_NAME = /^\d+-\d+\.bak\.partial(-journal|-wal|-shm)?$/;

function removeHalfCopies(store: string): void {
  const folder = dirname(store);
  const prefix = `${basename(store)}.before-schema-`;
  let names: string[];
  try { names = readdirSync(folder); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(prefix) || !HALF_COPY_NAME.test(name.slice(prefix.length))) continue;
    try { rmSync(join(folder, name), { force: true }); } catch { }
  }
}
export const SCHEMA_VERSION = 4;

export function newerFormatMessage(): string {
  return [
    "This viberoom is older than your rooms.",
    "The rooms in this folder were last opened by a newer viberoom, and an older one cannot read them without damaging them. Nothing has been changed.",
    "Open the newer viberoom instead, or update this one.",
  ].join(String.fromCharCode(10));
}

export function readDataFormat(dataDir: string): number {
  const path = join(dataDir, HISTORY_DB_FILE);
  if (!existsSync(path)) return 0;
  const db = openObservedTestDatabase(path, { readOnly: true });
  try {
    if (!db.prepare("select name from sqlite_master where type = 'table' and name = 'meta'").get()) return 0;
    const row = db.prepare("select value from meta where key = 'schema_version'").get() as { value?: unknown } | undefined;
    const version = Number(row?.value ?? 0);
    return Number.isInteger(version) && version >= 0 ? version : 0;
  } finally {
    db.close();
  }
}

const AGENT_VISIBLE_SQL = "m.deleted_at is null and m.kind in ('chat','system') and coalesce(json_extract(m.body, '$.audience'), '') != 'human'";

export type StoredMessage = ChatMessage;

export interface SearchQuery {
  text: string;
  rooms?: string[];
  kinds?: Array<"chat" | "system">;
  authors?: { roomId: string; id: string }[];
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
  audio?: number;
  video?: number;
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
    audio: message.audio?.length ?? 0,
    video: message.video?.length ?? 0,
    toolCalls: message.toolCalls?.length ?? 0,
    quotes: message.quotes?.length ?? 0,
  };
}

export function searchableText(message: StoredMessage): string {
  return [message.text ?? "", ...(message.audio ?? []).map((sound) => sound.words ?? "")].filter(Boolean).join("\n");
}

export function messageWeight(features: MessageFeatures): number {
  return features.chars + 120 * features.tableRows + 400 * features.fences + 2500 * features.diagrams + 1500 * features.images + 800 * (features.audio ?? 0) + 2500 * (features.video ?? 0) + 400 * features.toolCalls + 200 * features.quotes;
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

const LATER_APPLIED_COLUMNS: Array<[string, string]> = [
  ["message_id", "text"],
  ["seq", "integer"],
  ["kind", "text"],
  ["payload_hash", "text"],
];

export type LegacyPendingOp = (
  | { kind: "upsert"; message: StoredMessage }
  | { kind: "truncate"; fromSeq: number; deletedAt: number }
  | { kind: "bury"; ids: string[]; deletedAt: number }
  | { kind: "rewrite"; fromSeq: number; deletedAt: number; message: StoredMessage }
) & {
  opId?: string;
  accept?: true;
};
export type PendingOp = LegacyPendingOp | NativePendingOp;
export type DivertOp = PendingOp & { opId: string };

export interface AppliedReceipt {
  messageId: string;
  seq: number;
}

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
create index if not exists idx_messages_room_author on messages(room, author, author_name);
create table if not exists native_reports(
  room_uuid text not null,
  id text not null,
  room_address text not null,
  participant text not null,
  accept_order integer not null check(accept_order > 0),
  generation integer not null check(generation >= 0),
  state text not null check(state in ('pending','held','published','consumed','tombstoned')),
  state_revision integer not null check(state_revision >= 0),
  delivery_pending integer not null default 1 check(delivery_pending in (0,1)),
  body text not null,
  primary key(room_uuid,id),
  unique(room_uuid,accept_order)
);
create index if not exists idx_native_reports_pending on native_reports(room_address,participant,state,accept_order);
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

export function andedTerms(sanitized: string): number {
  if (/(^|\s)(OR|NOT)(\s|$)/.test(sanitized)) return 0;
  return (sanitized.match(/"[^"]*"/g) ?? []).length;
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
  private readonly db: TimedDatabase;
  private upsertStatement: TimedStatement | undefined;
  private bodyStatement: TimedStatement | undefined;
  private readonly log: Logger;
  readonly carry: CarryHistory;
  readonly memory: SharedMemory;
  readonly memoryOutbox: MemoryOutbox;
  readonly memoryDebug: IngestionDebugStore;
  readonly cards: RoomCards;

  constructor(readonly path: string, log?: Logger, private readonly upgrade: HistoryUpgradeWatch = {}, clock: MemoryClock = systemClock) {
    this.log = log ?? new Logger("history");
    this.db = TimedDatabase.open(path);
    this.db.function("unicode_lower", { deterministic: true }, (value) => typeof value === "string" ? value.toLowerCase() : null);
    this.db.exec("pragma journal_mode = wal");
    this.db.exec("pragma synchronous = full");
    this.db.exec("pragma foreign_keys = on");
    this.db.exec("pragma busy_timeout = 5000");
    this.refuseIfNewer();
    this.backupBeforeUpgrade();
    this.db.exec("begin immediate");
    this.transactionDepth++;
    try {
      this.db.exec(SCHEMA);
      this.db.exec("create table if not exists file_transactions(id text primary key)");
      this.carry = new CarryHistory(this.db);
      this.memory = new SharedMemory(this.db);
      this.memoryOutbox = new MemoryOutbox(this.db, clock);
      this.memoryDebug = new IngestionDebugStore(this.db, Date.now, (room, id) => {
        const row = this.db.prepare("select body from messages where room=? and id=? and deleted_at is null").get(room, id);
        return row ? { fingerprint: memoryVersion(JSON.parse(String(row.body)) as StoredMessage), revision: this.carry.head(room, id)?.revision ?? null } : null;
      });
      this.cards = new RoomCards(this.db);
      this.reconcileColumns();
      this.reconcileNativeDeliveryIndex();
      const version = this.meta("schema_version");
      if (version === null || Number(version) < SCHEMA_VERSION) this.setMeta("schema_version", String(SCHEMA_VERSION));
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      this.db.close();
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }

  private refuseIfNewer(): void {
    const table = this.db.prepare("select name from sqlite_master where type = 'table' and name = 'meta'").get();
    if (!table) return;
    const row = this.db.prepare("select value from meta where key = 'schema_version'").get() as Row | undefined;
    const version = row ? Number(row.value) : 0;
    if (!(version > SCHEMA_VERSION)) return;
    this.log.error(`refusing ${this.path}: schema ${version}, this build knows ${SCHEMA_VERSION}`);
    this.db.close();
    throw new Error(newerFormatMessage());
  }

  private backupBeforeUpgrade(): void {
    if (!this.db.prepare("select name from sqlite_master where type = 'table' and name = 'meta'").get()) return;
    const row = this.db.prepare("select value from meta where key = 'schema_version'").get() as Row | undefined;
    if (!row || Number(row.value) >= SCHEMA_VERSION || this.path === ":memory:") return;
    const destination = `${this.path}.before-schema-${SCHEMA_VERSION}-${Date.now()}.bak`;
    const half = `${destination}${HALF_COPY}`;
    removeHalfCopies(this.path);
    this.upgrade.onStep?.({ step: "copy", file: half, bytes: storeBytes(this.path) });
    try {
      this.db.prepare("vacuum into ?").run(half);
      if (!renameWithRetry(half, destination)) throw new Error(`the system kept ${basename(half)} from being named ${basename(destination)}`);
    } catch (error) {
      for (const file of [half, `${half}-journal`]) {
        try { rmSync(file, { force: true }); } catch { }
      }
      this.db.close();
      throw new Error("Could not back up the conversation store before upgrading it. The upgrade was not applied.", { cause: error });
    }
    this.upgradeBackup = basename(destination);
    this.upgrade.onStep?.({ step: "upgrade" });
  }

  upgradeBackup: string | null = null;

  private reconcileColumns(): void {
    const appliedHave = new Set((this.db.prepare("pragma table_info(applied_ops)").all() as Row[]).map((r) => String(r.name)));
    for (const [name, type] of LATER_APPLIED_COLUMNS) if (!appliedHave.has(name)) this.db.exec(`alter table applied_ops add column ${name} ${type}`);
    const have = new Set((this.db.prepare("pragma table_info(messages)").all() as Row[]).map((r) => String(r.name)));
    const added = LATER_COLUMNS.filter(([name]) => !have.has(name));
    if (!added.length) return;
    for (const [name, type] of added) this.db.exec(`alter table messages add column ${name} ${type}`);
    this.transaction(() => {
      const fill = this.db.prepare("update messages set features = ?, weight = ? where rowid = ?");
      const rows = this.db.prepare("select rowid, body from messages").all() as Row[];
      this.upgrade.onStep?.({ step: "fill", done: 0, total: rows.length });
      rows.forEach((row, at) => {
        const features = messageFeatures(this.decode(row));
        fill.run(JSON.stringify(features), messageWeight(features), row.rowid as number);
        if ((at + 1) % FILL_STEP === 0 || at + 1 === rows.length) this.upgrade.onStep?.({ step: "fill", done: at + 1, total: rows.length });
      });
    });
    this.log.info(`history.db: added ${added.map(([n]) => n).join(", ")} and filled the existing rows`);
  }

  private reconcileNativeDeliveryIndex(): void {
    const version = this.meta("schema_version");
    const upgrading = version === null || Number(version) < SCHEMA_VERSION;
    this.transaction(() => {
      const columns = this.db.prepare("pragma table_info(native_reports)").all() as Row[];
      if (!columns.some(row => row.name === "delivery_pending")) {
        if (!upgrading) throw new NativeReportError("native_state_corrupt", "The native delivery index column is missing.");
        this.db.exec("alter table native_reports add column delivery_pending integer not null default 1 check(delivery_pending in (0,1))");
      }
      if (upgrading) {
        const fill = this.db.prepare("update native_reports set delivery_pending = ? where room_uuid = ? and id = ?");
        for (const row of this.db.prepare("select * from native_reports order by room_uuid,accept_order,id").all() as Row[]) {
          const record = this.decodeNative(row, false);
          fill.run(this.nativeDeliveryPending(record), row.room_uuid as string, row.id as string);
        }
      }
      this.db.exec(`create index if not exists idx_native_delivery_room on native_reports(room_address,accept_order,room_uuid,id) where delivery_pending = 1;
        create index if not exists idx_native_delivery_author on native_reports(room_address,participant,accept_order,room_uuid,id) where delivery_pending = 1`);
      if (upgrading) this.setMeta("schema_version", String(SCHEMA_VERSION));
    });
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

  assertTransactionSettled(): void {
    if (this.db.isTransaction !== false) throw new Error("transaction_outcome_unknown: the SQLite transaction is still open");
  }

  markFileTransaction(id: string): void { this.db.prepare("insert into file_transactions(id) values (?)").run(id); }
  hasFileTransaction(id: string): boolean {
    this.assertTransactionSettled();
    return !!this.db.prepare("select 1 from file_transactions where id = ?").get(id);
  }
  forgetFileTransaction(id: string): void { this.db.prepare("delete from file_transactions where id = ?").run(id); }

  transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) return work();
    this.assertTransactionSettled();
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


  importMemoryRepair(room: string, uuid: string, repair: PortableMemoryRepair | undefined,
    states: readonly { message: StoredMessage; deletedAt: number | null; head: { revision: string } }[],
    revisions: ReadonlyMap<string, CarryRevision>, aliases: readonly string[]): void {
    if (repair) this.memoryOutbox.carry.merge(room, repair);
    else {
      const unknown = states.filter(s => {
        if (s.message.kind !== "chat") return false;
        const previous = this.getById(room, s.message.id, true);
        if (previous) return memoryVersion(previous) !== memoryVersion(s.message) ||
          (this.getById(room, s.message.id) === null) !== (s.deletedAt !== null);
        return s.deletedAt !== null || !!s.message.edited || !!revisions.get(s.head.revision)?.parents.length;
      }).map(s => s.message.id);
      this.memoryOutbox.carry.rememberUnknown(room, unknown);
    }
    this.memoryOutbox.carry.activateKnown(room, uuid, aliases);
  }

  upsert(roomId: string, message: StoredMessage, options: { track?: boolean } = {}): void {
    const write = () => {
    const version = memoryVersion(message);
    const before = (this.bodyStatement ??= this.db.prepare("select body,deleted_at from messages where room=? and id=?")).get(roomId, message.id);
    const previous = before ? JSON.parse(String(before.body)) as StoredMessage : null;
    if (previous) this.upgradeMemoryVersions(roomId, message.id);
    const changed = !previous || before!.deleted_at !== null || memoryVersion(previous) !== version;
    if (options.track === false) this.memoryOutbox.importSource(roomId, message.id, version);
    else if (changed) {
      this.memoryOutbox.localSource(roomId, message.id);
      this.memoryOutbox.sourceChanged(roomId, message.id, version);
    }
    if (changed && this.memoryDebug.hasSource(roomId, message.id)) this.memoryDebug.forgetMessages(roomId, [message.id]);
    if (options.track !== false) {
      if (previous && !this.carry.head(roomId, message.id)) this.carry.ensure(roomId, previous, before!.deleted_at === null ? null : Number(before!.deleted_at));
      this.carry.record(roomId, message);
      if (changed && message.kind === "chat") this.memoryOutbox.markOwnVersion(roomId, message.id, version);
      if (changed && previous && message.kind === "chat" && !message.streaming && visibleToAgents(message)) this.memoryOutbox.localVersion(roomId, message.id, version, Date.now());
    } else if (message.kind === "chat") {
      this.memoryOutbox.queueVersionCheck(roomId, message.id, Date.now());
    }
    const features = messageFeatures(message);
    (this.upsertStatement ??= this.db.prepare(
        `insert into messages(room, id, seq, display_order, kind, author, author_name, ts, text, pinned, body, features, weight)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(room, id) do update set
           seq = excluded.seq, display_order = excluded.display_order, kind = excluded.kind, author = excluded.author,
           author_name = excluded.author_name, ts = excluded.ts, text = excluded.text, pinned = excluded.pinned, body = excluded.body,
           features = excluded.features, weight = excluded.weight, deleted_at = null`,
      ))
      .run(
        roomId,
        message.id,
        message.seq,
        message.displayOrder ?? null,
        message.kind,
        message.from ?? null,
        message.fromName ?? null,
        message.ts,
        searchableText(message),
        message.pinned ? 1 : 0,
        JSON.stringify(message),
        JSON.stringify(features),
        messageWeight(features),
      );
    };
    if (this.transactionDepth) write();
    else this.transaction(write);
  }

  upgradeMemoryVersions(roomId?: string, sourceId?: string): void {
    const write = () => {
      const filter = roomId === undefined ? "" : " and m.room=? and m.id=?";
      const args = roomId === undefined ? [] : [roomId, sourceId!];
      const rows = this.db.prepare(`select d.op_id,d.identity,m.body from memory_delivery d join messages m
        on m.room=json_extract(d.identity,'$.roomId') and m.id=d.source_id
        where d.provider='zep' and d.retired_at is null and d.source_version is null and m.deleted_at is null
          and json_extract(d.identity,'$.kind')='episode' and json_extract(d.payload,'$.request.metadata.schema')=2
          and json_extract(d.payload,'$.binding.source.kind')='message'${filter}`).all(...args);
      const project = this.db.prepare("update memory_delivery set source_version=? where op_id=? and source_version is null");
      for (const row of rows) {
        const message = JSON.parse(String(row.body)) as StoredMessage, identity = JSON.parse(String(row.identity)) as { version: string };
        if (`sha256:${carryHash(message)}` === identity.version) project.run(memoryVersion(message), String(row.op_id));
      }
      const bindings = this.db.prepare(`select s.provider,s.room,s.source_id,s.external_id,s.source,m.body from memory_episode_source s join messages m
        on m.room=s.room and m.id=s.source_id where s.provider='zep' and m.deleted_at is null
          and json_extract(s.source,'$.kind')='message'${filter}`).all(...args);
      const projectBinding = this.db.prepare("update memory_episode_source set source=json_set(source,'$.version',?) where provider=? and room=? and source_id=? and external_id=?");
      for (const row of bindings) {
        const message = JSON.parse(String(row.body)) as StoredMessage, source = JSON.parse(String(row.source)) as { version?: string };
        if (`sha256:${carryHash(message)}` === source.version) projectBinding.run(memoryVersion(message), String(row.provider), String(row.room), String(row.source_id), String(row.external_id));
      }
    };
    if (this.transactionDepth) write();
    else this.transaction(write);
  }

  markOwnVersionsOnce(folderId: string): void {
    if (this.meta("memory_own_versions") !== null) return;
    this.transaction(() => {
      const page = this.db.prepare("select rowid, room, body from messages where rowid > ? and deleted_at is null and kind = 'chat' order by rowid limit 1000");
      for (let after = 0; ;) {
        const rows = page.all(after) as Row[];
        if (!rows.length) break;
        for (const row of rows) {
          const message = JSON.parse(String(row.body)) as StoredMessage;
          if ((message.numbering ?? message.origin) === folderId) this.memoryOutbox.markOwnVersion(String(row.room), message.id, memoryVersion(message));
        }
        after = Number(rows.at(-1)!.rowid);
      }
      this.setMeta("memory_own_versions", "1");
    });
  }

  knowsCarried(roomId: string, id: string, carryHash: string): boolean {
    return carryHash.startsWith("sha256:") && this.carry.knows(roomId, id, carryHash.slice("sha256:".length));
  }

  carriedRelation(roomId: string, id: string, hash: string): "current" | "ancestor" | "unknown" {
    const head = this.carry.head(roomId, id);
    if (!head || !hash.startsWith("sha256:")) return "unknown";
    if (head.hash === hash.slice(7)) return "current";
    return this.knowsCarried(roomId, id, hash) ? "ancestor" : "unknown";
  }

  carriedRevision(roomId: string, id: string): string | null { return this.carry.head(roomId, id)?.revision ?? null; }

  earliestRemembered(roomId: string, provider: string, folderId: string): number | null {
    const row = this.db.prepare(`select min(m.ts) as ts from messages m where m.room = ? and json_extract(m.body, '$.origin') = ?
      and (exists (select 1 from memory_episode_map e where e.provider = ? and e.room = m.room and e.source_id = m.id)
        or exists (select 1 from memory_delivery d where d.provider = ? and d.source_id = m.id and json_extract(d.identity, '$.roomId') = m.room))`)
      .get(roomId, folderId, provider, provider) as Row | undefined;
    return row?.ts === null || row?.ts === undefined ? null : Number(row.ts);
  }

  upsertMany(roomId: string, messages: StoredMessage[]): void {
    this.transaction(() => {
      for (const m of messages) this.upsert(roomId, m);
    });
  }

  applyCarriedStates(roomId: string, states: readonly { message: StoredMessage; deletedAt: number | null }[]): void {
    this.transaction(() => {
      const before = this.db.prepare("select body, deleted_at from messages where room = ? and id = ?");
      const destructive = states.some(state => {
        const row = before.get(roomId, state.message.id) as Row | undefined;
        return !!row && carryHash(this.decode(row), row.deleted_at === null ? null : Number(row.deleted_at))
          !== carryHash(state.message, state.deletedAt);
      });
      if (destructive) this.advanceNativeGeneration(roomId);
      for (const state of states) {
        this.upsert(roomId, state.message, { track: false });
        if (state.deletedAt !== null) this.markDeleted(roomId, [state.message.id], state.deletedAt, { track: false });
      }
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
    return this.transaction(() => {
      this.advanceNativeGeneration(roomId);
      const ids = this.db.prepare("select id from messages where room=? and seq>? and deleted_at is null").all(roomId, fromSeq).map(r => String(r.id));
      return this.markDeleted(roomId, ids, deletedAt);
    });
  }

  rewrite(roomId: string, message: StoredMessage, fromSeq: number, deletedAt = Date.now()): number {
    return this.transaction(() => {
      const marked = this.truncateFrom(roomId, fromSeq, deletedAt);
      this.upsert(roomId, message);
      return marked;
    });
  }

  markDeleted(roomId: string, ids: string[], deletedAt = Date.now(), options: { track?: boolean } = {}): number {
    if (!ids.length) return 0;
    return this.transaction(() => {
      this.memoryDebug.forgetMessages(roomId, ids);
      for (const id of ids) {
        if (options.track === false) {
          const imported = this.getById(roomId, id, true);
          if (imported) this.memoryOutbox.importSource(roomId, id, memoryVersion(imported));
        }
        else {
          this.memoryOutbox.localSource(roomId, id);
          this.memoryOutbox.sourceChanged(roomId, id);
        }
      }
      let changed = 0;
      for (let start = 0; start < ids.length; start += 500) {
        const batch = ids.slice(start, start + 500);
        if (options.track !== false) for (const row of this.db.prepare(`select body from messages where room=? and id in (${placeholders(batch.length)}) and deleted_at is null`).all(roomId, ...batch)) {
          const message = JSON.parse(String(row.body)) as ChatMessage;
          this.carry.ensure(roomId, message);
          this.carry.record(roomId, message, deletedAt);
        }
        changed += this.db.prepare(`update messages set deleted_at = ? where room = ? and id in (${placeholders(batch.length)}) and deleted_at is null`).run(deletedAt, roomId, ...batch).changes as number;
        for (const row of this.db.prepare(`select * from native_reports where room_address = ? and id in (${placeholders(batch.length)})`).all(roomId, ...batch) as Row[]) {
          this.tombstoneNativeRecord(this.decodeNative(row), nativeInteger(deletedAt));
        }
      }
      return changed;
    });
  }

  dropRoomPortion(roomId: string, limit: number): number {
    this.memoryDebug.forgetRoom(roomId);
    this.memoryOutbox.episodeIndex.dropRoom(roomId);
    this.memoryOutbox.deliveries.detachLocal(roomId);
    return this.transaction(() => Number(this.db.prepare("delete from messages where rowid in (select rowid from messages where room = ? limit ?)").run(roomId, limit).changes));
  }

  dropRoom(roomId: string): void {
    this.transaction(() => {
      this.memoryOutbox.episodeIndex.dropRoom(roomId);
      this.memoryOutbox.deliveries.detachLocal(roomId);
      this.memoryDebug.forgetRoom(roomId);
      const uuids = this.db.prepare("select distinct room_uuid from native_reports where room_address = ?").all(roomId) as Row[];
      this.db.prepare("delete from native_reports where room_address = ?").run(roomId);
      for (const row of uuids) this.deleteMeta(`native-order:${String(row.room_uuid)}`);
      this.advanceNativeGeneration(roomId);
      this.db.prepare("delete from messages where room = ?").run(roomId);
      this.carry.drop(roomId);
      this.memoryOutbox.carry.dropRoom(roomId);
      this.cards.drop(roomId);
    });
  }


  private decode(row: Row): StoredMessage {
    return JSON.parse(String(row.body)) as StoredMessage;
  }

  count(roomId: string, options: { includeDeleted?: boolean } = {}): number {
    const row = this.db.prepare(`select count(*) as n from messages where room = ?${options.includeDeleted ? "" : " and deleted_at is null"}`).get(roomId) as Row;
    return Number(row.n);
  }

  indexableCount(): number {
    return Number((this.db.prepare("select count(*) as n from messages where kind in ('chat', 'system')").get() as Row).n);
  }

  indexedCount(): number {
    return Number((this.db.prepare("select count(*) as n from messages_fts_docsize").get() as Row).n);
  }

  participantIds(roomId: string): Set<string> {
    const rows = this.db.prepare(
      `select author as id from messages where room = ? and author is not null
       union select t.value as id from messages m, json_each(m.body, '$.to') t where m.room = ?`,
    ).all(roomId, roomId) as Row[];
    return new Set(rows.map((r) => String(r.id)));
  }

  nameUses(roomIds: string[]): NameUse[] {
    if (!roomIds.length) return [];
    const inRooms = `room in (${placeholders(roomIds.length)})`;
    const written = this.db.prepare(
      `select room, author, author_name, min(ts) as first, max(ts) as last from messages
        where ${inRooms} and kind = 'chat' and author is not null and author_name is not null and author_name != ''
        group by room, author, author_name`,
    ).all(...roomIds) as Row[];
    const renamed = this.db.prepare(
      `select room, ts, json_extract(body, '$.details.renamed') as renamed from messages
        where ${inRooms} and kind = 'system' and json_extract(body, '$.details.renamed.id') is not null`,
    ).all(...roomIds) as Row[];
    const uses: NameUse[] = written.map((r) => ({ roomId: String(r.room), id: String(r.author), name: String(r.author_name), first: Number(r.first), last: Number(r.last) }));
    for (const r of renamed) {
      const { id, from, to } = JSON.parse(String(r.renamed)) as { id: string; from: string; to: string };
      const at = Number(r.ts);
      uses.push({ roomId: String(r.room), id, name: from, first: at, last: at }, { roomId: String(r.room), id, name: to, first: at, last: at });
    }
    return uses;
  }

  rooms(): string[] {
    return (this.db.prepare("select distinct room from messages order by room").all() as Row[]).map((r) => String(r.room));
  }

  privateTrialNamespaceUnused(identities: readonly string[]): boolean {
    if (!identities.length || new Set(identities).size !== identities.length || identities.some(id => !id || /[\u0000-\u001f]/u.test(id))) return false;
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
    const tables = this.db.prepare("select name from sqlite_schema where type='table' and name not like 'sqlite_%'").all();
    for (const table of tables) {
      const name = String(table.name), columns = this.db.prepare(`pragma table_xinfo(${quote(name)})`).all()
        .filter(column => Number(column.hidden) === 0).map(column => quote(String(column.name)));
      if (!columns.length) continue;
      const cells = columns.map(column => `coalesce(cast(${column} as text),'')`).join(" || char(0) || ");
      if (this.db.prepare(`select 1 from ${quote(name)} where ${identities.map(() => `instr((${cells}),?)>0`).join(" or ")} limit 1`).get(...identities)) return false;
    }
    return true;
  }

  get(roomId: string, seq: number): StoredMessage | null {
    const row = this.db.prepare("select body from messages where room = ? and seq = ? and deleted_at is null").get(roomId, seq) as Row | undefined;
    return row ? this.decode(row) : null;
  }

  hasMessageId(roomId: string, id: string): boolean {
    return !!this.db.prepare("select 1 from messages where room = ? and id = ?").get(roomId, id);
  }

  agentMessageReceipt(roomId: string, id: string): { seq: number; kind: string; deleted: boolean; hash: string | null } | null {
    const row = this.db.prepare("select seq, kind, deleted_at, json_extract(body, '$.details.reportHash') as report_hash from messages where room = ? and id = ?")
      .get(roomId, id) as Row | undefined;
    return row ? { seq: Number(row.seq), kind: String(row.kind), deleted: row.deleted_at !== null,
      hash: typeof row.report_hash === "string" ? row.report_hash : null } : null;
  }

  getById(roomId: string, id: string, includeDeleted = false): StoredMessage | null {
    const row = this.db.prepare(`select body from messages where room=? and id=?${includeDeleted ? "" : " and deleted_at is null"}`).get(roomId, id) as Row | undefined;
    return row ? this.decode(row) : null;
  }


  nativeJournalSafety(roomId: string): boolean {
    this.nativeRoomId(roomId);
    const value = this.meta(`native-journal-safe:${roomId}`);
    if (value === null) return false;
    if (value !== "1") throw new NativeReportError("native_state_corrupt", "The native journal safety marker is unreadable.");
    return true;
  }

  enableNativeJournalSafety(roomId: string): void {
    this.nativeRoomId(roomId);
    this.transaction(() => { this.nativeJournalSafety(roomId); this.setMeta(`native-journal-safe:${roomId}`, "1"); });
  }

  nativeGeneration(roomId: string): number {
    this.nativeRoomId(roomId);
    return this.nativeMetaInteger(`native-generation:${roomId}`);
  }

  advanceNativeGeneration(roomId: string): number {
    this.nativeRoomId(roomId);
    return this.transaction(() => {
      const next = this.nativeNext(this.nativeGeneration(roomId));
      this.setMeta(`native-generation:${roomId}`, String(next));
      for (const row of this.db.prepare("select * from native_reports where room_address = ? and state in ('pending','held')").all(roomId) as Row[]) {
        const record = this.decodeNative(row);
        record.state = "held"; record.holdReason = "stale_generation"; record.stateRevision = this.nativeNext(record.stateRevision);
        this.writeNative(record);
      }
      return next;
    });
  }

  nativeHighWater(roomUuid: string): number {
    this.nativeUuid(roomUuid);
    const meta = this.nativeMetaInteger(`native-order:${roomUuid}`);
    const row = this.db.prepare("select max(accept_order) as n from native_reports where room_uuid = ?").get(roomUuid) as Row;
    const maximum = row.n === null ? 0 : nativeInteger(row.n, 1);
    if (meta !== maximum) throw new NativeReportError("native_state_corrupt", "The native acceptance high-water differs from its retained records.");
    return meta;
  }

  nativeDisplayHighWater(roomId: string): number {
    this.nativeRoomId(roomId);
    const row = this.db.prepare("select coalesce(max(coalesce(display_order,seq)),0) as n from messages where room = ?").get(roomId) as Row;
    return nativeInteger(row.n);
  }

  nativeReceipt(roomId: string, roomUuid: string, id: string): NativeReceipt | null {
    this.nativeRoomId(roomId); this.nativeUuid(roomUuid); this.nativeId(id);
    const row = this.db.prepare("select * from native_reports where room_uuid = ? and id = ?").get(roomUuid, id) as Row | undefined;
    if (row) {
      const record = this.decodeNative(row);
      if (record.envelope.owner.roomId !== roomId) throw new NativeReportError("native_conflict", "The native receipt belongs to another room address.");
      return { type: "native", record };
    }
    const legacy = this.agentMessageReceipt(roomId, id);
    return legacy ? { type: "legacy", receipt: legacy } : null;
  }

  enqueueNative(roomId: string, input: NativeEnvelope): { status: "enqueued" | "duplicate" | "legacy_hash_unknown"; receipt: NativeReceipt } {
    const envelope = parseNativeEnvelope(input);
    if (envelope.owner.roomId !== roomId) throw new NativeReportError("native_conflict", "The native envelope belongs to another room.");
    return this.transaction(() => {
      const previous = this.nativeReceipt(roomId, envelope.owner.roomUuid, envelope.id);
      if (previous) {
        const storedHash = previous.type === "native" ? previous.record.envelope.reportHash : previous.receipt.hash;
        if (storedHash !== null && storedHash !== envelope.reportHash) throw new NativeReportError("native_conflict", "The native ID already names another completed report.");
        if (previous.type === "native" && JSON.stringify(previous.record.envelope.owner) !== JSON.stringify(envelope.owner)) {
          return { status: "duplicate", receipt: previous };
        }
        return { status: storedHash === null ? "legacy_hash_unknown" : "duplicate", receipt: previous };
      }
      if (envelope.owner.generation !== this.nativeGeneration(roomId)) throw new NativeReportError("native_generation_changed", "The native envelope's history generation is no longer current.");
      if (envelope.acceptOrder !== this.nativeNext(this.nativeHighWater(envelope.owner.roomUuid))) throw new NativeReportError("native_conflict", "The native acceptance order is not the next retained ordinal.");
      this.enableNativeJournalSafety(roomId);
      const record: NativeRecord = { envelope, state: "pending", stateRevision: 0, holdReason: null,
        decision: null, receipt: null, obligations: [], deletedAt: null };
      this.writeNative(record);
      this.setMeta(`native-order:${envelope.owner.roomUuid}`, String(envelope.acceptOrder));
      return { status: "enqueued", receipt: { type: "native", record } };
    });
  }

  listPendingNative(roomId: string, participantId?: string): NativeRecord[] {
    this.nativeRoomId(roomId);
    if (participantId !== undefined && (typeof participantId !== "string" || !participantId)) throw new NativeReportError("invalid_native_data", "The native participant ID is empty.");
    const sql = "select * from native_reports where room_address = ? and state in ('pending','held')";
    const rows = participantId === undefined
      ? this.db.prepare(sql + " order by accept_order,room_uuid,id").all(roomId)
      : this.db.prepare(sql + " and participant = ? order by accept_order,room_uuid,id").all(roomId, participantId);
    return (rows as Row[]).map(row => this.decodeNative(row));
  }

  listNativeDelivery(roomId: string, participantId?: string): NativeRecord[] {
    this.nativeRoomId(roomId);
    if (participantId !== undefined && (typeof participantId !== "string" || !participantId)) throw new NativeReportError("invalid_native_data", "The native participant ID is empty.");
    const rows = this.db.prepare(`select * from native_reports where room_address = ? and delivery_pending = 1${participantId === undefined ? "" : " and participant = ?"} order by accept_order, room_uuid, id`)
      .all(roomId, ...(participantId === undefined ? [] : [participantId])) as Row[];
    return rows.map(row => this.decodeNative(row));
  }

  holdNative(roomId: string, subject: NativeSubject, expectedRevision: number, reason: NativeHoldReason, at: number): NativeRecord {
    parseNativeHoldReason(reason); nativeInteger(at);
    return this.transaction(() => {
      const record = this.requireNative(roomId, subject, expectedRevision);
      if (record.state !== "pending" && record.state !== "held") throw new NativeReportError("native_conflict", "A final native receipt cannot become pending evidence.");
      record.state = "held"; record.holdReason = reason; record.stateRevision = this.nativeNext(record.stateRevision);
      this.writeNative(record); return record;
    });
  }

  releaseNative(roomId: string, subject: NativeSubject, expectedRevision: number): NativeRecord {
    return this.transaction(() => {
      const record = this.requireNative(roomId, subject, expectedRevision);
      this.requireNativeGeneration(record);
      if (record.state !== "held") throw new NativeReportError("native_conflict", "Only held native evidence can be reconsidered.");
      record.state = "pending"; record.holdReason = null; record.stateRevision = this.nativeNext(record.stateRevision);
      this.writeNative(record); return record;
    });
  }

  tombstoneNative(roomId: string, subject: NativeSubject, expectedRevision: number, deletedAt: number): NativeRecord {
    nativeInteger(deletedAt);
    return this.transaction(() => {
      const record = this.requireNative(roomId, subject, expectedRevision);
      if (record.receipt && record.state !== "tombstoned") {
        this.markDeleted(roomId, [record.envelope.id], deletedAt);
        const receipt = this.nativeReceipt(roomId, record.envelope.owner.roomUuid, record.envelope.id);
        if (!receipt || receipt.type !== "native") throw new NativeReportError("native_state_corrupt", "The native tombstone lost its retained receipt.");
        return receipt.record;
      }
      return this.tombstoneNativeRecord(record, deletedAt);
    });
  }

  finalizeNative(roomId: string, subject: NativeSubject, expectedRevision: number, input: NativeDecision, message: StoredMessage | null): NativeRecord {
    return this.transaction(() => {
      const record = this.requireNative(roomId, subject, expectedRevision);
      this.requireNativeGeneration(record);
      if (record.state !== "pending") throw new NativeReportError("native_conflict", "The native report is not eligible for its first final decision.");
      const decision = parseNativeDecision(input, record.envelope);
      if (decision.obligations.some(o => o.phase !== "pending")) throw new NativeReportError("invalid_native_data", "A new native decision must begin with unattempted obligations.");
      const visible = ["visible_complete", "visible_cancelled_human", "visible_error_human", "referee_hidden"].includes(decision.kind);
      if (visible !== (message !== null)) throw new NativeReportError("invalid_native_data", "The native decision and publication receipt disagree.");
      if (message) {
        const expectedKind = decision.kind === "referee_hidden" ? "hidden" : "chat";
        if (message.id !== record.envelope.id || message.kind !== expectedKind || message.from !== record.envelope.owner.participantId || message.streaming
          || message.details?.reportHash !== record.envelope.reportHash) throw new NativeReportError("invalid_native_data", "The native message is not bound to its exact report decision.");
        nativeInteger(message.seq, 1); nativeInteger(message.ts);
        if (message.displayOrder !== undefined) nativeInteger(message.displayOrder, 1);
        if (this.hasMessageId(roomId, message.id)) throw new NativeReportError("native_conflict", "A retained native message cannot be overwritten by finalization.");
        const max = this.db.prepare("select max(seq) as n from messages where room = ?").get(roomId) as Row;
        if (max.n !== null && message.seq <= nativeInteger(max.n, 1)) throw new NativeReportError("native_conflict", "A native publication must receive a new record sequence at drain.");
        if ((message.displayOrder ?? message.seq) <= this.nativeDisplayHighWater(roomId)) throw new NativeReportError("native_conflict", "A native publication must receive a new display position at drain.");
        if (expectedKind === "chat" && (message.text !== decision.text || JSON.stringify(message.to) !== JSON.stringify(decision.to) || JSON.stringify(message.toNames) !== JSON.stringify(decision.toNames))) throw new NativeReportError("invalid_native_data", "The native visible decision and message differ.");
        if (decision.kind === "referee_hidden" && (message.details?.original !== decision.text || JSON.stringify(message.details?.corrections) !== JSON.stringify(decision.corrections))) throw new NativeReportError("invalid_native_data", "The hidden native receipt lost its original correction subject.");
        if (["visible_cancelled_human", "visible_error_human"].includes(decision.kind) && message.audience !== "human") throw new NativeReportError("invalid_native_data", "An interrupted native report is human-only.");
        this.upsert(roomId, message);
        record.receipt = { messageId: message.id, seq: message.seq, kind: expectedKind };
      }
      record.state = message ? "published" : "consumed"; record.decision = decision;
      record.obligations = decision.obligations.map(o => ({ ...o })); record.stateRevision = this.nativeNext(record.stateRevision);
      this.writeNative(record); return record;
    });
  }

  updateNativeObligation(roomId: string, subject: NativeSubject, expectedRevision: number, obligationId: string, next: NativeObligationPhase): NativeRecord {
    return this.transaction(() => {
      const record = this.requireNative(roomId, subject, expectedRevision);
      if (record.state !== "published" && record.state !== "consumed") throw new NativeReportError("native_conflict", "The native receipt has no eligible delivery obligation.");
      const obligation = record.obligations.find(o => o.id === obligationId);
      if (!obligation || !nativeObligationTransition(obligation.phase, next)) throw new NativeReportError("invalid_native_data", "The native obligation transition is not supported.");
      if (next === "pending" || next === "attempt_started" || next === "applied_local") this.requireNativeGeneration(record);
      if (next === obligation.phase) return record;
      obligation.phase = next; record.stateRevision = this.nativeNext(record.stateRevision);
      this.writeNative(record); return record;
    });
  }

  private nativeRoomId(roomId: string): void {
    if (this.transactionDepth === 0) this.assertTransactionSettled();
    if (typeof roomId !== "string" || !roomId) throw new NativeReportError("invalid_native_data", "A native room address is required.");
  }
  private nativeUuid(roomUuid: string): void {
    if (this.transactionDepth === 0) this.assertTransactionSettled();
    if (typeof roomUuid !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomUuid)) throw new NativeReportError("invalid_native_data", "A native room UUID is required.");
  }
  private nativeId(id: string): void {
    if (typeof id !== "string" || !/^acp-[0-9a-f]{64}$/.test(id)) throw new NativeReportError("invalid_native_data", "A stable native ID is required.");
  }
  private nativeNext(value: number): number { return nativeInteger(value + 1, 1); }
  private nativeMetaInteger(key: string): number {
    const value = this.meta(key);
    if (value === null) return 0;
    if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new NativeReportError("native_state_corrupt", "The native metadata counter is unreadable.");
    return nativeInteger(Number(value));
  }
  private nativeDeliveryPending(record: NativeRecord): 0 | 1 {
    if (record.state === "tombstoned") return 0;
    return record.state === "pending" || record.state === "held"
      || record.obligations.some(o => o.phase === "pending" || o.phase === "attempt_started" || o.phase === "held_owner") ? 1 : 0;
  }
  private decodeNative(row: Row, checkDeliveryIndex = true): NativeRecord {
    try {
      const record = parseNativeRecord(JSON.parse(String(row.body)));
      const e = record.envelope;
      if (row.room_uuid !== e.owner.roomUuid || row.id !== e.id || row.room_address !== e.owner.roomId || row.participant !== e.owner.participantId
        || row.accept_order !== e.acceptOrder || row.generation !== e.owner.generation || row.state !== record.state || row.state_revision !== record.stateRevision
        || (checkDeliveryIndex && row.delivery_pending !== this.nativeDeliveryPending(record))) throw new Error("tuple");
      return record;
    } catch { throw new NativeReportError("native_state_corrupt", "A retained native record is not a consistent closed tuple."); }
  }
  private writeNative(input: NativeRecord): void {
    const r = parseNativeRecord(input), e = r.envelope;
    this.db.prepare(`insert into native_reports(room_uuid,id,room_address,participant,accept_order,generation,state,state_revision,delivery_pending,body)
      values (?,?,?,?,?,?,?,?,?,?) on conflict(room_uuid,id) do update set state=excluded.state,state_revision=excluded.state_revision,delivery_pending=excluded.delivery_pending,body=excluded.body`)
      .run(e.owner.roomUuid, e.id, e.owner.roomId, e.owner.participantId, e.acceptOrder, e.owner.generation, r.state, r.stateRevision, this.nativeDeliveryPending(r), JSON.stringify(r));
  }
  private requireNative(roomId: string, input: NativeSubject, expectedRevision: number): NativeRecord {
    const subject = parseNativeSubject(input); nativeInteger(expectedRevision);
    const receipt = this.nativeReceipt(roomId, subject.roomUuid, subject.id);
    if (!receipt || receipt.type !== "native" || receipt.record.envelope.reportHash !== subject.reportHash) throw new NativeReportError("native_conflict", "The native subject does not match retained evidence.");
    if (receipt.record.stateRevision !== expectedRevision) throw new NativeReportError("native_revision_changed", "The native state revision has changed.");
    return receipt.record;
  }
  private requireNativeGeneration(record: NativeRecord): void {
    if (record.envelope.owner.generation !== this.nativeGeneration(record.envelope.owner.roomId)) throw new NativeReportError("native_generation_changed", "The native history generation has changed.");
  }
  private tombstoneNativeRecord(record: NativeRecord, deletedAt: number): NativeRecord {
    if (record.state === "tombstoned") return record;
    record.state = "tombstoned"; record.holdReason = null; record.deletedAt = deletedAt;
    record.obligations = record.obligations.map((o): NativeObligation => ({ ...o, phase: o.phase === "attempt_started" ? "attempt_unknown" : ["pending", "held_owner"].includes(o.phase) ? "suppressed_deleted" : o.phase }));
    record.stateRevision = this.nativeNext(record.stateRevision);
    this.writeNative(record); return record;
  }

  chatAfter(roomId: string, afterSeq: number, limit: number): StoredMessage[] {
    return (this.db.prepare("select body from messages where room = ? and deleted_at is null and kind = 'chat' and seq > ? order by seq limit ?")
      .all(roomId, afterSeq, Math.max(1, Math.floor(limit))) as Row[]).map((r) => this.decode(r));
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


  nativeOperationApplied(roomId: string, input: NativeDivertOp): boolean {
    this.nativeRoomId(roomId);
    const op = parseNativeOperation(input);
    if (!op || op.opId === undefined) throw new NativeReportError("invalid_native_data", "A native replay lookup requires its exact closed operation.");
    const row = this.db.prepare("select room, kind, payload_hash from applied_ops where op_id = ?").get(op.opId) as Row | undefined;
    if (!row) return false;
    if (row.room !== roomId || row.kind !== "divert" || row.payload_hash !== nativeDataHash(op)) throw new NativeReportError("native_conflict", "The native journal operation ID already names different retained data.");
    return true;
  }

  applyOp(roomId: string, op: DivertOp): "applied" | "skipped" {
    return this.transaction(() => {
      const native = parseNativeOperation(op);
      if (native) {
        if (native.opId === undefined) throw new NativeReportError("invalid_native_data", "A native journal operation requires its exact stable operation ID.");
        const payloadHash = nativeDataHash(native);
        if (this.nativeOperationApplied(roomId, native as NativeDivertOp)) return "skipped";
        this.enableNativeJournalSafety(roomId);
        if (native.kind === "native_enqueue_v1") {
          const previous = this.nativeReceipt(roomId, native.envelope.owner.roomUuid, native.envelope.id);
          if (previous?.type === "native" && JSON.stringify(previous.record.envelope) !== JSON.stringify(native.envelope)) throw new NativeReportError("native_conflict", "The native journal replay changed its immutable acceptance tuple.");
          this.enqueueNative(roomId, native.envelope);
        } else if (native.kind === "native_hold_v1") this.holdNative(roomId, native.subject, native.expectedRevision, native.reason, native.at);
        else this.tombstoneNative(roomId, native.subject, native.expectedRevision, native.deletedAt);
        this.db.prepare("insert into applied_ops(op_id, room, applied_at, message_id, seq, kind, payload_hash) values (?, ?, ?, null, null, 'divert', ?)")
          .run(native.opId, roomId, Date.now(), payloadHash);
        return "applied";
      }
      const legacy = op as LegacyPendingOp & { opId: string };
      if (this.db.prepare("select 1 from applied_ops where op_id = ?").get(op.opId)) return "skipped";
      if (legacy.kind === "upsert") this.upsert(roomId, legacy.message);
      else if (legacy.kind === "rewrite") this.rewrite(roomId, legacy.message, legacy.fromSeq, legacy.deletedAt);
      else if (legacy.kind === "bury") this.markDeleted(roomId, legacy.ids, legacy.deletedAt);
      else this.truncateFrom(roomId, legacy.fromSeq, legacy.deletedAt);
      const message = legacy.kind === "truncate" || legacy.kind === "bury" ? null : legacy.message;
      const kind = legacy.accept ? "accept" : "divert";
      this.db
        .prepare("insert into applied_ops(op_id, room, applied_at, message_id, seq, kind) values (?, ?, ?, ?, ?, ?)")
        .run(op.opId, roomId, Date.now(), message?.id ?? null, message?.seq ?? null, kind);
      return "applied";
    });
  }

  isApplied(opId: string): boolean {
    return !!this.db.prepare("select 1 from applied_ops where op_id = ?").get(opId);
  }

  appliedReceipt(opId: string): AppliedReceipt | null {
    const row = this.db.prepare("select message_id, seq from applied_ops where op_id = ? and kind = 'accept'").get(opId) as Row | undefined;
    if (!row || row.message_id === null || row.message_id === undefined) return null;
    return { messageId: String(row.message_id), seq: Number(row.seq) };
  }

  appliedOps(roomId: string, kind?: "divert" | "accept"): number {
    const where = kind === "accept" ? " and kind = 'accept'" : kind === "divert" ? " and (kind is null or kind = 'divert')" : "";
    return Number((this.db.prepare(`select count(*) as n from applied_ops where room = ?${where}`).get(roomId) as Row).n);
  }

  purgeAcceptedOps(before: number): number {
    return Number(this.db.prepare("delete from applied_ops where kind = 'accept' and applied_at < ?").run(before).changes);
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
            .run(roomId, message.id, message.seq, message.displayOrder ?? null, message.kind, message.from ?? null, message.fromName ?? null, message.ts, searchableText(message), message.pinned ? 1 : 0, deletedAt, JSON.stringify(message), JSON.stringify(messageFeatures(message)), messageWeight(messageFeatures(message)));
        }
        report.imported++;
      }
    });
    return report;
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
    if (query.rooms && !query.rooms.length) return { hits: [], query: sanitized, usedTrigram: false };
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
    if (query.authors) {
      if (!query.authors.length) return [];
      where.push(`(m.room, m.author) in (values ${query.authors.map(() => "(?, ?)").join(", ")})`);
      for (const a of query.authors) params.push(a.roomId, a.id);
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


  async backup(toPath: string, options: { recorded?: boolean } = {}): Promise<void> {
    await sqliteBackup(this.db.raw, toPath);
    if (options.recorded !== false) this.setMeta("last_backup_at", String(Date.now()));
  }

  close(): void {
    this.memoryDebug.close();
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
