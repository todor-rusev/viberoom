// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { z } from "zod";
import { hostAllowed } from "./local-gate.js";
import type { AutostartStatus } from "./autostart.js";
import type { UpdateInfo } from "./update.js";

export const HOST_CONTRACT = 1;
export const HOST_REQUEST_TIMEOUT_MS = 10_000;
export const HOST_MAX_REQUEST_TIMEOUT_MS = 30_000;

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const text = z.string().min(1).max(4096).refine(value => !value.includes("\0"));
const label = z.string().min(1).max(128).regex(/^[^\s\x00-\x1f]+$/);
const backupName = z.string().regex(/^history\.db\.before-schema-\d+-\d+\.bak$/);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const percent = z.number().int().min(0).max(100);
const time = count.nullable();
const nullableText = text.nullable();
const url = z.string().max(2048).refine(value => {
  if (/[\s\x00-\x1f]/.test(value)) return false;
  try {
    const address = new URL(value);
    return address.protocol === "http:" && hostAllowed(address.host, Number(address.port) || 80)
      && !address.username && !address.password && !address.search && !address.hash && address.pathname === "/";
  } catch { return false; }
}, "expected a bare loopback HTTP address");

export const hostInfoSchema = z.object({
  kind: z.enum(["store", "installer", "source"]), version: label, appPath: text,
  platform: z.enum(["win32", "darwin", "linux"]),
  opener: text.optional(),
});
export type HostInfo = z.infer<typeof hostInfoSchema>;

const autostartText = z.string().max(4096).refine(value => !value.includes("\0"));
export const autostartStateSchema = z.object({
  enabled: z.boolean(), entry: autostartText, script: autostartText, target: autostartText.nullable(), targetMissing: z.boolean(),
  stale: z.boolean(), foreign: z.boolean(), installedAt: time, lastAutoStartAt: time, log: autostartText,
  note: autostartText.optional(), managedBy: z.enum(["app", "system", "policy"]),
  unavailable: autostartText.optional(),
}) satisfies z.ZodType<AutostartStatus & { managedBy: "app" | "system" | "policy" }>;
export type HostAutostartState = z.infer<typeof autostartStateSchema>;

export const appUpdateStateSchema = z.object({
  current: label, latest: label.nullable(), available: z.boolean(),
  checkedAt: z.string().datetime({ offset: true }).nullable(), error: nullableText,
  stage: z.enum(["downloading", "ready"]).optional(), progress: percent.optional(),
}) satisfies z.ZodType<UpdateInfo>;

export const productUpdateStateSchema = z.object({
  stage: z.enum(["idle", "checking", "downloading", "verified", "trial", "confirmed", "bad"]),
  version: label, reason: nullableText, progress: percent.optional(),
  waitsForApplication: label.optional(),
  runnableAt: z.string().datetime({ offset: true }).optional(),
  checkedAt: z.string().datetime({ offset: true }).optional(),
  checkOutcome: z.enum(["current", "found", "too-new", "later", "refused", "needs-application"]).optional(),
});
export type ProductUpdateState = z.infer<typeof productUpdateStateSchema>;

const stoppingSchema = z.discriminatedUnion("reason", [
  z.object({ reason: z.literal("refused"), kind: z.enum([
    "foreign-hub", "port-busy", "folder-owned", "data-format", "contract",
  ]), text }),
  z.object({ reason: z.enum(["quit", "update", "restart", "cli-stop", "takeover", "fatal"]), text: text.optional(), withinMs: z.number().int().positive().optional() }),
]);
export type HostStopping = z.infer<typeof stoppingSchema>;
export const closeSchema = z.object({
  reason: z.enum(["quit", "update", "restart"]),
  deadlineMs: z.number().int().min(1).max(HOST_MAX_REQUEST_TIMEOUT_MS),
});
export type HostClose = z.infer<typeof closeSchema>;
const progressSchema = z.object({ stage: label, done: count.optional(), total: count.optional() })
  .refine(value => value.total === undefined || (value.done !== undefined && value.done <= value.total),
    "total requires done, and done must not exceed total");

const productRequests = {
  hello: z.object({ version: label, build: text, dataDir: text, dataFormat: count, url }),
  "migration.begin": z.object({ from: count, to: count }).refine(value => value.to > value.from),
  restart: z.object({ reconnect: z.enum(["load", "replay"]).optional(), reason: z.enum(["restart", "update"]) }),
  "autostart.set": z.object({ enabled: z.boolean() }),
  "awake.hold": z.object({ reason: text }),
  "awake.release": z.object({ reason: text }),
  "app-update.check": z.object({}),
  "app-update.install": z.object({}),
  "product-update.check": z.object({}),
  "product-update.apply": z.object({}),
};
const productNotifications = {
  progress: progressSchema,
  "migration.end": z.object({ format: count, backup: backupName.optional() }),
  ready: z.object({ url }),
  stopping: stoppingSchema,
  settings: z.object({ checkAppUpdates: z.boolean(), checkProductUpdates: z.boolean() }),
};
const hostRequests = { "ticket.request": z.object({}), close: closeSchema };
const hostNotifications = {
  "autostart.state": z.object({ state: autostartStateSchema }),
  "app-update.state": z.object({ state: appUpdateStateSchema }),
  "product-update.state": z.object({ state: productUpdateStateSchema }),
};
const hostReplies = {
  host: hostInfoSchema,
  ...hostNotifications,
  "migration.begin": z.object({}),
  restart: z.object({}),
  "awake.hold": z.object({}),
  "awake.release": z.object({}),
  "app-update.install": z.object({}),
  "product-update.apply": z.object({}),
};
const productReplies = { "ticket.request": z.object({ ticket: text }), close: z.object({}) };

type SchemaMap = Record<string, z.ZodType>;
type Payload<S extends z.ZodType> = z.infer<S> extends Record<string, never> ? object : z.infer<S>;
type Bodies<S extends SchemaMap> = { [T in keyof S]: { type: T } & Payload<S[T]> }[keyof S];
export interface HostEnvelope { v: 1; run: string }
export type ProductRequestBody = Bodies<typeof productRequests>;
export type ProductNotificationBody = Bodies<typeof productNotifications>;
export type HostRequestBody = Bodies<typeof hostRequests>;
export type HostNotificationBody = Bodies<typeof hostNotifications>;
export type ProductRequest = HostEnvelope & { id: string } & ProductRequestBody;
export type ProductNotification = HostEnvelope & ProductNotificationBody;
export type HostRequest = HostEnvelope & { id: string } & HostRequestBody;
export type HostNotification = HostEnvelope & HostNotificationBody;
export type HostSuccessReply = HostEnvelope & { re: string; ok: true } & Bodies<typeof hostReplies>;
export type ProductSuccessReply = HostEnvelope & { re: string; ok: true } & Bodies<typeof productReplies>;
export type Hello = z.infer<typeof productRequests.hello>;
export type HostProgress = z.infer<typeof progressSchema>;
export type HostSettings = z.infer<typeof productNotifications.settings>;

export const hostErrorSchema = z.enum(["unknown", "invalid", "not-ready", "busy", "failed", "timeout"]);
export type HostErrorCode = z.infer<typeof hostErrorSchema>;
export type HostFailureReply = HostEnvelope & { type: string; re: string; ok: false; error: HostErrorCode; text?: string };
export type HostMessage = HostRequest | HostNotification | HostSuccessReply | HostFailureReply;
export type ProductMessage = ProductRequest | ProductNotification | ProductSuccessReply | HostFailureReply;

const envelopeSchema = z.object({
  v: z.literal(HOST_CONTRACT), run: identifier, type: label,
  id: identifier.optional(), re: identifier.optional(), ok: z.boolean().optional(),
}).refine(value => value.re === undefined
  ? value.ok === undefined
  : value.id === undefined && value.ok !== undefined);
const failureSchema = z.object({ error: hostErrorSchema, text: text.optional() });

export type HostParseResult<T> = { ok: true; message: T } | {
  ok: false; reason: "stale" | "invalid" | "unknown";
  request?: { id: string; type: string };
};

function parseMessage<T>(raw: unknown, run: string, requests: SchemaMap, notifications: SchemaMap, replies: SchemaMap): HostParseResult<T> {
  const correlation = z.object({ run: identifier }).safeParse(raw);
  if (correlation.success && correlation.data.run !== run) return { ok: false, reason: "stale" };
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const envelope = parsed.data;
  const request = envelope.id === undefined ? undefined : { id: envelope.id, type: envelope.type };
  const reply = envelope.re !== undefined;
  const schemas = reply ? replies : request ? requests : notifications;
  const schema = reply && envelope.ok === false ? failureSchema
    : Object.hasOwn(schemas, envelope.type) ? schemas[envelope.type] : undefined;
  if (!schema) {
    const known = [requests, notifications, replies].some(table => Object.hasOwn(table, envelope.type));
    return { ok: false, reason: known ? "invalid" : "unknown", ...(request ? { request } : {}) };
  }
  const payload = schema.safeParse(raw);
  if (!payload.success) return { ok: false, reason: "invalid", ...(request ? { request } : {}) };
  const normalized = { v: envelope.v, run: envelope.run, type: envelope.type,
    ...(request ? { id: request.id } : {}), ...(reply ? { re: envelope.re, ok: envelope.ok } : {}) };
  return { ok: true, message: { ...normalized, ...(payload.data as object) } as T };
}

export function parseHostMessage(raw: unknown, run: string): HostParseResult<HostMessage> {
  return parseMessage(raw, run, hostRequests, hostNotifications, hostReplies);
}
export function parseProductMessage(raw: unknown, run: string): HostParseResult<ProductMessage> {
  return parseMessage(raw, run, productRequests, productNotifications, productReplies);
}

export const HOST_REPLY_TYPES: Record<ProductRequestBody["type"], HostSuccessReply["type"]> = {
  hello: "host", "migration.begin": "migration.begin", restart: "restart", "autostart.set": "autostart.state",
  "awake.hold": "awake.hold", "awake.release": "awake.release", "app-update.check": "app-update.state",
  "app-update.install": "app-update.install", "product-update.check": "product-update.state",
  "product-update.apply": "product-update.apply",
};

export function validHostRun(run: string): boolean { return identifier.safeParse(run).success; }
