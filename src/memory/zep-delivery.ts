// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { ZepClient, ZepError, type Zep } from "@getzep/zep-cloud";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { EPISODE_INDEX_CLOCK_MARGIN_MS, IndexReadError, type IndexedEpisode, type IndexRead, type MemoryEpisodeIndex } from "./episode-index.js";
import type { PreparedDelivery as Delivery, Delivery as AnyDelivery, EpisodeInventory, JsonValue, ListedEpisode, ReadObservation, SourceListing, WriteIdentity, WriteObservation, WritePayload, WriteTransport } from "./delivery.js";
import type { MemoryEpisode, MemoryFact, MemoryRoom } from "./provider.js";
import { zepEpisodeRequest, zepFactRequest, zepRoomGraphId } from "./zep-payload.js";
import { createZepWriteFetcher, ZepWriteFailure } from "./zep-write-fetch.js";
import { createZepReadFetcher, retryAfterMs, type ZepFetcher, type ZepRateWindow } from "./zep-sdk-fetch.js";
import { readZepRecoveryInventory } from "./zep-recovery-sources.js";
import { readZepRecoveryKnowledge } from "./zep-recovery-knowledge.js";
import { zepPageCursorMissing } from "./zep-pagination.js";
import { ZEP_CARRY_HASH as CARRY_HASH, zepMetadata as metadata, readZepMetadata, zepMetadataFitsProvider, type ZepSourceKind } from "./zep-metadata.js";
import { ZepSourceBodyReader } from "./zep-source-body-proof.js";
import type { SourceBodyReader } from "./source-body-proof.js";
import { validateOriginalMessageProfile, type OriginalMessageWritePort } from "./original-message-preparation.js";
import { ZEP_EPISODE_MAX_CHARS } from "./zep-payload.js";
import { systemClock, type MemoryClock } from "./clock.js";

const EPISODE_FORMAT = "zep-episode-v1", FACT_FORMAT = "zep-fact-v1";
export const ZEP_MESSAGE_BYTES_PER_CREDIT = 350;
interface ReadLimits { timeoutMs: number; maxPages: number; pageSize: number }
export const ZEP_DELIVERY_READ_LIMITS: Readonly<ReadLimits> = Object.freeze({ timeoutMs: 20_000, maxPages: 100, pageSize: 100 });

export function prepareZepEpisode(identity: WriteIdentity, opId: string, room: MemoryRoom, episode: MemoryEpisode, kind: "message" | "note"): WritePayload {
  if (identity.provider !== "zep" || identity.kind !== "episode" || room.uuid !== identity.roomUuid || episode.sourceId !== identity.sourceId) throw new Error("Episode identity mismatch");
  if (zepRoomGraphId(room) !== zepRoomGraphId(graphOf({ identity }))) throw new Error("Episode graph identity mismatch");
  if (kind === "message" ? !CARRY_HASH.test(episode.carryHash ?? "") : episode.carryHash !== undefined) throw new Error("A message episode names its carried identity, and only a message's does");
  const request = zepEpisodeRequest(room, episode);
  return { format: EPISODE_FORMAT, request: { ...request, metadata: metadata(identity, opId, episode.authorId, kind, request.createdAt, episode.carryHash ?? null) },
    estimatedCredits: Math.max(1, Math.ceil(Buffer.byteLength(request.data, "utf8") / ZEP_MESSAGE_BYTES_PER_CREDIT)) };
}

export function createZepOriginalMessageWritePort(transport: Pick<WriteTransport, "validate">): OriginalMessageWritePort {
  const validate = transport.validate.bind(transport);
  const validatePolicy: OriginalMessageWritePort["validatePolicy"] = profile => {
    validateOriginalMessageProfile(profile, ZEP_MESSAGE_BYTES_PER_CREDIT);
    if (profile.input.maxBodyCodePoints > ZEP_EPISODE_MAX_CHARS) throw new Error("Original policy exceeds local Zep serializer cutoff");
  };
  return Object.freeze({
    bytesPerCredit: ZEP_MESSAGE_BYTES_PER_CREDIT,
    validatePolicy,
    buildPart(identity, opId, expected) {
      validatePolicy(expected.profile);
      if (!isDeepStrictEqual(identity, expected.identity)) throw new Error("Original native identity mismatch");
      const s = expected.source;
      const payload = prepareZepEpisode(identity, opId, expected.room, { sourceId: s.sourceId, seq: s.seq,
        authorId: s.authorId, authorName: s.authorName, text: expected.part.text, ts: s.ts, carryHash: expected.carryHash }, "message"),
        data = String(payload.request.data);
      if (data !== expected.part.data || [...expected.part.text].length > expected.profile.input.maxBodyCodePoints ||
          Buffer.byteLength(data) > expected.profile.input.maxDataUtf8Bytes || payload.estimatedCredits !== expected.part.estimatedCredits)
        throw new Error("Original native body exceeds its explicit exact policy");
      return { ...payload, binding: expected.binding };
    },
    validatePart(row, expected) {
      validatePolicy(expected.profile);
      if (!isDeepStrictEqual(row.identity, expected.identity)) throw new Error("Original native identity mismatch");
      validate(row);
      const s = expected.source, payload = prepareZepEpisode(row.identity, row.opId, expected.room, { sourceId: s.sourceId, seq: s.seq,
        authorId: s.authorId, authorName: s.authorName, text: expected.part.text, ts: s.ts, carryHash: expected.carryHash }, "message");
      if (row.payload.request.data !== expected.part.data || expected.part.utf8Bytes !== Buffer.byteLength(expected.part.data, "utf8") ||
          expected.part.estimatedCredits !== Math.max(1, Math.ceil(expected.part.utf8Bytes / ZEP_MESSAGE_BYTES_PER_CREDIT)) ||
          !isDeepStrictEqual(row.payload, { ...payload, binding: expected.binding })) throw new Error("Original native part serialization mismatch");
    },
  } satisfies OriginalMessageWritePort);
}

export function prepareZepFact(identity: WriteIdentity, opId: string, room: MemoryRoom, fact: MemoryFact): WritePayload {
  if (identity.provider !== "zep" || identity.kind !== "fact" || room.uuid !== identity.roomUuid) throw new Error("Fact identity mismatch");
  if (zepRoomGraphId(room) !== zepRoomGraphId(graphOf({ identity }))) throw new Error("Fact graph identity mismatch");
  const request = zepFactRequest(room, fact);
  return { format: FACT_FORMAT, request: { ...request, metadata: metadata(identity, opId, "hub", "fact", request.createdAt, null) }, estimatedCredits: 1 };
}

const object = (value: JsonValue): value is { [key: string]: JsonValue } => !!value && typeof value === "object" && !Array.isArray(value);
const unknown = (reason: string) => ({ state: "unknown" as const, reason });
type GraphScan = { state: "complete"; byOp: Map<string, Zep.Episode[]>; bySource: Map<string, ListedEpisode[]> } | { state: "unknown"; reason: string };
type TimedScan = GraphScan & { startedAt: number; finishedAt: number };
type Graph = Pick<MemoryRoom, "uuid" | "graphId">;
const graphOf = (row: { identity: WriteIdentity }): Graph => ({ uuid: row.identity.roomUuid, graphId: row.identity.graphId });
const graphKey = (graph: Graph): string => JSON.stringify([graph.uuid, zepRoomGraphId(graph)]);

function listedEpisode(episode: Zep.Episode, graphUuid: string): ListedEpisode | null {
  const m = readZepMetadata(episode.metadata);
  if (!episode.uuid || episode.source !== "message" || !m || m.room_id !== graphUuid) return null;
  const { source_id: sourceId, version, part, source_kind: kind, op_id: opId, copy_id: copyId, carry_hash: carryHash } = m;
  if (typeof sourceId !== "string" || !sourceId || typeof version !== "string" || !version || typeof part !== "string" || !part ||
      (kind !== "message" && kind !== "note")) return null;
  return { id: episode.uuid, processed: episode.processed === true, sourceId, version, part, kind,
    opId: typeof opId === "string" && opId ? opId : null, copyId: typeof copyId === "string" && copyId ? copyId : null,
    carryHash: m.schema === 2 && CARRY_HASH.test(version) ? version : typeof carryHash === "string" && CARRY_HASH.test(carryHash) ? carryHash : null,
    ...(m.schema === 2 ? { legacy: true as const } : {}) };
}

const timedSources = (scan: TimedScan): SourceListing => scan.state === "complete"
  ? { state: "complete", bySource: scan.bySource, startedAt: scan.startedAt, finishedAt: scan.finishedAt }
  : { state: "unknown", reason: scan.reason, startedAt: scan.startedAt, finishedAt: scan.finishedAt };

function representedBy(delivery: AnyDelivery, bySource: ReadonlyMap<string, readonly ListedEpisode[]>): ListedEpisode | undefined {
  const m = delivery.payload?.request.metadata;
  if (!m || !object(m) || !readZepMetadata(m) || m.schema === 2) return undefined;
  const i = delivery.identity;
  return (bySource.get(i.sourceId) ?? []).filter(e => e.kind === "message" && e.version === i.version && e.part === i.part && e.processed && e.opId !== delivery.opId)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0];
}

function readObservation(inventory: EpisodeInventory, represented?: ListedEpisode): ReadObservation {
  if (inventory.state !== "complete") return inventory;
  if (!inventory.episodes.length) return represented ? { state: "absent", represented: represented.id, representedCopy: represented.copyId ?? "unknown" } : { state: "absent" };
  const externalIds = inventory.episodes.map(e => e.id);
  return inventory.episodes.length > 1 ? { state: "duplicates", reason: "multiple_episodes_for_operation", externalIds }
    : { state: inventory.episodes[0].processed ? "processed" : "accepted", externalIds };
}

export class ZepWriteTransport implements WriteTransport {
  readonly provider = "zep";
  private readonly client: ZepClient;
  private readonly writes: ZepClient;
  private readonly limits: typeof ZEP_DELIVERY_READ_LIMITS;
  private readonly indexScope: string;
  private readonly bodyReader: ZepSourceBodyReader;
  readonly sourceBodyProof: SourceBodyReader = (request, signal, current) => this.bodyReader.read(request, signal, current);
  readonly originalSourceClassification: NonNullable<WriteTransport["originalSourceClassification"]> = (request, signal, current) => this.bodyReader.classify(request, signal, current);
  readonly originalSourceBodyProof: NonNullable<WriteTransport["originalSourceBodyProof"]> = (request, signal, current) => this.bodyReader.readOriginal(request, signal, current);

  recoveryInventory(uuid: string, signal: AbortSignal, now: () => number, graphId?: string) {
    return readZepRecoveryInventory(this.client, { uuid, name: "", graphId }, signal, now);
  }
  recoveryKnowledge(uuid: string, graphId: string, signal: AbortSignal, now: () => number) {
    return readZepRecoveryKnowledge(this.client, uuid, graphId, signal, now);
  }

  constructor(settings: { apiKey: string; baseUrl?: string; fetcher?: ZepFetcher }, limits: Partial<typeof ZEP_DELIVERY_READ_LIMITS> = {}, fetchFn: typeof fetch = fetch,
    private readonly clock: MemoryClock = systemClock, private readonly rateWindow?: ZepRateWindow) {
    this.bodyReader = new ZepSourceBodyReader(settings, fetchFn, clock);
    this.client = new ZepClient({ fetcher: createZepReadFetcher(fetchFn, undefined, rateWindow), ...settings });
    this.indexScope = `zep:${createHash("sha256").update(JSON.stringify([settings.baseUrl ?? "", settings.apiKey])).digest("hex")}`;
    this.writes = new ZepClient({ ...settings, fetcher: createZepWriteFetcher(fetchFn, rateWindow) });
    this.limits = { ...ZEP_DELIVERY_READ_LIMITS, ...limits };
    for (const [key, value] of Object.entries(this.limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid reconciliation limit: ${key}`);
    if (this.limits.pageSize > 100) throw new Error("Episode page size exceeds the adapter limit");
  }

  validate(delivery: Delivery): void {
    const { payload, identity, opId } = delivery, r = payload.request;
    const episode = payload.format === EPISODE_FORMAT && identity.kind === "episode";
    const fact = payload.format === FACT_FORMAT && identity.kind === "fact";
    if (identity.provider !== this.provider || (!episode && !fact) || r.graphId !== zepRoomGraphId(graphOf(delivery))) throw new Error("Unsupported or mismatched Zep delivery");
    const keys = episode ? ["graphId", "type", "data", "createdAt", "sourceDescription", "metadata"]
      : ["graphId", "fact", "factName", "sourceNodeName", "targetNodeName", "createdAt", "validAt", "metadata"];
    if (Object.keys(r).length !== keys.length || keys.some(key => !(key in r))) throw new Error("Unexpected Zep request fields");
    for (const key of keys.filter(key => key !== "metadata")) if (typeof r[key] !== "string") throw new Error("Invalid Zep request field");
    if (typeof r.createdAt !== "string" || !Number.isFinite(Date.parse(r.createdAt))) throw new Error("Invalid source time");
    if (episode && r.type !== "message") throw new Error("Unexpected episode type");
    const m = r.metadata;
    const decoded = readZepMetadata(m);
    if (!decoded || typeof decoded.author_id !== "string" ||
        !(episode ? ["message", "note"] : ["fact"]).includes(String(decoded.source_kind))) throw new Error("Invalid delivery metadata");
    let carry: string | null = null;
    if (decoded.schema !== 2) {
      const hash = decoded.carry_hash;
      if (decoded.source_kind === "message" ? typeof hash !== "string" || !CARRY_HASH.test(hash) : hash !== null) throw new Error("Invalid delivery metadata");
      carry = hash as string | null;
    }
    const expected = metadata(identity, opId, decoded.author_id, decoded.source_kind as ZepSourceKind, r.createdAt, carry, decoded.schema);
    if (!isDeepStrictEqual(m, expected)) throw new Error("Delivery metadata identity mismatch");
    const credits = episode ? Math.max(1, Math.ceil(Buffer.byteLength(String(r.data), "utf8") / ZEP_MESSAGE_BYTES_PER_CREDIT)) : 1;
    if (payload.estimatedCredits !== credits) throw new Error("Delivery credit estimate mismatch");
    if (fact && r.validAt !== r.createdAt) throw new Error("Unexpected fact validity");
  }

  async send(delivery: Delivery, signal?: AbortSignal): Promise<WriteObservation> {
    this.validate(delivery);
    if (!zepMetadataFitsProvider(delivery.payload.request.metadata)) return { state: "rejected", reason: "metadata_exceeds_provider_contract" };
    if (signal?.aborted) return { state: "not_applied", reason: "cancelled_before_fetch" };
    const options = { maxRetries: 0, timeoutInSeconds: 20, abortSignal: signal };
    try {
      if (delivery.payload.format === FACT_FORMAT) {
        const receipt = await this.writes.graph.addFactTriple(delivery.payload.request as unknown as Zep.AddTripleRequest, options);
        return { state: "accepted", externalIds: receipt.edge?.uuid ? [receipt.edge.uuid] : [] };
      }
      const receipt = await this.writes.graph.add(delivery.payload.request as unknown as Zep.AddDataRequest, options);
      if (!receipt.uuid) return unknown("acceptance_without_episode_id");
      return { state: receipt.processed === true ? "processed" : "accepted", externalIds: [receipt.uuid] };
    } catch (error) {
      return error instanceof ZepWriteFailure ? error.observation : unknown("transport_error");
    }
  }

  async reconcile(delivery: Delivery, signal?: AbortSignal, _options?: { fresh?: boolean }): Promise<ReadObservation> {
    this.validate(delivery);
    if (delivery.payload.format === FACT_FORMAT) {
      return delivery.state === "accepted" ? { state: "accepted", externalIds: delivery.externalIds } : unknown("fact_reconciliation_unverified");
    }
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = this.clock.setTimeout(() => controller.abort(), this.limits.timeoutMs);
    timer.unref?.();
    const options = { maxRetries: 0, timeoutInSeconds: this.limits.timeoutMs / 1000, abortSignal: controller.signal };
    try {
      controller.signal.throwIfAborted();
      if (delivery.state === "accepted" && delivery.externalIds.length === 1 && !delivery.replays) {
        const episode = await this.client.graph.episode.get(delivery.externalIds[0], options);
        if (episode.uuid !== delivery.externalIds[0]) return { state: "conflict", reason: "receipt_identity_changed" };
        return { state: episode.processed === true ? "processed" : "accepted", externalIds: delivery.externalIds };
      }
      const scan = await this.scanGraph(graphOf(delivery), id => id === delivery.opId, options);
      if (scan.state !== "complete") return scan;
      return readObservation(this.matchInventory(delivery, scan.byOp.get(delivery.opId) ?? []), representedBy(delivery, scan.bySource));
    } catch (error) {
      const status = error instanceof ZepError ? error.statusCode : undefined;
      return unknown(controller.signal.aborted ? "read_interrupted" : status ? `read_failed_${status}` : "read_failed");
    } finally {
      this.clock.clearTimeout(timer); signal?.removeEventListener("abort", cancel);
    }
  }

  async inventory(delivery: AnyDelivery, signal?: AbortSignal): Promise<EpisodeInventory> {
    if (delivery.identity.provider !== this.provider || delivery.identity.kind !== "episode") return unknown("fact_reconciliation_unverified");
    if (delivery.payload) this.validate(delivery as Delivery);
    else if (delivery.retiredAt === null) return unknown("missing_delivery_payload");
    const deadline = this.clock.timeout(this.limits.timeoutMs);
    const abortSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      abortSignal.throwIfAborted();
      return await this.listEpisodes(delivery, { maxRetries: 0, timeoutInSeconds: this.limits.timeoutMs / 1000, abortSignal });
    } catch (error) {
      const status = error instanceof ZepError ? error.statusCode : undefined;
      return unknown(abortSignal.aborted ? "read_interrupted" : status ? `read_failed_${status}` : "read_failed");
    }
  }

  async episodePresence(id: string, signal?: AbortSignal): Promise<"present" | "absent" | "unknown"> {
    try {
      signal?.throwIfAborted();
      const episode = await this.client.graph.episode.get(id, { maxRetries: 0, timeoutInSeconds: this.limits.timeoutMs / 1000, abortSignal: signal });
      signal?.throwIfAborted();
      return episode.uuid === id ? "present" : "unknown";
    } catch (error) {
      return !signal?.aborted && error instanceof ZepError && error.statusCode === 404 ? "absent" : "unknown";
    }
  }

  async factPresence(id: string, signal?: AbortSignal): Promise<"present" | "absent" | "unknown"> {
    try {
      signal?.throwIfAborted();
      const edge = await this.client.graph.edge.get(id, { maxRetries: 0, timeoutInSeconds: this.limits.timeoutMs / 1000, abortSignal: signal });
      signal?.throwIfAborted();
      return edge.uuid === id ? "present" : "unknown";
    } catch (error) { return !signal?.aborted && error instanceof ZepError && error.statusCode === 404 ? "absent" : "unknown"; }
  }

  async sources(graphUuid: string, signal: AbortSignal, now: () => number, graphId?: string): Promise<SourceListing> {
    return timedSources(await this.timedScan({ uuid: graphUuid, graphId }, () => false, signal, now));
  }

  usingIndex(index: MemoryEpisodeIndex, now: () => number,
    onSources?: (graph: string, listing: SourceListing, reads: WriteTransport, signal: AbortSignal, graphId?: string) => Promise<void>): WriteTransport {
    const scopes = new Set<string>([this.indexScope]);
    const scopeFor = (graph: Graph): string => {
      const physical = zepRoomGraphId(graph);
      const scope = physical === zepRoomGraphId({ uuid: graph.uuid }) ? this.indexScope
        : `${this.indexScope}:generation:${createHash("sha256").update(physical).digest("hex")}`;
      scopes.add(scope); return scope;
    };
    const indexed = (episode: Zep.Episode, graph: Graph): IndexedEpisode => {
      const createdAt = Date.parse(episode.createdAt ?? "");
      if (!episode.uuid || !Number.isSafeInteger(createdAt)) throw new IndexReadError("index_invalid_episode", true);
      return { id: episode.uuid, createdAt, opId: typeof episode.metadata?.op_id === "string" ? episode.metadata.op_id : null,
        source: listedEpisode(episode, graph.uuid) };
    };
    const read = async (graph: Graph, signal: AbortSignal, from?: number): Promise<IndexRead> => {
      const abort = AbortSignal.any([signal, this.clock.timeout(this.limits.timeoutMs)]);
      const result = await index.read(scopeFor(graph), graph.uuid, { page: async (direction, cursor, signal) => {
        try {
          const response = await this.client.graph.episode.listByGraphId(zepRoomGraphId(graph), {
            orderBy: "created_at", direction, ...(cursor ? { cursor } : {}),
          }, { maxRetries: 0, timeoutInSeconds: this.limits.timeoutMs / 1000, abortSignal: signal }).withRawResponse();
          signal.throwIfAborted();
          const truncated = response.rawResponse.headers.get("zep-truncated");
          if (truncated && !["false", "0"].includes(truncated.toLowerCase())) throw new IndexReadError("index_truncated", true);
          if (!Array.isArray(response.data) || response.data.length > this.limits.pageSize) throw new IndexReadError("index_invalid_page", true);
          const next = response.rawResponse.headers.get("zep-next-cursor");
          if (zepPageCursorMissing(response.data.length, this.limits.pageSize, next)) throw new IndexReadError("index_cursor_missing", true);
          return { episodes: response.data.map(e => indexed(e, graph)), next };
        } catch (error) {
          if (error instanceof IndexReadError) throw error;
          const status = error instanceof ZepError ? error.statusCode : undefined;
          const headers = (error as { rawResponse?: { headers?: Headers } } | null)?.rawResponse?.headers;
          const wait = status !== 429 ? null : this.rateWindow?.throttledFor() || (headers && typeof headers.get === "function" ? retryAfterMs(headers) : null);
          throw new IndexReadError(status ? `index_read_failed_${status}` : "index_read_failed", !!cursor && (status === 400 || status === 410), status === 429, wait);
        }
      } }, abort, now, this.limits.maxPages, from);
      if (result.complete) await onSources?.(graph.uuid, sources(graph, result), transport, abort, graph.graphId);
      return result;
    };
    const get = async (graph: Graph, id: string, signal?: AbortSignal): Promise<Zep.Episode | null> => {
      signal?.throwIfAborted();
      try {
        const episode = await this.client.graph.episode.get(id, { maxRetries: 0, timeoutInSeconds: this.limits.timeoutMs / 1000, abortSignal: signal });
        signal?.throwIfAborted();
        if (episode.uuid !== id) throw new IndexReadError("index_episode_identity_changed");
        index.refresh(scopeFor(graph), graph.uuid, indexed(episode, graph));
        return episode;
      } catch (error) {
        if (!signal?.aborted && error instanceof ZepError && error.statusCode === 404) { index.remove(scopeFor(graph), graph.uuid, id); return null; }
        throw error;
      }
    };
    const sources = (graph: Graph, r: IndexRead): SourceListing => {
      if (!r.complete) return { state: "unknown", reason: r.reason ?? "index_incomplete", startedAt: r.startedAt, finishedAt: r.finishedAt };
      const bySource = new Map<string, ListedEpisode[]>();
      for (const e of index.entries(scopeFor(graph), graph.uuid)) if (e.source) bySource.set(e.source.sourceId, [...bySource.get(e.source.sourceId) ?? [], e.source]);
      return { state: "complete", bySource, startedAt: r.startedAt, finishedAt: r.finishedAt };
    };
    const inventory = async (delivery: AnyDelivery, r: IndexRead, signal?: AbortSignal): Promise<EpisodeInventory> => {
      if (delivery.identity.provider !== this.provider || delivery.identity.kind !== "episode") return unknown("fact_reconciliation_unverified");
      if (!delivery.payload && delivery.retiredAt === null) return unknown("missing_delivery_payload");
      if (!r.complete) return unknown(r.reason ?? "index_incomplete");
      if (delivery.payload) this.validate(delivery as Delivery);
      const abort = signal ? AbortSignal.any([signal, this.clock.timeout(this.limits.timeoutMs)]) : this.clock.timeout(this.limits.timeoutMs);
      const graph = graphOf(delivery), entries = index.entries(scopeFor(graph), graph.uuid, delivery.opId), episodes: Zep.Episode[] = [];
      if (entries.length > 10_000) return unknown("operation_match_limit");
      try {
        for (const e of entries) { const episode = await get(graph, e.id, abort); if (episode) episodes.push(episode); }
        const matched = this.matchInventory(delivery, episodes);
        return matched.state === "complete" ? { ...matched, scan: { startedAt: r.startedAt, finishedAt: r.finishedAt, indexedFrom: r.from! } } : matched;
      } catch { return unknown(abort.aborted ? "read_interrupted" : "indexed_episode_unverified"); }
    };
    const sourceEpisodes: NonNullable<WriteTransport["sourceEpisodes"]> = async (uuid, sourceId, signal, graphId) => {
      const graph: Graph = { uuid, graphId };
      const abort = AbortSignal.any([signal, this.clock.timeout(this.limits.timeoutMs)]), episodes: ListedEpisode[] = [];
      const entries = index.entries(scopeFor(graph), graph.uuid, undefined, sourceId);
      if (entries.length > 10_000) return unknown("source_match_limit");
      try {
        for (const e of entries) {
          const fresh = await get(graph, e.id, abort);
          if (!fresh) continue;
          const source = listedEpisode(fresh, graph.uuid);
          if (!source || source.sourceId !== sourceId) return unknown("indexed_source_changed");
          episodes.push(source);
        }
        return { state: "complete", episodes };
      } catch { return unknown(abort.aborted ? "read_interrupted" : "indexed_source_unverified"); }
    };
    const reconcile = async (row: Delivery, r: IndexRead, signal?: AbortSignal): Promise<ReadObservation> => {
      const found = await inventory(row, r, signal);
      let represented: ListedEpisode | undefined;
      if (found.state === "complete" && !found.episodes.length) {
        const fresh = await sourceEpisodes(row.identity.roomUuid, row.identity.sourceId, signal ?? new AbortController().signal, row.identity.graphId);
        if (fresh.state !== "complete") return fresh;
        represented = representedBy(row, new Map([[row.identity.sourceId, fresh.episodes]]));
      }
      return { ...readObservation(found, represented), scan: { startedAt: r.startedAt, finishedAt: r.finishedAt,
        ...(r.complete ? { indexedFrom: r.from! } : {}) } };
    };
    const transport: WriteTransport = {
      sourceBodyProof: (request, signal, current) => this.sourceBodyProof(request, signal, current),
      originalSourceClassification: (request, signal, current) => this.originalSourceClassification(request, signal, current),
      originalSourceBodyProof: (request, signal, current) => this.originalSourceBodyProof(request, signal, current),
      provider: this.provider, validate: row => this.validate(row), send: (row, signal) => this.send(row, signal),
      episodePresence: async (id, signal) => {
        const presence = await this.episodePresence(id, signal);
        if (presence === "absent") for (const scope of scopes) index.removeReceipt(scope, id);
        return presence;
      },
      sources: async (uuid, signal, _now, graphId) => { const graph = { uuid, graphId }; return sources(graph, await read(graph, signal)); },
      inventory: async (row, signal) => inventory(row, await read(graphOf(row), signal ?? new AbortController().signal,
        row.attemptedAt === null ? undefined : row.attemptedAt - EPISODE_INDEX_CLOCK_MARGIN_MS), signal),
      reconcile: async (row, signal) => {
        if (row.payload.format === FACT_FORMAT || row.state === "accepted" && row.externalIds.length === 1 && !row.replays) return this.reconcile(row, signal);
        const r = await read(graphOf(row), signal ?? new AbortController().signal, row.attemptedAt === null ? undefined : row.attemptedAt - EPISODE_INDEX_CLOCK_MARGIN_MS);
        return reconcile(row, r, signal);
      },
      sourceEpisodes,
      advanceIndex: async (uuid, signal, graphId) => { const graph = { uuid, graphId }; return sources(graph, await read(graph, signal)); },
      nextIndexRead: (uuid, graphId) => index.nextAt(scopeFor({ uuid, graphId }), uuid),
      dropIndex: (uuid, graphId) => index.drop(scopeFor({ uuid, graphId }), uuid),
      readCycle: (_ids, signal, _now, requiredFrom) => {
        const scans = new Map<string, Promise<IndexRead>>();
        const shared = (graph: Graph) => { const key = graphKey(graph); if (!scans.has(key)) scans.set(key, read(graph, signal, requiredFrom)); return scans.get(key)!; };
        return { ...transport, advanceIndex: async (uuid, _signal, graphId) => { const graph = { uuid, graphId }; return sources(graph, await shared(graph)); },
          sources: async (uuid, _signal, _now, graphId) => { const graph = { uuid, graphId }; return sources(graph, await shared(graph)); },
          inventory: async (row, abort) => inventory(row, await shared(graphOf(row)), abort),
          reconcile: async (row, abort, options) => {
            if (options?.fresh || row.payload.format === FACT_FORMAT || row.state === "accepted" && row.externalIds.length === 1 && !row.replays) return transport.reconcile(row, abort, options);
            return reconcile(row, await shared(graphOf(row)), abort);
          } };
      },
    };
    return transport;
  }

  private async timedScan(graph: Graph, wanted: (opId: string) => boolean, signal: AbortSignal, now: () => number): Promise<TimedScan> {
    const abortSignal = AbortSignal.any([signal, this.clock.timeout(this.limits.timeoutMs)]), startedAt = now();
    try {
      const scan = await this.scanGraph(graph, wanted, { maxRetries: 0, timeoutInSeconds: this.limits.timeoutMs / 1000, abortSignal });
      return { ...scan, startedAt, finishedAt: now() };
    } catch (error) {
      const status = error instanceof ZepError ? error.statusCode : undefined;
      return { ...unknown(abortSignal.aborted ? "read_interrupted" : status ? `read_failed_${status}` : "read_failed"), startedAt, finishedAt: now() };
    }
  }

  readCycle(opIds: ReadonlySet<string>, signal: AbortSignal, now: () => number): WriteTransport {
    const listings = new Map<string, Promise<TimedScan>>();
    const shared = (graph: Graph): Promise<TimedScan> => {
      const key = graphKey(graph);
      let listing = listings.get(key);
      if (!listing) {
        listing = this.timedScan(graph, id => opIds.has(id), signal, now);
        listings.set(key, listing);
      }
      return listing;
    };
    const inventoryOf = (delivery: AnyDelivery, scan: TimedScan): EpisodeInventory => {
      if (scan.state !== "complete") return unknown(scan.reason);
      const inventory = this.matchInventory(delivery, scan.byOp.get(delivery.opId) ?? []);
      return inventory.state === "complete" ? { ...inventory, scan: { startedAt: scan.startedAt, finishedAt: scan.finishedAt } } : inventory;
    };
    return {
      sourceBodyProof: (request, signal, current) => this.sourceBodyProof(request, signal, current),
      originalSourceClassification: (request, signal, current) => this.originalSourceClassification(request, signal, current),
      originalSourceBodyProof: (request, signal, current) => this.originalSourceBodyProof(request, signal, current),
      provider: this.provider,
      validate: delivery => this.validate(delivery),
      send: (delivery, abort) => this.send(delivery, abort),
      episodePresence: (id, abort) => this.episodePresence(id, abort),
      sources: async (uuid, _signal, _now, graphId) => timedSources(await shared({ uuid, graphId })),
      reconcile: async (delivery, abort, options) => {
        if (options?.fresh || !opIds.has(delivery.opId) || delivery.payload.format === FACT_FORMAT ||
            delivery.state === "accepted" && delivery.externalIds.length === 1 && !delivery.replays) return this.reconcile(delivery, abort, options);
        this.validate(delivery);
        const scan = await shared(graphOf(delivery));
        return { ...readObservation(inventoryOf(delivery, scan), scan.state === "complete" ? representedBy(delivery, scan.bySource) : undefined),
          scan: { startedAt: scan.startedAt, finishedAt: scan.finishedAt } };
      },
      inventory: async (delivery, abort) => {
        if (!opIds.has(delivery.opId) || delivery.identity.provider !== this.provider || delivery.identity.kind !== "episode") return this.inventory(delivery, abort);
        if (delivery.payload) this.validate(delivery as Delivery);
        else if (delivery.retiredAt === null) return unknown("missing_delivery_payload");
        return inventoryOf(delivery, await shared(graphOf(delivery)));
      },
    };
  }

  private async listEpisodes(delivery: AnyDelivery, options: { maxRetries: number; timeoutInSeconds: number; abortSignal: AbortSignal }): Promise<EpisodeInventory> {
    const scan = await this.scanGraph(graphOf(delivery), id => id === delivery.opId, options);
    return scan.state === "complete" ? this.matchInventory(delivery, scan.byOp.get(delivery.opId) ?? []) : scan;
  }

  private async scanGraph(graph: Graph, wanted: (opId: string) => boolean,
    options: { maxRetries: number; timeoutInSeconds: number; abortSignal: AbortSignal }): Promise<GraphScan> {
    const cursors = new Set<string>(), ids = new Set<string>(), byOp = new Map<string, Zep.Episode[]>(), bySource = new Map<string, ListedEpisode[]>();
    let cursor: string | undefined;
    for (let page = 0; page < this.limits.maxPages; page++) {
      options.abortSignal.throwIfAborted();
      const response = await this.client.graph.episode.listByGraphId(zepRoomGraphId(graph), {
        orderBy: "uuid", direction: "asc", ...(cursor ? { cursor } : {}),
      }, options).withRawResponse();
      options.abortSignal.throwIfAborted();
      const truncated = response.rawResponse.headers.get("zep-truncated");
      if (truncated && !["false", "0"].includes(truncated.toLowerCase())) return unknown("listing_truncated");
      if (!Array.isArray(response.data) || response.data.length > this.limits.pageSize) return unknown("listing_invalid");
      for (const episode of response.data) {
        if (!episode.uuid || ids.has(episode.uuid)) return unknown("listing_unstable");
        ids.add(episode.uuid);
        const opId = episode.metadata?.op_id;
        if (typeof opId === "string" && wanted(opId)) byOp.set(opId, [...byOp.get(opId) ?? [], episode]);
        const listed = listedEpisode(episode, graph.uuid);
        if (listed) bySource.set(listed.sourceId, [...bySource.get(listed.sourceId) ?? [], listed]);
      }
      const next = response.rawResponse.headers.get("zep-next-cursor");
      if (zepPageCursorMissing(response.data.length, this.limits.pageSize, next)) return unknown("listing_cursor_missing");
      if (!next) return { state: "complete", byOp, bySource };
      if (cursors.has(next)) return unknown("listing_cursor_loop");
      cursors.add(next); cursor = next;
    }
    return unknown("listing_page_limit");
  }

  private matchInventory(delivery: AnyDelivery, matches: Zep.Episode[]): EpisodeInventory {
    const i = delivery.identity;
    const identity = { op_id: delivery.opId, room_id: i.roomUuid, copy_id: i.copyId,
      source_id: i.sourceId, version: i.version, part: i.part };
    const request = delivery.payload?.request;
    const mismatch = matches.some(e => e.source !== "message" || !readZepMetadata(e.metadata) || !["message", "note"].includes(String(readZepMetadata(e.metadata)?.source_kind)) ||
      Object.entries(identity).some(([key, value]) => e.metadata?.[key] !== value) ||
      request && (e.content !== request.data || e.sourceDescription !== request.sourceDescription ||
        !isDeepStrictEqual(e.metadata, request.metadata)));
    if (mismatch) return { state: "conflict", reason: "episode_payload_mismatch" };
    if (matches.length > 10_000) return unknown("operation_match_limit");
    return { state: "complete", episodes: matches.map(e => ({ id: e.uuid, processed: e.processed === true })) };
  }
}
