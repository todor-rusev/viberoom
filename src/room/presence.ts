// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { Trouble } from "../agent-health.js";
import type { Participant, StoredParticipant } from "../room.js";

type PresenceFields = Pick<Participant, "status" | "statusDetail" | "trouble" | "fell" | "startupSkipped" | "asleep" | "muted">;
type Presence = { -readonly [K in keyof PresenceFields]: PresenceFields[K] };

const ASLEEP = "Asleep";
const MUTED_AT_START = "Not summoned — muted";


export const humanPresence = (): Pick<Participant, "status"> => ({ status: "idle" });

export const unstaffedPresence = (): Pick<Participant, "status" | "statusDetail"> => ({ status: "unstaffed", statusDetail: "awaiting a coding agent" });

export function restoredPresence(stored: Pick<StoredParticipant, "asleep" | "muted">): Pick<Participant, "status" | "statusDetail" | "startupSkipped"> {
  return {
    status: "offline",
    statusDetail: stored.asleep ? ASLEEP : stored.muted ? MUTED_AT_START : "not connected since the room restarted",
    ...(stored.muted ? { startupSkipped: "muted" as const } : {}),
  };
}


export function queue(p: Presence): boolean {
  if (p.status !== "idle") return false;
  p.status = "queued";
  return true;
}

export function unqueue(p: Presence): boolean {
  if (p.status !== "queued") return false;
  p.status = "idle";
  return true;
}

export function startTurn(p: Presence): void {
  p.status = "thinking";
  p.statusDetail = undefined;
}

export function quietTurnEnded(p: Presence): boolean {
  if (p.status !== "thinking") return false;
  p.status = "idle";
  return true;
}

export function turnEnded(p: Presence, paused = false): void {
  p.status = paused ? "error" : "idle";
}

export function turnFailed(p: Presence, detail: string): void {
  p.statusDetail = detail;
}

export function troubled(p: Presence, trouble: Trouble): void {
  p.trouble = trouble;
}

export function agentError(p: Presence, detail: string): void {
  p.statusDetail = detail;
}

export function turnTroubleCleared(p: Presence): void {
  if (p.trouble?.stage !== "turn") return;
  p.trouble = undefined;
  p.statusDetail = undefined;
}

export function exhausted(p: Presence, detail: string): void {
  p.status = "error";
  p.statusDetail = detail;
}

export function recover(p: Presence): void {
  if (p.status === "error") p.status = "idle";
  p.trouble = undefined;
  p.statusDetail = undefined;
}


export function woken(p: Presence): boolean {
  const was = !!p.asleep;
  delete p.asleep;
  return was;
}

export function starting(p: Presence): void {
  delete p.fell;
  p.status = "starting";
  p.startupSkipped = undefined;
  p.statusDetail = undefined;
}

export function ready(p: Presence): void {
  p.status = "idle";
  p.statusDetail = undefined;
  p.trouble = undefined;
}

export function startFailed(p: Presence, detail: string, trouble: Trouble): void {
  p.statusDetail = detail;
  p.trouble = trouble;
}

export function startAbandoned(p: Presence): void {
  p.status = "error";
}

export function fellAfterStart(p: Presence): void {
  p.status = "offline";
  p.fell = true;
}

export function exited(p: Presence, detail: string): void {
  p.status = "offline";
  p.fell = true;
  p.statusDetail = detail;
}

export function forgotten(p: Presence): void {
  p.status = "offline";
  p.statusDetail = undefined;
}

export function asleep(p: Presence): void {
  p.asleep = true;
  p.status = "offline";
  p.statusDetail = ASLEEP;
  p.startupSkipped = undefined;
}

export function skippedMuted(p: Presence): boolean {
  if (!p.muted || p.status !== "offline") return false;
  p.startupSkipped = "muted";
  p.statusDetail = MUTED_AT_START;
  return true;
}

export function unmuted(p: Presence): void {
  if (p.startupSkipped !== "muted") return;
  p.startupSkipped = undefined;
  p.statusDetail = "not summoned yet; reconnect when ready";
}

export function rewrittenWhileOffline(p: Presence): void {
  p.statusDetail = "the conversation was rewritten while it was offline; reconnect replays the new history";
}

export function left(p: Presence): void {
  p.status = "left";
}
