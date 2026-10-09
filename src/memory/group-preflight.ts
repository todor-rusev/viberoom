// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { isDeepStrictEqual } from "node:util";
import type { PartGroup } from "./part-group.js";
import type { SourceBodyEpisode, SourceBodyLimits } from "./source-body-proof.js";
import { validSourceBodyCreatedAt } from "./source-body-proof.js";
import { readZepMetadata } from "./zep-metadata.js";

export type GroupPreflightResult = { kind: "send"; current(): boolean } | { kind: "hold"; reason: string } | { kind: "adopted"; group: PartGroup };
export function immutableGroupPins(group: PartGroup): unknown {
  return { groupId: group.groupId, identity: group.identity, account: group.account, descriptor: group.descriptor,
    handedOffAt: group.handedOffAt, retired: group.retired, members: group.members.map(member => ({
      opId: member.opId, groupId: member.groupId, identity: member.identity, payload: member.payload,
      sourceVersion: member.sourceVersion, preparedAt: member.preparedAt, retiredAt: member.retiredAt,
      retirement: member.retirement, cleanup: member.cleanup,
    })) };
}
export const GROUP_BODY_PROOF_LIMITS: Readonly<SourceBodyLimits> = Object.freeze({
  maxPages: 20, maxEpisodes: 1000, maxCandidates: 128, maxGets: 128, maxResponseBytes: 32 * 1024 * 1024, timeoutMs: 20_000,
});
export const GROUP_ORIGINAL_BYTE_LIMIT = 16 * 1024 * 1024;
export const GROUP_PREFIX_BYTE_LIMIT = 1024 * 1024;

export function matchesOwnGroupEpisode(group: PartGroup, episode: SourceBodyEpisode): boolean {
  const member = group.members.find(row => row.opId === episode.opId);
  if (!member?.payload || member.retiredAt !== null || member.identity.copyId !== episode.copyId ||
    member.identity.sourceId !== episode.sourceId || member.identity.version !== episode.version || member.identity.part !== episode.part ||
    typeof episode.id !== "string" || !episode.id || typeof episode.processed !== "boolean" ||
    !validSourceBodyCreatedAt(episode.createdAt) || episode.content !== member.payload.request.data ||
    !isDeepStrictEqual(episode.metadata, member.payload.request.metadata) || episode.legacy || episode.schema !== 4 && episode.schema !== 3) return false;
  const metadata = readZepMetadata(member.payload.request.metadata);
  if (!metadata || episode.authorId !== metadata.author_id || episode.sourceAt !== metadata.source_at ||
    episode.carryHash !== metadata.carry_hash || episode.kind !== "message") return false;
  if (episode.source !== undefined && episode.source !== "message") return false;
  if (episode.sourceDescription !== undefined) {
    const description = /^viberoom room "[^\r\n]*"(?:, message ([1-9]\d*)|, explicit note)$/.exec(episode.sourceDescription);
    if (!description || description[0] !== episode.sourceDescription ||
      member.payload.binding?.seq !== undefined && description[1] !== String(member.payload.binding.seq)) return false;
  }
  return true;
}
