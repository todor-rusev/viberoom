// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const RETRY_DELAYS_MS = [10, 30, 60, 120, 250];

export interface RenameOptions { retryDelaysMs?: number[]; rename?: typeof renameSync; sleep?: (ms: number) => void }

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isTransient(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

let listener: ((path: string, error: NodeJS.ErrnoException) => void) | undefined;
const reported = new Set<string>();

export function onRenameRefused(report: (path: string, error: NodeJS.ErrnoException) => void): void {
  listener = report;
}

export function renameWithRetry(from: string, to: string, options: RenameOptions = {}): boolean {
  const rename = options.rename ?? renameSync;
  const sleep = options.sleep ?? pause;
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      rename(from, to);
      return true;
    } catch (error) {
      if (!isTransient(error)) throw error;
      if (attempt >= delays.length) {
        const folder = dirname(to).toLowerCase();
        if (!reported.has(folder)) {
          reported.add(folder);
          listener?.(to, error as NodeJS.ErrnoException);
        }
        return false;
      }
      sleep(delays[attempt]);
    }
  }
}

export function writeFileAtomic(path: string, data: string, options: RenameOptions & { write?: typeof writeFileSync; remove?: (path: string) => void } = {}): void {
  const write = options.write ?? writeFileSync;
  const tmp = `${path}.tmp`;
  write(tmp, data);
  if (renameWithRetry(tmp, path, options)) return;
  write(path, data);
  try {
    (options.remove ?? ((file: string) => rmSync(file, { force: true })))(tmp);
  } catch {
  }
}
