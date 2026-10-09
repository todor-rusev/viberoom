// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { isDeepStrictEqual } from "node:util";
import type { Delivery, PreparedDelivery, WriteIdentity, WritePayload } from "./delivery.js";
import { planOriginalMessage, type OriginalInputPart, type OriginalInputPlan } from "./original-input.js";

export interface PartGroupScope {
  provider: string;
  roomId: string;
  roomUuid: string;
  copyId: string;
  sourceId: string;
  version: string;
  kind: "episode";
  graphId?: string;
  account: string | null;
}
export type PartGroupIdentity = Omit<WriteIdentity, "part" | "generation" | "maintenanceId">;
export interface PartGroupDescriptor {
  preparation: OriginalInputPlan["preparation"];
  representation: OriginalInputPlan["representation"];
  representationFingerprint: string;
  planFingerprint: string;
  policy: OriginalInputPlan["policy"];
  overlapCodePoints: 0;
  codePoints: number;
  utf8Bytes: number;
  estimatedCredits: number;
  parts: Array<{ part: string; start: number; end: number; codePoints: number; utf8Bytes: number;
    estimatedCredits: number; fingerprint: string; opId: string; payloadHash: string }>;
}
export interface PartGroup {
  groupId: string;
  identity: PartGroupIdentity;
  account: string | null;
  descriptor: PartGroupDescriptor;
  members: Delivery[];
  handedOffAt: number | null;
  retired: boolean;
  accepted: boolean;
  processed: boolean;
}
export type SourceDelivery = { kind: "legacy-single"; delivery: Delivery } | { kind: "part-group"; group: PartGroup };
export interface PartGroupPreparation {
  build(identity: WriteIdentity, opId: string, part: Readonly<OriginalInputPart>): WritePayload;
  validate(row: PreparedDelivery, part: Readonly<OriginalInputPart>): void;
  current(): boolean;
}

const hash = /^sha256:[a-f0-9]{64}$/;
export function partGroupIdentity(scope: PartGroupScope): PartGroupIdentity {
  const keys = ["provider", "roomId", "roomUuid", "copyId", "sourceId", "version", "kind", "graphId", "account"];
  if (!scope || typeof scope !== "object" || Object.keys(scope).some(key => !keys.includes(key)) || scope.kind !== "episode" ||
      !Object.hasOwn(scope, "account") || scope.account !== null && (typeof scope.account !== "string" || !scope.account) ||
      [scope.provider, scope.roomId, scope.roomUuid, scope.copyId, scope.sourceId, scope.version].some(value => typeof value !== "string" || !value) ||
      scope.graphId !== undefined && (typeof scope.graphId !== "string" || !scope.graphId || scope.graphId.length > 512))
    throw new Error("Invalid part group scope");
  return { provider: scope.provider, roomId: scope.roomId, roomUuid: scope.roomUuid, copyId: scope.copyId,
    sourceId: scope.sourceId, version: scope.version, kind: "episode", ...(scope.graphId === undefined ? {} : { graphId: scope.graphId }) };
}

export function snapshotPartGroupPlan(scope: PartGroupScope, plan: OriginalInputPlan): OriginalInputPlan {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.parts) || plan.parts.length < 1 || plan.parts.length > 64 ||
      !plan.source || plan.source.roomUuid !== scope.roomUuid || plan.source.sourceId !== scope.sourceId || plan.source.version !== scope.version)
    throw new Error("Part group original scope mismatch");
  let bytes = 0;
  const bodies: string[] = [];
  for (const part of plan.parts) {
    if (!part || typeof part.text !== "string") throw new Error("Invalid original part manifest");
    bytes += Buffer.byteLength(part.text, "utf8");
    if (bytes > 16 * 1024 * 1024) throw new Error("Part group original exceeds 16 MiB");
    bodies.push(part.text);
  }
  const snapshot = planOriginalMessage(plan.source, { representation: plan.representation, text: bodies.join("") }, plan.policy);
  if (!isDeepStrictEqual(snapshot, plan)) throw new Error("Original part group manifest integrity check failed");
  return snapshot;
}

export function partGroupDescriptor(plan: OriginalInputPlan, deliveries: Array<{ opId: string; payloadHash: string }>): PartGroupDescriptor {
  return { preparation: plan.preparation, representation: plan.representation, representationFingerprint: plan.representationFingerprint,
    planFingerprint: plan.fingerprint, policy: { ...plan.policy }, overlapCodePoints: 0, codePoints: plan.codePoints, utf8Bytes: plan.utf8Bytes,
    estimatedCredits: plan.estimatedCredits, parts: plan.parts.map((part, index) => ({ part: part.part, start: part.start, end: part.end,
      codePoints: part.codePoints, utf8Bytes: part.utf8Bytes, estimatedCredits: part.estimatedCredits, fingerprint: part.fingerprint,
      opId: deliveries[index].opId, payloadHash: deliveries[index].payloadHash })) };
}

export function validPartGroupDescriptor(value: unknown): value is PartGroupDescriptor {
  if (!value || typeof value !== "object") return false;
  const d = value as PartGroupDescriptor;
  if (d.preparation !== "viberoom-original-input-v1" || !["chat-text-v1", "memory-text-v1"].includes(d.representation) ||
      !hash.test(d.representationFingerprint) || !hash.test(d.planFingerprint) || d.overlapCodePoints !== 0 ||
      !d.policy || ![d.policy.maxBodyCodePoints, d.policy.maxDataUtf8Bytes, d.policy.bytesPerCredit, d.policy.maxParts]
        .every(n => Number.isSafeInteger(n) && n > 0) || d.policy.maxParts > 64 ||
      !Array.isArray(d.parts) || d.parts.length < 1 || d.parts.length > d.policy.maxParts ||
      ![d.codePoints, d.utf8Bytes, d.estimatedCredits].every(n => Number.isSafeInteger(n) && n >= 0) || d.utf8Bytes > 16 * 1024 * 1024)
    return false;
  let end = 0, points = 0, credits = 0;
  const ids = new Set<string>();
  for (const [index, part] of d.parts.entries()) {
    if (!part || part.part !== `${index + 1}/${d.parts.length}` || !Number.isSafeInteger(part.start) || !Number.isSafeInteger(part.end) ||
        part.start !== end || part.end < part.start || !Number.isSafeInteger(part.codePoints) || part.codePoints < 0 ||
        part.codePoints > d.policy.maxBodyCodePoints || !Number.isSafeInteger(part.utf8Bytes) || part.utf8Bytes < 0 ||
        part.utf8Bytes > d.policy.maxDataUtf8Bytes || !Number.isSafeInteger(part.estimatedCredits) ||
        part.estimatedCredits !== Math.max(1, Math.ceil(part.utf8Bytes / d.policy.bytesPerCredit)) ||
        !hash.test(part.fingerprint) || typeof part.opId !== "string" || !part.opId || ids.has(part.opId) ||
        !/^[a-f0-9]{64}$/.test(part.payloadHash)) return false;
    end = part.end; points += part.codePoints; credits += part.estimatedCredits; ids.add(part.opId);
  }
  return points === d.codePoints && credits === d.estimatedCredits;
}
