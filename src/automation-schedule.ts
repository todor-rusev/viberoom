// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { CronExpressionParser } from "cron-parser";

export type AutomationSchedule =
  | { kind: "once"; at: number }
  | { kind: "interval"; minutes: number }
  | { kind: "cron"; expression: string; timeZone: string }
  | { kind: "event"; event: "first-human-message" | "room-start"; timeZone: string };

export interface AutomationDefinition {
  name: string;
  action: "reminder" | "agent";
  text: string;
  targetId: string | null;
  schedule: AutomationSchedule;
  enabled: boolean;
  catchUp: "once" | "skip";
  wakeOffline: boolean;
  maxMinutes: number;
}

export function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object.");
  for (const key of Object.keys(value)) if (!fields.includes(key)) throw new Error(`Unknown field: ${key}`);
  return value as Record<string, unknown>;
}

export function automationRequest(raw: unknown, action: string, agent = false): Record<string, unknown> {
  const allowed = action === "save" || action === "propose" ? ["definition", "id", "revision", ...(agent ? ["token", "why"] : [])]
    : action === "preview" ? ["schedule"] : action === "resolve" ? ["id", "apply"] : action === "delete" || action === "run" ? ["id", "revision"] : ["id"];
  const value = object(raw, allowed);
  const optionalId = action === "save" || action === "propose";
  if (action !== "preview" && (!optionalId || value.id !== undefined)) {
    text(value.id, "Automation ID", 100);
    if (value.id !== String(value.id).trim()) throw new Error("Use the exact automation ID.");
  }
  if (action === "delete" || action === "run" || optionalId && value.id !== undefined) {
    if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1) throw new Error("Include the current automation revision.");
  } else if (value.revision !== undefined) throw new Error("A revision requires an existing automation ID.");
  if (action === "resolve" && typeof value.apply !== "boolean") throw new Error("Apply must be true or false.");
  if (agent) text(value.why, "Proposal reason", 1000);
  return value;
}

function text(value: unknown, label: string, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit) throw new Error(`${label} must contain 1–${limit} characters.`);
  return value.trim();
}

export function timeZone(value: unknown): string {
  const zone = text(value, "Time zone", 100);
  try { return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone; }
  catch { throw new Error("Choose a valid time zone, such as Europe/Sofia."); }
}

export function dayInZone(at: number, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  return ["year", "month", "day"].map(key => parts.find(p => p.type === key)!.value).join("-");
}

export function parseSchedule(raw: unknown, now = Date.now(), future = true): AutomationSchedule {
  const value = object(raw, ["kind", "at", "minutes", "expression", "timeZone", "event"]);
  if (value.kind === "once") {
    object(raw, ["kind", "at"]);
    let at = typeof value.at === "number" ? value.at : NaN;
    if (typeof value.at === "string") {
      const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/.exec(value.at);
      if (match) {
        const [, year, month, day, hour, minute, second] = match;
        const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`);
        if (Number.isFinite(calendar.getTime()) && calendar.toISOString().startsWith(`${year}-${month}-${day}T`) && Number(hour) < 24 && Number(minute) < 60 && Number(second ?? 0) < 60) at = Date.parse(value.at);
      }
    }
    if (!Number.isSafeInteger(at) || at < 0 || at > 8.64e15 || (future && at <= now)) throw new Error("Choose a future date and time with an explicit UTC offset.");
    return { kind: "once", at };
  }
  if (value.kind === "interval") {
    object(raw, ["kind", "minutes"]);
    if (!Number.isSafeInteger(value.minutes) || Number(value.minutes) < 1 || Number(value.minutes) > 525600) throw new Error("Choose an interval from 1 to 525600 whole minutes.");
    return { kind: "interval", minutes: Number(value.minutes) };
  }
  if (value.kind === "cron") {
    object(raw, ["kind", "expression", "timeZone"]);
    const expression = text(value.expression, "Cron expression", 120).replace(/\s+/g, " ");
    if (expression.split(" ").length !== 5 || /H/i.test(expression.replace(/THU/gi, ""))) throw new Error("Use five cron fields (minute hour day month weekday), without randomized H values.");
    const zone = timeZone(value.timeZone);
    try { CronExpressionParser.parse(expression, { currentDate: now, tz: zone }).next(); }
    catch { throw new Error("This cron expression has no valid next occurrence."); }
    return { kind: "cron", expression, timeZone: zone };
  }
  if (value.kind === "event") {
    object(raw, ["kind", "event", "timeZone"]);
    if (value.event !== "first-human-message" && value.event !== "room-start") throw new Error("Choose a supported room event.");
    return { kind: "event", event: value.event, timeZone: timeZone(value.timeZone) };
  }
  throw new Error("Choose a schedule.");
}

export function parseAutomation(raw: unknown, now = Date.now(), future = true): AutomationDefinition {
  const v = object(raw, ["name", "action", "text", "targetId", "schedule", "enabled", "catchUp", "wakeOffline", "maxMinutes"]);
  if (v.action !== "reminder" && v.action !== "agent") throw new Error("Choose a reminder or a vibemate task.");
  if (typeof v.enabled !== "boolean" || typeof v.wakeOffline !== "boolean") throw new Error("Enabled and wakeOffline must be true or false.");
  if (v.catchUp !== "once" && v.catchUp !== "skip") throw new Error("Choose whether missed work runs once or is skipped.");
  if (!Number.isInteger(v.maxMinutes) || Number(v.maxMinutes) < 1 || Number(v.maxMinutes) > 1440) throw new Error("The run limit must be 1–1440 whole minutes.");
  const targetId = v.action === "agent" ? text(v.targetId, "Vibemate", 100) : null;
  if (targetId === "human") throw new Error("Choose a vibemate, or use a reminder.");
  if (v.action === "reminder" && v.targetId != null) throw new Error("A reminder has no vibemate recipient.");
  return { name: text(v.name, "Name", 100), action: v.action, text: text(v.text, "Task", 8000), targetId,
    schedule: parseSchedule(v.schedule, now, future), enabled: v.enabled, catchUp: v.catchUp,
    wakeOffline: v.wakeOffline, maxMinutes: Number(v.maxMinutes) };
}

export function nextOccurrence(schedule: AutomationSchedule, after: number, anchor: number): number | null {
  if (schedule.kind === "event") return null;
  if (schedule.kind === "once") return schedule.at > after ? schedule.at : null;
  if (schedule.kind === "interval") {
    const step = schedule.minutes * 60000;
    return anchor + Math.max(1, Math.floor((after - anchor) / step) + 1) * step;
  }
  return CronExpressionParser.parse(schedule.expression, { currentDate: after, tz: schedule.timeZone }).next().getTime();
}

export function previewSchedule(schedule: AutomationSchedule, now: number, anchor = now): number[] {
  const result: number[] = [];
  let after = now;
  for (let i = 0; i < 3; i++) {
    const next = nextOccurrence(schedule, after, anchor);
    if (next === null) break;
    result.push(next); after = next;
  }
  return result;
}
