// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export const NOTES_THRESHOLD = 0.8;

export const NOTES_REQUEST =
  "end your reply with a <notes> block: up to 10 lines on this room, your task and where you are with it; the block is kept by the hub for a restart and is not posted";

export const NOTES_ONLY_PROMPT =
  "Reply with a <notes> block only: up to 10 lines on this room, your task and where you are with it, written for a future you that starts with an empty head. Nothing else; nothing is posted.";

const OPEN = /<notes>/i;
const BLOCK = /\s*<notes>([\s\S]*?)(?:<\/notes>|$)\s*/i;

export function extractNotes(text: string): { visible: string; notes: string | null } {
  const m = BLOCK.exec(text);
  if (!m) return { visible: text, notes: null };
  const notes = m[1].trim();
  const before = text.slice(0, m.index).replace(/\s+$/, "");
  const after = text.slice(m.index + m[0].length).replace(/^\s+/, "");
  const visible = before && after ? `${before} ${after}` : before || after;
  return { visible, notes: notes || null };
}

export function visibleChunk(textBefore: string, chunk: string): string {
  if (OPEN.test(textBefore)) return "";
  const at = chunk.search(OPEN);
  return at < 0 ? chunk : chunk.slice(0, at);
}

export function crossedThreshold(previousUsed: number, used: number, size: number, threshold = NOTES_THRESHOLD): boolean {
  if (!(size > 0)) return false;
  return used / size >= threshold && previousUsed / size < threshold;
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
