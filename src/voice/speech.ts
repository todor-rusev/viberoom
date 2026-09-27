// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { describeNetworkError } from "../net/outbound.js";
import { redact } from "../redact.js";
import { providerRefusal, type TranscribeEndpoint } from "./transcribe.js";

export const SPEECH_MAX_CHARS = 4096;

export interface SpeechRequest {
  input: string;
  voice: string;
}

export interface Speech {
  audio: Buffer;
  mimeType: string;
}

export async function synthesize(endpoint: TranscribeEndpoint, request: SpeechRequest): Promise<Speech> {
  const url = new URL("audio/speech", endpoint.baseUrl.endsWith("/") ? endpoint.baseUrl : `${endpoint.baseUrl}/`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}) },
      body: JSON.stringify({ model: endpoint.model, voice: request.voice, input: request.input, response_format: "mp3" }),
      signal: AbortSignal.timeout(endpoint.timeoutMs ?? 60_000),
    });
  } catch (error) {
    throw new Error(`The speech provider at ${url.host} could not be reached: ${redact(describeNetworkError(error))}.`);
  }
  if (!response.ok) throw new Error(providerRefusal(response.status, await response.text(), "read it aloud", "the text"));
  const mimeType = (response.headers.get("content-type") || "audio/mpeg").split(";")[0].trim().toLowerCase();
  if (!mimeType.startsWith("audio/")) throw new Error(`The speech provider answered with ${mimeType}, not a sound.`);
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) throw new Error("The speech provider answered without a sound.");
  return { audio, mimeType };
}
