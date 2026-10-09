// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { ZepClient } from "@getzep/zep-cloud";
import type { ProviderRateWindow } from "./provider.js";

export type ZepFetcher = NonNullable<NonNullable<ConstructorParameters<typeof ZepClient>[0]>["fetcher"]>;
export type ZepFetcherArgs = Parameters<ZepFetcher>[0];

export class UnsupportedZepFetchContract extends Error {
  constructor(what: string) { super(`Unsupported Zep fetch contract: ${what}`); }
}

export async function sdkRequest(args: ZepFetcherArgs): Promise<{ url: string; headers: Headers; body: string | undefined }> {
  if ((args.requestType ?? "json") !== "json") throw new UnsupportedZepFetchContract(`request type ${args.requestType}`);
  if ((args.responseType ?? "json") !== "json") throw new UnsupportedZepFetchContract(`response type ${args.responseType}`);
  if (args.maxRetries !== undefined && args.maxRetries !== 0) throw new UnsupportedZepFetchContract("the SDK's own retries");
  const url = new URL(args.url);
  for (const [key, value] of Object.entries(args.queryParameters ?? {})) {
    if (value === null || value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) {
      if (typeof one !== "string") throw new UnsupportedZepFetchContract(`query parameter ${key}`);
      url.searchParams.append(key, one);
    }
  }
  const headers = new Headers();
  for (const [key, supplier] of Object.entries(args.headers ?? {})) {
    const value = await (typeof supplier === "function" ? supplier() : supplier);
    if (value !== undefined) headers.set(key, value);
  }
  const body = args.body === undefined ? undefined : JSON.stringify(args.body);
  if (body !== undefined) headers.set("content-type", "application/json");
  return { url: url.href, headers, body };
}

export function connectionNotEstablished(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 8) return false;
  const e = error as { code?: string; syscall?: string; cause?: unknown; errors?: unknown[] };
  if (Array.isArray(e.errors)) return e.errors.length > 0 && e.errors.every(child => connectionNotEstablished(child, depth + 1));
  if (e.code === "UND_ERR_CONNECT_TIMEOUT") return true;
  if (e.syscall === "getaddrinfo" && ["ENOTFOUND", "EAI_AGAIN"].includes(e.code ?? "")) return true;
  if (e.syscall === "connect" && ["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "ETIMEDOUT"].includes(e.code ?? "")) return true;
  return connectionNotEstablished(e.cause, depth + 1);
}

export function connectionClosedBeforeResponse(error: unknown, depth = 0): boolean {
  if (error instanceof ConnectionClosedBeforeResponse) return true;
  if (!error || typeof error !== "object" || depth > 8) return false;
  const e = error as { code?: string; syscall?: string; cause?: unknown; errors?: unknown[] };
  if (Array.isArray(e.errors) || e.syscall === "connect" || e.syscall === "getaddrinfo") return false;
  if (["UND_ERR_SOCKET", "ECONNRESET", "EPIPE"].includes(e.code ?? "")) return true;
  return connectionClosedBeforeResponse(e.cause, depth + 1);
}

export class ConnectionClosedBeforeResponse extends Error {
  readonly code = "connection_closed_before_response";
  constructor() { super("connection closed before response"); this.name = "ConnectionClosedBeforeResponse"; }
}

export function zepReadRequest(method: string, url: string): boolean {
  if (method === "GET") return true;
  if (method !== "POST") return false;
  const path = new URL(url).pathname;
  return /\/graph\/(?:episodes|node|edge)\/graph\/[^/]+$/.test(path) || /\/graph\/search$/.test(path);
}

export function rateLimitWords(error: unknown): string {
  const headers = (error as { rawResponse?: { headers?: Headers } } | null)?.rawResponse?.headers;
  if (!headers || typeof headers.get !== "function") return "";
  const { limit, remaining, resetAt, retryAfterMs } = rateWindowNumbers(headers);
  const words: string[] = [];
  if (retryAfterMs !== null) words.push(`retry after ${retryAfterMs / 1000} s`);
  if (limit !== null || remaining !== null) words.push(`${remaining ?? "?"} of ${limit ?? "?"} requests left this minute`);
  if (resetAt !== null) words.push(`window resets at ${new Date(resetAt).toISOString().slice(11, 19)} UTC`);
  return words.length ? `; ${words.join(", ")}` : "";
}

export function rateWindowNumbers(headers: Headers): Omit<ProviderRateWindow, "status" | "at"> {
  const number = (name: string): number | null => { const value = headers.get(name); return value !== null && /^\d+$/.test(value.trim()) ? Number(value.trim()) : null; };
  const reset = number("x-ratelimit-reset"), retryAfter = number("retry-after");
  return { limit: number("x-ratelimit-limit"), remaining: number("x-ratelimit-remaining"),
    resetAt: reset === null ? null : reset * 1000, retryAfterMs: retryAfter === null ? null : retryAfter * 1000 };
}

export class ZepRateWindow {
  private latest: ProviderRateWindow | null = null;
  constructor(private readonly now: () => number = Date.now) {}
  observe(response: { status: number; headers: Headers }): void {
    const numbers = rateWindowNumbers(response.headers);
    if (Object.values(numbers).every(value => value === null)) return;
    this.latest = { ...numbers, status: response.status, at: this.now() };
  }
  get(): ProviderRateWindow | null { return this.latest ? { ...this.latest } : null; }
}

export const READ_RETRY_WAIT_MS = 500;
export const READ_RETRY_AFTER_MAX_MS = 5_000;
export function retryAfterMs(headers: Headers): number | null {
  const value = headers.get("retry-after");
  return value !== null && /^\d+$/.test(value.trim()) ? Number(value.trim()) * 1000 : null;
}
function readRetryWait(status: number, headers: Headers): number | null {
  if (status === 408 || status >= 500) return READ_RETRY_WAIT_MS;
  if (status !== 429) return null;
  const wait = retryAfterMs(headers);
  return wait !== null && wait <= READ_RETRY_AFTER_MAX_MS ? wait : null;
}
const realSleep = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
  signal.addEventListener("abort", onAbort, { once: true });
});

const noResponse = (url: string) => ({ headers: new Headers(), redirected: false, status: 0, statusText: "", type: "error" as const, url });

export function createZepReadFetcher(fetchFn: typeof fetch = fetch, sleep: (ms: number, signal: AbortSignal) => Promise<void> = realSleep, window?: ZepRateWindow): ZepFetcher {
  return async <R>(args: ZepFetcherArgs) => {
    const request = await sdkRequest(args);
    const controller = new AbortController(), cancel = () => controller.abort();
    let timedOut = false;
    args.abortSignal?.addEventListener("abort", cancel, { once: true });
    const timer = args.timeoutMs ? setTimeout(() => { timedOut = true; controller.abort(); }, args.timeoutMs) : undefined;
    timer?.unref?.();
    try {
      for (let asked = 1; ; asked++) {
        let response: Response;
        try {
          response = await fetchFn(request.url, { method: args.method, headers: request.headers, body: request.body, signal: controller.signal, redirect: "manual" });
        } catch (error) {
          if (controller.signal.aborted) return { ok: false, error: timedOut ? { reason: "timeout" } : { reason: "unknown", errorMessage: "The user aborted a request" }, rawResponse: noResponse(request.url) };
          if (asked === 1 && zepReadRequest(args.method, request.url) && connectionClosedBeforeResponse(error)) continue;
          return { ok: false, error: { reason: "unknown", errorMessage: error instanceof Error ? error.message : String(error) }, rawResponse: noResponse(request.url) };
        }
        window?.observe(response);
        const text = await response.text();
        let body: unknown;
        if (text.length) {
          try { body = JSON.parse(text); }
          catch { if (response.ok) return { ok: false, error: { reason: "non-json", statusCode: response.status, rawBody: text }, rawResponse: response }; }
        }
        if (!response.ok) {
          const wait = asked === 1 && zepReadRequest(args.method, request.url) ? readRetryWait(response.status, response.headers) : null;
          if (wait !== null) {
            try { await sleep(wait, controller.signal); }
            catch { return { ok: false, error: timedOut ? { reason: "timeout" } : { reason: "unknown", errorMessage: "The user aborted a request" }, rawResponse: response }; }
            continue;
          }
          return { ok: false, error: { reason: "status-code", statusCode: response.status, body: body ?? text }, rawResponse: response };
        }
        return { ok: true, body: body as R, rawResponse: response };
      }
    } finally {
      clearTimeout(timer); args.abortSignal?.removeEventListener("abort", cancel);
    }
  };
}
