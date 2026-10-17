// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { AgentMessageError } from "../agent-message.js";
import { BackgroundTaskError, BackgroundTaskStore } from "../background-task-store.js";
import type { Room } from "../room.js";
import { validArguments } from "../tool-validation.js";

export type TaskRoom = Pick<Room, "uuid" | "participants" | "acceptsBackgroundRegistration" | "removeBackgroundCompletion"
  | "enqueueBackgroundCompletion" | "resumeBackgroundCompletions">;

export interface BackgroundTaskPorts {
  caller(token: string): { room: TaskRoom; participantId: string } | null;
  roomByUuid(uuid: string): TaskRoom | undefined;
  rooms(): Iterable<TaskRoom>;
  log(text: string): void;
}

const UNAVAILABLE = "Background tasks are unavailable now.";

export class BackgroundTasks {
  private store: BackgroundTaskStore | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly results = new Map<string, { confirmed: boolean; messageId: string }>();
  private fault = "";
  private disposed = false;
  private closed = false;

  constructor(file: string, private readonly ports: BackgroundTaskPorts) {
    try {
      this.store = new BackgroundTaskStore(file);
      this.timer = setInterval(() => this.flush(), 1000);
      this.timer.unref();
    } catch (error) { this.failure(error); }
  }

  get available(): boolean { return !!this.store; }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  close(): void {
    this.dispose();
    this.closed = true;
    this.store?.close();
  }

  removeRoom(uuid: string): void {
    if (!this.closed) this.store?.removeRoom(uuid);
  }

  reset(uuids: Iterable<string>): void {
    for (const uuid of uuids) this.removeRoom(uuid);
    this.results.clear();
  }

  private failure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== this.fault) this.ports.log(`Background tasks: ${message}`);
    this.fault = message;
  }

  private withStore<T>(action: (store: BackgroundTaskStore) => T): T {
    if (this.disposed || !this.store) throw new AgentMessageError(503, "unconfirmed_result", UNAVAILABLE);
    try { return action(this.store); }
    catch (error) {
      if (error instanceof AgentMessageError) throw error;
      if (error instanceof BackgroundTaskError) throw new AgentMessageError(error.status, error.code, error.message);
      this.failure(error);
      throw new AgentMessageError(503, "unconfirmed_result", "The background task result could not be confirmed; repeat only the same task ID and payload.");
    }
  }

  private held(room: TaskRoom): boolean {
    return this.ports.roomByUuid(room.uuid) === room;
  }

  private current(room: TaskRoom): boolean {
    return !this.disposed && this.held(room) && !this.disposed;
  }

  private caller(token: string): { room: TaskRoom; participantId: string } {
    const refused = () => new AgentMessageError(403, "session_unavailable", "This agent session cannot register background tasks now.");
    const target = this.ports.caller(token);
    if (!target || !this.held(target.room)) throw refused();
    const accepts = target.room.acceptsBackgroundRegistration(target.participantId, token);
    if (!accepts || !this.held(target.room)) throw refused();
    return target;
  }

  register(token: string, raw: unknown) {
    const target = this.caller(token);
    if (!validArguments("register_background_task", raw)) throw new AgentMessageError(400, "invalid_arguments", "Provide only taskId and description.");
    const input = raw as { taskId: string; description: string };
    return this.withStore(store => store.register(target.room.uuid, target.participantId, input.taskId, input.description));
  }

  list(token: string) {
    const target = this.caller(token);
    return this.withStore(store => ({ tasks: store.list(target.room.uuid, target.participantId) }));
  }

  get(token: string, taskId: string) {
    const target = this.caller(token);
    if (!validArguments("get_background_task", { taskId })) throw new AgentMessageError(400, "invalid_arguments", "Provide a nonblank taskId.");
    return this.withStore(store => {
      const task = store.get(target.room.uuid, target.participantId, taskId);
      if (!task) throw new AgentMessageError(404, "task_unavailable", "That task is not registered under your name in this room.");
      return task;
    });
  }

  cancel(token: string, raw: unknown) {
    const target = this.caller(token);
    if (!validArguments("cancel_background_task", raw)) throw new AgentMessageError(400, "invalid_arguments", "Provide only taskId.");
    const input = raw as { taskId: string };
    const result = this.withStore(store => store.cancel(target.room.uuid, target.participantId, input.taskId));
    if (this.current(target.room)) target.room.removeBackgroundCompletion(target.participantId, result.key);
    return result;
  }

  complete(raw: unknown) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AgentMessageError(400, "invalid_arguments", "Provide the completion key, token, terminal status and complete result.");
    const input = raw as Record<string, unknown>;
    if (Object.keys(input).some(key => !["key", "token", "status", "result"].includes(key))
        || typeof input.key !== "string" || typeof input.token !== "string" || typeof input.result !== "string"
        || typeof input.status !== "string" || !["succeeded", "failed", "cancelled"].includes(input.status))
      throw new AgentMessageError(400, "invalid_arguments", "Provide the completion key, token, terminal status and complete result.");
    const result = this.withStore(store => {
      const task = store.lookup(input.key as string);
      const room = task && this.ports.roomByUuid(task.roomUuid);
      const participant = task && room?.participants.get(task.participantId);
      if (!task || !room || !participant || participant.kind !== "agent" || participant.status === "left" || !this.held(room))
        throw new AgentMessageError(403, "session_unavailable", "The background task's author is no longer in this room.");
      if (this.disposed) throw new AgentMessageError(503, "unconfirmed_result", UNAVAILABLE);
      return store.complete(input.key as string, input.token as string, input.status as "succeeded" | "failed" | "cancelled", input.result as string);
    });
    queueMicrotask(() => this.flush());
    return { key: result.key, status: result.status, delivery: result.delivery };
  }

  private finished(key: string, confirmed: boolean, messageId: string): void {
    if (this.closed || !this.store) return;
    this.results.set(key, { confirmed, messageId });
    if (!this.disposed) { this.flush(); return; }
    try { this.writeResults(this.store); }
    catch (error) { this.failure(error); }
  }

  private writeResults(store: BackgroundTaskStore): void {
    for (const [key, result] of this.results) {
      if (!store.lookup(key)) { this.results.delete(key); continue; }
      if (result.confirmed) store.delivered(key, result.messageId);
      else store.interrupted(key);
      this.results.delete(key);
    }
  }

  private flush(): void {
    if (this.disposed || !this.store) return;
    const store = this.store;
    try {
      this.writeResults(store);
      for (const task of store.pending()) {
        if (this.disposed) return;
        const room = this.ports.roomByUuid(task.roomUuid);
        if (!room || task.result === null || !this.current(room)) continue;
        room.enqueueBackgroundCompletion(task.participantId, { ...task, result: task.result,
          claim: messageId => {
            if (!this.current(room)) return false;
            try { return store.claim(task.key, messageId); }
            catch (error) { this.failure(error); return false; }
          },
          finish: (confirmed, messageId) => this.finished(task.key, confirmed, messageId),
        });
      }
      if (this.disposed) return;
      for (const room of [...this.ports.rooms()]) {
        if (this.current(room)) room.resumeBackgroundCompletions();
      }
      this.fault = "";
    } catch (error) { this.failure(error); }
  }
}
