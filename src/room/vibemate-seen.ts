// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { Participant } from "../room.js";
import type { AgentRuntime } from "./agent-runtime.js";

export interface Held {
  participant: Participant | undefined;
  runtime: AgentRuntime | undefined;
}

export interface SeenVibemate {
  readonly participant: Participant;
  readonly runtime?: AgentRuntime | null;
}

export function stillHeld(seen: SeenVibemate, now: Held): boolean {
  return now.participant === seen.participant && (seen.runtime === undefined || (now.runtime ?? null) === seen.runtime);
}
