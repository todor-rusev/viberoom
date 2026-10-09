// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { JsonValue, WriteIdentity } from "./delivery.js";

export const ZEP_METADATA_SCHEMA = 4;
export const ZEP_CARRY_HASH = /^sha256:[a-f0-9]{64}$/;
export type ZepMetadataSchema = 2 | 3 | typeof ZEP_METADATA_SCHEMA;
export type ZepSourceKind = "message" | "note" | "fact";
export const supportedZepMetadataSchema = (value: unknown): value is ZepMetadataSchema => value === 2 || value === 3 || value === ZEP_METADATA_SCHEMA;
const kinds: readonly string[] = ["message", "note", "fact"];
const baseKeys = ["schema", "op_id", "source_id", "version", "room_id", "copy_id", "part", "source_at", "origin"];

export function zepMetadata(identity: WriteIdentity, opId: string, authorId: string, kind: ZepSourceKind, at: string,
  carryHash: string | null, schema: ZepMetadataSchema = ZEP_METADATA_SCHEMA): Record<string, JsonValue> {
  const common = { schema, op_id: opId, source_id: identity.sourceId, version: identity.version,
    room_id: identity.roomUuid, copy_id: identity.copyId, part: identity.part, source_at: at };
  return schema === ZEP_METADATA_SCHEMA
    ? { ...common, origin: [authorId, kind], ...(kind === "message" ? { carry_hash: carryHash } : {}) }
    : { ...common, author_id: authorId, source_kind: kind, ...(schema === 3 ? { carry_hash: carryHash } : {}) };
}

export function readZepMetadata(value: unknown): (Record<string, unknown> & { schema: ZepMetadataSchema }) | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const m = value as Record<string, unknown>;
  if (!supportedZepMetadataSchema(m.schema)) return null;
  if (m.schema !== ZEP_METADATA_SCHEMA) return m as Record<string, unknown> & { schema: ZepMetadataSchema };
  const origin = m.origin;
  if (!Array.isArray(origin) || origin.length !== 2 || typeof origin[0] !== "string" || !origin[0] || !kinds.includes(origin[1])) return null;
  const message = origin[1] === "message", keys = message ? [...baseKeys, "carry_hash"] : baseKeys;
  if (Object.keys(m).length !== keys.length || keys.some(k => !Object.hasOwn(m, k)) ||
    baseKeys.filter(k => k !== "schema" && k !== "origin").some(k => typeof m[k] !== "string" || !m[k]) ||
    message && (typeof m.carry_hash !== "string" || !ZEP_CARRY_HASH.test(m.carry_hash))) return null;
  return { ...m, schema: m.schema, author_id: origin[0], source_kind: origin[1], carry_hash: message ? m.carry_hash : null };
}

export function zepMetadataFitsProvider(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 10) return false;
  const scalar = (v: unknown) => typeof v === "string" || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v);
  return Object.values(value).every(v => scalar(v) || Array.isArray(v) && v.length > 0 && v.every(scalar) && v.every(i => typeof i === typeof v[0]));
}
