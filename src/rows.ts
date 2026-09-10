// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export type RowTone = "attention" | "error" | "hush";

const LEGACY: Array<[RegExp, RowTone]> = [
  [/^(Hush|Focus):/, "hush"],
  [/ could not answer: /, "error"],
  [/'s agent reported an error instead of a reply/, "error"],
  [/ ran out of context/, "error"],
  [/ was stopped\b/, "attention"],
  [/^Hop limit \d+ reached/, "attention"],
  [/ is at \d+% of its context/, "attention"],
  [/ compacted its context/, "attention"],
  [/ proposes changes to the room/, "attention"],
  [/ was respawned while offline/, "attention"],
];

export function legacyRowTone(text: string): RowTone | undefined {
  for (const [pattern, tone] of LEGACY) if (pattern.test(text)) return tone;
  return undefined;
}
