// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { parentPort, workerData } from "node:worker_threads";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { exportCarry, resourceName, stageCarry, type CarryDependency, type ExportJob } from "./carry-stage.js";
import { prepareCarryPlan, type CarryPlanJob } from "./carry-plan.js";

export interface DependencyFolder { kind: "skill" | "look"; id: string; dir: string }
export type CarryWorkerTask =
  | { type: "export"; job: ExportJob; folders: DependencyFolder[] }
  | { type: "stage"; input: string; stageDir: string; passphrase?: string }
  | { type: "plan"; job: CarryPlanJob }
  | { type: "estimate"; snapshot: string; dataDir: string; rooms: ExportJob["rooms"] };

function dependency(folder: DependencyFolder): CarryDependency {
  const files: CarryDependency["files"] = [];
  let total = 0;
  function walk(dir: string, prefix = "") {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Skill or look ${folder.id} contains a link. Its external files cannot be carried automatically.`);
      const path = prefix + entry.name, full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full, path + "/"); continue; }
      if (!entry.isFile()) throw new Error(`The dependency ${folder.id} contains something other than a file.`);
      if (folder.kind === "look" && entry.name !== `${folder.id}.json`) continue;
      const size = lstatSync(full).size;
      total += size;
      if (size > 20 * 1024 * 1024 || total > 32 * 1024 * 1024 || files.length >= 2048) throw new Error(`The dependency ${folder.id} is too large to carry (20 MiB per file, 32 MiB total, 2048 files).`);
      const data = readFileSync(full);
      files.push({ path, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), data: data.toString("base64") });
    }
  }
  walk(folder.dir);
  return { kind: folder.kind, id: folder.id, files };
}

export async function executeCarryTask(task: CarryWorkerTask): Promise<unknown> {
  if (task.type === "stage") return stageCarry(task.input, task.stageDir, task.passphrase);
  if (task.type === "plan") return prepareCarryPlan(task.job);
  if (task.type === "export") return exportCarry({ ...task.job, dependencies: [...task.job.dependencies, ...task.folders.map(dependency)] });
  const db = new DatabaseSync(task.snapshot, { readOnly: true });
  try {
    return task.rooms.map(room => {
      const row = db.prepare("select count(*) as messages,coalesce(sum(length(cast(body as blob))),0) as bytes from messages where room=?").get(room.id)!;
      const dir = join(task.dataDir, "rooms", room.id, "files");
      let resourceBytes = 0, files = 0;
      if (existsSync(dir)) for (const name of readdirSync(dir)) {
        if (!resourceName(name)) continue;
        const stat = lstatSync(join(dir, name));
        if (stat.isFile() && !stat.isSymbolicLink()) { resourceBytes += stat.size; files++; }
      }
      return { id: room.id, name: room.name, messages: Number(row.messages), conversationBytes: Number(row.bytes), settingsBytes: Buffer.byteLength(JSON.stringify({ settings: room.settings, participants: room.participants })), resourceBytes, files };
    });
  } finally { db.close(); }
}

if (parentPort) {
  executeCarryTask(workerData as CarryWorkerTask).then(
    result => parentPort!.postMessage({ ok: true, result }),
    error => parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : "The transfer could not be prepared.", code: error?.constructor?.name === "CarryPasswordNeeded" ? "password" : "invalid" }),
  );
}
