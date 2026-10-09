// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { ZepClient, ZepError, type Zep } from "@getzep/zep-cloud";
import type { ListedEpisode } from "./delivery.js";
import { recoveryFingerprint, type RecoveryFactInput, type RecoveryInventory } from "./recovery-sources.js";
import type { MemoryRoom } from "./provider.js";
import { zepRoomGraphId } from "./zep-payload.js";
import { readRecoveryPages, recoveryReadSession, RECOVERY_INVENTORY_LIMITS, type RecoveryReadLimits } from "./zep-recovery-read.js";
import { readZepMetadata, type ZepMetadataSchema } from "./zep-metadata.js";
export { RECOVERY_INVENTORY_LIMITS } from "./zep-recovery-read.js";

const order = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
function metadata(value: Record<string, unknown> | undefined, uuid: string) {
  value = readZepMetadata(value) ?? undefined;
  if (!value || value.room_id !== uuid ||
    ["op_id", "copy_id", "source_id", "version", "part", "author_id", "source_at"].some(key => typeof value[key] !== "string" || !value[key]) ||
    !Number.isFinite(Date.parse(String(value.source_at))) || !/^sha256:[a-f0-9]{64}$/.test(String(value.version))) return null;
  return value as Record<string, unknown> & { schema: ZepMetadataSchema; op_id: string; copy_id: string; source_id: string; version: string; part: string };
}
export async function readZepRecoveryInventory(client: ZepClient, room: MemoryRoom, signal: AbortSignal, now: () => number,
  limits: RecoveryReadLimits = RECOVERY_INVENTORY_LIMITS): Promise<RecoveryInventory> {
  const startedAt = now(), graphId = zepRoomGraphId(room), session = recoveryReadSession(signal, limits);
  try {
    const rawEpisodes = await readRecoveryPages(client, graphId, "episode", limits, session) as Zep.Episode[];
    const edges = await readRecoveryPages(client, graphId, "edge", limits, session) as Zep.EntityEdge[];
    session.abort.throwIfAborted();
    return zepRecoveryInventory(rawEpisodes, edges, room, startedAt, now());
  } catch (error) {
    if (signal.aborted) throw error;
    return { state: "unknown", reason: session.abort.aborted ? "deadline" : error instanceof ZepError ? `read_failed_${error.statusCode ?? "network"}` : error instanceof Error ? error.message : "read_failed",
      startedAt, finishedAt: now() };
  }
}

export function zepRecoveryInventory(rawEpisodes: Zep.Episode[], edges: Zep.EntityEdge[], room: MemoryRoom,
  startedAt: number, finishedAt: number): Extract<RecoveryInventory, { state: "complete" }> {
    const episodes: ListedEpisode[] = [], facts: RecoveryFactInput[] = [], unexplained: string[] = [];
    const episodeIds = new Set(rawEpisodes.map(e => e.uuid));
    for (const e of rawEpisodes) {
      const m = metadata(e.metadata, room.uuid);
      const kind = m?.source_kind;
      const hash = m?.schema === 2 ? m.version : m?.carry_hash;
      if (m && kind === "fact" && m.part === "1/1" && (m.schema === 2 || m.carry_hash === null)) {
        facts.push({ id: e.uuid, processed: e.processed === true, sourceId: m.source_id, version: m.version, part: m.part, opId: m.op_id, copyId: m.copy_id,
          receiptIds: edges.filter(edge => edge.episodes?.includes(e.uuid)).map(edge => edge.uuid).sort() });
        continue;
      }
      if (!m || e.source !== "message" || !["message", "note"].includes(String(kind)) ||
        (kind === "message" ? typeof hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(hash) : m.schema !== 2 && m.carry_hash !== null)) {
        unexplained.push(`episode:${e.uuid}`); continue;
      }
      episodes.push({ id: e.uuid, processed: e.processed === true, sourceId: m.source_id, version: m.version, part: m.part,
        kind: kind as "message" | "note", opId: m.op_id, copyId: m.copy_id, carryHash: kind === "message" ? hash as string : null,
        ...(m.schema === 2 ? { legacy: true as const } : {}) });
    }
    for (const edge of edges) {
      if (!Array.isArray(edge.episodes) || !edge.episodes.length || edge.episodes.some(id => !episodeIds.has(id))) {
        unexplained.push(`edge:${edge.uuid}`);
      }
    }
    const fingerprint = recoveryFingerprint({ episodes: rawEpisodes.map(e => ({ id: e.uuid, source: e.source, processed: e.processed, metadata: e.metadata ?? null })).sort(order),
      edges: edges.map(e => ({ id: e.uuid, episodes: [...e.episodes ?? []].sort() })).sort(order) });
    return { state: "complete", episodes, facts, unexplained, fingerprint, startedAt, finishedAt };
}
