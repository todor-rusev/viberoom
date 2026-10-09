// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { StoredMessage } from "../history-store.js";
import type { OriginalMessagePolicyProfile } from "./original-message-preparation.js";
import { createHash } from "node:crypto";
import type { OriginalMessageText } from "./original-input.js";

export const ORIGINAL_PRODUCT_PROFILE: Readonly<OriginalMessagePolicyProfile> = Object.freeze({
  policyId: "zep-chat-attachments-v1-8000cp-32000bytes-64parts",
  representation: "memory-text-v1",
  input: Object.freeze({ maxBodyCodePoints: 8000, maxDataUtf8Bytes: 32000, bytesPerCredit: 350, maxParts: 64 }),
});

export function originalProductText(message: Pick<StoredMessage, "text" | "quotes" | "audio">): string {
  let text = message.text;
  const quotes = [...(message.quotes ?? [])].sort((a, b) => a.n - b.n), usedQuotes = new Set<number>();
  for (const quote of quotes) {
    if (!Number.isSafeInteger(quote.n) || quote.n <= 0 || usedQuotes.has(quote.n) ||
      !Number.isSafeInteger(quote.ts) || quote.ts < 0 || typeof quote.text !== "string") throw new Error("Invalid original quote capture");
    usedQuotes.add(quote.n);
    const provenance = { id: quote.id ?? null, seq: quote.seq ?? null, originSeq: quote.originSeq ?? null,
      authorId: quote.from, authorName: quote.fromName, writtenAt: quote.ts };
    text += `\n\n[quote ${quote.n} captured source ${JSON.stringify(provenance)}]\n${quote.text}\n[end quote ${quote.n}]`;
  }
  const audio = (message.audio ?? []).map((sound, i) => ({ n: sound.n ?? i + 1, words: sound.words })).sort((a, b) => a.n - b.n);
  const usedAudio = new Set<number>();
  for (const sound of audio) {
    if (!Number.isSafeInteger(sound.n) || sound.n <= 0 || usedAudio.has(sound.n)) throw new Error("Invalid original audio capture");
    usedAudio.add(sound.n);
    if (sound.words === undefined || sound.words === "") continue;
    if (typeof sound.words !== "string") throw new Error("Invalid original audio words");
    text += `\n\n[audio ${sound.n} captured transcript]\n${sound.words}\n[end audio ${sound.n}]`;
  }
  return text;
}

export function originalProductFingerprint(message: Pick<StoredMessage, "text" | "quotes" | "audio">,
  representation: OriginalMessageText["representation"] = ORIGINAL_PRODUCT_PROFILE.representation): string {
  const text = representation === "chat-text-v1" ? message.text : originalProductText(message);
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}
