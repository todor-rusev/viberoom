// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { recoveryFingerprint } from "./recovery-sources.js";
import { isProxy } from "node:util/types";
import { hasExactFields as fields, hasDenseDataItems } from "./exact-fields.js";
import { freezeSelective, validateSelectivePlan, type SelectiveRepairPlan, type SelectiveRepairScope } from "./selective-repair-intent.js";

export type SelectiveJSON = null | boolean | number | string | SelectiveJSON[] | { [key: string]: SelectiveJSON };
export interface SelectiveArtifactObservation { kind: "edge" | "node"; id: string; value: SelectiveJSON }
export interface SelectiveRepairDraft {
  schema: "selective-repair-draft-v1";
  scope: SelectiveRepairScope; repairRevision: number;
  sources: Array<{ id: string; original: SelectiveJSON }>;
  changes: Array<{ before: SelectiveArtifactObservation; patch: { [field: string]: SelectiveJSON }; sourceIds: string[] }>;
  controls: SelectiveArtifactObservation[];
  context: SelectiveJSON;
}
const identifier = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(v);
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !isProxy(v) && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
}
export function validateSelectiveJSON(value: unknown): void {
  let bytes = 0, values = 0;
  const add = (n: number) => { bytes += n; if (bytes > 16 * 1024 * 1024) throw new Error("Selective draft byte limit"); };
  const visit = (v: unknown, depth: number) => {
    if (depth > 64 || ++values > 100000) throw new Error("Selective draft structure limit");
    if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v)) {
      add(Buffer.byteLength(JSON.stringify(v), "utf8")); return;
    }
    if (!v || typeof v !== "object" || !Array.isArray(v) && !record(v)) throw new Error("Selective draft requires JSON values");
    const array = Array.isArray(v);
    if (array && !hasDenseDataItems(v, 100000)) throw new Error("Selective draft requires dense JSON arrays");
    const keys = Reflect.ownKeys(v);
    if (keys.some(k => typeof k !== "string")) throw new Error("Selective draft requires JSON fields");
    if (array && (keys.length !== v.length + 1 || v.length > 100000)) throw new Error("Selective draft requires dense JSON arrays");
    const entries = array ? Array.from({ length: v.length }, (_, i) => String(i)) : keys as string[];
    add(2 + Math.max(entries.length - 1, 0));
    for (const key of entries) {
      const descriptor = Object.getOwnPropertyDescriptor(v, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("Selective draft requires JSON data fields");
      if (!array) add(Buffer.byteLength(JSON.stringify(key), "utf8") + 1);
      visit(descriptor.value, depth + 1);
    }
  };
  visit(value, 0);
}
function artifact(value: SelectiveArtifactObservation): string {
  if (!record(value) || !fields(value, ["kind", "id", "value"]) || !["edge", "node"].includes(value.kind) || !identifier(value.id))
    throw new Error("Invalid selective draft artifact");
  return `${value.kind}:${value.id}`;
}
export function projectSelectiveDraft(draft: SelectiveRepairDraft): { draft: SelectiveRepairDraft; plan: SelectiveRepairPlan } {
  validateSelectiveJSON(draft);
  const snapshot = structuredClone(draft);
  if (!record(snapshot) || !fields(snapshot, ["schema", "scope", "repairRevision", "sources", "changes", "controls", "context"]) ||
      snapshot.schema !== "selective-repair-draft-v1" || !Array.isArray(snapshot.sources) || !snapshot.sources.length || snapshot.sources.length > 10000 ||
      !Array.isArray(snapshot.changes) || !snapshot.changes.length || snapshot.changes.length > 10000 || !Array.isArray(snapshot.controls) || snapshot.controls.length > 10000)
    throw new Error("Invalid selective repair draft");
  const sources = new Set<string>();
  for (const source of snapshot.sources) {
    if (!record(source) || !fields(source, ["id", "original"]) || !identifier(source.id) || sources.has(source.id))
      throw new Error("Invalid selective draft original");
    sources.add(source.id);
  }
  const targets = new Set<string>();
  const operations = snapshot.changes.map(change => {
    if (!record(change) || !fields(change, ["before", "patch", "sourceIds"]) || !record(change.patch) || !Object.keys(change.patch).length ||
        !Array.isArray(change.sourceIds) || change.sourceIds.some(id => !sources.has(id))) throw new Error("Invalid selective draft change");
    const key = artifact(change.before);
    if (targets.has(key)) throw new Error("Duplicate selective draft target");
    targets.add(key);
    return { kind: change.before.kind, id: change.before.id, preimageFingerprint: recoveryFingerprint(change.before),
      patchFingerprint: recoveryFingerprint(change.patch), sourceIds: [...change.sourceIds] };
  });
  const controls = new Set<string>();
  for (const control of snapshot.controls) {
    const key = artifact(control);
    if (targets.has(key) || controls.has(key)) throw new Error("Conflicting selective draft control");
    controls.add(key);
  }
  const plan: SelectiveRepairPlan = { schema: "selective-repair-plan-v1", scope: snapshot.scope, repairRevision: snapshot.repairRevision,
    draftFingerprint: recoveryFingerprint(snapshot), sourceFingerprint: recoveryFingerprint(snapshot.sources), operations };
  validateSelectivePlan(plan);
  return freezeSelective({ draft: snapshot, plan });
}
