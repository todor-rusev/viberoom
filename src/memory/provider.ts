// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export interface MemoryCapabilities {
  graph: boolean;
  profile: boolean;
  forgetEpisode: boolean;
  factValidity: boolean;
  addFact: boolean;
  relevance: boolean;
}

export interface MemoryRoom {
  uuid: string;
  name: string;
}

export interface MemoryEpisode {
  sourceId: string;
  seq?: number;
  authorId: string;
  authorName: string;
  text: string;
  ts: number;
}

export interface MemoryFact {
  subject: string;
  predicate: string;
  object: string;
  ts: number;
}

export interface RecalledFact {
  fact: string;
  validAt?: string;
  invalidAt?: string;
  relevance?: number;
  room?: string;
}

export class MemoryProviderError extends Error {
  constructor(message: string, readonly retryable: boolean, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MemoryProviderError";
  }
}

export interface MemoryProvider {
  readonly id: string;
  readonly capabilities: MemoryCapabilities;
  readonly editWindowMs?: number;
  verify(): Promise<{ ok: true } | { ok: false; reason: string }>;
  ensureRoom(room: MemoryRoom): Promise<void>;
  addEpisode(room: MemoryRoom, episode: MemoryEpisode): Promise<{ externalId: string | null; credits: number }>;
  addFact(room: MemoryRoom, fact: MemoryFact): Promise<{ credits: number }>;
  forgetEpisode(room: MemoryRoom, externalId: string): Promise<void>;
  forgetRoom(room: MemoryRoom): Promise<void>;
  search(room: MemoryRoom, query: string, limit?: number): Promise<RecalledFact[]>;
}
