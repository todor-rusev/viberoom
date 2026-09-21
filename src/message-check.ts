// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { canAutoApproveRoomTool, isDirectRoomTool, type ToolIdentity } from "./room-tool-identity.js";
import { oldNamesFor } from "./tool-spec.js";

const MESSAGE_CHECK_TOOL = "check_room";

export const MESSAGE_CHECK_BYTES = 16 * 1024;
export interface CheckedVibemate { name: string; state: string; line: string; startedAt?: string; elapsedSeconds?: number; quietSeconds?: number }
export interface MessageCheckArgs { mode: "read" | "status"; limit: number; after?: string; page?: string; draft?: { name: string; cursor?: string } }
export interface LiveDraft {
  name: string; provisional: true; available: boolean; text: string; hint: string;
  turnId?: string; startedAt?: string; updatedAt?: string; toolCalls?: number;
  offset?: number; totalChars?: number; truncated?: boolean; nextCursor?: string; reset?: boolean;
}
export interface MessageCheckContext { turn: string; revision: number; baseline: number; latest: number }
export type MessageAddressing = "direct" | "broadcast" | "other" | "event";
export interface CheckedMessage extends Record<string, unknown> { seq: number; text: string; addressing?: MessageAddressing; truncated?: boolean; detailsOmitted?: boolean }
export interface MessageHeader {
  seq: number; kind: "chat" | "system"; addressing: MessageAddressing;
  from?: string; to?: string[]; at?: string; detailsOmitted?: boolean;
}
export type MessageCheckCounts = Record<MessageAddressing, number>;
const HEADER_PRIORITY: Record<MessageAddressing, number> = { direct: 0, broadcast: 1, other: 2, event: 3 };
function addressingOf(message: CheckedMessage): MessageAddressing {
  return message.addressing ?? (message.kind === "system" ? "event" : "other");
}
export interface MessageCheckResult {
  checkedAt: string; mode: "read" | "status"; available: number; returned: number;
  messages: CheckedMessage[]; nextCursor: string; more: boolean; reset: boolean; hint: string;
  counts?: MessageCheckCounts; headers?: MessageHeader[]; previewed?: number; moreHeaders?: boolean; nextPage?: string; snapshotThrough?: number;
  vibemates?: CheckedVibemate[]; vibematesOmitted?: number; liveDraft?: LiveDraft;
}

export function parseMessageCheckArgs(params: Record<string, unknown>, query = false): MessageCheckArgs {
  for (const key of Object.keys(params)) if (!["mode", "limit", "after", "page", "draft"].includes(key)) throw new Error(`unsupported check_room argument: ${key}`);
  const mode = params.mode === undefined ? "status" : params.mode;
  if (mode !== "read" && mode !== "status") throw new Error("mode must be read or status");
  const limit = params.limit === undefined ? 10 : query && typeof params.limit === "string" && /^\d+$/.test(params.limit) ? Number(params.limit) : params.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("limit must be an integer from 1 to 20");
  if (params.after !== undefined && (typeof params.after !== "string" || !params.after || params.after.length > 1024)) throw new Error("after must be a cursor returned by check_room");
  if (params.page !== undefined && (mode !== "status" || typeof params.page !== "string" || !params.page || params.page.length > 1024)) throw new Error("page must be a nextPage cursor and is only supported with mode=status");
  let draft = params.draft;
  if (query && typeof draft === "string") { try { draft = JSON.parse(draft); } catch { throw new Error("draft must name a vibemate in this room"); } }
  if (draft !== undefined) {
    if (!draft || typeof draft !== "object" || Array.isArray(draft)) throw new Error("draft must name a vibemate in this room");
    const value = draft as Record<string, unknown>;
    if (Object.keys(value).some(k => !["name", "cursor"].includes(k)) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 100) throw new Error("draft must name a vibemate in this room");
    if (value.cursor !== undefined && (typeof value.cursor !== "string" || !value.cursor || value.cursor.length > 1024)) throw new Error("draft.cursor must be returned by a previous draft check");
    draft = { name: value.name.trim(), ...(value.cursor !== undefined ? { cursor: value.cursor } : {}) };
  }
  return { mode, limit, ...(params.after !== undefined ? { after: params.after as string } : {}), ...(params.page !== undefined ? { page: params.page as string } : {}), ...(draft !== undefined ? { draft: draft as MessageCheckArgs["draft"] } : {}) };
}

export function packLiveDraft(key: string, callerTurn: string, writer: string, request: NonNullable<MessageCheckArgs["draft"]>, draft: LiveDraft): LiveDraft {
  const text = draft.text;
  const revision = createHash("sha256").update(text).digest("hex");
  let offset = 0, reset = false;
  if (request.cursor) {
    let point: Record<string, unknown>;
    try { point = decodeCursor(key, request.cursor); }
    catch { throw new Error("invalid draft cursor; omit draft.cursor to read the current draft"); }
    if (point.kind !== "draft" || point.caller !== callerTurn || point.writer !== writer || !Number.isSafeInteger(point.offset) || Number(point.offset) < 0) throw new Error("invalid draft cursor for this caller or vibemate");
    if (point.turn !== draft.turnId || point.revision !== revision) reset = true;
    else { offset = Number(point.offset); if (offset > text.length) throw new Error("invalid draft offset"); }
  }
  const cursor = (end: number) => signCursor(key, { kind: "draft", caller: callerTurn, writer, turn: draft.turnId, revision, offset: end });
  const result: LiveDraft = { ...draft, text: "", offset, totalChars: text.length, truncated: false, reset };
  let low = offset, high = text.length, best = offset;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const end = middle > offset && /[\uD800-\uDBFF]/.test(text[middle - 1]) ? middle - 1 : middle;
    result.text = text.slice(offset, end); result.truncated = end < text.length;
    result.nextCursor = result.truncated ? cursor(end) : undefined;
    if (Buffer.byteLength(JSON.stringify(result, null, 2)) <= 8 * 1024) { best = end; low = middle + 1; } else high = middle - 1;
  }
  result.text = text.slice(offset, best); result.truncated = best < text.length;
  result.nextCursor = result.truncated ? cursor(best) : undefined;
  return result;
}

function signCursor(key: string, value: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

function decodeCursor(key: string, token: string): Record<string, unknown> {
  if (token.length > 1024 || !/^[\w-]+\.[\w-]+$/.test(token)) throw new Error();
  const [body, signature] = token.split(".");
  const actual = Buffer.from(signature, "base64url"), expected = createHmac("sha256", key).update(body).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}

export function messageCheckCursor(key: string, context: MessageCheckContext, seq: number): string {
  return signCursor(key, { turn: context.turn, revision: context.revision, seq });
}

export function messageCheckPosition(key: string, context: MessageCheckContext, after?: string): { seq: number; reset: boolean } {
  if (after === undefined) return { seq: context.baseline, reset: false };
  try {
    const point = decodeCursor(key, after);
    if (point.kind !== undefined || point.turn !== context.turn || !Number.isSafeInteger(point.seq) || !Number.isSafeInteger(point.revision)) throw new Error();
    if (point.revision !== context.revision) return { seq: context.baseline, reset: true };
    const seq = point.seq as number;
    if (seq < context.baseline || seq > context.latest) throw new Error();
    return { seq, reset: false };
  } catch {
    throw new Error("invalid or expired check_room cursor; omit after to check from this turn's prompt");
  }
}

export function messageCheckPageCursor(key: string, context: MessageCheckContext, from: number, seq: number, priority: number): string {
  return signCursor(key, { turn: context.turn, revision: context.revision, kind: "headers", from, seq, priority, until: context.latest });
}

export function messageCheckPagePosition(key: string, context: MessageCheckContext, from: number, page?: string): { seq: number; priority: number; until: number; reset: boolean } {
  const start = { seq: from, priority: -1, until: context.latest, reset: false };
  if (page === undefined) return start;
  try {
    const point = decodeCursor(key, page);
    if (point.kind !== "headers" || point.turn !== context.turn || !Number.isSafeInteger(point.seq) || !Number.isSafeInteger(point.from) || !Number.isSafeInteger(point.revision)
      || !Number.isSafeInteger(point.priority) || !Number.isSafeInteger(point.until)) throw new Error();
    if (point.revision !== context.revision) return { ...start, reset: true };
    const seq = point.seq as number;
    const priority = point.priority as number, until = point.until as number;
    if (point.from !== from || seq < from || seq > until || until > context.latest || priority < 0 || priority > 3) throw new Error();
    return { seq, priority, until, reset: false };
  } catch {
    throw new Error("invalid or expired check_room page cursor; keep the same after and omit page to restart the headers");
  }
}

export function messageAddressing(message: { kind: string; to: string[]; toNames: string[] }, reader: string): MessageAddressing {
  if (message.kind === "system") return "event";
  if (!message.to.length || message.toNames.includes("All")) return "broadcast";
  return message.to.includes(reader) ? "direct" : "other";
}

export function messageCheckHeader(message: CheckedMessage): MessageHeader {
  const kind = message.kind === "system" ? "system" : "chat";
  return {
    seq: message.seq, kind, addressing: addressingOf(message),
    ...(kind === "chat" ? { from: typeof message.from === "string" ? message.from : "" } : {}),
    to: Array.isArray(message.to) ? message.to.filter((name): name is string => typeof name === "string") : [],
    ...(typeof message.at === "string" ? { at: message.at } : {}),
  };
}

export function packMessageCheck(
  args: MessageCheckArgs, position: { seq: number; reset: boolean; pageSeq?: number; pagePriority?: number }, rows: CheckedMessage[],
  cursors: { read: (seq: number) => string; headers: (seq: number, priority: number) => string }, latest: number, checkedAt = new Date().toISOString(),
  extras: Pick<MessageCheckResult, "vibemates" | "vibematesOmitted" | "liveDraft"> = {},
): MessageCheckResult {
  const cursor = cursors.read;
  let result: MessageCheckResult = {
    ...extras, checkedAt, mode: args.mode, available: rows.length, returned: 0, messages: [],
    nextCursor: cursor(position.seq), more: rows.length > 0, reset: position.reset,
    hint: "This is a snapshot; later messages may arrive. Pass nextCursor as after to continue. Normal next-turn delivery is unchanged. Use read_message with seq for truncated text or omitted details.",
  };
  const fits = (value: MessageCheckResult) => Buffer.byteLength(JSON.stringify(value, null, 2)) <= MESSAGE_CHECK_BYTES;
  if (args.mode === "status") {
    const counts: MessageCheckCounts = { direct: 0, broadcast: 0, other: 0, event: 0 };
    for (const row of rows) counts[addressingOf(row)]++;
    const priority = (row: CheckedMessage) => HEADER_PRIORITY[addressingOf(row)];
    const pendingHeaders = rows.filter(row => priority(row) > (position.pagePriority ?? -1)
      || (priority(row) === position.pagePriority && row.seq > (position.pageSeq ?? position.seq)))
      .sort((a, b) => priority(a) - priority(b) || a.seq - b.seq);
    result = { ...result, counts, headers: [], previewed: 0, moreHeaders: pendingHeaders.length > 0, snapshotThrough: latest,
      hint: "Counts cover this snapshot's whole range after 'after', through snapshotThrough. Headers contain no body: direct first, then broadcast (@All or unaddressed chat), other, event; each group by seq. You decide what is useful; other messages may still matter. Use read_message(seq) for a selected body, or check_room with mode=read and after=nextCursor for a chronological page of bodies. more means bodies are available in this range, not that another header page exists; only moreHeaders/nextPage indicate more headers. For more headers pass nextPage as page with the same after. Omit page to check for later arrivals. nextCursor remains the read starting point; headers do not acknowledge content. Normal next-turn delivery is unchanged." };
    for (const row of pendingHeaders.slice(0, args.limit)) {
      let header = messageCheckHeader(row);
      const moreHeaders = result.headers!.length + 1 < pendingHeaders.length;
      let candidate: MessageCheckResult = { ...result, headers: [...result.headers!, header], previewed: result.headers!.length + 1, moreHeaders,
        nextPage: moreHeaders ? cursors.headers(row.seq, priority(row)) : undefined };
      if (!fits(candidate)) {
        if (result.headers!.length) break;
        header = { seq: header.seq, kind: header.kind, addressing: header.addressing, detailsOmitted: true };
        candidate = { ...candidate, headers: [header] };
        if (!fits(candidate)) throw new Error("message check headers exceed the response budget");
      }
      result = candidate;
    }
    return result;
  }
  for (const source of rows.slice(0, args.limit)) {
    const message = { ...source };
    const candidate = { ...result, messages: [...result.messages, message], returned: result.returned + 1,
      nextCursor: cursor(result.returned + 1 < rows.length ? source.seq : latest), more: result.returned + 1 < rows.length };
    if (fits(candidate)) { result = candidate; continue; }
    if (result.returned) break;
    message.truncated = true;
    const text = message.text;
    message.text = "";
    if (!fits(candidate)) {
      for (const field of Object.keys(message)) if (!["seq", "text", "truncated", "addressing"].includes(field)) delete message[field];
      message.kind = source.kind === "system" ? "system" : "chat";
      message.detailsOmitted = true;
    }
    if (!fits(candidate)) throw new Error("message check metadata exceeds the response budget");
    let low = 0, high = text.length, best = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const end = middle > 0 && /[\uD800-\uDBFF]/.test(text[middle - 1]) ? middle - 1 : middle;
      message.text = text.slice(0, end);
      if (fits(candidate)) { best = end; low = middle + 1; } else high = middle - 1;
    }
    message.text = text.slice(0, best);
    result = candidate;
    break;
  }
  if (!result.more) result.nextCursor = cursor(latest);
  return result;
}

export function messageCheckTitle(result: MessageCheckResult): string {
  if (result.liveDraft) return result.liveDraft.available
    ? `Read ${result.liveDraft.name}'s unfinished reply · ${result.liveDraft.text.length} characters${result.liveDraft.truncated ? " · more available" : ""}`
    : `No visible draft from ${result.liveDraft.name}`;
  if (!result.available) return "Checked room messages · Nothing new";
  if (result.mode === "status") return `Checked room messages · ${result.available} new · ${result.counts?.direct ?? 0} for you`;
  return `Returned ${result.returned} message${result.returned === 1 ? "" : "s"}${result.more ? ` · ${result.available - result.returned} more` : ""}`;
}

export function isDirectMessageCheck(name: string | null | undefined): boolean {
  return [MESSAGE_CHECK_TOOL, ...oldNamesFor(MESSAGE_CHECK_TOOL)].some((tool) => isDirectRoomTool(name, tool));
}

export function canAutoApproveMessageCheck(call: ToolIdentity, known?: ToolIdentity): boolean {
  const ok = (tool: string): boolean => canAutoApproveRoomTool(call, known, tool, input => {
    try { parseMessageCheckArgs(input); return true; }
    catch { return false; }
  });
  return [MESSAGE_CHECK_TOOL, ...oldNamesFor(MESSAGE_CHECK_TOOL)].some(ok);
}
