// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { deflateSync, inflateSync } from "node:zlib";

export interface PngIcon {
  size: number;
  data: Buffer;
}

export interface Rgba {
  width: number;
  height: number;
  data: Buffer;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function assertPng(icon: PngIcon): void {
  if (icon.data.length < 8 || !icon.data.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`icon ${icon.size}: not a PNG`);
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function decodePng(png: Buffer): Rgba {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | undefined;
  let trns: Buffer | undefined;
  const idat: Buffer[] = [];
  let pos = 8;
  while (pos + 8 <= png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString("ascii", pos + 4, pos + 8);
    const body = png.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") trns = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const channels = CHANNELS[colorType];
  if (!width || !height || !channels) throw new Error("png: unsupported image header");
  if (bitDepth !== 8 || interlace !== 0) throw new Error("png: only 8-bit non-interlaced images are supported");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += Math.floor((a + b) / 2);
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`png: unknown filter ${filter}`);
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * channels;
      if (colorType === 6) {
        out[o] = line[s];
        out[o + 1] = line[s + 1];
        out[o + 2] = line[s + 2];
        out[o + 3] = line[s + 3];
      } else if (colorType === 2) {
        out[o] = line[s];
        out[o + 1] = line[s + 1];
        out[o + 2] = line[s + 2];
        out[o + 3] = 255;
      } else if (colorType === 0 || colorType === 4) {
        out[o] = out[o + 1] = out[o + 2] = line[s];
        out[o + 3] = colorType === 4 ? line[s + 1] : 255;
      } else {
        const idx = line[s];
        const pal = palette ?? Buffer.alloc(0);
        out[o] = pal[idx * 3] ?? 0;
        out[o + 1] = pal[idx * 3 + 1] ?? 0;
        out[o + 2] = pal[idx * 3 + 2] ?? 0;
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
    prev = line;
  }
  return { width, height, data: out };
}

let crcTable: Uint32Array | undefined;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function encodePng(img: Rgba): Buffer {
  const { width, height, data } = img;
  const rowLen = width * 4 + 1;
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0;
    data.copy(raw, y * rowLen + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunk = (type: string, body: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length, 0);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed), 0);
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export function dibFromRgba(img: Rgba): Buffer {
  const { width, height, data } = img;
  const maskStride = Math.ceil(width / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(width * height * 4 + maskStride * height, 20);
  const pixels = Buffer.alloc(width * height * 4);
  const mask = Buffer.alloc(maskStride * height);
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const s = (srcRow * width + x) * 4;
      const d = (y * width + x) * 4;
      pixels[d] = data[s + 2];
      pixels[d + 1] = data[s + 1];
      pixels[d + 2] = data[s];
      pixels[d + 3] = data[s + 3];
      if (data[s + 3] < 128) mask[y * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, pixels, mask]);
}

export function packIco(icons: PngIcon[]): Buffer {
  if (!icons.length) throw new Error("no icons");
  const sorted = [...icons].sort((a, b) => a.size - b.size);
  for (const icon of sorted) assertPng(icon);
  const payloads = sorted.map((icon) => (icon.size >= 256 ? icon.data : dibFromRgba(decodePng(icon.data))));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sorted.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * sorted.length;
  sorted.forEach((icon, i) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(icon.size >= 256 ? 0 : icon.size, 0);
    entry.writeUInt8(icon.size >= 256 ? 0 : icon.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(payloads[i].length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += payloads[i].length;
  });
  return Buffer.concat([header, ...entries, ...payloads]);
}

const ICNS_TYPES: Record<number, string> = { 16: "icp4", 32: "icp5", 64: "icp6", 128: "ic07", 256: "ic08", 512: "ic09", 1024: "ic10" };

export function packIcns(icons: PngIcon[]): Buffer {
  const chunks: Buffer[] = [];
  for (const icon of [...icons].sort((a, b) => a.size - b.size)) {
    const type = ICNS_TYPES[icon.size];
    if (!type) continue;
    assertPng(icon);
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, "ascii");
    head.writeUInt32BE(icon.data.length + 8, 4);
    chunks.push(head, icon.data);
  }
  if (!chunks.length) throw new Error("no icon sizes usable for icns (16, 32, 64, 128, 256, 512, 1024)");
  const total = chunks.reduce((n, c) => n + c.length, 0) + 8;
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...chunks]);
}

export function readIcoDirectory(ico: Buffer): { size: number; bytes: number; offset: number }[] {
  const count = ico.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    const w = ico.readUInt8(at);
    out.push({ size: w === 0 ? 256 : w, bytes: ico.readUInt32LE(at + 8), offset: ico.readUInt32LE(at + 12) });
  }
  return out;
}
