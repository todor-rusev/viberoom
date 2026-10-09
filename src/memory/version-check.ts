// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import type { StoredMessage } from "../history-store.js";
import { visibleToAgents } from "../quotes.js";
import type { ListedEpisode, SourceListing } from "./delivery.js";

export type VersionWait = "older_version_leaving" | "listing_incomplete" | "not_processed_yet";
export type VersionSkip = "written_before_memory" | "provider_cannot_check" | "imported_history";

export type VersionDecision =
  | { kind: "drop" }
  | { kind: "own" }
  | { kind: "wait"; reason: VersionWait }
  | { kind: "hold"; versions: string[] }
  | { kind: "bind"; episodes: ListedEpisode[] }
  | { kind: "skip"; reason: VersionSkip }
  | { kind: "send" };

export interface VersionFacts {
  row: StoredMessage | null;
  version: string;
  remembers: boolean;
  own: boolean;
  writeAllowed: boolean;
  canList: boolean;
  held: boolean;
  olderLeaving: boolean;
  listing: SourceListing | null;
  knows(carryHash: string): boolean;
  matchesCurrent?(episode: ListedEpisode): boolean;
  bornAt: number;
  inMemory: boolean;
  excluded?: boolean;
}

export const versionTime = (row: StoredMessage): number => row.edited?.ts ?? row.ts;

export function decideVersion(facts: VersionFacts): VersionDecision {
  const { row } = facts;
  if (!row || row.kind !== "chat" || row.streaming || !visibleToAgents(row) || !facts.remembers) return { kind: "drop" };
  if (facts.own) return { kind: "own" };
  if (facts.excluded) return { kind: "drop" };
  if (!facts.canList) return { kind: "skip", reason: "provider_cannot_check" };
  if (facts.writeAllowed && facts.olderLeaving) return { kind: "wait", reason: "older_version_leaving" };
  if (facts.held) return { kind: "drop" };
  if (facts.listing?.state !== "complete") return { kind: "wait", reason: "listing_incomplete" };
  const listed = (facts.listing.bySource.get(row.id) ?? []).filter(episode => episode.kind === "message");
  const matches = (episode: ListedEpisode) => facts.matchesCurrent?.(episode) ?? episode.version === facts.version;
  const same = listed.filter(matches);
  if (same.length) {
    const canonical = canonicalParts(same);
    return canonical ? { kind: "bind", episodes: canonical } : { kind: "wait", reason: "not_processed_yet" };
  }
  const others = listed.filter(episode => !matches(episode));
  const unknown = others.filter(episode => !episode.carryHash || !facts.knows(episode.carryHash));
  if (unknown.length) return { kind: "hold", versions: [...new Set(unknown.map(episode => episode.version))].sort() };
  if (!facts.writeAllowed) return { kind: "skip", reason: "imported_history" };
  if (versionTime(row) < facts.bornAt && !facts.inMemory && !others.length) return { kind: "skip", reason: "written_before_memory" };
  return { kind: "send" };
}

export function canonicalParts(episodes: readonly ListedEpisode[]): ListedEpisode[] | null {
  const byPart = new Map<string, ListedEpisode[]>();
  for (const episode of episodes) byPart.set(episode.part, [...byPart.get(episode.part) ?? [], episode]);
  const total = partCount([...byPart.keys()]);
  if (total === null) return null;
  const chosen: ListedEpisode[] = [];
  for (let n = 1; n <= total; n++) {
    const processed = (byPart.get(`${n}/${total}`) ?? []).filter(episode => episode.processed).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (!processed.length) return null;
    chosen.push(processed[0]);
  }
  return chosen;
}

function partCount(parts: string[]): number | null {
  const totals = new Set(parts.map(part => /^(\d+)\/(\d+)$/.exec(part)?.[2] ?? "invalid"));
  if (totals.size !== 1 || totals.has("invalid")) return null;
  const total = Number([...totals][0]);
  return Number.isSafeInteger(total) && total >= 1 && total <= 64 && parts.every(part => {
    const n = Number(part.split("/")[0]); return Number.isSafeInteger(n) && n >= 1 && n <= total;
  }) ? total : null;
}
