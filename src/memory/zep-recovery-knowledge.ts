// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { ZepClient, ZepError, type Zep } from "@getzep/zep-cloud";
import type { RecoveryKnowledge } from "./recovery-knowledge.js";
import { recoveryFingerprint } from "./recovery-sources.js";
import { zepRecoveryInventory } from "./zep-recovery-sources.js";
import { readRecoveryPages, recoveryReadSession, RECOVERY_INVENTORY_LIMITS, type RecoveryReadLimits } from "./zep-recovery-read.js";
import { zepPhysicalGraphId } from "./zep-payload.js";

const order = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const text = (v: unknown): string => { if (typeof v !== "string") throw new Error("knowledge_shape_invalid"); return v; };
const optional = (v: unknown): string | null => v === undefined || v === null ? null : text(v);
function record(v: unknown): Record<string, unknown> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new Error("knowledge_shape_invalid");
  return v as Record<string, unknown>;
}
const strings = (v: unknown): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some(i => typeof i !== "string" || !i)) throw new Error("knowledge_shape_invalid");
  return [...v].sort();
};
export async function readZepRecoveryKnowledge(client: ZepClient, uuid: string, candidateGraphId: string,
  signal: AbortSignal, now: () => number, limits: RecoveryReadLimits = RECOVERY_INVENTORY_LIMITS): Promise<RecoveryKnowledge> {
  const graphId = zepPhysicalGraphId({ uuid, graphId: candidateGraphId }), startedAt = now(), session = recoveryReadSession(signal, limits);
  try {
    const rawEpisodes = await readRecoveryPages(client, graphId, "episode", limits, session) as Zep.Episode[];
    const rawEdges = await readRecoveryPages(client, graphId, "edge", limits, session) as Zep.EntityEdge[];
    const rawNodes = await readRecoveryPages(client, graphId, "node", limits, session) as Zep.EntityNode[];
    const episodes = rawEpisodes.map(e => ({ id: e.uuid, content: text(e.content), createdAt: text(e.createdAt),
      ...(e.source === undefined ? {} : { source: text(e.source) }), ...(e.sourceDescription === undefined ? {} : { sourceDescription: text(e.sourceDescription) }),
      metadata: e.metadata == null ? null : record(e.metadata), processed: e.processed === true })).sort(order);
    const edges = rawEdges.map(e => ({ id: e.uuid, fact: text(e.fact), name: text(e.name), createdAt: text(e.createdAt),
      sourceNodeId: text(e.sourceNodeUuid), targetNodeId: text(e.targetNodeUuid), episodeIds: strings(e.episodes),
      validAt: optional(e.validAt), invalidAt: optional(e.invalidAt), expiredAt: optional(e.expiredAt), attributes: record(e.attributes), scope: optional(e.scope) })).sort(order);
    const nodes = rawNodes.map(n => ({ id: n.uuid, name: text(n.name), summary: text(n.summary), createdAt: text(n.createdAt),
      labels: strings(n.labels), attributes: record(n.attributes) })).sort(order);
    session.abort.throwIfAborted();
    const finishedAt = now(), inventory = zepRecoveryInventory(rawEpisodes, rawEdges, { uuid, name: "", graphId }, startedAt, finishedAt);
    return { state: "complete", graphId, inventory, episodes, edges, nodes,
      fingerprint: recoveryFingerprint({ graphId, episodes, edges, nodes }), startedAt, finishedAt };
  } catch (error) {
    if (signal.aborted) throw error;
    const code = error instanceof Error && /^(?:knowledge_shape_invalid|(?:episode|edge|node)_listing_[a-z_]+)$/.test(error.message) ? error.message : "read_failed";
    return { state: "unknown", reason: session.abort.aborted ? "deadline" : error instanceof ZepError ? `read_failed_${error.statusCode ?? "network"}` : code,
      startedAt, finishedAt: now() };
  }
}
