// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash } from "node:crypto";
import type { BackgroundMessage } from "./acp-message-delivery.js";

export interface PostMessageInput { messageId: string; text: string }
export interface PostMessageReceipt {
  messageId: string; seq: number; status: "posted" | "held" | "deleted"; duplicate: boolean;
}

export class AgentMessageError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 503, readonly code: string, message: string) {
    super(message);
  }
}

function fitsCharacters(text: string, max: number): boolean {
  let count = 0;
  for (const _character of text) if (++count > max) return false;
  return true;
}

export function parsePostMessage(value: unknown): PostMessageInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AgentMessageError(400, "invalid_arguments", "Provide messageId and the complete message text.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== "messageId" && key !== "text")
      || typeof input.messageId !== "string" || !input.messageId.trim() || !fitsCharacters(input.messageId, 128)
      || typeof input.text !== "string" || !input.text.trim() || !fitsCharacters(input.text, 200_000))
    throw new AgentMessageError(400, "invalid_arguments", "Provide a nonblank messageId (up to 128 characters) and complete text (up to 200000 characters), without other fields.");
  return { messageId: input.messageId, text: input.text };
}

export function agentMessageId(roomUuid: string, participantId: string, sessionId: string,
  nativeId: string, transport: "acp" | "mcp" = "acp"): string {
  const identity = transport === "acp" ? [roomUuid, participantId, sessionId, nativeId]
    : [roomUuid, participantId, "mcp", nativeId];
  return `${transport}-${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

export function agentMessageHash(report: Pick<BackgroundMessage, "text" | "stopReason">): string {
  return createHash("sha256").update(JSON.stringify([report.text, report.stopReason])).digest("hex");
}
