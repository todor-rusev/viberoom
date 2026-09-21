// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export type Field =
  | { kind: "string"; max: number }
  | { kind: "number"; min?: number; max?: number }
  | { kind: "integer"; min?: number; max?: number }
  | { kind: "boolean" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "object"; of: Shape }
  | { kind: "list"; of: Field; items: number };

export type Shape = Record<string, Field>;

export type Value = string | number | boolean | { [name: string]: Value } | Value[];

export interface Taken {
  fields: Record<string, Value>;
  ignored: number;
}

const NEVER = new Set(["__proto__", "constructor", "prototype"]);

export function takeKnown(shape: Shape, input: unknown): Taken {
  const fields: Record<string, Value> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return { fields, ignored: 0 };
  let ignored = 0;
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    const field = Object.hasOwn(shape, name) && !NEVER.has(name) ? shape[name] : undefined;
    const took = field ? take(field, value) : null;
    if (!took) {
      ignored++;
      continue;
    }
    fields[name] = took.value;
    ignored += took.ignored;
  }
  return { fields, ignored };
}

export function asRecord(shape: Shape, input: unknown): Record<string, Value> {
  if (Object.hasOwn(shape, "ignored")) throw new Error("a record's shape may not declare `ignored`: that name belongs to the count of what was turned away");
  const taken = takeKnown(shape, input);
  return taken.ignored ? { ...taken.fields, ignored: taken.ignored } : taken.fields;
}

function take(field: Field, value: unknown): { value: Value; ignored: number } | null {
  if (field.kind === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const inside = takeKnown(field.of, value);
    return { value: inside.fields, ignored: inside.ignored };
  }
  if (field.kind === "list") {
    if (!Array.isArray(value)) return null;
    const out: Value[] = [];
    let ignored = Math.max(0, value.length - field.items);
    for (const item of value.slice(0, field.items)) {
      const took = take(field.of, item);
      if (!took) ignored++;
      else {
        out.push(took.value);
        ignored += took.ignored;
      }
    }
    return { value: out, ignored };
  }
  return fits(field, value) ? { value: value as Value, ignored: 0 } : null;
}

function fits(field: Field, value: unknown): boolean {
  if (field.kind === "boolean") return typeof value === "boolean";
  if (field.kind === "enum") return typeof value === "string" && field.values.includes(value);
  if (field.kind === "string") return typeof value === "string" && value.length <= field.max;
  if (field.kind === "object" || field.kind === "list") return false;
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (field.kind === "integer" && !Number.isInteger(value)) return false;
  if (field.min !== undefined && value < field.min) return false;
  if (field.max !== undefined && value > field.max) return false;
  return true;
}
