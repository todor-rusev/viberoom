// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { describeNetworkError } from "../net/outbound.js";
import { redact } from "../redact.js";

export interface TranscribeEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export interface Recording {
  audio: Uint8Array;
  mimeType: string;
}

export interface TranscribeOptions {
  language?: string;
  prompt?: string;
}

export const RECORDING_TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

export const SOUND_EXTENSIONS: Record<string, string> = {
  webm: "audio/webm",
  weba: "audio/webm",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  mp3: "audio/mpeg",
  mpga: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  wav: "audio/wav",
  flac: "audio/flac",
};

export const RECORDING_MAX_BYTES = 25 * 1024 * 1024;

export function providerRefusal(status: number, body: string, failed = "turn the recording into text", tooBig = "the recording"): string {
  let said = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown; detail?: unknown };
    const inner = typeof parsed.error === "object" && parsed.error ? parsed.error.message : parsed.error ?? parsed.message ?? parsed.detail;
    if (typeof inner === "string") said = inner;
  } catch { }
  const line = redact(said.replace(/\s+/g, " ").trim()).slice(0, 240);
  const why = status === 401 || status === 403 ? "the key was refused" : status === 404 ? "no such model or address" : status === 413 ? `${tooBig} is too big` : status === 429 ? "too many requests, or no credit left" : `it answered ${status}`;
  return `The speech provider could not ${failed}: ${why}${line ? ` (${line})` : ""}.`;
}

export async function checkKey(endpoint: TranscribeEndpoint): Promise<void> {
  const url = new URL("models", endpoint.baseUrl.endsWith("/") ? endpoint.baseUrl : `${endpoint.baseUrl}/`);
  let response: Response;
  try {
    response = await fetch(url, { headers: endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}, signal: AbortSignal.timeout(endpoint.timeoutMs ?? 15_000) });
  } catch (error) {
    throw new Error(`The speech provider at ${url.host} could not be reached: ${redact(describeNetworkError(error))}.`);
  }
  const body = await response.text();
  if (!response.ok) throw new Error(providerRefusal(response.status, body, "take the key", "the request"));
}

export async function transcribe(endpoint: TranscribeEndpoint, recording: Recording, options: TranscribeOptions = {}): Promise<string> {
  const type = recording.mimeType.split(";")[0].trim().toLowerCase();
  if (!Object.hasOwn(RECORDING_TYPES, type)) throw new Error(`A recording of type ${type || "unknown"} cannot be turned into text here.`);
  const extension = RECORDING_TYPES[type];
  const form = new FormData();
  form.set("file", new Blob([recording.audio], { type }), `recording.${extension}`);
  form.set("model", endpoint.model);
  form.set("response_format", "json");
  if (options.language) form.set("language", options.language);
  if (options.prompt) form.set("prompt", options.prompt);
  const url = new URL("audio/transcriptions", endpoint.baseUrl.endsWith("/") ? endpoint.baseUrl : `${endpoint.baseUrl}/`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {},
      body: form,
      signal: AbortSignal.timeout(endpoint.timeoutMs ?? 120_000),
    });
  } catch (error) {
    throw new Error(`The speech provider at ${url.host} could not be reached: ${redact(describeNetworkError(error))}.`);
  }
  const body = await response.text();
  if (!response.ok) throw new Error(providerRefusal(response.status, body));
  let text: unknown;
  try { text = (JSON.parse(body) as { text?: unknown }).text; } catch { text = undefined; }
  if (typeof text !== "string") throw new Error("The speech provider answered without a text.");
  return text.trim();
}
