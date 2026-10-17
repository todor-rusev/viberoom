// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { Participant } from "../room.js";
import type { AgentRuntime } from "./agent-runtime.js";
import type { Turn } from "./turn-life.js";
import type { Held } from "./vibemate-seen.js";

export interface TurnOrderSettings {
  readonly turnTaking: "parallel" | "one-at-a-time";
  readonly waitWhileHumanTypes: boolean;
  readonly replyDelay?: number;
}

export interface TurnOwner {
  readonly id: string;
  readonly participant: Participant;
  readonly runtime: AgentRuntime;
}

export interface TurnRequest {
  readonly addressed?: boolean;
  readonly missedNotice?: boolean;
  readonly backgroundCorrection?: boolean;
  readonly cause?: "ordinary" | "native" | "resume";
}

export interface TurnOrderPorts {
  current(id: string): Held;
  sessions(): readonly string[];
  settings(): TurnOrderSettings;
  recordHold(): boolean;
  nativeLaneBlocked(runtime: AgentRuntime): boolean;
  showQueued(participant: Participant): void;
  showUnqueued(participant: Participant): void;
  recover(participant: Participant): void;
  run(owner: TurnOwner): void;
  log(runtime: AgentRuntime, text: string): void;
}

export const TYPING_HOLD_CAP_MS = 12_000;
const TYPING_WINDOW_MS = 4000;

export class TurnOrder {
  hops = 0;
  focused = false;
  private speaker: Turn | null = null;
  private floor: TurnOwner[] = [];
  private typingUntil = 0;
  private typingSince = 0;
  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly armed = new Map<AgentRuntime, { owner: TurnOwner; timer: ReturnType<typeof setTimeout> }>();
  private disposed = false;

  constructor(private readonly ports: TurnOrderPorts) {}

  get speaking(): string | null {
    return this.speaker?.id ?? null;
  }

  resetHops(): void {
    this.hops = 0;
  }

  countHop(): void {
    this.hops += 1;
  }

  hush(): boolean {
    if (this.focused) return false;
    this.focused = true;
    return true;
  }

  endHush(): boolean {
    if (!this.focused) return false;
    this.focused = false;
    return true;
  }

  request(id: string, why: TurnRequest = {}): void {
    if (this.disposed) return;
    if (this.ports.recordHold() || this.disposed) return;
    const { participant, runtime } = this.ports.current(id);
    if (this.disposed || !runtime || !participant) return;
    const owner: TurnOwner = { id, participant, runtime };
    const cause = why.cause ?? "ordinary";
    if (!why.backgroundCorrection && cause === "ordinary") runtime.queue.independentPendingTurn = true;
    if (!why.backgroundCorrection && runtime.native.backgroundCorrections?.length) runtime.native.backgroundBacklogPending = true;
    runtime.queue.pendingTurn = true;
    runtime.queue.missedNotice = !!why.missedNotice;
    if (runtime.session.retiring) return;
    if (participant.muted || this.focused) return;
    if (participant.status === "error") {
      const trouble = participant.trouble;
      const canResume = !!why.addressed && runtime.session.agent.alive && trouble?.stage === "turn" && trouble.kind !== "crash";
      if (!canResume) return;
      this.ports.recover(participant);
      if (!this.holds(owner)) return;
    }
    if (why.addressed && !runtime.queue.addressed) {
      runtime.queue.addressed = true;
      const place = this.placeOf(owner);
      if (place >= 0) {
        const [entry] = this.floor.splice(place, 1);
        this.enqueue(entry);
      }
    }
    const armed = this.armed.get(runtime);
    if (armed && armed.owner.participant !== participant) this.clearTimer(runtime);
    if (runtime.work.turnActive || runtime.work.workBusy || runtime.queue.delayTimer || this.placeOf(owner) >= 0) return;
    if (this.ports.nativeLaneBlocked(runtime) || this.disposed) return;
    let others = 0;
    for (const other of this.ports.sessions()) {
      if (this.disposed) return;
      if (other !== id && this.ports.current(other).participant?.status !== "left") others++;
    }
    if (this.disposed) return;
    const roomDelay = others >= 1 ? (this.ports.settings().replyDelay ?? 0) : 0;
    if (!this.holds(owner)) return;
    const maxMs = Math.max(0, participant.replyDelay ?? roomDelay) * 1000;
    const waitMs = maxMs > 0 ? Math.round(Math.random() * maxMs) : 0;
    this.ports.showQueued(participant);
    if (!this.holds(owner) || runtime.queue.delayTimer || this.placeOf(owner) >= 0) return;
    const timer = setTimeout(() => {
      if (this.armed.get(runtime)?.timer === timer) { runtime.queue.delayTimer = null; this.armed.delete(runtime); }
      this.tryStart(owner);
    }, waitMs);
    runtime.queue.delayTimer = timer;
    this.armed.set(runtime, { owner, timer });
    if (waitMs) this.ports.log(runtime, `reply delay ${waitMs} ms`);
  }

  tryStart(owner: TurnOwner): void {
    const { runtime } = owner;
    if (this.disposed || !runtime.queue.pendingTurn || runtime.work.turnActive || runtime.work.workBusy) return;
    if (this.ports.nativeLaneBlocked(runtime) || this.disposed) return;
    const typing = this.humanIsTyping();
    if (this.disposed) return;
    if (typing) {
      if (!this.holds(owner)) return;
      this.enqueue(owner);
      this.armTypingTimer();
      return;
    }
    const oneAtATime = this.ports.settings().turnTaking === "one-at-a-time";
    if (!this.holds(owner)) return;
    if (oneAtATime && this.speaker && this.speaker.id !== owner.id) {
      this.enqueue(owner);
      return;
    }
    this.ports.run(owner);
  }

  private enqueue(entry: TurnOwner): void {
    if (this.placeOf(entry) >= 0) return;
    if (entry.runtime.queue.addressed) {
      const firstPlain = this.floor.findIndex((other) => !other.runtime.queue.addressed);
      if (firstPlain >= 0) {
        this.floor.splice(firstPlain, 0, entry);
        return;
      }
    }
    this.floor.push(entry);
  }

  private placeOf(owner: TurnOwner): number {
    return this.floor.findIndex((entry) => entry.id === owner.id && entry.participant === owner.participant && entry.runtime === owner.runtime);
  }

  queued(): string[] {
    return this.floor.map((entry) => entry.id);
  }

  waiting(owner: TurnOwner): boolean {
    return this.placeOf(owner) >= 0;
  }

  defer(owner: TurnOwner): void {
    this.clearTimer(owner.runtime);
    const place = this.placeOf(owner);
    if (place >= 0) this.floor.splice(place, 1);
  }

  private leaveFloor(id: string, runtime: AgentRuntime): void {
    this.floor = this.floor.filter((entry) => entry.id !== id || entry.runtime !== runtime);
  }

  private humanIsTyping(): boolean {
    const now = Date.now();
    return this.ports.settings().waitWhileHumanTypes && now < this.typingUntil && now - this.typingSince < TYPING_HOLD_CAP_MS;
  }

  humanTyping(): void {
    if (this.disposed) return;
    if (Date.now() >= this.typingUntil) this.typingSince = Date.now();
    this.typingUntil = Date.now() + TYPING_WINDOW_MS;
    this.armTypingTimer();
  }

  messageArrived(): void {
    this.typingUntil = 0;
  }

  private armTypingTimer(): void {
    if (this.typingTimer || this.disposed) return;
    const wait = Math.max(50, this.typingUntil - Date.now() + 20);
    this.typingTimer = setTimeout(() => {
      this.typingTimer = null;
      const typing = this.humanIsTyping();
      if (this.disposed) return;
      if (typing) {
        this.armTypingTimer();
        return;
      }
      this.next();
    }, wait);
  }

  next(): void {
    if (this.disposed) return;
    const typing = this.humanIsTyping();
    if (this.disposed) return;
    if (typing) {
      this.armTypingTimer();
      return;
    }
    const oneAtATime = this.ports.settings().turnTaking === "one-at-a-time";
    if (this.disposed || oneAtATime && this.speaker) return;
    while (this.floor.length && !this.disposed) {
      const owner = this.floor.shift()!, { participant, runtime } = owner;
      if (!runtime.queue.pendingTurn || runtime.work.turnActive || runtime.work.workBusy || participant.muted || this.focused || participant.status === "error") continue;
      if (this.ports.nativeLaneBlocked(runtime) || !this.holds(owner)) continue;
      this.ports.run(owner);
      if (oneAtATime) return;
    }
  }

  drop(id: string, runtime: AgentRuntime | undefined): void {
    if (runtime) {
      runtime.queue.pendingTurn = false;
      runtime.queue.independentPendingTurn = false;
      runtime.notes.deferredNotesTurn = false;
      runtime.queue.addressed = false;
      this.clearTimer(runtime);
      this.leaveFloor(id, runtime);
    }
  }

  sessionEnded(id: string, runtime: AgentRuntime): void {
    this.clearTimer(runtime);
    this.leaveFloor(id, runtime);
  }

  private clearTimer(runtime: AgentRuntime): void {
    if (runtime.queue.delayTimer) clearTimeout(runtime.queue.delayTimer);
    runtime.queue.delayTimer = null;
    this.armed.delete(runtime);
  }

  begin(turn: Turn): void {
    if (!this.disposed) this.speaker = turn;
  }

  end(turn: Turn): void {
    if (this.speaker === turn) this.speaker = null;
  }

  standDown(runtime: AgentRuntime): void {
    if (this.speaker?.runtime === runtime) this.speaker = null;
  }

  closeDoor(): void {
    if (this.disposed) return;
    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.typingTimer = null;
    for (const id of this.ports.sessions()) {
      if (this.disposed) return;
      const runtime = this.ports.current(id).runtime;
      if (!runtime || this.disposed) continue;
      this.clearTimer(runtime);
      runtime.queue.pendingTurn = false;
      runtime.queue.independentPendingTurn = false;
      runtime.notes.deferredNotesTurn = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.typingTimer) clearTimeout(this.typingTimer);
    this.typingTimer = null;
    for (const runtime of [...this.armed.keys()]) this.clearTimer(runtime);
    this.floor = [];
    this.speaker = null;
  }

  private holds(owner: TurnOwner): boolean {
    if (this.disposed) return false;
    const now = this.ports.current(owner.id);
    return !this.disposed && now.participant === owner.participant && now.runtime === owner.runtime;
  }
}
