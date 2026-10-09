// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { performance } from "node:perf_hooks";
import { isAsyncFunction } from "node:util/types";
import type { SqliteConnection } from "../sqlite-capabilities.js";
import type { EpisodeSource, MemoryEpisode, MemoryFact } from "./provider.js";
import type { RecoveryInventoryReader } from "./recovery-sources.js";
import type { RecoveryKnowledgeReader } from "./recovery-knowledge.js";
import { MemoryDeliveryWatch } from "./delivery-watch.js";
import { EPISODE_INDEX_CLOCK_MARGIN_MS, type MemoryEpisodeIndex } from "./episode-index.js";
import type { OriginalInputPlan } from "./original-input.js";
import type { SourceBodyReader, OriginalSourceClassificationReader } from "./source-body-proof.js";
import { compatibleSourceBodies } from "./source-body-proof.js";
import type { PartGroupAdoptionRequest, PartGroupAdoptionResult } from "./part-group-adoption.js";
import { DELIVERY_FRESH_READ_MAX_AGE_MS, freshCompleteReadTimes } from "./delivery-read-freshness.js";
import type { GroupPreflightResult } from "./group-preflight.js";
import { ensureOriginalSourceSchema, originalReceiptOccupied, invalidateOriginalSourceReceipts } from "./original-source-schema.js";
export { DELIVERY_FRESH_READ_MAX_AGE_MS } from "./delivery-read-freshness.js";
import { partGroupDescriptor, partGroupIdentity, snapshotPartGroupPlan, validPartGroupDescriptor,
  type PartGroup, type PartGroupScope, type PartGroupPreparation, type SourceDelivery } from "./part-group.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface WriteIdentity {
  provider: string;
  roomId: string;
  roomUuid: string;
  graphId?: string;
  maintenanceId?: string;
  copyId: string;
  sourceId: string;
  version: string;
  part: string;
  kind: "episode" | "fact";
  generation?: number;
}
export interface WritePayload {
  format: string;
  request: { [key: string]: JsonValue };
  estimatedCredits: number;
  binding?: { source?: EpisodeSource; seq?: number; opKey?: string;
    original?: { kind: "note"; episode: MemoryEpisode } | { kind: "fact"; fact: MemoryFact } };
}
export type DeliveryState = "prepared" | "unknown" | "accepted" | "processed" | "rejected" | "conflict" | "duplicates";
export interface Delivery {
  opId: string;
  groupId?: string;
  identity: WriteIdentity;
  sourceVersion?: string;
  payload: WritePayload | null;
  retiredAt: number | null;
  retirement: string | null;
  cleanup: "pending" | "episodes_deleted" | "graph_deleted" | "not_requested" | null;
  state: DeliveryState;
  preparedAt: number;
  updatedAt: number;
  attemptedAt: number | null;
  attempts: number;
  replays: number;
  replayAllowance: number;
  retryAt: number | null;
  month: string | null;
  externalIds: string[];
  reason: string | null;
  acknowledged: boolean;
  carried: boolean;
}
export type PreparedDelivery = Delivery & { payload: WritePayload };
export const isPreparedDelivery = (row: Delivery): row is PreparedDelivery => row.payload !== null && row.retiredAt === null;
export type WriteObservation =
  | { state: "not_applied"; reason: string; retryAfterMs?: number; externalIds?: never }
  | { state: "accepted" | "processed"; externalIds: string[] }
  | { state: "unknown" | "rejected" | "conflict" | "duplicates"; reason: string; externalIds?: string[] };
export type ReadObservation = (Exclude<WriteObservation, { state: "not_applied" }> | { state: "absent"; externalIds?: never; represented?: string; representedCopy?: string })
  & { scan?: ScanEvidence };
export interface ScanEvidence { startedAt: number; finishedAt: number; indexedFrom?: number }
export const UNKNOWN_REPLAY_WAIT_MS = 10 * 60_000;
export type EpisodeInventory = { state: "complete"; episodes: Array<{ id: string; processed: boolean }>; scan?: ScanEvidence }
  | { state: "unknown" | "conflict"; reason: string };
export interface ListedEpisode {
  id: string;
  processed: boolean;
  sourceId: string;
  version: string;
  part: string;
  kind: "message" | "note";
  opId: string | null;
  copyId: string | null;
  carryHash: string | null;
  legacy?: true;
}
export type SourceListing = { state: "complete"; bySource: ReadonlyMap<string, readonly ListedEpisode[]>; startedAt: number; finishedAt: number }
  | { state: "unknown"; reason: string; startedAt: number; finishedAt: number };
interface AbsenceCheck extends ScanEvidence { attempt: number }
export interface WriteTransport {
  sourceBodyProof?: SourceBodyReader;
  originalSourceClassification?: OriginalSourceClassificationReader;
  originalSourceBodyProof?: SourceBodyReader;
  recoveryKnowledge?: RecoveryKnowledgeReader["recoveryKnowledge"];
  readonly provider: string;
  recoveryInventory?: RecoveryInventoryReader["recoveryInventory"];
  validate(delivery: PreparedDelivery): void;
  send(delivery: PreparedDelivery, signal?: AbortSignal): Promise<WriteObservation>;
  reconcile(delivery: PreparedDelivery, signal?: AbortSignal, options?: { fresh?: boolean }): Promise<ReadObservation>;
  inventory?(delivery: Delivery, signal?: AbortSignal): Promise<EpisodeInventory>;
  episodePresence?(id: string, signal?: AbortSignal): Promise<"present" | "absent" | "unknown">;
  factPresence?(id: string, signal?: AbortSignal): Promise<"present" | "absent" | "unknown">;
  sources?(graphUuid: string, signal: AbortSignal, now: () => number, graphId?: string): Promise<SourceListing>;
  usingIndex?(index: MemoryEpisodeIndex, now: () => number,
    onSources?: (graph: string, listing: SourceListing, reads: WriteTransport, signal: AbortSignal, graphId?: string) => Promise<void>): WriteTransport;
  sourceEpisodes?(graphUuid: string, sourceId: string, signal: AbortSignal, graphId?: string): Promise<{ state: "complete"; episodes: ListedEpisode[] } | { state: "unknown"; reason: string }>;
  advanceIndex?(graphUuid: string, signal: AbortSignal, graphId?: string): Promise<SourceListing | void>;
  nextIndexRead?(graphUuid: string, graphId?: string): number | null;
  dropIndex?(graphUuid: string, graphId?: string): void;
  readCycle?(opIds: ReadonlySet<string>, signal: AbortSignal, now: () => number, requiredFrom?: number): WriteTransport;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.entries(value as object).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  }
  throw new Error("A memory delivery must contain only finite JSON values");
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freezeSnapshot(child); Object.freeze(value); }
  return value;
}
export class DeliveryBudgetError extends Error {
  constructor() { super("The memory delivery would exceed its monthly reserved credit budget"); }
}
class PartGroupAdoptionHold extends Error {}

export class MemoryDeliveryStore {
  readonly watches: MemoryDeliveryWatch;
  constructor(private readonly db: SqliteConnection) {
    this.watches = new MemoryDeliveryWatch(db);
    db.exec(`create table if not exists memory_delivery_account(
      provider text not null, room text not null, uuid text not null, copy_id text not null, account text not null,
      primary key(provider,room,uuid,copy_id));`);
    db.exec(`create table if not exists memory_delivery(
      op_id text primary key, identity_key text not null unique, identity text not null,
      provider text not null, room_uuid text not null, source_id text not null,
      payload text, payload_hash text, state text not null, retired_at integer, retirement text, cleanup text, check_at integer not null default 0,
      prepared_at integer not null, updated_at integer not null, attempted_at integer,
      attempts integer not null default 0, replays integer not null default 0, replay_allowance integer not null default 1, retry_at integer,
      month text, estimated_credits integer not null, external_ids text not null default '[]',
      reason text, acknowledged integer not null default 0);
      create index if not exists memory_delivery_source on memory_delivery(provider,room_uuid,source_id);
      create index if not exists memory_delivery_due on memory_delivery(provider,json_extract(identity,'$.roomId'),retired_at,check_at);
      create index if not exists memory_delivery_local_source on memory_delivery(source_id,json_extract(identity,'$.roomId'),retired_at);
      create table if not exists memory_delivery_attempt(
        op_id text not null, attempt integer not null, provider text not null, month text not null,
        estimated_credits integer not null, reserved integer not null default 1, started_at integer not null,
        cause text not null, scan_started_at integer, scan_finished_at integer, dispatched_at integer,
        primary key(op_id,attempt));
      create index if not exists memory_delivery_attempt_budget on memory_delivery_attempt(provider,month,reserved);
      create table if not exists memory_delivery_copy(
        provider text not null, room text not null, uuid text not null, copy_id text not null,
        primary key(provider,room));
      create table if not exists memory_usage(provider text not null, month text not null, credits integer not null, primary key(provider,month));`);
    db.exec(`create table if not exists memory_delivery_maintenance(
      op_id text primary key, canonical_id text, state text not null, reason text,
      since integer not null, checks integer not null default 0, check_at integer not null default 0,
      survivor_edges text not null default '[]', cleared_scan_at integer);
      create table if not exists memory_delivery_removed(
        op_id text not null, episode_id text not null, removed_at integer not null,
        primary key(op_id,episode_id));`);
    if (!db.prepare("pragma table_info(memory_delivery_attempt)").all().some(column => column.name === "dispatched_at"))
      db.exec("alter table memory_delivery_attempt add column dispatched_at integer; update memory_delivery_attempt set dispatched_at=started_at");
    if (!db.prepare("pragma table_info(memory_delivery_attempt)").all().some(column => column.name === "scan_indexed_from"))
      db.exec("alter table memory_delivery_attempt add column scan_indexed_from integer");
    if (!db.prepare("pragma table_info(memory_delivery)").all().some(column => column.name === "carried"))
      db.exec("alter table memory_delivery add column carried integer not null default 0");
    if (!db.prepare("pragma table_info(memory_delivery)").all().some(column => column.name === "source_version"))
      db.exec("alter table memory_delivery add column source_version text");
    if (!db.prepare("pragma table_info(memory_delivery_maintenance)").all().some(column => column.name === "cleared_scan_at"))
      db.exec("alter table memory_delivery_maintenance add column cleared_scan_at integer");
    db.exec(`create table if not exists memory_delivery_foreign(
      op_id text not null, episode_id text not null, copy_id text not null, primary key(op_id,episode_id));
      create table if not exists memory_delivery_adoption(op_id text primary key);`);
    if (!db.prepare("pragma table_info(memory_delivery)").all().some(column => column.name === "group_id"))
      db.exec("alter table memory_delivery add column group_id text");
    db.exec(`create table if not exists memory_delivery_group(
      group_id text primary key, identity_key text not null unique, identity text not null, account text,
      descriptor text not null, manifest_hash text not null, part_count integer not null check(part_count between 1 and 64),
      prepared_at integer not null, handed_off_at integer);
      create table if not exists memory_delivery_group_member(
        group_id text not null, part_index integer not null check(part_index between 1 and 64), part text not null,
        op_id text not null unique, primary key(group_id,part_index), unique(group_id,part));
      create table if not exists memory_delivery_group_handoff(
        group_id text primary key, cursor integer, op_id integer, op_kind text, op_key text);
      create index if not exists memory_delivery_group_rows on memory_delivery(group_id);`);
    ensureOriginalSourceSchema(db);
  }

  private transaction<T>(work: () => T): T {
    this.db.exec("savepoint memory_delivery_change");
    try {
      const value = work();
      this.db.exec("release memory_delivery_change");
      return value;
    } catch (error) {
      this.db.exec("rollback to memory_delivery_change; release memory_delivery_change");
      throw error;
    }
  }

  prepare(identity: WriteIdentity, build: (opId: string) => WritePayload, now = Date.now(), options: { renew?: boolean; carried?: boolean } = {}): Delivery {
    for (const key of ["provider", "roomId", "roomUuid", "copyId", "sourceId", "version", "part"] as const) {
      if (typeof identity[key] !== "string" || !identity[key]) throw new Error(`Missing delivery identity: ${key}`);
    }
    if (!["episode", "fact"].includes(identity.kind) || !Number.isSafeInteger(now) ||
        (identity.graphId !== undefined && (typeof identity.graphId !== "string" || !identity.graphId || identity.graphId.length > 512)) ||
        (identity.generation !== undefined && (!Number.isSafeInteger(identity.generation) || identity.generation < 1)) ||
        (identity.maintenanceId !== undefined && !/^[0-9a-f-]{36}$/.test(identity.maintenanceId))) throw new Error("Invalid delivery identity or time");
    return this.transaction(() => {
      const latest = this.latest(identity);
      if (latest?.groupId) {
        if (options.renew) throw new Error("A part group needs an explicit common B7 renewal");
        return latest;
      }
      if (identity.kind === "episode" && identity.maintenanceId === undefined && this.groupRow(identity))
        throw new Error("Use the whole part group preparation API");
      if (latest && (latest.retiredAt === null || !options.renew)) return latest;
      if (latest) identity = { ...identity, generation: (latest.identity.generation ?? 0) + 1 };
      const identityJson = canonical(identity);
      const opId = randomUUID(), payload = build(opId);
      if (!payload.format || !Number.isSafeInteger(payload.estimatedCredits) || payload.estimatedCredits < 0) throw new Error("Invalid delivery payload");
      const payloadJson = canonical(payload);
      if (Buffer.byteLength(payloadJson) > 1024 * 1024) throw new Error("Memory delivery payload exceeds 1 MiB");
      this.db.prepare(`insert into memory_delivery(op_id,identity_key,identity,provider,room_uuid,source_id,payload,payload_hash,state,prepared_at,updated_at,estimated_credits,carried)
        values(?,?,?,?,?,?,?,?,'prepared',?,?,?,?)`).run(opId, identityJson, identityJson, identity.provider, identity.roomUuid, identity.sourceId,
        payloadJson, hash(payloadJson), now, now, payload.estimatedCredits, options.carried ? 1 : 0);
      return this.get(opId)!;
    });
  }

  get(opId: string): Delivery | null {
    const row = this.db.prepare("select * from memory_delivery where op_id=?").get(opId);
    if (!row) return null;
    if (row.retired_at === null ? row.payload === null || hash(String(row.payload)) !== row.payload_hash : row.payload !== null || row.payload_hash !== null) throw new Error("Memory delivery payload integrity check failed");
    return { opId: String(row.op_id), identity: JSON.parse(String(row.identity)) as WriteIdentity,
      ...(typeof row.group_id === "string" ? { groupId: row.group_id } : {}),
      ...(typeof row.source_version === "string" ? { sourceVersion: row.source_version } : {}),
      payload: row.payload === null ? null : JSON.parse(String(row.payload)) as WritePayload, state: row.state as DeliveryState,
      retiredAt: row.retired_at === null ? null : Number(row.retired_at), retirement: row.retirement === null ? null : String(row.retirement),
      cleanup: row.cleanup as Delivery["cleanup"],
      preparedAt: Number(row.prepared_at), updatedAt: Number(row.updated_at),
      attemptedAt: row.attempted_at === null ? null : Number(row.attempted_at), month: row.month === null ? null : String(row.month),
      attempts: Number(row.attempts), replays: Number(row.replays), replayAllowance: Number(row.replay_allowance), retryAt: row.retry_at === null ? null : Number(row.retry_at),
      externalIds: JSON.parse(String(row.external_ids)) as string[], reason: row.reason === null ? null : String(row.reason), acknowledged: row.acknowledged === 1, carried: row.carried === 1 };
  }

  find(identity: WriteIdentity): Delivery | null {
    const row = this.db.prepare("select op_id from memory_delivery where identity_key=?").get(canonical(identity));
    return row ? this.get(String(row.op_id)) : null;
  }

  latest(identity: WriteIdentity): Delivery | null {
    const row = this.db.prepare(`select op_id from memory_delivery where provider=? and room_uuid=? and source_id=?
      and json_extract(identity,'$.roomId')=? and json_extract(identity,'$.copyId')=? and json_extract(identity,'$.version')=?
      and json_extract(identity,'$.part')=? and json_extract(identity,'$.kind')=?
      and coalesce(json_extract(identity,'$.graphId'),'')=?
      order by coalesce(json_extract(identity,'$.generation'),0) desc limit 1`)
      .get(identity.provider, identity.roomUuid, identity.sourceId, identity.roomId, identity.copyId, identity.version, identity.part, identity.kind, identity.graphId ?? "");
    return row ? this.get(String(row.op_id)) : null;
  }

  projected(identity: WriteIdentity): Delivery | null {
    const row = this.db.prepare(`select op_id from memory_delivery where provider=? and room_uuid=? and source_id=?
      and json_extract(identity,'$.roomId')=? and json_extract(identity,'$.copyId')=? and source_version=?
      and json_extract(identity,'$.part')=? and json_extract(identity,'$.kind')=?
      and coalesce(json_extract(identity,'$.graphId'),'')=? order by prepared_at desc,op_id limit 1`)
      .get(identity.provider, identity.roomUuid, identity.sourceId, identity.roomId, identity.copyId, identity.version, identity.part, identity.kind, identity.graphId ?? "");
    return row ? this.get(String(row.op_id)) : null;
  }

  private groupRow(identity: Omit<WriteIdentity, "part">, account: string | null = this.copyAccount(identity)) {
    const scope = partGroupIdentity({ provider: identity.provider, roomId: identity.roomId, roomUuid: identity.roomUuid,
      copyId: identity.copyId, sourceId: identity.sourceId, version: identity.version, kind: "episode", account,
      ...(identity.graphId === undefined ? {} : { graphId: identity.graphId }) });
    return this.db.prepare("select * from memory_delivery_group where identity_key=?").get(canonical({ identity: scope, account }));
  }

  lookupSourceDelivery(scope: PartGroupScope): SourceDelivery | null {
    const identity = partGroupIdentity(scope);
    if (this.copyAccount(identity) !== scope.account) throw new Error("Part group account ownership is unproven or changed");
    const rows = this.db.prepare(`select op_id from memory_delivery where provider=? and room_uuid=? and source_id=?
      and json_extract(identity,'$.roomId')=? and json_extract(identity,'$.copyId')=?
      and (json_extract(identity,'$.version')=? or source_version=?) and json_extract(identity,'$.kind')='episode'
      and json_extract(identity,'$.maintenanceId') is null and coalesce(json_extract(identity,'$.graphId'),'')=?
      order by coalesce(json_extract(identity,'$.generation'),0) desc,prepared_at desc,op_id`)
      .all(identity.provider, identity.roomUuid, identity.sourceId, identity.roomId, identity.copyId,
        identity.version, identity.version, identity.graphId ?? "").map(row => this.get(String(row.op_id))!);
    const header = this.groupRow(identity, scope.account);
    if (header) {
      const group = this.getPartGroup(String(header.group_id))!;
      if (rows.length !== group.members.length || rows.some(row => row.groupId !== group.groupId))
        throw new Error("Mixed part group source rows");
      return { kind: "part-group", group };
    }
    if (rows.some(row => row.groupId || row.identity.part !== "1/1" ||
        this.db.prepare("select 1 from memory_delivery_group_member where op_id=?").get(row.opId)))
      throw new Error("Orphan or mixed part group source rows");
    return rows.length ? { kind: "legacy-single", delivery: rows[0] } : null;
  }
  originalSourceOccupied(scope: PartGroupScope): boolean { return originalReceiptOccupied(this.db, scope); }

  groupedSource(provider: string, room: string, sourceId: string, version: string | undefined, graphId?: string): boolean {
    const common = [provider, room, sourceId, graphId ?? "", ...(version === undefined ? [] : [version])];
    const header = this.db.prepare(`select 1 from memory_delivery_group where json_extract(identity,'$.provider')=?
      and json_extract(identity,'$.roomId')=? and json_extract(identity,'$.sourceId')=?
      and coalesce(json_extract(identity,'$.graphId'),'')=? ${version === undefined ? "" : "and json_extract(identity,'$.version')=?"} limit 1`).get(...common);
    if (header) return true;
    return !!this.db.prepare(`select 1 from memory_delivery d where d.provider=? and json_extract(d.identity,'$.roomId')=?
      and d.source_id=? and coalesce(json_extract(d.identity,'$.graphId'),'')=?
      ${version === undefined ? "" : "and (json_extract(d.identity,'$.version')=? or d.source_version=?)"}
      and (d.group_id is not null or (json_extract(d.identity,'$.part')!='1/1' and json_extract(d.identity,'$.maintenanceId') is null) or exists
        (select 1 from memory_delivery_group_member m where m.op_id=d.op_id)) limit 1`)
      .get(provider, room, sourceId, graphId ?? "", ...(version === undefined ? [] : [version, version]));
  }

  getPartGroup(groupId: string): PartGroup | null {
    const header = this.db.prepare("select * from memory_delivery_group where group_id=?").get(groupId);
    if (!header) return null;
    const identity = JSON.parse(String(header.identity)), account = header.account === null ? null : String(header.account);
    const scope = { ...identity, account } as PartGroupScope;
    const validated = partGroupIdentity(scope), descriptor = JSON.parse(String(header.descriptor));
    if (canonical(validated) !== String(header.identity) || canonical({ identity: validated, account }) !== header.identity_key ||
        this.copyAccount(validated) !== account || !validPartGroupDescriptor(descriptor) || descriptor.parts.length !== header.part_count ||
        !Number.isSafeInteger(header.prepared_at) || header.handed_off_at !== null && !Number.isSafeInteger(header.handed_off_at) ||
        hash(canonical({ groupId, identity: validated, account, descriptor, preparedAt: header.prepared_at })) !== header.manifest_hash)
      throw new Error("Part group manifest integrity check failed");
    const links = this.db.prepare("select * from memory_delivery_group_member where group_id=? order by part_index").all(groupId);
    const owned = this.db.prepare("select op_id from memory_delivery where group_id=?").all(groupId);
    if (links.length !== descriptor.parts.length || owned.length !== links.length) throw new Error("Incomplete part group membership");
    const members = links.map((link, index) => {
      const part = descriptor.parts[index], row = this.get(String(link.op_id));
      if (link.part_index !== index + 1 || link.part !== part.part || link.op_id !== part.opId || !row || row.groupId !== groupId ||
          canonical(row.identity) !== canonical({ ...validated, part: part.part }) ||
          row.payload !== null && (row.payload.estimatedCredits !== part.estimatedCredits || hash(canonical(row.payload)) !== part.payloadHash))
        throw new Error("Part group member integrity check failed");
      return row;
    });
    const retired = members.some(row => row.retiredAt !== null);
    return { groupId, identity: validated, account, descriptor, members,
      handedOffAt: header.handed_off_at === null ? null : Number(header.handed_off_at), retired,
      accepted: !retired && members.every(row => ["accepted", "processed"].includes(row.state) && row.externalIds.length > 0),
      processed: !retired && members.every(row => row.state === "processed" && row.externalIds.length > 0) };
  }

  preparePartGroup(scope: PartGroupScope, input: OriginalInputPlan, options: PartGroupPreparation, now = Date.now()): SourceDelivery {
    scope = Object.freeze({ ...scope });
    const identity = partGroupIdentity(scope);
    if (!Number.isSafeInteger(now)) throw new Error("Invalid part group preparation time");
    return this.transaction(() => {
      const saved = this.lookupSourceDelivery(scope);
      if (originalReceiptOccupied(this.db, scope)) throw new Error("Original source receipt requires explicit reconciliation before paid preparation");
      if (saved) return saved;
      if (!this.currentCopy(identity)) throw new Error("Part group copy changed");
      const plan = snapshotPartGroupPlan(scope, input);
      const callbacks = { build: options?.build, validate: options?.validate, current: options?.current };
      if (Object.values(callbacks).some(fn => typeof fn !== "function" || isAsyncFunction(fn)))
        throw new Error("Part group callbacks must be synchronous and local");
      const fence = () => {
        const result: unknown = callbacks.current();
        if (result && typeof (result as PromiseLike<unknown>).then === "function" || result !== true ||
            !this.currentCopy(identity) || this.copyAccount(identity) !== scope.account)
          throw new Error("Part group source scope changed or guard is not synchronous");
        if (originalReceiptOccupied(this.db, scope)) throw new Error("Original source receipt appeared during paid preparation");
      };
      fence();
      const groupId = randomUUID(), identityJson = canonical(identity), key = canonical({ identity, account: scope.account });
      this.db.prepare(`insert into memory_delivery_group(group_id,identity_key,identity,account,descriptor,manifest_hash,part_count,prepared_at)
        values(?,?,?,?,'{}','',?,?)`).run(groupId, key, identityJson, scope.account, plan.parts.length, now);
      const prepared: Array<{ opId: string; payloadHash: string }> = [];
      for (const part of plan.parts) {
        fence();
        const memberIdentity: WriteIdentity = Object.freeze({ ...identity, part: part.part }), opId = randomUUID();
        const payload = callbacks.build(memberIdentity, opId, part);
        if (!payload || typeof payload !== "object" || typeof (payload as unknown as PromiseLike<unknown>).then === "function" ||
            !payload.format || payload.estimatedCredits !== part.estimatedCredits)
          throw new Error("Invalid part group payload or credit estimate");
        const source = payload.binding?.source;
        if (!source || source.kind !== "message" || source.version !== plan.source.version || source.authorId !== plan.source.authorId ||
            source.authorName !== plan.source.authorName || source.ts !== plan.source.ts || source.graphId !== identity.graphId ||
            payload.binding?.seq !== plan.source.seq)
          throw new Error("Part group payload original binding mismatch");
        const payloadJson = canonical(payload), payloadHash = hash(payloadJson);
        if (Buffer.byteLength(payloadJson) > 1024 * 1024) throw new Error("Memory delivery payload exceeds 1 MiB");
        this.db.prepare(`insert into memory_delivery(op_id,identity_key,identity,provider,room_uuid,source_id,payload,payload_hash,
          state,prepared_at,updated_at,estimated_credits,group_id) values(?,?,?,?,?,?,?,?,'prepared',?,?,?,?)`)
          .run(opId, canonical(memberIdentity), canonical(memberIdentity), identity.provider, identity.roomUuid, identity.sourceId,
            payloadJson, payloadHash, now, now, part.estimatedCredits, groupId);
        this.db.prepare("insert into memory_delivery_group_member values(?,?,?,?)").run(groupId, prepared.length + 1, part.part, opId);
        const result: unknown = callbacks.validate(freezeSnapshot(this.get(opId) as PreparedDelivery), part);
        if (result && typeof (result as PromiseLike<unknown>).then === "function") throw new Error("Part group validation must be synchronous");
        prepared.push({ opId, payloadHash });
        fence();
      }
      const descriptor = partGroupDescriptor(plan, prepared), descriptorJson = canonical(descriptor);
      this.db.prepare("update memory_delivery_group set descriptor=?,manifest_hash=? where group_id=?").run(descriptorJson,
        hash(canonical({ groupId, identity, account: scope.account, descriptor, preparedAt: now })), groupId);
      const group = this.getPartGroup(groupId)!;
      fence();
      return { kind: "part-group", group };
    });
  }

  dispatchAdmitted(opId: string): boolean {
    const row = this.db.prepare("select group_id from memory_delivery where op_id=?").get(opId);
    if (!row) return false;
    const link = this.db.prepare("select group_id from memory_delivery_group_member where op_id=?").get(opId);
    if (row.group_id === null) {
      try {
        const saved = this.get(opId)!;
        return !link && !this.groupedSource(saved.identity.provider, saved.identity.roomId, saved.identity.sourceId,
          saved.sourceVersion ?? saved.identity.version, saved.identity.graphId);
      } catch { return false; }
    }
    if (typeof row.group_id !== "string" || link?.group_id !== row.group_id) return false;
    try {
      const group = this.getPartGroup(row.group_id);
      const receipt = this.db.prepare("select * from memory_delivery_group_handoff where group_id=?").get(row.group_id);
      if (!group || group.handedOffAt === null || group.retired || !this.currentCopy(group.identity) || !receipt) return false;
      if (receipt.cursor !== null && (typeof receipt.cursor !== "number" || !Number.isSafeInteger(receipt.cursor) || receipt.cursor < 0 ||
          group.members.some(member => member.payload?.binding?.seq !== receipt.cursor))) return false;
      if (receipt.op_id === null) return receipt.op_kind === null && receipt.op_key === null;
      return typeof receipt.op_id === "number" && Number.isSafeInteger(receipt.op_id) && receipt.op_id > 0 &&
        ["fact", "note", "forget", "reingest", "forget-room"].includes(String(receipt.op_kind)) &&
        typeof receipt.op_key === "string" && receipt.op_key.length > 0 &&
        group.members.every(member => member.payload?.binding?.opKey === receipt.op_key);
    }
    catch { return false; }
  }

  handoffPartGroup(groupId: string, now: number): PartGroup {
    const group = this.getPartGroup(groupId);
    if (!group || group.retired || !this.currentCopy(group.identity) || !Number.isSafeInteger(now)) throw new Error("Cannot hand off part group");
    this.db.prepare("update memory_delivery_group set handed_off_at=coalesce(handed_off_at,?) where group_id=?").run(now, groupId);
    return this.getPartGroup(groupId)!;
  }

  copy(provider: string, room: string, uuid: string): string {
    return this.transaction(() => {
      const old = this.db.prepare("select uuid,copy_id from memory_delivery_copy where provider=? and room=?").get(provider, room);
      if (old?.uuid === uuid) return String(old.copy_id);
      if (old) this.detach(provider, room);
      const id = randomUUID();
      this.db.prepare("insert into memory_delivery_copy values(?,?,?,?)").run(provider, room, uuid, id);
      return id;
    });
  }

  currentCopy(identity: Pick<WriteIdentity, "provider" | "roomId" | "roomUuid" | "copyId">): boolean {
    const row = this.db.prepare("select uuid,copy_id from memory_delivery_copy where provider=? and room=?").get(identity.provider, identity.roomId);
    return row?.uuid === identity.roomUuid && row.copy_id === identity.copyId;
  }

  copyAccount(identity: Pick<WriteIdentity, "provider" | "roomId" | "roomUuid" | "copyId">): string | null {
    const row = this.db.prepare("select account from memory_delivery_account where provider=? and room=? and uuid=? and copy_id=?")
      .get(identity.provider, identity.roomId, identity.roomUuid, identity.copyId);
    return row ? String(row.account) : null;
  }

  bindAccount(identity: Pick<WriteIdentity, "provider" | "roomId" | "roomUuid" | "copyId">, account: string): void {
    this.db.prepare("insert or ignore into memory_delivery_account values(?,?,?,?,?)")
      .run(identity.provider, identity.roomId, identity.roomUuid, identity.copyId, account);
    if (this.copyAccount(identity) !== account) throw new Error("Delivery account ownership changed");
  }

  accountMatches(identity: WriteIdentity, account?: string): boolean {
    return account === undefined || this.copyAccount(identity) === account;
  }

  copyHasDispatchedDeliveries(identity: Pick<WriteIdentity, "provider" | "roomId" | "roomUuid" | "copyId">): boolean {
    return !!this.db.prepare(`select 1 from memory_delivery where provider=? and room_uuid=?
      and json_extract(identity,'$.roomId')=? and json_extract(identity,'$.copyId')=?
      and (attempts>0 or external_ids!='[]') limit 1`)
      .get(identity.provider, identity.roomUuid, identity.roomId, identity.copyId);
  }

  extraRecoveryAttempt(scope: { provider: string; account: string; room: string; uuid: string }, graphId: string, jobId: string): boolean {
    return !!this.db.prepare(`select 1 from memory_delivery d where d.provider=? and d.room_uuid=?
      and json_extract(d.identity,'$.graphId')=?
      and (d.attempts>0 or d.attempted_at is not null) and coalesce(json_extract(d.identity,'$.maintenanceId'),'')!=?
      and (not exists (select 1 from memory_delivery_account a where a.provider=d.provider
        and a.room=json_extract(d.identity,'$.roomId') and a.uuid=d.room_uuid and a.copy_id=json_extract(d.identity,'$.copyId'))
        or exists (select 1 from memory_delivery_account a where a.provider=d.provider
        and a.room=json_extract(d.identity,'$.roomId') and a.uuid=d.room_uuid and a.copy_id=json_extract(d.identity,'$.copyId') and a.account=?)) limit 1`)
      .get(scope.provider, scope.uuid, graphId, jobId, scope.account);
  }

  unprovenSource(identity: Pick<WriteIdentity, "provider" | "roomId" | "roomUuid" | "sourceId" | "graphId">, account?: string): boolean {
    if (account === undefined) return false;
    return !!this.db.prepare(`select 1 from memory_delivery d where d.provider=? and d.room_uuid=?
      and json_extract(d.identity,'$.roomId')=? and d.source_id=? and coalesce(json_extract(d.identity,'$.graphId'),'')=?
      and (d.attempts>0 or d.external_ids!='[]') and (d.retired_at is null or d.cleanup in ('pending','not_requested'))
      and not exists (select 1 from memory_delivery_account a where a.provider=d.provider
        and a.room=json_extract(d.identity,'$.roomId') and a.uuid=d.room_uuid and a.copy_id=json_extract(d.identity,'$.copyId')) limit 1`)
      .get(identity.provider, identity.roomUuid, identity.roomId, identity.sourceId, identity.graphId ?? "");
  }

  private static accountWhere(alias: string, account?: string): string {
    return account === undefined ? "" : `and exists (select 1 from memory_delivery_account a where a.provider=${alias}.provider
      and a.room=json_extract(${alias}.identity,'$.roomId') and a.uuid=${alias}.room_uuid
      and a.copy_id=json_extract(${alias}.identity,'$.copyId') and a.account=?)`;
  }

  rotateCopy(provider: string, room: string, uuid: string): string {
    invalidateOriginalSourceReceipts(this.db, { provider, room }, "copy_rotated");
    const id = randomUUID();
    this.db.prepare(`insert into memory_delivery_copy values(?,?,?,?) on conflict(provider,room) do update set uuid=excluded.uuid,copy_id=excluded.copy_id`)
      .run(provider, room, uuid, id);
    return id;
  }

  retire(opId: string, reason: string, now = Date.now()): void {
    this.transaction(() => {
      const saved = this.get(opId);
      if (saved) invalidateOriginalSourceReceipts(this.db, { provider: saved.identity.provider,
        room: saved.identity.roomId, sourceId: saved.identity.sourceId,
        ...(this.copyAccount(saved.identity) === null ? {} : { account: this.copyAccount(saved.identity)! }) }, reason, now);
      if (this.db.prepare("update memory_delivery set payload=null,payload_hash=null,retired_at=?,retirement=?,cleanup=?,updated_at=? where op_id=? and retired_at is null")
        .run(now, reason, ["local_copy_removed", "source_imported"].includes(reason) ? "not_requested" : "pending", now, opId).changes)
        this.resetMaintenance(opId, now);
    });
  }

  private resetMaintenance(opId: string, now: number): void {
    this.db.prepare("update memory_delivery_maintenance set state='watching',reason='source_erased',check_at=0,since=?,checks=0,cleared_scan_at=null where op_id=?").run(now, opId);
    if (this.needsWatch(this.get(opId)!)) this.watches.start(opId, now, 0);
    else this.watches.close(opId);
  }

  private needsWatch(row: Delivery): boolean {
    if (row.identity.kind !== "episode") return false;
    if (row.retiredAt !== null) return row.cleanup === "pending" && row.attempts > 0;
    return ["unknown", "accepted", "duplicates"].includes(row.state) ||
      row.state === "processed" && (row.replays > 0 || row.carried || !!this.maintenance(row.opId)?.canonicalId);
  }

  private settleWatch(opId: string): void {
    const row = this.get(opId);
    if (row && !this.needsWatch(row)) this.watches.close(opId);
  }

  retireSource(room: string, sourceId: string, keepVersion?: string, imported = false): WriteIdentity[] {
    const now = Date.now();
    return this.transaction(() => {
      invalidateOriginalSourceReceipts(this.db, { room, sourceId }, imported ? "source_imported" : "source_retired", now);
      const rows = this.db.prepare(`update memory_delivery set payload=null,payload_hash=null,retired_at=?,retirement=?,cleanup=?,updated_at=?
        where source_id=? and json_extract(identity,'$.roomId')=? and retired_at is null${keepVersion ? " and coalesce(source_version,json_extract(identity,'$.version'))!=?" : ""} returning op_id,identity`)
        .all(now, imported ? "source_imported" : "source_changed_or_removed", imported ? "not_requested" : "pending", now, sourceId, room, ...(keepVersion ? [keepVersion] : []));
      for (const row of rows) {
        const opId = String(row.op_id);
        this.resetMaintenance(opId, now);
      }
      return rows.map(row => JSON.parse(String(row.identity)) as WriteIdentity);
    });
  }

  detach(provider: string, room: string, reason = "local_copy_removed"): void {
    this.transaction(() => {
      invalidateOriginalSourceReceipts(this.db, { provider, room }, reason);
      for (const row of this.db.prepare("select op_id from memory_delivery where provider=? and json_extract(identity,'$.roomId')=? and retired_at is null").all(provider, room)) this.retire(String(row.op_id), reason);
      this.db.prepare("delete from memory_delivery_copy where provider=? and room=?").run(provider, room);
    });
  }

  detachLocal(room: string): void {
    this.transaction(() => {
      const providers = this.db.prepare(`select distinct provider from memory_delivery where json_extract(identity,'$.roomId')=?
        union select provider from memory_delivery_copy where room=? union select provider from memory_original_source_receipt where room=?`).all(room, room, room);
      for (const row of providers) this.detach(String(row.provider), room);
    });
  }

  list(provider: string, options: { room?: string; activeOnly?: boolean; limit?: number; after?: string; account?: string } = {}): Delivery[] {
    const clauses = ["provider=?", "op_id>?"];
    const values: Array<string | number> = [provider, options.after ?? ""];
    if (options.room !== undefined) { clauses.push("json_extract(identity,'$.roomId')=?"); values.push(options.room); }
    if (options.activeOnly) clauses.push("retired_at is null");
    return this.db.prepare(`select op_id from memory_delivery where ${clauses.join(" and ")} ${MemoryDeliveryStore.accountWhere("memory_delivery", options.account)} order by op_id limit ?`)
      .all(...values, ...(options.account === undefined ? [] : [options.account]), Math.min(1000, Math.max(1, options.limit ?? 100))).map(row => this.get(String(row.op_id))!);
  }

  reserved(provider: string, month: string): number {
    return Number(this.db.prepare(`select coalesce(sum(estimated_credits),0) credits from memory_delivery_attempt
      where provider=? and month=? and reserved=1`).get(provider, month)!.credits);
  }

  private static readonly WATCHED = `(d.state in ('unknown','accepted') or (d.state='processed' and (d.replays>0 or d.carried=1 or m.canonical_id is not null)))`;
  private static readonly LOCAL = `(d.state='prepared' or (d.acknowledged=0 and d.state in ('accepted','processed')))`;
  private static readonly ACTIVE = `d.provider=? and json_extract(d.identity,'$.roomId')=? and d.retired_at is null
      and json_extract(d.identity,'$.maintenanceId') is null
      and d.state not in ('conflict','duplicates','rejected') and not (json_extract(d.identity,'$.kind')='fact' and d.acknowledged=1)`;
  private static readonly GROUP_ADMITTED = `(d.group_id is null and not exists(select 1 from memory_delivery_group_member gm where gm.op_id=d.op_id)
    or d.group_id is not null and exists(select 1 from memory_delivery_group g join memory_delivery_group_handoff h on h.group_id=g.group_id
      where g.group_id=d.group_id and g.handed_off_at is not null))`;
  private static readonly EFFECTIVE = `(case when coalesce(w.requested,0)=1 then 0
      when ${MemoryDeliveryStore.LOCAL} then case when ${MemoryDeliveryStore.WATCHED} and w.state='active' then min(d.check_at,w.next_at) else d.check_at end
      when ${MemoryDeliveryStore.WATCHED} then case when w.op_id is null then d.check_at when w.state='active' then w.next_at end end)`;
  private static readonly JOINS = `memory_delivery d left join memory_delivery_watch w on w.op_id=d.op_id left join memory_delivery_maintenance m on m.op_id=d.op_id`;

  due(provider: string, room: string, now: number, limit = 16, graph?: { graphId?: string; account?: string }): Delivery[] {
    const { ACTIVE, EFFECTIVE, JOINS } = MemoryDeliveryStore;
    const result: Delivery[] = [], admitted = new Map<string, boolean>();
    if (limit < 1) return result;
    for (const row of this.db.prepare(`select d.op_id,d.group_id from ${JOINS} where ${ACTIVE} and ${MemoryDeliveryStore.GROUP_ADMITTED}
      ${graph ? "and coalesce(json_extract(d.identity,'$.graphId'),'')=?" : ""} ${MemoryDeliveryStore.accountWhere("d", graph?.account)} and ${EFFECTIVE}<=? order by ${EFFECTIVE}, d.op_id`)
      .iterate(provider, room, ...(graph ? [graph.graphId ?? ""] : []), ...(graph?.account === undefined ? [] : [graph.account]), now)) {
      const opId = String(row.op_id), key = typeof row.group_id === "string" ? row.group_id : opId;
      if (!admitted.has(key)) admitted.set(key, this.dispatchAdmitted(opId));
      if (admitted.get(key)) result.push(this.get(opId)!);
      if (result.length >= limit) break;
    }
    return result;
  }

  claimReads(row: Delivery, now: number): boolean {
    const needs = this.needsWatch(row);
    if (needs && !this.watches.get(row.opId)) this.watches.ensure(row.opId, row.retiredAt ?? row.attemptedAt ?? row.preparedAt, now);
    const watch = this.watches.get(row.opId);
    if (!watch || !needs && !watch.requested) return true;
    return this.watches.begin(row.opId, now);
  }

  checkAfter(opId: string, at: number): void {
    this.db.prepare("update memory_delivery set check_at=? where op_id=?").run(at, opId);
  }

  nextCheck(provider: string, room: string, graph?: { graphId?: string; account?: string }): number | null {
    const { ACTIVE, EFFECTIVE, JOINS } = MemoryDeliveryStore;
    const admitted = new Map<string, boolean>();
    for (const row of this.db.prepare(`select d.op_id,d.group_id,${EFFECTIVE} at from ${JOINS} where ${ACTIVE} and ${MemoryDeliveryStore.GROUP_ADMITTED}
      ${graph ? "and coalesce(json_extract(d.identity,'$.graphId'),'')=?" : ""} ${MemoryDeliveryStore.accountWhere("d", graph?.account)} order by at,d.op_id`)
      .iterate(provider, room, ...(graph ? [graph.graphId ?? ""] : []), ...(graph?.account === undefined ? [] : [graph.account]))) {
      if (row.at === null || row.at === undefined) continue;
      const opId = String(row.op_id), key = typeof row.group_id === "string" ? row.group_id : opId;
      if (!admitted.has(key)) admitted.set(key, this.dispatchAdmitted(opId));
      if (admitted.get(key)) return Number(row.at);
    }
    return null;
  }

  prepareWatches(provider: string, room: string, uuid: string, now: number): void {
    const rows = this.db.prepare(`select d.op_id, coalesce(d.retired_at, d.attempted_at, d.prepared_at) anchor from memory_delivery d
      left join memory_delivery_watch w on w.op_id=d.op_id left join memory_delivery_maintenance m on m.op_id=d.op_id
      where d.provider=? and json_extract(d.identity,'$.roomId')=? and json_extract(d.identity,'$.kind')='episode' and w.op_id is null
      and ((d.retired_at is not null and d.cleanup='pending' and d.attempts>0 and d.room_uuid=?) or (d.retired_at is null and
        (d.state in ('unknown','accepted','duplicates') or (d.state='processed' and (d.replays>0 or d.carried=1 or m.canonical_id is not null)))))`)
      .all(provider, room, uuid);
    for (const row of rows) this.watches.ensure(String(row.op_id), Number(row.anchor), now);
  }

  recordCheck(opId: string, now: number): void {
    const watch = this.watches.get(opId), row = this.get(opId);
    if (!watch || !row || watch.lastResult !== "check_interrupted") return;
    const m = this.maintenance(opId);
    const outcome = row.retiredAt !== null ? `cleanup_${row.cleanup ?? "none"}` : row.state;
    this.watches.result(opId, [outcome, m && m.state !== "cleaned" ? m.state : null, (m?.reason ?? row.reason)].filter(Boolean).join(":"), now);
  }

  markDispatch(opId: string, attempt: number, now: number): boolean {
    return this.transaction(() => {
      if (!this.dispatchAdmitted(opId)) return false;
      const row = this.get(opId);
      if (!row || row.state !== "unknown" || row.attempts !== attempt) return false;
      return this.db.prepare("update memory_delivery_attempt set dispatched_at=? where op_id=? and attempt=? and dispatched_at is null")
        .run(now, opId, attempt).changes === 1;
    });
  }

  releaseUndispatched(opId: string, attempt: number, now: number): Delivery | null {
    const row = this.get(opId);
    if (!row || row.state !== "unknown" || row.attempts !== attempt) return row;
    const mark = this.db.prepare("select dispatched_at from memory_delivery_attempt where op_id=? and attempt=?").get(opId, attempt);
    if (!mark || mark.dispatched_at !== null) return row;
    return this.observe(opId, { state: "not_applied", reason: "cancelled_before_send" }, now, attempt, "send");
  }

  recoverUndispatched(now: number): number {
    const rows = this.db.prepare(`select d.op_id, d.attempts from memory_delivery d join memory_delivery_attempt a on a.op_id=d.op_id and a.attempt=d.attempts
      where d.state='unknown' and a.dispatched_at is null`).all();
    for (const row of rows) this.releaseUndispatched(String(row.op_id), Number(row.attempts), now);
    return rows.length;
  }

  deferUnavailable(opId: string, now: number): void {
    this.transaction(() => {
      this.db.prepare("update memory_delivery set check_at=max(check_at,?) where op_id=?").run(now + 30_000, opId);
      if (this.watches.begin(opId, now)) this.watches.result(opId, "skipped_not_sendable_now", now);
    });
  }

  requestCheck(opId: string, now: number): void {
    this.transaction(() => {
      const row = this.get(opId);
      if (!row) throw new Error("Memory delivery does not exist");
      if (!this.watches.get(opId)) this.watches.ensure(opId, row.retiredAt ?? row.attemptedAt ?? row.preparedAt, now);
      this.watches.request(opId);
      this.checkAfter(opId, 0);
      this.db.prepare("update memory_delivery_maintenance set check_at=0 where op_id=?").run(opId);
    });
  }

  claim(opId: string, now = Date.now(), cap = 0, maintenanceGate?: (row: PreparedDelivery) => boolean): boolean {
    return this.claimWithCheck(opId, now, cap, undefined, maintenanceGate);
  }

  claimAfterAbsence(opId: string, check: AbsenceCheck, now = Date.now(), cap = 0): boolean {
    return this.claimWithCheck(opId, now, cap, check);
  }

  latestAttemptStatus(opId: string): { attempt: number; dispatchedAt: number | null; reserved: boolean } | null {
    const row = this.db.prepare("select attempt,dispatched_at,reserved from memory_delivery_attempt where op_id=? order by attempt desc limit 1").get(opId);
    return row ? { attempt: Number(row.attempt), dispatchedAt: row.dispatched_at === null ? null : Number(row.dispatched_at), reserved: row.reserved === 1 } : null;
  }

  private claimWithCheck(opId: string, now: number, cap: number, check?: AbsenceCheck, maintenanceGate?: (row: PreparedDelivery) => boolean): boolean {
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(cap) || cap < 0) throw new Error("Invalid delivery budget or time");
    return this.transaction(() => {
      if (!this.dispatchAdmitted(opId)) return false;
      const row = this.get(opId);
      if (!row || !isPreparedDelivery(row) || row.externalIds.length || row.acknowledged || (row.retryAt !== null && row.retryAt > now)) return false;
      if (row.identity.maintenanceId !== undefined && (!maintenanceGate || isAsyncFunction(maintenanceGate) || maintenanceGate(row) !== true)) return false;
      const replay = row.state === "unknown";
      if (row.state !== "prepared" && !replay) return false;
      if (replay || row.replays) {
        if (row.identity.kind !== "episode" || !check || check.attempt !== row.attempts ||
            !Number.isSafeInteger(check.startedAt) || !Number.isSafeInteger(check.finishedAt) ||
            check.finishedAt < check.startedAt || now < check.finishedAt || now - check.finishedAt > DELIVERY_FRESH_READ_MAX_AGE_MS) return false;
        if (check.indexedFrom !== undefined && (!Number.isSafeInteger(check.indexedFrom) || row.attemptedAt === null ||
            check.indexedFrom > row.attemptedAt - EPISODE_INDEX_CLOCK_MARGIN_MS)) return false;
      }
      const allowance = Number(this.db.prepare("select replay_allowance from memory_delivery where op_id=?").get(opId)!.replay_allowance);
      if (replay && (row.replays >= allowance || row.attemptedAt === null || check!.startedAt < row.attemptedAt + UNKNOWN_REPLAY_WAIT_MS)) return false;
      const month = new Date(now).toISOString().slice(0, 7);
      const legacy = Number(this.db.prepare("select credits from memory_usage where provider=? and month=?").get(row.identity.provider, month)?.credits ?? 0);
      if (cap && legacy + this.reserved(row.identity.provider, month) + row.payload.estimatedCredits > cap) throw new DeliveryBudgetError();
      this.db.prepare(`insert into memory_delivery_attempt(op_id,attempt,provider,month,estimated_credits,started_at,cause,scan_started_at,scan_finished_at,scan_indexed_from)
        values(?,?,?,?,?,?,?,?,?,?)`).run(opId, row.attempts + 1, row.identity.provider, month, row.payload.estimatedCredits, now,
          replay ? "rearmed_after_absent_scan" : row.reason ?? "initial", check?.startedAt ?? null, check?.finishedAt ?? null, check?.indexedFrom ?? null);
      const claimed = this.db.prepare(`update memory_delivery set state='unknown',attempted_at=?,month=?,updated_at=?,reason=?,attempts=attempts+1,replays=replays+?,retry_at=null
        where op_id=?`).run(now, month, now, replay ? "rearmed_after_absent_scan" : "dispatch_started", Number(replay), opId).changes === 1;
      if (claimed && row.identity.kind === "episode") this.watches.start(opId, now);
      return claimed;
    });
  }

  observe(opId: string, observation: WriteObservation, now: number, attempt: number, origin: "send" | "read" = "read"): Delivery {
    if (!Number.isSafeInteger(now)) throw new Error("Invalid observation time");
    if (!["not_applied", "unknown", "accepted", "processed", "rejected", "conflict", "duplicates"].includes(observation.state) ||
        (["not_applied", "unknown", "rejected", "conflict", "duplicates"].includes(observation.state) &&
          (!("reason" in observation) || typeof observation.reason !== "string"))) throw new Error("Invalid delivery observation");
    if (observation.state === "not_applied" && (origin !== "send" || observation.externalIds !== undefined ||
        (observation.retryAfterMs !== undefined && (!Number.isSafeInteger(observation.retryAfterMs) || observation.retryAfterMs < 0 ||
          !Number.isSafeInteger(now + observation.retryAfterMs))))) throw new Error("Invalid retry evidence");
    const ids = [...new Set(observation.externalIds ?? [])];
    if (ids.length > 10_000 || ids.some(id => typeof id !== "string" || !id || id.length > 256)) throw new Error("Invalid receipt identities");
    return this.transaction(() => {
      const before = this.get(opId);
      const after = this.recordObservation(opId, observation, ids, now, attempt, origin);
      this.watchObservation(before, after, now);
      return after;
    });
  }

  private recordObservation(opId: string, observation: WriteObservation, ids: string[], now: number, attempt: number, origin: "send" | "read"): Delivery {
    const row = this.get(opId);
    if (!row || !row.attempts) throw new Error("Cannot record a receipt before dispatch");
    if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > row.attempts) throw new Error("Invalid delivery attempt");
    if (origin === "send") {
      if (["accepted", "processed", "conflict", "duplicates"].includes(observation.state)) {
        this.db.prepare("update memory_delivery_attempt set reserved=1 where op_id=? and attempt=?").run(opId, attempt);
      } else if (["not_applied", "rejected"].includes(observation.state) && !row.externalIds.length &&
          !["accepted", "processed", "conflict", "duplicates"].includes(row.state)) {
        this.db.prepare("update memory_delivery_attempt set reserved=0 where op_id=? and attempt=?").run(opId, attempt);
      }
    }
    if (ids.length) {
      ids = ids.filter(id => !this.removedEpisodes(opId).includes(id));
      if (!ids.length) return row;
      observation = { ...observation, externalIds: ids } as WriteObservation;
    }
    const combined = [...new Set([...row.externalIds, ...ids])];
    const foreignReceipt = row.externalIds.some(id => this.foreignCopy(opId, id) !== null);
    if (row.retiredAt !== null && row.cleanup !== "not_requested" && ids.some(id => !row.externalIds.includes(id))) {
      this.db.prepare("update memory_delivery set cleanup='pending' where op_id=?").run(opId);
      this.unclear(opId);
    }
    if (attempt !== row.attempts || (row.state === "prepared" && !row.replays)) {
      if (["not_applied", "unknown", "rejected"].includes(observation.state)) return row;
      observation = foreignReceipt && ["accepted", "processed", "duplicates"].includes(observation.state)
        ? { state: "duplicates", reason: "late_original_after_foreign_acceptance", externalIds: combined }
        : { state: "conflict", reason: "late_receipt_after_retry", externalIds: combined };
    }
    if (row.state === "conflict" || row.state === "duplicates") {
      this.db.prepare("update memory_delivery set external_ids=?,updated_at=? where op_id=?").run(JSON.stringify(combined), now, opId);
      return this.get(opId)!;
    }
    if (row.state === "rejected") {
      if (["not_applied", "unknown", "rejected"].includes(observation.state)) return row;
      if (!(row.replays && origin === "read")) observation = { state: "conflict", reason: "acceptance_after_rejection", externalIds: combined };
    }
    if (row.state === "prepared" && row.replays && ["unknown", "not_applied", "rejected"].includes(observation.state)) return row;
    if (row.state === "accepted" || row.state === "processed") {
      if (["not_applied", "unknown", "rejected"].includes(observation.state)) return row;
      if (["accepted", "processed", "duplicates"].includes(observation.state) &&
          foreignReceipt && ids.some(id => !row.externalIds.includes(id))) {
        observation = { state: "duplicates", reason: "late_original_after_foreign_acceptance", externalIds: combined };
      }
      if (["accepted", "processed"].includes(observation.state)) {
        if (canonical(row.externalIds) !== canonical(ids)) observation = { state: "conflict", reason: "receipt_identity_changed", externalIds: combined };
        else if (row.state === "processed") return row;
      }
    }
    if (observation.state === "not_applied") {
      const delay = Math.max(observation.retryAfterMs ?? 0, Math.min(300_000, 1000 * 2 ** Math.min(row.attempts - 1, 9)));
      this.db.prepare("update memory_delivery set state='prepared',retry_at=?,reason=?,updated_at=? where op_id=?")
        .run(now + delay, observation.reason.slice(0, 500), now, opId);
      return this.get(opId)!;
    }
    this.db.prepare("update memory_delivery set state=?,external_ids=?,reason=?,updated_at=? where op_id=?")
      .run(observation.state, JSON.stringify(observation.externalIds ?? row.externalIds), "reason" in observation ? observation.reason.slice(0, 500) : null, now, opId);
    return this.get(opId)!;
  }

  crossCopyDuplicates(row: Delivery): boolean {
    return row.state === "duplicates" && row.externalIds.some(id => this.foreignCopy(row.opId, id) !== null);
  }

  adopt(opId: string, episodeId: string, now: number, attempt: number, copyId = "unknown"): Delivery | null {
    if (!episodeId || episodeId.length > 256 || !Number.isSafeInteger(now)) throw new Error("Invalid adopted episode");
    return this.transaction(() => {
      const row = this.get(opId);
      if (!row || this.groupedSource(row.identity.provider, row.identity.roomId, row.identity.sourceId, row.sourceVersion ?? row.identity.version, row.identity.graphId) ||
          !isPreparedDelivery(row) || row.attempts !== attempt || row.externalIds.length ||
          !(row.state === "unknown" || row.state === "prepared" && (row.replays > 0 || row.attempts === 0))) return row;
      return this.recordAdoption(row, episodeId, copyId, now);
    });
  }

  adoptPartGroup(input: PartGroupAdoptionRequest, current: () => boolean, now = Date.now()): PartGroupAdoptionResult {
    const enteredAt = performance.now();
    const hold = (reason: string): never => { throw new PartGroupAdoptionHold(reason); };
    let request: PartGroupAdoptionRequest;
    try { request = freezeSnapshot(structuredClone(input)); }
    catch { return { kind: "hold", reason: "part_group_adoption_request_invalid" }; }
    if (!request?.group || typeof request.group.groupId !== "string" || !request.proof || !Number.isSafeInteger(now) ||
        typeof current !== "function" || isAsyncFunction(current)) return { kind: "hold", reason: "part_group_adoption_request_invalid" };
    try {
      return this.transaction(() => {
        const verified = (): PartGroup => {
          let group: PartGroup | null;
          try { group = this.getPartGroup(request.group.groupId); }
          catch { return hold("part_group_adoption_store_invalid"); }
          if (!group || group.retired || !this.currentCopy(group.identity)) return hold("part_group_adoption_group_unavailable");
          return group;
        };
        let expectedGroup = verified();
        const immutablePinsMatch = () => Array.isArray(request.group.members) && request.group.members.length === expectedGroup.members.length &&
          isDeepStrictEqual({ ...request.group, accepted: expectedGroup.accepted, processed: expectedGroup.processed,
            members: request.group.members.map((member, index) => ({ ...member, state: expectedGroup.members[index].state,
              externalIds: expectedGroup.members[index].externalIds, reason: expectedGroup.members[index].reason,
              carried: expectedGroup.members[index].carried, retryAt: expectedGroup.members[index].retryAt,
              updatedAt: expectedGroup.members[index].updatedAt })) }, expectedGroup);
        if (!immutablePinsMatch()) hold("part_group_adoption_group_changed");
        const scope = request.scope, identity = expectedGroup.identity;
        if (!scope || scope.provider !== "zep" || identity.provider !== "zep" || expectedGroup.account === null ||
            scope.account !== expectedGroup.account || scope.roomUuid !== identity.roomUuid || scope.graphId !== identity.graphId ||
            scope.sourceId !== identity.sourceId || scope.version !== identity.version)
          hold("part_group_adoption_scope_changed");
        const fresh = () => {
          const minimumStarts = request.group.members.map(member => member.updatedAt);
          if (request.proof.state === "complete" && (!freshCompleteReadTimes(request.proof.scan, now, minimumStarts) ||
            !freshCompleteReadTimes(request.proof.scan, now + Math.ceil(performance.now() - enteredAt), minimumStarts)))
            hold("part_group_adoption_native_proof_not_fresh");
        };
        fresh();
        const attemptRows = () => expectedGroup.members.flatMap(member => this.db.prepare(
          "select * from memory_delivery_attempt where op_id=? order by attempt").all(member.opId).map(row => ({ ...row })));
        let expectedAttempts = attemptRows();
        const ownershipRows = () => expectedGroup.members.map(member => ({ opId: member.opId,
          foreign: this.db.prepare("select * from memory_delivery_foreign where op_id=? order by episode_id").all(member.opId).map(row => ({ ...row })),
          adoption: this.db.prepare("select * from memory_delivery_adoption where op_id=?").all(member.opId).map(row => ({ ...row })),
          removed: this.db.prepare("select * from memory_delivery_removed where op_id=? order by episode_id").all(member.opId).map(row => ({ ...row })),
          watch: this.db.prepare("select * from memory_delivery_watch where op_id=?").all(member.opId).map(row => ({ ...row })) }));
        const expectedOwnership = ownershipRows();
        const fence = () => {
          const allowed: unknown = current();
          if (allowed && typeof (allowed as PromiseLike<unknown>).then === "function" || allowed !== true)
            hold("part_group_adoption_authority_changed");
          if (!isDeepStrictEqual(verified(), expectedGroup) || !isDeepStrictEqual(attemptRows(), expectedAttempts))
            hold("part_group_adoption_group_or_attempt_changed");
          if (!isDeepStrictEqual(ownershipRows(), expectedOwnership)) hold("part_group_adoption_ownership_changed");
          fresh();
        };
        fence();
        let compatible: ReturnType<typeof compatibleSourceBodies>;
        try { compatible = compatibleSourceBodies(scope, { mode: "prepared-group", group: expectedGroup,
          maxOriginalBytes: request.maxOriginalBytes, maxPrefixBytes: request.maxPrefixBytes }, request.proof); }
        catch { return hold("part_group_adoption_native_proof_invalid"); }
        if (compatible.kind !== "compatible") return hold(`part_group_adoption_${compatible.reason}`);
        if (compatible.evidence !== "complete-prepared-member-bytes" || compatible.episodes.length !== expectedGroup.members.length)
          hold("part_group_adoption_partition_incompatible");
        const episodes = compatible.episodes;
        const ids = new Set<string>();
        for (const episode of episodes) {
          if (!episode.id || episode.id.length > 256 || ids.has(episode.id) ||
              expectedGroup.members.some(member => member.opId === episode.opId)) hold("part_group_adoption_own_or_invalid_receipt");
          ids.add(episode.id);
        }
        if (expectedGroup.members.some((member, index) => {
          const foreign = this.foreignCopy(member.opId, episodes[index].id);
          return foreign !== null && foreign !== compatible.copyId;
        })) hold("part_group_adoption_foreign_ownership_changed");
        if (expectedGroup.members.some(member => this.removedEpisodes(member.opId).some(id => ids.has(id))))
          hold("part_group_adoption_receipt_already_removed");
        const latest = new Map<string, (typeof expectedAttempts)[number] | undefined>();
        for (const member of expectedGroup.members) {
          const attempts = expectedAttempts.filter(row => row.op_id === member.opId), mark = attempts.at(-1);
          if (!Number.isSafeInteger(member.attempts) || member.attempts < 0 || attempts.length !== member.attempts ||
              attempts.some((row, index) => row.attempt !== index + 1 || row.provider !== identity.provider ||
                row.estimated_credits !== member.payload!.estimatedCredits || ![0, 1].includes(Number(row.reserved)) ||
                !Number.isSafeInteger(row.started_at) || row.dispatched_at !== null && !Number.isSafeInteger(row.dispatched_at)) ||
              mark && (member.attemptedAt !== mark.started_at || member.month !== mark.month))
            hold("part_group_adoption_attempt_ledger_invalid");
          latest.set(member.opId, mark);
        }
        const duplicate = expectedGroup.members.every((member, index) => member.state === "processed" && member.carried &&
          !member.acknowledged && member.reason === "represented_by_another_operation" && member.retryAt === null &&
          isDeepStrictEqual(member.externalIds, [episodes[index].id]) &&
          (latest.get(member.opId)?.dispatched_at !== null || latest.get(member.opId)?.reserved === 0) &&
          this.foreignCopy(member.opId, episodes[index].id) === compatible.copyId &&
          !!this.db.prepare("select 1 from memory_delivery_adoption where op_id=?").get(member.opId));
        const oldSnapshotEligible = request.group.members.every((member, index) =>
          isDeepStrictEqual(member, expectedGroup.members[index]) || !member.externalIds.length && !member.acknowledged &&
          (member.state === "unknown" && member.attempts > 0 || member.state === "prepared" &&
            (member.attempts === 0 || member.replays > 0 || member.reason === "cancelled_before_send")));
        if (duplicate && oldSnapshotEligible) { fence(); return { kind: "adopted", group: freezeSnapshot(expectedGroup), duplicate: true }; }
        if (!isDeepStrictEqual(expectedGroup, request.group)) hold("part_group_adoption_group_changed");
        if (expectedGroup.members.some(member => member.externalIds.length || member.acknowledged))
          hold("part_group_adoption_existing_receipt_requires_reconciliation");
        for (const member of expectedGroup.members) {
          const mark = latest.get(member.opId);
          const released = member.state === "prepared" && member.reason === "cancelled_before_send" &&
            !!mark && mark.dispatched_at === null && mark.reserved === 0;
          if (!(member.state === "unknown" && member.attempts > 0 || member.state === "prepared" &&
              (member.attempts === 0 || member.replays > 0 || released))) hold("part_group_adoption_member_state_requires_reconciliation");
        }
        fence();
        for (let index = 0; index < expectedGroup.members.length; index++) {
          fence();
          const member = expectedGroup.members[index], episode = episodes[index], mark = latest.get(member.opId);
          if (!isPreparedDelivery(member)) return hold("part_group_adoption_group_unavailable");
          if (mark?.dispatched_at === null && mark.reserved === 1) {
            const released = this.db.prepare("update memory_delivery_attempt set reserved=0 where op_id=? and attempt=? and dispatched_at is null and reserved=1")
              .run(member.opId, member.attempts).changes;
            if (released !== 1) hold("part_group_adoption_attempt_changed");
            mark.reserved = 0;
          }
          const adopted = this.recordAdoption(member, episode.id, compatible.copyId, now);
          const owned = expectedOwnership[index];
          if (!owned.foreign.some(row => row.episode_id === episode.id)) {
            owned.foreign.push({ op_id: member.opId, episode_id: episode.id, copy_id: compatible.copyId });
            owned.foreign.sort((a, b) => Buffer.compare(Buffer.from(String(a.episode_id), "utf8"), Buffer.from(String(b.episode_id), "utf8")));
          }
          if (!owned.adoption.length) owned.adoption.push({ op_id: member.opId });
          if (!owned.watch.length) {
            const anchor = member.attemptedAt ?? now, policy = this.watches.policy, deadline = anchor + policy.horizonMs, expired = now >= deadline;
            owned.watch.push({ op_id: member.opId, started_at: anchor, deadline_at: deadline, state: expired ? "expired" : "active",
              checks: 0, next_at: expired ? null : anchor + policy.firstMs, requested: 0, last_check_at: null, last_result: null });
          }
          expectedGroup = { ...expectedGroup, members: expectedGroup.members.map((row, at) => at === index ? adopted : row) };
          expectedGroup.accepted = expectedGroup.members.every(row => ["accepted", "processed"].includes(row.state) && row.externalIds.length > 0);
          expectedGroup.processed = expectedGroup.members.every(row => row.state === "processed" && row.externalIds.length > 0);
          fence();
        }
        if (!expectedGroup.processed || expectedGroup.members.some((member, index) =>
            !isDeepStrictEqual(member.externalIds, [episodes[index].id]) || this.foreignCopy(member.opId, episodes[index].id) !== compatible.copyId))
          hold("part_group_adoption_postcondition_failed");
        fence();
        return { kind: "adopted", group: freezeSnapshot(expectedGroup), duplicate: false };
      });
    } catch (error) {
      if (error instanceof PartGroupAdoptionHold) return { kind: "hold", reason: error.message };
      throw error;
    }
  }

  private recordAdoption(row: PreparedDelivery, episodeId: string, copyId: string, now: number): Delivery {
    this.db.prepare("insert or replace into memory_delivery_foreign values(?,?,?)").run(row.opId, episodeId, copyId);
    this.db.prepare("insert or ignore into memory_delivery_adoption values(?)").run(row.opId);
    this.db.prepare("update memory_delivery set state='processed',external_ids=?,reason='represented_by_another_operation',carried=1,retry_at=null,updated_at=? where op_id=?")
      .run(JSON.stringify([episodeId]), now, row.opId);
    this.watches.ensure(row.opId, row.attemptedAt ?? now, now);
    return this.get(row.opId)!;
  }

  private watchObservation(before: Delivery | null, after: Delivery, now: number): void {
    if (after.identity.kind === "episode" && after.state === "duplicates" && before?.state !== "duplicates") { this.watches.start(after.opId, now); return; }
    if (after.retiredAt !== null && after.cleanup === "pending" && after.externalIds.some(id => !before?.externalIds.includes(id))) {
      if (!this.watches.get(after.opId)) this.watches.start(after.opId, now);
      this.watches.request(after.opId);
      return;
    }
    if (this.needsWatch(after)) { if (!before || !this.needsWatch(before)) this.watches.start(after.opId, now); }
    else this.watches.close(after.opId);
  }

  retryRejected(opId: string, attempt: number, cause: "credentials_changed" | "operator_retry", now = Date.now()): boolean {
    if (!Number.isSafeInteger(now) || !["credentials_changed", "operator_retry"].includes(cause)) throw new Error("Invalid retry request");
    return this.transaction(() => {
      const row = this.get(opId);
      if (!row || !isPreparedDelivery(row) || row.state !== "rejected" || row.attempts !== attempt || row.acknowledged || row.externalIds.length) return false;
      if (cause === "credentials_changed" && !["provider_rejected_401", "provider_rejected_403"].includes(row.reason ?? "")) return false;
      return this.db.prepare("update memory_delivery set state='prepared',retry_at=?,reason=?,updated_at=? where op_id=?")
        .run(now, cause, now, opId).changes === 1;
    });
  }

  authorizeReplay(opId: string, attempt: number, now = Date.now()): boolean {
    return this.transaction(() => {
      const row = this.get(opId);
      if (!row || !isPreparedDelivery(row) || row.identity.kind !== "episode" || row.state !== "unknown" || row.attempts !== attempt || row.acknowledged || row.externalIds.length) return false;
      this.db.prepare("update memory_delivery set replay_allowance=max(replay_allowance,replays+1),check_at=0 where op_id=?").run(opId);
      if (!this.watches.get(opId)) this.watches.ensure(opId, row.attemptedAt ?? row.preparedAt, now);
      this.watches.request(opId);
      return true;
    });
  }

  retryAuth(provider: string, now = Date.now()): void {
    for (const row of this.db.prepare("select op_id,attempts from memory_delivery where provider=? and state='rejected' and retired_at is null").all(provider)) {
      if (this.retryRejected(String(row.op_id), Number(row.attempts), "credentials_changed", now)) this.checkAfter(String(row.op_id), 0);
    }
  }

  pending(provider: string): number {
    return Number(this.db.prepare(`select count(*) n from memory_delivery where provider=? and retired_at is null
      and (acknowledged=0 or state in ('conflict','duplicates'))`).get(provider)!.n);
  }

  sourceReceipts(provider: string, room: string, uuid: string, sourceId: string, graphId?: string, account?: string): string[] {
    return [...new Set(this.db.prepare(`select d.external_ids from memory_delivery d where provider=? and room_uuid=? and source_id=? and json_extract(identity,'$.roomId')=? and coalesce(json_extract(identity,'$.graphId'),'')=? and retired_at is not null and cleanup='pending' ${MemoryDeliveryStore.accountWhere("d", account)}`)
      .all(provider, uuid, sourceId, room, graphId ?? "", ...(account === undefined ? [] : [account])).flatMap(row => JSON.parse(String(row.external_ids)) as string[]))].filter(id =>
        !this.db.prepare(`select 1 from memory_delivery_removed r join memory_delivery d using(op_id) where d.provider=? and d.room_uuid=? and d.source_id=? and r.episode_id=? ${MemoryDeliveryStore.accountWhere("d", account)}`)
          .get(provider, uuid, sourceId, id, ...(account === undefined ? [] : [account])));
  }

  sourceReceiptRemoved(provider: string, uuid: string, sourceId: string, id: string, now: number, account?: string): void {
    for (const row of this.db.prepare(`select distinct r.room from memory_original_source_receipt r join memory_original_source_member m using(receipt_id)
      where r.provider=? and r.uuid=? and r.source_id=? and m.external_id=?${account === undefined ? "" : " and r.account=?"}`)
      .all(provider, uuid, sourceId, id, ...(account === undefined ? [] : [account])))
      invalidateOriginalSourceReceipts(this.db, { provider, room: String(row.room), sourceId, externalIds: [id],
        ...(account === undefined ? {} : { account }) }, "episode_removed", now);
    for (const row of this.db.prepare(`select d.op_id from memory_delivery d,json_each(d.external_ids) j
      where d.provider=? and d.room_uuid=? and d.source_id=? and j.value=? ${MemoryDeliveryStore.accountWhere("d", account)}`).all(provider, uuid, sourceId, id, ...(account === undefined ? [] : [account]))) this.removedEpisode(String(row.op_id), id, now);
  }

  receiptOfVersion(provider: string, uuid: string, sourceId: string, id: string, version: string, account?: string): boolean {
    return !!this.db.prepare(`select 1 from memory_delivery d,json_each(d.external_ids) j where d.provider=? and d.room_uuid=? and d.source_id=?
      and j.value=? and coalesce(d.source_version,json_extract(d.identity,'$.version'))=? ${MemoryDeliveryStore.accountWhere("d", account)} limit 1`).get(provider, uuid, sourceId, id, version, ...(account === undefined ? [] : [account]));
  }

  projectedReceiptVersion(provider: string, uuid: string, sourceId: string, id: string, wireVersion: string, account?: string): string | null {
    const versions = this.db.prepare(`select distinct d.source_version version from memory_delivery d,json_each(d.external_ids) j
      where d.provider=? and d.room_uuid=? and d.source_id=? and j.value=? and json_extract(d.identity,'$.version')=? and d.source_version is not null ${MemoryDeliveryStore.accountWhere("d", account)}`)
      .all(provider, uuid, sourceId, id, wireVersion, ...(account === undefined ? [] : [account]));
    return versions.length === 1 ? String(versions[0].version) : null;
  }

  receiptDelivery(provider: string, uuid: string, sourceId: string, id: string, account?: string): Delivery | null {
    const row = this.db.prepare(`select d.op_id from memory_delivery d,json_each(d.external_ids) j
      where d.provider=? and d.room_uuid=? and d.source_id=? and j.value=? ${MemoryDeliveryStore.accountWhere("d", account)} order by d.retired_at desc,d.op_id limit 1`).get(provider, uuid, sourceId, id, ...(account === undefined ? [] : [account]));
    return row ? this.get(String(row.op_id)) : null;
  }

  maintenance(opId: string) {
    const row = this.db.prepare("select * from memory_delivery_maintenance where op_id=?").get(opId);
    return row ? { state: String(row.state), reason: row.reason === null ? null : String(row.reason),
      canonicalId: row.canonical_id === null ? null : String(row.canonical_id), since: Number(row.since),
      checks: Number(row.checks), retryAt: Number(row.check_at),
      clearedScanAt: row.cleared_scan_at === null ? null : Number(row.cleared_scan_at) } : null;
  }

  clearedBy(opId: string, startedAt: number, indexedFrom?: number): void {
    if (!Number.isSafeInteger(startedAt)) throw new Error("Invalid listing time");
    const row = this.get(opId);
    if (indexedFrom !== undefined && (!Number.isSafeInteger(indexedFrom) || row?.attemptedAt == null ||
        indexedFrom > row.attemptedAt - EPISODE_INDEX_CLOCK_MARGIN_MS)) return;
    this.db.prepare("update memory_delivery_maintenance set cleared_scan_at=max(coalesce(cleared_scan_at,0),?) where op_id=?").run(startedAt, opId);
  }

  private unclear(opId: string): void {
    this.db.prepare("update memory_delivery_maintenance set cleared_scan_at=null where op_id=?").run(opId);
  }

  unsettledVersion(provider: string, room: string, uuid: string, sourceId: string, keepVersion?: string, graphId?: string, account?: string): Delivery | null {
    const row = this.db.prepare(`select d.op_id from memory_delivery d left join memory_delivery_maintenance m on m.op_id=d.op_id
      where d.provider=? and json_extract(d.identity,'$.roomId')=? and d.room_uuid=? and d.source_id=? and json_extract(d.identity,'$.kind')='episode'
        and d.retired_at is not null and d.cleanup in ('pending','not_requested') and d.attempts>0
        and coalesce(json_extract(d.identity,'$.graphId'),'')=?
        ${MemoryDeliveryStore.accountWhere("d", account)}
        ${keepVersion ? "and coalesce(d.source_version,json_extract(d.identity,'$.version'))!=?" : ""}
        and not (m.cleared_scan_at is not null and d.attempted_at is not null and m.cleared_scan_at>=d.attempted_at+?)
      order by d.retired_at, d.op_id limit 1`).get(provider, room, uuid, sourceId, graphId ?? "", ...(account === undefined ? [] : [account]), ...(keepVersion ? [keepVersion] : []), UNKNOWN_REPLAY_WAIT_MS);
    return row ? this.get(String(row.op_id)) : null;
  }

  private static readonly MAINTAINED = `d.provider=? and json_extract(d.identity,'$.roomId')=? and json_extract(d.identity,'$.kind')='episode'
      and json_extract(d.identity,'$.maintenanceId') is null
      and d.room_uuid=? and d.state!='conflict' and ((d.retired_at is not null and d.cleanup='pending' and d.attempts>0)
        or (?=1 and d.retired_at is null and d.state='duplicates'))`;
  private static readonly MAINTENANCE_AT = `(case when coalesce(w.requested,0)=1 then 0 when w.op_id is null then coalesce(m.check_at,0)
      when w.state='active' then max(coalesce(m.check_at,0),w.next_at) end)`;

  maintenanceDue(provider: string, room: string, now: number, uuid: string, includeActive: boolean, limit = 16, graph?: { graphId?: string; account?: string }): Delivery[] {
    const { MAINTAINED, MAINTENANCE_AT, JOINS } = MemoryDeliveryStore;
    return this.db.prepare(`select d.op_id from ${JOINS} where ${MAINTAINED} ${graph ? "and coalesce(json_extract(d.identity,'$.graphId'),'')=?" : ""} ${MemoryDeliveryStore.accountWhere("d", graph?.account)} and ${MAINTENANCE_AT}<=? order by ${MAINTENANCE_AT}, d.op_id limit ?`)
      .all(provider, room, uuid, Number(includeActive), ...(graph ? [graph.graphId ?? ""] : []), ...(graph?.account === undefined ? [] : [graph.account]), now, limit).map(row => this.get(String(row.op_id))!);
  }

  nextMaintenance(provider: string, room: string, uuid: string, includeActive: boolean, graph?: { graphId?: string; account?: string }): number | null {
    const { MAINTAINED, MAINTENANCE_AT, JOINS } = MemoryDeliveryStore;
    const row = this.db.prepare(`select min(${MAINTENANCE_AT}) at from ${JOINS} where ${MAINTAINED} ${graph ? "and coalesce(json_extract(d.identity,'$.graphId'),'')=?" : ""} ${MemoryDeliveryStore.accountWhere("d", graph?.account)}`).get(provider, room, uuid, Number(includeActive), ...(graph ? [graph.graphId ?? ""] : []), ...(graph?.account === undefined ? [] : [graph.account]));
    return row?.at === null || row?.at === undefined ? null : Number(row.at);
  }

  maintainLater(opId: string, state: "processing" | "watching" | "failed" | "cleaned", reason: string | null, now: number): void {
    const old = this.maintenance(opId), since = old?.since ?? now, checks = (old?.checks ?? 0) + 1;
    const delay = state === "processing" && now - since < 30 * 60_000 ? Math.min(60_000, 2000 * 2 ** Math.min(checks - 1, 5)) : 300_000;
    this.db.prepare(`insert into memory_delivery_maintenance(op_id,state,reason,since,checks,check_at) values(?,?,?,?,?,?)
      on conflict(op_id) do update set state=excluded.state,reason=excluded.reason,checks=excluded.checks,check_at=excluded.check_at`)
      .run(opId, state, reason?.slice(0, 500) ?? null, since, checks, now + delay);
  }

  rememberInventory(opId: string, ids: string[]): void {
    if (ids.length > 10_000 || ids.some(id => typeof id !== "string" || !id || id.length > 256)) throw new Error("Invalid episode inventory");
    const row = this.get(opId); if (!row) throw new Error("Missing delivery");
    const combined = [...new Set([...row.externalIds, ...ids])];
    if (combined.length > 10_000) throw new Error("Episode receipt limit reached");
    this.db.prepare("update memory_delivery set external_ids=? where op_id=?").run(JSON.stringify(combined), opId);
    if (combined.length > row.externalIds.length) this.unclear(opId);
  }

  chooseCanonical(opId: string, id: string, now: number): string {
    const old = this.maintenance(opId)?.canonicalId ?? null;
    this.db.prepare(`insert into memory_delivery_maintenance(op_id,canonical_id,state,since) values(?,?,'processing',?)
      on conflict(op_id) do update set canonical_id=excluded.canonical_id${old !== null && old !== id ? ",survivor_edges='[]'" : ""}`).run(opId, id, now);
    return id;
  }

  survivorEdges(opId: string, observed: string[]): string[] {
    const row = this.db.prepare("select survivor_edges from memory_delivery_maintenance where op_id=?").get(opId);
    if (!row || observed.length > 10_000 || observed.some(id => !id)) throw new Error("Invalid survivor snapshot");
    const ids = [...new Set([...(JSON.parse(String(row.survivor_edges)) as string[]), ...observed])];
    if (ids.length > 10_000) throw new Error("Survivor snapshot limit reached");
    this.db.prepare("update memory_delivery_maintenance set survivor_edges=? where op_id=?").run(JSON.stringify(ids), opId);
    return ids;
  }

  removedEpisode(opId: string, id: string, now: number): void {
    this.db.prepare("insert or ignore into memory_delivery_removed values(?,?,?)").run(opId, id, now);
  }

  confirmRemoval(opId: string, id: string, now: number, unbind: () => undefined): void {
    if (isAsyncFunction(unbind)) throw new Error("Episode unbinding must be synchronous SQL");
    this.transaction(() => {
      this.removedEpisode(opId, id, now);
      const result: unknown = unbind();
      if (result && typeof (result as PromiseLike<unknown>).then === "function") throw new Error("Episode unbinding must be synchronous SQL");
    });
  }

  removedEpisodes(opId: string): string[] {
    return this.db.prepare("select episode_id from memory_delivery_removed where op_id=?").all(opId).map(row => String(row.episode_id));
  }

  finishDuplicates(opId: string, canonicalId: string, bind: (row: PreparedDelivery) => undefined, now: number): boolean {
    if (isAsyncFunction(bind)) throw new Error("Delivery binding must be synchronous SQL");
    return this.transaction(() => {
      const row = this.get(opId);
      if (!row || this.groupedSource(row.identity.provider, row.identity.roomId, row.identity.sourceId, row.sourceVersion ?? row.identity.version, row.identity.graphId) ||
          !isPreparedDelivery(row) || row.state !== "duplicates" || this.maintenance(opId)?.canonicalId !== canonicalId) return false;
      const result: unknown = bind(row);
      if (result && typeof (result as PromiseLike<unknown>).then === "function") throw new Error("Delivery binding must be synchronous SQL");
      this.db.prepare("update memory_delivery set state='processed',external_ids=?,reason=null,check_at=0,updated_at=? where op_id=?")
        .run(JSON.stringify([canonicalId]), now, opId);
      this.maintainLater(opId, "cleaned", null, now);
      return true;
    });
  }

  rebind(opId: string, canonicalId: string, now: number, bind: (row: PreparedDelivery) => undefined, copyId = "unknown", account?: string): boolean {
    if (!canonicalId || canonicalId.length > 256 || isAsyncFunction(bind)) throw new Error("Invalid delivery rebinding");
    return this.transaction(() => {
      const row = this.get(opId);
      if (!row || this.groupedSource(row.identity.provider, row.identity.roomId, row.identity.sourceId, row.sourceVersion ?? row.identity.version, row.identity.graphId) ||
          !isPreparedDelivery(row) || !this.accountMatches(row.identity, account) || !(this.crossCopyDuplicates(row) || row.acknowledged && ["accepted", "processed"].includes(row.state))) return false;
      const result: unknown = bind(row);
      if (result && typeof (result as PromiseLike<unknown>).then === "function") throw new Error("Delivery rebinding must be synchronous SQL");
      if (copyId !== row.identity.copyId) this.db.prepare("insert or replace into memory_delivery_foreign values(?,?,?)").run(opId, canonicalId, copyId);
      this.db.prepare("update memory_delivery set state='processed',external_ids=?,reason=null,updated_at=? where op_id=?")
        .run(JSON.stringify([canonicalId]), now, opId);
      if (this.crossCopyDuplicates(row)) this.maintainLater(opId, "cleaned", null, now);
      return true;
    });
  }

  ownsReceipt(provider: string, uuid: string, sourceId: string, id: string, account?: string): boolean {
    return !!this.db.prepare(`select 1 from memory_delivery d where d.provider=? and d.room_uuid=? and d.source_id=?
      and exists (select 1 from json_each(d.external_ids) j where j.value=?)
      and not exists (select 1 from memory_delivery_foreign f where f.op_id=d.op_id and f.episode_id=?) ${MemoryDeliveryStore.accountWhere("d", account)} limit 1`).get(provider, uuid, sourceId, id, id, ...(account === undefined ? [] : [account]));
  }

  foreignCopy(opId: string, id: string): string | null {
    const row = this.db.prepare("select copy_id from memory_delivery_foreign where op_id=? and episode_id=?").get(opId, id);
    return row ? String(row.copy_id) : null;
  }

  sourceDeleted(provider: string, room: string, uuid: string, sourceId: string, opId?: string, unseen: ReadonlySet<string> = new Set(), graphId?: string, account?: string): void {
    const hidden = [...unseen];
    this.transaction(() => {
      const rows = this.db.prepare(`update memory_delivery set cleanup='episodes_deleted' where provider=? and room_uuid=? and source_id=?
        and json_extract(identity,'$.roomId')=? and retired_at is not null and cleanup='pending' and replays=0
        and coalesce(json_extract(identity,'$.graphId'),'')=? ${MemoryDeliveryStore.accountWhere("memory_delivery", account)}
        and (attempts=0 or state in ('accepted','processed','rejected') or state='prepared')
        and not exists (select 1 from memory_delivery_adoption a where a.op_id=memory_delivery.op_id)${opId ? " and op_id=?" : ""}
        ${hidden.length ? `and not exists (select 1 from json_each(external_ids) j where j.value in (${hidden.map(() => "?").join(",")}))` : ""} returning op_id`)
        .all(provider, uuid, sourceId, room, graphId ?? "", ...(account === undefined ? [] : [account]), ...(opId ? [opId] : []), ...hidden);
      for (const row of rows) {
        this.db.prepare("update memory_delivery_maintenance set state='cleaned',reason=null where op_id=?").run(row.op_id);
        this.settleWatch(String(row.op_id));
      }
    });
  }

  graphDeleted(provider: string, uuid: string, graphId?: string): void {
    this.transaction(() => {
      const rows = this.db.prepare("update memory_delivery set cleanup='graph_deleted' where provider=? and room_uuid=? and coalesce(json_extract(identity,'$.graphId'),'')=? and retired_at is not null and cleanup!='not_requested' returning op_id").all(provider, uuid, graphId ?? "");
      for (const row of rows) this.watches.close(String(row.op_id));
    });
  }

  acknowledge(opId: string, bind: (db: SqliteConnection, delivery: PreparedDelivery) => undefined): boolean {
    if (isAsyncFunction(bind)) throw new Error("Delivery acknowledgement must be synchronous SQL");
    return this.transaction(() => {
      const row = this.get(opId);
      if (!row || !isPreparedDelivery(row) || !["accepted", "processed"].includes(row.state) || row.acknowledged) return false;
      const result: unknown = bind(this.db, row);
      if (result && typeof (result as PromiseLike<unknown>).then === "function") throw new Error("Delivery acknowledgement must be synchronous SQL");
      this.db.prepare("update memory_delivery set acknowledged=1 where op_id=?").run(opId);
      this.settleWatch(opId);
      return true;
    });
  }
}

export class MemoryDeliveryWriter {
  constructor(private readonly store: MemoryDeliveryStore, private readonly now = Date.now,
    private readonly canReplay: (delivery: Delivery) => boolean = () => false,
    private readonly canSend: (delivery: Delivery) => boolean = () => true,
    private readonly beforeSend?: (delivery: Delivery, transport: WriteTransport, signal?: AbortSignal) => Promise<boolean>,
    private readonly maintenanceGate?: (row: PreparedDelivery) => boolean,
    private readonly groupPreflight?: (row: Delivery, transport: WriteTransport, signal?: AbortSignal) => Promise<GroupPreflightResult>) {}

  async deliver(opId: string, transport: WriteTransport, options: { signal?: AbortSignal; creditCap?: number; reads?: boolean } = {}): Promise<Delivery> {
    const saved = this.store.get(opId);
    if (saved && (!isPreparedDelivery(saved) || !this.store.dispatchAdmitted(opId))) return saved;
    const row = this.require(opId, transport);
    options.signal?.throwIfAborted();
    if (row.identity.maintenanceId !== undefined && !this.maintenanceGate) return row;
    if (row.groupId && (!this.groupPreflight || !transport.sourceBodyProof)) return row;
    if (!this.canSend(row)) return row;
    let groupCurrent: (() => boolean) | undefined;
    if (row.groupId && row.state === "prepared" && !row.replays) {
      const gate = await this.groupPreflight!(row, transport, options.signal);
      if (gate.kind !== "send" || gate.current() !== true || !this.canSend(this.store.get(opId)!)) return this.store.get(opId)!;
      groupCurrent = gate.current;
    }
    if (!row.groupId && this.beforeSend && row.state === "prepared" && !row.replays &&
        (!await this.beforeSend(row, transport, options.signal) || !this.canSend(this.store.get(opId)!))) return this.store.get(opId)!;
    if (row.state === "prepared" && !row.replays && this.store.claim(opId, this.now(), options.creditCap, this.maintenanceGate)) {
      return this.sendClaimed(opId, transport, options.signal, groupCurrent);
    }
    if (!this.shouldRead(row) || options.reads === false) return row;
    if (row.state === "prepared" && row.retryAt !== null && row.retryAt > this.now()) return row;
    const calledAt = this.now(), result = await this.read(row, transport, options.signal, this.mayReplay(row));
    const startedAt = result.scan?.startedAt ?? calledAt, finishedAt = result.scan?.finishedAt ?? this.now();
    const observed = this.recordRead(row, result, finishedAt);
    const current = this.store.get(opId)!;
    if (result.state === "absent" && result.represented) {
      await this.acceptRepresentation(row, result, startedAt, transport, options.signal);
      return this.store.get(opId)!;
    }
    if (row.groupId && result.state === "absent") {
      const current = await this.claimGroupedReplay(row, transport, options.signal, options.creditCap);
      if (current) return this.sendClaimed(opId, transport, options.signal, current);
      return this.store.get(opId)!;
    }
    if (result.state === "absent" && !options.signal?.aborted && isPreparedDelivery(current) && this.canSend(current) && this.canReplay(current) === true &&
        (!this.beforeSend || await this.beforeSend(current, transport, options.signal)) && this.canSend(this.store.get(opId)!) && this.store.claimAfterAbsence(opId,
      { ...result.scan, attempt: row.attempts, startedAt, finishedAt }, this.now(), options.creditCap)) {
      return this.sendClaimed(opId, transport, options.signal);
    }
    return observed;
  }

  async refresh(opId: string, transport: WriteTransport, signal?: AbortSignal): Promise<Delivery> {
    const saved = this.store.get(opId);
    if (saved && (!isPreparedDelivery(saved) || !this.store.dispatchAdmitted(opId))) return saved;
    const row = this.require(opId, transport);
    signal?.throwIfAborted();
    if (!this.shouldRead(row)) return row;
    return this.recordRead(row, await this.read(row, transport, signal), this.now());
  }

  private shouldRead(row: Delivery): boolean {
    if (!row.attempts) return false;
    return row.state === "unknown" || row.state === "accepted" || !!row.replays && ["prepared", "processed", "rejected"].includes(row.state)
      || row.state === "processed" && (row.carried || !!this.store.maintenance(row.opId)?.canonicalId);
  }

  replayCandidate(row: Delivery): boolean {
    if (!isPreparedDelivery(row) || !this.mayReplay(row)) return false;
    return !(row.state === "prepared" && row.retryAt !== null && row.retryAt > this.now());
  }

  async decideReplay(opId: string, transport: WriteTransport, options: { signal?: AbortSignal; creditCap?: number; fresh?: boolean } = {}): Promise<boolean> {
    if (!this.store.dispatchAdmitted(opId)) return false;
    const saved = this.store.get(opId);
    if (!saved || !this.replayCandidate(saved)) return false;
    const row = this.require(opId, transport);
    options.signal?.throwIfAborted();
    if (!this.canSend(row)) return false;
    if (row.groupId && (!this.groupPreflight || !transport.sourceBodyProof)) return false;
    const calledAt = this.now(), result = await this.read(row, transport, options.signal, options.fresh === true);
    const startedAt = result.scan?.startedAt ?? calledAt, finishedAt = result.scan?.finishedAt ?? this.now();
    this.recordRead(row, result, finishedAt);
    const current = this.store.get(opId)!;
    if (result.state === "absent" && result.represented) {
      await this.acceptRepresentation(row, result, startedAt, transport, options.signal);
      return false;
    }
    if (row.groupId && result.state === "absent") return (await this.claimGroupedReplay(row, transport, options.signal, options.creditCap)) !== null;
    if (result.state !== "absent" || options.signal?.aborted || !isPreparedDelivery(current) || !this.canSend(current) || this.canReplay(current) !== true) return false;
    if (this.beforeSend && !await this.beforeSend(current, transport, options.signal) || !this.canSend(this.store.get(opId)!)) return false;
    try { return this.store.claimAfterAbsence(opId, { ...result.scan, attempt: row.attempts, startedAt, finishedAt }, this.now(), options.creditCap); }
    catch (error) { if (error instanceof DeliveryBudgetError) return false; throw error; }
  }

  private adoptee(row: Delivery, result: ReadObservation, startedAt: number): string | null {
    if (result.state !== "absent" || !result.represented || !isPreparedDelivery(row) || row.identity.kind !== "episode") return null;
    const due = row.state === "unknown" ? row.attemptedAt !== null && startedAt >= row.attemptedAt + UNKNOWN_REPLAY_WAIT_MS
      : row.state === "prepared" && row.replays > 0;
    return due ? result.represented : null;
  }

  private async acceptRepresentation(before: Delivery, result: ReadObservation, startedAt: number,
    transport: WriteTransport, signal?: AbortSignal): Promise<void> {
    if (before.groupId) {
      if (this.adoptee(before, result, startedAt) && this.groupPreflight && transport.sourceBodyProof && this.canSend(before))
        await this.groupPreflight(this.store.get(before.opId) ?? before, transport, signal);
      return;
    }
    const candidate = result.state === "absent" ? result.represented : undefined;
    const current = () => {
      const row = this.store.get(before.opId);
      return !signal?.aborted && row && row.attempts === before.attempts && !row.externalIds.length &&
        this.adoptee(row, result, startedAt) === candidate && this.canSend(row) ? row : null;
    };
    if (!candidate || !transport.episodePresence || !current()) return;
    let present: "present" | "absent" | "unknown";
    try { present = await transport.episodePresence(candidate, signal); }
    catch { return; }
    const row = current();
    if (present !== "present" || !row) return;
    this.store.adopt(before.opId, candidate, this.now(), before.attempts, result.state === "absent" ? result.representedCopy : undefined);
  }

  async sendAfterClaim(opId: string, transport: WriteTransport, signal?: AbortSignal): Promise<Delivery> {
    const row = this.store.get(opId);
    if (row?.identity.maintenanceId !== undefined && !this.maintenanceGate) return row;
    if (row && !this.store.dispatchAdmitted(opId))
      return row.retiredAt === null ? row : this.store.releaseUndispatched(opId, row.attempts, this.now())!;
    if (row?.groupId) {
      if (!this.groupPreflight || !transport.sourceBodyProof || signal?.aborted || !this.canSend(row)) return this.store.releaseUndispatched(opId, row.attempts, this.now())!;
      const gate = await this.groupPreflight(row, transport, signal);
      if (gate.kind !== "send" || gate.current() !== true) return this.store.releaseUndispatched(opId, row.attempts, this.now())!;
      return this.sendClaimed(opId, transport, signal, gate.current);
    }
    return this.sendClaimed(opId, transport, signal);
  }

  private async claimGroupedReplay(before: PreparedDelivery, transport: WriteTransport, signal?: AbortSignal, cap?: number): Promise<(() => boolean) | null> {
    const live = this.store.get(before.opId);
    if (!this.groupPreflight || !transport.sourceBodyProof || !live || !isPreparedDelivery(live) || signal?.aborted ||
      live.attempts !== before.attempts || live.replays !== before.replays || !this.mayReplay(live) || !this.canSend(live) || this.canReplay(live) !== true) return null;
    const gate = await this.groupPreflight(live, transport, signal);
    if (gate.kind !== "send" || gate.current() !== true) return null;
    const pinned = this.store.get(before.opId);
    if (!pinned || !isPreparedDelivery(pinned) || pinned.attempts !== before.attempts || pinned.replays !== before.replays ||
      !this.canSend(pinned) || this.canReplay(pinned) !== true) return null;
    const calledAt = this.now(), result = await this.read(pinned, transport, signal, true);
    const startedAt = result.scan?.startedAt ?? calledAt, finishedAt = result.scan?.finishedAt ?? this.now();
    this.recordRead(pinned, result, finishedAt);
    if (gate.current() !== true || signal?.aborted) return null;
    if (result.state === "absent" && result.represented) {
      await this.acceptRepresentation(pinned, result, startedAt, transport, signal); return null;
    }
    const current = this.store.get(before.opId);
    if (result.state !== "absent" || !current || !isPreparedDelivery(current) || current.attempts !== before.attempts ||
      current.replays !== before.replays || !this.canSend(current) || this.canReplay(current) !== true || gate.current() !== true) return null;
    try { return this.store.claimAfterAbsence(before.opId, { ...result.scan, attempt: before.attempts, startedAt, finishedAt }, this.now(), cap) ? gate.current : null; }
    catch (error) { if (error instanceof DeliveryBudgetError) return null; throw error; }
  }

  private mayReplay(row: PreparedDelivery): boolean {
    if (row.identity.kind !== "episode") return false;
    if (row.state === "prepared") return row.replays > 0;
    return row.state === "unknown" && row.replays < row.replayAllowance && row.attemptedAt !== null && this.now() >= row.attemptedAt + UNKNOWN_REPLAY_WAIT_MS;
  }

  private async read(row: PreparedDelivery, transport: WriteTransport, signal?: AbortSignal, fresh = false): Promise<ReadObservation> {
    let result: ReadObservation;
    try { result = await transport.reconcile(row, signal, { fresh }); }
    catch { result = { state: "unknown", reason: signal?.aborted ? "interrupted" : "reconciliation_failed" }; }
    return result;
  }

  private recordRead(row: Delivery, result: ReadObservation, now: number): Delivery {
    return this.store.observe(row.opId, result.state === "absent" ? { state: "unknown", reason: "not_found" } : result, now, row.attempts);
  }

  private async sendClaimed(opId: string, transport: WriteTransport, signal?: AbortSignal, groupCurrent?: () => boolean): Promise<Delivery> {
    if (!this.store.dispatchAdmitted(opId)) {
      const saved = this.store.get(opId);
      if (!saved) throw new Error("Memory delivery does not exist");
      return saved.retiredAt === null ? saved : this.store.releaseUndispatched(opId, saved.attempts, this.now())!;
    }
    const row = this.require(opId, transport);
    if (row.identity.maintenanceId !== undefined && !this.maintenanceGate) return row;
    if (signal?.aborted || !this.canSend(row) || groupCurrent && groupCurrent() !== true || row.groupId && (!this.groupPreflight || !transport.sourceBodyProof)) return this.store.releaseUndispatched(opId, row.attempts, this.now())!;
    if (!this.store.markDispatch(opId, row.attempts, this.now())) return this.store.get(opId)!;
    let result: WriteObservation;
    try { result = await transport.send(row, signal); }
    catch { result = { state: "unknown", reason: signal?.aborted ? "interrupted" : "transport_error" }; }
    return this.store.observe(opId, result, this.now(), row.attempts, "send");
  }

  private require(opId: string, transport: WriteTransport): PreparedDelivery {
    const row = this.store.get(opId);
    if (!row) throw new Error("Memory delivery does not exist");
    if (!isPreparedDelivery(row)) throw new Error("Memory delivery content was erased");
    if (row.identity.provider !== transport.provider) throw new Error("Memory delivery provider mismatch");
    transport.validate(row);
    return row;
  }
}
