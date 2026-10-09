// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { isDeepStrictEqual } from "node:util";
import { isAsyncFunction, isProxy } from "node:util/types";
import type { StoredMessage } from "../history-store.js";
import { visibleToAgents } from "../quotes.js";
import type { MemoryOutbox } from "./outbox.js";
import type { MemoryProvider } from "./provider.js";
import type { SourceDelivery } from "./part-group.js";
import type { WriteTransport } from "./delivery.js";
import { sourceVersion } from "./provenance.js";
import { zepPhysicalGraphId } from "./zep-payload.js";
import { bindWholeOriginalForeign, originalBindingRecord, validOriginalBindingCore, type OriginalBindingCore,
  type OriginalBindingResult, type WholeOriginalReceipt } from "./original-source-binding.js";
import { observeWholeOriginalReceipt, type OriginalReceiptObservationResult } from "./original-receipt-observation.js";

export interface OriginalSourceInspectionRequest extends OriginalBindingCore { acceptanceKind: "stream" | "version-check" }
export type OriginalSourceInspectionCurrent = (request: Readonly<OriginalSourceInspectionRequest>) => boolean;
export type OriginalSourceInspectionResult = OriginalBindingResult | { kind: "saved"; source: SourceDelivery }
  | { kind: "observation"; receipt: WholeOriginalReceipt; observation: OriginalReceiptObservationResult };
export interface OriginalSourceInspectionRoom {
  id: string; uuid: string; name: string; remembers: boolean; graphId?: string; generationRevision?: string; account?: string;
}
export interface OriginalSourceInspectionPorts {
  outbox: MemoryOutbox;
  room(id: string): OriginalSourceInspectionRoom | null;
  message(room: string, id: string): StoredMessage | null;
  allowed(provider: string, room: string): boolean;
  now(): number;
}
const hold = (reason: string): Extract<OriginalBindingResult, { kind: "hold" }> => ({ kind: "hold", reason });
const coreKeys = ["scope", "input", "authority", "limits", "maxOriginalBytes", "maxPrefixBytes"] as const;
export function validOriginalSourceInspectionRequest(raw: unknown): raw is OriginalSourceInspectionRequest {
  if (!originalBindingRecord(raw, [...coreKeys, "acceptanceKind"]) || !["stream", "version-check"].includes(raw.acceptanceKind as string)) return false;
  return validOriginalBindingCore(Object.fromEntries(coreKeys.map(key => [key, raw[key]])));
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const v of Object.values(value)) freeze(v); Object.freeze(value); }
  return value;
}
export async function inspectOriginalSource(ports: OriginalSourceInspectionPorts, provider: MemoryProvider,
  raw: OriginalSourceInspectionRequest, current: OriginalSourceInspectionCurrent, signal: AbortSignal): Promise<OriginalSourceInspectionResult> {
  if (!validOriginalSourceInspectionRequest(raw) || typeof current !== "function" || isProxy(current) || isAsyncFunction(current))
    return hold("original_preselection_request_invalid");
  try {
    if (signal.aborted) return hold("original_preselection_interrupted");
    const request = freeze(structuredClone(raw)), { scope } = request, outbox = ports.outbox;
    const admissionNow = ports.now();
    if (!Number.isSafeInteger(admissionNow) || admissionNow < 0 || request.authority.changedAt > admissionNow)
      return hold("original_preselection_time_unavailable");
    const writes = provider.writes, reads = writes?.transport, generations = provider.generations;
    const providerId = provider.id, account = generations?.account;
    const classification = reads?.originalSourceClassification, body = reads?.originalSourceBodyProof;
    const room = ports.room(scope.roomId), source = ports.message(scope.roomId, scope.sourceId);
    if (!room || !source || !reads || providerId !== scope.provider || reads.provider !== scope.provider || account !== scope.account)
      return hold("original_preselection_port_unavailable");
    const route = freeze(structuredClone(room)), original = freeze(structuredClone(source));
    const localFingerprint = outbox.originals.preselectionFingerprint(scope);
    if (localFingerprint === null) return hold("original_preselection_namespace_unavailable");
    const physical = zepPhysicalGraphId({ uuid: scope.roomUuid, ...(scope.graphId === undefined ? {} : { graphId: scope.graphId }) });
    const local = () => {
      const at = ports.now();
      if (!Number.isSafeInteger(at) || at < admissionNow || request.authority.changedAt > at) return false;
      const live = ports.room(scope.roomId), message = ports.message(scope.roomId, scope.sourceId);
      if (!live || !message || ports.outbox !== outbox || provider.id !== providerId || provider.writes !== writes || writes?.transport !== reads ||
        provider.generations !== generations || generations?.account !== account || reads.provider !== providerId || signal.aborted ||
        reads.originalSourceClassification !== classification || reads.originalSourceBodyProof !== body ||
        !isDeepStrictEqual(live, route) || !isDeepStrictEqual(message, original) || live.id !== scope.roomId || live.uuid !== scope.roomUuid ||
        (live.account ?? null) !== scope.account || live.generationRevision !== scope.generationRevision || !live.remembers ||
        !ports.allowed(providerId, live.id) || message.id !== scope.sourceId || message.kind !== "chat" || message.streaming ||
        !visibleToAgents(message) || sourceVersion(message) !== scope.version ||
        zepPhysicalGraphId({ uuid: live.uuid, ...(live.graphId === undefined ? {} : { graphId: live.graphId }) }) !== physical ||
        !outbox.deliveries.currentCopy(scope) || outbox.deliveries.copyAccount(scope) !== scope.account || outbox.forgetting(providerId, live.id) ||
        outbox.originals.preselectionFingerprint(scope) !== localFingerprint) return false;
      const attachment = outbox.generationAttachment(providerId, live.id), head = outbox.generations.head({ provider: providerId, account: scope.account, uuid: scope.roomUuid });
      return !!attachment && attachment.uuid === scope.roomUuid && attachment.account === scope.account && attachment.copy === scope.copyId &&
        attachment.revision === scope.generationRevision && attachment.graphId === physical && !head.reason && !head.followPending &&
        head.revision === scope.generationRevision && head.route?.graphId === physical && head.checkedAt !== null &&
        Number.isSafeInteger(head.checkedAt) && head.checkedAt >= 0 && head.checkedAt <= at;
    };
    const guarded = () => outbox.originals.preselectionCurrent(scope, localFingerprint, () => {
      if (!local()) return false;
      return current(request) === true && local();
    });
    if (!guarded()) return hold("original_preselection_authority_changed");
    const receipt = outbox.originals.lookup(scope);
    if (!guarded()) return hold("original_preselection_authority_changed");
    if (receipt.kind === "hold") return receipt;

    const graphIds = physical === zepPhysicalGraphId({ uuid: scope.roomUuid }) ? [undefined, physical] : [physical];
    const saved = graphIds.map(graphId => outbox.deliveries.lookupSourceDelivery({ provider: scope.provider, roomId: scope.roomId,
      roomUuid: scope.roomUuid, copyId: scope.copyId, sourceId: scope.sourceId, version: scope.version, kind: "episode", account: scope.account,
      ...(graphId === undefined ? {} : { graphId }) })).filter((item): item is SourceDelivery => item !== null);
    if (!guarded()) return hold("original_preselection_authority_changed");
    if (saved.length > 1 || receipt.kind === "represented" && saved.length) return hold("original_preselection_namespace_conflict");
    if (saved.length) {
      const found = saved[0];
      if (found.kind === "part-group" ? found.group.retired : found.delivery.retiredAt !== null) return hold("original_preselection_saved_retired");
      return { kind: "saved", source: freeze(structuredClone(found)) };
    }
    const refused = (): never => { throw new Error("original_preselection_read_only"); };
    const nativeReads: WriteTransport = { provider: providerId, validate: refused, send: async () => refused(), reconcile: async () => refused(),
      ...(classification ? { originalSourceClassification: (...args: Parameters<NonNullable<typeof classification>>) => classification.apply(reads, args) } : {}),
      ...(body ? { originalSourceBodyProof: (...args: Parameters<NonNullable<typeof body>>) => body.apply(reads, args) } : {}) };
    if (receipt.kind === "represented") {
      const observation = await observeWholeOriginalReceipt(outbox, nativeReads, { scope: request.scope, receiptId: receipt.receipt.receiptId,
        input: request.input, authority: request.authority, limits: request.limits,
        maxOriginalBytes: request.maxOriginalBytes, maxPrefixBytes: request.maxPrefixBytes }, guarded, () => ports.now(), signal);
      if (!guarded()) return hold("original_preselection_authority_changed");
      return { kind: "observation", receipt: receipt.receipt, observation };
    }
    const acceptance = request.acceptanceKind === "stream" ? outbox.originals.streamAcceptance(scope, scope.sourceId)
      : outbox.originals.checkAcceptance(scope, scope.sourceId);
    if (!acceptance || !guarded()) return hold("original_preselection_acceptance_unavailable");
    const controller = new AbortController(), cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true }); if (signal.aborted) cancel();
    const timer = outbox.clock.setTimeout(cancel, request.limits.timeoutMs);
    let reject!: () => void;
    const interrupted = new Promise<never>((_resolve, fail) => { reject = () => fail(new Error("original_preselection_interrupted")); });
    controller.signal.addEventListener("abort", reject, { once: true });
    try {
      if (controller.signal.aborted) return hold("original_preselection_interrupted");
      const result = await Promise.race([bindWholeOriginalForeign(outbox, nativeReads, { scope: request.scope, source: original, input: request.input,
        authority: request.authority, acceptance, limits: request.limits, maxOriginalBytes: request.maxOriginalBytes,
        maxPrefixBytes: request.maxPrefixBytes }, guarded, () => ports.now(), controller.signal), interrupted]);
      if (!guarded() || controller.signal.aborted) return hold("original_preselection_authority_changed");
      return result;
    } finally {
      outbox.clock.clearTimeout(timer); signal.removeEventListener("abort", cancel); controller.signal.removeEventListener("abort", reject);
    }
  } catch { return hold("original_preselection_unavailable"); }
}
