// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { performance } from "node:perf_hooks";

export const THREAD_TICK_MS = 250;

export const THREAD_HELD_MS = 1000;

export const LONG_GAP_MS = 120_000;
export type ThreadGapKind = "late-tick" | "long-gap";

export function heldFor(previousAt: number, now: number, tickMs = THREAD_TICK_MS): number {
  return Math.max(0, now - previousAt - tickMs);
}

export interface ThreadWatchOptions {
  tickMs?: number;
  heldMs?: number;
  longGapMs?: number;
  now?: () => number;
}

export function watchThread(report: (heldMs: number, kind: ThreadGapKind) => void, options: ThreadWatchOptions = {}): () => void {
  const tick = options.tickMs ?? THREAD_TICK_MS;
  const threshold = options.heldMs ?? THREAD_HELD_MS;
  const longGap = options.longGapMs ?? LONG_GAP_MS;
  const now = options.now ?? (() => performance.now());
  let previous = now();
  const timer = setInterval(() => {
    const at = now();
    const held = heldFor(previous, at, tick);
    previous = at;
    if (held >= threshold) {
      try {
        report(Math.round(held), held >= longGap ? "long-gap" : "late-tick");
      } catch {
      }
    }
  }, tick);
  timer.unref?.();
  return () => clearInterval(timer);
}
