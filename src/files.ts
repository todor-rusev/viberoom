// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";

export const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const IMAGES_PER_MESSAGE = 6;

export const AUDIO_TYPES: Record<string, string> = {
  "audio/webm": "weba",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

export const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
};

export const AUDIO_PER_MESSAGE = 4;
export const VIDEOS_PER_MESSAGE = 2;

export type AttachmentField = "images" | "audio" | "video";

export interface AttachmentKind {
  field: AttachmentField;
  marker: string;
  noun: string;
  typesSaid: string;
  types: Record<string, string>;
  perMessage: number;
}

export const IMAGE_KIND: AttachmentKind = { field: "images", marker: "img", noun: "image", typesSaid: "png, jpeg, webp and gif", types: IMAGE_TYPES, perMessage: IMAGES_PER_MESSAGE };
export const AUDIO_KIND: AttachmentKind = { field: "audio", marker: "audio", noun: "recording", typesSaid: "webm, ogg, mp3, m4a, wav and flac", types: AUDIO_TYPES, perMessage: AUDIO_PER_MESSAGE };
export const VIDEO_KIND: AttachmentKind = { field: "video", marker: "video", noun: "video", typesSaid: "mp4, webm, ogg and mov", types: VIDEO_TYPES, perMessage: VIDEOS_PER_MESSAGE };
export const ATTACHMENT_KINDS: readonly AttachmentKind[] = [IMAGE_KIND, AUDIO_KIND, VIDEO_KIND];

export interface ImageInput {
  name?: string;
  mimeType: string;
  data?: string;
  file?: string;
  n?: number;
}

export interface AudioInput extends ImageInput {
  seconds?: number;
}
export type VideoInput = AudioInput;

export interface HeardSound extends AudioInput {
  words?: string;
  unheard?: string;
}

export interface Attachment {
  file: string;
  name: string;
  mimeType: string;
  bytes: number;
  sha256?: string;
  n?: number;
}

export interface AudioAttachment extends Attachment {
  seconds?: number;
  words?: string;
  unheard?: string;
}

export interface VideoAttachment extends Attachment {
  seconds?: number;
}

export type WithAttachments = { [F in AttachmentField]?: Attachment[] };

export function messageAttachments(message: WithAttachments): Attachment[] {
  return ATTACHMENT_KINDS.flatMap((kind) => message[kind.field] ?? []);
}

export function withAttachmentLists<M extends WithAttachments>(message: M, map: (list: Attachment[], kind: AttachmentKind) => Attachment[]): M {
  let out = message;
  for (const kind of ATTACHMENT_KINDS) {
    const list = message[kind.field];
    if (list) out = { ...out, [kind.field]: map(list, kind) };
  }
  return out;
}

const STORED_NAME = new RegExp(`^[0-9a-f]{32}\\.(${[...new Set(ATTACHMENT_KINDS.flatMap((kind) => Object.values(kind.types)))].join("|")})$`);

export function isStoredFileName(name: string): boolean {
  return STORED_NAME.test(name);
}

export function isRoomResourceName(name: unknown): name is string {
  return typeof name === "string" && name.length <= 200 && !/[\\/:*?"<>|\u0000-\u001f]/.test(name) && !name.endsWith(".") && !name.endsWith(" ") && (isStoredFileName(name) || /^[0-9a-f]{12}-[^. ].*$/.test(name));
}

export function canonicalResourceFile(file: string, hash: string): string {
  if (!isRoomResourceName(file) || !/^[0-9a-f]{64}$/.test(hash)) throw new Error("Invalid carried resource identity.");
  return isStoredFileName(file) ? `${hash.slice(0, 32)}${file.slice(32)}` : `${hash.slice(0, 12)}${file.slice(12)}`;
}

export function contentTypeOf(file: string): string {
  const ext = file.slice(file.lastIndexOf(".") + 1);
  for (const kind of ATTACHMENT_KINDS) for (const [type, e] of Object.entries(kind.types)) if (e === ext) return type;
  return "application/octet-stream";
}

export function decodeData(data: string, what = "the image"): Buffer {
  const comma = data.startsWith("data:") ? data.indexOf(",") : -1;
  const base64 = comma >= 0 ? data.slice(comma + 1) : data;
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new Error(`${what} is empty`);
  return buffer;
}

function labelFor(name: string | undefined, ext: string, hash: string): string {
  const trimmed = (name ?? "").trim().replace(/[\r\n\t]/g, " ");
  if (!trimmed) return `pasted-${hash.slice(0, 6)}.${ext}`;
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

function bareType(mimeType: string | undefined): string {
  return String(mimeType ?? "").split(";")[0].trim().toLowerCase();
}

export function takesType(kind: AttachmentKind, mimeType: string | undefined): boolean {
  return Object.hasOwn(kind.types, bareType(mimeType));
}

export function attachmentExtension(kind: AttachmentKind, mimeType: string): string {
  if (!takesType(kind, mimeType)) throw new Error(`unsupported ${kind.noun} type: ${mimeType || "unknown"} (${kind.typesSaid} only)`);
  return kind.types[bareType(mimeType)];
}

export function saveAttachment(dir: string, kind: AttachmentKind, input: ImageInput): Attachment {
  if (input.file !== undefined) return uploadedAttachment(dir, kind, input);
  const type = bareType(input.mimeType);
  const ext = attachmentExtension(kind, input.mimeType);
  const buffer = decodeData(input.data ?? "", `the ${kind.noun}`);
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  const file = `${hash}.${ext}`;
  const target = join(dir, file);
  if (!existsSync(target)) writeFileSync(target, buffer);
  const attachment: Attachment = { file, name: labelFor(input.name, ext, hash), mimeType: type, bytes: buffer.length };
  if (Number.isInteger(input.n) && (input.n as number) > 0) attachment.n = input.n;
  return attachment;
}

function uploadedAttachment(dir: string, kind: AttachmentKind, input: ImageInput): Attachment {
  const file = String(input.file);
  const ext = file.slice(file.lastIndexOf(".") + 1);
  if (!isStoredFileName(file) || !Object.values(kind.types).includes(ext)) throw new Error(`not an uploaded ${kind.noun} of this room: ${file}`);
  let bytes: number;
  try {
    const info = statSync(join(dir, file));
    if (!info.isFile()) throw new Error("not a file");
    bytes = info.size;
  } catch {
    throw new Error(`the ${kind.noun} ${file} is not in this room's folder; attach it again`);
  }
  const attachment: Attachment = { file, name: labelFor(input.name, ext, file.slice(0, 32)), mimeType: contentTypeOf(file), bytes };
  if (Number.isInteger(input.n) && (input.n as number) > 0) attachment.n = input.n;
  return attachment;
}

export type UploadAs = AttachmentField | "document";

export interface StoredUpload {
  as: UploadAs;
  file: string;
  path: string;
  name: string;
  mimeType: string;
  bytes: number;
  sha256: string;
}

export async function storeUpload(dir: string, source: AsyncIterable<Uint8Array>, meta: { as: UploadAs; name?: string; mimeType?: string }): Promise<StoredUpload> {
  const kind = meta.as === "document" ? null : ATTACHMENT_KINDS.find((k) => k.field === meta.as);
  if (meta.as !== "document" && !kind) throw new Error(`not a kind of file a message carries: ${meta.as}`);
  const ext = kind ? attachmentExtension(kind, meta.mimeType ?? "") : null;
  const incoming = join(dir, ".incoming");
  mkdirSync(incoming, { recursive: true });
  const temp = join(incoming, randomUUID());
  const hash = createHash("sha256");
  let bytes = 0;
  const out = createWriteStream(temp, { flags: "wx" });
  try {
    for await (const chunk of source) {
      hash.update(chunk);
      bytes += chunk.length;
      if (!out.write(chunk)) await once(out, "drain");
    }
    out.end();
    await once(out, "close");
    if (!bytes) throw new Error("the file is empty");
  } catch (error) {
    if (!out.closed) await once(out.destroy(), "close");
    rmSync(temp, { force: true });
    throw error;
  }
  const sha256 = hash.digest("hex");
  const file = kind ? `${sha256.slice(0, 32)}.${ext}` : documentName(sha256, meta.name);
  const path = join(dir, file);
  if (existsSync(path)) rmSync(temp, { force: true });
  else renameSync(temp, path);
  return { as: meta.as, file, path, name: kind ? labelFor(meta.name, ext!, sha256.slice(0, 32)) : file, mimeType: kind ? bareType(meta.mimeType) : bareType(meta.mimeType) || "application/octet-stream", bytes, sha256 };
}

function documentName(sha256: string, name: string | undefined): string {
  const safe = (name ?? "").trim().replace(/[\\/:*?"<>|\r\n\t]/g, "-").replace(/^\.+/, "").slice(0, 80) || "file";
  return `${sha256.slice(0, 12)}-${safe}`;
}

export function saveImage(dir: string, input: ImageInput): Attachment {
  return saveAttachment(dir, IMAGE_KIND, input);
}

function saveTimed(dir: string, kind: AttachmentKind, inputs: AudioInput[]): (Attachment & { seconds?: number })[] {
  if (inputs.length > kind.perMessage) throw new Error(`up to ${kind.perMessage} ${kind.noun}s per message`);
  return inputs.map((input) => {
    const attachment: Attachment & { seconds?: number } = saveAttachment(dir, kind, input);
    if (typeof input.seconds === "number" && Number.isFinite(input.seconds) && input.seconds > 0) attachment.seconds = Math.round(input.seconds * 10) / 10;
    return attachment;
  });
}

export function saveAudio(dir: string, inputs: AudioInput[]): AudioAttachment[] {
  return saveTimed(dir, AUDIO_KIND, inputs);
}

export function saveVideo(dir: string, inputs: VideoInput[]): VideoAttachment[] {
  return saveTimed(dir, VIDEO_KIND, inputs);
}

export function saveDocument(dir: string, name: string | undefined, data: Buffer): { path: string; file: string } {
  if (!data.length) throw new Error("the file is empty");
  const file = documentName(createHash("sha256").update(data).digest("hex"), name);
  const target = join(dir, file);
  if (!existsSync(target)) writeFileSync(target, data);
  return { path: target, file };
}

export function saveImages(dir: string, inputs: ImageInput[]): Attachment[] {
  if (inputs.length > IMAGES_PER_MESSAGE) throw new Error(`up to ${IMAGES_PER_MESSAGE} images per message`);
  return inputs.map((input) => saveImage(dir, input));
}
