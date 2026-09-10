// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export const QUOTES_PER_MESSAGE = 6;
export const QUOTE_MAX_CHARS = 4000;
export const READ_AROUND_MAX = 5;

export interface QuoteInput {
  n?: number;
  seq: number;
  text: string;
}

export interface Quote {
  n: number;
  seq: number;
  from: string;
  fromName: string;
  ts: number;
  text: string;
}

export interface QuotableMessage {
  seq: number;
  from: string;
  fromName: string;
  ts: number;
  kind: "chat" | "system" | "hidden";
  text: string;
  audience?: "agents" | "human";
}

export function resolveQuotes(inputs: QuoteInput[], messages: QuotableMessage[]): Quote[] {
  const out: Quote[] = [];
  const used = new Set<number>();
  let next = 1;
  for (const input of inputs.slice(0, QUOTES_PER_MESSAGE)) {
    const seq = Number(input?.seq);
    const source = Number.isInteger(seq) ? messages.find((m) => m.seq === seq) : undefined;
    if (!source) throw new Error(`quoted message #${String(input?.seq)} is not in this room`);
    if (source.kind !== "chat") throw new Error(`message #${seq} is not a chat message; only those can be quoted`);
    const text = String(input.text ?? "").trim().slice(0, QUOTE_MAX_CHARS) || source.text.trim().slice(0, QUOTE_MAX_CHARS);
    if (!text) throw new Error(`message #${seq} has no text to quote`);
    const wanted = Number(input.n);
    let n = Number.isInteger(wanted) && wanted > 0 && !used.has(wanted) ? wanted : 0;
    if (!n) {
      while (used.has(next)) next += 1;
      n = next;
    }
    used.add(n);
    out.push({ n, seq, from: source.from, fromName: source.fromName, ts: source.ts, text });
  }
  return out;
}

export function visibleToAgents<T extends { kind: QuotableMessage["kind"]; audience?: QuotableMessage["audience"] }>(message: T): boolean {
  return message.kind !== "hidden" && message.audience !== "human";
}

export function agentReadableWindow<T extends { seq: number; kind: QuotableMessage["kind"]; audience?: QuotableMessage["audience"] }>(
  messages: T[],
  seq: number,
  around: number,
): { message: T; before: T[]; after: T[] } | null {
  const visible = messages.filter(visibleToAgents);
  const index = visible.findIndex((m) => m.seq === seq);
  if (index < 0) return null;
  const span = Math.min(READ_AROUND_MAX, Math.max(0, Math.floor(Number(around) || 0)));
  return { message: visible[index], before: visible.slice(Math.max(0, index - span), index), after: visible.slice(index + 1, index + 1 + span) };
}
