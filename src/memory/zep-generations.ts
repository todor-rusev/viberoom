// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash } from "node:crypto";
import { ZepClient, ZepError } from "@getzep/zep-cloud";
import { GenerationError, baseGenerationId, generationOwner, generationPointer, type GenerationRoute, type GenerationTransport } from "./graph-generations.js";
import { MemoryProviderError } from "./provider.js";
import { rateLimitWords } from "./zep-sdk-fetch.js";

export class ZepGenerationTransport implements GenerationTransport {
  readonly account: string;
  private readonly client: ZepClient;
  constructor(settings: { apiKey: string; baseUrl?: string }, client?: ZepClient) {
    this.client = client ?? new ZepClient(settings);
    this.account = `sha256:${createHash("sha256").update(JSON.stringify([settings.baseUrl ?? "https://api.getzep.com/api/v2", settings.apiKey])).digest("hex")}`;
  }
  private async request<T>(signal: AbortSignal | undefined, work: (options: { maxRetries: number; timeoutInSeconds: number; abortSignal: AbortSignal }) => Promise<T>): Promise<T> {
    const timeout = AbortSignal.timeout(20_000), abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    abortSignal.throwIfAborted();
    try { const value = await work({ maxRetries: 0, timeoutInSeconds: 20, abortSignal }); abortSignal.throwIfAborted(); return value; }
    catch (error) {
      if (error instanceof GenerationError) throw error;
      const code = error instanceof ZepError ? error.statusCode ?? null : null;
      throw new MemoryProviderError(`Zep graph coordination failed (${code ?? "transport"}${code === 429 ? rateLimitWords(error) : ""})`, code === null || code === 408 || code === 429 || code >= 500);
    }
  }
  readAnchor(uuid: string, signal?: AbortSignal): Promise<{ description: string | null } | null> {
    return this.request(signal, async options => {
      try {
        const graph = await this.client.graph.get(baseGenerationId(uuid), options);
        if (graph.description !== undefined && typeof graph.description !== "string") throw new GenerationError("invalid_generation_pointer");
        return { description: graph.description ?? null };
      } catch (error) { if (error instanceof ZepError && error.statusCode === 404) return null; throw error; }
    });
  }
  present(graphId: string, signal?: AbortSignal): Promise<boolean> {
    return this.request(signal, async options => {
      try { await this.client.graph.get(graphId, options); return true; }
      catch (error) { if (error instanceof ZepError && error.statusCode === 404) return false; throw error; }
    });
  }
  point(uuid: string, route: GenerationRoute, signal?: AbortSignal): Promise<void> {
    const description = generationPointer(uuid, route);
    return this.request(signal, async options => { await this.client.graph.update(baseGenerationId(uuid), { description }, options); });
  }
  list(uuid: string, signal?: AbortSignal): Promise<string[]> {
    baseGenerationId(uuid);
    return this.request(signal, async options => {
      const found: string[] = [], seen = new Set<string>();
      let expectedTotal: number | undefined;
      for (let pageNumber = 1; pageNumber <= 100; pageNumber++) {
        options.abortSignal.throwIfAborted();
        const { data, rawResponse } = await this.client.graph.listAll({ pageNumber, pageSize: 100, orderBy: "created_at", asc: true }, options).withRawResponse();
        const truncated = rawResponse.headers.get("zep-truncated");
        if (truncated && !["false", "0"].includes(truncated.toLowerCase())) throw new GenerationError("generation_listing_truncated", true);
        if (!Array.isArray(data.graphs) || data.graphs.length > 100 || data.pageNumber !== undefined && data.pageNumber !== pageNumber
          || data.rowCount !== undefined && data.rowCount !== data.graphs.length || data.pageSize !== undefined && data.pageSize !== 100) throw new GenerationError("generation_listing_invalid", true);
        if (data.totalCount !== undefined) {
          if (!Number.isSafeInteger(data.totalCount) || data.totalCount < 0 || expectedTotal !== undefined && data.totalCount !== expectedTotal) throw new GenerationError("generation_listing_changed", true);
          expectedTotal = data.totalCount;
        }
        for (const graph of data.graphs) {
          const id = graph.graphId;
          if (typeof id !== "string" || !id || seen.has(id)) throw new GenerationError("generation_listing_changed", true);
          seen.add(id); if (generationOwner(uuid, id)) found.push(id);
        }
        if (data.graphs.length < 100) {
          if (expectedTotal !== undefined && expectedTotal !== seen.size) throw new GenerationError("generation_listing_incomplete", true);
          return found;
        }
      }
      throw new GenerationError("generation_listing_budget_exhausted", true);
    });
  }
}
