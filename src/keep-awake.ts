// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { Logger } from "./log.js";

export type KeepAwake = "always" | "plugged-in" | "never";
export const KEEP_AWAKE: readonly KeepAwake[] = ["always", "plugged-in", "never"];
export const KEEP_AWAKE_DEFAULT: KeepAwake = "plugged-in";

export function keepAwakeOf(value: unknown): KeepAwake {
  return KEEP_AWAKE.includes(value as KeepAwake) ? (value as KeepAwake) : KEEP_AWAKE_DEFAULT;
}

export const QUIET_LIMIT_MS = 60 * 60_000;
export const REVIEW_MS = 60_000;
export const RETRY_MS = 10 * 60_000;
export const HOLD_REASON = "vibemates are working";

export interface Working {
  room: string;
  name: string;
  lastSignAt: number | null;
}

export interface WakeHold {
  release(): void;
}

export interface Power {
  readonly means: string;
  hold(reason: string, ended: (why: string) => void): WakeHold;
  onBattery(): Promise<boolean | null>;
  onChange?(listener: () => void): () => void;
}

export interface NoPower {
  readonly means: null;
  readonly missing: string;
}

export interface KeepAwakeStatus {
  choice: KeepAwake;
  means: string | null;
  missing?: string;
  holding: boolean;
  working: string[];
  quiet: string[];
  onBattery: boolean | null;
}

export interface WakeKeeperOptions {
  power: Power | NoPower;
  choice: () => KeepAwake;
  working: () => Working[];
  log: Logger;
  changed?: (status: KeepAwakeStatus) => void;
  now?: () => number;
  reviewMs?: number;
  quietLimitMs?: number;
  settleMs?: number;
  wakeFully?: (stillHeld: () => boolean) => Promise<unknown>;
}

export class WakeKeeper {
  private held: WakeHold | null = null;
  private failure: { why: string; at: number } | null = null;
  private battery: { value: boolean | null; at: number } | null = null;
  private readonly seenAt = new Map<string, number>();
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly stopListening: (() => void) | null;
  private settle: ReturnType<typeof setTimeout> | null = null;
  private looking: Promise<void> | null = null;
  private lookAgain = false;
  private closed = false;
  private current: KeepAwakeStatus;

  constructor(private readonly o: WakeKeeperOptions) {
    this.current = { choice: o.choice(), means: o.power.means, ...(o.power.means === null ? { missing: o.power.missing } : {}), holding: false, working: [], quiet: [], onBattery: null };
    this.timer = setInterval(() => this.review(), o.reviewMs ?? REVIEW_MS);
    this.timer.unref?.();
    const power = o.power;
    this.stopListening = power.means !== null && power.onChange ? power.onChange(() => { this.battery = null; this.review(); }) : null;
    this.review();
  }

  status(): KeepAwakeStatus {
    return this.current;
  }

  review(): void {
    if (this.closed || this.settle) return;
    this.settle = setTimeout(() => {
      this.settle = null;
      void this.look();
    }, this.o.settleMs ?? 200);
    this.settle.unref?.();
  }

  async look(): Promise<void> {
    if (this.looking) {
      this.lookAgain = true;
      return this.looking;
    }
    this.looking = this.decide().catch((error) => this.o.log.warn(`keeping the computer awake: ${error instanceof Error ? error.message : String(error)}`));
    try {
      await this.looking;
    } finally {
      this.looking = null;
      if (this.lookAgain && !this.closed) {
        this.lookAgain = false;
        await this.look();
      }
    }
  }

  close(): void {
    this.closed = true;
    clearInterval(this.timer);
    if (this.settle) clearTimeout(this.settle);
    this.stopListening?.();
    this.letGo("viberoom is closing");
  }

  private async decide(): Promise<void> {
    const now = (this.o.now ?? Date.now)();
    const limit = this.o.quietLimitMs ?? QUIET_LIMIT_MS;
    const choice = this.o.choice();
    const working = this.o.working();
    const seen = new Set<string>();
    const alive: string[] = [];
    const quiet: string[] = [];
    for (const w of working) {
      const key = `${w.room}\u0000${w.name}`;
      seen.add(key);
      let since = w.lastSignAt;
      if (since === null) {
        since = this.seenAt.get(key) ?? now;
        this.seenAt.set(key, since);
      } else this.seenAt.delete(key);
      (now - since < limit ? alive : quiet).push(w.name);
    }
    for (const key of [...this.seenAt.keys()]) if (!seen.has(key)) this.seenAt.delete(key);

    const power = this.o.power;
    let onBattery: boolean | null = null;
    let wanted = choice !== "never" && alive.length > 0 && power.means !== null;
    if (wanted && choice === "plugged-in" && power.means !== null) {
      onBattery = await this.batteryNow(power, now);
      wanted = onBattery !== true;
    }
    if (this.closed) return;
    if (wanted && this.failure && now - this.failure.at < RETRY_MS) wanted = false;
    if (wanted && !this.held && power.means !== null) this.holdWith(power, alive);
    else if (!wanted && this.held) this.letGo(alive.length ? (onBattery ? "on its battery" : "the setting says so") : quiet.length ? `${quiet.join(", ")} silent for over an hour` : "no vibemate is working");
    this.publish({ choice, holding: !!this.held, working: [...alive, ...quiet], quiet, onBattery, now });
  }

  private async batteryNow(power: Power, now: number): Promise<boolean | null> {
    if (this.battery && now - this.battery.at < (this.o.reviewMs ?? REVIEW_MS)) return this.battery.value;
    let value: boolean | null = null;
    try {
      value = await power.onBattery();
    } catch {
      value = null;
    }
    this.battery = { value, at: now };
    return value;
  }

  private holdWith(power: Power, alive: string[]): void {
    let hold: WakeHold | null = null;
    const early: { why: string | null } = { why: null };
    const stopped = (why: string) => {
      this.failure = { why, at: (this.o.now ?? Date.now)() };
      this.o.log.warn(`the computer is not kept awake: ${why}; asked again in ${Math.round(RETRY_MS / 60_000)} min`);
    };
    const ended = (why: string) => {
      if (!hold) {
        early.why = why;
        return;
      }
      if (this.held !== hold) return;
      this.held = null;
      stopped(why);
      this.review();
    };
    try {
      hold = power.hold(HOLD_REASON, ended);
    } catch (error) {
      stopped(error instanceof Error ? error.message : String(error));
      return;
    }
    if (early.why !== null) {
      stopped(early.why);
      return;
    }
    this.held = hold;
    this.failure = null;
    this.o.log.info(`keeping the computer awake (${power.means}): ${alive.join(", ")} working`);
    void this.o.wakeFully?.(() => this.held === hold).catch((error) => this.o.log.warn(`waking the computer fully: ${error instanceof Error ? error.message : String(error)}`));
  }

  private letGo(why: string): void {
    if (!this.held) return;
    const held = this.held;
    this.held = null;
    held.release();
    this.o.log.info(`the computer may sleep again: ${why}`);
  }

  private publish(s: { choice: KeepAwake; holding: boolean; working: string[]; quiet: string[]; onBattery: boolean | null; now: number }): void {
    const power = this.o.power;
    const missing = power.means === null ? power.missing : this.failure ? this.failure.why : undefined;
    const next: KeepAwakeStatus = { choice: s.choice, means: power.means, ...(missing ? { missing } : {}), holding: s.holding, working: s.working, quiet: s.quiet, onBattery: s.onBattery };
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.current = next;
    this.o.changed?.(next);
  }
}
