// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
export const TRACE_ID_HEADER = "x-viberoom-request-id";
export const TRACE_SINCE_HEADER = "x-viberoom-diagnostics-since";
export const TRACE_REPORT_PATH = "/api/mcp/diagnostics";
export const TRACE_CLIENT_LIMIT = 128;
export const TRACE_HUB_LIMIT = 512;
const OPERATIONS = ["ready", "skill", "skills", "attach", "room", "looks", "search", "check-messages", "message", "design/lint", "templates", "propose", "looks/lint", "looks/create", "looks/propose"] as const;
export type TraceOperation = typeof OPERATIONS[number];
export type TraceOutcome = "pending" | "ok" | "http_error" | "network_error" | "timeout" | "invalid_json" | "aborted";
export interface RequestTrace {
  requestId: string; side: "client" | "server"; operation: TraceOperation;
  method: "GET" | "POST"; startedAt: number; outcome: TraceOutcome;
  durationMs?: number; status?: number;
}
export const validTraceId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function traceOperation(path: string): TraceOperation | null {
  const pathname = path.split("?", 1)[0];
  return OPERATIONS.find(operation => pathname === `/api/mcp/${operation}`) ?? null;
}

export class RequestTraceRing {
  private readonly rows = new Map<string, RequestTrace>();
  private omitted = 0;
  private since = 0;
  constructor(readonly limit = TRACE_HUB_LIMIT) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > TRACE_HUB_LIMIT) throw new Error("invalid diagnostic capacity");
  }
  get clearedAt(): number { return this.since; }
  put(row: RequestTrace): void {
    if (row.startedAt <= this.since) return;
    const key = `${row.side}:${row.requestId}`;
    this.rows.set(key, { requestId: row.requestId, side: row.side, operation: row.operation, method: row.method,
      startedAt: row.startedAt, outcome: row.outcome, ...(row.durationMs !== undefined ? { durationMs: row.durationMs } : {}),
      ...(row.status !== undefined ? { status: row.status } : {}) });
    while (this.rows.size > this.limit) { this.rows.delete(this.rows.keys().next().value!); this.omitted++; }
  }
  clear(at = Date.now()): void { this.since = Math.max(this.since, at); this.rows.clear(); this.omitted = 0; }
  discardBefore(at: number): void {
    if (!Number.isSafeInteger(at) || at <= this.since) return;
    this.since = at;
    for (const [key, row] of this.rows) if (row.startedAt <= at) this.rows.delete(key);
  }
  snapshot(): { limit: number; dropped: number; clearedAt: number; traces: RequestTrace[] } {
    return { limit: this.limit, dropped: this.omitted, clearedAt: this.since, traces: [...this.rows.values()].map(row => ({ ...row })) };
  }
}

export function parseClientTraces(value: unknown, now = Date.now()): RequestTrace[] {
  if (!Array.isArray(value) || value.length > TRACE_CLIENT_LIMIT) throw new Error("invalid diagnostic report size");
  const allowed = ["requestId", "side", "operation", "method", "startedAt", "outcome", "durationMs", "status"];
  const outcomes: TraceOutcome[] = ["pending", "ok", "http_error", "network_error", "timeout", "invalid_json", "aborted"];
  return value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(key => !allowed.includes(key))) throw new Error("invalid diagnostic fields");
    const row = raw as RequestTrace;
    if (!validTraceId(row.requestId) || row.side !== "client" || !OPERATIONS.includes(row.operation)
      || !["GET", "POST"].includes(row.method) || !Number.isSafeInteger(row.startedAt) || row.startedAt < 0 || row.startedAt > now + 60_000
      || !outcomes.includes(row.outcome) || (row.durationMs !== undefined && (!Number.isFinite(row.durationMs) || row.durationMs < 0 || row.durationMs > 86_400_000))
      || (row.status !== undefined && (!Number.isSafeInteger(row.status) || row.status < 100 || row.status > 599))) throw new Error("invalid diagnostic values");
    return { requestId: row.requestId, side: "client", operation: row.operation, method: row.method, startedAt: row.startedAt,
      outcome: row.outcome, ...(row.durationMs !== undefined ? { durationMs: row.durationMs } : {}), ...(row.status !== undefined ? { status: row.status } : {}) };
  });
}
