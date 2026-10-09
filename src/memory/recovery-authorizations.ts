// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID } from "node:crypto";
import type { SqliteConnection } from "../sqlite-capabilities.js";
import type { MemoryOutbox } from "./outbox.js";
import type { RecoveryJob } from "./recovery-jobs.js";
import type { RecoveryVerificationReport } from "./recovery-verification.js";
import type { RecoverySwitchPreview, RecoveryActivationPreview, RecoveryCompletionPreview } from "./recovery-switch.js";
import { recoveryFingerprint } from "./recovery-sources.js";

interface Receipt {
  id: string; kind: "build" | "review" | "prepare_switch" | "publish_switch" | "complete_repair"; jobId: string; quoteFingerprint: string;
  scopeFingerprint: string; contentFingerprint: string; decisionsFingerprint: string | null; at: number;
}
export class MemoryRecoveryAuthorizations {
  constructor(private readonly db: SqliteConnection, private readonly outbox: MemoryOutbox) {
    db.exec("create table if not exists memory_recovery_human(id text primary key, receipt text not null)");
  }
  private save(kind: Receipt["kind"], job: RecoveryJob, contentFingerprint: string, decisionsFingerprint: string | null, at: number): Receipt {
    if (!Number.isSafeInteger(at) || at < 0 || job.state === "cancelled") throw new Error("Recovery approval is unavailable.");
    const receipt: Receipt = { id: randomUUID(), kind, jobId: job.id, quoteFingerprint: job.quoteFingerprint,
      scopeFingerprint: recoveryFingerprint(job.quote.scope), contentFingerprint, decisionsFingerprint, at };
    this.db.prepare("insert into memory_recovery_human values(?,?)").run(receipt.id, JSON.stringify(receipt)); return receipt;
  }
  private matches(id: string, kind: Receipt["kind"], jobId: string, contentFingerprint: string, decisionsFingerprint: string | null): boolean {
    const row = this.db.prepare("select receipt from memory_recovery_human where id=?").get(id), job = this.outbox.recovery.get(jobId);
    if (!row || !job || job.state === "cancelled") return false;
    const r = JSON.parse(String(row.receipt)) as Receipt;
    return r.id === id && r.kind === kind && r.jobId === job.id && r.quoteFingerprint === job.quoteFingerprint
      && r.scopeFingerprint === recoveryFingerprint(job.quote.scope) && r.contentFingerprint === contentFingerprint && r.decisionsFingerprint === decisionsFingerprint;
  }
  approveBuild(job: RecoveryJob, at: number, current: () => boolean): RecoveryJob {
    this.db.exec("savepoint memory_human_build");
    try {
      if (!current()) throw new Error("The recovery quotation changed.");
      const live = this.outbox.recovery.get(job.id)!;
      if (recoveryFingerprint(live) !== recoveryFingerprint(job)) throw new Error("The recovery job changed.");
      if (live.approval) {
        if (!this.buildAuthorized(live)) throw new Error("This job has no matching human approval. Prepare a new quotation.");
        this.db.exec("release memory_human_build"); return live;
      }
      const r = this.save("build", live, live.quoteFingerprint, null, at);
      const approved = this.outbox.recovery.approve(live.id, live.quoteFingerprint, r.id, at);
      if (!current()) throw new Error("The recovery quotation changed.");
      this.db.exec("release memory_human_build"); return approved;
    } catch (e) { this.db.exec("rollback to memory_human_build; release memory_human_build"); throw e; }
  }
  buildAuthorized(job: RecoveryJob): boolean {
    return !!job.approval && this.matches(job.approval.id, "build", job.id, job.quoteFingerprint, null);
  }
  authorizeReview(job: RecoveryJob, fingerprint: string, decisionsFingerprint: string, at: number): string {
    return this.save("review", job, fingerprint, decisionsFingerprint, at).id;
  }
  reviewAuthorized(report: RecoveryVerificationReport, id: string, decisionsFingerprint: string): boolean {
    return this.matches(id, "review", report.jobId, report.fingerprint, decisionsFingerprint);
  }
  authorizePreparation(preview: RecoverySwitchPreview, at: number): string {
    const job = this.outbox.recovery.get(preview.jobId);
    if (!job || job.quoteFingerprint !== preview.quoteFingerprint) throw new Error("The recovery job changed.");
    return this.save("prepare_switch", job, preview.fingerprint, null, at).id;
  }
  preparationAuthorized(preview: RecoverySwitchPreview, id: string): boolean {
    return this.matches(id, "prepare_switch", preview.jobId, preview.fingerprint, null);
  }
  authorizePublication(card: RecoveryActivationPreview, at: number): string {
    const job = this.outbox.recovery.get(card.preview.jobId);
    if (!job || job.quoteFingerprint !== card.preview.quoteFingerprint) throw new Error("The recovery job changed.");
    return this.save("publish_switch", job, card.fingerprint, null, at).id;
  }
  publicationAuthorized(card: RecoveryActivationPreview, id: string): boolean {
    return this.matches(id, "publish_switch", card.preview.jobId, card.fingerprint, null);
  }
  authorizeCompletion(card: RecoveryCompletionPreview, at: number): string {
    const job = this.outbox.recovery.get(card.jobId);
    if (!job || job.quoteFingerprint !== card.quoteFingerprint) throw new Error("The recovery job changed.");
    return this.save("complete_repair", job, card.fingerprint, null, at).id;
  }
  completionAuthorized(card: RecoveryCompletionPreview, id: string): boolean {
    return this.matches(id, "complete_repair", card.jobId, card.fingerprint, null);
  }
  revoke(id: string): void { this.db.prepare("delete from memory_recovery_human where id=?").run(id); }
}
