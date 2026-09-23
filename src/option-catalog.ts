// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { DiscoveredOptions } from "./room.js";

export const OPTIONS_MAX_AGE_MS = 30 * 60_000;

export interface OptionCatalogOptions {
  now?: () => number;
  maxAgeMs?: number;
}

export class OptionCatalog {
  private readonly known = new Map<string, DiscoveredOptions>();
  private readonly running = new Map<string, { stamp: string | null; probe: Promise<DiscoveredOptions> }>();
  private readonly started = new Map<string, number>();
  private probes = 0;
  private readonly now: () => number;
  private readonly maxAgeMs: number;
  constructor(options: OptionCatalogOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxAgeMs = options.maxAgeMs ?? OPTIONS_MAX_AGE_MS;
  }

  fresh(recipeId: string, stamp: string | null): DiscoveredOptions | undefined {
    const info = this.known.get(recipeId);
    if (!info || info.installStamp !== stamp) return undefined;
    return this.now() - info.discoveredAt < this.maxAgeMs ? info : undefined;
  }

  async get(recipeId: string, stamp: string | null, refresh: boolean, probe: () => Promise<DiscoveredOptions>): Promise<DiscoveredOptions> {
    if (!refresh) { const kept = this.fresh(recipeId, stamp); if (kept) return kept; }
    const inFlight = this.running.get(recipeId);
    if (inFlight && inFlight.stamp === stamp) return inFlight.probe;
    const ticket = ++this.probes;
    this.started.set(recipeId, ticket);
    const run = probe().then(info => {
      const answer: DiscoveredOptions = { ...info, installStamp: stamp };
      if (this.started.get(recipeId) === ticket) this.known.set(recipeId, answer);
      return answer;
    });
    this.running.set(recipeId, { stamp, probe: run });
    try { return await run; } finally { if (this.running.get(recipeId)?.probe === run) this.running.delete(recipeId); }
  }

  forget(recipeId: string): void { this.known.delete(recipeId); this.running.delete(recipeId); this.started.set(recipeId, ++this.probes); }
}
