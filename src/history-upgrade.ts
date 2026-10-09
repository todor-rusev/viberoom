// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { HISTORY_DB_FILE, storeOpenFailure, type HistoryUpgradeStep } from "./history-store.js";
import type { Logger } from "./log.js";
import type { HistoryUpgradeTask } from "./history-upgrade-worker.js";

export interface UpgradeProgress {
  stage: "copying-history" | "migrating-history";
  done?: number;
  total?: number;
}

export interface UpgradeOptions {
  log: Logger;
  onProgress?(progress: UpgradeProgress): void;
  everyMs?: number;
  worker?: URL;
}

type WorkerWord =
  | { step: HistoryUpgradeStep }
  | { log: { level: "info" | "warn" | "error"; message: string } }
  | { ok: true; backup: string | null }
  | { ok: false; error: string };

export function upgradeHistory(dataDir: string, options: UpgradeOptions): Promise<{ backup: string | null }> {
  const say = options.onProgress ?? (() => {});
  return new Promise((resolve, reject) => {
    const task: HistoryUpgradeTask = { path: join(dataDir, HISTORY_DB_FILE) };
    const worker = new Worker(options.worker ?? new URL("./history-upgrade-worker.js", import.meta.url), { workerData: task });
    let answer: { ok: true; backup: string | null } | { ok: false; error: string } | undefined;
    let failed: Error | undefined;
    let copy: { file: string; bytes: number } | null = null;
    let latest: UpgradeProgress | null = null;
    let said = "";
    const tell = (progress: UpgradeProgress): void => {
      latest = progress;
      said = JSON.stringify(progress);
      say(progress);
    };
    const sayLatest = (): void => {
      if (latest && JSON.stringify(latest) !== said) tell(latest);
    };
    const copyDone = (): void => {
      if (!copy) return;
      latest = { stage: "copying-history", done: copy.bytes, total: copy.bytes };
      copy = null;
      sayLatest();
    };
    let asking = false;
    const tick = setInterval(() => {
      if (!copy) return sayLatest();
      if (asking) return;
      const { file, bytes } = copy;
      asking = true;
      void stat(file).then((found) => Math.min(found.size, bytes), () => 0).then((done) => {
        asking = false;
        if (copy?.file !== file) return;
        latest = { stage: "copying-history", done, total: bytes };
        sayLatest();
      });
    }, options.everyMs ?? 1_000);
    worker.on("message", (word: WorkerWord) => {
      if ("log" in word) return void options.log[word.log.level](word.log.message);
      if (!("step" in word)) {
        if (word.ok) copyDone();
        return void (answer = word);
      }
      const step = word.step;
      if (step.step === "copy") {
        copy = { file: step.file, bytes: step.bytes };
        return tell({ stage: "copying-history", done: 0, total: step.bytes });
      }
      copyDone();
      const next: UpgradeProgress = step.step === "fill" ? { stage: "migrating-history", done: step.done, total: step.total } : { stage: "migrating-history" };
      if (latest?.stage !== next.stage || latest.total !== next.total) tell(next);
      else latest = next;
    });
    worker.once("error", (error) => { failed = error; });
    worker.once("exit", (code) => {
      clearInterval(tick);
      copy = null;
      if (answer?.ok) return resolve({ backup: answer.backup });
      reject(storeOpenFailure(failed ?? (answer ? new Error(answer.error) : new Error(`the upgrade stopped before it finished (exit ${code}); nothing was changed`))));
    });
  });
}
