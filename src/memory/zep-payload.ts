// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { MemoryEpisode, MemoryFact, MemoryRoom } from "./provider.js";
import { GenerationError, baseGenerationId, generationOwner } from "./graph-generations.js";

export const ZEP_EPISODE_MAX_CHARS = 9_000;
export const zepGraphId = (roomUuid: string) => `viberoom-${roomUuid}`;
export function zepRoomGraphId(room: Pick<MemoryRoom, "uuid" | "graphId">): string {
  const base = zepGraphId(room.uuid);
  if (room.graphId === undefined) return base;
  if (room.graphId === base) throw new GenerationError("base_generation_address_must_be_implicit");
  if (!generationOwner(room.uuid, room.graphId)) throw new GenerationError("not_a_room_generation");
  return room.graphId;
}

export function zepPhysicalGraphId(room: Pick<MemoryRoom, "uuid" | "graphId">): string {
  const base = baseGenerationId(room.uuid);
  if (room.graphId === undefined || room.graphId === base) return base;
  if (!generationOwner(room.uuid, room.graphId)) throw new GenerationError("not_a_room_generation");
  return room.graphId;
}

export function zepEpisodeRequest(room: MemoryRoom, episode: MemoryEpisode) {
  const body = [...episode.text].length > ZEP_EPISODE_MAX_CHARS
    ? [...episode.text].slice(0, ZEP_EPISODE_MAX_CHARS).join("") + " […]" : episode.text;
  return {
    graphId: zepRoomGraphId(room), type: "message" as const,
    data: `${episode.authorName} [${episode.authorId}]: ${body}`,
    createdAt: new Date(episode.ts).toISOString(),
    sourceDescription: `viberoom room "${room.name}"${episode.seq ? `, message ${episode.seq}` : ", explicit note"}`,
  };
}

export function zepFactRequest(room: MemoryRoom, fact: MemoryFact) {
  return {
    graphId: zepRoomGraphId(room), fact: `${fact.subject} ${fact.predicate} ${fact.object}`,
    factName: fact.predicate.toUpperCase().replace(/[^\p{Lu}\p{N}]+/gu, "_").slice(0, 50) || "RELATES_TO",
    sourceNodeName: fact.subject, targetNodeName: fact.object,
    createdAt: new Date(fact.ts).toISOString(), validAt: new Date(fact.ts).toISOString(),
  };
}
