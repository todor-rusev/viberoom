// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { AcpAgent } from "../acp-client.js";
import { readBackgroundMessage, type BackgroundMessage } from "../acp-extensions.js";
import { agentMessageHash, agentMessageId } from "../agent-message.js";
import type { DivertOp, HistoryStore } from "../history-store.js";
import type { NativeNoteDisposition } from "../native-note-state.js";
import { makeNativeEnvelope, nativeDivertOp, nativeInteger, nativeSubject, type NativeDecision, type NativeEnvelope, type NativeHoldReason,
  type NativeNoteEffect, type NativeObligation, type NativeRecord } from "../native-reports.js";
import type { ChatMessage, NativeObligationRef, Participant, RetryRequest } from "../room.js";
import type { AgentRuntime } from "./agent-runtime.js";
import type { Held } from "./vibemate-seen.js";

export interface NativeOwner {
  readonly participant: Participant;
  readonly runtime: AgentRuntime;
}

export type FaultOwner = string | { readonly id: string; readonly participant?: Participant; readonly runtime?: AgentRuntime;
  readonly sessionId?: string; readonly deliveryEpoch?: string };

export type NativeRouteObligation = Extract<NativeObligation, { kind: "route" }>;

export interface NativeHop {
  readonly spent: boolean;
  spend(): void;
}

export interface UnconfirmedPost {
  readonly participant: Participant;
  readonly runtime: AgentRuntime;
  readonly retry: RetryRequest | null;
  readonly reportHash: string | null;
  due: boolean;
}

interface Arrival {
  report: BackgroundMessage;
  agent: AcpAgent;
  acceptedName: string;
  at: number;
  owner: NativeEnvelope["owner"] | null;
}

export interface NativeReportPorts {
  identity(): { readonly roomId: string; readonly roomUuid: string; readonly folderId: NativeEnvelope["owner"]["folderId"] };
  current(id: string): Held;
  sessions(): readonly string[];
  state(): { readonly closing: boolean; readonly readOnly: boolean; readonly recordHold: boolean };
  liveSession(id: string, agent: AcpAgent, sessionId: string): boolean;
  journal: {
    pending(): boolean;
    drain(): void;
    ops(): { ops: DivertOp[]; blocked?: boolean };
    append(op: DivertOp, error: unknown): boolean;
  };
  decide(envelope: NativeEnvelope, owner: NativeOwner): { decision: NativeDecision; message: ChatMessage | null };
  publish(record: NativeRecord): "published" | "tombstoned" | "unknown";
  counted(owner: NativeOwner, decision: NativeDecision): boolean;
  notesApplied(owner: NativeOwner, effect: NativeNoteEffect): NativeNoteDisposition | false;
  header(owner: NativeOwner, lines: readonly string[], ref: NativeObligationRef): boolean;
  correction(owner: NativeOwner, obligation: Extract<NativeObligation, { kind: "correction" }>, ref: NativeObligationRef): boolean | "unknown";
  route(obligation: NativeRouteObligation, ref: NativeObligationRef, addressed: boolean, hop: NativeHop): "routed" | "superseded";
  commitNote(owner: NativeOwner, effect: NativeNoteEffect, writeRecord: () => void): NativeNoteDisposition | "owner_changed" | undefined;
  drained(owner: NativeOwner): void;
  fault(owner: { readonly id: string; readonly participant: Participant; readonly runtime: AgentRuntime | undefined }, reason: string, say: boolean): boolean;
  pending(): void;
  routePost(messageId: string): void;
  correctPost(post: UnconfirmedPost): boolean;
  log(level: "info" | "warn", text: string): void;
}

const NATIVE_ARRIVAL_LIMIT = 64;
const NATIVE_ARRIVAL_BYTES = 32 * 1024 * 1024;

export class NativeReports {
  private readonly handles = new Map<string, AcpAgent>();
  private readonly localEffects = new Set<string>();
  readonly unsaved = new Map<string, NativeEnvelope>();
  readonly arrivals = new Map<string, Arrival>();
  private readonly faultReasons = new Map<string, string>();
  recoveryHold = false;
  readonly unconfirmed = new Map<string, UnconfirmedPost>();
  private disposed = false;

  constructor(private readonly ports: NativeReportPorts, private readonly store: () => HistoryStore) {}

  private get history(): HistoryStore {
    return this.store();
  }

  dispose(): void {
    this.disposed = true;
  }

  laneBlocked(runtime: AgentRuntime): boolean {
    return !!runtime.native.nativeDraining || !!runtime.native.nativeHold || this.recoveryHold
      || [...this.arrivals.values()].some(arrival => arrival.agent === runtime.session.agent);
  }

  hasPending(): boolean {
    if (this.unsaved.size || this.arrivals.size || this.recoveryHold) return true;
    for (const pending of this.unconfirmed.values()) if (pending.due) return true;
    const { roomId } = this.ports.identity();
    try {
      if (this.ports.journal.pending() && this.history.nativeJournalSafety(roomId)) return true;
      return this.history.listNativeDelivery(roomId).length !== 0;
    }
    catch { this.recoveryHold = true; return true; }
  }

  retry(): boolean {
    if (this.disposed) return this.hasPending();
    const state = this.ports.state();
    if (state.closing || state.readOnly || state.recordHold) return this.hasPending();
    const { roomId, roomUuid } = this.ports.identity();
    if (this.ports.journal.pending()) this.ports.journal.drain();
    if (this.disposed) return this.hasPending();
    if (this.recoveryHold && !this.ports.journal.pending()) {
      try {
        this.history.nativeJournalSafety(roomId); this.history.nativeHighWater(roomUuid); this.history.listNativeDelivery(roomId);
        this.recoveryHold = false;
      } catch { return true; }
    }
    if (this.recoveryHold) return true;
    for (const [id, envelope] of this.unsaved) {
      try {
        const previous = this.history.nativeReceipt(roomId, roomUuid, id);
        if (!previous) this.history.enqueueNative(roomId, envelope);
        else if ((previous.type === "native" ? previous.record.envelope.reportHash : previous.receipt.hash) !== envelope.reportHash) {
          this.fault(envelope.owner.participantId, "native_conflict"); continue;
        }
        this.unsaved.delete(id);
      } catch { }
    }
    for (const [messageId, arrival] of this.arrivals) {
      if (this.disposed) return this.hasPending();
      if (!arrival.owner) break;
      this.accept(arrival.owner.participantId, arrival.agent, arrival.report);
      if (this.arrivals.has(messageId)) break;
    }
    for (const id of this.ports.sessions()) {
      if (this.disposed) return this.hasPending();
      const runtime = this.ports.current(id).runtime;
      if (runtime) this.drain(id, runtime);
    }
    this.confirmJournaledPosts();
    return this.hasPending();
  }

  fault(owner: FaultOwner, reason: string): void {
    if (this.disposed) return;
    this.ports.pending();
    if (this.disposed) return;
    if (typeof owner === "string") {
      this.ports.log("warn", `native report for ${owner}: ${reason}; its owner is not known any more, nothing is held`);
      return;
    }
    const { participant, runtime } = this.ports.current(owner.id);
    if (this.disposed) return;
    if (!participant || (owner.participant && participant !== owner.participant) || (owner.runtime && runtime !== owner.runtime)
      || (owner.sessionId !== undefined && runtime?.session.sessionId !== owner.sessionId)
      || (owner.deliveryEpoch !== undefined && participant.deliveryEpoch !== owner.deliveryEpoch)) {
      this.ports.log("info", `native report for ${owner.id}: ${reason}; the vibemate or session it was for is gone, nothing is held for the one in its place`);
      return;
    }
    const key = `${runtime?.session.sessionId ?? "missing"}:${participant.deliveryEpoch ?? "missing"}:${reason}`;
    const said = this.ports.fault({ id: owner.id, participant, runtime }, reason, this.faultReasons.get(owner.id) !== key);
    if (said && !this.disposed) this.faultReasons.set(owner.id, key);
  }

  private ownerHolds(owner: NativeOwner): boolean {
    if (this.disposed) return false;
    const now = this.ports.current(owner.participant.id);
    return !this.disposed && now.participant === owner.participant && now.runtime === owner.runtime;
  }

  rebind(id: string, runtime: AgentRuntime, loaded: boolean): void {
    if (!loaded) return;
    try {
      for (const record of this.history.listNativeDelivery(this.ports.identity().roomId, id)) {
        const e = record.envelope;
        if (!this.ownerReason(e, runtime)) this.handles.set(e.id, runtime.session.agent);
      }
    } catch { this.fault({ id, runtime }, "storage_read_unknown"); }
  }

  private ownerReason(envelope: NativeEnvelope, runtime: AgentRuntime): NativeHoldReason | null {
    const owner = envelope.owner, { roomId, roomUuid, folderId } = this.ports.identity();
    const { participant, runtime: now } = this.ports.current(owner.participantId);
    if (owner.roomId !== roomId || owner.roomUuid !== roomUuid || owner.folderId !== folderId) return "retired_owner";
    if (!participant || participant.kind !== "agent" || participant.status === "left" || now !== runtime || runtime.session.retiring) return "retired_owner";
    if (!runtime.session.agent.alive) return "runtime_missing";
    if (runtime.session.sessionId !== owner.sessionId) return "stale_session";
    if (participant.deliveryEpoch !== owner.deliveryEpoch) return "stale_epoch";
    if (this.history.nativeGeneration(roomId) !== owner.generation) return "stale_generation";
    const state = this.ports.state();
    if (state.closing || state.readOnly) return "room_closed";
    if (state.recordHold) return "record_hold";
    return null;
  }

  accept(id: string, agent: AcpAgent, raw: BackgroundMessage): void {
    if (this.disposed) return;
    const report = readBackgroundMessage(raw);
    if (!report || !this.ports.liveSession(id, agent, report.sessionId) || this.disposed) return;
    const { participant, runtime } = this.ports.current(id) as { participant: Participant; runtime: AgentRuntime };
    const { roomId, roomUuid, folderId } = this.ports.identity();
    if (this.disposed) return;
    let who: FaultOwner = { id, participant, runtime };
    const messageId = agentMessageId(roomUuid, id, report.sessionId, report.messageId, "acp"), hash = agentMessageHash(report);
    let arrival = this.arrivals.get(messageId);
    if (arrival && (arrival.agent !== agent || agentMessageHash(arrival.report) !== hash)) {
      this.fault(who, "native_conflict"); return;
    }
    if (!arrival) {
      const bytes = Buffer.byteLength(report.text, "utf8");
      const retainedBytes = [...this.arrivals.values()].reduce((sum, held) => sum + Buffer.byteLength(held.report.text, "utf8"), 0);
      if (this.arrivals.size >= NATIVE_ARRIVAL_LIMIT || retainedBytes + bytes > NATIVE_ARRIVAL_BYTES) {
        this.fault(who, "not_saved_capacity"); return;
      }
      arrival = { report: { ...report }, agent, acceptedName: participant.name, at: Date.now(), owner: null };
      this.arrivals.set(messageId, arrival);
      try {
        if (participant.deliveryEpoch) arrival.owner = { roomId, roomUuid, participantId: id,
          sessionId: runtime.session.sessionId, deliveryEpoch: participant.deliveryEpoch, folderId,
          generation: this.history.nativeGeneration(roomId) };
      } catch { }
    }
    if (arrival.owner) who = { id, participant, runtime, sessionId: arrival.owner.sessionId, deliveryEpoch: arrival.owner.deliveryEpoch };
    try {
      const previous = this.history.nativeReceipt(roomId, roomUuid, messageId);
      if (previous) {
        const priorHash = previous.type === "native" ? previous.record.envelope.reportHash : previous.receipt.hash;
        if (priorHash !== null && priorHash !== hash) { this.fault(who, "native_conflict"); return; }
        this.arrivals.delete(messageId);
        if (previous.type === "native" && this.handles.get(messageId) === agent) this.drain(id, runtime);
        return;
      }
      if (!arrival.owner || this.ownerReason({ owner: arrival.owner } as NativeEnvelope, runtime)) {
        this.fault(who, "not_saved_original_owner_unknown"); return;
      }
      if (this.arrivals.keys().next().value !== messageId) {
        this.fault(who, "not_saved_order_unknown"); return;
      }
      const journal = this.ports.journal.ops();
      if (this.disposed) return;
      if (journal.blocked || this.recoveryHold) { this.fault(who, "journal_corrupt_not_saved"); return; }
      if (this.unsaved.size) { this.fault(who, "order_unknown_not_saved"); return; }
      const enqueues = journal.ops.filter((op): op is Extract<DivertOp, { kind: "native_enqueue_v1" }> => op.kind === "native_enqueue_v1");
      for (const op of enqueues) {
        if (op.envelope.owner.roomUuid !== roomUuid || op.envelope.owner.roomId !== roomId || op.envelope.owner.folderId !== folderId) {
          this.recoveryHold = true; this.fault(who, "journal_conflict"); return;
        }
        if (op.envelope.id === messageId) {
          if (op.envelope.reportHash !== hash) this.fault(who, "native_conflict");
          else { this.arrivals.delete(messageId); this.handles.set(messageId, agent); this.ports.pending(); if (!this.disposed) this.drain(id, runtime); }
          return;
        }
      }
      const epoch = participant.deliveryEpoch;
      if (!epoch) { this.fault(who, "stale_epoch"); return; }
      const highWater = Math.max(this.history.nativeHighWater(roomUuid), ...enqueues.map(op => op.envelope.acceptOrder));
      const envelope = makeNativeEnvelope(arrival.owner, arrival.report, arrival.acceptedName, arrival.at, nativeInteger(highWater + 1, 1));
      let retained = false;
      try {
        if (this.ports.journal.pending()) this.ports.journal.drain();
        if (this.disposed) return;
        if (this.ports.journal.pending() || this.recoveryHold) throw new Error("earlier_journal_pending");
        this.history.enqueueNative(roomId, envelope); retained = true;
      } catch (error) {
        if (this.recoveryHold) { this.fault(who, "journal_unknown"); return; }
        let recovered = false;
        try {
          const exact = this.history.nativeReceipt(roomId, roomUuid, messageId);
          recovered = exact?.type === "native" && JSON.stringify(exact.record.envelope) === JSON.stringify(envelope);
          if (exact && !recovered) { this.fault(who, "native_conflict"); return; }
        } catch { this.fault(who, "commit_unknown"); }
        retained = recovered || this.ports.journal.append(nativeDivertOp({ kind: "native_enqueue_v1", envelope }), error);
        if (!retained) {
          if (this.unsaved.size < 64) {
            this.unsaved.set(messageId, envelope);
            this.arrivals.delete(messageId);
          }
          this.handles.set(messageId, agent);
          this.fault(who, "not_saved"); return;
        }
      }
      if (retained && !this.disposed) {
        this.arrivals.delete(messageId);
        this.handles.set(messageId, agent);
        this.ports.pending();
        if (!this.disposed) this.drain(id, runtime);
      }
    } catch {
      this.fault(who, "storage_read_unknown_not_saved");
    }
  }

  drain(id: string, runtime: AgentRuntime): void {
    if (this.disposed) return;
    const state = this.ports.state();
    if (runtime.native.nativeDraining || runtime.work.workBusy || runtime.work.turnActive || runtime.work.turn || state.closing || state.readOnly || state.recordHold) return;
    const { participant: author, runtime: now } = this.ports.current(id);
    if (this.disposed) return;
    if (now !== runtime || !author || !runtime.session.agent.alive || runtime.session.retiring) return;
    const owner: NativeOwner = { participant: author, runtime };
    const { roomId, roomUuid } = this.ports.identity();
    runtime.native.nativeDraining = true;
    runtime.native.nativeHold = false;
    try {
      if (this.ports.journal.pending()) this.ports.journal.drain();
      const ownUnsaved = [...this.unsaved.values()].some(e => e.owner.participantId === id && e.owner.sessionId === runtime.session.sessionId && e.owner.deliveryEpoch === author.deliveryEpoch);
      if (this.recoveryHold || this.ports.journal.pending() || ownUnsaved) { runtime.native.nativeHold = true; return; }
      const visited = new Set<string>();
      while (!runtime.native.nativeHold && !this.disposed) {
        const batch = this.history.listNativeDelivery(roomId, id).filter(record => !visited.has(record.envelope.id));
        if (!batch.length) break;
        for (let record of batch) {
          if (this.disposed) break;
          visited.add(record.envelope.id);
          const envelope = record.envelope, reason = this.ownerReason(envelope, runtime);
          if (this.disposed) break;
          if (reason || this.handles.get(envelope.id) !== runtime.session.agent) {
            if (record.state === "pending" || record.state === "held") {
              const hold = reason ?? "runtime_missing";
              if (record.state !== "held" || record.holdReason !== hold) this.history.holdNative(roomId, nativeSubject(envelope), record.stateRevision, hold, Date.now());
            } else {
              for (const obligation of record.obligations) {
                const ref = { subject: nativeSubject(envelope), obligationId: obligation.id };
                if (obligation.phase === "pending") this.transition(ref, "held_owner");
                else if (obligation.phase === "attempt_started") this.transition(ref, "attempt_unknown");
              }
            }
            if (!reason) { runtime.native.nativeHold = true; break; }
            continue;
          }
          if (record.state === "held") {
            if (["note_subject_changed", "stale_session", "stale_epoch", "stale_generation", "retired_owner"].includes(record.holdReason!)) { runtime.native.nativeHold = true; break; }
            record = this.history.releaseNative(roomId, nativeSubject(envelope), record.stateRevision);
          }
          if (record.obligations.some(o => o.phase === "held_owner")) {
            for (const obligation of record.obligations) if (obligation.phase === "held_owner") this.transition({ subject: nativeSubject(envelope), obligationId: obligation.id }, "pending");
            const refreshed = this.history.nativeReceipt(roomId, roomUuid, envelope.id);
            if (!refreshed || refreshed.type !== "native") throw new Error("native_recovery_receipt_unknown");
            record = refreshed.record;
          }
          if (record.state === "pending") {
            if (this.disposed) break;
            const { decision, message } = this.ports.decide(envelope, owner);
            if (!this.ownerHolds(owner)) { runtime.native.nativeHold = true; break; }
            let finalized: NativeRecord | undefined;
            const pendingRecord = record;
            const writeRecord = () => {
              if (!this.ownerHolds(owner)) throw new Error("native_owner_changed");
              finalized = this.history.finalizeNative(roomId, nativeSubject(envelope), pendingRecord.stateRevision, decision, message);
            };
            if (decision.notes) {
              const disposition = this.ports.commitNote(owner, decision.notes, writeRecord);
              if (this.disposed) break;
              if (disposition === "owner_changed") { runtime.native.nativeHold = true; break; }
              if (disposition === undefined) { this.fault({ id, ...owner }, "note_metadata_unavailable"); break; }
              if (disposition === "changed" || disposition === "superseded") {
                this.history.holdNative(roomId, nativeSubject(envelope), record.stateRevision, "note_subject_changed", Date.now());
                runtime.native.nativeHold = true; break;
              }
            } else writeRecord();
            if (!finalized) throw new Error("native_finalize_not_confirmed");
            record = finalized;
          }
          if (!this.project(record, owner)) { runtime.native.nativeHold = true; break; }
        }
      }
    } catch {
      this.fault({ id, ...owner }, "commit_unknown");
    } finally { runtime.native.nativeDraining = false; }
    if (this.disposed) return;
    if (!runtime.native.nativeHold) this.faultReasons.delete(id);
    if (!this.laneBlocked(runtime) && !runtime.work.workBusy && !runtime.work.turnActive && !runtime.work.turn) this.ports.drained(owner);
    if (this.disposed) return;
    if (this.hasPending() && !this.disposed) this.ports.pending();
  }

  private project(record: NativeRecord, owner: NativeOwner): boolean {
    const decision = record.decision, envelope = record.envelope;
    if (!decision || record.state === "tombstoned") return true;
    if (envelope.owner.participantId !== owner.participant.id) return true;
    const publication = `${envelope.id}:publish`, counting = `${envelope.id}:counted`;
    if (!this.localEffects.has(publication)) {
      if (record.receipt) {
        const shown = this.ports.publish(record);
        if (this.disposed) return false;
        if (shown === "unknown") throw new Error("native_publication_unknown");
        if (shown === "tombstoned") return true;
      }
      this.localEffects.add(publication);
    }
    if (!this.localEffects.has(counting)) {
      if (!this.ports.counted(owner, decision)) return false;
      if (this.disposed) return false;
      this.localEffects.add(counting);
    }
    for (const obligation of record.obligations) {
      if (this.disposed) return false;
      const ref = { subject: nativeSubject(envelope), obligationId: obligation.id };
      if (obligation.phase === "attempt_started") {
        if (!this.localEffects.has(obligation.id)) this.transition(ref, "attempt_unknown");
        continue;
      }
      if (obligation.phase !== "pending" || this.localEffects.has(obligation.id)) continue;
      if (obligation.kind === "note") {
        const disposition = this.ports.notesApplied(owner, obligation.effect);
        if (disposition === false || this.disposed) return false;
        this.transition(ref, disposition === "changed" || disposition === "superseded" ? "superseded" : "applied_local");
        this.localEffects.add(obligation.id);
      } else if (obligation.kind === "header") {
        if (!this.ports.header(owner, obligation.lines, ref) || this.disposed) return false;
        this.localEffects.add(obligation.id);
      } else if (obligation.kind === "correction") {
        const asked = this.ports.correction(owner, obligation, ref);
        if (asked === "unknown") throw new Error("native_hidden_receipt_missing");
        if (!asked || this.disposed) return false;
        this.localEffects.add(obligation.id);
      } else {
        const hopKey = `${envelope.id}:hop`, effects = this.localEffects;
        const hop: NativeHop = { get spent() { return effects.has(hopKey); }, spend: () => { effects.add(hopKey); } };
        const routed = this.ports.route(obligation, ref, decision.to.includes(obligation.participantId), hop);
        if (this.disposed) return false;
        if (routed === "superseded") this.transition(ref, "superseded");
        this.localEffects.add(obligation.id);
      }
    }
    return true;
  }

  transition(ref: NativeObligationRef, phase: NativeObligation["phase"]): void {
    this.write(this.ports.identity().roomId, ref, phase);
  }

  private write(roomId: string, ref: NativeObligationRef, phase: NativeObligation["phase"], still: () => boolean = () => true): boolean {
    const history = this.history;
    const receipt = history.nativeReceipt(roomId, ref.subject.roomUuid, ref.subject.id);
    if (!receipt || receipt.type !== "native" || receipt.record.envelope.reportHash !== ref.subject.reportHash) throw new Error("native_obligation_unknown");
    if (!still()) return false;
    history.updateNativeObligation(roomId, ref.subject, receipt.record.stateRevision, ref.obligationId, phase);
    return true;
  }

  promptEligible(ref: NativeObligationRef, participant: Participant, runtime: AgentRuntime): boolean {
    if (this.disposed) return false;
    const { roomId } = this.ports.identity();
    if (this.disposed) return false;
    const receipt = this.history.nativeReceipt(roomId, ref.subject.roomUuid, ref.subject.id);
    if (!receipt || receipt.type !== "native" || receipt.record.envelope.reportHash !== ref.subject.reportHash) throw new Error("native_prompt_subject_unknown");
    const record = receipt.record;
    if (record.state === "tombstoned") return false;
    const source = this.ports.current(record.envelope.owner.participantId).runtime;
    if (this.disposed) return false;
    const reason = source && this.ownerReason(record.envelope, source);
    if (this.disposed) return false;
    if (!source || reason || this.handles.get(record.envelope.id) !== source.session.agent) throw new Error("native_prompt_owner_changed");
    const obligation = record.obligations.find(o => o.id === ref.obligationId);
    if (!obligation) throw new Error("native_prompt_obligation_unknown");
    if (["suppressed_deleted", "superseded", "completed", "attempt_unknown"].includes(obligation.phase)) return false;
    if (obligation.phase !== "pending") throw new Error("native_prompt_already_attempted");
    if (obligation.kind === "route") {
      if (obligation.participantId !== participant.id || obligation.sessionId !== runtime.session.sessionId || obligation.deliveryEpoch !== participant.deliveryEpoch) throw new Error("native_route_owner_changed");
    } else if (obligation.kind !== "correction" || record.envelope.owner.participantId !== participant.id) throw new Error("native_prompt_kind_changed");
    return this.targetHolds(participant, runtime);
  }

  private targetHolds(participant: Participant, runtime: AgentRuntime): boolean {
    if (this.disposed) return false;
    const now = this.ports.current(participant.id);
    return !this.disposed && now.participant === participant && now.runtime === runtime;
  }

  startPrompt(ref: NativeObligationRef, participant: Participant, runtime: AgentRuntime): boolean {
    if (!this.promptEligible(ref, participant, runtime) || this.disposed) return false;
    const { roomId } = this.ports.identity();
    if (this.disposed) return false;
    return this.write(roomId, ref, "attempt_started", () => this.targetHolds(participant, runtime));
  }

  confirmPost(messageId: string, receipt: { deleted: boolean; hash: string | null }): void {
    const pending = this.unconfirmed.get(messageId);
    if (!pending || this.disposed) return;
    const closing = this.ports.state().closing;
    if (this.disposed || closing) return;
    if (receipt.hash !== pending.reportHash) {
      pending.due = false;
      this.ports.log("warn", `a shared post of ${pending.participant.name} meets another message under its id in the record; nothing is done for it`);
      return;
    }
    this.unconfirmed.delete(messageId);
    if (receipt.deleted) return;
    if (pending.retry) {
      if (!this.ports.correctPost(pending)) this.ports.log("info", `the correction of ${pending.participant.name}'s held post is not asked: the session that wrote it is gone`);
    } else this.ports.routePost(messageId);
  }

  confirmJournaledPosts(): void {
    for (const [messageId, pending] of [...this.unconfirmed]) {
      if (this.disposed) return;
      const closing = this.ports.state().closing;
      if (this.disposed || closing) return;
      if (!pending.due || this.unconfirmed.get(messageId) !== pending) continue;
      let receipt: ReturnType<HistoryStore["agentMessageReceipt"]>;
      try { receipt = this.history.agentMessageReceipt(this.ports.identity().roomId, messageId); }
      catch {
        this.ports.pending();
        continue;
      }
      if (this.disposed) return;
      const closed = this.ports.state().closing;
      if (this.disposed || closed) return;
      if (!receipt) { pending.due = false; continue; }
      this.confirmPost(messageId, receipt);
    }
  }

  journalApplied(): void {
    if (!this.unconfirmed.size || this.disposed) return;
    for (const pending of this.unconfirmed.values()) pending.due = true;
    setImmediate(() => this.confirmJournaledPosts());
  }
}
