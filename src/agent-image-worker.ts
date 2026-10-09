// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

export interface AgentImageJob {
  input: string;
  outputBase: string;
  kind: "png" | "jpeg" | "webp" | "gif";
  max: number;
  maxBytes: number;
  orientation?: number;
}
export type AgentImageAnswer = { ok: true; path: string; mimeType: string; width: number; height: number } | { ok: false; error: string };

interface Picture { data: Uint8ClampedArray; width: number; height: number }
interface GifReaderLike { width: number; height: number; decodeAndBlitFrameRGBA(frame: number, pixels: Uint8ClampedArray): void }

const require = createRequire(import.meta.url);
const scope = globalThis as unknown as { ImageData?: unknown };
scope.ImageData ??= class ImageData { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} };
type WasmModule = object;
const { compile } = (globalThis as unknown as { WebAssembly: { compile(bytes: Uint8Array): Promise<WasmModule> } }).WebAssembly;
const wasm = async (spec: string): Promise<WasmModule> => compile(await readFile(require.resolve(spec)));

type Encoder = (picture: Picture) => Promise<ArrayBuffer>;
const FORMATS = { png: { ext: "png", mimeType: "image/png" }, jpeg: { ext: "jpg", mimeType: "image/jpeg" }, webp: { ext: "webp", mimeType: "image/webp" } } as const;
type Format = keyof typeof FORMATS;

async function codecs() {
  const png = { dec: await import("@jsquash/png/decode.js"), enc: await import("@jsquash/png/encode.js") };
  const jpeg = { dec: await import("@jsquash/jpeg/decode.js"), enc: await import("@jsquash/jpeg/encode.js") };
  const webp = { dec: await import("@jsquash/webp/decode.js"), enc: await import("@jsquash/webp/encode.js") };
  const resize = await import("@jsquash/resize");
  const ready = new Map<string, Promise<unknown>>();
  const once = (key: string, init: () => Promise<unknown>) => { if (!ready.has(key)) ready.set(key, init()); return ready.get(key)!; };
  return {
    decode: {
      png: async (b: ArrayBuffer) => { await once("png.dec", async () => png.dec.init(await wasm("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"))); return png.dec.default(b) as Promise<Picture>; },
      jpeg: async (b: ArrayBuffer) => { await once("jpeg.dec", async () => jpeg.dec.init(await wasm("@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm"))); return jpeg.dec.default(b) as Promise<Picture>; },
      webp: async (b: ArrayBuffer) => { await once("webp.dec", async () => webp.dec.init(await wasm("@jsquash/webp/codec/dec/webp_dec.wasm"))); return webp.dec.default(b) as Promise<Picture>; },
    },
    encode: {
      png: (async (p) => { await once("png.dec", async () => png.dec.init(await wasm("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"))); return png.enc.default(p as Parameters<typeof png.enc.default>[0]); }) as Encoder,
      jpeg: (async (p) => { await once("jpeg.enc", async () => jpeg.enc.init(await wasm("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"))); return jpeg.enc.default(p as Parameters<typeof jpeg.enc.default>[0], { quality: 85 }); }) as Encoder,
      webp: (async (p) => { await once("webp.enc", async () => webp.enc.init(await wasm("@jsquash/webp/codec/enc/webp_enc.wasm"))); return webp.enc.default(p as Parameters<typeof webp.enc.default>[0], { quality: 85 }); }) as Encoder,
    },
    resize: async (p: Picture, width: number, height: number): Promise<Picture> => {
      await once("resize", async () => resize.initResize(await wasm("@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm")));
      return resize.default(p as Parameters<typeof resize.default>[0], { width, height }) as Promise<Picture>;
    },
  };
}

export function orient(picture: Picture, orientation: number): Picture {
  if (!(orientation >= 2 && orientation <= 8)) return picture;
  const { width: w, height: h, data } = picture;
  const swap = orientation >= 5;
  const W = swap ? h : w, H = swap ? w : h;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [dx, dy] = orientation === 2 ? [w - 1 - x, y] : orientation === 3 ? [w - 1 - x, h - 1 - y] : orientation === 4 ? [x, h - 1 - y]
        : orientation === 5 ? [y, x] : orientation === 6 ? [h - 1 - y, x] : orientation === 7 ? [h - 1 - y, w - 1 - x] : [y, w - 1 - x];
      const from = (y * w + x) * 4, to = (dy * W + dx) * 4;
      out[to] = data[from]; out[to + 1] = data[from + 1]; out[to + 2] = data[from + 2]; out[to + 3] = data[from + 3];
    }
  }
  return { data: out, width: W, height: H };
}

const opaque = (p: Picture): boolean => { for (let i = 3; i < p.data.length; i += 4) if (p.data[i] !== 255) return false; return true; };

async function run(job: AgentImageJob): Promise<AgentImageAnswer> {
  const bytes = await readFile(job.input);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const c = await codecs();
  let picture: Picture;
  let format: Format;
  if (job.kind === "gif") {
    const { GifReader } = require("omggif") as { GifReader: new (data: Uint8Array) => GifReaderLike };
    const reader = new GifReader(new Uint8Array(buffer));
    const pixels = new Uint8ClampedArray(reader.width * reader.height * 4);
    reader.decodeAndBlitFrameRGBA(0, pixels);
    picture = { data: pixels, width: reader.width, height: reader.height };
    format = "png";
  } else {
    picture = await c.decode[job.kind](buffer);
    format = job.kind;
  }
  if (job.kind === "jpeg" && job.orientation) picture = orient(picture, job.orientation);
  let scale = Math.min(1, job.max / Math.max(picture.width, picture.height));
  const at = (s: number) => [Math.max(1, Math.round(picture.width * s)), Math.max(1, Math.round(picture.height * s))] as const;
  for (let attempt = 0; ; attempt++) {
    const [width, height] = at(scale);
    const sized = width === picture.width && height === picture.height ? picture : await c.resize(picture, width, height);
    const encoded = await c.encode[format](sized);
    if (encoded.byteLength <= job.maxBytes) return write(job, format, encoded, width, height);
    if (format === "png" && opaque(sized)) { format = "jpeg"; continue; }
    if (attempt >= 6) throw new Error(`it is still ${Math.round(encoded.byteLength / 1e6)} MB at ${width}x${height}`);
    scale *= 0.75;
  }
}

async function write(job: AgentImageJob, format: Format, encoded: ArrayBuffer, width: number, height: number): Promise<AgentImageAnswer> {
  const path = `${job.outputBase}.${FORMATS[format].ext}`;
  const partial = `${path}.${process.pid}.partial`;
  try {
    await writeFile(partial, new Uint8Array(encoded));
    await rename(partial, path);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  return { ok: true, path, mimeType: FORMATS[format].mimeType, width, height };
}

if (parentPort && workerData) {
  const port = parentPort;
  run(workerData as AgentImageJob).then(
    (answer) => port.postMessage(answer),
    (error: unknown) => port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies AgentImageAnswer),
  );
}
