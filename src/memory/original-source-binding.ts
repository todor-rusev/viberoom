// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash, randomUUID } from "node:crypto";
import type { SqliteConnection } from "../sqlite-capabilities.js";
import { isDeepStrictEqual } from "node:util";
import { isAsyncFunction, isProxy } from "node:util/types";
import { carryHash } from "../carry-history.js";
import type { StoredMessage } from "../history-store.js";
import { visibleToAgents } from "../quotes.js";
import type { MemoryOutbox, VersionCheck } from "./outbox.js";
import type { OriginalMessageText } from "./original-input.js";
import type { WriteTransport } from "./delivery.js";
import { baseGenerationId } from "./graph-generations.js";
import { compatibleSourceBodies, validOriginalClassificationMetadata, validSourceBodyCreatedAt, type SourceBodyEpisode, type SourceBodyLimits, type SourceBodyProof, type SourceBodyScope, type OriginalSourceClassification } from "./source-body-proof.js";
import { freshCompleteReadTimes } from "./delivery-read-freshness.js";
import { messageSource, sourceVersion } from "./provenance.js";
import { ensureOriginalSourceSchema, originalNamespaceKey, originalReceiptOccupied, type OriginalReceiptNamespace } from "./original-source-schema.js";
import { SqlReadOnlyFence, sqliteTotalChanges } from "./sql-read-only-fence.js";
import { evaluateReceiptObservations, validObservationRequest, observationTime, observationHash, ORIGINAL_OBSERVATION_CAPS,
  type OriginalReceiptObservationRequest, type OriginalReceiptObservationSnapshot, type OriginalReceiptObservationCurrent,
  type OriginalReceiptObservationCapture, type OriginalReceiptObservationResult, type OriginalReceiptObservations } from "./original-receipt-observation.js";

export interface OriginalBindingScope extends OriginalReceiptNamespace {
  provider: "zep"; account: string; generationRevision: string;
}
export interface OriginalBindingAuthority {
  revision: string; consentRevision: string; selectionRevision: string; changedAt: number;
}
interface AcceptanceBase {
  protocol: "whole-original-source-accept-v1"; tokenId: string; scopeFingerprint: string; sourceFingerprint: string;
}
export type OriginalAcceptance = AcceptanceBase & (
  | { kind: "stream"; expectedCursor: number; expectedHasCursor: boolean; seq: number; headFingerprint: string }
  | { kind: "version-check"; check: Pick<VersionCheck, "room" | "sourceId" | "revision">; checkSnapshotFingerprint: string });
export interface OriginalBindingRequest {
  scope: OriginalBindingScope; source: StoredMessage; input: OriginalMessageText;
  authority: OriginalBindingAuthority; acceptance: OriginalAcceptance;
  limits: SourceBodyLimits; maxOriginalBytes: number; maxPrefixBytes: number;
}
export type OriginalBindingCore = Omit<OriginalBindingRequest, "source" | "acceptance">;
export interface OriginalObservedMember {
  id: string; part: string; copyId: string; opId: string; schema: 3 | 4; processed: true;
  sourceAt: string; createdAt: string; nativeHash: string; nativeBytes: number;
  metadataFingerprint: string; provenanceFingerprint: string; canonical: boolean;
}
export interface WholeOriginalReceipt {
  schema: "whole-original-source-receipt-v1"; receiptId: string; scope: Readonly<OriginalBindingScope>;
  physicalGraphId: string; sourceFingerprint: string; authorityFingerprint: string; carryHash: string;
  importFingerprint: string; selectionFingerprint: string;
  representation: OriginalMessageText["representation"]; bodyHash: string; bodyBytes: number; prefixHash: string;
  foreignCopy: string; totalParts: number; members: readonly OriginalObservedMember[];
  acceptance: OriginalAcceptance; watchId: string; committedAt: number;
  scan: { startedAt: number; finishedAt: number }; classificationScan: { startedAt: number; finishedAt: number };
  observationFingerprint: string; cohortProven: false; evidence: "complete-original-bytes";
}
type Pins = Record<string, readonly Record<string, unknown>[]>;
type OriginalWatchAction = { kind: "request" } | { kind: "begin"; now: number } | { kind: "result"; result: string; now: number };
export interface OriginalBindingSnapshot {
  request: Readonly<OriginalBindingRequest>; pins: Readonly<Pins>; capturedAt: number; monotonicAt: number;
  physicalGraphId: string; minimumAt: number; existing: WholeOriginalReceipt | null;
}
export type OriginalBindingResult = { kind: "represented"; receipt: WholeOriginalReceipt; duplicate: boolean }
  | { kind: "hold"; reason: string };
export type OriginalReceiptLookup = OriginalBindingResult | { kind: "absent" };
export type OriginalBindingCapture = { kind: "captured"; snapshot: OriginalBindingSnapshot } | { kind: "hold"; reason: string };
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object"
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);
const hash = (v: unknown) => `sha256:${createHash("sha256").update(typeof v === "string" ? v : stable(v)).digest("hex")}`;
const frozen = <T>(v: T): T => { if (v && typeof v === "object") { for (const child of Object.values(v)) frozen(child); Object.freeze(v); } return v; };
const snap = <T>(v: T): T => frozen(structuredClone(v));
const hold = (reason: string): OriginalBindingResult & { kind: "hold" } => ({ kind: "hold", reason });
const word = (v: unknown): v is string => typeof v === "string" && !!v.trim() && !/[\u0000-\u001f\u007f]/u.test(v) && Buffer.from(v).toString() === v;
const safeTime = (v: number) => Number.isSafeInteger(v) && v >= 0;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const positive = (v: number) => Number.isSafeInteger(v) && v > 0;
const fingerprint = (v: unknown): v is string => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
export function originalBindingRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value), allowed = new Set([...required, ...optional]);
  return required.every(key => Object.hasOwn(descriptors, key)) && Reflect.ownKeys(value).every(key => typeof key === "string" &&
    allowed.has(key) && descriptors[key].enumerable && Object.hasOwn(descriptors[key], "value"));
}
const recordShape = originalBindingRecord;
export function validOriginalBindingScope(value: unknown): value is OriginalBindingScope {
  return recordShape(value, ["provider", "account", "roomId", "roomUuid", "copyId", "sourceId", "version", "generationRevision"], ["graphId"]) &&
    value.provider === "zep" && [value.account, value.roomId, value.roomUuid, value.copyId, value.sourceId, value.generationRevision].every(word) &&
    fingerprint(value.version) && (!Object.hasOwn(value, "graphId") || word(value.graphId));
}
const validScope = validOriginalBindingScope;
export function validOriginalBindingCore(value: unknown): value is OriginalBindingCore {
  const limitKeys = ["maxPages", "maxEpisodes", "maxCandidates", "maxGets", "maxResponseBytes", "timeoutMs"] as const;
  if (!recordShape(value, ["scope", "input", "authority", "limits", "maxOriginalBytes", "maxPrefixBytes"]) ||
    !validScope(value.scope) || !recordShape(value.input, ["representation", "text"]) ||
    !["chat-text-v1", "memory-text-v1"].includes(value.input.representation as string) || typeof value.input.text !== "string" || !value.input.text ||
    !recordShape(value.authority, ["revision", "consentRevision", "selectionRevision", "changedAt"]) ||
    ![value.authority.revision, value.authority.consentRevision, value.authority.selectionRevision].every(word) || !safeTime(value.authority.changedAt as number) ||
    !recordShape(value.limits, limitKeys) || !limitKeys.every(k => positive((value.limits as Record<string, number>)[k]) &&
      (value.limits as Record<string, number>)[k] <= ORIGINAL_OBSERVATION_CAPS[k]) ||
    !positive(value.maxOriginalBytes as number) || (value.maxOriginalBytes as number) > 16 * 1024 * 1024 ||
    !positive(value.maxPrefixBytes as number) || (value.maxPrefixBytes as number) > 1024 * 1024 ||
    value.input.text.length > (value.maxOriginalBytes as number)) return false;
  return Buffer.from(value.input.text).toString() === value.input.text && Buffer.byteLength(value.input.text) <= (value.maxOriginalBytes as number);
}
function scopeSnapshot(scope: OriginalBindingScope): OriginalBindingScope {
  return { provider: "zep", account: scope.account, roomId: scope.roomId, roomUuid: scope.roomUuid,
    copyId: scope.copyId, sourceId: scope.sourceId, version: scope.version, generationRevision: scope.generationRevision,
    ...(scope.graphId === undefined ? {} : { graphId: scope.graphId }) };
}
function validAcceptance(value: unknown): value is OriginalAcceptance {
  const base = ["protocol", "tokenId", "scopeFingerprint", "sourceFingerprint", "kind"];
  if (!recordShape(value, [...base, ...(value && typeof value === "object" && Object.getOwnPropertyDescriptor(value, "kind")?.value === "stream"
    ? ["expectedCursor", "expectedHasCursor", "seq", "headFingerprint"] : ["check", "checkSnapshotFingerprint"])]) ||
    value.protocol !== "whole-original-source-accept-v1" || ![value.tokenId, value.scopeFingerprint, value.sourceFingerprint].every(fingerprint)) return false;
  return value.kind === "stream" ? safeTime(value.expectedCursor as number) && typeof value.expectedHasCursor === "boolean" && safeTime(value.seq as number) && fingerprint(value.headFingerprint)
    : value.kind === "version-check" && recordShape(value.check, ["room", "sourceId", "revision"]) &&
      word(value.check.room) && word(value.check.sourceId) && safeTime(value.check.revision as number) && fingerprint(value.checkSnapshotFingerprint);
}
function validScan(value: unknown): value is { startedAt: number; finishedAt: number } {
  return recordShape(value, ["startedAt", "finishedAt"]) && safeTime(value.startedAt as number) && safeTime(value.finishedAt as number);
}
function validRequestShape(value: unknown): value is OriginalBindingRequest {
  return recordShape(value, ["scope", "source", "input", "authority", "acceptance", "limits", "maxOriginalBytes", "maxPrefixBytes"]) &&
    validAcceptance(value.acceptance) && validOriginalBindingCore({ scope: value.scope, input: value.input, authority: value.authority,
      limits: value.limits, maxOriginalBytes: value.maxOriginalBytes, maxPrefixBytes: value.maxPrefixBytes });
}
function validReceiptShape(value: unknown): value is WholeOriginalReceipt {
  return recordShape(value, ["schema", "receiptId", "scope", "physicalGraphId", "sourceFingerprint", "authorityFingerprint", "carryHash", "importFingerprint",
    "selectionFingerprint", "representation", "bodyHash", "bodyBytes", "prefixHash", "foreignCopy", "totalParts", "members", "acceptance", "watchId", "committedAt",
    "scan", "classificationScan", "observationFingerprint", "cohortProven", "evidence"]) && validScope(value.scope) && validAcceptance(value.acceptance) &&
    validScan(value.scan) && validScan(value.classificationScan) && Array.isArray(value.members) && value.members.every(member =>
      recordShape(member, ["id", "part", "copyId", "opId", "schema", "processed", "sourceAt", "createdAt", "nativeHash", "nativeBytes", "metadataFingerprint", "provenanceFingerprint", "canonical"]));
}
const nativeScope = (s: OriginalBindingSnapshot): SourceBodyScope => ({ provider: "zep", account: s.request.scope.account,
  roomUuid: s.request.scope.roomUuid, graphId: s.physicalGraphId, sourceId: s.request.scope.sourceId, version: s.request.scope.version });

export class MemoryOriginalSourceBindings {
  private committing = false;
  private guarding = false;
  private preselecting = false;
  private readonly readonlySql: SqlReadOnlyFence;
  private readonly captures = new WeakSet<object>();
  private readonly observationCaptures = new WeakSet<object>();
  constructor(private readonly db: SqliteConnection, private readonly outbox: MemoryOutbox) {
    ensureOriginalSourceSchema(db); this.readonlySql = new SqlReadOnlyFence(db);
  }

  private source(room: string, id: string): StoredMessage | null {
    const row = this.db.prepare("select body from messages where room=? and id=? and deleted_at is null").get(room, id);
    return row ? JSON.parse(String(row.body)) as StoredMessage : null;
  }
  private head(scope: OriginalBindingScope, after: number): StoredMessage | null {
    for (const row of this.db.prepare("select body from messages where room=? and seq>? and kind='chat' and deleted_at is null order by seq,id").iterate(scope.roomId, after)) {
      const message = JSON.parse(String(row.body)) as StoredMessage;
      if (visibleToAgents(message)) return message;
    }
    return null;
  }
  private token(scope: OriginalBindingScope, source: StoredMessage, extra: Omit<OriginalAcceptance, keyof AcceptanceBase>): OriginalAcceptance {
    const descriptor = { protocol: "whole-original-source-accept-v1" as const, scopeFingerprint: hash(scope), sourceFingerprint: hash(source), ...extra };
    return snap({ ...descriptor, tokenId: hash(descriptor) } as OriginalAcceptance);
  }
  streamAcceptance(scope: OriginalBindingScope, sourceId: string): OriginalAcceptance | null {
    if (!validScope(scope) || !word(sourceId)) return null;
    scope = scopeSnapshot(scope);
    const source = this.source(scope.roomId, sourceId), cursor = this.outbox.cursor(scope.provider, scope.roomId);
    const head = this.head(scope, cursor);
    if (!source || sourceId !== scope.sourceId || !head || !isDeepStrictEqual(source, head) || sourceVersion(source) !== scope.version) return null;
    return this.token(scope, source, { kind: "stream", expectedCursor: cursor, expectedHasCursor: this.outbox.hasCursor(scope.provider, scope.roomId), seq: source.seq, headFingerprint: hash(head) } as Omit<OriginalAcceptance, keyof AcceptanceBase>);
  }
  checkAcceptance(scope: OriginalBindingScope, sourceId: string): OriginalAcceptance | null {
    if (!validScope(scope) || !word(sourceId)) return null;
    scope = scopeSnapshot(scope);
    const source = this.source(scope.roomId, sourceId), check = this.outbox.versionCheckFor(scope.roomId, sourceId);
    if (!source || !check || sourceId !== scope.sourceId || sourceVersion(source) !== scope.version) return null;
    return this.token(scope, source, { kind: "version-check", check: { room: check.room, sourceId: check.sourceId, revision: check.revision },
      checkSnapshotFingerprint: hash(check) } as Omit<OriginalAcceptance, keyof AcceptanceBase>);
  }
  private acceptanceCurrent(request: OriginalBindingRequest): boolean {
    const token = request.acceptance;
    if (token?.protocol !== "whole-original-source-accept-v1") return false;
    const live = token.kind === "stream" ? this.streamAcceptance(request.scope, request.source.id)
      : token.kind === "version-check" ? this.checkAcceptance(request.scope, request.source.id) : null;
    return isDeepStrictEqual(token, live);
  }
  private acceptedCheckCurrent(request: OriginalBindingRequest): boolean {
    return request.acceptance.kind !== "version-check" || !this.db.prepare("select 1 from memory_version_check where room=? and source_id=?")
      .get(request.scope.roomId, request.scope.sourceId) || this.acceptanceCurrent(request);
  }
  private namespaceFree(scope: OriginalBindingScope): boolean {
    if (this.db.prepare(`select 1 from memory_delivery_group_member m left join memory_delivery_group g using(group_id)
      left join memory_delivery d on d.op_id=m.op_id where g.group_id is null and d.op_id is null limit 1`).get()) return false;
    const d = this.outbox.deliveries, graphs = new Set([scope.graphId, scope.graphId ?? baseGenerationId(scope.roomUuid)]);
    if ((scope.graphId ?? baseGenerationId(scope.roomUuid)) === baseGenerationId(scope.roomUuid)) graphs.add(undefined);
    for (const graphId of graphs) {
      if (d.groupedSource(scope.provider, scope.roomId, scope.sourceId, undefined, graphId)) return false;
      const rows = this.db.prepare(`select 1 from memory_delivery where provider=? and room_uuid=? and source_id=?
        and json_extract(identity,'$.roomId')=? and coalesce(json_extract(identity,'$.graphId'),'')=?
        and (json_extract(identity,'$.version')=? or source_version=?) limit 1`)
        .get(scope.provider, scope.roomUuid, scope.sourceId, scope.roomId, graphId ?? "", scope.version, scope.version);
      if (rows || d.unprovenSource({ ...scope, graphId }, scope.account) || this.outbox.replacementBlocker(scope.provider,
        scope.roomId, scope.roomUuid, scope.sourceId, scope.version, graphId, scope.account)) return false;
    }
    return true;
  }
  private authority(request: OriginalBindingRequest, now: number): { physical: string; minimum: number } | null {
    if (!validRequestShape(request)) return null;
    const { scope, source, input, authority } = request;
    if (scope.provider !== "zep" || ![scope.account, scope.roomId, scope.roomUuid, scope.copyId, scope.sourceId, scope.generationRevision].every(word) ||
        !/^sha256:[a-f0-9]{64}$/.test(scope.version) || !safeTime(now) || !safeTime(authority.changedAt) || authority.changedAt > now ||
        ![authority.revision, authority.consentRevision, authority.selectionRevision].every(word) || source.id !== scope.sourceId ||
        source.kind !== "chat" || source.streaming || !visibleToAgents(source) || sourceVersion(source) !== scope.version ||
        !isDeepStrictEqual(this.source(scope.roomId, source.id), source) || !input || !["chat-text-v1", "memory-text-v1"].includes(input.representation) ||
        typeof input.text !== "string" || !input.text || Buffer.from(input.text).toString() !== input.text ||
        input.representation === "chat-text-v1" && input.text !== source.text) return null;
    const copy = { provider: scope.provider, roomId: scope.roomId, roomUuid: scope.roomUuid, copyId: scope.copyId };
    const attached = this.outbox.generationAttachment(scope.provider, scope.roomId), physical = scope.graphId ?? baseGenerationId(scope.roomUuid);
    const head = this.outbox.generations.head({ provider: scope.provider, account: scope.account, uuid: scope.roomUuid });
    if (!this.outbox.deliveries.currentCopy(copy) || this.outbox.deliveries.copyAccount(copy) !== scope.account || !attached ||
        attached.uuid !== scope.roomUuid || attached.account !== scope.account || attached.copy !== scope.copyId ||
        attached.revision !== scope.generationRevision || attached.graphId !== physical || !head.route || head.reason || head.followPending ||
        head.revision !== scope.generationRevision || head.route.graphId !== physical || head.checkedAt === null || !safeTime(head.checkedAt) || head.checkedAt > now ||
        this.outbox.forgetting(scope.provider, scope.roomId)) return null;
    const limits = request.limits;
    if (!limits || Object.keys(limits).sort().join() !== "maxCandidates,maxEpisodes,maxGets,maxPages,maxResponseBytes,timeoutMs" ||
        !Object.values(limits).every(positive) || limits.maxCandidates > 512 || limits.maxGets > 512 || limits.maxPages > 100 ||
        limits.maxEpisodes > 10000 || limits.maxResponseBytes > 64 * 1024 * 1024 || limits.timeoutMs > 20000 ||
        !positive(request.maxOriginalBytes) || request.maxOriginalBytes > 16 * 1024 * 1024 || !positive(request.maxPrefixBytes) || request.maxPrefixBytes > 1024 * 1024 ||
        Buffer.byteLength(input.text) > request.maxOriginalBytes || Buffer.byteLength(`${source.fromName} [${source.from}]: `) > request.maxPrefixBytes) return null;
    return { physical, minimum: Math.max(authority.changedAt, head.checkedAt) };
  }
  private pins(scope: OriginalBindingScope): Pins {
    const rows = (sql: string, ...args: Array<string | number>) => this.db.prepare(sql).all(...args).map(r => ({ ...r }));
    const r = scope.roomId, p = scope.provider, id = scope.sourceId;
    const result: Pins = {
      history: rows("select * from messages where room=? and id=?", r, id),
      copy: rows("select * from memory_delivery_copy where provider=? and room=?", p, r),
      copyAccount: rows("select * from memory_delivery_account where provider=? and room=?", p, r),
      attachment: rows("select * from memory_generation_attachment where provider=? and room=?", p, r),
      head: rows("select * from memory_graph_generation_head where provider=? and account=? and uuid=?", p, scope.account, scope.roomUuid),
      cursor: rows("select * from memory_cursor where provider=? and room=?", p, r),
      birth: rows("select * from memory_cursor_birth where provider=? and room=?", p, r),
      check: rows("select * from memory_version_check where room=? and source_id=?", r, id),
      imports: rows("select * from memory_imported_source where room=? and source_id=?", r, id),
      selection: rows("select * from memory_original_source_selection where room=? and source_id=?", r, id),
      own: rows("select * from memory_own_version where room=? and source_id=? order by version", r, id),
      exclusion: rows("select * from memory_version_excluded where room=? and source_id=?", r, id),
      admission: rows("select * from memory_source_admission where room=? and source_id=? order by provider,uuid,copy", r, id),
      ops: rows("select * from memory_ops where room=? and (json_extract(payload,'$.sourceId')=? or kind='forget-room') order by id", r, id),
      deliveries: rows("select * from memory_delivery where json_extract(identity,'$.roomId')=? and source_id=? order by op_id", r, id),
      groups: rows("select * from memory_delivery_group where json_extract(identity,'$.roomId')=? and json_extract(identity,'$.sourceId')=? order by group_id", r, id),
      maps: rows("select * from memory_episode_map where provider=? and room=? and source_id=? order by external_id", p, r, id),
      sources: rows("select * from memory_episode_source where provider=? and room=? and source_id=? order by external_id", p, r, id),
      accounts: rows("select * from memory_episode_account where provider=? and room=? and source_id=? order by external_id", p, r, id),
      retirements: rows("select * from memory_episode_retired where provider=? and room=? order by account,external_id", p, r),
      bound: rows("select * from memory_bound_watch where provider=? and room=? and source_id=? order by version", p, r, id),
      receipts: rows("select * from memory_original_source_receipt where provider=? and room=? and source_id=? order by receipt_id", p, r, id),
    };
    for (const [key, table, sql, args] of [
      ["carryHead", "carry_heads", "select * from carry_heads where room=? and id=? order by revision", [r, id]],
      ["carryRevisions", "carry_revisions", "select * from carry_revisions where room=? and id=? order by revision", [r, id]],
      ["carryAlternatives", "carry_alternatives", "select * from carry_alternatives where room=? and revision in (select revision from carry_revisions where room=? and id=?) order by revision", [r, r, id]],
      ["carryNumbers", "carry_numbers", "select * from carry_numbers where room=? and id=? order by source,seq", [r, id]],
      ["carryAlias", "carry_room_aliases", "select * from carry_room_aliases where room=?", [r]],
    ] as const) result[key] = this.db.prepare("select 1 from sqlite_master where type='table' and name=?").get(table) ? rows(sql, ...args) : [];
    const ownOps = result.deliveries.map(v => String(v.op_id)), groupIds = result.groups.map(v => String(v.group_id)), receiptIds = result.receipts.map(v => String(v.receipt_id));
    const inRows = (table: string, column: string, ids: string[]) => ids.length ? rows(`select * from ${table} where ${column} in (${ids.map(() => "?").join(",")}) order by ${column}`, ...ids) : [];
    for (const [key, table] of Object.entries({ attempts: "memory_delivery_attempt", foreign: "memory_delivery_foreign", adoption: "memory_delivery_adoption", removed: "memory_delivery_removed", maintenance: "memory_delivery_maintenance" })) result[key] = inRows(table, "op_id", ownOps);
    result.members = inRows("memory_delivery_group_member", "group_id", groupIds);
    result.originalMembers = inRows("memory_original_source_member", "receipt_id", receiptIds);
    result.observationClaims = inRows("memory_original_observation_claim", "receipt_id", receiptIds);
    result.watches = inRows("memory_delivery_watch", "op_id", [...ownOps, ...result.bound.map(v => String(v.watch_id)), ...receiptIds.map(id => `original:${id}`)]);
    return result;
  }
  preselectionFingerprint(scope: OriginalBindingScope): string | null {
    try {
      if (!validScope(scope)) return null;
      const pins = this.pins(scope), paidIds = new Set(pins.deliveries.map(row => String(row.op_id)));
      const excluded = new Set(["cursor", "check", "maps", "sources", "accounts", "bound", "receipts", "originalMembers", "observationClaims", "watches"]);
      return hash({ ...Object.fromEntries(Object.entries(pins).filter(([key]) => !excluded.has(key))),
        paidWatches: pins.watches.filter(row => paidIds.has(String(row.op_id))) });
    } catch { return null; }
  }
  preselectionCurrent(scope: OriginalBindingScope, fingerprint: string, current: () => boolean): boolean {
    if (this.preselecting || !validScope(scope) || typeof current !== "function" || isProxy(current) || isAsyncFunction(current)) return false;
    this.preselecting = true;
    try { return this.readOnlyAuthority(current, () => this.preselectionFingerprint(scope) === fingerprint); }
    finally { this.preselecting = false; }
  }
  private readOnlyAuthority(current: () => unknown, local: () => boolean = () => true): boolean {
    return this.readonlySql.run(current, local);
  }
  lookup(scope: OriginalBindingScope): OriginalReceiptLookup {
    try {
      if (!validScope(scope)) return hold("original_scope_shape_invalid");
      scope = scopeSnapshot(scope);
      const key = originalNamespaceKey(scope), row = this.db.prepare("select * from memory_original_source_receipt where namespace_key=?").get(key);
      if (!row) return originalReceiptOccupied(this.db, scope) ? hold("original_receipt_orphan") : { kind: "absent" };
      const receipt = JSON.parse(String(row.descriptor)) as WholeOriginalReceipt;
      if (!validReceiptShape(receipt)) return hold("original_receipt_corrupt");
      const memberRows = this.db.prepare("select * from memory_original_source_member where receipt_id=? order by external_id").all(row.receipt_id);
      const members = memberRows.map(m => JSON.parse(String(m.descriptor)) as OriginalObservedMember);
      const ordinals = new Map<string, OriginalObservedMember[]>();
      for (const member of members) ordinals.set(member.part, [...ordinals.get(member.part) ?? [], member]);
      const watch = this.outbox.deliveries.watches.get(receipt.watchId);
      if (hash(receipt) !== row.descriptor_hash || receipt.schema !== "whole-original-source-receipt-v1" || receipt.receiptId !== row.receipt_id ||
          !uuid.test(receipt.receiptId) || row.provider !== scope.provider || row.account !== scope.account || row.room !== scope.roomId || row.uuid !== scope.roomUuid ||
          row.graph_id !== receipt.physicalGraphId || row.copy_id !== scope.copyId || row.source_id !== scope.sourceId || row.version !== scope.version ||
          !safeTime(receipt.committedAt) || row.committed_at !== receipt.committedAt || !safeTime(Number(row.updated_at)) || Number(row.updated_at) < receipt.committedAt ||
          !["active", "invalidated"].includes(String(row.state)) || row.state === "active" && row.reason !== null ||
          !isDeepStrictEqual(receipt.scope, scope) || receipt.physicalGraphId !== (scope.graphId ?? baseGenerationId(scope.roomUuid)) ||
          receipt.watchId !== `original:${receipt.receiptId}` || receipt.cohortProven !== false || receipt.evidence !== "complete-original-bytes" ||
          !members.length || members.length > 512 || !isDeepStrictEqual(members, receipt.members) || memberRows.some((m, at) =>
            m.namespace_key !== key || m.external_id !== members[at].id || hash(members[at]) !== m.descriptor_hash) ||
          !positive(receipt.totalParts) || receipt.totalParts > 64 || !positive(receipt.bodyBytes) || receipt.bodyBytes > 16 * 1024 * 1024 ||
          ![receipt.sourceFingerprint, receipt.authorityFingerprint, receipt.importFingerprint, receipt.selectionFingerprint, receipt.carryHash,
            receipt.bodyHash, receipt.prefixHash, receipt.observationFingerprint].every(fingerprint) ||
          !["chat-text-v1", "memory-text-v1"].includes(receipt.representation) || !word(receipt.foreignCopy) || receipt.foreignCopy === scope.copyId ||
          members.filter(m => m.canonical).length !== receipt.totalParts || ordinals.size !== receipt.totalParts ||
          !members.every(m => uuid.test(m.id) && m.copyId === receipt.foreignCopy && m.processed === true && word(m.opId) && [3, 4].includes(m.schema) &&
            positive(m.nativeBytes) && m.nativeBytes <= 17 * 1024 * 1024 && [m.nativeHash, m.metadataFingerprint, m.provenanceFingerprint].every(fingerprint) &&
            validSourceBodyCreatedAt(m.sourceAt) && validSourceBodyCreatedAt(m.createdAt) && typeof m.canonical === "boolean") ||
          Array.from({ length: receipt.totalParts }, (_, n) => ordinals.get(`${n + 1}/${receipt.totalParts}`)).some(parts => !parts ||
            parts.filter(p => p.canonical).length !== 1 || !parts[0].canonical || parts.some(p => p.nativeHash !== parts[0].nativeHash || p.nativeBytes !== parts[0].nativeBytes)) ||
          !watch || watch.startedAt !== receipt.committedAt || watch.deadlineAt !== receipt.committedAt + this.outbox.deliveries.watches.policy.horizonMs ||
          !["active", "expired", "resolved"].includes(watch.state) || !safeTime(watch.checks) || watch.nextAt !== null && (!safeTime(watch.nextAt) || watch.nextAt > watch.deadlineAt) ||
          this.db.prepare("select 1 from memory_original_source_member where namespace_key=? and receipt_id!=? limit 1").get(key, receipt.receiptId) ||
          this.db.prepare("select 1 from memory_original_source_receipt where provider=? and room=? and uuid=? and source_id=? and receipt_id!=? limit 1")
            .get(scope.provider, scope.roomId, scope.roomUuid, scope.sourceId, receipt.receiptId)) return hold("original_receipt_corrupt");
      if (row.state !== "active") return hold("original_receipt_invalidated");
      const source = this.source(scope.roomId, scope.sourceId), attachment = this.outbox.generationAttachment(scope.provider, scope.roomId);
      const head = this.outbox.generations.head({ provider: scope.provider, account: scope.account, uuid: scope.roomUuid });
      const imports = this.db.prepare("select * from memory_imported_source where room=? and source_id=?").all(scope.roomId, scope.sourceId).map(r => ({ ...r }));
      if (!source || hash(source) !== receipt.sourceFingerprint || hash(imports) !== receipt.importFingerprint ||
          this.selectionFingerprint(this.pins(scope)) !== receipt.selectionFingerprint ||
          !this.namespaceFree(scope) || !this.outbox.deliveries.currentCopy(scope) || this.outbox.deliveries.copyAccount(scope) !== scope.account ||
          !attachment || attachment.account !== scope.account || attachment.uuid !== scope.roomUuid || attachment.copy !== scope.copyId ||
          attachment.revision !== scope.generationRevision || attachment.graphId !== receipt.physicalGraphId || head.reason || head.followPending ||
          head.revision !== scope.generationRevision || head.route?.graphId !== receipt.physicalGraphId || this.outbox.forgetting(scope.provider, scope.roomId)) return hold("original_receipt_local_namespace_conflict");
      const ids = new Set(members.map(m => m.id)), linkSource = { ...messageSource(source), graphId: receipt.physicalGraphId, boundCopy: receipt.foreignCopy };
      if (receipt.carryHash !== `sha256:${carryHash(source)}` || !isDeepStrictEqual(receipt.acceptance.scopeFingerprint, hash(scope)) ||
          receipt.acceptance.sourceFingerprint !== hash(source) || this.db.prepare("select external_id from memory_episode_map where provider=? and room=? and source_id=?")
            .all(scope.provider, scope.roomId, scope.sourceId).some(m => !ids.has(String(m.external_id)))) return hold("original_receipt_links_changed");
      for (const member of members) {
        if (this.outbox.episodeRetired(scope.provider, scope.roomId, member.id, scope.account) ||
            this.outbox.episodeRetired(scope.provider, scope.roomId, member.id, null) ||
            this.outbox.bindingAccount(scope.provider, scope.roomId, scope.sourceId, member.id) !== scope.account ||
            !this.outbox.episodeSources(scope.provider, scope.roomId, member.id, scope.account).some(s => s.sourceId === scope.sourceId && isDeepStrictEqual(s.source, linkSource))) return hold("original_receipt_links_changed");
      }
      return { kind: "represented", receipt: snap(receipt), duplicate: true };
    } catch { return hold("original_receipt_unavailable"); }
  }
  private selectionFingerprint(pins: Readonly<Pins>): string {
    return hash(Object.fromEntries(Object.entries(pins).filter(([key]) => key === "selection" || key.startsWith("carry"))));
  }
  capture(input: OriginalBindingRequest, now: number): OriginalBindingCapture {
    const monotonicAt = this.outbox.clock.now();
    try {
      if (!validRequestShape(input)) return hold("original_request_shape_invalid");
      const request = snap(input), authority = this.authority(request, now);
      if (!authority || !this.namespaceFree(request.scope)) return hold("original_binding_authority_or_namespace_unavailable");
      const existing = this.lookup(request.scope);
      if (existing.kind === "hold") return existing;
      if (existing.kind === "represented" ? !isDeepStrictEqual(existing.receipt.acceptance, request.acceptance) || !this.acceptedCheckCurrent(request)
        : !this.acceptanceCurrent(request)) return hold("original_acceptance_changed");
      const snapshot = snap({ request, physicalGraphId: authority.physical, minimumAt: authority.minimum,
        pins: this.pins(request.scope), capturedAt: now, monotonicAt, existing: existing.kind === "represented" ? existing.receipt : null });
      this.captures.add(snapshot);
      return { kind: "captured", snapshot };
    } catch { return hold("original_binding_capture_unavailable"); }
  }
  current(snapshot: OriginalBindingSnapshot, now: number): boolean {
    try { return this.captures.has(snapshot) && safeTime(now) && now >= snapshot.capturedAt &&
      !!this.authority(snapshot.request as OriginalBindingRequest, now) && this.namespaceFree(snapshot.request.scope) &&
      isDeepStrictEqual(this.pins(snapshot.request.scope), snapshot.pins) &&
      (snapshot.existing !== null ? this.acceptedCheckCurrent(snapshot.request as OriginalBindingRequest) : this.acceptanceCurrent(snapshot.request as OriginalBindingRequest)); }
    catch { return false; }
  }
  authorityCurrent(snapshot: OriginalBindingSnapshot, current: (snapshot: Readonly<OriginalBindingSnapshot>) => boolean): boolean {
    if (!this.captures.has(snapshot) || this.guarding || typeof current !== "function" || isProxy(current) || isAsyncFunction(current)) return false;
    this.guarding = true;
    try { return this.readOnlyAuthority(() => current(snapshot)); }
    finally { this.guarding = false; }
  }
  private watchOperation(scope: OriginalBindingScope, current: (receipt: Readonly<WholeOriginalReceipt>) => boolean,
    action: OriginalWatchAction): boolean {
    if (this.committing || typeof current !== "function" || isProxy(current) || isAsyncFunction(current)) return false;
    return this.readonlySql.preserveConnection(ownerCurrent => {
    this.db.exec("savepoint memory_original_watch");
    try {
      const saved = this.lookup(scope);
      if (saved.kind !== "represented") throw new Error("original_watch_not_current");
      const before = this.pins(scope), watch = before.watches.find(row => row.op_id === saved.receipt.watchId);
      if (!watch) throw new Error("original_watch_missing");
      if (!this.readOnlyAuthority(() => current(saved.receipt), () => isDeepStrictEqual(before, this.pins(scope)) &&
        isDeepStrictEqual(saved, this.lookup(scope)))) throw new Error("original_watch_authority_changed");
      let expectedWatch = { ...watch }, writes = 1n, expectedResult = true;
      if (action.kind === "request") expectedWatch.requested = 1;
      else if (action.kind === "result") expectedWatch = { ...watch, last_check_at: action.now, last_result: action.result };
      else {
        const scheduled = watch.state === "active" && watch.next_at !== null && Number(watch.next_at) <= action.now;
        if (!scheduled && watch.requested !== 1) { writes = 0n; expectedResult = false; }
        else {
          const last = scheduled && (Number(watch.next_at) >= Number(watch.deadline_at) || action.now >= Number(watch.deadline_at));
          const gap = this.outbox.deliveries.watches.policy.intervalsMs[Math.min(Number(watch.checks), this.outbox.deliveries.watches.policy.intervalsMs.length - 1)];
          expectedWatch = { ...watch, state: last ? "expired" : watch.state,
            next_at: scheduled ? last ? null : Math.min(Number(watch.deadline_at), action.now + gap) : watch.next_at,
            checks: scheduled ? Number(watch.checks) + 1 : watch.checks, requested: 0, last_check_at: action.now, last_result: "check_interrupted" };
        }
      }
      const expected = structuredClone(before);
      expected.watches = before.watches.map(row => row.op_id === saved.receipt.watchId ? expectedWatch : row);
      const totalBefore = sqliteTotalChanges(this.db);
      const result = action.kind === "request" ? this.outbox.deliveries.watches.request(saved.receipt.watchId)
        : action.kind === "begin" ? this.outbox.deliveries.watches.begin(saved.receipt.watchId, action.now)
        : (this.outbox.deliveries.watches.result(saved.receipt.watchId, action.result, action.now), true);
      if (writes !== 0n) {
        const direct = this.db.prepare("select changes() as changed"); direct.setReadBigInts(true);
        if (direct.get()!.changed !== writes) throw new Error("original_watch_direct_write_changed");
      }
      const unchanged = () => isDeepStrictEqual(expected, this.pins(scope)) && isDeepStrictEqual(saved, this.lookup(scope));
      if (result !== expectedResult || sqliteTotalChanges(this.db) - totalBefore !== writes || !unchanged()) throw new Error("original_watch_changed");
      if (!this.readOnlyAuthority(() => current(saved.receipt), unchanged) || sqliteTotalChanges(this.db) - totalBefore !== writes)
        throw new Error("original_watch_final_authority_changed");
      if (!ownerCurrent()) throw new Error("original_watch_sql_state_changed");
      this.db.exec("release memory_original_watch"); return result;
    } catch { this.db.exec("rollback to memory_original_watch; release memory_original_watch"); return false; }
    });
  }
  requestWatch(scope: OriginalBindingScope, current: (receipt: Readonly<WholeOriginalReceipt>) => boolean): boolean {
    return this.watchOperation(scope, current, { kind: "request" });
  }
  beginWatch(scope: OriginalBindingScope, now: number, current: (receipt: Readonly<WholeOriginalReceipt>) => boolean): boolean {
    if (!safeTime(now)) return false;
    return this.watchOperation(scope, current, { kind: "begin", now });
  }
  recordWatchResult(scope: OriginalBindingScope, result: string, now: number, current: (receipt: Readonly<WholeOriginalReceipt>) => boolean): boolean {
    if (!safeTime(now) || !word(result) || result.length > 500) return false;
    return this.watchOperation(scope, current, { kind: "result", result, now });
  }
  private observationLocal(snapshot: OriginalReceiptObservationSnapshot, now: number): boolean {
    const { request, receipt, source } = snapshot;
    const saved = this.lookup(request.scope);
    return observationTime(now) && now >= snapshot.capturedAt && request.authority.changedAt <= now &&
      saved.kind === "represented" && isDeepStrictEqual(saved.receipt, receipt) &&
      isDeepStrictEqual(this.source(request.scope.roomId, request.scope.sourceId), source) &&
      isDeepStrictEqual(this.pins(request.scope), snapshot.pins);
  }
  private observationFence(snapshot: OriginalReceiptObservationSnapshot, current: OriginalReceiptObservationCurrent, now: number): boolean {
    return this.readOnlyAuthority(() => current(snapshot), () => this.observationLocal(snapshot, now));
  }
  captureObservation(raw: OriginalReceiptObservationRequest, current: OriginalReceiptObservationCurrent, now: number): OriginalReceiptObservationCapture {
    const monotonicAt = this.outbox.clock.now(), held = (reason: string): OriginalReceiptObservationCapture => ({ kind: "held", reason });
    if (this.committing || this.guarding || !validObservationRequest(raw) || typeof current !== "function" || isProxy(current) || isAsyncFunction(current) || !observationTime(now))
      return held("observation_request_invalid");
    return this.readonlySql.preserveConnection<OriginalReceiptObservationCapture>(ownerCurrent => {
    this.committing = true;
    let opened = false;
    try {
      const request = snap(raw), saved = this.lookup(request.scope), source = this.source(request.scope.roomId, request.scope.sourceId);
      if (saved.kind !== "represented" || saved.receipt.receiptId !== request.receiptId || !source ||
        observationHash(request.authority) !== saved.receipt.authorityFingerprint || request.authority.changedAt > now ||
        request.input.representation !== saved.receipt.representation || observationHash(request.input.text) !== saved.receipt.bodyHash ||
        Buffer.byteLength(request.input.text) !== saved.receipt.bodyBytes || request.input.representation === "chat-text-v1" && request.input.text !== source.text ||
        observationHash(`${source.fromName} [${source.from}]: `) !== saved.receipt.prefixHash ||
        Buffer.byteLength(`${source.fromName} [${source.from}]: `) > request.maxPrefixBytes) return held("observation_receipt_unavailable");
      const receipt = saved.receipt, claimId = randomUUID(), deadlineAt = now + request.limits.timeoutMs;
      if (!observationTime(deadlineAt)) return held("observation_request_invalid");
      this.db.exec("savepoint memory_original_observation_capture"); opened = true;
      const oldClaim = this.db.prepare("select * from memory_original_observation_claim where receipt_id=?").get(receipt.receiptId);
      if (oldClaim && (!uuid.test(String(oldClaim.claim_id)) || !observationTime(oldClaim.claimed_at) || !observationTime(oldClaim.deadline_at) ||
        oldClaim.deadline_at <= oldClaim.claimed_at || oldClaim.deadline_at - oldClaim.claimed_at > ORIGINAL_OBSERVATION_CAPS.timeoutMs ||
        (oldClaim.finished_at === null ? oldClaim.outcome !== null : !observationTime(oldClaim.finished_at) || oldClaim.finished_at < oldClaim.claimed_at ||
          !["unchanged", "changed", "unknown"].includes(String(oldClaim.outcome))))) throw new Error("observation_claim_corrupt");
      if (oldClaim && oldClaim.finished_at === null && Number(oldClaim.deadline_at) > now) throw new Error("observation_busy");
      const head = this.outbox.generations.head({ provider: request.scope.provider, account: request.scope.account, uuid: request.scope.roomUuid });
      if (head.checkedAt === null || !observationTime(head.checkedAt) || head.checkedAt > now) throw new Error("observation_route_unavailable");
      const provisional = snap({ request, receipt, source, claimId, capturedAt: now, monotonicAt, deadlineAt,
        minimumAt: Math.max(request.authority.changedAt, head.checkedAt), pins: this.pins(request.scope) });
      if (!this.observationFence(provisional, current, now) || this.outbox.clock.now() - monotonicAt >= request.limits.timeoutMs) throw new Error("observation_authority_changed");
      const before = structuredClone(provisional.pins);
      const mutationCount = sqliteTotalChanges(this.db);
      if (!this.outbox.deliveries.watches.begin(receipt.watchId, now)) {
        this.db.exec("rollback to memory_original_observation_capture; release memory_original_observation_capture"); opened = false;
        return { kind: "not-due", reason: "observation_not_due" };
      }
      const claim = { receipt_id: receipt.receiptId, claim_id: claimId, claimed_at: now, deadline_at: deadlineAt, finished_at: null, outcome: null };
      this.db.prepare(`insert into memory_original_observation_claim values(?,?,?,?,null,null) on conflict(receipt_id)
        do update set claim_id=excluded.claim_id,claimed_at=excluded.claimed_at,deadline_at=excluded.deadline_at,finished_at=null,outcome=null`)
        .run(receipt.receiptId, claimId, now, deadlineAt);
      if (sqliteTotalChanges(this.db) !== mutationCount + 2n) throw new Error("observation_claim_sql_delta");
      const expected = before as Record<string, Array<Record<string, unknown>>>;
      const watch = before.watches.find(row => row.op_id === receipt.watchId)!;
      const scheduled = watch.state === "active" && watch.next_at !== null && Number(watch.next_at) <= now;
      const last = scheduled && (Number(watch.next_at) >= Number(watch.deadline_at) || now >= Number(watch.deadline_at));
      const gap = this.outbox.deliveries.watches.policy.intervalsMs[Math.min(Number(watch.checks), this.outbox.deliveries.watches.policy.intervalsMs.length - 1)];
      expected.watches = before.watches.map(row => row === watch ? { ...row, state: last ? "expired" : row.state,
        next_at: scheduled ? last ? null : Math.min(Number(row.deadline_at), now + gap) : row.next_at,
        checks: Number(row.checks) + (scheduled ? 1 : 0), requested: 0, last_check_at: now, last_result: "check_interrupted" } : row);
      expected.observationClaims = [...before.observationClaims.filter(row => row.receipt_id !== receipt.receiptId), claim]
        .sort((a, b) => String(a.receipt_id).localeCompare(String(b.receipt_id)));
      const snapshot = snap({ ...provisional, pins: expected });
      if (!this.observationFence(snapshot, current, now) || this.outbox.clock.now() - monotonicAt >= request.limits.timeoutMs) throw new Error("observation_claim_changed");
      if (!ownerCurrent()) throw new Error("observation_claim_sql_state_changed");
      this.db.exec("release memory_original_observation_capture"); opened = false;
      this.observationCaptures.add(snapshot); return { kind: "captured", snapshot };
    } catch { return held("observation_claim_unavailable"); }
    finally { if (opened) this.db.exec("rollback to memory_original_observation_capture; release memory_original_observation_capture"); this.committing = false; }
    });
  }
  observationCurrent(snapshot: OriginalReceiptObservationSnapshot, current: OriginalReceiptObservationCurrent, now: number): boolean {
    if (!this.observationCaptures.has(snapshot) || this.committing || this.guarding || typeof current !== "function" || isProxy(current) || isAsyncFunction(current)) return false;
    return this.readonlySql.preserveConnection(ownerCurrent => {
    this.guarding = true; this.db.exec("savepoint memory_original_observation_current");
    try {
      if (this.outbox.clock.now() - snapshot.monotonicAt >= snapshot.request.limits.timeoutMs || !this.observationFence(snapshot, current, now) ||
        this.outbox.clock.now() - snapshot.monotonicAt >= snapshot.request.limits.timeoutMs) throw new Error("observation_current_changed");
      if (!ownerCurrent()) throw new Error("observation_current_sql_state_changed");
      this.db.exec("release memory_original_observation_current"); return true;
    } catch { this.db.exec("rollback to memory_original_observation_current; release memory_original_observation_current"); return false; }
    finally { this.guarding = false; }
    });
  }
  finishObservation(snapshot: OriginalReceiptObservationSnapshot, raw: OriginalReceiptObservations | null,
    current: OriginalReceiptObservationCurrent, now: number): OriginalReceiptObservationResult {
    const held = (): OriginalReceiptObservationResult => ({ kind: "held", reason: "observation_final_authority_changed" });
    if (!this.observationCaptures.has(snapshot) || this.committing || this.guarding || typeof current !== "function" || isProxy(current) || isAsyncFunction(current) || !observationTime(now)) return held();
    return this.readonlySql.preserveConnection<OriginalReceiptObservationResult>(ownerCurrent => {
    this.committing = true; const at = this.outbox.clock.now(); let opened = false;
    const effective = () => Math.ceil(Math.max(now + this.outbox.clock.now() - at, snapshot.capturedAt + this.outbox.clock.now() - snapshot.monotonicAt));
    try {
      const outcome = this.outbox.clock.now() - snapshot.monotonicAt >= snapshot.request.limits.timeoutMs ? "unknown" : evaluateReceiptObservations(snapshot, raw, effective());
      this.db.exec("savepoint memory_original_observation_finish"); opened = true;
      if (!this.observationFence(snapshot, current, effective())) throw new Error("observation_current_changed");
      if (outcome !== "unknown" && evaluateReceiptObservations(snapshot, raw, effective()) !== outcome) throw new Error("observation_expired");
      const result = `original_observation_${outcome}`, expected = structuredClone(snapshot.pins) as Record<string, Array<Record<string, unknown>>>;
      expected.watches = expected.watches.map(row => row.op_id === snapshot.receipt.watchId ? { ...row, last_check_at: now, last_result: result } : row);
      expected.observationClaims = expected.observationClaims.map(row => row.receipt_id === snapshot.receipt.receiptId ? { ...row, finished_at: now, outcome } : row);
      const mutationCount = sqliteTotalChanges(this.db);
      this.outbox.deliveries.watches.result(snapshot.receipt.watchId, result, now);
      if (this.db.prepare(`update memory_original_observation_claim set finished_at=?,outcome=? where receipt_id=? and claim_id=? and finished_at is null`)
        .run(now, outcome, snapshot.receipt.receiptId, snapshot.claimId).changes !== 1) throw new Error("observation_claim_lost");
      if (sqliteTotalChanges(this.db) !== mutationCount + 2n) throw new Error("observation_finish_sql_delta");
      const final = snap({ ...snapshot, pins: expected });
      if (!this.observationFence(final, current, effective()) || outcome !== "unknown" &&
        (this.outbox.clock.now() - snapshot.monotonicAt >= snapshot.request.limits.timeoutMs || evaluateReceiptObservations(snapshot, raw, effective()) !== outcome)) throw new Error("observation_final_changed");
      if (!ownerCurrent()) throw new Error("observation_finish_sql_state_changed");
      this.db.exec("release memory_original_observation_finish"); opened = false;
      this.observationCaptures.delete(snapshot);
      return { kind: outcome, receiptId: snapshot.receipt.receiptId, cohortProven: false };
    } catch { return held(); }
    finally { if (opened) this.db.exec("rollback to memory_original_observation_finish; release memory_original_observation_finish"); this.committing = false; }
    });
  }
  classificationCurrent(snapshot: OriginalBindingSnapshot, listing: OriginalSourceClassification, now: number): boolean {
    if (listing.state !== "complete" || !(listing.bySource instanceof Map)) return false;
    const episodes = listing.bySource.get(snapshot.request.scope.sourceId) ?? [];
    return this.current(snapshot, now) && !!this.validateObservations(snapshot, listing, { state: "complete", scope: listing.scope,
      episodes: episodes as readonly SourceBodyEpisode[], scan: { startedAt: listing.startedAt, finishedAt: listing.finishedAt }, accounting: listing.accounting }, now, false);
  }
  private validateObservations(snapshot: OriginalBindingSnapshot, listing: OriginalSourceClassification, proof: SourceBodyProof, now: number, aggregate = true): readonly SourceBodyEpisode[] | null {
    const { request, minimumAt } = snapshot, scope = request.scope, carried = `sha256:${carryHash(request.source)}`;
    const accounting = (a: unknown): boolean => !!a && typeof a === "object" && Object.keys(a).sort().join() === "candidates,episodes,gets,pages,responseBytes" &&
      Object.values(a).every(safeTime) && (a as { pages: number }).pages >= 1 && (a as { responseBytes: number }).responseBytes > 0;
    if (listing.state !== "complete" || proof.state !== "complete" || !isDeepStrictEqual(listing.scope, nativeScope(snapshot)) ||
        !accounting(listing.accounting) || !accounting(proof.accounting) ||
        !Object.values(listing.accounting).every(safeTime) || listing.accounting.pages > request.limits.maxPages || listing.accounting.episodes > request.limits.maxEpisodes ||
        listing.accounting.candidates > request.limits.maxCandidates || listing.accounting.gets > request.limits.maxGets || listing.accounting.responseBytes > request.limits.maxResponseBytes ||
        !freshCompleteReadTimes({ startedAt: listing.startedAt, finishedAt: listing.finishedAt }, now, [minimumAt]) ||
        !validScan(proof.scan) || !freshCompleteReadTimes(proof.scan, now, [minimumAt]) || !isDeepStrictEqual(proof.scope, nativeScope(snapshot)) ||
        aggregate && proof.scan.startedAt < listing.finishedAt ||
        !proof.episodes.length || proof.episodes.length > request.limits.maxCandidates ||
        !Object.values(proof.accounting).every(safeTime) || proof.accounting.pages > request.limits.maxPages || proof.accounting.episodes > request.limits.maxEpisodes ||
        proof.accounting.gets > request.limits.maxGets || proof.accounting.responseBytes > request.limits.maxResponseBytes || proof.accounting.candidates !== proof.episodes.length ||
        proof.accounting.gets !== proof.episodes.length || proof.accounting.episodes < proof.episodes.length ||
        this.outbox.clock.now() - snapshot.monotonicAt >= request.limits.timeoutMs || aggregate &&
        Object.entries({ pages: "maxPages", episodes: "maxEpisodes", candidates: "maxCandidates", gets: "maxGets", responseBytes: "maxResponseBytes" } as const)
          .some(([key, cap]) => listing.accounting[key as keyof typeof listing.accounting] + proof.accounting[key as keyof typeof proof.accounting] > request.limits[cap])) return null;
    if (!(listing.bySource instanceof Map) || listing.bySource.size !== 1 || !listing.bySource.has(scope.sourceId)) return null;
    const same = (listing.bySource.get(scope.sourceId) ?? []) as readonly SourceBodyEpisode[], episodes = proof.episodes;
    if (listing.accounting.candidates !== same.length || listing.accounting.gets !== same.length || listing.accounting.episodes < same.length) return null;
    if (same.length !== episodes.length || new Set(same.map(e => e.id)).size !== same.length || same.some(e => e.kind !== "message" || e.sourceId !== scope.sourceId ||
        e.version !== scope.version || e.carryHash !== carried || e.legacy || !episodes.some(b => isDeepStrictEqual(b, e)))) return null;
    const partitions = new Set(episodes.map(e => JSON.stringify([e.copyId, e.part.split("/")[1]])));
    if (partitions.size !== 1 || episodes.some(e => !uuid.test(e.id) || !e.processed || ![3, 4].includes(e.schema) || e.legacy ||
        !word(e.copyId) || e.copyId === "unknown" || e.copyId === scope.copyId || !word(e.opId) || e.carryHash !== carried || !validOriginalClassificationMetadata(e.metadata) ||
        this.db.prepare("select 1 from memory_delivery where op_id=?").get(e.opId) ||
        this.outbox.episodeRetired(scope.provider, scope.roomId, e.id, scope.account) || this.outbox.episodeRetired(scope.provider, scope.roomId, e.id, null))) return null;
    const result = compatibleSourceBodies(nativeScope(snapshot), { mode: "original", source: {
      roomUuid: scope.roomUuid, sourceId: scope.sourceId, version: scope.version, authorId: request.source.from!, authorName: request.source.fromName!,
      ts: request.source.ts, seq: request.source.seq, ...(request.source.origin ? { originCopy: request.source.origin } : {}) }, input: request.input,
      maxOriginalBytes: request.maxOriginalBytes, maxPrefixBytes: request.maxPrefixBytes }, proof);
    if (result.kind !== "compatible" || result.evidence !== "complete-original-bytes") return null;
    return result.episodes;
  }
  commit(captured: OriginalBindingSnapshot, rawListing: OriginalSourceClassification, rawProof: SourceBodyProof,
    current: (snapshot: Readonly<OriginalBindingSnapshot>) => boolean, now: number): OriginalBindingResult {
    const started = this.outbox.clock.now();
    if (this.committing || !this.captures.has(captured) || !validRequestShape(captured.request) || typeof current !== "function" || isAsyncFunction(current)) return hold("original_binding_guard_unavailable");
    return this.readonlySql.preserveConnection<OriginalBindingResult>(ownerCurrent => {
    this.committing = true;
    let opened = false;
    try {
      if (rawProof.state === "complete" && !validScan(rawProof.scan)) return hold("original_observation_shape_invalid");
      const snapshot = snap(captured), listing = structuredClone(rawListing), proof = snap(rawProof), { request } = snapshot, scope = request.scope;
      const effectiveNow = () => Math.ceil(Math.max(now + this.outbox.clock.now() - started, snapshot.capturedAt + this.outbox.clock.now() - snapshot.monotonicAt));
      let expectedPins = structuredClone(snapshot.pins);
      const fence = (accepted = false) => {
        if (!safeTime(now) || now < snapshot.capturedAt || !this.authority(request, effectiveNow()) || !this.namespaceFree(scope) ||
            !isDeepStrictEqual(this.pins(scope), expectedPins) || !this.validateObservations(snapshot, listing, proof, effectiveNow())) throw new Error("original_binding_changed");
        if (!this.readOnlyAuthority(() => current(snapshot)) ||
            !isDeepStrictEqual(this.pins(scope), expectedPins) || !this.authority(request, effectiveNow()) ||
            !this.namespaceFree(scope) || !this.validateObservations(snapshot, listing, proof, effectiveNow())) throw new Error("original_binding_current_changed");
        if (!accepted && !snapshot.existing && !this.acceptanceCurrent(request)) throw new Error("original_acceptance_changed");
        if ((accepted || snapshot.existing) && !this.acceptedCheckCurrent(request)) throw new Error("original_acceptance_changed");
      };
      this.db.exec("savepoint memory_whole_original_binding"); opened = true; fence();
      const changesBeforeWrites = sqliteTotalChanges(this.db);
      let expectedWrites = 0n;
      const sqlDelta = () => {
        if (sqliteTotalChanges(this.db) !== changesBeforeWrites + expectedWrites)
          throw new Error("original_binding_sql_delta");
      };
      const chosen = this.validateObservations(snapshot, listing, proof, effectiveNow())!;
      if (proof.state !== "complete" || listing.state !== "complete") throw new Error("original_observation_unknown");
      const canonical = new Set(chosen.map(e => e.id));
      const members = proof.episodes.map(e => ({ id: e.id, part: e.part, copyId: e.copyId!, opId: e.opId!, schema: e.schema as 3 | 4,
        processed: true as const, sourceAt: e.sourceAt, createdAt: e.createdAt, nativeHash: hash(e.content), nativeBytes: Buffer.byteLength(e.content),
        metadataFingerprint: hash(e.metadata), provenanceFingerprint: hash({ source: e.source, sourceDescription: e.sourceDescription }), canonical: canonical.has(e.id) }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const ids = new Set(members.map(m => m.id)), linkSource = { ...messageSource(request.source), graphId: snapshot.physicalGraphId, boundCopy: chosen[0].copyId! };
      for (const map of this.db.prepare("select * from memory_episode_map where provider=? and room=? and source_id=?").all(scope.provider, scope.roomId, scope.sourceId)) {
        const id = String(map.external_id), row = this.db.prepare("select source from memory_episode_source where provider=? and room=? and source_id=? and external_id=?").get(scope.provider, scope.roomId, scope.sourceId, id);
        if (!ids.has(id) || !row || !isDeepStrictEqual(JSON.parse(String(row.source)), linkSource) || this.outbox.bindingAccount(scope.provider, scope.roomId, scope.sourceId, id) !== scope.account) throw new Error("original_existing_map_conflict");
      }
      for (const id of ids) if (this.db.prepare("select 1 from memory_episode_map where provider=? and room=? and external_id=? and source_id!=? limit 1").get(scope.provider, scope.roomId, id, scope.sourceId)) throw new Error("original_reverse_map_conflict");
      const identity = { scope, sourceFingerprint: hash(request.source), authorityFingerprint: hash(request.authority), carryHash: `sha256:${carryHash(request.source)}`,
        importFingerprint: hash(snapshot.pins.imports), selectionFingerprint: this.selectionFingerprint(snapshot.pins),
        representation: request.input.representation, bodyHash: hash(request.input.text), bodyBytes: Buffer.byteLength(request.input.text),
        prefixHash: hash(`${request.source.fromName} [${request.source.from}]: `), foreignCopy: chosen[0].copyId!, totalParts: chosen.length, members, acceptance: request.acceptance };
      if (snapshot.existing) {
        for (const [key, value] of Object.entries(identity)) if (!isDeepStrictEqual(value, snapshot.existing[key as keyof WholeOriginalReceipt])) throw new Error("original_receipt_retry_changed");
        sqlDelta(); fence();
        if (!ownerCurrent()) throw new Error("original_binding_sql_state_changed");
        this.db.exec("release memory_whole_original_binding"); opened = false;
        return { kind: "represented", receipt: snapshot.existing, duplicate: true };
      }
      const receiptId = randomUUID(), receipt: WholeOriginalReceipt = { schema: "whole-original-source-receipt-v1", receiptId, ...identity,
        physicalGraphId: snapshot.physicalGraphId, watchId: `original:${receiptId}`, committedAt: now,
        scan: { startedAt: proof.scan.startedAt, finishedAt: proof.scan.finishedAt },
        classificationScan: { startedAt: listing.startedAt, finishedAt: listing.finishedAt }, observationFingerprint: hash(proof), cohortProven: false, evidence: "complete-original-bytes" };
      const key = originalNamespaceKey(scope);
      if (Number(this.db.prepare("insert into memory_original_source_receipt values(?,?,?,?,?,?,?,?,?,?,?,?,'active',null,?,?)")
        .run(receiptId, key, scope.provider, scope.account, scope.roomId, scope.roomUuid, snapshot.physicalGraphId, scope.copyId, scope.sourceId, scope.version, stable(receipt), hash(receipt), now, now).changes) !== 1)
        throw new Error("original_binding_receipt_sql_count");
      expectedWrites++;
      const expected = expectedPins as Record<string, Array<Record<string, unknown>>>;
      expected.receipts = [...expected.receipts, { receipt_id: receiptId, namespace_key: key, provider: scope.provider, account: scope.account, room: scope.roomId,
        uuid: scope.roomUuid, graph_id: snapshot.physicalGraphId, copy_id: scope.copyId, source_id: scope.sourceId, version: scope.version,
        descriptor: stable(receipt), descriptor_hash: hash(receipt), state: "active", reason: null, committed_at: now, updated_at: now }].sort((a, b) => String(a.receipt_id).localeCompare(String(b.receipt_id)));
      expected.originalMembers = [...expected.originalMembers, ...members.map(member => ({ receipt_id: receiptId, namespace_key: key, external_id: member.id,
        descriptor: stable(member), descriptor_hash: hash(member) }))];
      for (const member of members) {
        if (Number(this.db.prepare("insert into memory_original_source_member values(?,?,?,?,?)").run(receiptId, key, member.id, stable(member), hash(member)).changes) !== 1)
          throw new Error("original_binding_member_sql_count");
        expectedWrites++;
        expectedWrites += BigInt(["maps", "sources", "accounts"].filter(table => !expected[table].some(row => row.external_id === member.id)).length);
        this.outbox.mapEpisode(scope.provider, scope.roomId, scope.sourceId, member.id, linkSource, scope.account);
        const add = (table: string, row: Record<string, unknown>) => {
          if (!expected[table].some(r => r.external_id === member.id)) expected[table].push(row);
          expected[table].sort((a, b) => String(a.external_id).localeCompare(String(b.external_id)));
        };
        add("maps", { provider: scope.provider, room: scope.roomId, source_id: scope.sourceId, external_id: member.id });
        add("sources", { provider: scope.provider, room: scope.roomId, source_id: scope.sourceId, external_id: member.id, source: JSON.stringify(linkSource) });
        add("accounts", { provider: scope.provider, room: scope.roomId, source_id: scope.sourceId, external_id: member.id, account: scope.account });
      }
      this.outbox.deliveries.watches.ensure(receipt.watchId, now, now);
      expectedWrites++;
      expected.watches.push({ op_id: receipt.watchId, started_at: now, deadline_at: now + this.outbox.deliveries.watches.policy.horizonMs,
        state: "active", checks: 0, next_at: now + this.outbox.deliveries.watches.policy.firstMs, requested: 0, last_check_at: null, last_result: null });
      expected.watches.sort((a, b) => String(a.op_id).localeCompare(String(b.op_id)));
      fence();
      if (request.acceptance.kind === "stream") {
        if (!this.acceptanceCurrent(request)) throw new Error("original_stream_head_changed");
        this.outbox.advance(scope.provider, scope.roomId, request.acceptance.seq);
        expected.cursor = [{ provider: scope.provider, room: scope.roomId, seq: request.acceptance.seq }];
      } else {
        if (!this.acceptanceCurrent(request)) throw new Error("original_check_changed");
        this.outbox.versionChecked(scope.roomId, scope.sourceId, request.acceptance.check.revision); expected.check = [];
      }
      expectedWrites++;
      sqlDelta();
      fence(true);
      const saved = this.lookup(scope);
      if (saved.kind !== "represented" || !isDeepStrictEqual(saved.receipt, receipt)) throw new Error("original_receipt_postcondition_changed");
      if (!ownerCurrent()) throw new Error("original_binding_sql_state_changed");
      this.db.exec("release memory_whole_original_binding"); opened = false;
      return { kind: "represented", receipt: snap(receipt), duplicate: false };
    } catch (error) {
      if (opened) this.db.exec("rollback to memory_whole_original_binding; release memory_whole_original_binding");
      return hold(error instanceof Error && /^original_[a-z_]+$/.test(error.message) ? error.message : "original_binding_refused");
    } finally { this.committing = false; }
    });
  }
}

export async function bindWholeOriginalForeign(outbox: MemoryOutbox, reads: WriteTransport,
  request: OriginalBindingRequest, current: (snapshot: Readonly<OriginalBindingSnapshot>) => boolean,
  now: () => number, signal: AbortSignal): Promise<OriginalBindingResult> {
  if (!validRequestShape(request)) return hold("original_request_shape_invalid");
  if (typeof current !== "function" || isAsyncFunction(current) || reads.provider !== request.scope.provider || !reads.originalSourceClassification || !reads.originalSourceBodyProof) return hold("original_binding_read_port_unavailable");
  const captured = outbox.originals.capture(request, now());
  if (captured.kind !== "captured") return captured;
  const snapshot = captured.snapshot;
  const authorityCurrent = () => {
    if (signal.aborted) return false;
    return outbox.originals.authorityCurrent(snapshot, current);
  };
  const live = () => outbox.clock.now() - snapshot.monotonicAt < snapshot.request.limits.timeoutMs &&
    authorityCurrent() && outbox.originals.current(snapshot, now());
  try {
    if (!live()) return hold("original_binding_authority_changed");
    const firstLimits = { ...snapshot.request.limits, timeoutMs: Math.floor(snapshot.request.limits.timeoutMs - (outbox.clock.now() - snapshot.monotonicAt)) };
    if (!positive(firstLimits.timeoutMs)) return hold("original_binding_aggregate_budget_exhausted");
    const listing = structuredClone(await reads.originalSourceClassification({ scope: nativeScope(snapshot), limits: firstLimits }, signal, live));
    if (!live()) return hold("original_binding_authority_changed");
    if (listing.state !== "complete") return hold("original_binding_classification_unknown");
    if (!outbox.originals.classificationCurrent(snapshot, listing, now())) return hold("original_binding_classification_held");
    const limits = { ...snapshot.request.limits, timeoutMs: Math.floor(snapshot.request.limits.timeoutMs - (outbox.clock.now() - snapshot.monotonicAt)) };
    for (const [key, cap] of Object.entries({ pages: "maxPages", episodes: "maxEpisodes", candidates: "maxCandidates", gets: "maxGets", responseBytes: "maxResponseBytes" } as const))
      limits[cap] -= listing.accounting[key as keyof typeof listing.accounting];
    if (!Object.values(limits).every(positive)) return hold("original_binding_aggregate_budget_exhausted");
    const proof = structuredClone(await reads.originalSourceBodyProof({ scope: nativeScope(snapshot), limits }, signal, live));
    if (!live()) return hold("original_binding_authority_changed");
    return outbox.originals.commit(snapshot, listing, proof, authorityCurrent, now());
  } catch { return hold("original_binding_read_failed"); }
}
