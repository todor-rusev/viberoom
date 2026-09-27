// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import type { RecalledFact } from "./provider.js";

export const RELEVANCE_TIE = 0.01;

export function rankRecalled(answers: RecalledFact[][], scored: boolean, floor: number): RecalledFact[] {
  const entries = answers.flatMap((facts, source) => facts.map((fact, at) => ({ fact, source, at, level: scored ? fact.relevance ?? 0 : 0 })));
  const kept = scored ? entries.filter((entry) => entry.level >= floor) : entries;
  const tier = (level: number): number => Math.round(level / RELEVANCE_TIE);
  kept.sort((a, b) =>
    tier(b.level) - tier(a.level)
    || Number(a.source !== 0) - Number(b.source !== 0)
    || b.level - a.level
    || a.source - b.source
    || a.at - b.at);
  const told = new Set<string>();
  return kept.filter(({ fact }) => {
    const key = fact.fact.trim().replace(/\s+/g, " ").toLowerCase();
    if (told.has(key)) return false;
    told.add(key);
    return true;
  }).map(({ fact }) => fact);
}
