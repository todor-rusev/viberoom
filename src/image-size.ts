// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { open } from "node:fs/promises";

export interface PictureSize { width: number; height: number; orientation?: number }

export const HEADER_BYTES = 1024 * 1024;

export function pictureSize(head: Buffer): PictureSize | null {
  if (head.length >= 24 && head.readUInt32BE(0) === 0x89504e47 && head.readUInt32BE(4) === 0x0d0a1a0a && head.toString("latin1", 12, 16) === "IHDR") {
    return sized(head.readUInt32BE(16), head.readUInt32BE(20));
  }
  if (head.length >= 10 && /^GIF8[79]a$/.test(head.toString("latin1", 0, 6))) return sized(head.readUInt16LE(6), head.readUInt16LE(8));
  if (head.length >= 30 && head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") return webpSize(head);
  if (head.length >= 4 && head[0] === 0xff && head[1] === 0xd8) return jpegSize(head);
  return null;
}

export async function pictureSizeOf(path: string): Promise<PictureSize | null> {
  const file = await open(path, "r");
  try {
    const head = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await file.read(head, 0, HEADER_BYTES, 0);
    return pictureSize(head.subarray(0, bytesRead));
  } finally {
    await file.close();
  }
}

function sized(width: number, height: number): PictureSize | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function webpSize(head: Buffer): PictureSize | null {
  const chunk = head.toString("latin1", 12, 16);
  if (chunk === "VP8 " && head[23] === 0x9d && head[24] === 0x01 && head[25] === 0x2a) return sized(head.readUInt16LE(26) & 0x3fff, head.readUInt16LE(28) & 0x3fff);
  if (chunk === "VP8L" && head[20] === 0x2f) {
    const bits = head.readUInt32LE(21);
    return sized((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8X") return sized(head.readUIntLE(24, 3) + 1, head.readUIntLE(27, 3) + 1);
  return null;
}

export function exifOrientation(body: Buffer): number | null {
  if (body.length < 14 || body.toString("latin1", 0, 6) !== "Exif\u0000\u0000") return null;
  const tiff = body.subarray(6);
  const little = tiff.toString("latin1", 0, 2) === "II";
  if (!little && tiff.toString("latin1", 0, 2) !== "MM") return null;
  const short = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const long = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  if (short(2) !== 42) return null;
  const ifd = long(4);
  if (ifd + 2 > tiff.length) return null;
  const count = short(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    if (short(entry) === 0x0112) {
      const value = short(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegSize(head: Buffer): PictureSize | null {
  let at = 2;
  let orientation = 1;
  while (at + 4 <= head.length) {
    if (head[at] !== 0xff) return null;
    const marker = head[at + 1];
    if (marker === 0xff) { at += 1; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { at += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = head.readUInt16BE(at + 2);
    if (marker === 0xe1 && at + 2 + length <= head.length) orientation = exifOrientation(head.subarray(at + 4, at + 2 + length)) ?? orientation;
    if (SOF.has(marker)) {
      const size = at + 9 <= head.length ? sized(head.readUInt16BE(at + 7), head.readUInt16BE(at + 5)) : null;
      return size && orientation !== 1 ? { ...size, orientation } : size;
    }
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}
