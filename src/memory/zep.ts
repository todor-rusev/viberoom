// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { ZepClient, ZepError, ZepTimeoutError, entityFields, type EntityType } from "@getzep/zep-cloud";
import { MemoryProviderError, type MemoryCapabilities, type MemoryEpisode, type MemoryFact, type MemoryProvider, type MemoryRoom, type RecalledFact } from "./provider.js";
import { describeNetworkError } from "../net/outbound.js";

export const ZEP_EPISODE_MAX_CHARS = 9_000;
export const ZEP_QUERY_MAX_CHARS = 400;
export const ZEP_SEARCH_MAX_LIMIT = 50;

export const zepGraphId = (roomUuid: string) => `viberoom-${roomUuid}`;

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
    return new MemoryProviderError(`Zep: ${doing} failed (${status || "no status"})`, retryable, { cause: error });
  }
  return new MemoryProviderError(`Zep: ${doing} failed (${error == null ? "unknown" : describeNetworkError(error)})`, true, { cause: error });
}

export class ZepProvider implements MemoryProvider {
  readonly id = "zep";
  readonly capabilities = CAPABILITIES;
  private readonly client: ZepClient;
  private readonly ensured = new Set<string>();

  constructor(settings: ZepSettings) {
    this.client = new ZepClient({ apiKey: settings.apiKey, ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}) });
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

  async ensureRoom(room: MemoryRoom): Promise<void> {
    if (this.ensured.has(room.uuid)) return;
    const graphId = zepGraphId(room.uuid);
    try {
      await this.client.graph.create({ graphId, name: room.name, description: `viberoom room "${room.name}"` });
    } catch (error) {
      if (!isAlreadyExists(error)) throw classify(error, `creating graph for room "${room.name}"`);
    }
    try {
      await this.client.graph.setOntology(WORK_ONTOLOGY, {}, { graphIds: [graphId] });
    } catch (error) {
      const budget = error instanceof ZepError && error.statusCode === 400;
      if (!budget) throw classify(error, `setting the ontology for room "${room.name}"`);
    }
    this.ensured.add(room.uuid);
  }

  async addEpisode(room: MemoryRoom, episode: MemoryEpisode): Promise<{ externalId: string | null; credits: number }> {
    const speaker = `${episode.authorName} [${episode.authorId}]`;
    const body = [...episode.text].length > ZEP_EPISODE_MAX_CHARS
      ? [...episode.text].slice(0, ZEP_EPISODE_MAX_CHARS).join("") + " […]"
      : episode.text;
    const data = `${speaker}: ${body}`;
    try {
      const added = await this.client.graph.add({
        graphId: zepGraphId(room.uuid),
        type: "message",
        data,
        createdAt: new Date(episode.ts).toISOString(),
        sourceDescription: `viberoom room "${room.name}"${episode.seq ? `, message ${episode.seq}` : ", explicit note"}`,
      });
      return { externalId: added.uuid ?? null, credits: Math.max(1, Math.ceil(Buffer.byteLength(data, "utf8") / 350)) };
    } catch (error) {
      throw classify(error, `adding message ${episode.seq ?? episode.sourceId} of room "${room.name}"`);
    }
  }

  async addFact(room: MemoryRoom, fact: MemoryFact): Promise<{ credits: number }> {
    try {
      await this.client.graph.addFactTriple({
        graphId: zepGraphId(room.uuid),
        fact: `${fact.subject} ${fact.predicate} ${fact.object}`,
        factName: fact.predicate.toUpperCase().replace(/[^\p{Lu}\p{N}]+/gu, "_").slice(0, 50) || "RELATES_TO",
        sourceNodeName: fact.subject,
        targetNodeName: fact.object,
        createdAt: new Date(fact.ts).toISOString(),
        validAt: new Date(fact.ts).toISOString(),
      });
      return { credits: 1 };
    } catch (error) {
      throw classify(error, `writing a fact in room "${room.name}"`);
    }
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
    try {
      await this.client.graph.delete(zepGraphId(room.uuid));
      this.ensured.delete(room.uuid);
    } catch (error) {
      if (error instanceof ZepError && error.statusCode === 404) { this.ensured.delete(room.uuid); return; }
      throw classify(error, `forgetting room "${room.name}"`);
    }
  }

  async search(room: MemoryRoom, query: string, limit = 12): Promise<RecalledFact[]> {
    const trimmed = [...query].length > ZEP_QUERY_MAX_CHARS ? [...query].slice(0, ZEP_QUERY_MAX_CHARS).join("") : query;
    try {
      const results = await this.client.graph.search({ graphId: zepGraphId(room.uuid), query: trimmed, scope: "edges", limit: Math.min(limit, ZEP_SEARCH_MAX_LIMIT), reranker: "cross_encoder" });
      return (results.edges ?? []).map(edge => ({
        fact: edge.fact,
        ...(edge.validAt ? { validAt: edge.validAt } : {}),
        ...(edge.invalidAt ? { invalidAt: edge.invalidAt } : {}),
        ...(typeof edge.score === "number" ? { relevance: edge.score } : {}),
      }));
    } catch (error) {
      if (error instanceof ZepError && error.statusCode === 404) return [];
      throw classify(error, `searching the memory of room "${room.name}"`);
    }
  }
}
