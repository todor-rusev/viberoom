// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { GenerationRoute } from "./graph-generations.js";
import type { GenerationSwitch } from "./graph-generations.js";
import { recoveryFingerprint } from "./recovery-sources.js";
import type { RecoveryScope } from "./recovery-sources.js";
export interface RecoverySwitchPreview {
  jobId: string; quoteFingerprint: string; scope: RecoveryScope; previous: GenerationRoute; wanted: GenerationRoute;
  sourceFingerprint: string; reportFingerprint: string; reviewFingerprint: string; fingerprint: string;
}
export interface RecoveryActivationPreview {
  preview: RecoverySwitchPreview; switchId: string; roomName: string; createdAt: number; preparationFingerprint: string; fingerprint: string;
}
export interface RecoveryCompletionPreview {
  jobId: string; quoteFingerprint: string; switchId: string; scope: RecoveryScope & { graphId: string };
  roomName: string; createdAt: number; reportFingerprint: string; sourceFingerprint: string;
  knowledgeFingerprint: string; reviewFingerprint: string; repairFingerprint: string; repairRevision: number;
  originals: number; facts: number; nodes: number; fingerprint: string;
}
export function preparationFingerprint(sw: GenerationSwitch): string {
  const { id, previous, wanted, sourceFingerprint, approvalId, createdAt } = sw;
  return recoveryFingerprint({ id, previous, wanted, sourceFingerprint, approvalId, createdAt });
}
