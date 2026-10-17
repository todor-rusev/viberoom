// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { PromptResult } from "../acp-types.js";
import { classifyTurnFailure, type Trouble } from "../agent-health.js";
import { isBareContextFullError } from "../context.js";
import { REQUEST_BRIEF_MARKER, SILENT_MARKER, skillPull } from "../persona.js";

export const ADAPTER_ERROR_PATTERN =
  /^(?:Warning: Falling back from WebSockets|unexpected status \d{3}|Error when talking to|API Error|You have exhausted your (?:daily )?quota|Rate limit|429 |5\d\d )/i;

export function settleEnd(end: { result: PromptResult | null; failure: string | null; roomStopped: boolean }): { result: PromptResult | null; failure: string | null; settledByRoom: boolean } {
  if ((end.failure || !end.result) && end.roomStopped) return { result: { stopReason: "cancelled" }, failure: null, settledByRoom: true };
  return { result: end.result, failure: end.failure, settledByRoom: false };
}

export interface FailureFacts {
  readonly failure: string | null;
  readonly code: string;
  readonly vendor: string;
  readonly alive: boolean;
  readonly loginCommand?: string;
  readonly loginFromHere: boolean;
  readonly previous?: Trouble;
}

export function failedTurn(facts: FailureFacts): { trouble: Trouble; paused: boolean } {
  const trouble = classifyTurnFailure({ error: facts.failure ?? "no result", code: facts.code, vendor: facts.vendor, alive: facts.alive,
    loginCommand: facts.loginCommand, loginFromHere: facts.loginFromHere });
  const again = facts.previous?.stage === "turn" && facts.previous.kind === trouble.kind;
  trouble.streak = again ? (facts.previous?.streak ?? 1) + 1 : 1;
  if (trouble.streak >= 2 && trouble.kind === "unknown" && trouble.actions?.includes("respawn")) {
    trouble.actions = ["respawn", ...trouble.actions.filter((a) => a !== "respawn")];
    trouble.advice = "It failed the same way twice in a row: respawn it (a fresh session with its notes and the last messages; the history stays), or press Retry if it was a passing thing.";
  } else if (trouble.streak >= 2 && (trouble.kind === "limit" || trouble.kind === "network")) {
    trouble.advice = `${trouble.advice} It has failed this way ${trouble.streak} times in a row: give it a few minutes first.`;
  }
  return { trouble, paused: !facts.alive || trouble.kind === "login" || trouble.streak >= 2 };
}

export function keepsFailedBubble(turn: { published: boolean; hidden: boolean; retry: boolean; hasWork: boolean }): boolean {
  return turn.published && !turn.hidden && !turn.retry && turn.hasWork;
}

export function endedBy(turn: { cancelled: boolean; workCancelled: boolean; roomStopped: boolean }): "human" | "room" | "agent" | undefined {
  if (!turn.cancelled) return undefined;
  return turn.workCancelled ? "human" : turn.roomStopped ? "room" : "agent";
}

export function notesMissAfterReply(turn: { asked: boolean; hadNotes: boolean; retry: boolean; cancelled: boolean; misses: number }): { misses: number; askHidden: boolean } | undefined {
  if (!turn.asked || turn.hadNotes || turn.retry || turn.cancelled) return undefined;
  const misses = turn.misses + 1;
  return misses >= 2 ? { misses: 0, askHidden: true } : { misses, askHidden: false };
}

export function briefAskedAgain(pointers: { briefRequestedAtSeq?: number; lastSeenSeq: number }): boolean {
  return pointers.briefRequestedAtSeq === pointers.lastSeenSeq;
}

export type ReplyKind =
  | { kind: "notes_only" }
  | { kind: "request_brief" }
  | { kind: "skill_pull"; name: string }
  | { kind: "silent"; keepBubble: boolean }
  | { kind: "adapter_error"; contextFull: boolean }
  | { kind: "reply" };

export function replyKind(turn: { text: string; hidden: boolean; retry: boolean; cancelled: boolean; hasToolCalls: boolean }): ReplyKind {
  if (turn.hidden) return { kind: "notes_only" };
  const lower = turn.text.toLowerCase();
  if (!turn.retry && lower === REQUEST_BRIEF_MARKER) return { kind: "request_brief" };
  const pull = !turn.retry ? skillPull(turn.text) : null;
  if (pull) return { kind: "skill_pull", name: pull };
  if (!turn.text || lower === SILENT_MARKER) return { kind: "silent", keepBubble: turn.cancelled && !turn.retry && turn.hasToolCalls };
  const contextFull = isBareContextFullError(turn.text);
  if (!turn.hasToolCalls && (ADAPTER_ERROR_PATTERN.test(turn.text) || contextFull)) return { kind: "adapter_error", contextFull };
  return { kind: "reply" };
}
