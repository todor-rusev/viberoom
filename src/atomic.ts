// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { renameSync, writeFileSync } from "node:fs";

const RETRY_DELAYS_MS = [10, 30, 60, 120, 250];

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isTransient(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

export function writeFileAtomic(path: string, data: string, options: { retryDelaysMs?: number[]; rename?: typeof renameSync; write?: typeof writeFileSync; sleep?: (ms: number) => void } = {}): void {
  const rename = options.rename ?? renameSync;
  const write = options.write ?? writeFileSync;
  const sleep = options.sleep ?? pause;
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  const tmp = `${path}.tmp`;
  write(tmp, data);
  for (let attempt = 0; ; attempt++) {
    try {
      rename(tmp, path);
      return;
    } catch (error) {
      if (!isTransient(error) || attempt >= delays.length) {
        if (!isTransient(error)) throw error;
        write(path, data);
        return;
      }
      sleep(delays[attempt]);
    }
  }
}
