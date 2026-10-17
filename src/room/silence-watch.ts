// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { formatQuoteTime } from "../persona.js";
import type { Participant } from "../room.js";
import type { AgentRuntime } from "./agent-runtime.js";

export const SILENCE_CHECK_MS = 60_000;
export const SILENCE_MS = 10 * 60_000;

type RunningTurn = NonNullable<AgentRuntime["work"]["turn"]>;

export interface SeenQuietTurn {
  readonly id: string;
  readonly runtime: AgentRuntime;
  readonly participant: Participant;
  readonly turn: RunningTurn;
  readonly sign: number;
}

const signOf = (turn: RunningTurn): number => turn.lastSignAt ?? turn.startedAt;

export function stillQuiet(seen: SeenQuietTurn, now: { runtime: AgentRuntime | undefined; participant: Participant | undefined; asking: boolean }): boolean {
  return now.runtime === seen.runtime && now.participant === seen.participant && !seen.participant.muted && !now.asking
    && seen.runtime.work.turnActive && seen.runtime.work.turn === seen.turn && !seen.turn.hidden && signOf(seen.turn) === seen.sign;
}

export interface SilenceWatchPorts {
  runtimes(): Iterable<[string, AgentRuntime]>;
  participant(id: string): Participant | undefined;
  askingHuman(id: string): boolean;
  markQuiet(seen: SeenQuietTurn): boolean;
  keepRecord(seen: SeenQuietTurn, reason: string): boolean;
  tell(seen: SeenQuietTurn, text: string): boolean;
}

export class SilenceWatch {
  private timer: NodeJS.Timeout | null = null;
  private readonly told = new Set<string>();
  private disposed = false;

  constructor(private readonly ports: SilenceWatchPorts) {}

  watch(): void {
    if (this.disposed || this.timer) return;
    this.timer = setInterval(() => this.check(), SILENCE_CHECK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  toldOf(turnId: string): boolean {
    return this.told.has(turnId);
  }

  check(): void {
    if (this.disposed) return;
    let active = false;
    const sessions = this.ports.runtimes();
    if (this.disposed) return;
    for (const [id, runtime] of sessions) {
      const turn = runtime.work.turn;
      if (!runtime.work.turnActive || !turn || turn.hidden) continue;
      active = true;
      const sign = signOf(turn);
      const quiet = Date.now() - sign;
      if (quiet < SILENCE_MS) continue;
      const participant = this.ports.participant(id);
      if (this.disposed) return;
      if (!participant || participant.muted) continue;
      const asking = this.ports.askingHuman(id);
      if (this.disposed) return;
      if (asking) continue;
      const seen: SeenQuietTurn = Object.freeze({ id, runtime, participant, turn, sign });
      if (!runtime.work.quiet || runtime.work.quiet.turnId !== turn.message.id) {
        const marked = this.ports.markQuiet(seen);
        if (this.disposed) return;
        if (!marked) continue;
      }
      if (this.told.has(turn.message.id)) continue;
      const minutes = Math.round(quiet / 60_000);
      const kept = this.ports.keepRecord(seen, `nothing new from ${participant.name} for ${minutes} minutes`);
      if (this.disposed) return;
      if (!kept) continue;
      this.told.add(turn.message.id);
      const said = this.ports.tell(seen, `${participant.name}: nothing new for ${minutes} minutes; its turn started at ${formatQuoteTime(turn.startedAt).slice(-5)}.`);
      if (this.disposed) return;
      if (!said) this.told.delete(turn.message.id);
    }
    if (active) return;
    this.stop();
    this.told.clear();
  }
}
