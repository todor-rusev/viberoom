// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { RecoveryInventory } from "./recovery-sources.js";

export interface RecoveryKnowledgeEpisode {
  id: string; content: string; createdAt: string; source?: string; sourceDescription?: string;
  metadata: Record<string, unknown> | null; processed: boolean;
}
export interface RecoveryKnowledgeEdge {
  id: string; fact: string; name: string; createdAt: string; sourceNodeId: string; targetNodeId: string;
  episodeIds: string[]; validAt: string | null; invalidAt: string | null; expiredAt: string | null;
  attributes: Record<string, unknown>; scope: string | null;
}
export interface RecoveryKnowledgeNode {
  id: string; name: string; summary: string; createdAt: string; labels: string[]; attributes: Record<string, unknown>;
}
export type RecoveryKnowledge = { state: "complete"; graphId: string; inventory: Extract<RecoveryInventory, { state: "complete" }>;
  episodes: RecoveryKnowledgeEpisode[]; edges: RecoveryKnowledgeEdge[]; nodes: RecoveryKnowledgeNode[];
  fingerprint: string; startedAt: number; finishedAt: number }
  | { state: "unknown"; reason: string; startedAt: number; finishedAt: number };

export interface RecoveryKnowledgeReader {
  recoveryKnowledge(uuid: string, graphId: string, signal: AbortSignal, now: () => number): Promise<RecoveryKnowledge>;
}
