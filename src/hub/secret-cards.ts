// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { ConnectionView } from "../connections/service.js";
import type { LocalLaunch } from "../connections/local-launch.js";
import type { KeyedSystemId } from "../connections/catalog.js";
import type { TrialBudgetView } from "../memory/trial-budget-card.js";

export const SECRET_CARD_MS = 10 * 60_000;

export interface SecretRequest {
  id: string;
  purpose: "telegram-token" | "telegram-pair" | "memory-zep-key" | "memory-sieve-key" | "voice-key" | "consent" | "connection" | "trial-budget";
  trialBudget?: TrialBudgetView;
  consent?: { feature: ConsentFeature; words: string; recipient: string; reader?: "system" | "provider"; changed?: boolean };
  connection?: {
    id: string; name: string; blurb: string; mark?: ConnectionView["mark"]; signingIn?: boolean;
    url?: string;
    command?: string;
    launch?: LocalLaunch;
    keys?: string[];
    keysIn?: "env" | "headers";
    keysSaved?: string[];
    add?: boolean;
  };
  prefill?: { baseUrl?: string; model?: string; provider?: string; language?: string };
  askedBy: { kind: "window" } | { kind: "vibemate"; roomId: string; participantId: string; name: string };
  askedAt: number;
  expiresAt: number;
  state: "open" | "done" | "closed" | "expired";
  outcome?: string;
  refusal?: string;
  link?: { url: string; expiresAt: number; svg: string };
}

export const KEYED_PURPOSE: Record<KeyedSystemId, SecretRequest["purpose"]> = { telegram: "telegram-token", zep: "memory-zep-key", sieve: "memory-sieve-key", voice: "voice-key" };

export const CONSENT_FEATURES = ["memory", "voice", "reading"] as const;
export type ConsentFeature = (typeof CONSENT_FEATURES)[number];
export const CONSENT_FEATURE_WORDS: Record<ConsentFeature, string> = { memory: "the long-term memory", voice: "the voice (recordings made into words)", reading: "reading the replies aloud" };
export const READ_HERE_WORDS = "The replies are read aloud by this computer's own voices, in the window: nothing leaves this computer.";

export function secretLabel(request: Pick<SecretRequest, "purpose" | "connection" | "consent">): string {
  const { purpose } = request;
  if (purpose === "connection" && request.connection?.add) return `${request.connection.name} (${request.connection.url ?? request.connection.command}) to be added as a connection`;
  if (purpose === "connection") return `a sign-in to ${request.connection?.name ?? "a system"}`;
  if (purpose === "consent") return `their consent to ${CONSENT_FEATURE_WORDS[request.consent?.feature ?? "voice"]}`;
  if (purpose === "voice-key") return "the voice provider's key";
  return purpose === "memory-zep-key" ? "the Zep API key" : purpose === "memory-sieve-key" ? "the sieve key" : "the Telegram bot key";
}
