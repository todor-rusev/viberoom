// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { ConnectionError, Honcho, HonchoError, RateLimitError, ServerError, TimeoutError, type Session } from "@honcho-ai/sdk";
import { MemoryProviderError, MemoryWriteCancelled, SEARCH_GIVE_UP_MS, type MemoryCapabilities, type MemoryEpisode, type MemoryFact, type MemoryProvider, type MemoryRoom, type RecalledFact, type SearchOptions } from "./provider.js";
import type { IngestionObserver } from "./ingestion-debug.js";

export const honchoSessionId = (roomUuid: string) => `viberoom-${roomUuid}`;

export interface HonchoSettings {
  apiKey: string;
  workspaceId: string;
  baseUrl?: string;
}

const HONCHO_SEARCH_MAX_LIMIT = 100;
const CAPABILITIES: MemoryCapabilities = { graph: false, profile: true, forgetEpisode: false, factValidity: false, addFact: false, relevance: false };

function classify(error: unknown, doing: string): MemoryProviderError {
  if (error instanceof RateLimitError || error instanceof ServerError || error instanceof TimeoutError || error instanceof ConnectionError) {
    return new MemoryProviderError(`Honcho: ${doing} failed (${(error as Error).message})`, true, { cause: error });
  }
  if (error instanceof HonchoError) return new MemoryProviderError(`Honcho: ${doing} failed (${error.status})`, false, { cause: error });
  return new MemoryProviderError(`Honcho: ${doing} failed (${(error as Error)?.message ?? "unknown"})`, true, { cause: error });
}

export class HonchoProvider implements MemoryProvider {
  readonly id = "honcho";
  readonly capabilities = CAPABILITIES;
  readonly editWindowMs = 10 * 60_000;
  private readonly client: Honcho;
  private readonly reader: Honcho;
  private readonly sessions = new Map<string, { session: Session; peers: Set<string> }>();
  private readonly readerSessions = new Map<string, Promise<Session>>();

  constructor(settings: HonchoSettings) {
    const where = { apiKey: settings.apiKey, workspaceId: settings.workspaceId, ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}) };
    this.client = new Honcho(where);
    this.reader = new Honcho({ ...where, timeout: SEARCH_GIVE_UP_MS, maxRetries: 0 });
  }

  async verify(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await this.client.peers({ size: 1 });
      return { ok: true };
    } catch (error) {
      if (error instanceof HonchoError && (error.status === 401 || error.status === 403)) {
        return { ok: false, reason: "Honcho did not accept this API key. Copy the current hch-… key from app.honcho.dev." };
      }
      return { ok: false, reason: `Honcho could not be reached: ${(error as Error)?.message ?? "unknown error"}` };
    }
  }

  async ensureRoom(room: MemoryRoom, beforeWrite?: () => void): Promise<void> {
    if (this.sessions.has(room.uuid)) return;
    beforeWrite?.();
    try {
      const session = await this.client.session(honchoSessionId(room.uuid), { metadata: { room: room.name, source: "viberoom" } });
      this.sessions.set(room.uuid, { session, peers: new Set() });
    } catch (error) {
      throw classify(error, `opening the session of room "${room.name}"`);
    }
  }

  private async sessionOf(room: MemoryRoom, beforeWrite?: () => void): Promise<{ session: Session; peers: Set<string> }> {
    await this.ensureRoom(room, beforeWrite);
    beforeWrite?.();
    return this.sessions.get(room.uuid)!;
  }

  async addEpisode(room: MemoryRoom, episode: MemoryEpisode, _observer?: IngestionObserver, beforeWrite?: () => void): Promise<{ externalId: string | null; credits: number }> {
    try {
      const { session, peers } = await this.sessionOf(room, beforeWrite);
      if (!peers.has(episode.authorId)) {
        beforeWrite?.();
        await session.addPeers([episode.authorId]);
        peers.add(episode.authorId);
      }
      beforeWrite?.();
      const added = await session.addMessages({
        peerId: episode.authorId,
        content: episode.text,
        createdAt: new Date(episode.ts).toISOString(),
        metadata: { ...(episode.seq ? { seq: episode.seq } : {}), sourceId: episode.sourceId, authorName: episode.authorName },
      });
      const credits = added.reduce((sum, m) => sum + (m.tokenCount || 0), 0);
      return { externalId: added[0]?.id ?? null, credits };
    } catch (error) {
      if (error instanceof MemoryWriteCancelled) throw error;
      throw classify(error, `adding message ${episode.seq ?? episode.sourceId} of room "${room.name}"`);
    }
  }

  async addFact(): Promise<{ credits: number }> {
    throw new MemoryProviderError("Honcho keeps no verbatim fact triples (capability addFact: false)", false);
  }

  async forgetEpisode(): Promise<void> {
    throw new MemoryProviderError("Honcho cannot forget one episode (capability forgetEpisode: false)", false);
  }

  async forgetRoom(room: MemoryRoom): Promise<void> {
    try {
      const { session } = await this.sessionOf(room);
      await session.delete();
      this.sessions.delete(room.uuid);
      this.readerSessions.delete(room.uuid);
    } catch (error) {
      if (error instanceof HonchoError && error.status === 404) { this.sessions.delete(room.uuid); this.readerSessions.delete(room.uuid); return; }
      throw classify(error, `forgetting room "${room.name}"`);
    }
  }

  async search(room: MemoryRoom, query: string, limit = 12, options: SearchOptions = {}): Promise<RecalledFact[]> {
    try {
      const searching = (async () => (await this.readerSession(room)).search(query, { limit: Math.min(limit, HONCHO_SEARCH_MAX_LIMIT) }))();
      const messages = await (options.signal ? untilGivenUp(searching, options.signal) : searching);
      return messages.map((m) => ({ fact: m.content }));
    } catch (error) {
      if (options.signal?.aborted && error === options.signal.reason) throw error;
      throw classify(error, `searching the memory of room "${room.name}"`);
    }
  }

  private readerSession(room: MemoryRoom): Promise<Session> {
    let opening = this.readerSessions.get(room.uuid);
    if (!opening) {
      opening = this.reader.session(honchoSessionId(room.uuid), { metadata: { room: room.name, source: "viberoom" } });
      opening.catch(() => this.readerSessions.delete(room.uuid));
      this.readerSessions.set(room.uuid, opening);
    }
    return opening;
  }
}

function untilGivenUp<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { work.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise<T>((resolve, reject) => {
    const giveUp = () => { work.catch(() => {}); reject(signal.reason); };
    signal.addEventListener("abort", giveUp, { once: true });
    work.then(
      (value) => { signal.removeEventListener("abort", giveUp); resolve(value); },
      (error) => { signal.removeEventListener("abort", giveUp); reject(error); },
    );
  });
}
