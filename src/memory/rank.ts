// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import type { Recalled } from "./provider.js";

export const RELEVANCE_TIE = 0.01;

export function rankRecalled(answers: Recalled[][], scored: boolean, floor: number, own = 1): Recalled[] {
  const level = (item: Recalled): number => scored ? item.relevance ?? 0 : 0;
  const isFact = (item: Recalled): boolean => item.kind !== "episode" && item.kind !== "node";
  type Run = { key: number; level: number; items: Recalled[] };
  const queues = answers.map((items, source) => {
    const runs: Run[] = [];
    const leading: Recalled[] = [];
    for (const item of items) {
      if (isFact(item)) {
        if (scored && source >= own && level(item) < floor) continue;
        runs.push({ key: Math.round(level(item) / RELEVANCE_TIE), level: level(item), items: [item] });
      } else if (runs.length) runs[runs.length - 1].items.push(item);
      else leading.push(item);
    }
    if (!leading.length) return { source, runs };
    if (source >= own && runs.length) runs[0].items.unshift(...leading);
    else runs.unshift({ key: !scored ? 0 : source < own ? Infinity : -Infinity, level: 0, items: leading });
    return { source, runs };
  });
  const ranked: Recalled[] = [];
  for (;;) {
    let next: (typeof queues)[number] | undefined;
    for (const queue of queues) {
      if (!queue.runs.length) continue;
      if (!next) { next = queue; continue; }
      const a = queue.runs[0], b = next.runs[0];
      const better = a.key - b.key
        || Number(next.source >= own) - Number(queue.source >= own)
        || a.level - b.level;
      if (better > 0) next = queue;
    }
    if (!next) break;
    ranked.push(...next.runs.shift()!.items);
  }
  const told = new Map<string, Recalled>();
  for (const item of ranked) {
    const key = identity(item);
    const previous = told.get(key);
    if (!previous) { told.set(key, { ...item }); continue; }
    const evidence = new Map<string, NonNullable<Recalled["evidence"]>[number]>();
    for (const link of [...previous.evidence ?? [], ...item.evidence ?? []]) {
      const key = JSON.stringify([link.provider, link.roomId, link.roomUuid, link.factIds, link.nodeIds ?? null, link.factIds.length || link.nodeIds?.length ? null : link.episodeIds]);
      const old = evidence.get(key);
      evidence.set(key, old ? { ...old, episodeIds: [...new Set([...old.episodeIds, ...link.episodeIds])] } : link);
    }
    previous.evidence = [...evidence.values()];
  }
  return [...told.values()];
}

function identity(item: Recalled): string {
  const words = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();
  if (item.kind === "episode") return JSON.stringify(["episode", item.episodeId]);
  if (item.kind === "node") return JSON.stringify(["node", words(item.name), words(item.summary), [...item.labels ?? []].sort(), canonical(item.attributes ?? {})]);
  return JSON.stringify(["fact", words(item.fact), item.validAt, item.invalidAt]);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
