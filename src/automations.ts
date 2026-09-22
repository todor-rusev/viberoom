// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { AutomationStore, type AutomationJob, type AutomationRun, type AutomationRunStatus } from "./automation-store.js";

export interface AutomationOutcome {
  status: Extract<AutomationRunStatus, "completed" | "failed" | "cancelled" | "interrupted"> | "deferred";
  detail?: string;
  messageId?: string;
  delivery?: AutomationRun["delivery"];
}
export interface AutomationDriver {
  prepare(job: AutomationJob): Promise<string | null>;
  execute(run: AutomationRun, signal: AbortSignal): Promise<AutomationOutcome>;
}

export class Automations {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private stopped = false;
  private readonly active = new Map<string, { roomKey: string; controller: AbortController; timer: ReturnType<typeof setTimeout> }>();
  private readonly completions = new Map<string, { run: AutomationRun; outcome: AutomationOutcome; finishedAt: number }>();
  private fault = "";
  constructor(readonly store: AutomationStore, private readonly driver: AutomationDriver,
    private readonly changed: () => void, private readonly warn: (message: string) => void,
    private readonly now = Date.now) {}

  get error(): string { return this.fault; }
  start(): void {
    if (this.stopped || this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, 5000);
    this.timer.unref(); void this.tick();
  }
  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      this.flushCompletions();
      let changed = this.store.due(this.now());
      for (const pending of this.store.runs(undefined, "waiting")) {
        if (pending.source === "schedule" && pending.job.catchUp === "skip" && this.now() - pending.scheduledAt > 60000) {
          this.store.finish(pending.id, pending.roomKey, "skipped", "The scheduled time passed while work could not start.", this.now()); changed = true; continue;
        }
        if (this.stopped || this.active.size >= 4) break;
        if ([...this.active.values()].some(run => run.roomKey === pending.roomKey)) continue;
        let reason: string | null;
        try { reason = await this.driver.prepare(pending.job); }
        catch (error) { reason = error instanceof Error ? error.message : String(error); }
        if (this.stopped) break;
        if (reason) { changed = this.store.waiting(pending.id, pending.roomKey, reason) || changed; continue; }
        const run = this.store.start(pending.id, pending.roomKey, this.now());
        if (!run) continue;
        changed = true;
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(new Error("The run reached its time limit.")); this.changed(); }, run.job.maxMinutes * 60000);
        timer.unref();
        this.active.set(run.id, { roomKey: run.roomKey, controller, timer });
        void Promise.resolve().then(() => this.driver.execute(run, controller.signal)).then(
          outcome => this.complete(run, outcome),
          error => this.complete(run, { status: "failed", detail: error instanceof Error ? error.message : String(error) }),
        );
      }
      if (this.fault && !this.completions.size) { this.fault = ""; changed = true; }
      if (changed) this.changed();
    } catch (error) { this.failure(error); }
    finally { this.ticking = false; }
  }
  private complete(run: AutomationRun, outcome: AutomationOutcome): void {
    const active = this.active.get(run.id);
    if (active) clearTimeout(active.timer);
    this.completions.set(run.id, { run, outcome, finishedAt: this.now() });
    try { this.flushCompletions(); } catch (error) { this.failure(error); }
  }
  private flushCompletions(): void {
    for (const [id, { run, outcome, finishedAt }] of this.completions) {
      if (outcome.status === "deferred") this.store.defer(id, run.roomKey, outcome.detail ?? "Waiting for the room.");
      else this.store.finish(id, run.roomKey, outcome.status, outcome.detail ?? "", finishedAt, outcome.messageId, outcome.delivery);
      this.completions.delete(id); this.active.delete(id); this.changed();
    }
  }
  private failure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== this.fault) { this.fault = message; this.warn(`Automations: ${message}`); this.changed(); }
  }
  cancel(roomKey: string, id: string): void {
    const run = this.store.run(roomKey, id);
    if (run.status === "waiting") this.store.finish(id, roomKey, "cancelled", "Cancelled before it started.", this.now());
    else if (run.status === "running") this.active.get(id)?.controller.abort(new Error("Cancelled by the human."));
    this.changed();
  }
  stopping(id: string): boolean { return this.active.get(id)?.controller.signal.aborted ?? false; }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const run of this.active.values()) { clearTimeout(run.timer); run.controller.abort(new Error("Viberoom is stopping.")); }
  }
  close(): void { this.stop(); this.store.close(this.now()); }
}
