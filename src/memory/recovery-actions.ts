// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { MemoryOutbox } from "./outbox.js";
import type { MemoryPipeline } from "./service.js";
import type { RecoveryReviewDecision } from "./recovery-verification.js";
import { recoveryFingerprint } from "./recovery-sources.js";

type Action = "prepare" | "quote" | "approve-build" | "run-build" | "review" | "accept-review" | "switch-preview" | "prepare-switch" | "activation-preview" | "activate-switch" | "check-switch" | "repair-review" | "accept-repair-review" | "repair-preview" | "complete-repair" | "cancel";
interface Request { action: Action; jobId?: string; switchId?: string; fingerprint?: string; maxCredits?: number; decisions?: RecoveryReviewDecision[]; confirm?: boolean }
const fields: Record<Action, string[]> = {
  prepare: ["maxCredits"], quote: ["jobId"], "approve-build": ["jobId", "fingerprint", "confirm"], "run-build": ["jobId"],
  review: ["jobId"], "accept-review": ["jobId", "fingerprint", "decisions", "confirm"], "switch-preview": ["jobId"],
  "prepare-switch": ["jobId", "fingerprint", "confirm"], cancel: ["jobId", "confirm"],
  "activation-preview": ["jobId", "switchId"], "activate-switch": ["jobId", "switchId", "fingerprint", "confirm"], "check-switch": ["jobId", "switchId"],
  "repair-review": ["jobId", "switchId"], "accept-repair-review": ["jobId", "switchId", "fingerprint", "decisions", "confirm"],
  "repair-preview": ["jobId", "switchId"], "complete-repair": ["jobId", "switchId", "fingerprint", "confirm"],
};
export function recoveryRequest(value: unknown): Request {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid recovery request.");
  const body = value as Record<string, unknown>, action = body.action;
  if (typeof action !== "string" || !Object.hasOwn(fields, action)) throw new Error("Choose a recovery action.");
  const allowed = fields[action as Action];
  if (Object.keys(body).some(key => key !== "action" && !allowed.includes(key))) throw new Error("Unexpected recovery field.");
  if (allowed.includes("jobId") && (typeof body.jobId !== "string" || !/^[0-9a-f-]{36}$/.test(body.jobId))) throw new Error("Choose a recovery job.");
  if (allowed.includes("switchId") && (typeof body.switchId !== "string" || !/^[0-9a-f-]{36}$/.test(body.switchId))) throw new Error("Choose a prepared switch.");
  if (allowed.includes("fingerprint") && (typeof body.fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/.test(body.fingerprint))) throw new Error("Choose the exact displayed recovery card.");
  if (allowed.includes("confirm") && body.confirm !== true) throw new Error("Confirm this recovery decision.");
  if (action === "prepare" && (!Number.isSafeInteger(body.maxCredits) || Number(body.maxCredits) < 1)) throw new Error("Choose a positive integer credit limit.");
  if (action === "accept-review" || action === "accept-repair-review") {
    if (!Array.isArray(body.decisions) || body.decisions.length > 30001 || Buffer.byteLength(JSON.stringify(body.decisions)) > 16 * 1024 * 1024
      || body.decisions.some(d => !d || typeof d !== "object" || Array.isArray(d) || Object.keys(d).sort().join() !== "explanation,id,sourceIds,verdict"
        || typeof d.id !== "string" || d.id.length > 200 || !["accepted", "rejected", "unresolved"].includes(d.verdict)
        || typeof d.explanation !== "string" || d.explanation.length > 4000 || !Array.isArray(d.sourceIds) || d.sourceIds.length > 10000
        || d.sourceIds.some((id: unknown) => typeof id !== "string" || id.length > 200))) throw new Error("Invalid recovery review decisions.");
  }
  return structuredClone(body) as unknown as Request;
}

export class MemoryRecoveryActions {
  constructor(private readonly pipeline: MemoryPipeline, private readonly outbox: MemoryOutbox,
    private readonly roomExists: (room: string) => boolean, private readonly now = Date.now) {}
  list(room: string, after = "") {
    this.room(room);
    if (after && !/^[0-9a-f-]{36}$/.test(after)) throw new Error("Invalid recovery page.");
    const page = this.outbox.recovery.list(room, after);
    return { kind: "jobs", jobs: page.jobs.map(job => {
      const { items, ...quote } = job.quote;
      const switches = this.pipeline.recoverySwitches(job.id);
      return { job: { ...job, quote: { ...quote, itemCount: items.length } }, spent: this.outbox.recovery.spent(job.id), switches,
        cancellable: !switches.truncated && switches.entries.every(sw => ["prepared", "blocked"].includes(sw.state)) };
    }), next: page.next };
  }
  private room(room: string) { if (!this.roomExists(room)) throw new Error("Recovery room is unavailable."); }
  async act(room: string, value: unknown, signal?: AbortSignal): Promise<unknown> {
    this.room(room);
    const request = recoveryRequest(value);
    if (request.action === "prepare") {
      const job = await this.pipeline.prepareRecoveryBuild(room, request.maxCredits!, signal);
      return this.pipeline.previewRecoveryBuild(job.id, signal);
    }
    const job = this.outbox.recovery.get(request.jobId!);
    if (!job || job.quote.scope.room !== room) throw new Error("This recovery job belongs to another room or is unavailable.");
    const human = this.outbox.recoveryHuman;
    switch (request.action) {
      case "quote": return this.pipeline.previewRecoveryBuild(job.id, signal);
      case "approve-build": {
        if (request.fingerprint !== job.quoteFingerprint) throw new Error("The recovery quotation changed.");
        const card = await this.pipeline.previewRecoveryBuild(job.id, signal);
        const approved = human.approveBuild(card.job, this.now(), () => !signal?.aborted && this.roomExists(room) && this.pipeline.recoverySourceCurrent(card.sources));
        return { ...card, job: approved };
      }
      case "run-build": return { kind: "job", job: await this.pipeline.runRecoveryBuild(job.id, signal), spent: this.outbox.recovery.spent(job.id) };
      case "review": {
        const report = await this.pipeline.previewRecoveryVerification(job.id, signal);
        return { kind: "review", report, receipt: this.outbox.recoveryVerification.matchingReview(report) };
      }
      case "repair-review": {
        const report = await this.pipeline.previewRecoveryCompletionReview(job.id, request.switchId!, signal);
        return { kind: "review", purpose: "repair", switchId: request.switchId, report, receipt: this.outbox.recoveryVerification.matchingReview(report) };
      }
      case "accept-repair-review":
      case "accept-review": {
        const decisions = request.decisions!, fingerprint = recoveryFingerprint([...decisions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const id = human.authorizeReview(job, request.fingerprint!, fingerprint, this.now());
        try { return { kind: "review-receipt", ...(request.action === "accept-repair-review" ? { purpose: "repair", switchId: request.switchId } : {}),
          receipt: request.action === "accept-repair-review"
            ? await this.pipeline.recordRecoveryCompletionReview(job.id, request.switchId!, request.fingerprint!, id, decisions, signal)
            : await this.pipeline.recordRecoveryReview(job.id, request.fingerprint!, id, decisions, signal) }; }
        catch (e) { human.revoke(id); throw e; }
      }
      case "switch-preview": return { kind: "switch", preview: await this.pipeline.previewRecoverySwitch(job.id, signal) };
      case "prepare-switch": {
        const preview = await this.pipeline.previewRecoverySwitch(job.id, signal);
        if (preview.fingerprint !== request.fingerprint) throw new Error("The switch preparation card changed.");
        const id = human.authorizePreparation(preview, this.now());
        try { return { kind: "switch-prepared", jobId: job.id, preparation: await this.pipeline.prepareRecoverySwitch(job.id, preview.fingerprint, id, signal) }; }
        catch (e) { human.revoke(id); throw e; }
      }
      case "activation-preview": return { kind: "activation", card: await this.pipeline.previewRecoveryActivation(job.id, request.switchId!, signal) };
      case "activate-switch": {
        const card = await this.pipeline.previewRecoveryActivation(job.id, request.switchId!, signal);
        if (card.fingerprint !== request.fingerprint) throw new Error("The activation card changed.");
        const id = human.authorizePublication(card, this.now());
        try { return await this.pipeline.activateRecoverySwitch(job.id, card.switchId, card.fingerprint, id, signal); }
        catch (e) {
          const live = this.pipeline.recoverySwitches(job.id).entries.find(sw => sw.id === card.switchId);
          if (live && ["prepared", "blocked"].includes(live.state)) human.revoke(id);
          throw e;
        }
      }
      case "check-switch": return this.pipeline.checkRecoverySwitch(job.id, request.switchId!, signal);
      case "repair-preview": return { kind: "repair", card: await this.pipeline.previewRecoveryCompletion(job.id, request.switchId!, signal) };
      case "complete-repair": {
        const card = await this.pipeline.previewRecoveryCompletion(job.id, request.switchId!, signal);
        if (card.fingerprint !== request.fingerprint) throw new Error("The repair completion card changed.");
        const id = human.authorizeCompletion(card, this.now());
        try { return await this.pipeline.completeRecoveryRepair(job.id, card.switchId, card.fingerprint, id, signal); }
        catch (e) { human.revoke(id); throw e; }
      }
      case "cancel": {
        const switches = this.pipeline.recoverySwitches(job.id);
        if (switches.truncated || switches.entries.some(sw => !["prepared", "blocked"].includes(sw.state)))
          throw new Error("This rebuild has a dispatched switch. Check its result; cancellation cannot undo a cloud publication.");
        this.outbox.recovery.cancel(job.id, this.now());
        for (const sw of switches.entries) this.outbox.generations.blockPrepared(job.quote.scope, sw.id, "recovery_cancelled");
        return { kind: "job", job: this.outbox.recovery.get(job.id), spent: this.outbox.recovery.spent(job.id) };
      }
    }
  }
}
