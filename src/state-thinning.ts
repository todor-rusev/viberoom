// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { HubEvent } from "./hub.js";

export const GAP_MS = 250;

function keyOf(event: HubEvent): string | null {
  if (event.type !== "room.event") return null;
  const inner = event.event as { type?: string; participant?: { id?: string } };
  if (inner.type === "participant") return `${event.roomId}:participant:${inner.participant?.id ?? ""}`;
  if (inner.type === "room") return `${event.roomId}:room`;
  return null;
}

export interface StateThinner {
  send(event: HubEvent): void;
  flush(): void;
  stop(): void;
}

export function thinState(out: (event: HubEvent) => void, options: { gapMs?: number; now?: () => number; timer?: (fn: () => void, ms: number) => { unref?: () => void } } = {}): StateThinner {
  const gap = options.gapMs ?? GAP_MS;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.timer ?? ((fn, ms) => setTimeout(fn, ms));
  const held = new Map<string, HubEvent>();
  const lastSent = new Map<string, number>();
  let waiting: { unref?: () => void } | null = null;

  const flush = (): void => {
    waiting = null;
    if (!held.size) return;
    const going = [...held.entries()];
    held.clear();
    const at = now();
    for (const [key, event] of going) {
      lastSent.set(key, at);
      out(event);
    }
  };

  const arm = (ms: number): void => {
    if (waiting) return;
    waiting = setTimer(() => flush(), Math.max(0, ms));
    waiting.unref?.();
  };

  return {
    send(event: HubEvent): void {
      const key = keyOf(event);
      if (key === null) {
        out(event);
        return;
      }
      const since = now() - (lastSent.get(key) ?? -Infinity);
      if (!held.has(key) && since >= gap) {
        lastSent.set(key, now());
        out(event);
        return;
      }
      held.set(key, event);
      arm(gap - since);
    },
    flush,
    stop(): void {
      flush();
      waiting = null;
    },
  };
}
