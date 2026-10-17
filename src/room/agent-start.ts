// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { classifyStartFailure, type Trouble } from "../agent-health.js";
import { describeError } from "../jsonrpc.js";
import type { AgentRecipe } from "../recipes.js";
import type { SeenVibemate } from "./vibemate-seen.js";

export type StartOrigin = "new" | "loaded" | "replayed";

export function readyLine(input: { name: string; fresh: boolean; origin: StartOrigin; reason?: string; detail: string; tagline?: string }): string {
  if (input.fresh) return `${input.name} joined the room (${input.detail}${input.tagline ? `; "${input.tagline}"` : ""}).`;
  if (input.origin === "loaded") return `${input.name} is back in the room (session restored).`;
  return input.reason ? `${input.name} restarted: ${input.reason}.` : `${input.name} is back in the room.`;
}

export function loadedPointer(storedSeen: number | undefined, seq: number, replayAfterRestart: number): number {
  return storedSeen ?? Math.max(0, seq - replayAfterRestart);
}

export function replayPointer(chats: readonly { seq: number }[], replay: number, seq: number): number {
  const firstReplayed = replay > 0 && chats.length ? chats[Math.max(0, chats.length - replay)] : undefined;
  return firstReplayed ? Math.max(0, firstReplayed.seq - 1) : seq;
}

export interface StartFailurePorts {
  markFailed(seen: SeenVibemate, detail: string, trouble: Trouble): boolean;
  markStatus(seen: SeenVibemate, fresh: boolean): boolean;
  carried(seen: SeenVibemate): { detail: string; trouble: Trouble } | undefined;
  publish(seen: SeenVibemate): boolean;
  remove(seen: SeenVibemate): boolean;
  log(text: string): void;
}

export function failStart(seen: SeenVibemate, error: unknown, fresh: boolean, stderr: string[], recipe: AgentRecipe | undefined, ports: StartFailurePorts): Error {
  const participant = seen.participant;
  const detail = describeError(error);
  const trouble = classifyStartFailure({
    error: detail,
    stderr,
    vendor: recipe?.vendor ?? participant.agentVendor ?? "The coding agent",
    loginCommand: recipe?.loginCommand || undefined,
    installHint: recipe?.installHint || undefined,
    loginState: recipe?.loginState,
    loginFromHere: !!recipe && recipe.loginFlow.kind !== "none",
  });
  const failure = new Error(`${trouble.what} ${trouble.advice} (${detail})`);
  const logged = () => ports.log(`${participant.name}: failed to start: ${detail}`);
  if (!ports.markFailed(seen, detail, trouble)) { logged(); return failure; }
  logged();
  if (!ports.markStatus(seen, fresh) || !ports.publish(seen)) return failure;
  const now = ports.carried(seen);
  if (fresh) ports.remove(seen);
  return now ? new Error(`${now.trouble.what} ${now.trouble.advice} (${now.detail})`) : failure;
}
