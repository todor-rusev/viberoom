// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
export function parseReadMessageArgs(params: Record<string, unknown>, query = false): { seq: number; around: number; room?: string } {
  for (const key of Object.keys(params)) {
    if (!["seq", "around", "room"].includes(key)) throw new Error(`unsupported read_message argument: ${key}`);
  }
  const number = (value: unknown): unknown => query && typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
  const seq = number(params.seq);
  if (typeof seq !== "number" || !Number.isSafeInteger(seq)) throw new Error("read_message needs seq: the integer message number, the N of #N");
  const around = params.around === undefined ? 0 : number(params.around);
  if (typeof around !== "number" || !Number.isInteger(around) || around < 0 || around > 5) throw new Error("around must be an integer from 0 to 5");
  if (params.room !== undefined && (typeof params.room !== "string" || !params.room.trim() || params.room.length > 200)) {
    throw new Error("room must be a non-empty room ID or exact name (at most 200 characters)");
  }
  return { seq, around, ...(params.room !== undefined ? { room: (params.room as string).trim() } : {}) };
}
