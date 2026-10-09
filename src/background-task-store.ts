// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const BACKGROUND_TASK_ID_MAX = 128;
export const BACKGROUND_TASK_DESCRIPTION_MAX = 8000;
export const BACKGROUND_TASK_RESULT_MAX = 200_000;
export const BACKGROUND_TASK_PENDING_LIMIT = 100;
export type BackgroundTaskTerminalStatus = "succeeded" | "failed" | "cancelled";
export type BackgroundTaskStatus = "registered" | BackgroundTaskTerminalStatus;
export type BackgroundTaskDelivery = "pending" | "claimed" | "delivered" | "interrupted";
export interface BackgroundTask {
  key: string; roomUuid: string; participantId: string; taskId: string; description: string;
  status: BackgroundTaskStatus; result: string | null; createdAt: number; completedAt: number | null;
  roomMessageId: string | null; revoked: boolean; delivery: BackgroundTaskDelivery; resultCharacters: number;
}
export type BackgroundTaskSummary = Pick<BackgroundTask, "key" | "taskId" | "status" | "delivery" | "revoked" | "createdAt" | "completedAt" | "roomMessageId" | "resultCharacters">;
export interface BackgroundTaskRegistration { key: string; token: string; status: BackgroundTaskStatus }
export class BackgroundTaskError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409, readonly code: string, message: string) { super(message); }
}

function fitsCharacters(value: unknown, limit: number, nonblank = false): value is string {
  if (typeof value !== "string" || nonblank && !value.trim()) return false;
  let count = 0;
  for (const _character of value) if (++count > limit) return false;
  return true;
}
function requireId(value: unknown): asserts value is string {
  if (!fitsCharacters(value, BACKGROUND_TASK_ID_MAX, true))
    throw new BackgroundTaskError(400, "invalid_arguments", "Use a nonblank background task ID of at most 128 characters.");
}
const liveOwners = new Set<string>();
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

export class BackgroundTaskStore {
  private readonly db: DatabaseSync;
  private readonly secret: Buffer;
  private readonly owner = randomUUID();
  private closed = false;
  constructor(file: string, private readonly now = Date.now) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    try {
      const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version);
      if (version > 1) throw new Error("This background task store requires a newer viberoom.");
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;");
      this.secret = this.transaction(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL, token TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS tasks (
            key TEXT PRIMARY KEY, room TEXT NOT NULL, participant TEXT NOT NULL, task TEXT NOT NULL,
            status TEXT NOT NULL, delivery TEXT NOT NULL, revoked INTEGER NOT NULL, created INTEGER NOT NULL,
            body TEXT NOT NULL, UNIQUE(room,participant,task));
          CREATE INDEX IF NOT EXISTS pending_tasks ON tasks(room,participant,delivery,revoked);
          PRAGMA user_version=1;`);
        const old = this.db.prepare("SELECT pid,token FROM owner WHERE id=1").get() as { pid: number; token: string } | undefined;
        if (old && (Number(old.pid) === process.pid ? liveOwners.has(old.token) : alive(Number(old.pid))))
          throw new Error("Another running viberoom owns these background tasks.");
        this.db.prepare("INSERT OR REPLACE INTO owner VALUES(1,?,?)").run(process.pid, this.owner);
        let value = this.db.prepare("SELECT value FROM metadata WHERE name='callback-secret'").get()?.value;
        if (value === undefined) {
          value = randomBytes(32).toString("hex");
          this.db.prepare("INSERT INTO metadata VALUES('callback-secret',?)").run(value);
        }
        if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error("The background task callback secret is invalid.");
        for (const row of this.db.prepare("SELECT body FROM tasks WHERE delivery='claimed'").all()) {
          const task = JSON.parse(String(row.body)) as BackgroundTask;
          this.write({ ...task, delivery: "interrupted" });
        }
        return Buffer.from(value, "hex");
      });
      liveOwners.add(this.owner);
    } catch (error) { this.db.close(); throw error; }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private write(task: BackgroundTask): void {
    this.db.prepare(`INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET
      status=excluded.status,delivery=excluded.delivery,revoked=excluded.revoked,body=excluded.body`)
      .run(task.key, task.roomUuid, task.participantId, task.taskId, task.status, task.delivery,
        Number(task.revoked), task.createdAt, JSON.stringify(task));
  }
  private token(task: Pick<BackgroundTask, "key" | "roomUuid" | "participantId" | "taskId">): string {
    return createHmac("sha256", this.secret).update(JSON.stringify([
      "viberoom.background-task-completion.v1", task.key, task.roomUuid, task.participantId, task.taskId,
    ])).digest("base64url");
  }
  private byKey(key: string): BackgroundTask | null {
    const row = this.db.prepare("SELECT body FROM tasks WHERE key=?").get(key);
    return row ? JSON.parse(String(row.body)) as BackgroundTask : null;
  }
  private required(key: string): BackgroundTask {
    const task = this.byKey(key);
    if (!task) throw new BackgroundTaskError(404, "task_unavailable", "This background task no longer exists.");
    return task;
  }

  get(roomUuid: string, participantId: string, taskId: string): BackgroundTask | null {
    const row = this.db.prepare("SELECT body FROM tasks WHERE room=? AND participant=? AND task=?").get(roomUuid, participantId, taskId);
    return row ? JSON.parse(String(row.body)) as BackgroundTask : null;
  }
  lookup(key: string): BackgroundTask | null { return this.byKey(key); }
  list(roomUuid: string, participantId: string): BackgroundTaskSummary[] {
    return this.db.prepare(`SELECT key,task,status,delivery,revoked,created,
      json_extract(body,'$.completedAt') AS completed, json_extract(body,'$.roomMessageId') AS message,
      json_extract(body,'$.resultCharacters') AS characters FROM tasks WHERE room=? AND participant=? ORDER BY created DESC,key DESC LIMIT 50`)
      .all(roomUuid, participantId).map(row => ({ key: String(row.key), taskId: String(row.task),
        status: row.status as BackgroundTaskStatus, delivery: row.delivery as BackgroundTaskDelivery, revoked: Boolean(row.revoked),
        createdAt: Number(row.created), completedAt: row.completed === null ? null : Number(row.completed),
        roomMessageId: row.message === null ? null : String(row.message), resultCharacters: Number(row.characters ?? 0) }));
  }
  register(roomUuid: string, participantId: string, taskId: string, description: string): BackgroundTaskRegistration {
    requireId(roomUuid); requireId(participantId); requireId(taskId);
    if (!fitsCharacters(description, BACKGROUND_TASK_DESCRIPTION_MAX, true))
      throw new BackgroundTaskError(400, "invalid_arguments", "Provide a nonblank task description of at most 8000 characters.");
    return this.transaction(() => {
      let task = this.get(roomUuid, participantId, taskId);
      if (task && task.description !== description)
        throw new BackgroundTaskError(409, "task_id_conflict", "That taskId already belongs to a different registration.");
      if (task?.revoked) throw new BackgroundTaskError(409, "task_revoked", "This task registration was cancelled; use a new taskId for new work.");
      if (!task) {
        const waiting = Number(this.db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE room=? AND participant=? AND revoked=0 AND delivery IN ('pending','claimed')")
          .get(roomUuid, participantId)?.count);
        if (waiting >= BACKGROUND_TASK_PENDING_LIMIT)
          throw new BackgroundTaskError(409, "task_limit", "This author already has 100 pending background tasks in this room.");
        task = { key: randomUUID(), roomUuid, participantId, taskId, description, status: "registered", result: null,
          createdAt: this.now(), completedAt: null, roomMessageId: null, revoked: false, delivery: "pending", resultCharacters: 0 };
        this.write(task);
      }
      return { key: task.key, token: this.token(task), status: task.status };
    });
  }

  complete(key: string, token: string, status: BackgroundTaskTerminalStatus, result: string): BackgroundTask {
    return this.transaction(() => {
      const task = this.byKey(key);
      const expected = task ? Buffer.from(this.token(task)) : null;
      const provided = typeof token === "string" ? Buffer.from(token) : Buffer.alloc(0);
      if (!task || task.revoked || !expected || expected.length !== provided.length || !timingSafeEqual(expected, provided))
        throw new BackgroundTaskError(403, "callback_unavailable", "This completion capability cannot update the task.");
      if (!["succeeded", "failed", "cancelled"].includes(status) || !fitsCharacters(result, BACKGROUND_TASK_RESULT_MAX))
        throw new BackgroundTaskError(400, "invalid_arguments", "Provide a terminal task status and its full result of at most 200000 characters.");
      if (task.status !== "registered") {
        if (task.status !== status || task.result !== result)
          throw new BackgroundTaskError(409, "completion_conflict", "This task already has a different terminal result.");
        return task;
      }
      let resultCharacters = 0;
      for (const _character of result) resultCharacters++;
      const completed: BackgroundTask = { ...task, status, result, completedAt: this.now(), resultCharacters };
      this.write(completed); return completed;
    });
  }
  pending(): BackgroundTask[] {
    return this.db.prepare("SELECT body FROM tasks WHERE status<>'registered' AND revoked=0 AND delivery='pending' ORDER BY created,key")
      .all().map(row => JSON.parse(String(row.body)) as BackgroundTask);
  }
  claim(key: string, roomMessageId: string): boolean {
    requireId(roomMessageId);
    return this.transaction(() => {
      const task = this.required(key);
      if (task.revoked || task.status === "registered" || task.delivery !== "pending") return false;
      if (task.roomMessageId && task.roomMessageId !== roomMessageId)
        throw new BackgroundTaskError(409, "delivery_conflict", "This task already belongs to a different room message.");
      this.write({ ...task, roomMessageId, delivery: "claimed" }); return true;
    });
  }
  delivered(key: string, roomMessageId: string): void {
    requireId(roomMessageId);
    this.transaction(() => {
      const task = this.required(key);
      if (task.roomMessageId !== roomMessageId || task.delivery !== "claimed" && task.delivery !== "delivered")
        throw new BackgroundTaskError(409, "delivery_conflict", "Only the claimed room message can confirm this task's delivery.");
      if (task.delivery === "claimed") this.write({ ...task, delivery: "delivered" });
    });
  }
  interrupted(key: string): void {
    this.transaction(() => {
      const task = this.required(key);
      if (task.delivery === "claimed") this.write({ ...task, delivery: "interrupted" });
    });
  }
  cancel(roomUuid: string, participantId: string, taskId: string): BackgroundTask {
    return this.transaction(() => {
      const task = this.get(roomUuid, participantId, taskId);
      if (!task) throw new BackgroundTaskError(404, "task_unavailable", "This background task no longer exists in this room.");
      if (task.delivery === "claimed")
        throw new BackgroundTaskError(409, "task_claimed", "The task's continuation already started; cancelling registration cannot stop the model.");
      const cancelled = { ...task, revoked: true };
      if (!task.revoked) this.write(cancelled);
      return cancelled;
    });
  }
  removeRoom(roomUuid: string): void {
    this.transaction(() => { this.db.prepare("DELETE FROM tasks WHERE room=?").run(roomUuid); });
  }
  close(): void {
    if (this.closed) return;
    try { this.transaction(() => { this.db.prepare("DELETE FROM owner WHERE token=?").run(this.owner); }); }
    finally { this.closed = true; liveOwners.delete(this.owner); this.db.close(); }
  }
}
