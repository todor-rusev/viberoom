// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import { hostOf, isThisComputer } from "../net/hosts.js";
import type { Vault } from "../vault.js";
import { readinessView, type Readiness } from "../readiness.js";
import { adoptSecrets, withReferences, type SecretSlot } from "../vault-slots.js";
import { VOICE_PROVIDERS, fieldValue, voiceProvider, type VoiceField, type VoiceProviderEntry } from "./registry.js";

export interface VoiceConfig {
  version: 1;
  provider: string;
  providers: Record<string, Record<string, unknown>>;
  consent: Record<string, { at: number; words: string }>;
  language: string;
  reading: ReadingConfig;
}

export const READERS = ["off", "system", "provider"] as const;
export type Reader = (typeof READERS)[number];
export const AUTO_READS = ["off", "to-me", "every"] as const;
export type AutoRead = (typeof AUTO_READS)[number];

export interface ReadingConfig {
  reader: Reader;
  voice: string;
  auto: AutoRead;
  consent: Record<string, { at: number; words: string }>;
}

export const isLanguageCode = (value: unknown): value is string => typeof value === "string" && /^([a-z]{2})?$/.test(value);

export const isVoiceName = (value: unknown): value is string => typeof value === "string" && value.length <= 200 && !/[\u0000-\u001f]/.test(value);

export function fieldsFor(entry: VoiceProviderEntry, use: "hearing" | "reading"): VoiceField[] {
  return entry.fields.filter((field) => !field.use || field.use === use);
}

export function voiceConsentWords(entry: VoiceProviderEntry, settings: Record<string, unknown>): string {
  const what = "Each recording, and each sound of a room a vibemate asks to hear,";
  const kept = "A dictation's words go only into your message field; a voice message or a sound file keeps its words in the room, as the message does.";
  return entry.id === "compatible"
    ? `${what} goes whole to your own server, at the address set for it, and is turned into text there: on this computer it stays here; elsewhere, its owner's terms apply. ${kept}`
    : `${what} is sent whole to ${entry.label} (${hostOf(entry.baseUrl(settings))}), which turns it into text under its own terms. ${kept}`;
}

export function voiceConsentCurrent(state: VoiceConfig, id: string): boolean {
  const entry = voiceProvider(id);
  const stamp = state.consent[id];
  return !!entry && !!stamp && stamp.words === voiceConsentWords(entry, state.providers[id] ?? {});
}

export function readingConsentWords(entry: VoiceProviderEntry, settings: Record<string, unknown>): string {
  const what = "The text of each reply you have read aloud";
  const kept = "viberoom keeps neither the text it sent nor the sound.";
  return entry.id === "compatible"
    ? `${what} goes to your own server, at the address set for it, and is turned into speech there: on this computer it stays here; elsewhere, its owner's terms apply. ${kept}`
    : `${what} is sent to ${entry.label} (${hostOf(entry.baseUrl(settings))}), which turns it into speech under its own terms. ${kept}`;
}

export function readingConsentCurrent(state: VoiceConfig, id: string): boolean {
  const entry = voiceProvider(id);
  const stamp = state.reading.consent[id];
  return !!entry && !!stamp && stamp.words === readingConsentWords(entry, state.providers[id] ?? {});
}

function missingField(entry: VoiceProviderEntry, settings: Record<string, unknown>, use: "hearing" | "reading"): VoiceField | undefined {
  return fieldsFor(entry, use).find((field) => !field.optional && !fieldValue(entry, settings, field.key));
}

export function readingReadiness(state: VoiceConfig): Readiness {
  const reader = state.reading.reader;
  if (reader === "off") return { ready: false, reason: "No reader is chosen yet", missing: "reader" };
  if (reader === "system") return { ready: true };
  const entry = voiceProvider(state.provider);
  if (!entry) return { ready: false, reason: "Reading by the provider needs a provider chosen above", missing: "provider" };
  if (!readingConsentCurrent(state, entry.id)) return { ready: false, reason: `Your consent to reading by ${entry.label} is not given yet`, missing: "consent" };
  const missing = missingField(entry, state.providers[entry.id] ?? {}, "reading");
  if (missing) return { ready: false, reason: `${missing.label} is not set yet`, missing: missing.key };
  return { ready: true };
}

export function voiceReadiness(state: VoiceConfig): Readiness {
  const entry = voiceProvider(state.provider);
  if (!entry) return { ready: false, reason: "No provider is chosen yet", missing: "provider" };
  if (!voiceConsentCurrent(state, entry.id)) return { ready: false, reason: `Your consent to ${entry.label} is not given yet`, missing: "consent" };
  const missing = missingField(entry, state.providers[entry.id] ?? {}, "hearing");
  if (missing) return { ready: false, reason: `${missing.label} is not set yet`, missing: missing.key };
  return { ready: true };
}

export interface VoiceFieldView extends Omit<VoiceField, "default"> {
  value?: string;
  set?: boolean;
}

export interface VoiceProviderView {
  id: string;
  label: string;
  blurb: string;
  consent: boolean;
  consentLapsed: boolean;
  consentText: string;
  readingConsent: boolean;
  readingConsentLapsed: boolean;
  readingConsentText: string;
  fields: VoiceFieldView[];
}

export interface VoiceView {
  provider: string;
  providers: VoiceProviderView[];
  language: string;
  ready: boolean;
  reason?: string;
  missing?: string;
  reading: { reader: Reader; voice: string; auto: AutoRead; ready: boolean; reason?: string; missing?: string };
}

function empty(): VoiceConfig {
  return { version: 1, provider: "off", providers: {}, consent: {}, language: "", reading: { reader: "off", voice: "", auto: "off", consent: {} } };
}

function secretSlots(state: VoiceConfig): SecretSlot[] {
  const slots: SecretSlot[] = [];
  for (const entry of VOICE_PROVIDERS) {
    const section = state.providers[entry.id] ?? (state.providers[entry.id] = {});
    for (const field of entry.fields) {
      if (field.kind !== "secret") continue;
      slots.push({ name: `voice.providers.${entry.id}.${field.key}`, get: () => section[field.key], set: (value) => { section[field.key] = value; } });
    }
  }
  return slots;
}

function load(path: string): VoiceConfig {
  const state = empty();
  if (!existsSync(path)) return state;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (typeof raw.provider === "string" && (raw.provider === "off" || voiceProvider(raw.provider))) state.provider = raw.provider;
    if (raw.providers && typeof raw.providers === "object") {
      for (const [id, section] of Object.entries(raw.providers as Record<string, unknown>)) {
        if (voiceProvider(id) && section && typeof section === "object") state.providers[id] = { ...(section as Record<string, unknown>) };
      }
    }
    if (raw.consent && typeof raw.consent === "object") {
      for (const [id, stamp] of Object.entries(raw.consent as Record<string, unknown>)) {
        const s = stamp as { at?: unknown; words?: unknown } | null;
        if (voiceProvider(id) && s && typeof s.at === "number" && typeof s.words === "string") state.consent[id] = { at: s.at, words: s.words };
      }
    }
    if (isLanguageCode(raw.language)) state.language = raw.language;
    const reading = (raw.reading && typeof raw.reading === "object" ? raw.reading : {}) as Record<string, unknown>;
    if (READERS.includes(reading.reader as Reader)) state.reading.reader = reading.reader as Reader;
    if (isVoiceName(reading.voice)) state.reading.voice = reading.voice;
    if (AUTO_READS.includes(reading.auto as AutoRead)) state.reading.auto = reading.auto as AutoRead;
    if (reading.consent && typeof reading.consent === "object") {
      for (const [id, stamp] of Object.entries(reading.consent as Record<string, unknown>)) {
        const s = stamp as { at?: unknown; words?: unknown } | null;
        if (voiceProvider(id) && s && typeof s.at === "number" && typeof s.words === "string") state.reading.consent[id] = { at: s.at, words: s.words };
      }
    }
  } catch {
  }
  return state;
}

export class VoiceConfigStore {
  private state: VoiceConfig;
  private readonly vault: () => Vault | null;

  constructor(readonly path: string, vault?: Vault | (() => Vault | null)) {
    this.vault = typeof vault === "function" ? vault : () => vault ?? null;
    this.state = load(path);
    if (adoptSecrets(secretSlots(this.state), this.vault)) this.write();
  }

  get(): VoiceConfig {
    return this.state;
  }

  clear(): void {
    const vault = this.vault();
    if (vault) for (const slot of secretSlots(empty())) vault.delete(slot.name);
    this.state = empty();
    rmSync(this.path, { force: true });
  }

  update(change: (state: VoiceConfig) => void): void {
    change(this.state);
    this.write();
  }

  private write(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileAtomic(this.path, JSON.stringify(withReferences(this.state, secretSlots, this.vault), null, 2) + "\n");
    if (process.platform !== "win32") chmodSync(this.path, 0o600);
  }

  describe(): VoiceView {
    const s = this.state;
    const readiness = voiceReadiness(s);
    const reading = readingReadiness(s);
    return {
      provider: s.provider,
      providers: VOICE_PROVIDERS.map((entry) => {
        const section = s.providers[entry.id] ?? {};
        return {
          id: entry.id,
          label: entry.label,
          blurb: entry.blurb,
          consent: voiceConsentCurrent(s, entry.id),
          consentLapsed: !!s.consent[entry.id] && !voiceConsentCurrent(s, entry.id),
          consentText: voiceConsentWords(entry, section),
          readingConsent: readingConsentCurrent(s, entry.id),
          readingConsentLapsed: !!s.reading.consent[entry.id] && !readingConsentCurrent(s, entry.id),
          readingConsentText: readingConsentWords(entry, section),
          fields: entry.fields.map(({ default: _default, ...field }) => field.kind === "secret"
            ? { ...field, set: typeof section[field.key] === "string" && section[field.key] !== "" }
            : { ...field, value: typeof section[field.key] === "string" ? String(section[field.key]) : "" }),
        };
      }),
      language: s.language,
      ...readinessView(readiness),
      reading: { reader: s.reading.reader, voice: s.reading.voice, auto: s.reading.auto, ...readinessView(reading) },
    };
  }
}
