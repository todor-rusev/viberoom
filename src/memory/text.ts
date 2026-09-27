// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import type { StoredMessage } from "../history-store.js";
import { MENTION_PATTERN } from "../mentions.js";
import { AUDIO_MARKER_PATTERN, IMAGE_MARKER_PATTERN, QUOTE_MARKER_PATTERN, VIDEO_MARKER_PATTERN } from "../persona.js";
import type { Quote } from "../quotes.js";

type Said = Pick<StoredMessage, "text" | "quotes" | "audio">;

const QUOTE_AT = new RegExp(`[ \\t]*${QUOTE_MARKER_PATTERN.source}[ \\t]*`, "gi");
const IMAGE_AT = new RegExp(`[ \\t]*${IMAGE_MARKER_PATTERN.source}`, "gi");
const AUDIO_AT = new RegExp(AUDIO_MARKER_PATTERN.source, "gi");

function heardWords(message: Said): Map<number, string> {
  return new Map((message.audio ?? []).flatMap((sound, i) => (sound.words?.trim() ? [[sound.n ?? i + 1, sound.words.trim()] as [number, string]] : [])));
}

function quoteLines(quote: Quote): string {
  const [first = "", ...rest] = quote.text.trim().split(/\r?\n/);
  return [`> ${quote.fromName}: ${first}`, ...rest.map((line) => `> ${line}`)].join("\n");
}

export function memoryText(message: Said): string {
  const quotes = new Map((message.quotes ?? []).map((quote) => [quote.n, quote]));
  const heard = heardWords(message);
  const placed = new Set<number>();
  const said = new Set<number>();
  let text = message.text
    .replace(QUOTE_AT, (_marker, n: string) => {
      const quote = quotes.get(Number(n));
      if (!quote) return " ";
      placed.add(quote.n);
      return `\n${quoteLines(quote)}\n`;
    })
    .replace(AUDIO_AT, (_marker, n: string) => {
      const words = heard.get(Number(n));
      if (words === undefined) return "";
      said.add(Number(n));
      return words;
    })
    .replace(IMAGE_AT, "")
    .replace(VIDEO_MARKER_PATTERN, "");
  const unsaid = [...heard].filter(([n]) => !said.has(n)).sort(([a], [b]) => a - b).map(([, words]) => words);
  if (unsaid.length) text += `\n${unsaid.join("\n")}`;
  const unplaced = [...quotes.values()].filter((quote) => !placed.has(quote.n)).sort((a, b) => a.n - b.n);
  if (unplaced.length) text += `\n${unplaced.map(quoteLines).join("\n")}`;
  return text.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function searchText(message: Said): string {
  const own = message.text.replace(QUOTE_MARKER_PATTERN, " ").replace(IMAGE_MARKER_PATTERN, " ").replace(AUDIO_MARKER_PATTERN, " ").replace(VIDEO_MARKER_PATTERN, " ").replace(MENTION_PATTERN, " ");
  const spoken = [...heardWords(message)].sort(([a], [b]) => a - b).map(([, words]) => words);
  const quoted = [...(message.quotes ?? [])].sort((a, b) => a.n - b.n).map((quote) => quote.text);
  return [own, ...spoken, ...quoted].map((words) => words.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}
