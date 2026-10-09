// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { WriteObservation } from "./delivery.js";
import { connectionNotEstablished, sdkRequest, UnsupportedZepFetchContract, type ZepFetcher, type ZepFetcherArgs, type ZepRateWindow } from "./zep-sdk-fetch.js";

export class ZepWriteFailure extends Error {
  constructor(readonly observation: WriteObservation) { super("Zep write did not return a receipt"); }
}

function retryDelay(value: string | null): number | undefined {
  if (!value) return undefined;
  const delay = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isSafeInteger(delay) && Number.isSafeInteger(Date.now() + Math.max(0, delay)) ? Math.max(0, delay) : undefined;
}

export function createZepWriteFetcher(fetchFn: typeof fetch = fetch, window?: ZepRateWindow): ZepFetcher {
  return async <R>(args: ZepFetcherArgs) => {
    if (args.method !== "POST" || args.requestType !== "json" || args.maxRetries !== 0 ||
        (args.queryParameters && Object.keys(args.queryParameters).length) || !args.timeoutMs) {
      throw new UnsupportedZepFetchContract("a write is one POST of JSON with the SDK's retries off and a timeout");
    }
    const request = await sdkRequest(args);
    request.headers.set("content-type", "application/json");
    if (args.abortSignal?.aborted) throw new ZepWriteFailure({ state: "not_applied", reason: "cancelled_before_fetch" });
    const controller = new AbortController(), cancel = () => controller.abort();
    args.abortSignal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, args.timeoutMs); timer.unref?.();
    try {
      let response: Response;
      try {
        response = await fetchFn(request.url, { method: "POST", headers: request.headers, body: request.body, signal: controller.signal, redirect: "manual" });
        window?.observe(response);
      } catch (error) {
        throw new ZepWriteFailure(connectionNotEstablished(error)
          ? { state: "not_applied", reason: "connection_not_established" }
          : { state: "unknown", reason: controller.signal.aborted ? "write_interrupted" : "transport_error" });
      }
      if (!response.ok) {
        const status = response.status;
        const retryAfterMs = retryDelay(response.headers.get("retry-after"));
        void response.body?.cancel().catch(() => {});
        throw new ZepWriteFailure([408, 429].includes(status)
          ? { state: "not_applied", reason: `provider_deferred_${status}`, retryAfterMs }
          : [400, 401, 403, 422].includes(status)
            ? { state: "rejected", reason: `provider_rejected_${status}` }
            : { state: "unknown", reason: `provider_uncertain_${status}` });
      }
      return { ok: true, body: await response.json() as R, rawResponse: response };
    } finally {
      clearTimeout(timer); args.abortSignal?.removeEventListener("abort", cancel);
    }
  };
}
