// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import { hostOf, isThisComputer } from "../net/hosts.js";
import type { Vault } from "../vault.js";
import { readinessView, type Readiness } from "../readiness.js";
import { adoptSecrets, withReferences, type SecretSlot } from "../vault-slots.js";
import type { FilterMode } from "./filter.js";
import { QUESTIONS_FORM, isQuestionForm, type QuestionForm } from "./questions.js";
import type { MemoryCapabilities } from "./provider.js";
import type { ProviderEntry } from "./registry.js";
import { MEMORY_PROVIDERS, defaultProviderSettings, providerEntry } from "./registry.js";

export interface MemoryConfig {
  version: 1;
  provider: string;
  consent: Record<string, { at: number; words: string }>;
  providers: Record<string, Record<string, unknown>>;
  filter: {
    mode: FilterMode;
    baseUrl: string;
    apiKey: string;
    model: string;
    form: QuestionForm;
  };
  blockChars: number;
}

export const BLOCK_CHARS_DEFAULT = 4_000;
export const BLOCK_CHARS_MIN = 1_000;
export const BLOCK_CHARS_MAX = 8_000;

function boundedBlockChars(value: number): number {
  return Math.min(BLOCK_CHARS_MAX, Math.max(BLOCK_CHARS_MIN, Math.round(value)));
}

function empty(): MemoryConfig {
  const providers: Record<string, Record<string, unknown>> = {};
  for (const entry of MEMORY_PROVIDERS) providers[entry.id] = defaultProviderSettings(entry);
  return {
    version: 1,
    provider: "off",
    consent: {},
    providers,
    filter: { mode: "off", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "", form: QUESTIONS_FORM },
    blockChars: BLOCK_CHARS_DEFAULT,
  };
}

export function consentWords(entry: ProviderEntry, filter: MemoryConfig["filter"]): string {
  return `${sieveSentence(filter)} ${entry.consentText}`;
}


export function sieveUnset(filter: MemoryConfig["filter"]): boolean {
  return filter.mode === "llm" && (!filter.baseUrl || !filter.model);
}

export function consentCurrent(state: MemoryConfig, id: string): boolean {
  const entry = providerEntry(id);
  const stamp = state.consent[id];
  return !!entry && !!stamp && stamp.words === consentWords(entry, state.filter);
}

export function memoryReadiness(state: MemoryConfig): Readiness {
  const entry = providerEntry(state.provider);
  if (!entry) return { ready: false, reason: "No provider is chosen yet", missing: "provider" };
  if (!consentCurrent(state, entry.id)) return { ready: false, reason: `Your consent to ${entry.label} is not given yet`, missing: "consent" };
  const section = state.providers[entry.id] ?? {};
  const missing = entry.fields.find((field) => field.kind === "secret" && !String(section[field.key] ?? ""));
  if (missing) return { ready: false, reason: `${missing.label} is not set yet`, missing: missing.key };
  if (sieveUnset(state.filter)) return { ready: false, reason: "The sieve's endpoint and model are not set yet", missing: "sieve" };
  return { ready: true };
}

function sieveSentence(filter: MemoryConfig["filter"]): string {
  const host = filter.mode === "llm" ? hostOf(filter.baseUrl) : "";
  return host && !isThisComputer(host)
    ? `Every message of the remembering rooms is first sent whole to the sieve's model at ${host}, which keeps only what is worth remembering.`
    : "What the remembering rooms say is sifted on this computer first, as the sieve is set.";
}

export interface MemoryFieldView {
  key: string;
  label: string;
  kind: "secret" | "text" | "number";
  hint?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  value?: string | number;
  set?: boolean;
}

export interface MemoryProviderView {
  id: string;
  label: string;
  blurb: string;
  costUnit: string;
  capabilities: MemoryCapabilities;
  consent: boolean;
  consentLapsed: boolean;
  consentText: string;
  fields: MemoryFieldView[];
}

export interface MemoryConfigView {
  provider: string;
  providers: MemoryProviderView[];
  filter: { mode: FilterMode; baseUrl: string; model: string; keySet: boolean; form: QuestionForm };
  blockChars: number;
  ready: boolean;
  reason?: string;
  missing?: string;
}

function secretSlots(state: MemoryConfig): SecretSlot[] {
  const slots: SecretSlot[] = [
    { name: "memory.filter.apiKey", get: () => state.filter.apiKey, set: (value) => { state.filter.apiKey = value; } },
  ];
  for (const entry of MEMORY_PROVIDERS) {
    const section = state.providers[entry.id] ?? (state.providers[entry.id] = {});
    for (const field of entry.fields) {
      if (field.kind !== "secret") continue;
      slots.push({ name: `memory.providers.${entry.id}.${field.key}`, get: () => section[field.key], set: (value) => { section[field.key] = value; } });
    }
  }
  return slots;
}

export class MemoryConfigStore {
  private state: MemoryConfig;
  private readonly vault: () => Vault | null;

  constructor(readonly path: string, vault?: Vault | (() => Vault | null)) {
    this.vault = typeof vault === "function" ? vault : () => vault ?? null;
    this.state = load(path);
    this.adoptSecrets();
  }

  private adoptSecrets(): void {
    if (adoptSecrets(secretSlots(this.state), this.vault)) this.write();
  }

  get(): MemoryConfig {
    return this.state;
  }

  update(change: (state: MemoryConfig) => void): void {
    change(this.state);
    this.write();
  }

  private write(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileAtomic(this.path, JSON.stringify(this.serialized(), null, 2) + "\n");
    if (process.platform !== "win32") chmodSync(this.path, 0o600);
  }

  private serialized(): MemoryConfig {
    return withReferences(this.state, secretSlots, this.vault);
  }

  describe(): MemoryConfigView {
    const s = this.state;
    return {
      provider: s.provider,
      providers: MEMORY_PROVIDERS.map((entry) => {
        const section = s.providers[entry.id] ?? {};
        return {
          id: entry.id,
          label: entry.label,
          blurb: entry.blurb,
          costUnit: entry.costUnit,
          capabilities: entry.capabilities,
          consent: consentCurrent(s, entry.id),
          consentLapsed: !!s.consent[entry.id] && !consentCurrent(s, entry.id),
          consentText: consentWords(entry, s.filter),
          fields: entry.fields.map((field) => ({
            key: field.key, label: field.label, kind: field.kind,
            ...(field.hint ? { hint: field.hint } : {}),
            ...(field.placeholder ? { placeholder: field.placeholder } : {}),
            ...(field.min !== undefined ? { min: field.min } : {}),
            ...(field.max !== undefined ? { max: field.max } : {}),
            ...(field.step !== undefined ? { step: field.step } : {}),
            ...(field.kind === "secret"
              ? { set: !!String(section[field.key] ?? "") }
              : { value: (section[field.key] as string | number | undefined) ?? field.default ?? "" }),
          })),
        };
      }),
      filter: { mode: s.filter.mode, baseUrl: s.filter.baseUrl, model: s.filter.model, keySet: !!s.filter.apiKey, form: s.filter.form },
      blockChars: s.blockChars,
      ...readinessView(memoryReadiness(s)),
    };
  }
}

export function legacyRecallAcrossRooms(path: string): boolean {
  try {
    return existsSync(path) && (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>).recallAcrossRooms === true;
  } catch { return false; }
}

function load(path: string): MemoryConfig {
  const state = empty();
  if (!existsSync(path)) return state;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (typeof raw.provider === "string" && (raw.provider === "off" || providerEntry(raw.provider))) state.provider = raw.provider;
    if (raw.providers && typeof raw.providers === "object") {
      for (const [id, section] of Object.entries(raw.providers as Record<string, unknown>)) {
        if (providerEntry(id) && section && typeof section === "object") state.providers[id] = { ...state.providers[id], ...(section as Record<string, unknown>) };
      }
    }
    if (raw.consent && typeof raw.consent === "object") {
      for (const [id, stamp] of Object.entries(raw.consent as Record<string, unknown>)) {
        if (!providerEntry(id)) continue;
        if (Number.isFinite(stamp)) state.consent[id] = { at: Number(stamp), words: "" };
        else if (stamp && typeof stamp === "object" && Number.isFinite((stamp as { at?: unknown }).at) && typeof (stamp as { words?: unknown }).words === "string") {
          state.consent[id] = { at: Number((stamp as { at: number }).at), words: (stamp as { words: string }).words };
        }
      }
    }
    if (raw.zep && typeof raw.zep === "object") state.providers.zep = { ...state.providers.zep, ...(raw.zep as Record<string, unknown>) };
    if (!raw.consent && Number.isFinite(raw.consentAt)) state.consent.zep = { at: Number(raw.consentAt), words: "" };
    const filter = raw.filter as Record<string, unknown> | undefined;
    if (filter && typeof filter === "object") {
      if (filter.mode === "off" || filter.mode === "heuristic" || filter.mode === "llm") state.filter.mode = filter.mode;
      if (typeof filter.baseUrl === "string" && filter.baseUrl) state.filter.baseUrl = filter.baseUrl;
      if (typeof filter.apiKey === "string") state.filter.apiKey = filter.apiKey;
      if (typeof filter.model === "string") state.filter.model = filter.model;
      if (typeof filter.form === "string" && isQuestionForm(filter.form)) state.filter.form = filter.form;
    }
    if (typeof raw.blockChars === "number" && Number.isFinite(raw.blockChars)) state.blockChars = boundedBlockChars(raw.blockChars);
  } catch { }
  return state;
}
