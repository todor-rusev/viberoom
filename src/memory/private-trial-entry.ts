// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { Hub } from "../hub.js";
import type { ResidentDeployment, ResidentPreparation } from "./private-trial-types.js";
import { readPrivateTrialDeployment, type TrialPurpose } from "./private-trial-deployment.js";
export type PrivateTrialDeployment = ResidentDeployment;
export type PrivateTrialEntry = ResidentPreparation;
export function initializePrivateTrialEntry(hub: Hub, deployment?: PrivateTrialDeployment): Promise<PrivateTrialEntry | null> | null {
  if (deployment === undefined) return null;
  return createPrivateTrialEntry(hub, deployment).catch(() => null);
}
export function trialPurposeRoute(purpose: TrialPurpose): "whole-trial" | "answers-only" {
  switch (purpose) {
    case "approved-paid-trial": case "local-fixture": return "whole-trial";
    case "approved-paid-answers-only": return "answers-only";
    default: { const unrouted: never = purpose; throw new Error(`private_trial_purpose_unrouted: ${String(unrouted)}`); }
  }
}
export async function createPrivateTrialEntry(hub: Hub, deployment: PrivateTrialDeployment): Promise<PrivateTrialEntry> {
  const checked = readPrivateTrialDeployment(hub, deployment);
  const route = trialPurposeRoute(checked.review.purpose);
  switch (route) {
    case "whole-trial": {
      const { createResidentPreparation } = await import("../../private-trial/resident.mjs");
      return createResidentPreparation(hub, checked.deployment);
    }
    case "answers-only": {
      const { createAnswersOnlyPreparation } = await import("../../private-trial/answers-only-resident.mjs");
      return createAnswersOnlyPreparation(hub, checked.deployment);
    }
    default: { const unrouted: never = route; throw new Error(`private_trial_route_unknown: ${String(unrouted)}`); }
  }
}
