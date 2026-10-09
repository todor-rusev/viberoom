// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import type { SqliteConnection } from "../sqlite-capabilities.js";
import { randomUUID } from "node:crypto";
import type { AskedQuestions } from "./questions.js";
import type { EpisodeSource, Recalled } from "./provider.js";
import { MemoryDeliveryStore, type Delivery, type ListedEpisode } from "./delivery.js";
import { MemoryImpactStore } from "./impact.js";
import { MemoryRecoveryVerification } from "./recovery-verification.js";
import { MemoryCarryStore } from "./carry.js";
import { DELIVERY_WATCH_POLICY } from "./delivery-watch.js";
import { MemoryEpisodeIndex } from "./episode-index.js";
import { MemoryGenerationStore, type GenerationNamespace, type GenerationRoute } from "./graph-generations.js";
import { MemoryRecoveryJobs } from "./recovery-jobs.js";
import { MemoryRecoveryAuthorizations } from "./recovery-authorizations.js";
import { MemoryRepairJournal, type RecoveryRepairReceipt } from "./repair-journal.js";
import type { SelectiveRepairScope } from "./selective-repair-intent.js";
import { recoveryFingerprint, type RecoveryScope } from "./recovery-sources.js";
import { MemoryOriginalSourceBindings } from "./original-source-binding.js";
import { invalidateOriginalSourceReceipts, originalSourceSelected } from "./original-source-schema.js";
import { systemClock, type MemoryClock } from "./clock.js";
import { sqliteDataVersion, sqliteTotalChanges } from "./sql-read-only-fence.js";

export type MemoryOpKind = "fact" | "note" | "forget" | "reingest" | "forget-room";

export interface MemoryOp {
  id: number;
  provider: string;
  room: string;
  kind: MemoryOpKind;
  payload: Record<string, unknown>;
  account?: string;
  createdAt: number;
  attempts: number;
  retryAt: number;
  deferredSince: number | null;
  deferKind: "processing" | "failed" | "expired" | null;
  deferReason: string | null;
}

export interface RoomForgetStatus {
  requestId: string;
  state: "pending" | "failed" | "confirmed";
  requestedAt: number;
  updatedAt: number;
  reason?: string;
  retryable?: boolean;
}

export const OP_ATTEMPT_LIMIT = 8;
export const OP_STALLED_MS = 30 * 60_000;
export const OP_DEFER_HORIZON_MS = DELIVERY_WATCH_POLICY.horizonMs;
export const REPLACEMENT_SETTLE_MS = 60_000;
export type ReplacementBlocker =
  | { kind: "deletion"; op: MemoryOp }
  | { kind: "version"; delivery: Delivery };
export interface VersionCheck {
  room: string;
  sourceId: string;
  queuedAt: number;
  state: "queued" | "waiting" | "held";
  reason: string | null;
  checkedAt: number | null;
  revision: number;
  retryAt: number;
  retries: number;
}
const ROOM_TABLES = ["memory_cursor", "memory_cursor_birth", "memory_episode_map", "memory_episode_account", "memory_episode_source", "memory_episode_retired", "memory_ops", "memory_message_brief", "memory_recalled_brief", "memory_version_skip", "memory_bound_watch", "memory_selective_repair_intent"];
const LOCAL_TABLES = ["memory_version_check", "memory_own_version", "memory_imported_source", "memory_version_excluded", "memory_episode_index_room", "memory_generation_attachment", "memory_source_admission"];
const EPISODE_RETIREMENT_SCHEMA = `create table if not exists memory_episode_retired(
  provider text not null, room text not null, external_id text not null, account text not null default '',
  primary key(provider, room, account, external_id));`;

export class MemoryOutbox {
  readonly deliveries: MemoryDeliveryStore;
  readonly impacts: MemoryImpactStore;
  readonly carry: MemoryCarryStore;
  readonly episodeIndex: MemoryEpisodeIndex;
  readonly generations: MemoryGenerationStore;
  readonly recovery: MemoryRecoveryJobs;
  readonly recoveryVerification: MemoryRecoveryVerification;
  readonly recoveryHuman: MemoryRecoveryAuthorizations;
  readonly repairs: MemoryRepairJournal;
  readonly originals: MemoryOriginalSourceBindings;
  constructor(private readonly db: SqliteConnection, readonly clock: MemoryClock = systemClock) {
    this.deliveries = new MemoryDeliveryStore(db);
    this.impacts = new MemoryImpactStore(db);
    this.carry = new MemoryCarryStore(db, this.impacts);
    this.episodeIndex = new MemoryEpisodeIndex(db);
    this.generations = new MemoryGenerationStore(db);
    this.recovery = new MemoryRecoveryJobs(db, this);
    this.recoveryVerification = new MemoryRecoveryVerification(db, this);
    this.recoveryHuman = new MemoryRecoveryAuthorizations(db, this);
    db.exec(`create table if not exists memory_generation_attachment(provider text not null,room text not null,state text not null,primary key(provider,room));`);
    db.exec(`create table if not exists memory_episode_account(provider text not null,room text not null,source_id text not null,
      external_id text not null,account text not null,primary key(provider,room,source_id,external_id));`);
    db.exec(`create table if not exists memory_source_admission(provider text not null,room text not null,uuid text not null,copy text not null,source_id text not null,primary key(provider,room,uuid,copy,source_id));`);
    db.exec(`create table if not exists memory_cursor(
        provider text not null, room text not null, seq integer not null,
        primary key(provider, room));
      create table if not exists memory_cursor_birth(
        provider text not null, room text not null, born_at integer not null,
        primary key(provider, room));
      create table if not exists memory_version_check(
        room text not null, source_id text not null, queued_at integer not null,
        state text not null default 'queued', reason text, checked_at integer,
        revision integer not null default 0, retry_at integer not null default 0,
        retries integer not null default 0,
        primary key(room, source_id));
      create index if not exists memory_version_check_due on memory_version_check(room, state, queued_at);
      create table if not exists memory_own_version(
        room text not null, source_id text not null, version text not null,
        primary key(room, source_id, version));
      create table if not exists memory_imported_source(
        room text not null, source_id text not null, version text not null,
        primary key(room, source_id));
      create table if not exists memory_version_excluded(
        room text not null, source_id text not null, version text not null, primary key(room,source_id,version));
      create table if not exists memory_version_skip(
        provider text not null, room text not null, reason text not null, count integer not null, last_at integer not null,
        primary key(provider, room, reason));
      create table if not exists memory_bound_watch(
        provider text not null, room text not null, source_id text not null, version text not null, watch_id text not null,
        primary key(provider, room, source_id, version));
      create table if not exists memory_episode_map(
        provider text not null, room text not null, source_id text not null, external_id text not null,
        primary key(provider, room, source_id, external_id));
      create index if not exists memory_episode_reverse on memory_episode_map(provider, room, external_id);
      create table if not exists memory_episode_source(
        provider text not null, room text not null, source_id text not null, external_id text not null, source text not null,
        primary key(provider, room, source_id, external_id));
      ${EPISODE_RETIREMENT_SCHEMA}
      create table if not exists memory_ops(
        id integer primary key, provider text not null, room text not null, kind text not null,
        payload text not null, created_at integer not null, attempts integer not null default 0);
      create index if not exists idx_memory_ops_provider on memory_ops(provider, id);
      create index if not exists idx_memory_ops_room_kind on memory_ops(provider, room, kind, id);
      create table if not exists memory_room_forget(
        provider text not null, room text not null, uuid text not null, request_id text not null,
        state text not null, requested_at integer not null, updated_at integer not null,
        reason text, retryable integer,
        primary key(provider, room, uuid));
      create table if not exists memory_usage(
        provider text not null, month text not null, credits integer not null,
        primary key(provider, month));
      create table if not exists memory_graph_repair(
        provider text not null, uuid text not null, since integer not null, reason text not null,
        primary key(provider,uuid));
      create table if not exists memory_message_brief(
        provider text not null, room text not null, seq integer not null, lines text not null, asked text not null,
        primary key(provider, room, seq));
      create table if not exists memory_recalled_brief(
        provider text not null, room text not null, seq integer not null, lines text not null, asked text not null, facts text not null,
        primary key(provider, room, seq));
      drop table if exists memory_brief;
      drop table if exists memory_brief_asked;`);
    this.repairs = new MemoryRepairJournal(db, receipt => this.recoveryRepairCurrent(receipt), scope => this.selectiveRepairScopeCurrent(scope));
    if (!db.prepare("pragma table_info(memory_episode_retired)").all().some(row => row.name === "account")) {
      db.exec("savepoint memory_episode_retirement_schema");
      try {
        db.exec(`alter table memory_episode_retired rename to memory_episode_retired_legacy;
          ${EPISODE_RETIREMENT_SCHEMA}
          insert into memory_episode_retired(provider,room,external_id,account)
            select provider,room,external_id,'' from memory_episode_retired_legacy;
          drop table memory_episode_retired_legacy;
          release memory_episode_retirement_schema;`);
      } catch (error) { db.exec("rollback to memory_episode_retirement_schema; release memory_episode_retirement_schema"); throw error; }
    }
    const columns = new Set(db.prepare("pragma table_info(memory_ops)").all().map(row => String(row.name)));
    db.exec("savepoint memory_op_deferral_schema");
    try {
      for (const [column, type] of Object.entries({ account: "text", retry_at: "integer not null default 0", deferred_since: "integer", defer_kind: "text", defer_reason: "text" })) {
        if (!columns.has(column)) db.exec(`alter table memory_ops add column ${column} ${type}`);
      }
      db.exec("create index if not exists memory_ops_due on memory_ops(provider,room,retry_at); release memory_op_deferral_schema");
    } catch (error) { db.exec("rollback to memory_op_deferral_schema; release memory_op_deferral_schema"); throw error; }
    if (!db.prepare("pragma table_info(memory_version_check)").all().some(row => row.name === "retries")) {
      db.exec("savepoint memory_version_check_retries_schema");
      try { db.exec("alter table memory_version_check add column retries integer not null default 0; release memory_version_check_retries_schema"); }
      catch (error) { db.exec("rollback to memory_version_check_retries_schema; release memory_version_check_retries_schema"); throw error; }
    }
    this.originals = new MemoryOriginalSourceBindings(db, this);
  }

  addUsage(provider: string, month: string, credits: number): void {
    if (credits <= 0) return;
    this.db.prepare(`insert into memory_usage values(?,?,?)
      on conflict(provider, month) do update set credits = credits + excluded.credits`).run(provider, month, credits);
  }

  usage(provider: string, month: string): number {
    const row = this.db.prepare("select credits from memory_usage where provider=? and month=?").get(provider, month);
    return (row ? Number(row.credits) : 0) + this.deliveries.reserved(provider, month);
  }

  cursor(provider: string, room: string): number {
    const row = this.db.prepare("select seq from memory_cursor where provider=? and room=?").get(provider, room);
    return row ? Number(row.seq) : 0;
  }

  hasCursor(provider: string, room: string): boolean {
    return !!this.db.prepare("select 1 from memory_cursor where provider=? and room=?").get(provider, room);
  }

  advance(provider: string, room: string, seq: number): void {
    this.db.prepare(`insert into memory_cursor values(?,?,?)
      on conflict(provider, room) do update set seq=excluded.seq where excluded.seq > memory_cursor.seq`).run(provider, room, seq);
  }

  resetCursor(provider: string, room: string, seq = 0, bornAt = Date.now()): void {
    this.db.prepare(`insert into memory_cursor values(?,?,?)
      on conflict(provider, room) do update set seq=excluded.seq`).run(provider, room, seq);
    this.db.prepare(`insert into memory_cursor_birth values(?,?,?)
      on conflict(provider, room) do update set born_at=excluded.born_at`).run(provider, room, bornAt);
  }

  cursorBirth(provider: string, room: string): number | null {
    const row = this.db.prepare("select born_at from memory_cursor_birth where provider=? and room=?").get(provider, room);
    return row ? Number(row.born_at) : null;
  }

  recordCursorBirth(provider: string, room: string, bornAt: number): number {
    if (!Number.isSafeInteger(bornAt)) throw new Error("Invalid cursor birth");
    this.db.prepare("insert or ignore into memory_cursor_birth values(?,?,?)").run(provider, room, bornAt);
    return this.cursorBirth(provider, room)!;
  }

  queueVersionCheck(room: string, sourceId: string, now = Date.now()): void {
    this.db.prepare(`insert into memory_version_check(room,source_id,queued_at) values(?,?,?)
      on conflict(room,source_id) do update set state='queued',reason=null,checked_at=null,retry_at=0,retries=0,revision=revision+1`).run(room, sourceId, now);
  }

  reopenVersionCheck(room: string, sourceId: string): void {
    const reopened = this.db.prepare(`update memory_version_check set state='queued',reason=null,checked_at=null,retry_at=0,retries=0,revision=revision+1
      where room=? and source_id=? and state in ('held','waiting')`).run(room, sourceId).changes;
    if (reopened) this.rearmPreparedDeliveries(room, sourceId);
  }

  reopenExhaustedVersionCheck(room: string, sourceId: string): boolean {
    const reopened = this.db.prepare(`update memory_version_check set state='queued',reason=null,checked_at=null,retry_at=0,retries=0,revision=revision+1
      where room=? and source_id=? and state='held' and reason like 'source_check_exhausted:%'`).run(room, sourceId).changes === 1;
    if (reopened) this.rearmPreparedDeliveries(room, sourceId);
    return reopened;
  }

  private rearmPreparedDeliveries(room: string, sourceId: string): void {
    this.db.prepare(`update memory_delivery set check_at=0 where source_id=? and json_extract(identity,'$.roomId')=?
      and retired_at is null and state='prepared'`).run(sourceId, room);
  }

  sourceCleanupFinished(room: string, sourceId: string): void {
    this.db.prepare(`update memory_version_check set state='queued',reason=null,checked_at=null,retry_at=0,revision=revision+1
      where room=? and source_id=? and state='waiting' and reason='older_version_leaving'`).run(room, sourceId);
  }

  versionChecks(room: string, limit = 64, now = Date.now()): VersionCheck[] {
    return this.db.prepare(`select * from memory_version_check where room=? and state in ('queued','waiting') and retry_at<=?
      order by queued_at, source_id limit ?`).all(room, now, limit).map(row => this.versionCheck(row));
  }

  versionCheckFor(room: string, sourceId: string): VersionCheck | null {
    const row = this.db.prepare("select * from memory_version_check where room=? and source_id=?").get(room, sourceId);
    return row ? this.versionCheck(row) : null;
  }

  openVersionChecks(room: string, limit = 50): VersionCheck[] {
    return this.db.prepare("select * from memory_version_check where room=? order by queued_at, source_id limit ?").all(room, limit).map(row => this.versionCheck(row));
  }

  versionCheckPage(after?: string, limit = 51): VersionCheck[] {
    let cursor = ["", ""];
    if (after) {
      try { cursor = JSON.parse(Buffer.from(after, "base64url").toString("utf8")); } catch { throw new Error("Invalid version cursor"); }
      if (!Array.isArray(cursor) || cursor.length !== 2 || cursor.some(v => typeof v !== "string")) throw new Error("Invalid version cursor");
    }
    return this.db.prepare("select * from memory_version_check where (room,source_id)>(?,?) order by room,source_id limit ?")
      .all(...cursor, limit).map(row => this.versionCheck(row));
  }

  skippedVersions(provider: string): Array<{ roomId: string; reason: string; count: number }> {
    return this.db.prepare("select room,reason,count from memory_version_skip where provider=? order by room,reason").all(provider)
      .map(row => ({ roomId: String(row.room), reason: String(row.reason), count: Number(row.count) }));
  }

  bindingWatches(provider: string, after = "", limit = 51) {
    return this.db.prepare("select * from memory_bound_watch where provider=? and watch_id>? order by watch_id limit ?").all(provider, after, limit)
      .map(row => ({ watchId: String(row.watch_id), roomId: String(row.room), sourceId: String(row.source_id), version: String(row.version),
        watch: this.deliveries.watches.get(String(row.watch_id)) }));
  }

  requestBindingCheck(provider: string, id: string): string {
    const row = this.db.prepare("select room from memory_bound_watch where provider=? and watch_id=?").get(provider, id);
    if (!row || !this.deliveries.watches.request(id)) throw new Error("This binding no longer exists. Refresh the registry.");
    return String(row.room);
  }

  bindingRoom(provider: string, id: string): string | null {
    const row = this.db.prepare("select room from memory_bound_watch where provider=? and watch_id=?").get(provider, id);
    return row ? String(row.room) : null;
  }

  private versionCheck(row: Record<string, unknown>): VersionCheck {
    return { room: String(row.room), sourceId: String(row.source_id), queuedAt: Number(row.queued_at), state: row.state as VersionCheck["state"],
      reason: row.reason === null ? null : String(row.reason), checkedAt: row.checked_at === null ? null : Number(row.checked_at),
      revision: Number(row.revision), retryAt: Number(row.retry_at), retries: Number(row.retries ?? 0) };
  }

  deferVersionCheck(room: string, sourceId: string, reason: string, now: number, retryAt = now + 30_000, revision?: number): boolean {
    return this.db.prepare(`update memory_version_check set state='waiting',reason=?,checked_at=?,retry_at=? where room=? and source_id=?${revision === undefined ? "" : " and revision=?"}`)
      .run(reason.slice(0, 200), now, retryAt, room, sourceId, ...(revision === undefined ? [] : [revision])).changes === 1;
  }

  holdVersionCheck(room: string, sourceId: string, reason: string, now: number, revision?: number): boolean {
    return this.db.prepare(`update memory_version_check set state='held',reason=?,checked_at=? where room=? and source_id=?${revision === undefined ? "" : " and revision=?"}`)
      .run(reason.slice(0, 200), now, room, sourceId, ...(revision === undefined ? [] : [revision])).changes === 1;
  }

  holdSourceVersion(room: string, sourceId: string, reason: string, now: number, retryAt?: number, counted = false, revision?: number): boolean {
    if (revision === undefined) this.db.prepare("insert or ignore into memory_version_check(room,source_id,queued_at) values(?,?,?)").run(room, sourceId, now);
    if (retryAt === undefined) return this.holdVersionCheck(room, sourceId, reason, now, revision);
    const applied = this.deferVersionCheck(room, sourceId, reason, now, retryAt, revision);
    if (applied && counted) this.db.prepare("update memory_version_check set retries=retries+1 where room=? and source_id=?").run(room, sourceId);
    return applied;
  }

  sourceVersionRetries(room: string, sourceId: string): number {
    const row = this.db.prepare("select retries from memory_version_check where room=? and source_id=?").get(room, sourceId);
    return row ? Number(row.retries) : 0;
  }

  sourceVersionHeld(room: string, sourceId: string): boolean {
    return !!this.db.prepare(`select 1 from memory_version_check where room=? and source_id=? and state='held'
      and (reason='source_replaced_elsewhere' or reason like 'source_check_exhausted:%')`).get(room, sourceId);
  }

  exhaustedSourceCheck(room: string, sourceId: string): string | null {
    const row = this.db.prepare("select reason from memory_version_check where room=? and source_id=? and state='held' and reason like 'source_check_exhausted:%'").get(room, sourceId);
    return row ? String(row.reason) : null;
  }

  dropVersionChecks(room: string): void {
    this.db.prepare("delete from memory_version_check where room=?").run(room);
  }

  excludeVersion(room: string, sourceId: string, version: string): void {
    this.db.prepare("insert or ignore into memory_version_excluded values(?,?,?)").run(room, sourceId, version);
  }

  excludedVersion(room: string, sourceId: string, version: string): boolean {
    return !!this.db.prepare("select 1 from memory_version_excluded where room=? and source_id=? and version=?").get(room, sourceId, version);
  }

  versionChecked(room: string, sourceId: string, revision?: number): void {
    this.db.prepare(`delete from memory_version_check where room=? and source_id=?${revision === undefined ? "" : " and revision=?"}`)
      .run(room, sourceId, ...(revision === undefined ? [] : [revision]));
  }

  versionCheckCurrent(check: VersionCheck): boolean {
    return !!this.db.prepare("select 1 from memory_version_check where room=? and source_id=? and revision=?")
      .get(check.room, check.sourceId, check.revision);
  }

  nextVersionCheck(room: string): number | null {
    const row = this.db.prepare("select min(retry_at) at from memory_version_check where room=? and state in ('queued','waiting')").get(room);
    return row?.at === null || row?.at === undefined ? null : Number(row.at);
  }

  divertToVersionCheck(provider: string, room: string, sourceId: string, seq: number, now: number): void {
    this.db.exec("savepoint memory_version_divert");
    try {
      this.queueVersionCheck(room, sourceId, now);
      this.advance(provider, room, seq);
      this.db.exec("release memory_version_divert");
    } catch (error) { this.db.exec("rollback to memory_version_divert; release memory_version_divert"); throw error; }
  }

  skipVersionCheck(provider: string, room: string, sourceId: string, reason: "written_before_memory" | "provider_cannot_check" | "imported_history", now: number): void {
    this.db.exec("savepoint memory_version_skip");
    try {
      this.versionChecked(room, sourceId);
      this.db.prepare(`insert into memory_version_skip values(?,?,?,1,?)
        on conflict(provider,room,reason) do update set count=count+1,last_at=excluded.last_at`).run(provider, room, reason, now);
      this.db.exec("release memory_version_skip");
    } catch (error) { this.db.exec("rollback to memory_version_skip; release memory_version_skip"); throw error; }
  }

  versionSkips(provider: string, room: string): Array<{ reason: string; count: number; lastAt: number }> {
    return this.db.prepare("select reason,count,last_at from memory_version_skip where provider=? and room=? order by reason").all(provider, room)
      .map(row => ({ reason: String(row.reason), count: Number(row.count), lastAt: Number(row.last_at) }));
  }

  boundVersion(provider: string, room: string, sourceId: string, version: string): boolean {
    return !!this.db.prepare(`select 1 from memory_episode_map m left join memory_episode_source s using(provider,room,source_id,external_id)
      where m.provider=? and m.room=? and m.source_id=? and (json_extract(s.source,'$.version')=? or json_extract(s.source,'$.version') is null) limit 1`)
      .get(provider, room, sourceId, version);
  }

  heldSource(provider: string, room: string, sourceId: string): boolean {
    return !!this.db.prepare(`select 1 from memory_episode_map where provider=? and room=? and source_id=?
      union all select 1 from memory_source_admission a join memory_delivery_copy c
        on c.provider=a.provider and c.room=a.room and c.uuid=a.uuid and c.copy_id=a.copy
        where a.provider=? and a.room=? and a.source_id=?
      union all select 1 from memory_delivery where provider=? and source_id=? and json_extract(identity,'$.roomId')=?
        and json_extract(identity,'$.kind')='episode' and coalesce(retirement,'') not in ('local_copy_removed','room_memory_forgotten') limit 1`)
      .get(provider, room, sourceId, provider, room, sourceId, provider, sourceId, room);
  }

  unbindOtherVersions(room: string, sourceId: string, keepVersion?: string): void {
    for (const row of this.db.prepare(`select provider, external_id from memory_episode_source where room=? and source_id=?
        and json_extract(source,'$.boundCopy') is not null${keepVersion ? " and coalesce(json_extract(source,'$.version'),'')!=?" : ""}`)
      .all(room, sourceId, ...(keepVersion ? [keepVersion] : []))) this.dropEpisodeIds(String(row.provider), room, sourceId, [String(row.external_id)]);
  }

  markOwnVersion(room: string, sourceId: string, version: string): void {
    this.db.prepare("insert or ignore into memory_own_version values(?,?,?)").run(room, sourceId, version);
  }

  importSource(room: string, sourceId: string, version: string): void {
    originalSourceSelected(this.db, room, sourceId);
    invalidateOriginalSourceReceipts(this.db, { room, sourceId }, "source_imported");
    this.db.prepare(`insert into memory_imported_source values(?,?,?)
      on conflict(room,source_id) do update set version=excluded.version`).run(room, sourceId, version);
    this.db.prepare("delete from memory_own_version where room=? and source_id=?").run(room, sourceId);
    this.deliveries.retireSource(room, sourceId, undefined, true);
    for (const row of this.db.prepare("select watch_id from memory_bound_watch where room=? and source_id=?").all(room, sourceId)) this.deliveries.watches.close(String(row.watch_id));
    for (const table of ["memory_episode_map", "memory_episode_source", "memory_episode_account", "memory_bound_watch"])
      this.db.prepare(`delete from ${table} where room=? and source_id=?`).run(room, sourceId);
    this.db.prepare(`update memory_ops set defer_kind='failed',defer_reason='imported_source_read_only'
      where room=? and kind in ('forget','reingest') and json_extract(payload,'$.sourceId')=?`).run(room, sourceId);
  }

  localSource(room: string, sourceId: string): void {
    originalSourceSelected(this.db, room, sourceId);
    invalidateOriginalSourceReceipts(this.db, { room, sourceId }, "source_selected_locally");
    this.db.prepare("delete from memory_imported_source where room=? and source_id=?").run(room, sourceId);
    this.db.prepare(`update memory_ops set retry_at=0,deferred_since=null,defer_kind=null,defer_reason=null
      where room=? and kind in ('forget','reingest') and json_extract(payload,'$.sourceId')=?
        and defer_reason='imported_source_read_only'`).run(room, sourceId);
  }

  changeToken(): string {
    return `${sqliteDataVersion(this.db)}:${sqliteTotalChanges(this.db)}`;
  }

  importedSource(room: string, sourceId: string): boolean {
    return !!this.db.prepare("select 1 from memory_imported_source where room=? and source_id=?").get(room, sourceId);
  }

  hasOwnVersions(room: string): boolean {
    return !!this.db.prepare(`select 1 from memory_own_version v where v.room=? and not exists
      (select 1 from memory_imported_source i where i.room=v.room and i.source_id=v.source_id) limit 1`).get(room);
  }

  attachLegacyMaps(room: string, uuid: string): void {
    for (const row of this.db.prepare("select distinct provider from memory_episode_map where room=?").all(room))
      this.deliveries.copy(String(row.provider), room, uuid);
  }

  reopenAllVersionChecks(room: string): void {
    this.db.prepare("update memory_version_check set state='queued',reason=null,checked_at=null,retry_at=0,revision=revision+1 where room=?").run(room);
    this.db.prepare(`update memory_delivery set check_at=0 where json_extract(identity,'$.roomId')=? and retired_at is null and state='prepared'
      and source_id in (select source_id from memory_version_check where room=?)`).run(room, room);
  }

  ownVersion(room: string, sourceId: string, version: string): boolean {
    return !!this.db.prepare("select 1 from memory_own_version where room=? and source_id=? and version=?").get(room, sourceId, version);
  }

  mapEpisode(provider: string, room: string, sourceId: string, externalId: string, source?: EpisodeSource,
    account: string | null = this.generationAttachment(provider, room)?.account ?? null): void {
    this.db.exec("savepoint memory_episode_binding");
    try {
      if (account !== null) {
        this.db.prepare("insert or ignore into memory_episode_account values(?,?,?,?,?)").run(provider, room, sourceId, externalId, account);
        if (this.bindingAccount(provider, room, sourceId, externalId) !== account) throw new Error("Episode binding account changed");
      }
      this.db.prepare("insert or ignore into memory_episode_map values(?,?,?,?)").run(provider, room, sourceId, externalId);
      if (source) this.db.prepare("insert or ignore into memory_episode_source values(?,?,?,?,?)").run(provider, room, sourceId, externalId, JSON.stringify(source));
      this.db.exec("release memory_episode_binding");
    } catch (error) {
      this.db.exec("rollback to memory_episode_binding; release memory_episode_binding");
      throw error;
    }
  }

  bindVersion(provider: string, check: VersionCheck, source: EpisodeSource, episodes: Array<{ id: string; copyId: string | null }>, now: number): void {
    if (this.deliveries.groupedSource(provider, check.room, check.sourceId, source.version, source.graphId))
      throw new Error("Grouped source requires whole native compatibility and atomic group adoption");
    this.db.exec("savepoint memory_version_binding");
    try {
      if (this.versionCheckCurrent(check)) {
        for (const episode of episodes) this.mapEpisode(provider, check.room, check.sourceId, episode.id, { ...source, boundCopy: episode.copyId ?? "unknown" });
        this.watchVersion(provider, check.room, check.sourceId, source.version!, now);
        this.versionChecked(check.room, check.sourceId, check.revision);
      }
      this.db.exec("release memory_version_binding");
    } catch (error) { this.db.exec("rollback to memory_version_binding; release memory_version_binding"); throw error; }
  }

  replaceEpisodeBinding(provider: string, room: string, sourceId: string, oldId: string, newId: string, source: EpisodeSource, account?: string): boolean {
    if (this.deliveries.groupedSource(provider, room, sourceId, source.version, source.graphId)) return false;
    this.db.exec("savepoint memory_binding_move");
    try {
      if (account !== undefined && this.bindingAccount(provider, room, sourceId, oldId) !== account) {
        this.db.exec("release memory_binding_move"); return false;
      }
      this.dropEpisodeIds(provider, room, sourceId, [oldId], account);
      this.mapEpisode(provider, room, sourceId, newId, source, account);
      this.db.exec("release memory_binding_move");
      return true;
    } catch (error) { this.db.exec("rollback to memory_binding_move; release memory_binding_move"); throw error; }
  }

  episodeSources(provider: string, room: string, externalId: string,
    account: string | null = this.generationAttachment(provider, room)?.account ?? null): Array<{ sourceId: string; source?: EpisodeSource }> {
    return this.db.prepare(`select m.source_id, s.source from memory_episode_map m left join memory_episode_source s
      using(provider,room,source_id,external_id) where m.provider=? and m.room=? and m.external_id=?
      ${account === null ? "" : "and exists (select 1 from memory_episode_account a where a.provider=m.provider and a.room=m.room and a.source_id=m.source_id and a.external_id=m.external_id and a.account=?)"}`)
      .all(provider, room, externalId, ...(account === null ? [] : [account]))
      .map(row => ({ sourceId: String(row.source_id), ...(row.source ? { source: JSON.parse(String(row.source)) as EpisodeSource } : {}) }));
  }

  links(provider: string, room: string, account?: string): Array<{ id: string; sourceId: string; source: EpisodeSource }> {
    return this.db.prepare(`select s.external_id,s.source_id,s.source from memory_episode_source s where s.provider=? and s.room=?
      ${account === undefined ? "" : "and exists (select 1 from memory_episode_account a where a.provider=s.provider and a.room=s.room and a.source_id=s.source_id and a.external_id=s.external_id and a.account=?)"}`)
      .all(provider, room, ...(account === undefined ? [] : [account])).map(row => ({ id: String(row.external_id), sourceId: String(row.source_id), source: JSON.parse(String(row.source)) as EpisodeSource }));
  }

  bindingAccount(provider: string, room: string, sourceId: string, externalId: string): string | null {
    const row = this.db.prepare("select account from memory_episode_account where provider=? and room=? and source_id=? and external_id=?")
      .get(provider, room, sourceId, externalId);
    return row ? String(row.account) : null;
  }

  watchVersion(provider: string, room: string, sourceId: string, version: string, now: number, checkNow = false): void {
    const id = `bound:${JSON.stringify([provider, room, sourceId, version])}`;
    this.db.prepare("insert or ignore into memory_bound_watch values(?,?,?,?,?)").run(provider, room, sourceId, version, id);
    this.deliveries.watches.ensure(id, now, now);
    if (checkNow) this.deliveries.watches.request(id);
  }

  claimBindingChecks(provider: string, room: string, now: number): string[] {
    return this.db.prepare(`select b.watch_id from memory_bound_watch b join memory_delivery_watch w on w.op_id=b.watch_id
      where b.provider=? and b.room=? and (w.requested=1 or w.state='active' and w.next_at<=?)`).all(provider, room, now)
      .map(row => String(row.watch_id)).filter(id => this.deliveries.watches.begin(id, now));
  }

  nextBindingCheck(provider: string, room: string): number | null {
    const row = this.db.prepare(`select min(w.next_at) at from memory_bound_watch b join memory_delivery_watch w on w.op_id=b.watch_id
      where b.provider=? and b.room=? and w.state='active'`).get(provider, room);
    return row?.at === null || row?.at === undefined ? null : Number(row.at);
  }

  episodeRetired(provider: string, room: string, externalId: string,
    account: string | null = this.generationAttachment(provider, room)?.account ?? null): boolean {
    return !!this.db.prepare("select 1 from memory_episode_retired where provider=? and room=? and external_id=? and account=?")
      .get(provider, room, externalId, account ?? "");
  }

  episodeIds(provider: string, room: string, sourceId: string): string[] {
    return this.db.prepare("select external_id from memory_episode_map where provider=? and room=? and source_id=?")
      .all(provider, room, sourceId).map(r => String(r.external_id));
  }

  dropEpisodes(provider: string, room: string, sourceId: string): void {
    this.dropEpisodeIds(provider, room, sourceId, this.episodeIds(provider, room, sourceId));
  }

  dropEpisodeIds(provider: string, room: string, sourceId: string, ids: string[], account?: string): void {
    this.db.exec("savepoint memory_episode_removal");
    try {
      invalidateOriginalSourceReceipts(this.db, { provider, room, sourceId, externalIds: ids,
        ...(account === undefined ? {} : { account }) }, "episode_retired");
      for (const id of ids) {
        const owner = this.bindingAccount(provider, room, sourceId, id);
        this.db.prepare("insert or ignore into memory_episode_retired(provider,room,external_id,account) values(?,?,?,?)")
          .run(provider, room, id, account ?? owner ?? "");
        if (account !== undefined && owner !== account) continue;
        this.db.prepare("delete from memory_episode_source where provider=? and room=? and source_id=? and external_id=?").run(provider, room, sourceId, id);
        this.db.prepare("delete from memory_episode_map where provider=? and room=? and source_id=? and external_id=?").run(provider, room, sourceId, id);
        this.db.prepare("delete from memory_episode_account where provider=? and room=? and source_id=? and external_id=?").run(provider, room, sourceId, id);
      }
      this.db.exec("release memory_episode_removal");
    } catch (error) { this.db.exec("rollback to memory_episode_removal; release memory_episode_removal"); throw error; }
  }

  sourceChanged(room: string, sourceId: string, keepVersion?: string): void {
    invalidateOriginalSourceReceipts(this.db, { room, sourceId }, "source_changed");
    if (this.importedSource(room, sourceId)) return;
    this.db.exec("savepoint memory_source_erasure");
    try {
      for (const identity of this.deliveries.retireSource(room, sourceId, keepVersion)) this.ensureForget(identity.provider, room, sourceId, identity.roomUuid, identity.graphId, this.deliveries.copyAccount(identity));
      for (const graph of this.db.prepare(`select distinct m.provider,c.uuid,a.account,json_extract(s.source,'$.graphId') graph_id from memory_episode_map m left join memory_episode_source s
        using(provider,room,source_id,external_id) left join memory_episode_account a using(provider,room,source_id,external_id)
        join memory_delivery_copy c on c.provider=m.provider and c.room=m.room where m.room=? and m.source_id=?
        ${keepVersion ? "and coalesce(json_extract(s.source,'$.version'),'')!=?" : ""}`).all(room, sourceId, ...(keepVersion ? [keepVersion] : [])))
        this.ensureForget(String(graph.provider), room, sourceId, String(graph.uuid), typeof graph.graph_id === "string" ? graph.graph_id : undefined, typeof graph.account === "string" ? graph.account : null);
      this.db.exec("release memory_source_erasure");
    } catch (error) { this.db.exec("rollback to memory_source_erasure; release memory_source_erasure"); throw error; }
  }

  localVersion(room: string, sourceId: string, version: string, now: number): void {
    const graphs = this.db.prepare(`select distinct d.provider, d.room_uuid,c.copy_id,json_extract(d.identity,'$.graphId') graph_id from memory_delivery d join memory_delivery_copy c
        on c.provider=d.provider and c.room=json_extract(d.identity,'$.roomId') and c.uuid=d.room_uuid and c.copy_id=json_extract(d.identity,'$.copyId')
      where d.source_id=? and json_extract(d.identity,'$.roomId')=? and json_extract(d.identity,'$.kind')='episode'
        and d.retired_at is not null and d.retirement='source_changed_or_removed'
        and not exists (select 1 from memory_delivery l where l.provider=d.provider and l.room_uuid=d.room_uuid and l.source_id=d.source_id
          and json_extract(l.identity,'$.copyId')=c.copy_id
          and coalesce(json_extract(l.identity,'$.graphId'),'')=coalesce(json_extract(d.identity,'$.graphId'),'')
          and json_extract(l.identity,'$.roomId')=? and coalesce(l.source_version,json_extract(l.identity,'$.version'))=? and l.retired_at is null)`)
      .all(sourceId, room, room, version);
    for (const graph of graphs) this.queueReplacement(String(graph.provider), room, sourceId, String(graph.room_uuid), now + REPLACEMENT_SETTLE_MS, typeof graph.graph_id === "string" ? graph.graph_id : undefined, this.deliveries.copyAccount({ provider: String(graph.provider), roomId: room, roomUuid: String(graph.uuid ?? graph.room_uuid), copyId: String(graph.copy_id) }));
    for (const graph of this.db.prepare(`select distinct m.provider,c.uuid,a.account,json_extract(s.source,'$.graphId') graph_id from memory_episode_map m left join memory_episode_source s
      using(provider,room,source_id,external_id) left join memory_episode_account a using(provider,room,source_id,external_id)
      join memory_delivery_copy c on c.provider=m.provider and c.room=m.room
      where m.room=? and m.source_id=? and coalesce(json_extract(s.source,'$.version'),'')!=?`)
      .all(room, sourceId, version)) this.queueReplacement(String(graph.provider), room, sourceId, String(graph.uuid), now + REPLACEMENT_SETTLE_MS, typeof graph.graph_id === "string" ? graph.graph_id : undefined, typeof graph.account === "string" ? graph.account : null);
  }

  ensureForget(provider: string, room: string, sourceId: string, uuid: string, graphId?: string, account: string | null = this.generationAttachment(provider, room)?.account ?? null): void {
    if (!this.pendingForget(provider, room, sourceId, uuid, graphId, account)) this.enqueue(provider, room, "forget", { sourceId, uuid, ...(graphId === undefined ? {} : { graphId }) }, account);
  }

  rememberSourceCleanup(op: MemoryOp, episodes: ListedEpisode[]): ListedEpisode[] {
    const held = this.db.prepare("select payload from memory_ops where id=? and provider=? and room=? and kind='forget'").get(op.id, op.provider, op.room);
    if (!held) throw new Error("Source cleanup changed");
    const payload = JSON.parse(String(held.payload)) as Record<string, unknown>;
    const targets = new Map((payload.ancestors as ListedEpisode[] | undefined ?? []).map(e => [e.id, e]));
    for (const episode of episodes) if (!targets.has(episode.id)) targets.set(episode.id, episode);
    if (targets.size > 10_000) throw new Error("Source cleanup target limit reached");
    payload.ancestors = [...targets.values()];
    this.db.prepare("update memory_ops set payload=? where id=?").run(JSON.stringify(payload), op.id);
    return [...targets.values()];
  }

  sourceCleanupTargetDone(op: MemoryOp, id: string, deleted = true): void {
    this.db.exec("savepoint memory_source_cleanup_target");
    try {
      const held = this.db.prepare("select payload from memory_ops where id=? and provider=? and room=? and kind='forget'").get(op.id, op.provider, op.room);
      if (!held) throw new Error("Source cleanup changed");
      const payload = JSON.parse(String(held.payload)) as Record<string, unknown>;
      payload.ancestors = (payload.ancestors as ListedEpisode[] | undefined ?? []).filter(e => e.id !== id);
      this.db.prepare("update memory_ops set payload=? where id=?").run(JSON.stringify(payload), op.id);
      if (deleted) {
        this.dropEpisodeIds(op.provider, op.room, String(payload.sourceId), [id], op.account);
        this.deliveries.sourceReceiptRemoved(op.provider, String(payload.uuid), String(payload.sourceId), id, Date.now(), op.account);
      }
      this.db.exec("release memory_source_cleanup_target");
    } catch (error) { this.db.exec("rollback to memory_source_cleanup_target; release memory_source_cleanup_target"); throw error; }
  }

  pendingForget(provider: string, room: string, sourceId: string, uuid: string, graphId?: string, account?: string | null): MemoryOp | null {
    const row = this.db.prepare(`select id from memory_ops where provider=? and room=? and kind='forget' and json_extract(payload,'$.sourceId')=?
      and coalesce(json_extract(payload,'$.uuid'),?)=? and coalesce(json_extract(payload,'$.graphId'),'')=? ${account === undefined ? "" : "and account is ?"} order by id limit 1`).get(provider, room, sourceId, uuid, uuid, graphId ?? "", ...(account === undefined ? [] : [account]));
    return row ? this.ops(provider, 1, { after: Number(row.id) - 1 })[0] ?? null : null;
  }

  queueReplacement(provider: string, room: string, sourceId: string, uuid: string, dueAt: number, graphId?: string, account: string | null = this.generationAttachment(provider, room)?.account ?? null): void {
    this.db.exec("savepoint memory_replacement");
    try {
      const mine = this.db.prepare(`select id from memory_ops where provider=? and room=? and kind='reingest'
        and json_extract(payload,'$.sourceId')=? and coalesce(json_extract(payload,'$.uuid'),?)=?
        and coalesce(json_extract(payload,'$.graphId'),'')=? and account is ? order by id`)
        .all(provider, room, sourceId, uuid, uuid, graphId ?? "", account).map(row => ({ id: Number(row.id) }));
      if (mine.length) {
        this.db.prepare(`update memory_ops set payload=?,retry_at=?,attempts=0,deferred_since=null,defer_kind=null,defer_reason=null where id=?`)
          .run(JSON.stringify({ sourceId, uuid, ...(graphId === undefined ? {} : { graphId }) }), dueAt, mine[0].id);
        for (const extra of mine.slice(1)) this.opDone(extra.id);
      } else {
        this.db.prepare("insert into memory_ops(provider, room, kind, payload, created_at, retry_at, account) values(?,?,'reingest',?,?,?,?)")
          .run(provider, room, JSON.stringify({ sourceId, uuid, ...(graphId === undefined ? {} : { graphId }) }), Date.now(), dueAt, account);
      }
      this.db.exec("release memory_replacement");
    } catch (error) { this.db.exec("rollback to memory_replacement; release memory_replacement"); throw error; }
  }

  replacements(provider: string, room: string, limit = 64, account?: string): MemoryOp[] {
    return this.ops(provider, limit, { room, kinds: ["reingest"], account });
  }

  replacementBlocker(provider: string, room: string, uuid: string, sourceId: string, keepVersion?: string, graphId?: string, account?: string): ReplacementBlocker | null {
    const op = this.pendingForget(provider, room, sourceId, uuid, graphId, account);
    if (op) return { kind: "deletion", op };
    const delivery = this.deliveries.unsettledVersion(provider, room, uuid, sourceId, keepVersion, graphId, account);
    return delivery ? { kind: "version", delivery } : null;
  }

  enqueue(provider: string, room: string, kind: MemoryOpKind, payload: Record<string, unknown>, account: string | null = this.generationAttachment(provider, room)?.account ?? null): void {
    this.db.prepare("insert into memory_ops(provider, room, kind, payload, created_at, account) values(?,?,?,?,?,?)")
      .run(provider, room, kind, JSON.stringify(payload), Date.now(), account);
  }

  identifyWrite(op: MemoryOp): string {
    const current = this.db.prepare("select payload from memory_ops where id=?").get(op.id);
    if (!current) throw new Error("The memory operation no longer exists");
    const payload = JSON.parse(String(current.payload)) as Record<string, unknown>;
    if (typeof payload.deliveryKey === "string") return payload.deliveryKey;
    const key = randomUUID();
    this.db.prepare("update memory_ops set payload=? where id=?").run(JSON.stringify({ ...payload, deliveryKey: key }), op.id);
    return key;
  }

  handoff(opId: string, cursor?: number, op?: MemoryOp): void {
    this.db.exec("savepoint memory_delivery_handoff");
    try {
      const row = this.deliveries.get(opId);
      if (!row?.payload || row.retiredAt !== null) throw new Error("Cannot hand off an erased memory delivery");
      if (row.groupId || this.db.prepare("select 1 from memory_delivery_group_member where op_id=?").get(opId))
        throw new Error("A grouped member requires whole part group handoff");
      if (cursor !== undefined) this.advance(row.identity.provider, row.identity.roomId, cursor);
      if (op) {
        const current = this.db.prepare("select payload from memory_ops where id=?").get(op.id);
        if (!current || JSON.parse(String(current.payload)).deliveryKey !== row.payload.binding?.opKey) throw new Error("Memory queue identity changed");
        this.opDone(op.id);
      }
      this.db.exec("release memory_delivery_handoff");
    } catch (error) {
      this.db.exec("rollback to memory_delivery_handoff; release memory_delivery_handoff");
      throw error;
    }
  }

  handoffPartGroup(groupId: string, cursor?: number, op?: MemoryOp): void {
    this.db.exec("savepoint memory_part_group_handoff");
    try {
      const group = this.deliveries.getPartGroup(groupId);
      if (!group || group.retired || this.importedSource(group.identity.roomId, group.identity.sourceId))
        throw new Error("Cannot hand off an erased or imported part group");
      if (cursor !== undefined && group.members.some(row => row.payload?.binding?.seq !== cursor))
        throw new Error("Part group cursor does not match the original source");
      const receipt = this.db.prepare("select * from memory_delivery_group_handoff where group_id=?").get(groupId);
      if (receipt && (receipt.cursor !== (cursor ?? null) || receipt.op_id !== (op?.id ?? null) || receipt.op_kind !== (op?.kind ?? null)))
        throw new Error("Part group handoff identity changed");
      if (!receipt && group.handedOffAt !== null) throw new Error("Part group handoff receipt is missing");
      let key: string | null = null;
      if (op) {
        if (op.provider !== group.identity.provider || op.room !== group.identity.roomId ||
            op.account !== undefined && op.account !== group.account) throw new Error("Part group queue scope changed");
        const current = this.db.prepare("select provider,room,kind,account,payload from memory_ops where id=?").get(op.id);
        const candidate = current ? JSON.parse(String(current.payload)).deliveryKey : receipt?.op_key;
        if (current && (current.provider !== op.provider || current.room !== op.room || current.kind !== op.kind ||
            current.account !== group.account) || (!current && !receipt) || typeof candidate !== "string" || !candidate ||
            receipt && receipt.op_key !== candidate || op.payload.deliveryKey !== undefined && op.payload.deliveryKey !== candidate ||
            group.members.some(row => row.payload?.binding?.opKey !== candidate))
          throw new Error("Part group queue identity changed");
        key = candidate;
      }
      if (!receipt) this.db.prepare("insert into memory_delivery_group_handoff values(?,?,?,?,?)")
        .run(groupId, cursor ?? null, op?.id ?? null, op?.kind ?? null, key);
      this.deliveries.handoffPartGroup(groupId, Date.now());
      if (cursor !== undefined) this.advance(group.identity.provider, group.identity.roomId, cursor);
      if (op) this.opDone(op.id);
      this.db.exec("release memory_part_group_handoff");
    } catch (error) {
      this.db.exec("rollback to memory_part_group_handoff; release memory_part_group_handoff");
      throw error;
    }
  }

  ops(provider: string, limit = 16, filter: { room?: string; kinds?: MemoryOpKind[]; runnable?: boolean; dueAt?: number; after?: number; account?: string } = {}): MemoryOp[] {
    if (filter.kinds?.length === 0) return [];
    const clauses = ["provider=?"], values: Array<string | number> = [provider];
    if (filter.room !== undefined) { clauses.push("room=?"); values.push(filter.room); }
    if (filter.account !== undefined) {
      clauses.push("(account=? or account is null and kind in ('note','fact','forget-room'))"); values.push(filter.account);
    }
    if (filter.dueAt !== undefined) { clauses.push("retry_at<=? and coalesce(defer_kind,'')!='expired'"); values.push(filter.dueAt); }
    if (filter.after !== undefined) { clauses.push("id>?"); values.push(filter.after); }
    if (filter.kinds) { clauses.push(`kind in (${filter.kinds.map(() => "?").join(",")})`); values.push(...filter.kinds); }
    if (filter.runnable) clauses.push(`not exists (select 1 from memory_imported_source i
      where memory_ops.kind in ('forget','reingest') and i.room=memory_ops.room and i.source_id=json_extract(memory_ops.payload,'$.sourceId'))`, `not exists (select 1 from memory_room_forget f
      where memory_ops.kind='forget-room' and f.provider=memory_ops.provider and f.room=memory_ops.room
        and f.uuid=json_extract(memory_ops.payload, '$.uuid') and f.request_id=json_extract(memory_ops.payload, '$.requestId')
        and f.state='failed' and f.retryable=0)`);
    return this.db.prepare(`select * from memory_ops where ${clauses.join(" and ")} order by id limit ?`).all(...values, limit).map(r => ({
      id: Number(r.id), provider: String(r.provider), room: String(r.room), kind: String(r.kind) as MemoryOpKind,
      payload: JSON.parse(String(r.payload)) as Record<string, unknown>, ...(r.account == null ? {} : { account: String(r.account) }), createdAt: Number(r.created_at), attempts: Number(r.attempts),
      retryAt: Number(r.retry_at), deferredSince: r.deferred_since === null ? null : Number(r.deferred_since),
      deferKind: r.defer_kind as MemoryOp["deferKind"], deferReason: r.defer_reason === null ? null : String(r.defer_reason),
    }));
  }

  deferOp(op: MemoryOp, kind: "processing" | "failed", reason: string, now: number): number | null {
    const since = op.deferredSince ?? now;
    if (now - since >= OP_DEFER_HORIZON_MS) {
      this.db.prepare(`update memory_ops set attempts=attempts+1,deferred_since=coalesce(deferred_since,?),defer_kind='expired',defer_reason=?
        where id=? and provider=? and kind in ('forget','reingest')`).run(now, reason, op.id, op.provider);
      return null;
    }
    const delay = kind === "failed" || now - since >= OP_STALLED_MS ? 300_000 : Math.min(60_000, 2000 * 2 ** Math.min(op.attempts, 5));
    const retryAt = now + delay;
    this.db.prepare(`update memory_ops set attempts=attempts+1,retry_at=?,deferred_since=coalesce(deferred_since,?),defer_kind=?,defer_reason=?
      where id=? and provider=? and kind in ('forget','reingest')`).run(retryAt, now, kind, reason, op.id, op.provider);
    return retryAt;
  }

  nextOpRetry(provider: string, room: string): number | null {
    const row = this.db.prepare(`select min(retry_at) retry_at from memory_ops where provider=? and room=? and kind='forget' and retry_at>0 and coalesce(defer_kind,'')!='expired'
      and not exists (select 1 from memory_imported_source i where i.room=memory_ops.room and i.source_id=json_extract(memory_ops.payload,'$.sourceId'))`).get(provider, room);
    return row?.retry_at == null ? null : Number(row.retry_at);
  }

  retryFailedOps(provider: string): void {
    this.db.prepare("update memory_ops set retry_at=0,defer_kind='failed' where provider=? and kind in ('forget','reingest') and defer_kind in ('failed','expired')").run(provider);
  }

  retryOp(provider: string, id: number, kind: "forget" | "reingest" = "forget"): boolean {
    return this.db.prepare("update memory_ops set retry_at=0,defer_kind='failed' where id=? and provider=? and kind=? and defer_kind in ('failed','expired')").run(id, provider, kind).changes === 1;
  }

  roomsWithOps(provider: string): string[] {
    return this.db.prepare("select distinct room from memory_ops where provider=?").all(provider).map(row => String(row.room));
  }

  forgetting(provider: string, room: string): boolean {
    return !!this.db.prepare("select 1 from memory_ops where provider=? and room=? and kind='forget-room' limit 1").get(provider, room);
  }

  roomForgetStatus(provider: string, room: string, uuid: string): RoomForgetStatus | null {
    const row = this.db.prepare("select * from memory_room_forget where provider=? and room=? and uuid=?").get(provider, room, uuid);
    const op = this.db.prepare("select id,created_at,json_extract(payload, '$.requestId') request_id from memory_ops where provider=? and room=? and kind='forget-room' and json_extract(payload, '$.uuid')=? order by id desc limit 1").get(provider, room, uuid);
    if (op && (!row || !op.request_id || op.request_id !== row.request_id)) return {
      requestId: String(op.request_id ?? `legacy-${op.id}`), state: "pending", requestedAt: Number(op.created_at), updatedAt: Number(op.created_at),
    };
    if (row) return {
      requestId: String(row.request_id), state: row.state as RoomForgetStatus["state"],
      requestedAt: Number(row.requested_at), updatedAt: Number(row.updated_at),
      ...(row.reason !== null ? { reason: String(row.reason), retryable: row.retryable === 1 } : {}),
    };
    return null;
  }

  prepareRoomForget(op: MemoryOp): MemoryOp {
    if (typeof op.payload.requestId === "string") return op;
    const requestId = randomUUID(), payload = { ...op.payload, requestId };
    this.db.exec("savepoint memory_prepare_forget");
    try {
      this.db.prepare("update memory_ops set payload=? where id=?").run(JSON.stringify(payload), op.id);
      this.recordRoomForget(op.provider, op.room, String(op.payload.uuid), requestId, "pending", op.createdAt);
      this.db.exec("release memory_prepare_forget");
    } catch (error) {
      this.db.exec("rollback to memory_prepare_forget; release memory_prepare_forget"); throw error;
    }
    return { ...op, payload };
  }

  private recordRoomForget(provider: string, room: string, uuid: string, requestId: string, state: RoomForgetStatus["state"], requestedAt: number, reason?: string, retryable?: boolean): void {
    this.db.prepare(`insert into memory_room_forget values(?,?,?,?,?,?,?,?,?)
      on conflict(provider,room,uuid) do update set request_id=excluded.request_id,state=excluded.state,
        requested_at=excluded.requested_at,updated_at=excluded.updated_at,reason=excluded.reason,retryable=excluded.retryable`)
      .run(provider, room, uuid, requestId, state, requestedAt, Date.now(), reason ?? null, retryable === undefined ? null : Number(retryable));
  }

  failRoomForget(op: MemoryOp, reason: string, retryable: boolean): void {
    this.recordRoomForget(op.provider, op.room, String(op.payload.uuid), String(op.payload.requestId), "failed", op.createdAt, reason, retryable);
    this.db.prepare("update memory_ops set attempts=attempts+1 where id=?").run(op.id);
  }

  retryRoomForget(provider: string, room: string, uuid: string): void {
    this.db.prepare("update memory_room_forget set state='pending',updated_at=?,reason=null,retryable=null where provider=? and room=? and uuid=? and state='failed'").run(Date.now(), provider, room, uuid);
  }

  retryProviderForgets(provider: string): void {
    this.db.prepare("update memory_room_forget set state='pending',updated_at=?,reason=null,retryable=null where provider=? and state='failed'").run(Date.now(), provider);
  }

  completeRoomForget(op: MemoryOp, cleanup: { clear: boolean; cursor?: number }): void {
    this.db.exec("savepoint memory_complete_forget");
    try {
      if (cleanup.clear) {
        this.clearRoomData(op.provider, op.room);
        if (cleanup.cursor !== undefined) this.resetCursor(op.provider, op.room, cleanup.cursor);
      }
      this.recordRoomForget(op.provider, op.room, String(op.payload.uuid), String(op.payload.requestId), "confirmed", op.createdAt);
      this.deliveries.graphDeleted(op.provider, String(op.payload.uuid));
      this.repairs.dropSelectiveGraph(op.provider, String(op.payload.uuid), op.account);
      this.db.prepare("delete from memory_graph_repair where provider=? and uuid=?").run(op.provider, String(op.payload.uuid));
      this.impacts.clear(op.provider, String(op.payload.uuid));
      this.opDone(op.id);
      this.db.exec("release memory_complete_forget");
    } catch (error) {
      this.db.exec("rollback to memory_complete_forget; release memory_complete_forget"); throw error;
    }
  }

  queueRoomForget(provider: string, room: string, payload: { uuid: string; name: string }, cursor: number): void {
    this.db.exec("savepoint memory_forget_room");
    try {
      this.clearRoomData(provider, room);
      this.db.prepare("delete from memory_ops where provider=? and room=?").run(provider, room);
      this.resetCursor(provider, room, cursor);
      const requestId = randomUUID();
      this.enqueue(provider, room, "forget-room", { ...payload, requestId });
      this.recordRoomForget(provider, room, payload.uuid, requestId, "pending", Date.now());
      this.db.exec("release memory_forget_room");
    } catch (error) {
      this.db.exec("rollback to memory_forget_room; release memory_forget_room");
      throw error;
    }
  }

  opDone(id: number): void {
    this.db.prepare("delete from memory_ops where id=?").run(id);
  }

  opFailed(id: number): boolean {
    this.db.prepare("update memory_ops set attempts = attempts + 1 where id=?").run(id);
    const row = this.db.prepare("select attempts,kind from memory_ops where id=?").get(id);
    if (!row || ["forget", "forget-room", "reingest"].includes(String(row.kind)) || Number(row.attempts) < OP_ATTEMPT_LIMIT) return false;
    this.db.prepare("delete from memory_ops where id=?").run(id);
    return true;
  }

  pending(provider: string): { ops: number } {
    const row = this.db.prepare("select count(*) as n from memory_ops where provider=?").get(provider);
    return { ops: row ? Number(row.n) : 0 };
  }

  saveBrief(provider: string, room: string, seq: number, lines: string[], asked: AskedQuestions, keep: number, facts?: Recalled[]): void {
    const text = JSON.stringify(lines), questions = JSON.stringify(asked);
    this.db.prepare(`insert into memory_message_brief values(?,?,?,?,?)
      on conflict(provider, room, seq) do update set lines=excluded.lines, asked=excluded.asked`).run(provider, room, seq, text, questions);
    if (facts) this.db.prepare(`insert into memory_recalled_brief values(?,?,?,?,?,?)
      on conflict(provider,room,seq) do update set lines=excluded.lines,asked=excluded.asked,facts=excluded.facts`).run(provider, room, seq, text, questions, JSON.stringify(facts.map(({ sources: _sources, ...fact }) => fact)));
    else this.db.prepare("delete from memory_recalled_brief where provider=? and room=? and seq=?").run(provider, room, seq);
    this.db.prepare(`delete from memory_message_brief where provider=? and room=? and seq not in
      (select seq from memory_message_brief where provider=? and room=? order by seq desc limit ?)`).run(provider, room, provider, room, keep);
    this.db.prepare(`delete from memory_recalled_brief where provider=? and room=? and seq not in
      (select seq from memory_message_brief where provider=? and room=?)`).run(provider, room, provider, room);
  }

  brief(provider: string, room: string, seq: number): { lines: string[]; asked: AskedQuestions; facts?: Recalled[] } | null {
    const row = this.db.prepare(`select b.lines,b.asked,f.facts from memory_message_brief b left join memory_recalled_brief f
      on f.provider=b.provider and f.room=b.room and f.seq=b.seq and f.lines=b.lines and f.asked=b.asked
      where b.provider=? and b.room=? and b.seq=?`).get(provider, room, seq);
    if (!row) return null;
    try {
      return { lines: (JSON.parse(String(row.lines)) as string[]).map(String), asked: JSON.parse(String(row.asked)) as AskedQuestions, ...(row.facts ? { facts: JSON.parse(String(row.facts)) as Recalled[] } : {}) };
    } catch { return null; }
  }

  clearRoomData(provider: string, room: string): void {
    invalidateOriginalSourceReceipts(this.db, { provider, room }, "room_memory_forgotten");
    this.recovery.cancelRoom(room, provider);
    this.repairs.dropSelectiveRoom(provider, room);
    this.deliveries.detach(provider, room, "room_memory_forgotten");
    this.db.prepare(`insert or ignore into memory_episode_retired(provider,room,external_id,account)
      select m.provider,m.room,m.external_id,coalesce(a.account,'') from memory_episode_map m
      left join memory_episode_account a using(provider,room,source_id,external_id) where m.provider=? and m.room=?`).run(provider, room);
    this.db.prepare("delete from memory_cursor where provider=? and room=?").run(provider, room);
    this.db.prepare("delete from memory_cursor_birth where provider=? and room=?").run(provider, room);
    this.db.prepare("delete from memory_version_skip where provider=? and room=?").run(provider, room);
    for (const row of this.db.prepare("select watch_id from memory_bound_watch where provider=? and room=?").all(provider, room)) this.deliveries.watches.close(String(row.watch_id));
    this.db.prepare("delete from memory_bound_watch where provider=? and room=?").run(provider, room);
    this.db.prepare("delete from memory_episode_map where provider=? and room=?").run(provider, room);
    this.db.prepare("delete from memory_episode_account where provider=? and room=?").run(provider, room);
    this.db.prepare("delete from memory_episode_source where provider=? and room=?").run(provider, room);
    this.db.prepare("delete from memory_source_admission where provider=? and room=?").run(provider, room);
    this.clearGraphBriefs(provider, room);
  }

  bindOperationAccount(op: MemoryOp, account: string): void {
    if (this.db.prepare(`update memory_ops set account=? where id=? and provider=? and room=?
      and (account is null or account=?)`).run(account, op.id, op.provider, op.room, account).changes !== 1)
      throw new Error("Memory operation account changed");
    op.account = account;
  }

  generationAttachment(provider: string, room: string): { account: string; uuid: string; copy: string; revision: string; graphId: string; check: boolean } | null {
    const row = this.db.prepare("select state from memory_generation_attachment where provider=? and room=?").get(provider, room);
    return row ? JSON.parse(String(row.state)) : null;
  }

  followGeneration(scope: GenerationNamespace, room: string, copy: string, revision: string, route: GenerationRoute, reset = false): void {
    const old = this.generationAttachment(scope.provider, room);
    if (old?.account === scope.account && old.uuid === scope.uuid && old.copy === copy && old.revision === revision) return;
    invalidateOriginalSourceReceipts(this.db, { provider: scope.provider, room }, "generation_followed");
    const check = reset || route.epoch !== 0 || !!old;
    if (check) {
      this.db.prepare(`insert or ignore into memory_source_admission select provider,room,?,?,source_id from memory_episode_map where provider=? and room=?`)
        .run(scope.uuid, copy, scope.provider, room);
      this.db.prepare(`insert into memory_cursor values(?,?,0) on conflict(provider,room) do update set seq=0`).run(scope.provider, room);
      this.db.prepare("delete from memory_version_skip where provider=? and room=?").run(scope.provider, room);
      for (const row of this.db.prepare("select watch_id from memory_bound_watch where provider=? and room=?").all(scope.provider, room)) this.deliveries.watches.close(String(row.watch_id));
      this.db.prepare("delete from memory_bound_watch where provider=? and room=?").run(scope.provider, room);
      this.db.prepare("delete from memory_episode_map where provider=? and room=?").run(scope.provider, room);
      this.db.prepare("delete from memory_episode_account where provider=? and room=?").run(scope.provider, room);
      this.db.prepare("delete from memory_episode_source where provider=? and room=?").run(scope.provider, room);
      this.clearGraphBriefs(scope.provider, room);
      this.reopenAllVersionChecks(room);
    }
    this.db.prepare(`insert into memory_generation_attachment values(?,?,?) on conflict(provider,room) do update set state=excluded.state`)
      .run(scope.provider, room, JSON.stringify({ account: scope.account, uuid: scope.uuid, copy, revision, graphId: route.graphId, check }));
  }

  invalidateRecoveryBriefs(provider: string): void {
    this.db.prepare("delete from memory_message_brief where provider=?").run(provider);
    this.db.prepare("delete from memory_recalled_brief where provider=?").run(provider);
  }

  private clearGraphBriefs(provider: string, room: string): void {
    this.db.prepare(`delete from memory_message_brief where provider=? and (room=? or exists (
      select 1 from memory_recalled_brief b, json_each(b.facts) f, json_each(f.value, '$.evidence') e
      where b.provider=memory_message_brief.provider and b.room=memory_message_brief.room
        and b.seq=memory_message_brief.seq and b.lines=memory_message_brief.lines and b.asked=memory_message_brief.asked
        and json_extract(e.value, '$.provider')=? and json_extract(e.value, '$.roomId')=?))`).run(provider, room, provider, room);
    this.db.prepare(`delete from memory_recalled_brief where provider=? and not exists (
      select 1 from memory_message_brief b where b.provider=memory_recalled_brief.provider
        and b.room=memory_recalled_brief.room and b.seq=memory_recalled_brief.seq)`).run(provider);
  }

  needsGraphRepair(provider: string, uuid: string, reason?: string): boolean {
    if (reason) this.db.prepare(`insert into memory_graph_repair values(?,?,?,?)
      on conflict(provider,uuid) do update set reason=excluded.reason`).run(provider, uuid, Date.now(), reason);
    return this.untracedRemoval(provider, uuid) || this.impacts.pending(provider, uuid);
  }

  repairContext(provider: string, uuid: string) {
    return { revision: this.repairs.revision(provider, uuid), unknownScope: this.untracedRemoval(provider, uuid), captures: this.impacts.snapshot(provider, uuid) };
  }
  private recoveryRepairCurrent(r: RecoveryRepairReceipt): boolean {
    const scope = r.scope, head = this.generations.head(scope), attachment = this.generationAttachment(scope.provider, scope.room);
    const job = this.recovery.get(r.jobId), sw = this.generations.switch(scope, r.switchId);
    const review = this.recoveryVerification.receipt(r.jobId);
    return !!job && job.state === "inputs_processed" && job.quoteFingerprint === r.quoteFingerprint && job.quote.graphId === scope.graphId
      && job.quote.scope.provider === scope.provider && job.quote.scope.account === scope.account && job.quote.scope.room === scope.room && job.quote.scope.uuid === scope.uuid
      && !!sw && sw.state === "confirmed" && sw.wanted.graphId === scope.graphId && sw.wanted.copy === job.quote.copyId
      && sw.sourceFingerprint === r.sourceFingerprint && job.quote.sourceFingerprint === r.sourceFingerprint
      && !!review && review.quoteFingerprint === r.quoteFingerprint && review.reportFingerprint === r.reportFingerprint
      && review.sourceFingerprint === r.sourceFingerprint && review.knowledgeFingerprint === r.knowledgeFingerprint && review.repairFingerprint === r.repairFingerprint
      && recoveryFingerprint(review) === r.reviewFingerprint
      && !!head.route && !head.reason && !head.followPending && head.revision === scope.revision && head.route.graphId === scope.graphId
      && head.route.epoch === sw.wanted.epoch && head.route.copy === sw.wanted.copy
      && !!attachment && attachment.account === scope.account && attachment.uuid === scope.uuid && attachment.revision === scope.revision && attachment.graphId === scope.graphId
      && this.deliveries.currentCopy({ provider: scope.provider, roomId: scope.room, roomUuid: scope.uuid, copyId: attachment.copy });
  }
  private selectiveRepairScopeCurrent(scope: SelectiveRepairScope): boolean {
    const head = this.generations.head(scope), attachment = this.generationAttachment(scope.provider, scope.room);
    return !!head.route && !head.reason && !head.followPending && head.revision === scope.revision && head.route.graphId === scope.graphId &&
      !!attachment && attachment.account === scope.account && attachment.uuid === scope.uuid && attachment.revision === scope.revision &&
      attachment.graphId === scope.graphId && attachment.copy === scope.copyId &&
      this.deliveries.currentCopy({ provider: scope.provider, roomId: scope.room, roomUuid: scope.uuid, copyId: scope.copyId }) &&
      this.deliveries.copyAccount({ provider: scope.provider, roomId: scope.room, roomUuid: scope.uuid, copyId: scope.copyId }) === scope.account;
  }
  private repairCovered(provider: string, uuid: string, scope?: RecoveryScope): boolean {
    return !!scope && scope.provider === provider && scope.uuid === uuid && this.repairs.covered(scope);
  }

  needsFactRepair(provider: string, uuid: string, factIds: string[], scope?: RecoveryScope): boolean {
    return !this.repairCovered(provider, uuid, scope) && this.impacts.affected(provider, uuid, "edge", factIds);
  }

  needsNodeRepair(provider: string, uuid: string, nodeIds: string[], scope?: RecoveryScope): boolean {
    return !this.repairCovered(provider, uuid, scope) && (this.untracedRemoval(provider, uuid) || this.impacts.affected(provider, uuid, "node", nodeIds));
  }

  untracedRemoval(provider: string, uuid: string, scope?: RecoveryScope): boolean {
    return !this.repairCovered(provider, uuid, scope) && !!this.db.prepare("select 1 from memory_graph_repair where provider=? and uuid=?").get(provider, uuid);
  }

  forgottenRooms(provider: string): Array<RoomForgetStatus & { room: string; uuid: string }> {
    return this.db.prepare("select * from memory_room_forget where provider=? and state!='confirmed' order by requested_at").all(provider)
      .map(row => ({ room: String(row.room), uuid: String(row.uuid), requestId: String(row.request_id), state: row.state as RoomForgetStatus["state"],
        requestedAt: Number(row.requested_at), updatedAt: Number(row.updated_at), ...(row.reason === null ? {} : { reason: String(row.reason), retryable: row.retryable === 1 }) }));
  }

  dropRoom(provider: string, room: string, preserveForgets = false): void {
    this.deliveries.detach(provider, room);
    this.clearRoomData(provider, room);
    this.db.prepare("delete from memory_episode_retired where provider=? and room=?").run(provider, room);
    this.db.prepare(`delete from memory_ops where provider=? and room=?${preserveForgets ? " and kind!='forget-room'" : ""}`).run(provider, room);
  }

  localRooms(): string[] {
    return this.db.prepare([...ROOM_TABLES, ...LOCAL_TABLES].map(table => `select room from ${table}`).join(" union ") +
      " union select room from memory_original_source_receipt where state='active'").all().map(row => String(row.room));
  }

  dropLocalRoom(room: string): void {
    this.db.exec("savepoint memory_local_removal");
    try {
      this.recovery.cancelRoom(room);
      this.episodeIndex.dropRoom(room);
      this.deliveries.detachLocal(room);
      for (const table of LOCAL_TABLES) this.db.prepare(`delete from ${table} where room=?`).run(room);
      const providers = this.db.prepare(ROOM_TABLES.map(table => `select provider from ${table} where room=?`).join(" union ") +
        " union select provider from memory_original_source_receipt where room=?").all(...ROOM_TABLES.map(() => room), room);
      for (const row of providers) this.dropRoom(String(row.provider), room, true);
      this.db.exec("release memory_local_removal");
    } catch (error) {
      this.db.exec("rollback to memory_local_removal; release memory_local_removal");
      throw error;
    }
  }
}
