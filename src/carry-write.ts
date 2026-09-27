// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { closeSync, constants, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, rmSync, type RmOptions } from "node:fs";
import { join } from "node:path";
import { HistoryStore } from "./history-store.js";
import { CarryStage, type CarryResource, type PlanRowKind } from "./carry-stage.js";
import type { CarryState } from "./carry-merge.js";
import type { CarryAlternative, CarryHead, CarryNumber, CarryRevision } from "./carry-history.js";
import { durable } from "./file-transaction.js";

export const ARRIVING = ".arriving";

export const HELD_FILE_RETRIES = { recursive: true, force: true, maxRetries: 4, retryDelay: 100 } as const;

export function removeArrivingFolder(folder: string, remove: (path: string, options: RmOptions) => void = rmSync): void {
  const marker = join(folder, ARRIVING);
  if (!existsSync(marker)) return;
  for (const entry of readdirSync(folder)) if (entry !== ARRIVING) remove(join(folder, entry), HELD_FILE_RETRIES);
  remove(marker, HELD_FILE_RETRIES);
  remove(folder, HELD_FILE_RETRIES);
}

export async function takeBackOrSay(failure: unknown, takeBack: () => Promise<void>): Promise<void> {
  try {
    await takeBack();
  } catch (cleanup) {
    const said = failure instanceof Error ? failure.message : String(failure);
    const also = cleanup instanceof Error ? cleanup.message : String(cleanup);
    throw new Error(`${said} What it had written could not all be taken back yet (${also}); viberoom finishes that when it starts again or before the next import.`, { cause: failure });
  }
}

const PORTION = 100;

export interface ArrivingRoomTask {
  history: string;
  stageDir: string;
  dataDir: string;
  uuid: string;
  target: string;
  aliases: string[];
  rows: Record<PlanRowKind, number>;
}
export interface ArrivingProgress { phase: "messages" | "files"; done: number; total: number }

const breathe = () => new Promise<void>(resolve => setTimeout(resolve, 2));

function durableCopy(from: string, to: string): void {
  copyFileSync(from, to, constants.COPYFILE_EXCL);
  const fd = openSync(to, "r+");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export async function writeArrivingRoom(task: ArrivingRoomTask, progress: (step: ArrivingProgress) => void = () => {}): Promise<{ messages: number; files: number }> {
  const folder = join(task.dataDir, "rooms", task.target);
  if (existsSync(folder)) throw new Error("The new room's folder already exists here. Look at the import again.");
  const stage = new CarryStage(task.stageDir), store = new HistoryStore(task.history);
  let marked = false;
  try {
    mkdirSync(join(folder, "files"), { recursive: true });
    durable(join(folder, ARRIVING), JSON.stringify({ uuid: task.uuid, at: new Date().toISOString() }));
    marked = true;
    const { target, uuid, rows } = task;
    if (rows.revision) store.transaction(() => store.carry.importRevisions(target, stage.planRows<CarryRevision>(uuid, "revision")));
    for (let from = 0; from < rows.state; from += PORTION) {
      const states = stage.planRows<CarryState>(uuid, "state", from, PORTION);
      store.transaction(() => {
        for (const state of states) {
          store.upsert(target, state.message, { track: false });
          if (state.deletedAt !== null) store.markDeleted(target, [state.message.id], state.deletedAt, { track: false });
        }
      });
      progress({ phase: "messages", done: Math.min(from + PORTION, rows.state), total: rows.state });
      await breathe();
    }
    for (let from = 0; from < rows.head; from += PORTION * 10) {
      const heads = stage.planRows<CarryHead>(uuid, "head", from, PORTION * 10);
      store.transaction(() => { for (const head of heads) store.carry.acceptHead(target, head); });
      await breathe();
    }
    for (let from = 0; from < rows.alternative; from += PORTION) {
      const alternatives = stage.planRows<CarryAlternative>(uuid, "alternative", from, PORTION);
      store.transaction(() => { for (const alternative of alternatives) store.carry.archive(target, alternative); });
      await breathe();
    }
    if (task.aliases.length) store.transaction(() => store.carry.addAliases(target, task.aliases));
    for (let from = 0; from < rows.number; from += PORTION * 10) {
      const numbers = stage.planRows<CarryNumber>(uuid, "number", from, PORTION * 10);
      store.transaction(() => store.carry.learnNumbers(target, numbers));
      await breathe();
    }
    for (let from = 0; from < rows.resource; from += PORTION) {
      const resources = stage.planRows<CarryResource>(uuid, "resource", from, PORTION);
      for (const resource of resources) durableCopy(join(stage.dir, "blobs", resource.blob), join(folder, "files", resource.file));
      store.transaction(() => { for (const resource of resources) store.carry.resource(target, resource.file, resource.sha256); });
      progress({ phase: "files", done: Math.min(from + PORTION, rows.resource), total: rows.resource });
      await breathe();
    }
    return { messages: rows.state, files: rows.resource };
  } catch (error) {
    if (marked) await takeBackOrSay(error, () => takeBackArrivingRoom({ history: store, dataDir: task.dataDir, target: task.target }));
    throw error;
  } finally {
    store.close();
    stage.close();
  }
}

export async function takeBackArrivingRoom(where: { history: HistoryStore | string; dataDir: string; target: string }): Promise<void> {
  const store = typeof where.history === "string" ? new HistoryStore(where.history) : where.history;
  try {
    while (store.dropRoomPortion(where.target, PORTION) > 0) await breathe();
    store.dropRoom(where.target);
  } finally {
    if (typeof where.history === "string") store.close();
  }
  removeArrivingFolder(join(where.dataDir, "rooms", where.target));
}
