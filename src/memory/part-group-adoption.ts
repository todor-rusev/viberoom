// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { PartGroup } from "./part-group.js";
import type { SourceBodyProof, SourceBodyScope } from "./source-body-proof.js";

export interface PartGroupAdoptionRequest {
  group: PartGroup;
  scope: SourceBodyScope;
  proof: SourceBodyProof;
  maxOriginalBytes: number;
  maxPrefixBytes: number;
}
export type PartGroupAdoptionResult = { kind: "adopted"; group: PartGroup; duplicate: boolean }
  | { kind: "hold"; reason: string };
