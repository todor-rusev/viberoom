// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { MemoryClock, MemoryTimer } from "./clock.js";

interface Armed { at: number; order: number; callback: () => void }

export class ManualClock implements MemoryClock {
  #now = 0;
  #order = 0;
  readonly #timers = new Map<MemoryTimer, Armed>();
  readonly #wallAt: number;

  constructor(wallAt = Date.now()) {
    if (!Number.isSafeInteger(wallAt) || wallAt < 0) throw new Error("The wall clock starts at a millisecond timestamp");
    this.#wallAt = wallAt;
  }

  readonly now = (): number => this.#now;
  readonly wall = (): number => this.#wallAt + Math.floor(this.#now);

  setTimeout(callback: () => void, ms: number): MemoryTimer {
    const timer: MemoryTimer = { unref() { return timer; } };
    this.#timers.set(timer, { at: this.#now + Math.max(0, ms), order: this.#order++, callback });
    return timer;
  }

  clearTimeout(timer: MemoryTimer): void { this.#timers.delete(timer); }

  timeout(ms: number): AbortSignal {
    const controller = new AbortController();
    this.setTimeout(() => controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")), ms);
    return controller.signal;
  }

  get pending(): number { return this.#timers.size; }

  tick(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new Error("A tick is a non-negative number of milliseconds");
    const target = this.#now + ms;
    for (;;) {
      let next: [MemoryTimer, Armed] | undefined;
      for (const entry of this.#timers) if (entry[1].at <= target && (!next || entry[1].at < next[1].at || entry[1].at === next[1].at && entry[1].order < next[1].order)) next = entry;
      if (!next) break;
      this.#timers.delete(next[0]);
      this.#now = Math.max(this.#now, next[1].at);
      next[1].callback();
    }
    this.#now = target;
  }
}
