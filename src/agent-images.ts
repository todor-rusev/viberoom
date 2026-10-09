// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { Worker } from "node:worker_threads";
import type { AgentImageAnswer, AgentImageJob } from "./agent-image-worker.js";
import { IMAGES_PER_MESSAGE } from "./files.js";
import { pictureSizeOf, type PictureSize } from "./image-size.js";

export const AGENT_IMAGE_MAX = 2000;
export const AGENT_MESSAGE_MAX_BYTES = 32 * 1024 * 1024;
export const PROMPT_TEXT_ALLOWANCE = 2 * 1024 * 1024;
const PROMPT_FRAME_BYTES = 64 * 1024;
const IMAGE_BLOCK_FRAME_BYTES = 128;
const base64Bytes = (bytes: number): number => Math.ceil(bytes / 3) * 4;
export const AGENT_IMAGE_MAX_BYTES = Math.floor(Math.min(5_000_000,
  Math.floor((AGENT_MESSAGE_MAX_BYTES - PROMPT_FRAME_BYTES - PROMPT_TEXT_ALLOWANCE) / IMAGES_PER_MESSAGE) - IMAGE_BLOCK_FRAME_BYTES) / 4) * 3;

export class PromptBudget {
  #left: number;
  constructor(textBytes: number, limit = AGENT_MESSAGE_MAX_BYTES) {
    this.#left = limit - PROMPT_FRAME_BYTES - textBytes;
  }
  take(fileBytes: number): boolean {
    const cost = base64Bytes(fileBytes) + IMAGE_BLOCK_FRAME_BYTES;
    if (cost > this.#left) return false;
    this.#left -= cost;
    return true;
  }
}

export type AgentImageState = { state: "preparing" } | { state: "failed"; reason: string };
export type AgentView = { path: string; mimeType: string } | { unavailable: string };
export interface PictureTag { room: string; file: string }

type Kind = AgentImageJob["kind"];
const KINDS: Record<string, Kind> = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp", "image/gif": "gif" };
const COPIES = [["png", "image/png"], ["jpg", "image/jpeg"], ["webp", "image/webp"]] as const;

export interface AgentImagesOptions {
  log: { info(text: string): void; warn(text: string): void };
  onChange?: (tag: PictureTag, state: AgentImageState | null) => void;
  max?: number;
  maxBytes?: number;
  run?: (job: AgentImageJob) => Promise<AgentImageAnswer>;
  size?: (path: string) => Promise<PictureSize | null>;
}

export class AgentImages {
  #o: Required<Pick<AgentImagesOptions, "log" | "max" | "maxBytes" | "run" | "size">> & Pick<AgentImagesOptions, "onChange">;
  #views = new Map<string, Promise<AgentView>>();
  #states = new Map<string, { tag: PictureTag; state: AgentImageState }>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: AgentImagesOptions) {
    this.#o = { log: options.log, onChange: options.onChange, max: options.max ?? AGENT_IMAGE_MAX, maxBytes: options.maxBytes ?? AGENT_IMAGE_MAX_BYTES, run: options.run ?? runInWorker, size: options.size ?? pictureSizeOf };
  }

  prepare(path: string, mimeType: string, tag: PictureTag): Promise<AgentView> {
    return this.forAgent(path, mimeType, tag);
  }

  forAgent(path: string, mimeType: string, tag: PictureTag): Promise<AgentView> {
    let view = this.#views.get(path);
    if (!view) {
      view = this.#decide(path, mimeType, tag);
      this.#views.set(path, view);
    }
    return view;
  }

  states(): Array<PictureTag & AgentImageState> {
    return [...this.#states.values()].map(({ tag, state }) => ({ ...tag, ...state }));
  }

  async #decide(path: string, mimeType: string, tag: PictureTag): Promise<AgentView> {
    const original = { path, mimeType };
    const kind = KINDS[mimeType];
    if (!kind) return original;
    let size: PictureSize | null;
    try {
      size = await this.#o.size(path);
    } catch (error) {
      return this.#failed(tag, `it could not be read (${describe(error)})`);
    }
    if (!size) return original;
    let bytes = 0;
    try { bytes = (await stat(path)).size; } catch { }
    const turned = kind === "jpeg" && !!size.orientation && size.orientation !== 1;
    if (Math.max(size.width, size.height) <= this.#o.max && bytes <= this.#o.maxBytes && !turned) return original;
    const outputBase = join(dirname(path), `${basename(path, extname(path))}.agent`);
    for (const [ext, copyType] of COPIES) {
      const copy = `${outputBase}.${ext}`;
      const found = await stat(copy).catch(() => null);
      if (found?.isFile() && found.size <= this.#o.maxBytes) return { path: copy, mimeType: copyType };
    }
    this.#set(tag, { state: "preparing" });
    const job: AgentImageJob = { input: path, outputBase, kind, max: this.#o.max, maxBytes: this.#o.maxBytes, ...(turned ? { orientation: size.orientation } : {}) };
    const done = this.#queue.then(() => this.#o.run(job)).catch((error: unknown): AgentImageAnswer => ({ ok: false, error: describe(error) }));
    this.#queue = done;
    const answer = await done;
    if (!answer.ok) return this.#failed(tag, `it could not be made smaller (${answer.error})`);
    this.#o.log.info(`${tag.file} of ${size.width}x${size.height} is made ${answer.width}x${answer.height} for the vibemates`);
    this.#set(tag, null);
    return { path: answer.path, mimeType: answer.mimeType };
  }

  #failed(tag: PictureTag, why: string): AgentView {
    this.#o.log.warn(`${tag.file} is not given to the vibemates: ${why}`);
    this.#set(tag, { state: "failed", reason: why });
    return { unavailable: why };
  }

  #set(tag: PictureTag, state: AgentImageState | null): void {
    const key = `${tag.room}/${tag.file}`;
    if (state) this.#states.set(key, { tag, state });
    else if (!this.#states.delete(key)) return;
    try { this.#o.onChange?.(tag, state); } catch { }
  }
}

function describe(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, 200);
}

function runInWorker(job: AgentImageJob): Promise<AgentImageAnswer> {
  return new Promise((resolve) => {
    let answer: AgentImageAnswer | undefined;
    const worker = new Worker(new URL("./agent-image-worker.js", import.meta.url), { workerData: job });
    worker.once("message", (value: AgentImageAnswer) => { answer = value; void worker.terminate(); });
    worker.once("error", (error) => { answer ??= { ok: false, error: describe(error) }; });
    worker.once("exit", () => resolve(answer ?? { ok: false, error: "the worker ended before it answered" }));
  });
}
