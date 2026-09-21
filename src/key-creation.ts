// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomBytes } from "node:crypto";
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { isProcessAlive } from "./launcher.js";
import { NARROW_WORST_MS, narrowToOwner } from "./private-path.js";

export const MAKE_PATIENCE_MS = Math.round(NARROW_WORST_MS * 1.5);
export const KEY_LOCK_SUFFIX = ".lock.sqlite";
const REST_MS = 25;
const wait = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, REST_MS);
const transient = (error: unknown) => ["EPERM", "EACCES", "EBUSY", "EEXIST"].includes((error as NodeJS.ErrnoException).code || "");

export function readPrivateKey(path: string): string | null {
  try {
    const value = readFileSync(path, "utf8").trim();
    return /^[0-9a-f]{64}$/.test(value) ? value : null;
  } catch { return null; }
}

export function createPrivateKey(path: string, options: { patienceMs?: number } = {}): { value: string; fresh: boolean } {
  const existing = readPrivateKey(path);
  if (existing) return { value: existing, fresh: false };
  const patience = options.patienceMs ?? MAKE_PATIENCE_MS;
  if (!Number.isSafeInteger(patience) || patience < 0) throw new Error("key creation patience must be a non-negative integer");
  const lock = new DatabaseSync(path + KEY_LOCK_SUFFIX);
  let held = false;
  try {
    lock.exec("PRAGMA busy_timeout = " + Math.min(patience, 2_147_483_647));
    lock.exec("BEGIN EXCLUSIVE"); held = true;
    lock.exec("CREATE TABLE IF NOT EXISTS key_lock (id INTEGER PRIMARY KEY)");
    const made = makeUnderLock(path, patience);
    lock.exec("COMMIT"); held = false;
    return made;
  } catch (error) {
    if (held) { try { lock.exec("ROLLBACK"); } catch { } }
    const code = (error as { errcode?: number }).errcode;
    if (code === 5 || code === 6) throw new Error(path + " could not be made: another start is holding its creation lock. Try again when that start finishes.");
    throw error;
  } finally { lock.close(); }
}

function makeUnderLock(path: string, patience: number): { value: string; fresh: boolean } {
  const until = Date.now() + patience, mark = path + ".making";
  const token = randomBytes(16).toString("hex");
  let first = true;
  do {
    if (!first) wait(); first = false;
    const existing = readPrivateKey(path);
    if (existing) return { value: existing, fresh: false };
    let marker: number;
    try { marker = openSync(mark, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(readFileSync(mark, "utf8")) as { pid?: unknown; lock?: unknown };
        if (owner.lock === "sqlite" || (typeof owner.pid === "number" && owner.pid > 0 && !isProcessAlive(owner.pid))) unlinkSync(mark);
      } catch { }
      continue;
    }
    try {
      writeFileSync(marker, JSON.stringify({ pid: process.pid, startedAt: Date.now(), token, lock: "sqlite" }));
      const appeared = readPrivateKey(path);
      if (appeared) return { value: appeared, fresh: false };
      try { unlinkSync(path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") { if (transient(error)) continue; throw error; }
      }
      let into: number;
      try { into = openSync(path, "wx", 0o600); }
      catch (error) { if (transient(error)) continue; throw error; }
      const value = randomBytes(32).toString("hex");
      try { narrowToOwner(path, "file"); writeFileSync(into, value); }
      finally { closeSync(into); }
      const written = readPrivateKey(path);
      if (written) return { value: written, fresh: written === value };
    } finally {
      closeSync(marker);
      try {
        if (JSON.parse(readFileSync(mark, "utf8")).token === token) unlinkSync(mark);
      } catch { }
    }
  } while (Date.now() < until);
  throw new Error(path + " could not be made: an older start or a locked file is holding " + mark + ". Finish that start and try again.");
}
