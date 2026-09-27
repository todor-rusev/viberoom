// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import type { MemoryCapabilities, MemoryProvider } from "./provider.js";

export interface ProviderField {
  key: string;
  label: string;
  kind: "secret" | "text" | "number";
  hint?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  default?: string | number;
}

export const MIN_RELEVANCE = 0.01;

export interface ProviderEntry {
  id: string;
  label: string;
  blurb: string;
  consentText: string;
  capabilities: MemoryCapabilities;
  costUnit: string;
  editWindowMs: number;
  fields: ProviderField[];
  load(settings: Record<string, unknown>): Promise<MemoryProvider>;
}

export const MEMORY_PROVIDERS: ProviderEntry[] = [
  {
    id: "zep",
    label: "Zep Cloud",
    blurb: "Hosted temporal knowledge graph: facts with the span they held true.",
    consentText: "What passes is sent to Zep Software, Inc. (US, SOC 2 Type II) and processed there by LLMs to extract facts. Deleting a message or a room deletes what it taught the graph.",
    capabilities: { graph: true, profile: false, forgetEpisode: true, factValidity: true, addFact: true, relevance: true },
    costUnit: "credits",
    editWindowMs: 0,
    fields: [
      { key: "apiKey", kind: "secret", label: "Zep API key", hint: "Per project, from the Zep dashboard. Kept encrypted in this computer's vault, never shown again.", placeholder: "paste the project API key" },
      { key: "monthlyCreditCap", kind: "number", label: "Monthly ceiling, credits", min: 0, max: 100_000_000, default: 9000, hint: "One credit per started 350 bytes sent (Cyrillic is two bytes a letter). Reached, memory pauses honestly; 0 means no ceiling. Zep's free plan gives 10 000 a month." },
      { key: "relevanceFloor", kind: "number", label: "Relevance threshold", min: 0, max: 1, step: 0.01, default: MIN_RELEVANCE, hint: "Zep scores each fact it finds from 0 to 1 against the search, and a turn's block leaves out the facts under this. 0.01 drops a third of the unrelated facts and keeps the useful ones; higher starts to drop useful ones too." },
    ],
    load: async (settings) => {
      const { ZepProvider } = await import("./zep.js");
      return new ZepProvider({ apiKey: String(settings.apiKey ?? ""), ...(typeof settings.baseUrl === "string" && settings.baseUrl ? { baseUrl: settings.baseUrl } : {}) });
    },
  },
  {
    id: "honcho",
    label: "Honcho Cloud",
    blurb: "Hosted memory of who each participant is: conclusions, cards, session summaries.",
    consentText: "What passes is sent to Plastic Labs, Inc. (Honcho, US) and processed there by LLMs to derive conclusions about the participants. Honcho cannot delete what one message taught it; deleting a room deletes its session, but derived conclusions may outlive it.",
    capabilities: { graph: false, profile: true, forgetEpisode: false, factValidity: false, addFact: false, relevance: false },
    costUnit: "tokens",
    editWindowMs: 10 * 60_000,
    fields: [
      { key: "apiKey", kind: "secret", label: "Honcho API key", hint: "From app.honcho.dev (hch-…). Kept encrypted in this computer's vault, never shown again.", placeholder: "paste the API key" },
      { key: "workspaceId", kind: "text", label: "Workspace", default: "viberoom", hint: "Honcho's top isolation level; one workspace per viberoom installation. Reusing the workspace of another tool (Claude Code, Hermes) merges the memories." },
      { key: "monthlyCreditCap", kind: "number", label: "Monthly ceiling, tokens", min: 0, max: 1_000_000_000, default: 2_000_000, hint: "Honcho bills $2 per million ingested tokens. Reached, memory pauses honestly; 0 means no ceiling. The default is about $4 a month." },
    ],
    load: async (settings) => {
      const { HonchoProvider } = await import("./honcho.js");
      return new HonchoProvider({
        apiKey: String(settings.apiKey ?? ""),
        workspaceId: String(settings.workspaceId ?? "") || "viberoom",
        ...(typeof settings.baseUrl === "string" && settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
      });
    },
  },
];

export function providerEntry(id: string): ProviderEntry | null {
  return MEMORY_PROVIDERS.find((entry) => entry.id === id) ?? null;
}

function decimalsOf(step: number): number {
  const text = String(step);
  if (text.includes("e")) return Math.ceil(-Math.log10(step));
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

export function coerceProviderSettings(entry: ProviderEntry, current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...current };
  for (const [key, raw] of Object.entries(patch)) {
    if (key === "baseUrl") {
      if (raw !== undefined && typeof raw !== "string") throw new Error("baseUrl must be text");
      if (typeof raw === "string" && raw.trim()) next.baseUrl = raw.trim();
      continue;
    }
    const field = entry.fields.find((f) => f.key === key);
    if (!field) throw new Error(`${entry.label} has no setting "${key}"`);
    if (field.kind === "secret") {
      if (typeof raw !== "string") throw new Error(`${field.label} must be text`);
      if (raw.trim()) next[key] = raw.trim();
    } else if (field.kind === "text") {
      if (typeof raw !== "string") throw new Error(`${field.label} must be text`);
      next[key] = raw.trim();
    } else {
      const fractional = field.step !== undefined && !Number.isInteger(field.step);
      const typed = Number(raw);
      const value = fractional ? Number(typed.toFixed(decimalsOf(field.step!))) : typed;
      if (!(fractional ? Number.isFinite(value) : Number.isSafeInteger(value)) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
        throw new Error(`${field.label} must be a ${fractional ? "number" : "whole number"}${field.min !== undefined ? ` from ${field.min}` : ""}${field.max !== undefined ? ` to ${field.max}` : ""}`);
      }
      next[key] = value;
    }
  }
  return next;
}

export function defaultProviderSettings(entry: ProviderEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of entry.fields) out[field.key] = field.default ?? (field.kind === "number" ? 0 : "");
  return out;
}
