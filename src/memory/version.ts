// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { createHash } from "node:crypto";
import type { StoredMessage } from "../history-store.js";
import { visibleToAgents } from "../quotes.js";

const SCHEMA = "viberoom-memory-source-v1";

export type VersionedSource = Pick<StoredMessage, "id" | "from" | "fromName" | "ts" | "edited" | "text" | "quotes" | "audio" | "kind" | "audience">;

export function memoryVersion(message: VersionedSource): string {
  const quotes = [...new Map((message.quotes ?? []).map(quote => [quote.n, [quote.fromName, quote.text]] as const))].sort(([a], [b]) => a - b);
  const heard = [...new Map((message.audio ?? []).flatMap((sound, i) => sound.words?.trim() ? [[sound.n ?? i + 1, sound.words.trim()] as const] : []))]
    .sort(([a], [b]) => a - b);
  const content = [SCHEMA, message.id, message.from, message.fromName, message.ts, message.edited?.ts ?? null, message.text, quotes, heard, visibleToAgents(message)];
  return `sha256:${createHash("sha256").update(JSON.stringify(content)).digest("hex")}`;
}
