// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { isThisComputer } from "../net/hosts.js";

export interface VoiceField {
  key: string;
  label: string;
  kind: "secret" | "text";
  hint?: string;
  placeholder?: string;
  default?: string;
  optional?: boolean;
  use?: "hearing" | "reading";
}

export interface VoiceProviderEntry {
  id: string;
  label: string;
  blurb: string;
  fields: VoiceField[];
  baseUrl(settings: Record<string, unknown>): string;
}

export const VOICE_PROVIDERS: VoiceProviderEntry[] = [
  {
    id: "openai",
    label: "OpenAI",
    blurb: "OpenAI's own service: the most exact, paid by the minute of audio.",
    fields: [
      { key: "apiKey", kind: "secret", label: "OpenAI API key", hint: "From platform.openai.com, API keys. Kept encrypted in this computer's vault, never shown again.", placeholder: "paste the API key" },
      { key: "model", kind: "text", use: "hearing", label: "Model", default: "gpt-4o-transcribe", hint: "gpt-4o-transcribe by default; gpt-4o-mini-transcribe costs half; whisper-1 is the older one.", placeholder: "gpt-4o-transcribe" },
      { key: "speechModel", kind: "text", use: "reading", label: "Reading model", default: "gpt-4o-mini-tts", hint: "gpt-4o-mini-tts by default; tts-1 is the older one.", placeholder: "gpt-4o-mini-tts" },
      { key: "speechVoice", kind: "text", use: "reading", label: "Reading voice", default: "coral", hint: "One of OpenAI's voices: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer or verse.", placeholder: "coral" },
    ],
    baseUrl: () => "https://api.openai.com/v1",
  },
  {
    id: "groq",
    label: "Groq",
    blurb: "Whisper on Groq's servers: fast, with a free plan.",
    fields: [
      { key: "apiKey", kind: "secret", label: "Groq API key", hint: "From console.groq.com, API Keys. Kept encrypted in this computer's vault, never shown again.", placeholder: "paste the API key" },
      { key: "model", kind: "text", use: "hearing", label: "Model", default: "whisper-large-v3-turbo", hint: "whisper-large-v3-turbo by default; whisper-large-v3 is a little more exact and slower.", placeholder: "whisper-large-v3-turbo" },
      { key: "speechModel", kind: "text", use: "reading", label: "Reading model", hint: "Groq's own name for a model of its /audio/speech, when it has one for your language.", placeholder: "the model's name" },
      { key: "speechVoice", kind: "text", use: "reading", label: "Reading voice", hint: "Groq's own name for a voice of that model.", placeholder: "the voice's name" },
    ],
    baseUrl: () => "https://api.groq.com/openai/v1",
  },
  {
    id: "compatible",
    label: "Your own server",
    blurb: "Any server with OpenAI's audio API: a Whisper server on this computer keeps your voice here.",
    fields: [
      { key: "baseUrl", kind: "text", label: "Endpoint", hint: "The address before /audio/transcriptions: http://localhost:8000/v1 for a server on this computer, or another service's.", placeholder: "http://localhost:8000/v1" },
      { key: "apiKey", kind: "secret", label: "API key", optional: true, hint: "Kept encrypted in this computer's vault, never shown again. Empty for a server on this computer.", placeholder: "the server's key; empty for a local one" },
      { key: "model", kind: "text", use: "hearing", label: "Model", hint: "The server's own name for its Whisper model: whisper-1, or the one it loaded.", placeholder: "whisper-1" },
      { key: "speechModel", kind: "text", use: "reading", label: "Reading model", hint: "The server's own name for its /audio/speech model: kokoro on a Kokoro server.", placeholder: "kokoro" },
      { key: "speechVoice", kind: "text", use: "reading", label: "Reading voice", hint: "The server's own name for a voice: af_bella on Kokoro.", placeholder: "af_bella" },
    ],
    baseUrl: (settings) => String(settings.baseUrl ?? "").trim(),
  },
];

export function voiceProvider(id: string): VoiceProviderEntry | undefined {
  return VOICE_PROVIDERS.find((entry) => entry.id === id);
}

export function coerceVoiceSettings(entry: VoiceProviderEntry, current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...current };
  for (const [key, raw] of Object.entries(patch)) {
    const field = entry.fields.find((f) => f.key === key);
    if (!field) throw new Error(`${entry.label} has no setting "${key}"`);
    if (typeof raw !== "string") throw new Error(`${field.label} must be text`);
    const value = raw.trim();
    if (field.kind === "secret") {
      if (value) next[key] = value;
      continue;
    }
    if (key === "baseUrl" && value) {
      let url: URL;
      try { url = new URL(value); } catch { throw new Error(`${value} is not an address: it starts with https://`); }
      if (url.protocol !== "https:" && !(url.protocol === "http:" && isThisComputer(url.host))) throw new Error("the endpoint must be https://, or http:// only to this computer: a recording does not cross a network in the clear");
    }
    next[key] = value;
  }
  return next;
}

export function fieldValue(entry: VoiceProviderEntry, settings: Record<string, unknown>, key: string): string {
  const field = entry.fields.find((f) => f.key === key);
  const value = typeof settings[key] === "string" ? String(settings[key]).trim() : "";
  return value || field?.default || "";
}
