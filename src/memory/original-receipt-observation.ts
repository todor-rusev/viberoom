// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { isAsyncFunction, isProxy } from "node:util/types";
import type { StoredMessage } from "../history-store.js";
import type { MemoryOutbox } from "./outbox.js";
import type { WriteTransport } from "./delivery.js";
import type { OriginalMessageText } from "./original-input.js";
import type { OriginalBindingAuthority, OriginalBindingScope, WholeOriginalReceipt } from "./original-source-binding.js";
import { freshCompleteReadTimes } from "./delivery-read-freshness.js";
import { readZepMetadata } from "./zep-metadata.js";
import { validOriginalClassificationMetadata, validSourceBodyCreatedAt, type SourceBodyAccounting, type SourceBodyEpisode,
  type SourceBodyLimits, type SourceBodyScope, type OriginalSourceClassification, type SourceBodyProof } from "./source-body-proof.js";

export interface OriginalReceiptObservationRequest {
  scope: OriginalBindingScope; receiptId: string; input: OriginalMessageText; authority: OriginalBindingAuthority;
  limits: SourceBodyLimits; maxOriginalBytes: number; maxPrefixBytes: number;
}
export interface OriginalReceiptObservationSnapshot {
  request: Readonly<OriginalReceiptObservationRequest>; receipt: Readonly<WholeOriginalReceipt>; source: Readonly<StoredMessage>;
  pins: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  claimId: string; capturedAt: number; monotonicAt: number; deadlineAt: number; minimumAt: number;
}
export type OriginalReceiptObservationOutcome = "unchanged" | "changed" | "unknown";
export type OriginalReceiptObservationResult = { kind: OriginalReceiptObservationOutcome; receiptId: string; cohortProven: false }
  | { kind: "held" | "not-due"; reason: string };
export type OriginalReceiptObservationCapture = { kind: "captured"; snapshot: OriginalReceiptObservationSnapshot }
  | Extract<OriginalReceiptObservationResult, { kind: "held" | "not-due" }>;
export interface OriginalReceiptObservations { classification: OriginalSourceClassification; body?: SourceBodyProof }
export type OriginalReceiptObservationCurrent = (snapshot: Readonly<OriginalReceiptObservationSnapshot>) => boolean;
const keys = ["maxPages", "maxEpisodes", "maxCandidates", "maxGets", "maxResponseBytes", "timeoutMs"] as const;
export const ORIGINAL_OBSERVATION_CAPS: Readonly<SourceBodyLimits> = Object.freeze({ maxPages: 100, maxEpisodes: 10000,
  maxCandidates: 512, maxGets: 512, maxResponseBytes: 64 * 1024 * 1024, timeoutMs: 20000 });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fingerprint = (v: unknown): v is string => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
const word = (v: unknown): v is string => typeof v === "string" && !!v.trim() && !/[\u0000-\u001f\u007f]/u.test(v) && Buffer.from(v).toString() === v;
export const observationTime = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number => observationTime(v) && v > 0;
export function observationRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value), allowed = new Set([...required, ...optional]);
  return required.every(key => Object.hasOwn(descriptors, key)) && Reflect.ownKeys(descriptors).every(key => typeof key === "string" &&
    allowed.has(key) && descriptors[key].enumerable && Object.hasOwn(descriptors[key], "value"));
}
function dense(value: unknown, max: number): value is unknown[] {
  if (!value || typeof value !== "object" || isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const d: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value), length = d.length.value;
  return observationTime(length) && length <= max && Reflect.ownKeys(d).length === length + 1 &&
    Array.from({ length }, (_, i) => d[String(i)]).every(v => v?.enumerable && Object.hasOwn(v, "value"));
}
export function validObservationRequest(value: unknown): value is OriginalReceiptObservationRequest {
  if (!observationRecord(value, ["scope", "receiptId", "input", "authority", "limits", "maxOriginalBytes", "maxPrefixBytes"]) ||
    !observationRecord(value.scope, ["provider", "account", "roomId", "roomUuid", "copyId", "sourceId", "version", "generationRevision"], ["graphId"]) ||
    value.scope.provider !== "zep" || ![value.scope.account, value.scope.roomId, value.scope.roomUuid, value.scope.copyId, value.scope.sourceId,
      value.scope.generationRevision].every(word) || !fingerprint(value.scope.version) || Object.hasOwn(value.scope, "graphId") && !word(value.scope.graphId) ||
    typeof value.receiptId !== "string" || !uuid.test(value.receiptId) || !observationRecord(value.input, ["representation", "text"]) ||
    typeof value.input.representation !== "string" || !["chat-text-v1", "memory-text-v1"].includes(value.input.representation) || typeof value.input.text !== "string" || !value.input.text ||
    !observationRecord(value.authority, ["revision", "consentRevision", "selectionRevision", "changedAt"]) ||
    ![value.authority.revision, value.authority.consentRevision, value.authority.selectionRevision].every(word) || !observationTime(value.authority.changedAt) ||
    !observationRecord(value.limits, keys) || !keys.every(k => positive((value.limits as Record<string, unknown>)[k]) && (value.limits as Record<string, number>)[k] <= ORIGINAL_OBSERVATION_CAPS[k]) ||
    !positive(value.maxOriginalBytes) || value.maxOriginalBytes > 16 * 1024 * 1024 || !positive(value.maxPrefixBytes) || value.maxPrefixBytes > 1024 * 1024 ||
    value.input.text.length > value.maxOriginalBytes) return false;
  return Buffer.from(value.input.text).toString() === value.input.text && Buffer.byteLength(value.input.text) <= value.maxOriginalBytes;
}
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object"
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);
export const observationHash = (v: unknown): string => `sha256:${createHash("sha256").update(typeof v === "string" ? v : stable(v)).digest("hex")}`;
export const receiptObservationScope = (s: OriginalReceiptObservationSnapshot): SourceBodyScope => ({ provider: "zep", account: s.request.scope.account,
  roomUuid: s.request.scope.roomUuid, graphId: s.receipt.physicalGraphId, sourceId: s.request.scope.sourceId, version: s.request.scope.version });
const accountingKeys = ["pages", "episodes", "candidates", "gets", "responseBytes"] as const;
const accountingCaps = { pages: "maxPages", episodes: "maxEpisodes", candidates: "maxCandidates", gets: "maxGets", responseBytes: "maxResponseBytes" } as const;
function accounting(value: unknown, limits: SourceBodyLimits): value is SourceBodyAccounting {
  return observationRecord(value, accountingKeys) && accountingKeys.every(k => observationTime(value[k]) && value[k] <= limits[accountingCaps[k]]) &&
    positive(value.pages) && positive(value.responseBytes);
}
function episode(value: unknown, snapshot: OriginalReceiptObservationSnapshot): value is SourceBodyEpisode {
  if (!observationRecord(value, ["id", "processed", "sourceId", "version", "part", "kind", "opId", "copyId", "carryHash", "schema", "authorId", "sourceAt",
    "content", "metadata", "createdAt"], ["source", "sourceDescription"]) || !observationRecord(value.metadata,
    ["schema", "room_id", "source_id", "version", "part", "op_id", "copy_id", "source_at", "carry_hash"], ["origin", "source_kind", "author_id"]) ||
    typeof value.schema !== "number" || ![3, 4].includes(value.schema) || value.metadata.schema !== value.schema ||
    (value.schema === 4 ? !observationRecord(value.metadata, ["schema", "room_id", "source_id", "version", "part", "op_id", "copy_id", "source_at", "carry_hash", "origin"]) ||
      !dense(value.metadata.origin, 2) || value.metadata.origin.length !== 2 || !value.metadata.origin.every(word)
      : !observationRecord(value.metadata, ["schema", "room_id", "source_id", "version", "part", "op_id", "copy_id", "source_at", "carry_hash", "source_kind", "author_id"])) ||
    !validOriginalClassificationMetadata(value.metadata) || typeof value.id !== "string" || !uuid.test(value.id) ||
    typeof value.processed !== "boolean" || value.sourceId !== snapshot.request.scope.sourceId || !fingerprint(value.version) || !word(value.part) ||
    !/^([1-9]\d*)\/([1-9]\d*)$/.test(value.part) || Number(value.part.split("/")[0]) > Number(value.part.split("/")[1]) || Number(value.part.split("/")[1]) > 64 ||
    value.kind !== "message" || !word(value.opId) || !word(value.copyId) || !fingerprint(value.carryHash) ||
    !word(value.authorId) || !validSourceBodyCreatedAt(value.sourceAt) || !validSourceBodyCreatedAt(value.createdAt) ||
    typeof value.content !== "string" || value.content.length > snapshot.request.limits.maxResponseBytes || Buffer.from(value.content).toString() !== value.content ||
    Object.hasOwn(value, "source") && value.source !== "message" || Object.hasOwn(value, "sourceDescription") && (typeof value.sourceDescription !== "string" ||
      /[\r\n]/.test(value.sourceDescription) || !/^viberoom room "[^\r\n]*"(?:, message [1-9]\d*|, explicit note)$/.test(value.sourceDescription))) return false;
  const m = readZepMetadata(value.metadata)!;
  return m.room_id === snapshot.request.scope.roomUuid && m.source_id === value.sourceId && m.version === value.version && m.part === value.part &&
    m.source_kind === value.kind && m.op_id === value.opId && m.copy_id === value.copyId && m.author_id === value.authorId &&
    m.source_at === value.sourceAt && m.carry_hash === value.carryHash && m.schema === value.schema;
}
function inventory(value: unknown, snapshot: OriginalReceiptObservationSnapshot): value is readonly SourceBodyEpisode[] {
  return dense(value, snapshot.request.limits.maxCandidates) && value.every(v => episode(v, snapshot)) && new Set(value.map(e => (e as SourceBodyEpisode).id)).size === value.length;
}
function scope(value: unknown, expected: SourceBodyScope): boolean {
  return observationRecord(value, ["provider", "account", "roomUuid", "graphId", "sourceId", "version"]) && isDeepStrictEqual(value, expected);
}
export function snapshotReceiptClassification(raw: unknown, s: OriginalReceiptObservationSnapshot): OriginalSourceClassification | null {
  if (!observationRecord(raw, ["state", "scope", "accounting", "bySource", "startedAt", "finishedAt"]) || raw.state !== "complete" ||
    !scope(raw.scope, receiptObservationScope(s)) || !accounting(raw.accounting, s.request.limits) || !observationTime(raw.startedAt) || !observationTime(raw.finishedAt) ||
    !raw.bySource || typeof raw.bySource !== "object" || isProxy(raw.bySource) || Object.getPrototypeOf(raw.bySource) !== Map.prototype || Reflect.ownKeys(raw.bySource).length) return null;
  const entries = [...Map.prototype.entries.call(raw.bySource) as MapIterator<[unknown, unknown]>];
  if (entries.length !== 1 || entries[0][0] !== s.request.scope.sourceId || !inventory(entries[0][1], s) ||
    raw.accounting.candidates !== entries[0][1].length || raw.accounting.gets !== entries[0][1].length || raw.accounting.episodes < entries[0][1].length) return null;
  return structuredClone(raw) as unknown as OriginalSourceClassification;
}
export function snapshotReceiptBody(raw: unknown, s: OriginalReceiptObservationSnapshot): SourceBodyProof | null {
  if (!observationRecord(raw, ["state", "scope", "episodes", "scan", "accounting"]) || raw.state !== "complete" || !scope(raw.scope, receiptObservationScope(s)) ||
    !accounting(raw.accounting, s.request.limits) || !observationRecord(raw.scan, ["startedAt", "finishedAt"]) || !observationTime(raw.scan.startedAt) ||
    !observationTime(raw.scan.finishedAt) || !inventory(raw.episodes, s) || raw.accounting.candidates !== raw.episodes.length ||
    raw.accounting.gets !== raw.episodes.length || raw.accounting.episodes < raw.episodes.length) return null;
  return structuredClone(raw) as unknown as SourceBodyProof;
}
function matches(s: OriginalReceiptObservationSnapshot, episodes: readonly SourceBodyEpisode[]): boolean {
  if (episodes.length !== s.receipt.members.length) return false;
  return episodes.every(e => {
    const m = s.receipt.members.find(m => m.id === e.id);
    return m && e.version === s.request.scope.version && e.copyId === m.copyId && e.opId === m.opId && e.part === m.part && e.schema === m.schema &&
      e.processed === m.processed && e.sourceAt === m.sourceAt && e.createdAt === m.createdAt && e.carryHash === s.receipt.carryHash &&
      observationHash(e.content) === m.nativeHash && Buffer.byteLength(e.content) === m.nativeBytes && observationHash(e.metadata) === m.metadataFingerprint &&
      observationHash({ source: e.source, sourceDescription: e.sourceDescription }) === m.provenanceFingerprint;
  });
}
export function evaluateReceiptObservations(s: OriginalReceiptObservationSnapshot, raw: OriginalReceiptObservations | null, now: number): OriginalReceiptObservationOutcome {
  if (!observationRecord(raw, ["classification"], ["body"])) return "unknown";
  const listing = snapshotReceiptClassification(raw.classification, s), body = snapshotReceiptBody(raw.body, s);
  const listingJudgedAt = body && body.state === "complete" ? body.scan.startedAt : now;
  if (!listing || listing.state !== "complete" || !freshCompleteReadTimes({ startedAt: listing.startedAt, finishedAt: listing.finishedAt }, listingJudgedAt, [s.minimumAt, s.capturedAt])) return "unknown";
  const first = listing.bySource.get(s.request.scope.sourceId)! as readonly SourceBodyEpisode[];
  if (first.some(e => !e.processed)) return "unknown";
  if (!matches(s, first)) return "changed";
  if (!body || body.state !== "complete" || body.scan.startedAt < listing.finishedAt || !freshCompleteReadTimes(body.scan, now, [s.minimumAt, s.capturedAt]) ||
    accountingKeys.some(k => body.accounting[k] + listing.accounting[k] > s.request.limits[accountingCaps[k]])) return "unknown";
  if (body.episodes.some(e => !e.processed)) return "unknown";
  if (!matches(s, body.episodes) || first.length !== body.episodes.length || first.some(e => !body.episodes.some(v => isDeepStrictEqual(e, v)))) return "changed";
  return "unchanged";
}

function matchingFreshClassification(s: OriginalReceiptObservationSnapshot, listing: Extract<OriginalSourceClassification, { state: "complete" }>, now: number): boolean {
  const episodes = listing.bySource.get(s.request.scope.sourceId)! as readonly SourceBodyEpisode[];
  return freshCompleteReadTimes({ startedAt: listing.startedAt, finishedAt: listing.finishedAt }, now, [s.minimumAt, s.capturedAt]) &&
    episodes.every(e => e.processed) && matches(s, episodes);
}

export async function observeWholeOriginalReceipt(outbox: MemoryOutbox, reads: WriteTransport, rawRequest: OriginalReceiptObservationRequest,
  current: OriginalReceiptObservationCurrent, now: () => number, signal: AbortSignal): Promise<OriginalReceiptObservationResult> {
  const held = (reason: string): OriginalReceiptObservationResult => ({ kind: "held", reason });
  if (!validObservationRequest(rawRequest) || typeof current !== "function" || isProxy(current) || isAsyncFunction(current)) return held("observation_request_invalid");
  if (reads.provider !== rawRequest.scope.provider || !reads.originalSourceClassification || !reads.originalSourceBodyProof) return held("observation_read_port_unavailable");
  if (signal.aborted) return held("observation_interrupted");
  const captured = outbox.originals.captureObservation(rawRequest, current, now());
  if (captured.kind !== "captured") return captured;
  const s = captured.snapshot, controller = new AbortController(), cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true }); if (signal.aborted) cancel();
  const remaining = () => Math.floor(s.request.limits.timeoutMs - (outbox.clock.now() - s.monotonicAt));
  const timer = outbox.clock.setTimeout(cancel, Math.max(1, remaining()));
  const live = () => !controller.signal.aborted && remaining() > 0 && outbox.originals.observationCurrent(s, current, now());
  const guarded = async <T, R>(work: () => Promise<T>, snapshot: (raw: T) => R): Promise<R> => {
    if (!live()) throw new Error("interrupted");
    let reject!: () => void;
    const aborted = new Promise<never>((_resolve, r) => { reject = () => r(new Error("interrupted")); });
    controller.signal.addEventListener("abort", reject, { once: true });
    try { const value = snapshot(await Promise.race([work(), aborted])); if (!live()) throw new Error("interrupted"); return value; }
    finally { controller.signal.removeEventListener("abort", reject); }
  };
  let observations: OriginalReceiptObservations | null = null;
  try {
    const classification = await guarded(() => reads.originalSourceClassification!({ scope: receiptObservationScope(s), limits: { ...s.request.limits, timeoutMs: remaining() } }, controller.signal, live), raw => snapshotReceiptClassification(raw, s));
    if (classification?.state === "complete") {
      observations = { classification };
      if (matchingFreshClassification(s, classification, now())) {
        const limits = { ...s.request.limits, timeoutMs: remaining() };
        for (const k of accountingKeys) limits[accountingCaps[k]] -= classification.accounting[k];
        if (keys.every(k => positive(limits[k]))) {
          const body = await guarded(() => reads.originalSourceBodyProof!({ scope: receiptObservationScope(s), limits }, controller.signal, live), raw => snapshotReceiptBody(raw, s));
          if (body) observations.body = body;
        }
      }
    }
  } catch { observations = null; }
  finally { outbox.clock.clearTimeout(timer); signal.removeEventListener("abort", cancel); }
  const cancelledBeforeFinish = controller.signal.aborted || signal.aborted;
  if (cancelledBeforeFinish) observations = null;
  const finalCurrent: OriginalReceiptObservationCurrent = snapshot => current(snapshot) === true &&
    (cancelledBeforeFinish || !controller.signal.aborted && !signal.aborted);
  return outbox.originals.finishObservation(s, observations, finalCurrent, now());
}
