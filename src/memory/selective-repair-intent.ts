// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { recoveryFingerprint, type RecoveryScope } from "./recovery-sources.js";
import { hasExactFields as fields, hasDenseDataItems } from "./exact-fields.js";

export type SelectiveRepairScope = RecoveryScope & { graphId: string; copyId: string };
export interface SelectiveRepairPlan {
  schema: "selective-repair-plan-v1";
  scope: SelectiveRepairScope;
  repairRevision: number;
  draftFingerprint: string;
  sourceFingerprint: string;
  operations: Array<{ kind: "edge" | "node"; id: string; preimageFingerprint: string; patchFingerprint: string; sourceIds: string[] }>;
}
export interface SelectiveRepairIntent {
  id: string; plan: SelectiveRepairPlan; planFingerprint: string;
  checkpoint: number; createdAt: number; updatedAt: number; cancelledAt: number | null;
  semantic: { state: "pending" } | { state: "accepted"; receiptFingerprint: string; at: number };
  admission: { state: "not_requested" } | { state: "held"; reason: "exact_semantic_review_missing" | "native_conditional_write_and_worker_barrier_unverified" };
  completion: { state: "not_started" };
}
export const selectiveDigest = (v: unknown): v is string => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
const identifier = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export function validateSelectiveScope(scope: SelectiveRepairScope): void {
  if (!fields(scope, ["provider", "account", "room", "uuid", "graphId", "revision", "copyId"]) ||
      Object.values(scope).some(v => !identifier(v)) || !selectiveDigest(scope.account)) throw new Error("Invalid selective repair plan");
}
export function validateSelectivePlan(plan: SelectiveRepairPlan): void {
  if (!fields(plan, ["schema", "scope", "repairRevision", "draftFingerprint", "sourceFingerprint", "operations"]) ||
      plan.schema !== "selective-repair-plan-v1" ||
      !integer(plan.repairRevision) || !selectiveDigest(plan.draftFingerprint) || !selectiveDigest(plan.sourceFingerprint) ||
      !hasDenseDataItems(plan.operations) || plan.operations.length < 1)
    throw new Error("Invalid selective repair plan");
  validateSelectiveScope(plan.scope);
  const targets = new Set<string>(); let associations = 0;
  for (const op of plan.operations) {
    if (!fields(op, ["kind", "id", "preimageFingerprint", "patchFingerprint", "sourceIds"]) ||
        !["edge", "node"].includes(op.kind) || !identifier(op.id) || !selectiveDigest(op.preimageFingerprint) ||
        !selectiveDigest(op.patchFingerprint) || !hasDenseDataItems(op.sourceIds) || op.sourceIds.length < 1 ||
        op.sourceIds.some(id => !identifier(id)) || new Set(op.sourceIds).size !== op.sourceIds.length || targets.has(`${op.kind}:${op.id}`))
      throw new Error("Invalid selective repair operation");
    associations += op.sourceIds.length;
    if (associations > 10000) throw new Error("Selective repair association limit");
    targets.add(`${op.kind}:${op.id}`);
  }
  if (Buffer.byteLength(JSON.stringify(plan), "utf8") > 1024 * 1024) throw new Error("Selective repair manifest limit");
}
export function validateSelectiveIntent(intent: SelectiveRepairIntent): void {
  if (!fields(intent, ["id", "plan", "planFingerprint", "checkpoint", "createdAt", "updatedAt", "cancelledAt", "semantic", "admission", "completion"]))
    throw new Error("Invalid selective repair intent");
  validateSelectivePlan(intent.plan);
  if (!(fields(intent.semantic, ["state"]) || fields(intent.semantic, ["state", "receiptFingerprint", "at"])) ||
      !(fields(intent.admission, ["state"]) || fields(intent.admission, ["state", "reason"])) ||
      !fields(intent.completion, ["state"])) throw new Error("Invalid selective repair state");
  if (!identifier(intent.id) || !selectiveDigest(intent.planFingerprint) || intent.planFingerprint !== recoveryFingerprint(intent.plan) ||
      !integer(intent.checkpoint) || !integer(intent.createdAt) || !integer(intent.updatedAt) || intent.updatedAt < intent.createdAt ||
      intent.cancelledAt !== null && (!integer(intent.cancelledAt) || intent.cancelledAt < intent.createdAt || intent.cancelledAt > intent.updatedAt) ||
      (intent.semantic.state === "pending" ? !fields(intent.semantic, ["state"]) : intent.semantic.state !== "accepted" ||
        !fields(intent.semantic, ["state", "receiptFingerprint", "at"]) || !selectiveDigest(intent.semantic.receiptFingerprint) ||
        !integer(intent.semantic.at) || intent.semantic.at < intent.createdAt || intent.semantic.at > intent.updatedAt) ||
      (intent.admission.state === "not_requested" ? !fields(intent.admission, ["state"]) : intent.admission.state !== "held" ||
        !fields(intent.admission, ["state", "reason"]) || !["exact_semantic_review_missing", "native_conditional_write_and_worker_barrier_unverified"].includes(intent.admission.reason)) ||
      !fields(intent.completion, ["state"]) || intent.completion.state !== "not_started")
    throw new Error("Invalid selective repair state");
  if (intent.admission.state === "held" && intent.admission.reason !== (intent.semantic.state === "accepted"
    ? "native_conditional_write_and_worker_barrier_unverified" : "exact_semantic_review_missing"))
    throw new Error("Inconsistent selective repair state");
}
export function freezeSelective<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freezeSelective); Object.freeze(value); }
  return value;
}
