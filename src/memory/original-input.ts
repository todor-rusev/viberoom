// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash } from "node:crypto";

export interface OriginalMessageSource {
  roomUuid: string;
  sourceId: string;
  version: string;
  authorId: string;
  authorName: string;
  ts: number;
  seq?: number;
  originCopy?: string;
}

export interface OriginalMessageText {
  representation: "chat-text-v1" | "memory-text-v1";
  text: string;
}

export interface OriginalInputPolicy {
  maxBodyCodePoints: number;
  maxDataUtf8Bytes: number;
  bytesPerCredit: number;
  maxParts: number;
}

export interface OriginalInputPart {
  part: string;
  start: number;
  end: number;
  text: string;
  data: string;
  codePoints: number;
  utf8Bytes: number;
  estimatedCredits: number;
  fingerprint: string;
}

export interface OriginalInputPlan {
  preparation: "viberoom-original-input-v1";
  sourceKind: "message";
  source: Readonly<OriginalMessageSource>;
  representation: OriginalMessageText["representation"];
  representationFingerprint: string;
  policy: Readonly<OriginalInputPolicy>;
  overlapCodePoints: 0;
  prefix: string;
  codePoints: number;
  utf8Bytes: number;
  estimatedCredits: number;
  parts: readonly Readonly<OriginalInputPart>[];
  fingerprint: string;
}

const PREPARATION = "viberoom-original-input-v1";
const HASH = /^sha256:[a-f0-9]{64}$/;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
const identifier = (value: string) => typeof value === "string" && !!value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);

function wellFormed(text: string): boolean {
  for (let at = 0; at < text.length; at++) {
    const n = text.charCodeAt(at);
    if (n >= 0xd800 && n <= 0xdbff) {
      const next = text.charCodeAt(++at);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (n >= 0xdc00 && n <= 0xdfff) return false;
  }
  return true;
}

type Fence = { mark: string; length: number } | null;

function structuralCut(text: string, start: number, end: number, initialFence: Fence): { end: number; fence: Fence } {
  let fence = initialFence;
  let preferred = { end: start, fence }, line = { end: start, fence };
  const rows = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  for (const row of text.slice(start, end).matchAll(rows)) {
    if (!row[0]) continue;
    const rowStart = start + row.index, rowEnd = rowStart + row[0].length;
    const completeLine = /[\r\n]$/.test(row[0]) || rowEnd === text.length;
    const atLineStart = rowStart === 0 || /[\r\n]/.test(text[rowStart - 1]);
    const marker = atLineStart ? /^[ \t]{0,3}(`{3,}|~{3,})/.exec(text.slice(rowStart)) : null;
    if (fence) {
      if (marker && marker[1][0] === fence.mark && marker[1].length >= fence.length) {
        let after = rowStart + marker[0].length;
        while (text[after] === " " || text[after] === "\t") after++;
        if (after === text.length || text[after] === "\r" || text[after] === "\n") fence = null;
      }
    } else if (marker) {
      preferred = { end: rowStart, fence };
      fence = { mark: marker[1][0], length: marker[1].length };
    }
    if (completeLine) {
      line = { end: rowEnd, fence };
      if (!fence) preferred = line;
    }
  }
  if (end === text.length) return { end, fence };
  return preferred.end > start ? preferred : line.end > start ? line : { end, fence };
}

export function planOriginalMessage(source: OriginalMessageSource, input: OriginalMessageText, policy: OriginalInputPolicy): OriginalInputPlan {
  if (!source || !identifier(source.roomUuid) || !identifier(source.sourceId) || !HASH.test(source.version)
    || !identifier(source.authorId) || /[\[\]:\s]/u.test(source.authorId) || !identifier(source.authorName)
    || !wellFormed(source.authorId) || !wellFormed(source.authorName)
    || !Number.isSafeInteger(source.ts) || source.ts < 0 || source.ts > 8_640_000_000_000_000
    || source.seq !== undefined && !positive(source.seq)
    || source.originCopy !== undefined && !identifier(source.originCopy)) throw new Error("Invalid original message source");
  if (!input || !["chat-text-v1", "memory-text-v1"].includes(input.representation)
    || typeof input.text !== "string" || !input.text.length || !wellFormed(input.text)) throw new Error("Invalid original text representation");
  if (!policy || !positive(policy.maxBodyCodePoints) || !positive(policy.maxDataUtf8Bytes)
    || !positive(policy.bytesPerCredit) || !positive(policy.maxParts) || policy.maxParts > 64) throw new Error("Invalid original input policy");
  const text = input.text, sourceBytes = Buffer.byteLength(text, "utf8");
  if (sourceBytes > MAX_SOURCE_BYTES) throw new Error("Original source exceeds planning capacity");
  const prefix = `${source.authorName} [${source.authorId}]: `, prefixBytes = Buffer.byteLength(prefix, "utf8");
  if (prefixBytes >= policy.maxDataUtf8Bytes) throw new Error("Original input limit cannot fit speaker prefix and content");
  const slices: Omit<OriginalInputPart, "part">[] = [];
  let start = 0, totalPoints = 0, fence: Fence = null;
  while (start < text.length) {
    let end = start, points = 0, bytes = prefixBytes;
    for (const point of text.slice(start)) {
      const pointBytes = Buffer.byteLength(point, "utf8");
      if (points + 1 > policy.maxBodyCodePoints || bytes + pointBytes > policy.maxDataUtf8Bytes) break;
      end += point.length; points++; bytes += pointBytes;
    }
    if (text[end - 1] === "\r" && text[end] === "\n") end--;
    if (end <= start) throw new Error("Original input limit cannot fit the next source unit");
    const cut = structuralCut(text, start, end, fence);
    end = cut.end; fence = cut.fence;
    const body = text.slice(start, end), data = prefix + body, utf8Bytes = Buffer.byteLength(data, "utf8"), codePoints = [...body].length;
    slices.push({ start, end, text: body, data, codePoints, utf8Bytes, estimatedCredits: Math.max(1, Math.ceil(utf8Bytes / policy.bytesPerCredit)), fingerprint: hash(data) });
    if (slices.length > policy.maxParts) throw new Error("Original source exceeds supported part count");
    totalPoints += codePoints; start = end;
  }
  const parts = slices.map((slice, at) => Object.freeze({ part: `${at + 1}/${slices.length}`, ...slice }));
  const stableSource = Object.freeze({ roomUuid: source.roomUuid, sourceId: source.sourceId, version: source.version,
    authorId: source.authorId, authorName: source.authorName, ts: source.ts,
    ...(source.seq === undefined ? {} : { seq: source.seq }), ...(source.originCopy === undefined ? {} : { originCopy: source.originCopy }) });
  const stablePolicy = Object.freeze({ maxBodyCodePoints: policy.maxBodyCodePoints, maxDataUtf8Bytes: policy.maxDataUtf8Bytes,
    bytesPerCredit: policy.bytesPerCredit, maxParts: policy.maxParts });
  const plan = { preparation: PREPARATION as typeof PREPARATION, sourceKind: "message" as const, source: stableSource,
    representation: input.representation, representationFingerprint: hash(text), policy: stablePolicy, overlapCodePoints: 0 as const,
    prefix, codePoints: totalPoints, utf8Bytes: sourceBytes, estimatedCredits: parts.reduce((sum, part) => sum + part.estimatedCredits, 0), parts };
  return Object.freeze({ ...plan, parts: Object.freeze(parts), fingerprint: hash(JSON.stringify(plan)) });
}
