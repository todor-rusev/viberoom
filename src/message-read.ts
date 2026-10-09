// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
export function parseReadMessageArgs(params: Record<string, unknown>, query = false): { seq?: number; message_id?: string; version?: string; around: number; room?: string; copy?: string } {
  for (const key of Object.keys(params)) {
    if (!["seq", "around", "room", "copy", "message_id", "version"].includes(key)) throw new Error(`unsupported read_message argument: ${key}`);
  }
  const number = (value: unknown): unknown => query && typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
  const seq = number(params.seq);
  if ((params.seq === undefined) === (params.message_id === undefined)) throw new Error("read_message needs exactly one of seq or message_id");
  if (params.seq !== undefined && (typeof seq !== "number" || !Number.isSafeInteger(seq))) throw new Error("read_message needs seq: the integer message number, the N of #N");
  if (params.message_id !== undefined && (typeof params.message_id !== "string" || !params.message_id.trim() || params.message_id.length > 200)) throw new Error("message_id must be a stable message ID (at most 200 characters)");
  if (params.version !== undefined && (params.message_id === undefined || typeof params.version !== "string" || !/^sha256:[a-f0-9]{64}$/.test(params.version))) throw new Error("version requires message_id and its sha256 content fingerprint");
  if (params.message_id !== undefined && params.copy !== undefined) throw new Error("copy is only used with seq; message_id is stable across copies");
  const around = params.around === undefined ? 0 : number(params.around);
  if (typeof around !== "number" || !Number.isInteger(around) || around < 0 || around > 5) throw new Error("around must be an integer from 0 to 5");
  if (params.room !== undefined && (typeof params.room !== "string" || !params.room.trim() || params.room.length > 200)) {
    throw new Error("room must be a non-empty room ID or exact name (at most 200 characters)");
  }
  if (params.copy !== undefined && (typeof params.copy !== "string" || !params.copy.trim() || params.copy.length > 100)) {
    throw new Error("copy must be the name of the computer whose number seq is (at most 100 characters)");
  }
  return { ...(seq !== undefined ? { seq: seq as number } : {}), ...(params.message_id !== undefined ? { message_id: (params.message_id as string).trim() } : {}), ...(params.version !== undefined ? { version: params.version as string } : {}), around, ...(params.room !== undefined ? { room: (params.room as string).trim() } : {}), ...(params.copy !== undefined ? { copy: (params.copy as string).trim() } : {}) };
}
