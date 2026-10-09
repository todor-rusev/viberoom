// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { isDeepStrictEqual } from "node:util";
import { isAsyncFunction } from "node:util/types";
import { carryHash } from "../carry-history.js";
import type { StoredMessage } from "../history-store.js";
import { visibleToAgents } from "../quotes.js";
import type { MemoryDeliveryStore, PreparedDelivery, WriteIdentity, WritePayload } from "./delivery.js";
import { planOriginalMessage, type OriginalInputPart, type OriginalInputPolicy, type OriginalMessageSource, type OriginalMessageText } from "./original-input.js";
import type { PartGroup, PartGroupScope, SourceDelivery } from "./part-group.js";
import type { MemoryRoom, MemoryWriteAdapter } from "./provider.js";
import { messageSource, sourceVersion } from "./provenance.js";

export interface OriginalMessagePolicyProfile {
  policyId: string;
  representation: OriginalMessageText["representation"];
  input: Readonly<OriginalInputPolicy>;
}
export interface OriginalNativePartExpectation {
  identity: Readonly<WriteIdentity>;
  room: Readonly<MemoryRoom>;
  source: Readonly<OriginalMessageSource>;
  carryHash: string;
  binding: NonNullable<WritePayload["binding"]>;
  part: Readonly<OriginalInputPart>;
  profile: Readonly<OriginalMessagePolicyProfile>;
}
export interface OriginalMessageWritePort {
  readonly bytesPerCredit: number;
  validatePolicy(profile: Readonly<OriginalMessagePolicyProfile>): void;
  buildPart(identity: WriteIdentity, opId: string, expected: Readonly<OriginalNativePartExpectation>): WritePayload;
  validatePart(row: PreparedDelivery, expected: Readonly<OriginalNativePartExpectation>): void;
}
export interface LocalOriginalMessagePreparationCapability {
  readonly id: string;
  readonly writes: Readonly<{ originalMessage?: OriginalMessageWritePort }>;
}
export interface OriginalMessagePreparationRequest {
  scope: PartGroupScope;
  room: MemoryRoom;
  source: StoredMessage;
  input: OriginalMessageText;
  profile: OriginalMessagePolicyProfile;
}
export interface OriginalMessagePreparationSnapshot {
  scope: Readonly<PartGroupScope>;
  room: Readonly<MemoryRoom>;
  source: Readonly<StoredMessage>;
}
export type OriginalMessagePreparationResult =
  | { kind: "saved"; source: SourceDelivery }
  | { kind: "prepared"; group: PartGroup }
  | { kind: "hold"; reason: string; source?: SourceDelivery };

function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
function sync(fn: unknown): boolean {
  return typeof fn === "function" && !isAsyncFunction(fn);
}
function returnedSync(value: unknown): void {
  if (value && typeof (value as PromiseLike<unknown>).then === "function") throw new Error("Original preparation callback is asynchronous");
}
export function validateOriginalMessageProfile(profile: OriginalMessagePolicyProfile, bytesPerCredit: number): void {
  const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
  if (!profile || typeof profile !== "object" || Object.keys(profile).some(k => !["policyId", "representation", "input"].includes(k)) ||
      typeof profile.policyId !== "string" || !profile.policyId.trim() || [...profile.policyId].length > 128 ||
      /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(profile.policyId) ||
      !["chat-text-v1", "memory-text-v1"].includes(profile.representation) ||
      !profile.input || Object.keys(profile.input).some(k => !["maxBodyCodePoints", "maxDataUtf8Bytes", "bytesPerCredit", "maxParts"].includes(k)) ||
      ![profile.input.maxBodyCodePoints, profile.input.maxDataUtf8Bytes, profile.input.bytesPerCredit, profile.input.maxParts].every(positive) ||
      profile.input.maxParts > 64 || !positive(bytesPerCredit) || profile.input.bytesPerCredit !== bytesPerCredit)
    throw new Error("Invalid explicit original message profile");
}

export function prepareOriginalMessageGroup(store: MemoryDeliveryStore, adapter: MemoryWriteAdapter | undefined,
  request: OriginalMessagePreparationRequest,
  current: (snapshot: Readonly<OriginalMessagePreparationSnapshot>) => boolean,
  now: number): OriginalMessagePreparationResult {
  return prepareOriginalMessageGroupCore(store, () => adapter?.originalMessage,
    () => adapter!.transport.provider, request, current, now);
}

export function prepareLocalOriginalMessageGroup(store: MemoryDeliveryStore,
  capability: LocalOriginalMessagePreparationCapability | undefined,
  request: OriginalMessagePreparationRequest,
  current: (snapshot: Readonly<OriginalMessagePreparationSnapshot>) => boolean,
  now: number): OriginalMessagePreparationResult {
  return prepareOriginalMessageGroupCore(store, () => capability?.writes.originalMessage,
    () => capability!.id, request, current, now);
}

function prepareOriginalMessageGroupCore(store: MemoryDeliveryStore,
  portOf: () => OriginalMessageWritePort | undefined, providerOf: () => string,
  request: OriginalMessagePreparationRequest,
  current: (snapshot: Readonly<OriginalMessagePreparationSnapshot>) => boolean,
  now: number): OriginalMessagePreparationResult {
  const hold = (reason: string): OriginalMessagePreparationResult => ({ kind: "hold", reason });
  let snapshot: OriginalMessagePreparationSnapshot;
  try {
    snapshot = frozen(structuredClone({ scope: request.scope, room: request.room, source: request.source }));
    const { scope, room, source } = snapshot;
    if (!scope || !room || !source || scope.kind !== "episode" || room.uuid !== scope.roomUuid || room.graphId !== scope.graphId ||
        source.id !== scope.sourceId || sourceVersion(source) !== scope.version) return hold("original_source_scope_mismatch");
    const saved = store.lookupSourceDelivery(scope);
    if (store.originalSourceOccupied(scope)) return hold("original_source_receipt_requires_reconciliation");
    if (saved) {
      const retired = saved.kind === "legacy-single" ? saved.delivery.retiredAt !== null : saved.group.retired;
      return retired ? { kind: "hold", reason: "saved_original_source_retired", source: frozen(structuredClone(saved)) }
        : { kind: "saved", source: frozen(structuredClone(saved)) };
    }
  } catch { return hold("original_source_lookup_unavailable"); }
  const port = portOf();
  if (!port || !sync(port.validatePolicy) || !sync(port.buildPart) || !sync(port.validatePart) || !sync(current))
    return hold("original_preparation_unsupported");
  const validatePolicy = port.validatePolicy.bind(port), buildPart = port.buildPart.bind(port), validatePart = port.validatePart.bind(port);
  const bytesPerCredit = port.bytesPerCredit;
  try {
    const { scope, room, source } = snapshot;
    if (providerOf() !== scope.provider || source.kind !== "chat" || source.streaming || !visibleToAgents(source) ||
        !Number.isSafeInteger(now) || now < 0) return hold("original_source_not_preparable");
    const input = frozen(structuredClone(request.input)), profile = frozen(structuredClone(request.profile));
    validateOriginalMessageProfile(profile, bytesPerCredit);
    if (!input || input.representation !== profile.representation ||
        input.representation === "chat-text-v1" && input.text !== source.text) return hold("original_representation_mismatch");
    returnedSync(validatePolicy(profile));
    const fence = () => {
      const accepted = current(snapshot);
      returnedSync(accepted);
      if (accepted !== true || !store.currentCopy(scope) || store.copyAccount(scope) !== scope.account ||
          store.unprovenSource(scope, scope.account ?? undefined)) throw new Error("Original preparation authority changed");
    };
    fence();
    const original: OriginalMessageSource = { roomUuid: scope.roomUuid, sourceId: source.id, version: scope.version,
      authorId: source.from, authorName: source.fromName, ts: source.ts, seq: source.seq,
      ...(source.origin ? { originCopy: source.origin } : {}) };
    const plan = planOriginalMessage(original, input, profile.input);
    const binding = frozen({ source: { ...messageSource(source), ...(scope.graphId === undefined ? {} : { graphId: scope.graphId }) }, seq: source.seq });
    const carried = `sha256:${carryHash(source)}`;
    const expected = (part: Readonly<OriginalInputPart>) => frozen({ identity: { provider: scope.provider, roomId: scope.roomId,
      roomUuid: scope.roomUuid, copyId: scope.copyId, sourceId: scope.sourceId, version: scope.version, kind: "episode" as const,
      ...(scope.graphId === undefined ? {} : { graphId: scope.graphId }), part: part.part },
      room, source: plan.source, carryHash: carried, binding, part, profile });
    const saved = store.preparePartGroup(scope, plan, {
      build(identity, opId, part) {
        const payload = buildPart(identity, opId, expected(part));
        returnedSync(payload);
        if (!payload || !isDeepStrictEqual(payload.binding, binding)) throw new Error("Original native source binding mismatch");
        return payload;
      },
      validate(row, part) { returnedSync(validatePart(row, expected(part))); },
      current: () => { fence(); return true; },
    }, now);
    return saved.kind === "part-group" ? { kind: "prepared", group: frozen(structuredClone(saved.group)) }
      : { kind: "saved", source: frozen(structuredClone(saved)) };
  } catch { return hold("original_preparation_refused"); }
}
