// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
export const MESSAGE_REF_RE = /(?<![\p{L}\p{N}_&#\/\\])#([1-9]\d{0,8})(?![\p{L}\p{N}_])/gu;

const CODE_RE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

export function citedNumbers(text: string): number[] {
  const seen = new Set<number>();
  for (const match of text.replace(CODE_RE, " ").matchAll(MESSAGE_REF_RE)) seen.add(Number(match[1]));
  return [...seen];
}

export interface CitedNumber { written: number; here: number | null }

export function numbersNote(copy: string, cited: readonly CitedNumber[]): string {
  const differ = cited.filter(c => c.here !== c.written);
  if (!differ.length) return "";
  const said = differ.map(c => c.here === null ? `#${c.written} is not in this room` : `#${c.written} is #${c.here}`).join(", ");
  return `[The numbers in this message are those of the room's copy on ${copy}, where it was written; in this room: ${said}]`;
}
