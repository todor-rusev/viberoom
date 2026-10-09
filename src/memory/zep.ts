// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { ZepClient, ZepError, ZepTimeoutError, entityFields, type EntityType } from "@getzep/zep-cloud";
import { MemoryProviderError, type MemoryCapabilities, type MemoryEpisode, type MemoryFact, type MemoryProvider, type MemoryRoom, type Recalled, type SearchOptions } from "./provider.js";
import { describeNetworkError } from "../net/outbound.js";
import { createZepReadFetcher, rateLimitWords, ZepRateWindow } from "./zep-sdk-fetch.js";
import { systemClock } from "./clock.js";
import type { ProviderRateWindow } from "./provider.js";
import { observe, type IngestionObserver } from "./ingestion-debug.js";
import { zepEpisodeRequest, zepFactRequest, zepGraphId, zepRoomGraphId, ZEP_EPISODE_MAX_CHARS } from "./zep-payload.js";
import { createZepOriginalMessageWritePort, prepareZepEpisode, prepareZepFact, ZepWriteTransport } from "./zep-delivery.js";
import { captureZepImpact } from "./zep-impact.js";
import { ZepGenerationTransport } from "./zep-generations.js";
import { GenerationError } from "./graph-generations.js";
export { ZEP_EPISODE_MAX_CHARS, zepGraphId } from "./zep-payload.js";

export const ZEP_QUERY_MAX_CHARS = 400;
export const ZEP_AUTO_MAX_CHARS = 50_000;
export const ZEP_AUTO_DEFAULT_CHARS = 12_000;


export const WORK_ONTOLOGY: Record<string, EntityType> = {
  Project: { description: "A project, product, codebase or other larger undertaking the room works on.", fields: {} },
  Task: { description: "A concrete piece of work: a task, feature, bugfix or chore someone does or plans.", fields: {} },
  Decision: { description: "A decision the room reached: what was chosen, agreed or rejected.", fields: { status: entityFields.text("standing, revised or reverted") } },
  Requirement: { description: "A requirement, constraint or rule the work must respect.", fields: {} },
  Preference: { description: "A stated preference of a participant: how they want things done.", fields: {} },
};

export interface ZepSettings {
  apiKey: string;
  baseUrl?: string;
}

export interface ZepIO {
  fetcher: NonNullable<NonNullable<ConstructorParameters<typeof ZepClient>[0]>["fetcher"]>;
  fetch: typeof fetch;
}

const CAPABILITIES: MemoryCapabilities = { graph: true, profile: false, forgetEpisode: true, factValidity: true, addFact: true, relevance: true };

function isAlreadyExists(error: unknown): boolean {
  if (!(error instanceof ZepError)) return false;
  if (error.statusCode === 409) return true;
  const body = error.body as { message?: unknown } | string | undefined;
  const message = typeof body === "string" ? body : String(body?.message ?? "");
  return error.statusCode === 400 && /already exists/i.test(message);
}

function classify(error: unknown, doing: string): MemoryProviderError {
  if (error instanceof ZepTimeoutError) return new MemoryProviderError(`Zep: ${doing} timed out`, true, { cause: error });
  if (error instanceof ZepError) {
    const status = error.statusCode ?? 0;
    const retryable = status === 429 || status >= 500 || status === 0;
    return new MemoryProviderError(`Zep: ${doing} failed (${status || "no status"}${status === 429 ? rateLimitWords(error) : ""})`, retryable, { cause: error });
  }
  return new MemoryProviderError(`Zep: ${doing} failed (${error == null ? "unknown" : describeNetworkError(error)})`, true, { cause: error });
}

export class ZepProvider implements MemoryProvider {
  readonly writes;
  readonly generations;
  readonly loadedMetadata;
  readonly recovery;
  readonly id = "zep";
  readonly capabilities = CAPABILITIES;
  private readonly client: ZepClient;
  private readonly ensured = new Set<string>();
  private readonly window = new ZepRateWindow();
  rateWindow(): ProviderRateWindow | null { return this.window.get(); }

  constructor(settings: ZepSettings, io?: ZepIO) {
    if (io && (typeof io.fetcher !== "function" || typeof io.fetch !== "function")) throw new Error("Invalid explicit Zep I/O");
    const clientSettings = { apiKey: settings.apiKey, ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
      fetcher: io ? io.fetcher : createZepReadFetcher(fetch, undefined, this.window) };
    const transportSettings = io ? { ...settings, fetcher: io.fetcher } : settings;
    const transport = new ZepWriteTransport(transportSettings, {}, io?.fetch, systemClock, this.window);
    this.writes = { transport, episode: prepareZepEpisode, fact: prepareZepFact, episodeTextLimit: ZEP_EPISODE_MAX_CHARS,
      originalMessage: createZepOriginalMessageWritePort(transport) };
    this.client = new ZepClient(clientSettings);
    this.generations = new ZepGenerationTransport(settings, this.client);
    this.loadedMetadata = Object.freeze({ provider: this.id, accountId: this.generations.account,
      readBase: settings.baseUrl ?? "https://api.getzep.com/api/v2" });
    this.recovery = { ensureCandidate: (room: MemoryRoom, signal: AbortSignal, current: () => boolean) => this.ensureRecoveryCandidate(room, signal, current) };
  }

  private async ensureRecoveryCandidate(room: MemoryRoom, signal: AbortSignal, current: () => boolean): Promise<void> {
    if (!room.graphId) throw new GenerationError("candidate_generation_required");
    const graphId = zepRoomGraphId(room);
    const check = () => { signal.throwIfAborted(); if (current() !== true) throw new GenerationError("recovery_authorization_changed"); };
    const options = { maxRetries: 0, timeoutInSeconds: 20, abortSignal: signal };
    check();
    try { await this.client.graph.create({ graphId, name: room.name, description: `viberoom recovery candidate for "${room.name}"` }, options); }
    catch (error) { if (!isAlreadyExists(error)) throw classify(error, "creating recovery candidate"); }
    check();
    try { await this.client.graph.setOntology(WORK_ONTOLOGY, {}, { graphIds: [graphId] }, options); }
    catch (error) { if (!(error instanceof ZepError && error.statusCode === 400)) throw classify(error, "setting candidate ontology"); }
    check();
  }

  async verify(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await this.client.graph.listAll({ pageSize: 1 });
      return { ok: true };
    } catch (error) {
      if (error instanceof ZepError && (error.statusCode === 401 || error.statusCode === 403)) {
        return { ok: false, reason: "Zep did not accept this API key. Keys are per project; copy the current one from the Zep dashboard." };
      }
      return { ok: false, reason: `Zep could not be reached: ${(error as Error)?.message ?? "unknown error"}` };
    }
  }

  async ensureRoom(room: MemoryRoom, beforeWrite?: () => void): Promise<void> {
    const graphId = zepRoomGraphId(room);
    if (graphId !== zepGraphId(room.uuid)) {
      if (!await this.generations.present(graphId)) throw new GenerationError("active_generation_missing", true);
      return;
    }
    if (this.ensured.has(graphId)) return;
    beforeWrite?.();
    try {
      await this.client.graph.create({ graphId, name: room.name, description: `viberoom room "${room.name}"` });
    } catch (error) {
      if (!isAlreadyExists(error)) throw classify(error, `creating graph for room "${room.name}"`);
    }
    beforeWrite?.();
    try {
      await this.client.graph.setOntology(WORK_ONTOLOGY, {}, { graphIds: [graphId] });
    } catch (error) {
      const budget = error instanceof ZepError && error.statusCode === 400;
      if (!budget) throw classify(error, `setting the ontology for room "${room.name}"`);
    }
    this.ensured.add(graphId);
  }

  async addEpisode(room: MemoryRoom, episode: MemoryEpisode, observer?: IngestionObserver, beforeWrite?: () => void): Promise<{ externalId: string | null; credits: number }> {
    beforeWrite?.();
    try {
      const request = zepEpisodeRequest(room, episode);
      observe(observer, { kind: "provider.request", sourceId: episode.sourceId, data: { operation: "graph.add", representation: "SDK arguments", request } });
      const added = await this.client.graph.add(request);
      return { externalId: added.uuid ?? null, credits: Math.max(1, Math.ceil(Buffer.byteLength(request.data, "utf8") / 350)) };
    } catch (error) {
      observe(observer, { kind: "provider.error", sourceId: episode.sourceId, data: { status: error instanceof ZepError ? error.statusCode ?? null : null, timeout: error instanceof ZepTimeoutError, retryable: classify(error, "adding episode").retryable } });
      throw classify(error, `adding message ${episode.seq ?? episode.sourceId} of room "${room.name}"`);
    }
  }

  async addFact(room: MemoryRoom, fact: MemoryFact): Promise<{ credits: number }> {
    try {
      await this.client.graph.addFactTriple(zepFactRequest(room, fact));
      return { credits: 1 };
    } catch (error) {
      throw classify(error, `writing a fact in room "${room.name}"`);
    }
  }

  captureEpisodeImpact(room: MemoryRoom, externalId: string, signal?: AbortSignal) {
    return captureZepImpact(this.client, room, externalId, signal);
  }

  async forgetEpisode(room: MemoryRoom, externalId: string): Promise<void> {
    try {
      await this.client.graph.episode.delete(externalId);
    } catch (error) {
      if (error instanceof ZepError && error.statusCode === 404) return;
      throw classify(error, `forgetting an episode of room "${room.name}"`);
    }
  }

  async forgetRoom(room: MemoryRoom): Promise<void> {
    if (zepRoomGraphId(room) !== zepGraphId(room.uuid)) throw new GenerationError("generation_retirement_protocol_unavailable");
    try {
      await this.client.graph.delete(zepGraphId(room.uuid));
      this.ensured.delete(zepGraphId(room.uuid));
    } catch (error) {
      if (error instanceof ZepError && error.statusCode === 404) { this.ensured.delete(zepGraphId(room.uuid)); return; }
      throw classify(error, `forgetting room "${room.name}"`);
    }
  }

  async search(room: MemoryRoom, query: string, _limit?: number, options: SearchOptions = {}): Promise<Recalled[]> {
    const graphId = zepRoomGraphId(room);
    const trimmed = [...query].length > ZEP_QUERY_MAX_CHARS ? [...query].slice(0, ZEP_QUERY_MAX_CHARS).join("") : query;
    const maxCharacters = Math.min(Math.max(1, Math.floor(options.maxChars ?? ZEP_AUTO_DEFAULT_CHARS)), ZEP_AUTO_MAX_CHARS);
    try {
      const results = await this.client.graph.search({ graphId, query: trimmed, scope: "auto", returnRawResults: true, maxCharacters },
        options.signal ? { abortSignal: options.signal } : undefined);
      const relevance = (item: { score?: number }) => typeof item.score === "number" ? { relevance: item.score } : {};
      const facts: Recalled[] = (results.edges ?? []).map(edge => ({
        kind: "fact" as const,
        fact: edge.fact,
        id: edge.uuid,
        episodeIds: [...new Set(edge.episodes ?? [])],
        ...(edge.validAt ? { validAt: edge.validAt } : {}),
        ...(edge.invalidAt ? { invalidAt: edge.invalidAt } : {}),
        ...relevance(edge),
      }));
      const episodes: Recalled[] = (results.episodes ?? []).map(episode => ({
        kind: "episode" as const, id: episode.uuid, episodeId: episode.uuid, text: episode.content, ...relevance(episode),
      }));
      const touching = new Map<string, Set<string>>();
      for (const edge of results.edges ?? []) for (const node of [edge.sourceNodeUuid, edge.targetNodeUuid]) {
        if (!node) continue;
        const ids = touching.get(node) ?? new Set<string>();
        for (const id of edge.episodes ?? []) ids.add(id);
        touching.set(node, ids);
      }
      const nodes: Recalled[] = [];
      let untraced = 0;
      for (const node of results.nodes ?? []) {
        const episodeIds = [...(touching.get(node.uuid) ?? [])];
        if (!episodeIds.length) { untraced++; continue; }
        nodes.push({
          kind: "node", id: node.uuid, name: node.name, summary: node.summary ?? "", episodeIds,
          ...(node.labels?.length ? { labels: [...node.labels] } : {}),
          ...(node.attributes && Object.keys(node.attributes).length ? { attributes: { ...node.attributes } } : {}),
          ...relevance(node),
        });
      }
      if (untraced) options.onOmitted?.("node_without_traced_episode", untraced);
      if (results.observations?.length) options.onOmitted?.("observation", results.observations.length);
      if (results.threadSummaries?.length) options.onOmitted?.("thread_summary", results.threadSummaries.length);
      const rank = new Map<string, number>();
      for (const item of [...results.edges ?? [], ...results.nodes ?? [], ...results.episodes ?? []]) if (item.uuid && typeof item.selectionRank === "number") rank.set(item.uuid, item.selectionRank);
      const order = (item: Recalled): number => rank.get(item.id ?? "") ?? Infinity;
      return [...facts, ...nodes, ...episodes].map((item, at) => ({ item, at })).sort((a, b) => order(a.item) - order(b.item) || a.at - b.at).map(({ item }) => item);
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (error instanceof ZepError && error.statusCode === 404) {
        if (graphId === zepGraphId(room.uuid)) return [];
        throw new GenerationError("active_generation_missing", true);
      }
      throw classify(error, `searching the memory of room "${room.name}"`);
    }
  }
}
