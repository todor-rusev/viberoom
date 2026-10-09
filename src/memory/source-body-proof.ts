// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash } from "node:crypto";
import type { OriginalMessageSource, OriginalMessageText } from "./original-input.js";
import { validPartGroupDescriptor, type PartGroup } from "./part-group.js";
import type { ListedEpisode, SourceListing } from "./delivery.js";
import { readZepMetadata } from "./zep-metadata.js";

export interface SourceBodyScope {
  provider: "zep";
  account: string;
  roomUuid: string;
  graphId?: string;
  sourceId: string;
  version: string;
}
export interface SourceBodyLimits {
  maxPages: number;
  maxEpisodes: number;
  maxCandidates: number;
  maxGets: number;
  maxResponseBytes: number;
  timeoutMs: number;
}
export interface SourceBodyRequest { scope: SourceBodyScope; limits: SourceBodyLimits }
export interface SourceBodyEpisode extends ListedEpisode {
  schema: 2 | 3 | 4;
  authorId: string;
  sourceAt: string;
  content: string;
  metadata: Readonly<Record<string, unknown>>;
  createdAt: string;
  source?: string;
  sourceDescription?: string;
}
export interface SourceBodyAccounting { pages: number; episodes: number; candidates: number; gets: number; responseBytes: number }
export type SourceBodyProof = { state: "complete"; scope: Readonly<SourceBodyScope>; episodes: readonly SourceBodyEpisode[];
  scan: { startedAt: number; finishedAt: number }; accounting: SourceBodyAccounting }
  | { state: "unknown"; reason: string; accounting: SourceBodyAccounting };
export type SourceBodyReader = (request: SourceBodyRequest, signal: AbortSignal, current: () => boolean) => Promise<SourceBodyProof>;
export type OriginalSourceClassification = (Extract<SourceListing, { state: "complete" }> & {
  scope: Readonly<SourceBodyScope>; accounting: SourceBodyAccounting }) | { state: "unknown"; reason: string; accounting: SourceBodyAccounting };
export type OriginalSourceClassificationReader = (request: SourceBodyRequest, signal: AbortSignal, current: () => boolean) => Promise<OriginalSourceClassification>;
interface OriginalBodyBudget { maxOriginalBytes: number; maxPrefixBytes: number }
export type SourceBodyExpectation =
  | ({ mode: "original"; source: OriginalMessageSource; input: OriginalMessageText } & OriginalBodyBudget)
  | ({ mode: "prepared-group"; group: PartGroup } & OriginalBodyBudget);
export type SourceBodyCompatibility = { kind: "compatible"; episodes: readonly SourceBodyEpisode[]; copyId: string;
  evidence: "complete-original-bytes" | "complete-prepared-member-bytes"; cohortProven: false; bodySha256: string }
  | { kind: "hold"; reason: string };
const fingerprint = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const canonicalPart = (part: string): [number, number] | null => {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(part);
  if (!match || match[0] !== part) return null;
  const n = Number(match[1]), total = Number(match[2]);
  return n <= total && total <= 64 ? [n, total] : null;
};
const sameScope = (a: SourceBodyScope, b: SourceBodyScope) => a.provider === b.provider && a.account === b.account &&
  a.roomUuid === b.roomUuid && a.graphId === b.graphId && a.sourceId === b.sourceId && a.version === b.version;
const wellFormed = (text: string) => Buffer.from(text, "utf8").toString("utf8") === text;
const identifier = (value: unknown): value is string => typeof value === "string" && !!value.trim() &&
  !/[\u0000-\u001f\u007f]/u.test(value) && wellFormed(value);
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
export function validSourceBodyCreatedAt(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!match || match[0] !== value) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number), check = new Date(0);
  check.setUTCFullYear(year, month - 1, day); check.setUTCHours(hour, minute, second, 0);
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day &&
    check.getUTCHours() === hour && check.getUTCMinutes() === minute && check.getUTCSeconds() === second &&
    (match[8] === "Z" || +match[8].slice(1, 3) <= 23 && +match[8].slice(4) <= 59) && Number.isFinite(Date.parse(value));
}
export function validOriginalClassificationMetadata(value: unknown): boolean {
  const m = readZepMetadata(value);
  if (!m || !value || typeof value !== "object" || Array.isArray(value) || m.source_kind !== "message") return false;
  const keys = m.schema === 4 ? ["schema", "op_id", "source_id", "version", "room_id", "copy_id", "part", "source_at", "origin", "carry_hash"]
    : ["schema", "op_id", "source_id", "version", "room_id", "copy_id", "part", "source_at", "author_id", "source_kind", ...(m.schema === 3 ? ["carry_hash"] : [])];
  return Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)) &&
    [m.op_id, m.source_id, m.room_id, m.copy_id, m.author_id].every(identifier) &&
    typeof m.version === "string" && /^sha256:[a-f0-9]{64}$/.test(m.version) &&
    typeof m.part === "string" && !!canonicalPart(m.part) && validSourceBodyCreatedAt(m.source_at) &&
    (m.schema === 2 || typeof m.carry_hash === "string" && /^sha256:[a-f0-9]{64}$/.test(m.carry_hash));
}

export function compatibleSourceBodies(scope: SourceBodyScope, expected: SourceBodyExpectation, proof: SourceBodyProof): SourceBodyCompatibility {
  const hold = (reason: string): SourceBodyCompatibility => ({ kind: "hold", reason });
  if (proof.state !== "complete") return hold(proof.reason);
  if (!sameScope(scope, proof.scope)) return hold("source_body_scope_changed");
  if (!Number.isSafeInteger(expected.maxOriginalBytes) || expected.maxOriginalBytes <= 0 || expected.maxOriginalBytes > 16 * 1024 * 1024)
    return hold("source_body_original_budget_invalid");
  if (!Number.isSafeInteger(expected.maxPrefixBytes) || expected.maxPrefixBytes <= 0 || expected.maxPrefixBytes > 1024 * 1024)
    return hold("source_body_prefix_budget_invalid");
  let source: OriginalMessageSource, text: string, nativeParts: string[] | null = null;
  if (expected.mode === "original") {
    source = expected.source; text = expected.input.text;
    if (!["chat-text-v1", "memory-text-v1"].includes(expected.input.representation)) return hold("source_body_representation_unknown");
  } else {
    const group = expected.group, first = group.members[0]?.payload?.binding?.source;
    if (group.retired || !first || first.kind !== "message" || !group.members.length || !validPartGroupDescriptor(group.descriptor) || group.account !== scope.account ||
      group.identity.provider !== scope.provider || group.identity.roomUuid !== scope.roomUuid || group.identity.graphId !== scope.graphId ||
      group.identity.sourceId !== scope.sourceId || group.identity.version !== scope.version || group.members.length !== group.descriptor.parts.length)
      return hold("source_body_prepared_group_invalid");
    source = { roomUuid: scope.roomUuid, sourceId: scope.sourceId, version: scope.version,
      authorId: first.authorId, authorName: first.authorName, ts: first.ts,
      ...(group.members[0].payload?.binding?.seq === undefined ? {} : { seq: group.members[0].payload!.binding!.seq }) };
    nativeParts = [];
    const prefix = `${source.authorName} [${source.authorId}]: `; let originalBytes = 0, originalPoints = 0;
    if (Buffer.byteLength(prefix, "utf8") > expected.maxPrefixBytes) return hold("source_body_prefix_budget_exhausted");
    for (let at = 0; at < group.members.length; at++) {
      const member = group.members[at], descriptor = group.descriptor.parts[at], data = member.payload?.request.data, binding = member.payload?.binding;
      if (!member.payload || member.retiredAt !== null || member.groupId !== group.groupId || member.opId !== descriptor.opId ||
        member.identity.provider !== group.identity.provider || member.identity.roomId !== group.identity.roomId ||
        member.identity.roomUuid !== group.identity.roomUuid || member.identity.graphId !== group.identity.graphId ||
        member.identity.sourceId !== group.identity.sourceId || member.identity.version !== group.identity.version ||
        member.identity.copyId !== group.identity.copyId || member.identity.kind !== "episode" || member.identity.generation !== undefined ||
        binding?.source?.kind !== "message" || binding.source.version !== source.version || binding.source.authorId !== source.authorId ||
        binding.source.authorName !== source.authorName || binding.source.ts !== source.ts || binding.source.graphId !== scope.graphId || binding.seq !== source.seq ||
        member.identity.part !== `${at + 1}/${group.members.length}` || descriptor.part !== member.identity.part || typeof data !== "string" ||
        !data.startsWith(prefix) || !wellFormed(data) || fingerprint(data) !== descriptor.fingerprint ||
        member.payload.estimatedCredits !== descriptor.estimatedCredits) return hold("source_body_prepared_member_invalid");
      const body = data.slice(prefix.length), previous = group.descriptor.parts[at - 1];
      originalBytes += Buffer.byteLength(body, "utf8"); originalPoints += [...body].length;
      if (!body || originalBytes > expected.maxOriginalBytes || descriptor.start !== (previous?.end ?? 0) ||
        descriptor.end - descriptor.start !== body.length || descriptor.utf8Bytes !== Buffer.byteLength(data, "utf8") ||
        descriptor.codePoints !== [...body].length) return hold("source_body_prepared_coverage_invalid");
      nativeParts.push(data);
    }
    text = nativeParts.map(data => data.slice(prefix.length)).join("");
    if (fingerprint(text) !== group.descriptor.representationFingerprint || group.descriptor.utf8Bytes !== originalBytes ||
      group.descriptor.codePoints !== originalPoints) return hold("source_body_prepared_original_invalid");
  }
  if (source.roomUuid !== scope.roomUuid || source.sourceId !== scope.sourceId || source.version !== scope.version ||
    !identifier(source.roomUuid) || !identifier(source.sourceId) || !/^sha256:[a-f0-9]{64}$/.test(source.version) ||
    !identifier(source.authorId) || /[\[\]:\s]/u.test(source.authorId) || !identifier(source.authorName) ||
    source.seq !== undefined && (!Number.isSafeInteger(source.seq) || source.seq <= 0) ||
    source.originCopy !== undefined && !identifier(source.originCopy) || !Number.isSafeInteger(source.ts) || source.ts < 0 ||
    source.ts > 8_640_000_000_000_000 || typeof text !== "string" || !text || !wellFormed(text) ||
    Buffer.byteLength(text, "utf8") > expected.maxOriginalBytes) return hold("source_body_original_invalid");
  const prefix = `${source.authorName} [${source.authorId}]: `, sourceAt = new Date(source.ts).toISOString();
  if (Buffer.byteLength(prefix, "utf8") > expected.maxPrefixBytes) return hold("source_body_prefix_budget_exhausted");
  const partitions = new Map<string, SourceBodyEpisode[]>(), ids = new Set<string>(); let nativeBytes = 0;
  if (proof.episodes.length > 512) return hold("source_body_candidate_limit");
  for (const episode of proof.episodes) {
    const part = canonicalPart(episode.part);
    const metadata = readZepMetadata(episode.metadata);
    if (!identifier(episode.id) || ids.has(episode.id) || !part || !identifier(episode.copyId) || !identifier(episode.opId) || episode.kind !== "message" ||
      episode.sourceId !== scope.sourceId || episode.version !== scope.version || episode.authorId !== source.authorId ||
      episode.sourceAt !== sourceAt || !validSourceBodyCreatedAt(episode.createdAt) || ![2, 3, 4].includes(episode.schema) ||
      typeof episode.content !== "string" || !wellFormed(episode.content))
      return hold("source_body_candidate_invalid");
    if (!metadata || metadata.schema !== episode.schema || metadata.room_id !== scope.roomUuid || metadata.source_id !== episode.sourceId ||
      metadata.version !== episode.version || metadata.part !== episode.part || metadata.copy_id !== episode.copyId || metadata.op_id !== episode.opId ||
      metadata.author_id !== episode.authorId || metadata.source_kind !== "message" || metadata.source_at !== episode.sourceAt ||
      episode.schema !== 2 && metadata.carry_hash !== episode.carryHash) return hold("source_body_candidate_metadata_changed");
    nativeBytes += Buffer.byteLength(episode.content, "utf8");
    if (nativeBytes > 64 * 1024 * 1024) return hold("source_body_native_budget_exhausted");
    ids.add(episode.id);
    if (episode.schema === 2 || episode.legacy) return hold("legacy_identity_is_not_original_proof");
    const description = typeof episode.sourceDescription !== "string" ? undefined : /^viberoom room "[^\r\n]*"(?:, message ([1-9]\d*)|, explicit note)$/.exec(episode.sourceDescription);
    if (episode.source !== undefined && episode.source !== "message" || episode.sourceDescription !== undefined &&
      (!description || description[0] !== episode.sourceDescription || source.seq !== undefined && description[1] !== String(source.seq)))
      return hold("source_body_optional_provenance_invalid");
    const key = JSON.stringify([episode.copyId, part[1]]);
    partitions.set(key, [...partitions.get(key) ?? [], episode]);
  }
  let reason = "source_body_partition_missing";
  for (const key of [...partitions.keys()].sort()) {
    const candidates = partitions.get(key)!, total = canonicalPart(candidates[0].part)![1];
    if (nativeParts && total !== nativeParts.length) { reason = "source_body_prepared_partition_incompatible"; continue; }
    const chosen: SourceBodyEpisode[] = []; let offset = 0, compatible = true;
    for (let n = 1; n <= total; n++) {
      const ordinal = candidates.filter(e => e.part === `${n}/${total}`);
      const bodies = new Set(ordinal.map(e => e.content));
      if (!nativeParts && bodies.size > 1) { reason = "source_body_ordinal_ambiguous"; compatible = false; break; }
      const matches = ordinal.filter(e => e.processed === true && (!nativeParts || e.content === nativeParts[n - 1]))
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const member = matches[0];
      if (!member || !member.content.startsWith(prefix)) { reason = "source_body_member_missing_or_incompatible"; compatible = false; break; }
      const body = member.content.slice(prefix.length);
      if (!body || text.slice(offset, offset + body.length) !== body) { reason = "source_body_original_mismatch"; compatible = false; break; }
      offset += body.length; chosen.push(member);
    }
    if (!compatible || offset !== text.length) { if (compatible) reason = "source_body_original_incomplete"; continue; }
    try { return freeze(structuredClone({ kind: "compatible" as const, episodes: chosen, copyId: chosen[0].copyId!, cohortProven: false as const,
      evidence: nativeParts ? "complete-prepared-member-bytes" as const : "complete-original-bytes" as const, bodySha256: fingerprint(text) })); }
    catch { return hold("source_body_observation_not_snapshotable"); }
  }
  return hold(reason);
}
