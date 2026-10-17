// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export interface WakeInput {
  readonly author: { readonly id: string; readonly human: boolean };
  readonly addressed: readonly string[];
  readonly live: readonly string[];
  readonly skillHolders?: readonly string[];
  readonly agentsWakeEachOther: boolean;
  readonly focused: boolean;
  readonly hops: number;
  readonly hopLimit: number;
}

export interface WakeDecision {
  readonly wanted: readonly string[];
  readonly hop: "reset" | "take" | "limit" | "none";
  readonly broadcast: boolean;
  readonly skillMissing: boolean;
}

export function woken(decision: WakeDecision): readonly string[] {
  return decision.hop === "limit" ? [] : decision.wanted;
}

export function decideWake(input: WakeInput): WakeDecision {
  const live = new Set(input.live);
  const others = input.live.filter((id) => id !== input.author.id);
  const broadcast = input.addressed.length === 0;
  const addressedLive = input.addressed.filter((id) => live.has(id) && id !== input.author.id);
  if (input.author.human) {
    let wanted: readonly string[] = broadcast ? others : addressedLive;
    const skillHolders = input.skillHolders;
    if (skillHolders) {
      if (broadcast) wanted = wanted.filter((id) => skillHolders.includes(id));
      if (!wanted.length && broadcast && others.length === 1) wanted = others;
    }
    return { wanted, hop: "reset", broadcast, skillMissing: !!skillHolders && !wanted.length };
  }
  if (input.focused) return { wanted: [], hop: "none", broadcast, skillMissing: false };
  const wanted = addressedLive.length ? addressedLive : !broadcast ? [] : input.agentsWakeEachOther ? others : [];
  const hop = !wanted.length ? "none" : input.hops >= input.hopLimit ? "limit" : "take";
  return { wanted, hop, broadcast, skillMissing: false };
}
