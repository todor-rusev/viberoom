// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
export interface MemoryTimer { unref?(): unknown }

export interface MemoryClock {
  now(): number;
  wall(): number;
  setTimeout(callback: () => void, ms: number): MemoryTimer;
  clearTimeout(timer: MemoryTimer): void;
  timeout(ms: number): AbortSignal;
}

export const systemClock: MemoryClock = Object.freeze({
  now: () => performance.now(),
  wall: () => Date.now(),
  setTimeout: (callback: () => void, ms: number): MemoryTimer => setTimeout(callback, ms),
  clearTimeout: (timer: MemoryTimer): void => clearTimeout(timer as ReturnType<typeof setTimeout>),
  timeout: (ms: number): AbortSignal => AbortSignal.timeout(ms),
});
