// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import type { IngestionObserver } from "./ingestion-debug.js";
import type { WriteIdentity, WritePayload, WriteTransport } from "./delivery.js";
import type { EpisodeImpact } from "./impact.js";
import type { GenerationTransport } from "./graph-generations.js";
import type { OriginalMessageWritePort } from "./original-message-preparation.js";

export interface MemoryWriteAdapter {
  transport: WriteTransport;
  episodeTextLimit?: number;
  originalMessage?: OriginalMessageWritePort;
  episode(identity: WriteIdentity, opId: string, room: MemoryRoom, episode: MemoryEpisode, kind: "message" | "note"): WritePayload;
  fact(identity: WriteIdentity, opId: string, room: MemoryRoom, fact: MemoryFact): WritePayload;
}

export interface LoadedTrialPreparation {
  readonly id: "zep";
  readonly loadedRevision: string;
  readonly generations: Readonly<{ account: string }>;
  readonly writes: Readonly<Pick<MemoryWriteAdapter, "episode" | "episodeTextLimit" | "originalMessage">>;
}
export const SEARCH_GIVE_UP_MS = 20_000;

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
  graphId?: string;
}

export interface MemoryEpisode {
  sourceId: string;
  seq?: number;
  authorId: string;
  authorName: string;
  text: string;
  ts: number;
  carryHash?: string;
}

export interface MemoryFact {
  subject: string;
  predicate: string;
  object: string;
  ts: number;
}

export interface FactEvidence {
  provider: string;
  roomId: string;
  roomUuid: string;
  graphId?: string;
  generationRevision?: string;
  factIds: string[];
  nodeIds?: string[];
  episodeIds: string[];
}

export interface EpisodeSource {
  kind: "message" | "note";
  graphId?: string;
  version?: string;
  authorId: string;
  authorName: string;
  ts: number;
  origin?: string;
  boundCopy?: string;
}

export interface RecalledSource {
  status: "available" | "version_unknown" | "unavailable" | "note";
  roomId: string;
  roomUuid: string;
  roomName: string;
  episodeIds: string[];
  messageId?: string;
  seq?: number;
  version?: string;
  authorId?: string;
  authorName?: string;
  writtenAt?: string;
  originCopy?: string;
  noteId?: string;
}

export type Recalled = RecalledFact | RecalledEpisode | RecalledNode;

interface RecalledCommon {
  id?: string;
  evidence?: FactEvidence[];
  sources?: RecalledSource[];
  verification?: "source_changed" | "end_unverified";
  untraced?: true;
  relevance?: number;
  room?: string;
}

export interface RecalledEpisode extends RecalledCommon {
  kind: "episode";
  episodeId: string;
  text: string;
}

export interface RecalledNode extends RecalledCommon {
  kind: "node";
  name: string;
  summary: string;
  labels?: string[];
  attributes?: Record<string, unknown>;
  episodeIds: string[];
}

export interface SearchOptions {
  signal?: AbortSignal;
  maxChars?: number;
  onOmitted?: (kind: string, count: number) => void;
}

export function isFact(item: Recalled): item is RecalledFact {
  return item.kind === undefined || item.kind === "fact";
}

export function factOf(item: Recalled): RecalledFact {
  if (!isFact(item)) throw new Error(`expected a recalled fact, got a ${item.kind}`);
  return item;
}

export function recalledEpisodeIds(item: Recalled): string[] {
  if (item.kind === "episode") return [item.episodeId];
  return item.episodeIds ?? [];
}

export interface RecalledFact extends RecalledCommon {
  kind?: "fact";
  fact: string;
  episodeIds?: string[];
  validAt?: string;
  invalidAt?: string;
}

export class MemoryProviderError extends Error {
  constructor(message: string, readonly retryable: boolean, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MemoryProviderError";
  }
}

export class MemoryWriteCancelled extends Error {
  constructor() { super("Memory write authority changed before dispatch"); this.name = "MemoryWriteCancelled"; }
}

export interface ProviderRateWindow {
  limit: number | null;
  remaining: number | null;
  resetAt: number | null;
  retryAfterMs: number | null;
  status: number;
  at: number;
}

export interface MemoryProvider {
  readonly loadedMetadata?: Readonly<{ provider: string; accountId: string; readBase: string }>;
  rateWindow?(): ProviderRateWindow | null;
  readonly generations?: GenerationTransport;
  readonly recovery?: { ensureCandidate(room: MemoryRoom, signal: AbortSignal, current: () => boolean): Promise<void> };
  captureEpisodeImpact?(room: MemoryRoom, externalId: string, signal?: AbortSignal): Promise<EpisodeImpact>;
  readonly writes?: MemoryWriteAdapter;
  readonly id: string;
  readonly capabilities: MemoryCapabilities;
  readonly editWindowMs?: number;
  verify(): Promise<{ ok: true } | { ok: false; reason: string }>;
  ensureRoom(room: MemoryRoom, beforeWrite?: () => void): Promise<void>;
  addEpisode(room: MemoryRoom, episode: MemoryEpisode, observer?: IngestionObserver, beforeWrite?: () => void): Promise<{ externalId: string | null; credits: number }>;
  addFact(room: MemoryRoom, fact: MemoryFact): Promise<{ credits: number }>;
  forgetEpisode(room: MemoryRoom, externalId: string): Promise<void>;
  forgetRoom(room: MemoryRoom): Promise<void>;
  search(room: MemoryRoom, query: string, limit?: number, options?: SearchOptions): Promise<Recalled[]>;
}
