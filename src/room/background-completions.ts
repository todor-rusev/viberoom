// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { BackgroundCompletion, StoreOutcome } from "../room.js";
import type { TurnSubscriber } from "./turn-life.js";

export interface QueuedBackgroundCompletion extends BackgroundCompletion {
  claimed: boolean;
  continuing: boolean;
  confirmed: boolean;
  messageId: string;
}

export interface BackgroundCompletionPorts {
  accepts(participantId: string): boolean;
  wake(participantId: string): void;
  recorded(messageId: string): boolean;
  recordNotice(participantId: string, completion: QueuedBackgroundCompletion): StoreOutcome;
  closing(): boolean;
}

export type CompletionClaim =
  | { readonly kind: "carried"; readonly completion: QueuedBackgroundCompletion }
  | { readonly kind: "stopped" }
  | { readonly kind: "refused" }
  | { readonly kind: "failed"; readonly error: unknown };

export class BackgroundCompletions {
  private readonly queues = new Map<string, QueuedBackgroundCompletion[]>();
  private readonly carried = new Map<string, QueuedBackgroundCompletion>();
  private disposed = false;

  constructor(private readonly ports: BackgroundCompletionPorts) {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const carried = [...this.carried.values()];
    this.carried.clear();
    this.queues.clear();
    let failure: { error: unknown } | undefined;
    for (const completion of carried) {
      try { completion.finish(false, completion.messageId); } catch (error) { failure ??= { error }; }
    }
    if (failure) throw failure.error;
  }

  enqueue(participantId: string, completion: BackgroundCompletion): void {
    if (this.disposed) return;
    const accepted = this.ports.accepts(participantId);
    if (this.disposed || !accepted) return;
    const queue = this.queues.get(participantId) ?? [];
    if (!queue.some((task) => task.key === completion.key)) {
      queue.push({ ...completion, claimed: false, continuing: false, confirmed: false, messageId: `background-task-${completion.key}` });
      this.queues.set(participantId, queue);
    }
    this.ports.wake(participantId);
  }

  resume(): void {
    for (const participantId of this.queues.keys()) {
      if (this.disposed) return;
      this.ports.wake(participantId);
    }
  }

  remove(participantId: string, key: string): void {
    const queue = this.queues.get(participantId);
    if (!queue) return;
    this.queues.set(participantId, queue.filter((task) => task.key !== key || task.claimed));
  }

  waiting(participantId: string): boolean {
    return !!this.queues.get(participantId)?.length;
  }

  next(participantId: string): QueuedBackgroundCompletion | undefined {
    return this.queues.get(participantId)?.[0];
  }

  carriedBy(participantId: string): QueuedBackgroundCompletion | undefined {
    return this.carried.get(participantId);
  }

  claim(participantId: string, completion: QueuedBackgroundCompletion): CompletionClaim {
    if (this.disposed) return { kind: "stopped" };
    if (completion.claimed) return { kind: "carried", completion };
    try {
      const recorded = this.ports.recorded(completion.messageId);
      if (this.disposed) return { kind: "stopped" };
      if (!recorded) {
        const stored = this.ports.recordNotice(participantId, completion);
        if (this.disposed) return { kind: "stopped" };
        if (stored !== "record") { this.forget(participantId, completion); return { kind: "stopped" }; }
      }
      const claimed = completion.claim(completion.messageId);
      if (this.disposed) {
        if (claimed) completion.finish(false, completion.messageId);
        return { kind: "stopped" };
      }
      if (!claimed) { this.forget(participantId, completion); return { kind: "refused" }; }
    } catch (error) {
      this.forget(participantId, completion);
      return { kind: "failed", error };
    }
    completion.claimed = true;
    this.carried.set(participantId, completion);
    return { kind: "carried", completion };
  }

  block(completion: QueuedBackgroundCompletion): string {
    return `<background-task-completion>\n${JSON.stringify({ taskId: completion.taskId,
      description: completion.description, status: completion.status, result: completion.result }).replaceAll("<", "\\u003c")}\n</background-task-completion>`;
  }

  prepared(participantId: string, completion: QueuedBackgroundCompletion): void {
    if (this.carried.get(participantId) !== completion) return;
    completion.continuing = false;
    completion.confirmed = false;
  }

  continuing(participantId: string, value: boolean): void {
    const completion = this.carried.get(participantId);
    if (completion) completion.continuing = value;
  }

  confirmed(participantId: string, value: boolean): void {
    const completion = this.carried.get(participantId);
    if (completion) completion.confirmed = value;
  }

  turnSubscriber(): TurnSubscriber {
    return {
      turnStarted: ({ id }) => {
        const completion = this.carried.get(id);
        if (completion) completion.continuing = false;
      },
      turnEnded: ({ id, runtime }) => {
        const completion = this.carried.get(id);
        if (!completion) return;
        const closing = this.ports.closing();
        if (completion !== this.carried.get(id)) return;
        if (completion.continuing && !runtime.work.workCancelled && !closing && !runtime.session.retiring) return;
        this.carried.delete(id);
        this.forget(id, completion);
        completion.finish(completion.confirmed && !runtime.work.workCancelled && !closing && !runtime.session.retiring, completion.messageId);
      },
    };
  }

  private forget(participantId: string, completion: QueuedBackgroundCompletion): void {
    const remaining = this.queues.get(participantId)?.filter((task) => task !== completion) ?? [];
    if (remaining.length) this.queues.set(participantId, remaining);
    else this.queues.delete(participantId);
  }
}
