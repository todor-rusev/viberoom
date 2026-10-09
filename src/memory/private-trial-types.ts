// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
export type TrialJson = null | boolean | number | string | TrialJson[] | { [name: string]: TrialJson };
export type TrialData = { [name: string]: TrialJson };
export interface ResidentDeployment { reviewSha256: string }
export interface ResidentSelection {
  answerKeyOwner: "memory.filter.apiKey";
  answerEndpoint: string;
  answerModel: string;
}
export interface TrialApproval { id: string; cardSha256: string; expiresAt: string }
export interface TrialBudgetSubject {
  snapshot(): TrialData;
  current(): boolean;
  ready(): boolean;
  start(approval: TrialApproval, verifyApproval: (receipt: unknown, policy: unknown) => boolean):
    { claimId: string; completion: Promise<unknown> };
  revoke(): void;
}
export interface ResidentPreparation {
  status(selection: ResidentSelection): TrialData;
  prepare(selection: ResidentSelection): TrialData;
  card(): TrialData;
  budgetSubject(): TrialBudgetSubject;
}
