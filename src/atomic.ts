// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { renameSync, rmSync, writeFileSync } from "node:fs";
import { rename as renameFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { timedIo } from "./slow-io.js";

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

function refused(to: string, error: unknown): void {
  const folder = dirname(to).toLowerCase();
  if (reported.has(folder)) return;
  reported.add(folder);
  listener?.(to, error as NodeJS.ErrnoException);
}

export function renameWithRetry(from: string, to: string, options: RenameOptions = {}): boolean {
  const rename = options.rename ?? renameSync;
  const sleep = options.sleep ?? pause;
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  return timedIo("rename", to, () => {
    for (let attempt = 0; ; attempt++) {
      try {
        rename(from, to);
        return true;
      } catch (error) {
        if (!isTransient(error)) throw error;
        if (attempt >= delays.length) {
          refused(to, error);
          return false;
        }
        sleep(delays[attempt]);
      }
    }
  });
}

export function writeFileAtomic(path: string, data: string, options: RenameOptions & { write?: typeof writeFileSync; remove?: (path: string) => void; mode?: number } = {}): void {
  const write = options.write ?? writeFileSync;
  const how = options.mode === undefined ? undefined : { mode: options.mode };
  const tmp = `${path}.tmp`;
  timedIo("write", tmp, () => write(tmp, data, how));
  if (renameWithRetry(tmp, path, options)) return;
  timedIo("write in place", path, () => write(path, data, how));
  try {
    timedIo("remove", tmp, () => (options.remove ?? ((file: string) => rmSync(file, { force: true })))(tmp));
  } catch {
  }
}

export interface AsyncReplaceOptions {
  retryDelaysMs?: number[];
  mode?: number;
  write?: (path: string, data: string, how?: { mode: number }) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
  remove?: (path: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

export async function writeFileAtomicAsync(path: string, data: string, options: AsyncReplaceOptions = {}): Promise<void> {
  const write = options.write ?? ((file: string, text: string, how?: { mode: number }) => writeFile(file, text, how));
  const rename = options.rename ?? renameFile;
  const remove = options.remove ?? ((file: string) => rm(file, { force: true }));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  const how = options.mode === undefined ? undefined : { mode: options.mode };
  const tmp = `${path}.tmp`;
  await write(tmp, data, how);
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, path);
      return;
    } catch (error) {
      if (!isTransient(error)) throw error;
      if (attempt >= delays.length) {
        refused(path, error);
        break;
      }
      await sleep(delays[attempt]);
    }
  }
  await write(path, data, how);
  try {
    await remove(tmp);
  } catch {
  }
}
