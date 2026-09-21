// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash } from "node:crypto";
import { isIdentity } from "./identity.js";
import { contentTypeOf, isStoredFileName } from "./files.js";

export const SCHEMA = 2;

export interface ExportManifest {
  schema: number;
  product: string;
  room: { uuid: string; id: string; name: string };
  folder: string;
  at: string;
  parts: ExportPartName[];
  counts: { messages: number; participants: number; graves: number; files?: number };
  range: { firstSeq: number | null; lastSeq: number | null; firstAt: string | null; lastAt: string | null };
  checksum: string;
}

export type ExportPartName = "conversation" | "settings" | "resources";

export interface ExportFile {
  file: string;
  mimeType: string;
  bytes: number;
  data: string;
}

export interface ExportInput {
  room: { uuid: string; id: string; name: string };
  folder: string;
  product: string;
  messages?: Record<string, unknown>[];
  graves?: { deletedAt: number; message: Record<string, unknown> }[];
  settings?: Record<string, unknown>;
  participants?: Record<string, unknown>[];
  files?: ExportFile[];
  at?: Date;
}

interface Line {
  part: string;
  value: unknown;
}

const stamp = (value: unknown): string | null => (typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : typeof value === "string" ? value : null);

export function writeExport(input: ExportInput): string {
  const messages = input.messages ?? [];
  const graves = input.graves ?? [];
  const participants = input.participants ?? [];
  const parts: ExportPartName[] = [];
  const lines: Line[] = [];
  if (input.messages) {
    parts.push("conversation");
    for (const message of messages) lines.push({ part: "message", value: message });
    for (const grave of graves) lines.push({ part: "grave", value: grave });
  }
  if (input.settings || input.participants) {
    parts.push("settings");
    if (input.settings) lines.push({ part: "settings", value: input.settings });
    for (const participant of participants) lines.push({ part: "participant", value: participant });
  }
  const files = input.files ?? [];
  if (files.length) {
    parts.push("resources");
    for (const file of files) lines.push({ part: "file", value: file });
  }
  const body = lines.map((line) => JSON.stringify(line)).join("\n");
  const first = messages[0] as { seq?: number; ts?: number } | undefined;
  const last = messages[messages.length - 1] as { seq?: number; ts?: number } | undefined;
  const manifest: ExportManifest = {
    schema: SCHEMA,
    product: input.product,
    room: input.room,
    folder: input.folder,
    at: (input.at ?? new Date()).toISOString(),
    parts,
    counts: { messages: messages.length, participants: participants.length, graves: graves.length, files: files.length },
    range: {
      firstSeq: typeof first?.seq === "number" ? first.seq : null,
      lastSeq: typeof last?.seq === "number" ? last.seq : null,
      firstAt: stamp(first?.ts),
      lastAt: stamp(last?.ts),
    },
    checksum: createHash("sha256").update(body).digest("hex"),
  };
  return `${JSON.stringify(manifest)}\n${body}${body ? "\n" : ""}`;
}

export interface ExportContents {
  manifest: ExportManifest;
  messages: Record<string, unknown>[];
  graves: { deletedAt: number; message: Record<string, unknown> }[];
  settings: Record<string, unknown> | null;
  participants: Record<string, unknown>[];
  files: ExportFile[];
  unknownParts: number;
}

export class ExportUnreadable extends Error {}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function validateExportContents(contents: ExportContents): void {
  const { manifest, messages, graves, participants, files } = contents;
  if (!object(manifest.room) || !isIdentity(manifest.room.uuid) || typeof manifest.room.name !== "string" || !manifest.room.name.trim() || manifest.room.name.length > 60 || typeof manifest.room.id !== "string" || !isIdentity(manifest.folder)) throw new ExportUnreadable("This file has an invalid room or source identity.");
  if (!Array.isArray(manifest.parts) || manifest.parts.some(p => !["conversation", "settings", "resources"].includes(p)) || !object(manifest.counts)) throw new ExportUnreadable("This file has an invalid parts manifest.");
  const expected = { messages: messages.length, graves: graves.length, participants: participants.length, files: files.length };
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if ((manifest.counts[key] ?? (key === "files" && manifest.schema === 1 ? 0 : -1)) !== expected[key]) throw new ExportUnreadable(`This file's ${key} count does not match its contents.`);
  }
  if ((messages.length || graves.length) && !manifest.parts.includes("conversation") || (contents.settings || participants.length) && !manifest.parts.includes("settings") || files.length && !manifest.parts.includes("resources")) throw new ExportUnreadable("This file contains data missing from its parts manifest.");
  const ids = new Set<string>();
  for (const message of [...messages, ...graves.map(g => g?.message)]) {
    if (!object(message) || typeof message.id !== "string" || !message.id || message.id.length > 200 || !Number.isSafeInteger(message.seq) || Number(message.seq) < 1 || !finite(message.ts) || Math.abs(message.ts) > 8.64e15 || typeof message.text !== "string" || typeof message.from !== "string" || message.fromName !== undefined && typeof message.fromName !== "string") throw new ExportUnreadable("This file contains an invalid message. Nothing was imported.");
    if (message.bodyMissing === true || message.pending === true || message.streaming === true) throw new ExportUnreadable("This file contains an unfinished or preview-only message. Export the saved conversation from viberoom instead.");
    if (ids.has(message.id)) throw new ExportUnreadable("This file repeats a message identity, so its state is ambiguous.");
    ids.add(message.id);
    if (message.kind !== undefined && !["chat", "system", "hidden"].includes(String(message.kind))) throw new ExportUnreadable("This file contains an unknown message kind.");
    for (const key of ["to", "toNames", "notices"] as const) if (message[key] !== undefined && (!Array.isArray(message[key]) || (message[key] as unknown[]).some(x => typeof x !== "string"))) throw new ExportUnreadable(`A message has invalid ${key}.`);
    for (const key of ["quotes", "images", "toolCalls", "plan"] as const) if (message[key] !== undefined && (!Array.isArray(message[key]) || (message[key] as unknown[]).some(x => !object(x)))) throw new ExportUnreadable(`A message has invalid ${key}.`);
    if (message.quotes) for (const quote of message.quotes as Record<string, unknown>[]) if (!Number.isSafeInteger(quote.n) || Number(quote.n) < 1 || !Number.isSafeInteger(quote.seq) || Number(quote.seq) < 1 || typeof quote.text !== "string" || typeof quote.from !== "string" || typeof quote.fromName !== "string" || !finite(quote.ts) || Math.abs(quote.ts) > 8.64e15 || quote.id !== undefined && typeof quote.id !== "string") throw new ExportUnreadable("A message has an invalid quote.");
    if (message.toolCalls) for (const call of message.toolCalls as Record<string, unknown>[]) {
      if (call.detailsAvailable === true) throw new ExportUnreadable("This file contains tool previews without their complete records. Export the saved conversation from viberoom instead.");
      for (const key of ["toolCallId", "name", "title", "output"]) if (call[key] !== undefined && call[key] !== null && typeof call[key] !== "string") throw new ExportUnreadable("A tool record has an invalid field.");
    }
    if (message.images) for (const image of message.images as Record<string, unknown>[]) if (!isStoredFileName(String(image.file)) || typeof image.name !== "string" || typeof image.mimeType !== "string" || !finite(image.bytes) || image.bytes < 0) throw new ExportUnreadable("A message has an invalid image reference.");
    if (message.images) for (const image of message.images as Record<string, unknown>[]) if (image.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(String(image.sha256))) throw new ExportUnreadable("An image has an invalid content identity.");
    if (message.resourceRefs !== undefined) {
      if (!Array.isArray(message.resourceRefs)) throw new ExportUnreadable("A message has invalid resource references.");
      for (const ref of message.resourceRefs) if (!object(ref) || typeof ref.source !== "string" || ref.source.length > 4096 || typeof ref.file !== "string" || !/^(?:[0-9a-f]{32}\.(?:png|jpg|webp|gif)|[0-9a-f]{12}-[^\\/:*?"<>|\u0000-\u001f]+)$/.test(ref.file) || ref.file.endsWith(".") || ref.file.endsWith(" ") || ref.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(String(ref.sha256))) throw new ExportUnreadable("A message has an invalid carried file reference.");
    }
    if (message.edited !== undefined && (!object(message.edited) || !finite(message.edited.ts) || (message.edited.previous !== undefined && typeof message.edited.previous !== "string"))) throw new ExportUnreadable("A message has an invalid edit record.");
  }
  if (graves.some(g => !object(g) || !finite(g.deletedAt))) throw new ExportUnreadable("This file has an invalid deletion record.");
  if (contents.settings !== null && !object(contents.settings) || participants.some(p => !object(p) || typeof p.id !== "string" || typeof p.name !== "string")) throw new ExportUnreadable("This file has invalid room settings or participants.");
  const names = new Set<string>();
  for (const file of files) {
    if (!object(file) || typeof file.file !== "string" || !isStoredFileName(file.file) || names.has(file.file) || typeof file.data !== "string" || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 8 * 1024 * 1024) throw new ExportUnreadable("This file has an invalid or repeated resource name or size.");
    names.add(file.file);
    const data = Buffer.from(file.data, "base64");
    if (data.toString("base64") !== file.data || data.length !== file.bytes || file.mimeType !== contentTypeOf(file.file) || createHash("sha256").update(data).digest("hex").slice(0, 32) !== file.file.slice(0, file.file.lastIndexOf("."))) throw new ExportUnreadable("A resource does not match its content hash, type or size. Nothing was imported.");
  }
}

export function readExport(text: string): ExportContents {
  const newline = text.indexOf("\n");
  if (newline < 0) throw new ExportUnreadable("this file has no manifest line: it was not written by viberoom, or it is empty");
  let manifest: ExportManifest;
  try {
    manifest = JSON.parse(text.slice(0, newline)) as ExportManifest;
  } catch {
    throw new ExportUnreadable("the first line of this file is not a manifest: it was not written by viberoom");
  }
  if (!manifest || !Number.isSafeInteger(manifest.schema) || manifest.schema < 1) throw new ExportUnreadable("the first line of this file is not a manifest: it was not written by viberoom");
  if (manifest.schema > SCHEMA) {
    throw new ExportUnreadable(`this file was written by a newer viberoom (format ${manifest.schema}; this one reads ${SCHEMA}). Update viberoom here and open it again.`);
  }
  const body = text.slice(newline + 1).replace(/\n$/, "");
  const checksum = createHash("sha256").update(body).digest("hex");
  if (typeof manifest.checksum !== "string" || checksum !== manifest.checksum) {
    throw new ExportUnreadable("this file does not match its own checksum: it was cut short in transit or changed after it was written. Ask for it again.");
  }
  const contents: ExportContents = { manifest, messages: [], graves: [], settings: null, participants: [], files: [], unknownParts: 0 };
  for (const line of body ? body.split("\n") : []) {
    if (!line.trim()) continue;
    let parsed: Line;
    try {
      parsed = JSON.parse(line) as Line;
    } catch {
      throw new ExportUnreadable("a line in this file is not readable, although its checksum matched: the file was written by something that is not viberoom");
    }
    if (!object(parsed)) throw new ExportUnreadable("A record in this file is not an object.");
    if (parsed.part === "message") contents.messages.push(parsed.value as Record<string, unknown>);
    else if (parsed.part === "grave") contents.graves.push(parsed.value as { deletedAt: number; message: Record<string, unknown> });
    else if (parsed.part === "settings") {
      if (contents.settings !== null || !object(parsed.value)) throw new ExportUnreadable("This file has invalid or repeated room settings.");
      contents.settings = parsed.value;
    }
    else if (parsed.part === "participant") contents.participants.push(parsed.value as Record<string, unknown>);
    else if (parsed.part === "file") contents.files.push(parsed.value as ExportFile);
    else contents.unknownParts++;
  }
  validateExportContents(contents);
  return contents;
}
