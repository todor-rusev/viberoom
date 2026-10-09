// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import type { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { observe, type IngestionObserver } from "./ingestion-debug.js";
import { chatCompletionsUrl } from "./chat-endpoint.js";

export interface SieveEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export interface SieveCall<T> {
  label: string;
  system: string;
  user: string;
  schemaName: string;
  shapeName: string;
  schema: Record<string, unknown>;
  parse: z.ZodType<T>;
  reasoningEffort?: ReasoningEffort;
  observe?: IngestionObserver;
}

export const REASONING_EFFORTS = ["low", "medium", "high"] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];

export function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}

const refusesEffort = new Set<string>();

const REFUSED_AS_WRITTEN = new Set([400, 422]);

export async function askSieve<T>(endpoint: SieveEndpoint, call: SieveCall<T>): Promise<T> {
  const clock = AbortSignal.timeout(endpoint.timeoutMs ?? 60_000);
  const tell = (kind: string, data: unknown) => {
    if (!call.observe) return;
    const safe = JSON.parse(JSON.stringify(data, (_key, value: unknown) => typeof value === "string" && endpoint.apiKey
      ? value.split(endpoint.apiKey).join("[credential redacted]") : value)) as unknown;
    observe(call.observe, { kind, data: safe });
  };
  const post = async (effort: ReasoningEffort | undefined): Promise<{ response: Response; requestId: string }> => {
    const requestId = randomUUID();
    const body = JSON.stringify({
      model: endpoint.model,
      messages: [{ role: "system", content: call.system }, { role: "user", content: call.user }],
      response_format: { type: "json_schema", json_schema: { name: call.schemaName, strict: true, schema: call.schema } },
      ...(effort ? { reasoning_effort: effort } : {}),
    });
    if (call.observe) tell("sieve.request", { requestId, instructionHash: createHash("sha256").update(JSON.stringify([call.system, call.schema])).digest("hex"), body: JSON.parse(body) });
    try {
      const response = await fetch(chatCompletionsUrl(endpoint.baseUrl), {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${endpoint.apiKey}` },
        signal: clock, body,
      });
      return { response, requestId };
    } catch (error) {
      tell("sieve.error", { requestId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
  const read = async ({ response, requestId }: Awaited<ReturnType<typeof post>>): Promise<string> => {
    try {
      const raw = await response.text();
      tell("sieve.response", { requestId, status: response.status, body: raw });
      return raw;
    } catch (error) {
      tell("sieve.error", { requestId, status: response.status, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
  const which = `${endpoint.baseUrl} ${endpoint.model}`;
  const effort = call.reasoningEffort && !refusesEffort.has(which) ? call.reasoningEffort : undefined;
  let received = await post(effort);
  if (effort && REFUSED_AS_WRITTEN.has(received.response.status)) {
    if (call.observe) void read(received).catch(() => {});
    else await received.response.body?.cancel().catch(() => {});
    received = await post(undefined);
    if (received.response.ok) refusesEffort.add(which);
  }
  const { response } = received;
  if (!response.ok) {
    const body = await read(received).catch(() => "");
    throw new Error(`${call.label}: ${endpoint.model} answered ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  const raw = await read(received);
  try {
    const payload = JSON.parse(raw) as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error(`${call.label}: the model returned no content`);
    const parsed = call.parse.safeParse(JSON.parse(content));
    if (!parsed.success) throw new Error(`${call.label}: the model broke the ${call.shapeName} (${parsed.error.issues[0]?.message})`);
    return parsed.data;
  } catch (error) {
    tell("sieve.invalid", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
