// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { parentPort, workerData } from "node:worker_threads";
import { HistoryStore } from "./history-store.js";
import { Logger } from "./log.js";

export interface HistoryUpgradeTask { path: string }

class ParentLog extends Logger {
  override info(message: string): void { parentPort?.postMessage({ log: { level: "info", message } }); }
  override warn(message: string): void { parentPort?.postMessage({ log: { level: "warn", message } }); }
  override error(message: string): void { parentPort?.postMessage({ log: { level: "error", message } }); }
  override child(scope: string): Logger { return new ParentLog(scope); }
}

if (parentPort) {
  const port = parentPort;
  const { path } = workerData as HistoryUpgradeTask;
  try {
    const store = new HistoryStore(path, new ParentLog("history"), { onStep: (step) => port.postMessage({ step }) });
    const backup = store.upgradeBackup;
    store.close();
    port.postMessage({ ok: true, backup });
  } catch (error) {
    port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
