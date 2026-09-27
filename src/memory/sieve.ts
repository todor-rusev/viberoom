// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import type { z } from "zod";

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
  const post = (effort: ReasoningEffort | undefined): Promise<Response> => fetch(new URL("chat/completions", endpoint.baseUrl.endsWith("/") ? endpoint.baseUrl : endpoint.baseUrl + "/"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${endpoint.apiKey}` },
    signal: clock,
    body: JSON.stringify({
      model: endpoint.model,
      messages: [{ role: "system", content: call.system }, { role: "user", content: call.user }],
      response_format: { type: "json_schema", json_schema: { name: call.schemaName, strict: true, schema: call.schema } },
      ...(effort ? { reasoning_effort: effort } : {}),
    }),
  });
  const which = `${endpoint.baseUrl} ${endpoint.model}`;
  const effort = call.reasoningEffort && !refusesEffort.has(which) ? call.reasoningEffort : undefined;
  let response = await post(effort);
  if (effort && REFUSED_AS_WRITTEN.has(response.status)) {
    await response.body?.cancel().catch(() => {});
    response = await post(undefined);
    if (response.ok) refusesEffort.add(which);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${call.label}: ${endpoint.model} answered ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error(`${call.label}: the model returned no content`);
  const parsed = call.parse.safeParse(JSON.parse(content));
  if (!parsed.success) throw new Error(`${call.label}: the model broke the ${call.shapeName} (${parsed.error.issues[0]?.message})`);
  return parsed.data;
}
