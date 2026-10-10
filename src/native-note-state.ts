// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { NativeNoteEffect, NativeNoteSubject } from "./native-reports.js";

export interface NativeNoteFields {
  readonly notesRevision?: number;
  readonly notes?: string | null;
  readonly notesAt?: number | null;
  readonly notesSeq?: number | null;
  readonly notesWrittenAt?: number | null;
  readonly nativeNoteReceipt?: string | null;
}

export type NativeNoteDisposition = "apply" | "already_applied" | "superseded" | "changed";

const SUBJECT_FIELDS = ["notesRevision", "notes", "notesAt", "notesSeq", "notesWrittenAt", "nativeNoteReceipt"] as const;

function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("invalid_native_note_revision");
  return value;
}

function nullableNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("invalid_native_note_fields");
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("invalid_native_note_fields");
  return value;
}

function closedRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_native_note_subject");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== "string" || !fields.includes(key))) {
    throw new Error("invalid_native_note_subject");
  }
  return value as Record<string, unknown>;
}

export function captureNativeNoteSubject(input: NativeNoteFields): NativeNoteSubject {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_native_note_fields");
  const currentRevision = input.notesRevision;
  return Object.freeze({
    notesRevision: currentRevision === undefined ? 0 : revision(currentRevision),
    notes: nullableString(input.notes),
    notesAt: nullableNumber(input.notesAt),
    notesSeq: nullableNumber(input.notesSeq),
    notesWrittenAt: nullableNumber(input.notesWrittenAt),
    nativeNoteReceipt: nullableString(input.nativeNoteReceipt),
  });
}

export function nextNotesRevision(current: number | undefined): number {
  const value = current === undefined ? 0 : revision(current);
  if (value === Number.MAX_SAFE_INTEGER) throw new Error("native_note_revision_overflow");
  return value + 1;
}

function closedSubject(value: unknown): NativeNoteSubject {
  const row = closedRecord(value, SUBJECT_FIELDS);
  if (SUBJECT_FIELDS.some(field => row[field] === undefined)) throw new Error("invalid_native_note_subject");
  return captureNativeNoteSubject(row as NativeNoteFields);
}

export function planNativeNoteEffect(
  expected: NativeNoteSubject,
  envelopeId: string,
  assignment: { notes: string; notesAt: number; notesSeq: number; notesWrittenAt: number },
): NativeNoteEffect {
  const prior = closedSubject(expected);
  if (typeof envelopeId !== "string" || !envelopeId) throw new Error("invalid_native_note_envelope_id");
  const fields = closedRecord(assignment, ["notes", "notesAt", "notesSeq", "notesWrittenAt"]);
  if (typeof fields.notes !== "string" || fields.notesAt === null || fields.notesAt === undefined ||
      fields.notesSeq === null || fields.notesSeq === undefined || fields.notesWrittenAt === null || fields.notesWrittenAt === undefined) {
    throw new Error("invalid_native_note_assignment");
  }
  const next = captureNativeNoteSubject({
    notesRevision: nextNotesRevision(prior.notesRevision),
    notes: fields.notes.slice(0, 4000),
    notesAt: nullableNumber(fields.notesAt),
    notesSeq: nullableNumber(fields.notesSeq),
    notesWrittenAt: nullableNumber(fields.notesWrittenAt),
    nativeNoteReceipt: envelopeId,
  });
  return Object.freeze({ expected: prior, next });
}

function sameSubject(left: NativeNoteSubject, right: NativeNoteSubject): boolean {
  return SUBJECT_FIELDS.every(field => left[field] === right[field]);
}

export function nativeNoteDisposition(current: NativeNoteSubject, effect: NativeNoteEffect): NativeNoteDisposition {
  const fields = closedRecord(effect, ["expected", "next"]);
  const expected = closedSubject(fields.expected), next = closedSubject(fields.next), subject = closedSubject(current);
  if (next.notesRevision !== nextNotesRevision(expected.notesRevision) || next.nativeNoteReceipt === null || !next.nativeNoteReceipt ||
      next.notes === null || next.notes.length > 4000 || next.notesAt === null || next.notesSeq === null || next.notesWrittenAt === null) {
    throw new Error("invalid_native_note_effect");
  }
  if (sameSubject(subject, expected)) return "apply";
  if (sameSubject(subject, next)) return "already_applied";
  return subject.notesRevision > next.notesRevision ? "superseded" : "changed";
}
