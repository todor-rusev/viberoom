// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { performance } from "node:perf_hooks";

export const SLOW_IO_MS = 200;

export const SLOW_ASYNC_IO_MS = 2000;

export interface SlowIo {
  step: string;
  path: string;
  ms: number;
  held: boolean;
}

export function slowIoWords(slow: SlowIo): string {
  return slow.held
    ? `${SLOW_IO_HELD} ${slow.ms} ms: ${slow.step} ${slow.path}`
    : `${SLOW_IO_TOOK} ${slow.ms} ms (the hub went on meanwhile): ${slow.step} ${slow.path}`;
}
const SLOW_IO_HELD = "a file step held the hub for", SLOW_IO_TOOK = "a file step took";

export function isSlowIoWords(line: unknown): boolean {
  return typeof line === "string" && (line.startsWith(`${SLOW_IO_HELD} `) || line.startsWith(`${SLOW_IO_TOOK} `));
}

let listener: ((slow: SlowIo) => void) | undefined;

export function onSlowIo(report: ((slow: SlowIo) => void) | undefined): void {
  listener = report;
}

function tell(slow: SlowIo): void {
  try {
    listener?.(slow);
  } catch {
  }
}

export function timedIo<T>(step: string, path: string, work: () => T, now: () => number = () => performance.now()): T {
  const started = now();
  try {
    return work();
  } finally {
    const ms = now() - started;
    if (ms >= SLOW_IO_MS) tell({ step, path, ms: Math.round(ms), held: true });
  }
}

export async function timedIoAsync<T>(step: string, path: string, work: () => Promise<T>, now: () => number = () => performance.now()): Promise<T> {
  const started = now();
  try {
    return await work();
  } finally {
    const ms = now() - started;
    if (ms >= SLOW_ASYNC_IO_MS) tell({ step, path, ms: Math.round(ms), held: false });
  }
}
