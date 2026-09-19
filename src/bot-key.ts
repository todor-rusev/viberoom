// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export function findBotKeys(text: string): string[] {
  const exact = distinct(text.matchAll(/[0-9]{5,}:[A-Za-z0-9_-]{35}/g));
  if (exact.length) return exact;
  return distinct(text.matchAll(/[0-9]{5,}:[A-Za-z0-9_-]{20,}/g));
}

export function pickBotKey(text: string): string {
  const keys = findBotKeys(text);
  if (keys.length === 1) return keys[0];
  if (keys.length === 0) throw new Error("I could not find a key in what you pasted. BotFather's reply has a line like 123456789:AAF…; that line is the key, or paste the key on a line of its own.");
  throw new Error("More than one key in what you pasted; paste just one — the newest line BotFather sent.");
}

function distinct(matches: Iterable<RegExpMatchArray>): string[] {
  return [...new Set([...matches].map((m) => m[0]))];
}
