// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { spokenText } from "./spoken-text.js";


export const NOTES_THRESHOLD = 0.8;

export const NOTES_REQUEST =
  "end your reply with a <notes> block: up to 10 lines on this room, your task and where you are with it; the block is kept by the hub for a restart and is not posted";

export const NOTES_ONLY_PROMPT =
  "Reply with a <notes> block only: up to 10 lines on this room, your task and where you are with it, written for a future you that starts with an empty head. Nothing else; nothing is posted.";

const OPEN = /<notes>/i;
const OPEN_ALL = /<notes>/gi;
const CLOSE = /<\/notes>/i;

function notesStart(said: string): number {
  let at = -1;
  for (const m of said.matchAll(OPEN_ALL)) at = m.index ?? at;
  return at;
}

export function extractNotes(text: string): { visible: string; notes: string | null } {
  const said = spokenText(text);
  const at = notesStart(said);
  if (at < 0) return { visible: text, notes: null };
  const bodyAt = at + MARKER.length;
  const closing = CLOSE.exec(said.slice(bodyAt));
  const bodyEnd = closing ? bodyAt + closing.index : text.length;
  const end = closing ? bodyEnd + closing[0].length : text.length;
  const notes = text.slice(bodyAt, bodyEnd).trim();
  const before = text.slice(0, at).replace(/\s+$/, "");
  const after = text.slice(end).replace(/^\s+/, "");
  const visible = before && after ? `${before} ${after}` : before || after;
  return { visible, notes: notes || null };
}

const MARKER = "<notes>";

function unsettledTail(text: string): number {
  for (let n = Math.min(MARKER.length - 1, text.length); n > 0; n--) {
    if (text.slice(-n).toLowerCase() === MARKER.slice(0, n)) return n;
  }
  return 0;
}

export function settledVisible(whole: string): string {
  const at = spokenText(whole).search(OPEN);
  if (at >= 0) return whole.slice(0, at);
  return whole.slice(0, whole.length - unsettledTail(whole));
}

export function crossedThreshold(previousUsed: number, used: number, size: number, threshold = NOTES_THRESHOLD): boolean {
  if (!(size > 0)) return false;
  return used / size >= threshold && previousUsed / size < threshold;
}

export function emptyUsageReport(previousUsed: number, used: number): boolean {
  return previousUsed > 0 && used === 0;
}

export function looksCompacted(previousUsed: number, used: number): boolean {
  return previousUsed > 0 && used > 0 && used < previousUsed * 0.7;
}

export function overThreshold(used: number, size: number, threshold = NOTES_THRESHOLD): boolean {
  return size > 0 && used / size >= threshold;
}

const CONTEXT_FULL = /context (window )?(is )?(full|too long|exceeded|limit)|prompt is too long|maximum context length|input (length|is too long)|too many tokens|exceeds the (context|token) (window|limit)|context_length_exceeded/i;

export function isContextFullError(text: string | null | undefined): boolean {
  return !!text && CONTEXT_FULL.test(text);
}

const BARE_PREFIX = /^\s*(?:\[?(?:error|api error|request failed)\]?\s*[:\-]?\s*)?(?:\d{3}\s+)?/i;

export function isBareContextFullError(text: string | null | undefined): boolean {
  if (!text || text.length > 240 || text.includes("\n")) return false;
  const rest = text.replace(BARE_PREFIX, "");
  const m = CONTEXT_FULL.exec(rest);
  return !!m && m.index === 0;
}
