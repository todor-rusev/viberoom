// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { recordedHubAnswers } from "./launcher.js";

export const OWNER_LOCK_FILE = "owner.lock.sqlite";

export const SERVICE_FILES: ReadonlySet<string> = new Set([OWNER_LOCK_FILE, `${OWNER_LOCK_FILE}-journal`]);

export interface FolderLock {
  readonly path: string;
  release(): void;
}

const held = new Map<DatabaseSync, { dev: bigint; ino: bigint }>();

export async function isHeldFolderLock(path: string): Promise<boolean> {
  if (!held.size) return false;
  let file;
  try { file = await stat(path, { bigint: true }); } catch { return false; }
  return [...held.values()].some(owner => owner.dev === file.dev && owner.ino === file.ino);
}

function isBusy(error: unknown): boolean {
  const e = error as { errcode?: number; message?: string };
  return e?.errcode === 5 || /database is locked/i.test(String(e?.message ?? ""));
}

export function takeFolder(dataDir: string, owner: { pid: number; build?: string | null }): FolderLock | null {
  const path = join(dataDir, OWNER_LOCK_FILE);
  let db: DatabaseSync | null = null;
  let identity: { dev: bigint; ino: bigint };
  try {
    db = new DatabaseSync(path, { timeout: 0 });
    db.exec("PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=DELETE;");
    db.exec("CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL, at INTEGER NOT NULL, build TEXT)");
    db.prepare("INSERT OR REPLACE INTO owner (id, pid, at, build) VALUES (1, ?, ?, ?)").run(owner.pid, Date.now(), owner.build ?? null);
    identity = statSync(path, { bigint: true });
  } catch (error) {
    try { db?.close(); } catch { }
    if (isBusy(error)) return null;
    throw error;
  }
  const connection = db;
  held.set(connection, identity);
  return {
    path,
    release: () => {
      if (!held.delete(connection)) return;
      try { connection.close(); } catch { }
    },
  };
}

export async function waitForFolder(dataDir: string, owner: { pid: number; build?: string | null }, options: { timeoutMs: number; stepMs?: number }): Promise<FolderLock | null> {
  const end = Date.now() + Math.max(0, options.timeoutMs);
  for (;;) {
    const lock = (await recordedHubAnswers(dataDir, owner.pid)) ? null : takeFolder(dataDir, owner);
    if (lock || Date.now() >= end) return lock;
    await new Promise((resolve) => setTimeout(resolve, options.stepMs ?? 200));
  }
}
