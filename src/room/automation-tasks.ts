// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { AutomationRun } from "../automation-store.js";
import type { AutomationOutcome } from "../automations.js";
import type { AgentRuntime } from "./agent-runtime.js";
import type { Turn, TurnSubscriber } from "./turn-life.js";

interface AutomationTask {
  readonly run: AutomationRun;
  readonly runtime: AgentRuntime;
  readonly resolve: (outcome: AutomationOutcome) => void;
  readonly cleanup: () => void;
  outcome: AutomationOutcome;
  continuing: boolean;
}

export interface AutomationTaskPorts {
  runtimeOf(participantId: string): AgentRuntime | undefined;
  requestTurn(participantId: string): void;
  cancelTurn(participantId: string): void;
  closing(): boolean;
  humanName(): string;
}

export class AutomationTasks {
  private readonly tasks = new Map<string, AutomationTask>();
  private disposed = false;

  constructor(private readonly ports: AutomationTaskPorts) {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const tasks = [...this.tasks.values()];
    this.tasks.clear();
    for (const task of tasks) {
      task.cleanup();
      task.resolve({ status: "interrupted", detail: "The room stopped before the result was confirmed." });
    }
  }

  begin(participantId: string, run: AutomationRun, runtime: AgentRuntime, signal: AbortSignal): Promise<AutomationOutcome> {
    if (this.disposed) return Promise.resolve({ status: "interrupted", detail: "The room stopped before the task began." });
    return new Promise((resolve) => {
      const abort = () => {
        const ours = () => !this.disposed && this.tasks.get(participantId)?.run.id === run.id;
        if (!ours()) return;
        const now = this.ports.runtimeOf(participantId);
        if (!ours() || now !== runtime) return;
        this.ports.cancelTurn(participantId);
      };
      this.tasks.set(participantId, { run, runtime, resolve, cleanup: () => signal.removeEventListener("abort", abort),
        continuing: false, outcome: { status: "interrupted", detail: "No completed reply was confirmed." } });
      signal.addEventListener("abort", abort, { once: true });
      this.ports.requestTurn(participantId);
    });
  }

  has(participantId: string): boolean {
    return this.tasks.has(participantId);
  }

  block(participantId: string): string | undefined {
    if (this.disposed || !this.tasks.has(participantId)) return undefined;
    const human = this.ports.humanName();
    const task = this.disposed ? undefined : this.tasks.get(participantId);
    if (!task) return undefined;
    return `<automation-task>\nSaved by ${human}: ${task.run.job.name}\n${task.run.job.text}\n\nThis task is assigned to you using this room's context and existing permissions. Your final reply will be shown in the room without waking other participants. Finish with the result, or [silent] if there is nothing to report.\n</automation-task>`;
  }

  ended(participantId: string, outcome: AutomationOutcome): void {
    const task = this.tasks.get(participantId);
    if (task) task.outcome = outcome;
  }

  failed(participantId: string, detail: string): void {
    this.ended(participantId, { status: "failed", detail });
  }

  delivered(participantId: string, stored: boolean, messageId: string): void {
    const task = this.tasks.get(participantId);
    if (!task) return;
    task.outcome = stored ? { ...task.outcome, delivery: "posted", messageId }
      : { ...task.outcome, delivery: "unconfirmed", detail: "The reply finished but could not be durably recorded. Its delivery is unconfirmed." };
  }

  continuing(participantId: string, value: boolean): void {
    const task = this.tasks.get(participantId);
    if (task) task.continuing = value;
  }

  turnSubscriber(): TurnSubscriber {
    const begun = new WeakMap<Turn, AutomationTask>();
    return {
      turnStarted: (turn) => {
        const task = this.tasks.get(turn.id);
        if (task) { task.continuing = false; begun.set(turn, task); }
      },
      turnEnded: (turn) => {
        const { id, runtime } = turn;
        const was = begun.get(turn), task = this.tasks.get(id);
        begun.delete(turn);
        if (!was || task !== was) return;
        if (task.continuing && !runtime.work.workCancelled) {
          const closing = this.ports.closing();
          if (this.tasks.get(id) !== task || !closing) return;
        }
        this.finish(id);
      },
      sessionEnded: (id) => this.finish(id, { status: "interrupted", detail: "The assigned session ended before the result was confirmed." }),
      turnDropped: (id, runtime) => {
        if (!runtime?.work.workBusy && !runtime?.work.turnActive) this.finish(id, { status: "cancelled", detail: "Stopped before the task began." });
      },
      doorClosed: () => {
        for (const [id, task] of this.tasks) {
          if (!task.runtime.work.workBusy && !task.runtime.work.turnActive) this.finish(id, { status: "interrupted", detail: "The room stopped before the task began." });
        }
      },
    };
  }

  private finish(participantId: string, outcome?: AutomationOutcome): void {
    const task = this.tasks.get(participantId);
    if (!task) return;
    this.tasks.delete(participantId);
    task.cleanup();
    task.resolve(outcome ?? task.outcome);
  }
}
