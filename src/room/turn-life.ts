// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { AgentRuntime } from "./agent-runtime.js";

export interface Turn {
  readonly id: string;
  readonly runtime: AgentRuntime;
}

export interface TurnSubscriber {
  turnStarted?(turn: Turn): void;
  turnEnded?(turn: Turn): void;
  sessionEnded?(id: string): void;
  turnDropped?(id: string, runtime: AgentRuntime | undefined): void;
  muted?(id: string): void;
  asleep?(id: string): void;
  doorClosed?(): void;
}

export class TurnLife {
  private readonly subscribers: TurnSubscriber[] = [];

  subscribe(subscriber: TurnSubscriber): void {
    this.subscribers.push(subscriber);
  }

  turnStarted(turn: Turn): void { for (const s of this.subscribers) s.turnStarted?.(turn); }
  turnEnded(turn: Turn): void { for (const s of this.subscribers) s.turnEnded?.(turn); }
  sessionEnded(id: string): void { for (const s of this.subscribers) s.sessionEnded?.(id); }
  turnDropped(id: string, runtime: AgentRuntime | undefined): void { for (const s of this.subscribers) s.turnDropped?.(id, runtime); }
  muted(id: string): void { for (const s of this.subscribers) s.muted?.(id); }
  asleep(id: string): void { for (const s of this.subscribers) s.asleep?.(id); }
  doorClosed(): void { for (const s of this.subscribers) s.doorClosed?.(); }
}
