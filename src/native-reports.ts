// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash } from "node:crypto";
import { agentMessageHash, agentMessageId } from "./agent-message.js";
import type { BackgroundMessage } from "./acp-message-delivery.js";

export class NativeReportError extends Error {
  constructor(readonly code: "invalid_native_data" | "native_conflict" | "native_revision_changed" | "native_generation_changed" | "native_state_corrupt", message: string) {
    super(message);
  }
}
export interface NativeOwner {
  roomId: string;
  roomUuid: string;
  participantId: string;
  sessionId: string;
  deliveryEpoch: string;
  folderId: string | null;
  generation: number;
}
export interface NativeEnvelope {
  version: 1;
  id: string;
  owner: NativeOwner;
  nativeMessageId: string;
  reportHash: string;
  text: string;
  stopReason: BackgroundMessage["stopReason"];
  acceptedName: string;
  acceptedAt: number;
  acceptOrder: number;
}
export interface NativeSubject { roomUuid: string; id: string; reportHash: string }
export interface NativeNoteSubject {
  notesRevision: number;
  notes: string | null;
  notesAt: number | null;
  notesSeq: number | null;
  notesWrittenAt: number | null;
  nativeNoteReceipt: string | null;
}
export interface NativeNoteEffect { expected: NativeNoteSubject; next: NativeNoteSubject }
export type NativeDecisionKind = "visible_complete" | "visible_cancelled_human" | "visible_error_human" | "referee_hidden" | "silent" | "notes_only" | "instruction_marker";
export type NativeObligationPhase = "pending" | "applied_local" | "attempt_started" | "completed" | "attempt_unknown" | "suppressed_deleted" | "superseded" | "held_owner";
export type NativeObligation = (
  | { kind: "note"; effect: NativeNoteEffect }
  | { kind: "header"; lines: string[] }
  | { kind: "correction"; original: string; corrections: string[] }
  | { kind: "route"; messageId: string; participantId: string; sessionId: string; deliveryEpoch: string }
) & { id: string; phase: NativeObligationPhase };
export interface NativeDecision {
  version: 1;
  kind: NativeDecisionKind;
  reportHash: string;
  owner: NativeOwner;
  at: number;
  text: string;
  to: string[];
  toNames: string[];
  corrections: string[];
  notes: NativeNoteEffect | null;
  obligations: NativeObligation[];
}
export type NativeState = "pending" | "held" | "published" | "consumed" | "tombstoned";
export type NativeHoldReason = "runtime_missing" | "stale_session" | "stale_epoch" | "stale_generation" | "retired_owner" | "room_closed" | "record_hold" | "storage_read_unknown" | "journal_corrupt" | "journal_unsupported" | "journal_conflict" | "commit_unknown" | "note_subject_changed";
export interface NativePublishedReceipt { messageId: string; seq: number; kind: "chat" | "hidden" }
export interface NativeRecord {
  envelope: NativeEnvelope;
  state: NativeState;
  stateRevision: number;
  holdReason: NativeHoldReason | null;
  decision: NativeDecision | null;
  receipt: NativePublishedReceipt | null;
  obligations: NativeObligation[];
  deletedAt: number | null;
}
export type NativeReceipt =
  | { type: "native"; record: NativeRecord }
  | { type: "legacy"; receipt: { seq: number; kind: string; deleted: boolean; hash: string | null } };

export type NativePendingOp = (
  | { kind: "native_enqueue_v1"; envelope: NativeEnvelope }
  | { kind: "native_hold_v1"; subject: NativeSubject; expectedRevision: number; reason: NativeHoldReason; at: number }
  | { kind: "native_tombstone_v1"; subject: NativeSubject; expectedRevision: number; deletedAt: number }
) & { opId?: string };
export type NativeDivertOp = NativePendingOp & { opId: string };

const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACP_ID = /^acp-[0-9a-f]{64}$/;
const HOLD_REASONS: readonly NativeHoldReason[] = ["runtime_missing", "stale_session", "stale_epoch", "stale_generation", "retired_owner", "room_closed", "record_hold", "storage_read_unknown", "journal_corrupt", "journal_unsupported", "journal_conflict", "commit_unknown", "note_subject_changed"];
const PHASES: readonly NativeObligationPhase[] = ["pending", "applied_local", "attempt_started", "completed", "attempt_unknown", "suppressed_deleted", "superseded", "held_owner"];
const DECISIONS: readonly NativeDecisionKind[] = ["visible_complete", "visible_cancelled_human", "visible_error_human", "referee_hidden", "silent", "notes_only", "instruction_marker"];

function invalid(): never { throw new NativeReportError("invalid_native_data", "The native report data is not a supported closed record."); }
function object(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(k => !keys.includes(k) && !optional.includes(k)) || keys.some(k => !Object.hasOwn(row, k))) return invalid();
  return row;
}
function string(value: unknown, nonempty = false, max?: number): string {
  if (typeof value !== "string" || (nonempty && !value) || (max !== undefined && value.length > max)) return invalid();
  return value;
}
export function nativeInteger(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) return invalid();
  return value;
}
function nullableInteger(value: unknown): number | null { return value === null ? null : nativeInteger(value); }
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return invalid();
  return value.map(v => string(v));
}
function hash(value: unknown): string { const v = string(value); if (!HASH.test(v)) return invalid(); return v; }
function id(value: unknown): string { const v = string(value); if (!ACP_ID.test(v)) return invalid(); return v; }
function uuid(value: unknown): string { const v = string(value); if (!UUID.test(v)) return invalid(); return v; }
export function nativeDataHash(value: NativeEnvelope | NativeDecision | NativePendingOp): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function parseNativeOwner(value: unknown): NativeOwner {
  const r = object(value, ["roomId", "roomUuid", "participantId", "sessionId", "deliveryEpoch", "folderId", "generation"]);
  return { roomId: string(r.roomId, true), roomUuid: uuid(r.roomUuid), participantId: string(r.participantId, true),
    sessionId: string(r.sessionId, true, 1024), deliveryEpoch: string(r.deliveryEpoch, true),
    folderId: r.folderId === null ? null : string(r.folderId, true), generation: nativeInteger(r.generation) };
}
export function parseNativeEnvelope(value: unknown): NativeEnvelope {
  const r = object(value, ["version", "id", "owner", "nativeMessageId", "reportHash", "text", "stopReason", "acceptedName", "acceptedAt", "acceptOrder"]);
  if (r.version !== 1 || typeof r.stopReason !== "string" || !["end_turn", "cancelled", "error"].includes(r.stopReason)) return invalid();
  const owner = parseNativeOwner(r.owner), text = string(r.text), nativeMessageId = string(r.nativeMessageId, true, 1024);
  const stopReason = r.stopReason as BackgroundMessage["stopReason"];
  const result: NativeEnvelope = { version: 1, id: id(r.id), owner, nativeMessageId, reportHash: hash(r.reportHash), text, stopReason,
    acceptedName: string(r.acceptedName, true), acceptedAt: nativeInteger(r.acceptedAt), acceptOrder: nativeInteger(r.acceptOrder, 1) };
  if (result.id !== agentMessageId(owner.roomUuid, owner.participantId, owner.sessionId, nativeMessageId, "acp") || result.reportHash !== agentMessageHash({ text, stopReason })) return invalid();
  return result;
}
export function makeNativeEnvelope(owner: NativeOwner, report: BackgroundMessage, acceptedName: string, acceptedAt: number, acceptOrder: number): NativeEnvelope {
  if (report.sessionId !== owner.sessionId) return invalid();
  return parseNativeEnvelope({ version: 1, id: agentMessageId(owner.roomUuid, owner.participantId, owner.sessionId, report.messageId, "acp"),
    owner, nativeMessageId: report.messageId, reportHash: agentMessageHash(report), text: report.text, stopReason: report.stopReason, acceptedName, acceptedAt, acceptOrder });
}
export function nativeSubject(envelope: NativeEnvelope): NativeSubject { return { roomUuid: envelope.owner.roomUuid, id: envelope.id, reportHash: envelope.reportHash }; }
export function parseNativeSubject(value: unknown): NativeSubject {
  const r = object(value, ["roomUuid", "id", "reportHash"]);
  return { roomUuid: uuid(r.roomUuid), id: id(r.id), reportHash: hash(r.reportHash) };
}
export function parseNativeNoteSubject(value: unknown): NativeNoteSubject {
  const r = object(value, ["notesRevision", "notes", "notesAt", "notesSeq", "notesWrittenAt", "nativeNoteReceipt"]);
  return { notesRevision: nativeInteger(r.notesRevision), notes: r.notes === null ? null : string(r.notes),
    notesAt: nullableInteger(r.notesAt), notesSeq: nullableInteger(r.notesSeq), notesWrittenAt: nullableInteger(r.notesWrittenAt),
    nativeNoteReceipt: r.nativeNoteReceipt === null ? null : id(r.nativeNoteReceipt) };
}
function noteEffect(value: unknown, envelope: NativeEnvelope): NativeNoteEffect {
  const r = object(value, ["expected", "next"]), expected = parseNativeNoteSubject(r.expected), next = parseNativeNoteSubject(r.next);
  if (!Number.isSafeInteger(expected.notesRevision + 1) || next.notesRevision !== expected.notesRevision + 1 || next.nativeNoteReceipt !== envelope.id) return invalid();
  return { expected, next };
}
export function nativeObligationId(envelopeId: string, kind: NativeObligation["kind"], participantId: string | null = null): string {
  return `native-obligation-${createHash("sha256").update(JSON.stringify([envelopeId, kind, participantId])).digest("hex")}`;
}
function obligation(value: unknown, envelope: NativeEnvelope): NativeObligation {
  if (!value || typeof value !== "object") return invalid();
  const kind = (value as { kind?: unknown }).kind;
  const extra = kind === "note" ? ["effect"] : kind === "header" ? ["lines"] : kind === "correction" ? ["original", "corrections"] : kind === "route" ? ["messageId", "participantId", "sessionId", "deliveryEpoch"] : null;
  if (!extra) return invalid();
  const r = object(value, ["id", "phase", "kind", ...extra]);
  if (!PHASES.includes(r.phase as NativeObligationPhase)) return invalid();
  const base = { id: string(r.id), phase: r.phase as NativeObligationPhase };
  let result: NativeObligation;
  if (kind === "note") result = { ...base, kind, effect: noteEffect(r.effect, envelope) };
  else if (kind === "header") result = { ...base, kind, lines: strings(r.lines) };
  else if (kind === "correction") result = { ...base, kind, original: string(r.original), corrections: strings(r.corrections) };
  else result = { ...base, kind: "route", messageId: id(r.messageId), participantId: string(r.participantId, true), sessionId: string(r.sessionId, true, 1024), deliveryEpoch: string(r.deliveryEpoch, true) };
  if (result.id !== nativeObligationId(envelope.id, result.kind, result.kind === "route" ? result.participantId : null) || (result.kind === "route" && result.messageId !== envelope.id)) return invalid();
  return result;
}
export function parseNativeDecision(value: unknown, envelope: NativeEnvelope): NativeDecision {
  const r = object(value, ["version", "kind", "reportHash", "owner", "at", "text", "to", "toNames", "corrections", "notes", "obligations"]);
  if (r.version !== 1 || !DECISIONS.includes(r.kind as NativeDecisionKind) || !Array.isArray(r.obligations)) return invalid();
  const owner = parseNativeOwner(r.owner);
  if (hash(r.reportHash) !== envelope.reportHash || JSON.stringify(owner) !== JSON.stringify(envelope.owner)) return invalid();
  const obligations = r.obligations.map(v => obligation(v, envelope));
  if (new Set(obligations.map(o => o.id)).size !== obligations.length) return invalid();
  const result: NativeDecision = { version: 1, kind: r.kind as NativeDecisionKind, reportHash: envelope.reportHash, owner,
    at: nativeInteger(r.at), text: string(r.text), to: strings(r.to), toNames: strings(r.toNames), corrections: strings(r.corrections),
    notes: r.notes === null ? null : noteEffect(r.notes, envelope), obligations };
  if (result.notes !== null && envelope.stopReason !== "end_turn") return invalid();
  if (result.kind === "notes_only" && (result.notes === null || result.text !== "")) return invalid();
  if (result.kind === "visible_cancelled_human" && envelope.stopReason !== "cancelled" || result.kind === "visible_error_human" && envelope.stopReason !== "error" || result.kind === "visible_complete" && envelope.stopReason !== "end_turn") return invalid();
  for (const o of obligations) {
    if (o.kind === "note" && JSON.stringify(o.effect) !== JSON.stringify(result.notes)) return invalid();
    if (o.kind === "correction" && (result.kind !== "referee_hidden" || o.original !== result.text || JSON.stringify(o.corrections) !== JSON.stringify(result.corrections))) return invalid();
    if (o.kind === "route" && result.kind !== "visible_complete") return invalid();
  }
  if (obligations.filter(o => o.kind === "note").length !== (result.notes === null ? 0 : 1)) return invalid();
  if (result.kind === "referee_hidden" && (!result.corrections.length || obligations.filter(o => o.kind === "correction").length !== 1)) return invalid();
  return result;
}
export function parseNativeRecord(value: unknown): NativeRecord {
  const r = object(value, ["envelope", "state", "stateRevision", "holdReason", "decision", "receipt", "obligations", "deletedAt"]);
  if (typeof r.state !== "string" || !["pending", "held", "published", "consumed", "tombstoned"].includes(r.state) || !Array.isArray(r.obligations)) return invalid();
  const envelope = parseNativeEnvelope(r.envelope), state = r.state as NativeState;
  if (r.holdReason !== null && !HOLD_REASONS.includes(r.holdReason as NativeHoldReason)) return invalid();
  let receipt: NativePublishedReceipt | null = null;
  if (r.receipt !== null) {
    const x = object(r.receipt, ["messageId", "seq", "kind"]);
    if (typeof x.kind !== "string" || !["chat", "hidden"].includes(x.kind) || id(x.messageId) !== envelope.id) return invalid();
    receipt = { messageId: envelope.id, seq: nativeInteger(x.seq, 1), kind: x.kind as "chat" | "hidden" };
  }
  const decision = r.decision === null ? null : parseNativeDecision(r.decision, envelope);
  const obligations = r.obligations.map(v => obligation(v, envelope));
  if (new Set(obligations.map(o => o.id)).size !== obligations.length) return invalid();
  if ((state === "pending" || state === "held") && (decision !== null || receipt !== null || obligations.length)) return invalid();
  if (state === "published" && (!decision || !receipt) || state === "consumed" && (!decision || receipt)) return invalid();
  const visible = decision !== null && ["visible_complete", "visible_cancelled_human", "visible_error_human", "referee_hidden"].includes(decision.kind);
  if (decision !== null && visible !== (receipt !== null) || decision === null && (receipt !== null || obligations.length)) return invalid();
  if (receipt && receipt.kind !== (decision?.kind === "referee_hidden" ? "hidden" : "chat")) return invalid();
  if (state === "held" && r.holdReason === null || state !== "held" && r.holdReason !== null) return invalid();
  const deletedAt = nullableInteger(r.deletedAt);
  if ((state === "tombstoned") !== (deletedAt !== null)) return invalid();
  if (decision && (obligations.length !== decision.obligations.length || obligations.some((o, i) => JSON.stringify({ ...o, phase: "pending" }) !== JSON.stringify({ ...decision.obligations[i], phase: "pending" })))) return invalid();
  return { envelope, state, stateRevision: nativeInteger(r.stateRevision), holdReason: r.holdReason as NativeHoldReason | null, decision, receipt, obligations, deletedAt };
}
export function parseNativeHoldReason(value: unknown): NativeHoldReason {
  if (!HOLD_REASONS.includes(value as NativeHoldReason)) return invalid();
  return value as NativeHoldReason;
}
export function isNativeOperation(value: unknown): boolean {
  return !!value && typeof value === "object" && typeof (value as { kind?: unknown }).kind === "string" && ((value as { kind: string }).kind.startsWith("native_"));
}
export function nativeOperationId(op: NativePendingOp): string {
  if (op.kind === "native_enqueue_v1") return `native-enqueue:${op.envelope.id}`;
  if (op.kind === "native_hold_v1") return `native-hold:${op.subject.id}:${op.expectedRevision}:${op.reason}`;
  return `native-tombstone:${op.subject.id}:${op.expectedRevision}`;
}
export function parseNativeOperation(value: unknown): NativePendingOp | null {
  if (!isNativeOperation(value)) return null;
  const raw = value as Record<string, unknown>;
  let result: NativePendingOp;
  if (raw.kind === "native_enqueue_v1") {
    const r = object(raw, ["kind", "envelope"], ["opId"]);
    result = { kind: "native_enqueue_v1", envelope: parseNativeEnvelope(r.envelope) };
  } else if (raw.kind === "native_hold_v1") {
    const r = object(raw, ["kind", "subject", "expectedRevision", "reason", "at"], ["opId"]);
    result = { kind: "native_hold_v1", subject: parseNativeSubject(r.subject), expectedRevision: nativeInteger(r.expectedRevision), reason: parseNativeHoldReason(r.reason), at: nativeInteger(r.at) };
  } else if (raw.kind === "native_tombstone_v1") {
    const r = object(raw, ["kind", "subject", "expectedRevision", "deletedAt"], ["opId"]);
    result = { kind: "native_tombstone_v1", subject: parseNativeSubject(r.subject), expectedRevision: nativeInteger(r.expectedRevision), deletedAt: nativeInteger(r.deletedAt) };
  } else return invalid();
  if (Object.hasOwn(raw, "opId")) {
    if (string(raw.opId, true) !== nativeOperationId(result)) return invalid();
    result.opId = raw.opId as string;
  }
  return result;
}
export function nativeDivertOp(op: NativePendingOp): NativeDivertOp {
  const parsed = parseNativeOperation(op);
  if (!parsed) return invalid();
  return { ...parsed, opId: nativeOperationId(parsed) };
}
export function nativeObligationTransition(from: NativeObligationPhase, to: NativeObligationPhase): boolean {
  if (!PHASES.includes(from) || !PHASES.includes(to)) return false;
  if (from === to) return true;
  if (from === "pending") return ["applied_local", "attempt_started", "superseded", "held_owner", "suppressed_deleted"].includes(to);
  if (from === "held_owner") return ["pending", "superseded", "suppressed_deleted"].includes(to);
  if (from === "attempt_started") return ["completed", "attempt_unknown"].includes(to);
  return false;
}
