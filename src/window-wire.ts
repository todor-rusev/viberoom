// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { ChatMessage, ToolCallView } from "./room.js";
import type { HubEvent } from "./hub.js";

export function toolForWindow(call: ToolCallView, revision: string) {
  const { rawInput: _input, output: _output, title, ...rest } = call;
  const label = String(title ?? rest.name ?? rest.toolCallId ?? "Tool call");
  return { ...rest, title: label.length > 200 ? label.slice(0, 199) + "…" : label, detailsAvailable: true, detailsRevision: revision };
}
export function messageForWindow<T>(message: T, revision = "") : T {
  const calls = (message as { toolCalls?: ToolCallView[] }).toolCalls;
  return calls?.length ? { ...message, toolCalls: calls.map(call => toolForWindow(call, revision)) } as T : message;
}
export const wireRevision = (history: { epoch?: string; streamSequence?: number } | undefined) => `${history?.epoch ?? ""}:${history?.streamSequence ?? 0}`;
export const WINDOW_RECENT_BODIES = 80;
export const WINDOW_BODY_PAGE_BYTES = 4 * 1024 * 1024;
export function bodyPageForWindow(messages: ChatMessage[], revision: string, limit = WINDOW_BODY_PAGE_BYTES): ChatMessage[] {
  const page: ChatMessage[] = [];
  let bytes = 0;
  for (const message of messages) {
    const body = messageForWindow(message, revision);
    const size = Buffer.byteLength(JSON.stringify(body));
    if (page.length && bytes + size > limit) break;
    page.push(body); bytes += size;
  }
  return page;
}
export function messageIndexEntry(message: ChatMessage): unknown {
  return { id: message.id, seq: message.seq, displayOrder: message.displayOrder, kind: message.kind,
    from: message.from, fromName: message.fromName, to: message.to, toNames: message.toNames,
    ts: message.ts, pinned: message.pinned, streaming: message.streaming, text: message.text.trim().replace(/\s+/g, " ").slice(0, 240),
    bodyMissing: true, bodyChars: message.text.length };
}
export function roomForWindow(value: unknown, options: { index?: boolean; keepRange?: boolean } = {}): unknown {
  const room = value as { messages: ChatMessage[]; pinnedOlder?: ChatMessage[]; history?: { epoch?: string; streamSequence?: number; total?: number } };
  const revision = wireRevision(room.history);
  const recent = new Map(bodyPageForWindow(room.messages.slice(-WINDOW_RECENT_BODIES).reverse(), revision).map(m => [m.id, m]));
  const projected = (m: ChatMessage) => recent.get(m.id) ?? messageForWindow(m, revision);
  const messages = options.index ? room.messages.map(m => recent.has(m.id) || m.streaming ? projected(m) : messageIndexEntry(m))
    : (options.keepRange ? room.messages : room.messages.filter(m => recent.has(m.id) || m.streaming)).map(projected);
  const stored = messages.filter(m => (m as ChatMessage).seq > 0 && !(m as ChatMessage).streaming).length;
  return { ...room, messages, pinnedOlder: options.index ? [] : room.pinnedOlder?.map(m => options.keepRange ? messageForWindow(m, revision) : messageIndexEntry(m)),
    history: { ...room.history, bodyProtocol: 1, indexed: !!options.index,
      ...(room.history?.total !== undefined ? { hidden: options.index ? 0 : Math.max(0, room.history.total - stored),
        oldest: !options.index && room.history.total > stored && messages.length ? { order: (messages[0] as ChatMessage).displayOrder ?? (messages[0] as ChatMessage).seq, seq: (messages[0] as ChatMessage).seq } : null } : {}) } };
}
export function snapshotForWindow(value: unknown): unknown {
  const snapshot = value as { rooms: unknown[] };
  return { ...snapshot, rooms: snapshot.rooms.map(room => roomForWindow(room)) };
}
export function eventForWindow(event: HubEvent): HubEvent {
  if (event.type === "room.created") return { ...event, room: roomForWindow(event.room) };
  if (event.type !== "room.event") return event;
  const inner = event.event;
  const stamp = inner as unknown as { streamSequence?: number; history?: { epoch?: string; streamSequence?: number } };
  const revision = wireRevision({ ...stamp.history, streamSequence: stamp.streamSequence ?? stamp.history?.streamSequence });
  if (inner.type === "message") return { ...event, event: { ...inner, message: messageForWindow(inner.message, revision) } };
  if (inner.type === "toolcall") return { ...event, event: { ...inner, toolCall: toolForWindow(inner.toolCall, revision) } };
  return event;
}
