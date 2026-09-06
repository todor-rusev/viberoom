// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGES_PER_MESSAGE = 6;

export interface ImageInput {
  name?: string;
  mimeType: string;
  data: string;
  n?: number;
}

export interface Attachment {
  file: string;
  name: string;
  mimeType: string;
  bytes: number;
  n?: number;
}

const STORED_NAME = /^[0-9a-f]{32}\.(png|jpg|webp|gif)$/;

export function isStoredFileName(name: string): boolean {
  return STORED_NAME.test(name);
}

export function contentTypeOf(file: string): string {
  const ext = file.slice(file.lastIndexOf(".") + 1);
  for (const [type, e] of Object.entries(IMAGE_TYPES)) if (e === ext) return type;
  return "application/octet-stream";
}

function decode(data: string): Buffer {
  const comma = data.startsWith("data:") ? data.indexOf(",") : -1;
  const base64 = comma >= 0 ? data.slice(comma + 1) : data;
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new Error("the image is empty");
  return buffer;
}

function labelFor(name: string | undefined, ext: string, hash: string): string {
  const trimmed = (name ?? "").trim().replace(/[\r\n\t]/g, " ");
  if (!trimmed) return `pasted-${hash.slice(0, 6)}.${ext}`;
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

export function saveImage(dir: string, input: ImageInput): Attachment {
  const ext = IMAGE_TYPES[input.mimeType];
  if (!ext) throw new Error(`unsupported image type: ${input.mimeType || "unknown"} (png, jpeg, webp and gif only)`);
  const buffer = decode(input.data);
  if (buffer.length > IMAGE_MAX_BYTES) {
    throw new Error(`the image is too large (${Math.round(buffer.length / 1024)} kB; the limit is ${IMAGE_MAX_BYTES / 1024 / 1024} MB)`);
  }
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  const file = `${hash}.${ext}`;
  const target = join(dir, file);
  if (!existsSync(target)) writeFileSync(target, buffer);
  const attachment: Attachment = { file, name: labelFor(input.name, ext, hash), mimeType: input.mimeType, bytes: buffer.length };
  if (Number.isInteger(input.n) && (input.n as number) > 0) attachment.n = input.n;
  return attachment;
}

export function saveImages(dir: string, inputs: ImageInput[]): Attachment[] {
  if (inputs.length > IMAGES_PER_MESSAGE) throw new Error(`up to ${IMAGES_PER_MESSAGE} images per message`);
  return inputs.map((input) => saveImage(dir, input));
}
