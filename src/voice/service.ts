// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { readFile } from "node:fs/promises";
import { decodeData } from "../files.js";
import type { Logger } from "../log.js";
import { AUTO_READS, READERS, isLanguageCode, isVoiceName, readingConsentWords, readingReadiness, voiceConsentWords, voiceReadiness, type AutoRead, type Reader, type VoiceConfigStore, type VoiceView } from "./config.js";
import { VOICE_PROVIDERS, coerceVoiceSettings, fieldValue, voiceProvider } from "./registry.js";
import { SPEECH_MAX_CHARS, synthesize, type Speech } from "./speech.js";
import { RECORDING_MAX_BYTES, checkKey, transcribe, type TranscribeEndpoint } from "./transcribe.js";

export interface TranscribeRequest {
  audio?: unknown;
  mimeType?: unknown;
  seconds?: unknown;
}

function readingPatch(value: unknown): { reader?: Reader; voice?: string; auto?: AutoRead; consent?: boolean } {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("reading must be an object: reader, voice, auto, consent");
  const r = value as Record<string, unknown>;
  const unknown = Object.keys(r).filter((key) => !["reader", "voice", "auto", "consent"].includes(key));
  if (unknown.length) throw new Error(`reading has no setting "${unknown[0]}"`);
  if (r.reader !== undefined && !READERS.includes(r.reader as Reader)) throw new Error(`the reader is one of: ${READERS.join(", ")}`);
  if (r.voice !== undefined && !isVoiceName(r.voice)) throw new Error("the voice is a name as the window lists it");
  if (r.auto !== undefined && !AUTO_READS.includes(r.auto as AutoRead)) throw new Error(`which new replies are read is one of: ${AUTO_READS.join(", ")}`);
  if (r.consent !== undefined && typeof r.consent !== "boolean") throw new Error("the consent to reading must be true or false");
  return { ...(r.reader !== undefined ? { reader: r.reader as Reader } : {}), ...(r.voice !== undefined ? { voice: r.voice as string } : {}), ...(r.auto !== undefined ? { auto: r.auto as AutoRead } : {}), ...(r.consent !== undefined ? { consent: r.consent as boolean } : {}) };
}

function promptOf(names: string[]): string | undefined {
  const words = [...new Set(names.map((n) => n.trim()).filter(Boolean)), "viberoom"];
  return words.length > 1 ? `${words.join(", ")}.` : undefined;
}

export class VoiceService {
  constructor(readonly store: VoiceConfigStore, private readonly log: Logger, private readonly send: typeof transcribe = transcribe, private readonly say: typeof synthesize = synthesize, private readonly check: typeof checkKey = checkKey) {}

  async proveKey(provider: string, settings: Record<string, unknown>): Promise<boolean> {
    const entry = voiceProvider(provider);
    if (!entry) throw new Error(`"${provider}" is not a voice provider`);
    if (entry.id === "compatible") return false;
    const candidate = coerceVoiceSettings(entry, this.store.get().providers[entry.id] ?? {}, settings);
    await this.check({ baseUrl: entry.baseUrl(candidate), apiKey: fieldValue(entry, candidate, "apiKey"), model: "" });
    return true;
  }

  view(): VoiceView {
    return this.store.describe();
  }

  set(patch: { provider?: unknown; settings?: unknown; consent?: unknown; language?: unknown; reading?: unknown }): VoiceView {
    if (patch.provider !== undefined && patch.provider !== "off" && !voiceProvider(String(patch.provider))) throw new Error(`the voice provider is off or one of: ${VOICE_PROVIDERS.map((e) => e.id).join(", ")}`);
    if (patch.settings !== undefined && (typeof patch.settings !== "object" || patch.settings === null || Array.isArray(patch.settings))) throw new Error("settings must be an object of the provider's fields");
    if (patch.consent !== undefined && typeof patch.consent !== "boolean") throw new Error("consent must be true or false");
    if (patch.language !== undefined && !isLanguageCode(patch.language)) throw new Error("the language is two letters of ISO 639-1 (bg, en), or empty to let the model hear it");
    const reading = readingPatch(patch.reading);
    const targetId = patch.provider !== undefined ? String(patch.provider) : this.store.get().provider;
    const target = voiceProvider(targetId);
    if (patch.settings !== undefined && !target) throw new Error("choose a provider before its settings");
    if (reading.consent !== undefined && !target) throw new Error("choose a provider before consenting to its reading");
    const settings = patch.settings !== undefined && target ? coerceVoiceSettings(target, this.store.get().providers[target.id] ?? {}, patch.settings as Record<string, unknown>) : null;
    this.store.update((s) => {
      if (patch.provider !== undefined) s.provider = targetId;
      if (settings && target) s.providers[target.id] = settings;
      if (typeof patch.language === "string") s.language = patch.language;
      if (patch.consent === true && target) {
        const words = voiceConsentWords(target, s.providers[target.id] ?? {});
        if (s.consent[target.id]?.words !== words) s.consent[target.id] = { at: Date.now(), words };
      }
      if (patch.consent === false && target) delete s.consent[target.id];
      if (reading.reader !== undefined) s.reading.reader = reading.reader;
      if (reading.voice !== undefined) s.reading.voice = reading.voice;
      if (reading.auto !== undefined) s.reading.auto = reading.auto;
      if (reading.consent === true && target) {
        const words = readingConsentWords(target, s.providers[target.id] ?? {});
        if (s.reading.consent[target.id]?.words !== words) s.reading.consent[target.id] = { at: Date.now(), words };
      }
      if (reading.consent === false && target) delete s.reading.consent[target.id];
    });
    return this.store.describe();
  }

  async speak(text: unknown): Promise<Speech> {
    const state = this.store.get();
    if (state.reading.reader !== "provider") throw new Error("Reading aloud by the provider is off: Settings → Voice.");
    const readiness = readingReadiness(state);
    if (!readiness.ready) throw new Error(`${readiness.reason}: Settings → Voice.`);
    const input = typeof text === "string" ? text.trim() : "";
    if (!input) throw new Error("there is nothing to read aloud");
    if (input.length > SPEECH_MAX_CHARS) throw new Error(`a piece to read aloud is at most ${SPEECH_MAX_CHARS} characters`);
    const entry = voiceProvider(state.provider)!;
    const settings = state.providers[entry.id] ?? {};
    const model = fieldValue(entry, settings, "speechModel");
    const started = Date.now();
    const speech = await this.say({ baseUrl: entry.baseUrl(settings), apiKey: fieldValue(entry, settings, "apiKey"), model }, { input, voice: fieldValue(entry, settings, "speechVoice") });
    this.log.info(`${input.length} characters read aloud as ${Math.round(speech.audio.length / 1024)} KB of ${speech.mimeType} in ${((Date.now() - started) / 1000).toFixed(1)} s (${entry.id}, ${model})`);
    return speech;
  }

  async transcribe(request: TranscribeRequest, names: string[]): Promise<string> {
    if (typeof request.audio !== "string" || !request.audio) throw new Error("the recording is empty");
    return this.hear(Buffer.from(request.audio, "base64"), typeof request.mimeType === "string" ? request.mimeType : "", names, typeof request.seconds === "number" ? request.seconds : undefined);
  }

  async hear(audio: Uint8Array, mimeType: string, names: string[], seconds?: number, language?: string): Promise<string> {
    const state = this.store.get();
    const readiness = voiceReadiness(state);
    if (!readiness.ready) throw new Error(`${readiness.reason}: Settings → Voice.`);
    if (!audio.length) throw new Error("the recording is empty");
    if (audio.length > RECORDING_MAX_BYTES) throw new Error("the recording is longer than a speech provider takes at once");
    const entry = voiceProvider(state.provider)!;
    const settings = state.providers[entry.id] ?? {};
    const endpoint: TranscribeEndpoint = { baseUrl: entry.baseUrl(settings), apiKey: fieldValue(entry, settings, "apiKey"), model: fieldValue(entry, settings, "model") };
    const started = Date.now();
    const text = await this.send(endpoint, { audio, mimeType }, { language: language || state.language || undefined, prompt: promptOf(names) });
    const length = typeof seconds === "number" && Number.isFinite(seconds) ? `${seconds.toFixed(1)} s of audio` : "a recording";
    this.log.info(`${length} (${Math.round(audio.length / 1024)} KB) made ${text.length} characters of text in ${((Date.now() - started) / 1000).toFixed(1)} s (${entry.id}, ${endpoint.model})`);
    return text;
  }

  async hearAll<T extends { data?: string; path?: string; mimeType: string; seconds?: number }>(sounds: T[], names: string[]): Promise<(T & { words?: string; unheard?: string })[]> {
    const heard: (T & { words?: string; unheard?: string })[] = [];
    for (const sound of sounds) {
      try {
        const bytes = sound.path ? await readFile(sound.path) : decodeData(sound.data ?? "", "the recording");
        heard.push({ ...sound, words: await this.hear(bytes, sound.mimeType, names, sound.seconds) });
      } catch (error) {
        heard.push({ ...sound, unheard: error instanceof Error ? error.message : String(error) });
      }
    }
    return heard;
  }
}
