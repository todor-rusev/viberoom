// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { Hub } from "../hub.js";
import type { ResidentDeployment, ResidentPreparation } from "./private-trial-types.js";
import { readPrivateTrialDeployment } from "./private-trial-deployment.js";
export type PrivateTrialDeployment = ResidentDeployment;
export type PrivateTrialEntry = ResidentPreparation;
export function initializePrivateTrialEntry(hub: Hub, deployment?: PrivateTrialDeployment): Promise<PrivateTrialEntry | null> | null {
  if (deployment === undefined) return null;
  return createPrivateTrialEntry(hub, deployment).catch(() => null);
}
export async function createPrivateTrialEntry(hub: Hub, deployment: PrivateTrialDeployment): Promise<PrivateTrialEntry> {
  const checked = readPrivateTrialDeployment(hub, deployment);
  const { createResidentPreparation } = await import("../../private-trial/resident.mjs");
  return createResidentPreparation(hub, checked.deployment);
}
