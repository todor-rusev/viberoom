// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { RequestTraceRing, TRACE_CLIENT_LIMIT, TRACE_ID_HEADER, TRACE_REPORT_PATH, TRACE_SINCE_HEADER, traceOperation, type RequestTrace, type TraceOutcome } from "./mcp-diagnostics.js";

interface HubResult { ok: boolean; status: number; body: Record<string, unknown> }
interface HttpOptions { fetch?: typeof fetch; timeoutMs?: number; reportTimeoutMs?: number }

function deadline(milliseconds: number) {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      const error = new DOMException("The operation was aborted due to timeout", "TimeoutError");
      controller.abort(error);
      reject(error);
    }, milliseconds);
  });
  return {
    signal: controller.signal,
    get timedOut() { return timedOut; },
    wait: <T>(operation: Promise<T>) => Promise.race([operation, expired]),
    dispose: () => clearTimeout(timer),
  };
}

export class McpHttpClient {
  readonly diagnostics = new RequestTraceRing(TRACE_CLIENT_LIMIT);
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly reportTimeoutMs: number;
  private reportPending = false;
  private failureGeneration = 0;
  private reporting: Promise<void> | undefined;

  constructor(baseUrl: string, private readonly token: string, options: HttpOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.reportTimeoutMs = options.reportTimeoutMs ?? 2_000;
  }

  private acceptClear(response: Response): void {
    const since = response.headers.get(TRACE_SINCE_HEADER);
    if (since && /^\d+$/.test(since)) this.diagnostics.discardBefore(Number(since));
  }

  async request(path: string, init?: RequestInit): Promise<HubResult> {
    if (!this.baseUrl || !this.token) return { ok: false, status: 0, body: { error: "viberoom address or token missing" } };
    const requestId = randomUUID();
    const startedAt = Date.now(), started = performance.now();
    const operation = traceOperation(path), method = (init?.method ?? "GET").toUpperCase();
    const trace: RequestTrace | undefined = operation && (method === "GET" || method === "POST")
      ? { requestId, side: "client", operation, method, startedAt, outcome: "pending" } : undefined;
    if (trace) this.diagnostics.put(trace);
    const finish = (outcome: TraceOutcome, status?: number) => {
      if (trace) this.diagnostics.put({ ...trace, outcome, durationMs: performance.now() - started, ...(status !== undefined ? { status } : {}) });
      if (outcome !== "ok") { this.failureGeneration++; this.reportPending = true; }
    };
    const timeout = deadline(this.timeoutMs);
    try {
      const headers = new Headers(init?.headers);
      headers.set(TRACE_ID_HEADER, requestId);
      const response = await timeout.wait(this.fetcher(`${this.baseUrl}${path}`, { ...init, headers, signal: timeout.signal }));
      this.acceptClear(response);
      let body: Record<string, unknown> = {};
      try {
        const parsed: unknown = await timeout.wait(response.json());
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid response shape");
        body = parsed as Record<string, unknown>;
      } catch {
        finish(timeout.timedOut ? "timeout" : "invalid_json", response.status);
        return { ok: false, status: response.status, body: { code: "unconfirmed_result", error: "The room response could not be read. Check the outcome before retrying a write." } };
      }
      finish(response.ok ? "ok" : "http_error", response.status);
      if (response.ok) this.maybeReport();
      return { ok: response.ok, status: response.status, body };
    } catch (error) {
      finish(timeout.timedOut ? "timeout" : "network_error");
      return { ok: false, status: 0, body: { error: `the room is unreachable: ${error instanceof Error ? error.message : String(error)}` } };
    } finally { timeout.dispose(); }
  }

  private maybeReport(): void {
    if (!this.reportPending || this.reporting) return;
    const generation = this.failureGeneration;
    this.reporting = this.report(generation).finally(() => { this.reporting = undefined; });
  }

  private async report(generation: number): Promise<void> {
    const timeout = deadline(this.reportTimeoutMs);
    try {
      const response = await timeout.wait(this.fetcher(`${this.baseUrl}${TRACE_REPORT_PATH}`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: timeout.signal,
        body: JSON.stringify({ token: this.token, traces: this.diagnostics.snapshot().traces.filter(trace => trace.outcome !== "pending") }),
      }));
      this.acceptClear(response);
      if (response.body) await timeout.wait(response.body.cancel());
      if (response.ok && generation === this.failureGeneration) this.reportPending = false;
    } catch {
    } finally { timeout.dispose(); }
  }

  whenIdle(): Promise<void> { return this.reporting ?? Promise.resolve(); }
}
