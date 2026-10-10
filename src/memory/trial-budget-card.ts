// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";

export const TRIAL_OFFER_MS = 10 * 60_000;
export const TRIAL_RUN_MS = 45 * 60_000;
type Json = null | boolean | number | string | Json[] | { [name: string]: Json };
export type BudgetData = { [name: string]: Json };
export interface TrialApproval { id: string; cardSha256: string; expiresAt: string }
export interface TrialBudgetSubject {
  snapshot(): BudgetData;
  current(): boolean;
  ready(): boolean;
  start(approval: TrialApproval, verify: (receipt: unknown, policy: unknown) => boolean):
    { claimId: string; completion: Promise<unknown> };
  revoke(): void;
}
export interface TrialBudgetView {
  schema: "viberoom-human-whole-trial-offer-v1";
  cardSha256: string; viewSha256: string; offeredAt: number; offerExpiresAt: number;
  runMs: number; whole: BudgetData; launchEnabled: true;
}
export interface TrialBudgetDecision { cardSha256: string; viewSha256: string; decision: "approve" | "reject" }

function plain(value: unknown, depth = 0): Json {
  if (depth > 48 || types.isProxy(value)) throw new Error("trial_budget_data_refused");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || !(Array.isArray(value) ? Object.getPrototypeOf(value) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(value))))
    throw new Error("trial_budget_data_refused");
  const array = Array.isArray(value), names = Reflect.ownKeys(value);
  if (array && names.join(",") !== [...Array.from({ length: value.length }, (_, i) => String(i)), "length"].join(","))
    throw new Error("trial_budget_data_refused");
  const out: Json[] | BudgetData = array ? [] : {};
  for (const name of names) {
    if (array && name === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (typeof name !== "string" || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value"))
      throw new Error("trial_budget_data_refused");
    Object.defineProperty(out, name, { value: plain(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return out;
}
function stable(value: unknown): string {
  const sort = (v: Json): Json => Array.isArray(v) ? v.map(sort) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(plain(value)));
}
export const budgetDigest = (value: unknown): string => createHash("sha256").update(stable(value)).digest("hex");
function freeze<T>(value: T): T {
  const cloned = plain(value);
  const visit = (v: Json): void => { if (v && typeof v === "object") { Object.values(v).forEach(visit); Object.freeze(v); } };
  visit(cloned); return cloned as T;
}
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const TRIAL_REQUEST_KINDS = ["episode", "graph", "model", "ontology", "read"];
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export const TRIAL_DISCLOSURES = Object.freeze(["whole-private-trial-budget-disclosure-v2", "answers-only-budget-disclosure-v1"] as const);
type TrialDisclosure = (typeof TRIAL_DISCLOSURES)[number];
function wholeShape(whole: BudgetData): boolean {
  const policy = whole.policy as BudgetData, limits = policy?.limits as BudgetData, kinds = policy?.kinds as BudgetData;
  const disclosure = whole.disclosure as BudgetData;
  if (!digest(whole.cardSha256) || budgetDigest({ root: whole.root, policy }) !== whole.cardSha256 || !whole.root || !disclosure ||
    limits?.runMs !== TRIAL_RUN_MS || !count(limits.localEstimatedCredits) || !kinds || !Object.values(kinds).every(count)) return false;
  const schema = disclosure.schema as string;
  if (!(TRIAL_DISCLOSURES as readonly string[]).includes(schema)) return false;
  const known = schema as TrialDisclosure;
  switch (known) {
    case "whole-private-trial-budget-disclosure-v2":
      return digest(whole.scopeSha256) && digest(whole.bindingSha256) && limits.localEstimatedCredits !== 0 &&
        Object.keys(kinds).sort().join(",") === TRIAL_REQUEST_KINDS.join(",");
    case "answers-only-budget-disclosure-v1": {
      const zep = disclosure.zep as BudgetData, requests = disclosure.requests as BudgetData;
      return Object.keys(whole).sort().join(",") === "cardSha256,disclosure,policy,root" && limits.localEstimatedCredits === 0 &&
        Object.keys(kinds).join(",") === "model" && requests?.model === kinds.model && zep?.requests === 0 && zep?.credits === 0 &&
        count(disclosure.maxOutputTokensPerRequest) && disclosure.maxOutputTokens === (disclosure.maxOutputTokensPerRequest as number) * (kinds.model as number);
    }
    default: { const unchecked: never = known; void unchecked; return false; }
  }
}
export function trialBudgetDecision(value: unknown): TrialBudgetDecision {
  const data = plain(value) as BudgetData;
  if (!data || Array.isArray(data) || Object.keys(data).sort().join(",") !== "cardSha256,decision,viewSha256" ||
    !digest(data.cardSha256) || !digest(data.viewSha256) || typeof data.decision !== "string" || (data.decision !== "approve" && data.decision !== "reject"))
    throw new Error("trial_budget_decision_refused");
  return data as unknown as TrialBudgetDecision;
}

export class TrialBudgetCard {
  readonly view: TrialBudgetView;
  #phase: "open" | "deciding" | "claimed" | "finished" | "closed" = "open";
  #receipt: TrialApproval | null = null;
  #whole: BudgetData;
  #reason: string | null = null;
  constructor(private readonly subject: TrialBudgetSubject, private readonly now = Date.now) {
    if (subject.ready() !== true || subject.current() !== true) throw new Error("trial_budget_not_ready");
    const whole = freeze(subject.snapshot());
    if (!wholeShape(whole)) throw new Error("trial_budget_whole_profile_refused");
    const offeredAt = now();
    if (!Number.isSafeInteger(offeredAt) || offeredAt < 0) throw new Error("trial_budget_clock_refused");
    this.#whole = whole;
    const envelope = { schema: "viberoom-human-whole-trial-offer-v1" as const, cardSha256: String(whole.cardSha256),
      offeredAt, offerExpiresAt: offeredAt + TRIAL_OFFER_MS, runMs: TRIAL_RUN_MS, whole, launchEnabled: true as const };
    this.view = freeze({ ...envelope, viewSha256: budgetDigest(envelope) });
    if (!this.current()) throw new Error("trial_budget_not_current");
  }
  current(): boolean {
    try { return this.#phase === "open" && this.now() >= this.view.offeredAt && this.now() < this.view.offerExpiresAt && this.subject.ready() === true &&
      this.subject.current() === true && stable(this.subject.snapshot()) === stable(this.#whole) && this.#phase === "open" &&
      this.now() >= this.view.offeredAt && this.now() < this.view.offerExpiresAt; }
    catch { return false; }
  }
  close(reason = "not_now"): void {
    this.#phase = "closed"; this.#reason = reason; this.subject.revoke();
  }
  outcome() { return { phase: this.#phase, reason: this.#reason }; }
  decide(input: unknown): { state: "rejected" | "claimed"; claimId?: string } {
    const request = trialBudgetDecision(input);
    if (this.#phase !== "open") throw new Error("trial_budget_already_decided");
    if (request.cardSha256 !== this.view.cardSha256 || request.viewSha256 !== this.view.viewSha256 || !this.current())
      throw new Error("trial_budget_card_changed_or_expired");
    if (request.decision === "reject") { this.close(); return { state: "rejected" }; }
    this.#phase = "deciding";
    const approvedAt = this.now();
    if (!Number.isSafeInteger(approvedAt) || approvedAt < this.view.offeredAt || approvedAt >= this.view.offerExpiresAt) {
      this.close("offer_expired"); throw new Error("trial_budget_card_changed_or_expired");
    }
    const receipt = freeze({ id: randomUUID(), cardSha256: this.view.cardSha256,
      expiresAt: new Date(approvedAt + TRIAL_RUN_MS).toISOString() });
    this.#receipt = receipt;
    const verify = (offered: unknown, policy: unknown): boolean => {
      try { return this.#phase === "deciding" && this.#receipt === receipt && this.now() < Date.parse(receipt.expiresAt) &&
        stable(offered) === stable(receipt) && stable(policy) === stable(this.#whole.policy) &&
        this.subject.ready() === true && this.subject.current() === true && stable(this.subject.snapshot()) === stable(this.#whole) &&
        this.#phase === "deciding" && this.now() >= approvedAt && this.now() < Date.parse(receipt.expiresAt); }
      catch { return false; }
    };
    try {
      const started = this.subject.start(receipt, verify);
      if (!started || typeof started.claimId !== "string" || !started.claimId || !(started.completion instanceof Promise))
        throw new Error("trial_budget_synchronous_claim_required");
      this.#phase = "claimed";
      void started.completion.then(() => { if (this.#phase === "claimed") this.#phase = "finished"; },
        () => { this.#reason = "claimed_operation_held"; if (this.#phase === "claimed") this.#phase = "finished"; });
      return { state: "claimed", claimId: started.claimId };
    } catch {
      this.close("claim_refused_no_retry"); throw new Error("trial_budget_claim_refused");
    }
  }
}
