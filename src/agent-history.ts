// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { andedTerms, type HistoryStore } from "./history-store.js";
import { NameDirectory, namesInQuery, type NameHolder } from "./name-directory.js";

export const AGENT_SEARCH_RESPONSE_BYTES = 16 * 1024;
const SNIPPET_BYTES = 800;
const HIT_BYTES = 2400;
const NEIGHBOUR_BYTES = 600;

export interface AgentSearchArgs { query: string; rooms: "this" | "all"; kinds: "chat" | "chat,system"; limit: number; author?: string }

export function parseAgentSearchArgs(params: Record<string, unknown>, http = false): AgentSearchArgs {
  const queryKey = http ? "q" : "query";
  for (const key of Object.keys(params)) if (![queryKey, "rooms", "kinds", "author", "limit"].includes(key)) throw new Error(`unsupported search parameter: ${key}`);
  const query = params[queryKey];
  if (typeof query !== "string" || !query.trim()) throw new Error("search_history needs a non-empty query");
  if (params.rooms !== undefined && params.rooms !== "this" && params.rooms !== "all") throw new Error("rooms must be this or all");
  if (params.kinds !== undefined && params.kinds !== "chat" && params.kinds !== "chat,system") throw new Error("kinds must be chat or chat,system");
  if (params.author !== undefined && typeof params.author !== "string") throw new Error("author must be a name");
  const limit = params.limit === undefined ? 3 : http ? Number(params.limit) : params.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("limit must be an integer from 1 to 10");
  return { query: query.trim(), rooms: params.rooms === "all" ? "all" : "this", kinds: params.kinds === "chat,system" ? "chat,system" : "chat", limit,
    ...(typeof params.author === "string" && params.author.trim() ? { author: params.author.trim() } : {}) };
}

function excerpt(text: string, budget: number): { text: string; truncated: boolean; bytes: number } {
  const bytes = Buffer.byteLength(JSON.stringify(text), "utf8") - 2;
  if (bytes <= budget) return { text, truncated: false, bytes };
  const suffix = budget >= 3 ? "…" : "";
  let used = Buffer.byteLength(suffix);
  let end = 0;
  for (const char of text) {
    const size = Buffer.byteLength(JSON.stringify(char), "utf8") - 2;
    if (used + size > budget) break;
    used += size;
    end += char.length;
  }
  return { text: text.slice(0, end) + suffix, truncated: true, bytes: used };
}

function emptyAdvice(hits: number, query: string): string {
  if (hits) return "";
  const together = andedTerms(query);
  return together > 1
    ? `No message holds all ${together} of these words together — a search asks for every word of it at once. Ask again with the two or three words that matter most; or widen this one with OR (one OR two), an exact phrase in quotes, NOT to leave a word out, or word* for the start of a word. `
    : "Nothing matched. Try other wording, or match the start of a word with word*. ";
}

function describeHolder(holder: NameHolder, roomName: (id: string) => string, manyRooms: boolean) {
  return {
    ...(manyRooms ? { room: holder.roomId, roomName: roomName(holder.roomId) } : {}),
    now: holder.now ?? null,
    names: holder.names.map((n) => ({ name: n.name, ...(n.first !== undefined ? { from: new Date(n.first).toISOString() } : {}), ...(n.last !== undefined ? { until: new Date(n.last).toISOString() } : {}) })),
  };
}

function nameHints(query: string, names: NameDirectory) {
  return namesInQuery(query, names).map(({ term, holder, others }) => ({
    term, participant: holder.now ?? null, formerly: others,
    hint: holder.now && holder.now.toLowerCase() !== term.toLowerCase()
      ? `${term} is now called ${holder.now}; other messages name this participant ${others.join(" or ")}: search that too, or use author for what they wrote.`
      : `Older messages name this participant ${others.join(" or ")}: search that too, or use author for what they wrote.`,
  }));
}

export function searchAgentHistory(
  store: HistoryStore | null,
  room: { id: string; name: string },
  params: Record<string, unknown>,
  reachable: () => { id: string; name: string }[] = () => [room],
  directory: (roomIds: string[]) => NameDirectory = (roomIds) => new NameDirectory(store?.nameUses(roomIds) ?? [], []),
) {
  const args = parseAgentSearchArgs(params, true), { limit } = args;
  if (!store) throw new Error("the conversation store is unavailable; history could not be searched");
  const kinds: Array<"chat" | "system"> = args.kinds === "chat,system" ? ["chat", "system"] : ["chat"];
  const shared = args.rooms === "all" ? reachable() : [];
  const searched = shared.length ? shared : [room];
  const names = new Map(searched.map((r) => [r.id, r.name]));
  const people = directory(searched.map((r) => r.id));
  const holders = args.author ? people.holders(args.author) : undefined;
  const hints = nameHints(args.query, people);
  const now = (roomId: string, id: string, then: string) => {
    const today = people.now(roomId, id);
    return today && today !== then ? { now: today } : {};
  };
  const found = store.search({
    text: args.query, rooms: searched.map((r) => r.id), kinds, authors: holders?.map((h) => ({ roomId: h.roomId, id: h.id })), limit, agentVisible: true,
    ...(searched.length > 1 ? { perRoom: Math.max(1, Math.ceil(limit / 2)) } : {}),
  });
  const context = found.hits.length ? store.agentSearchContext(found.hits[0].roomId, found.hits[0].seq, kinds) : [];
  const response = {
    truncated: false,
    results: found.hits.map((hit, index) => ({
      room: hit.roomId, roomName: names.get(hit.roomId) ?? hit.roomId, seq: hit.seq, from: hit.fromName, ...now(hit.roomId, hit.from, hit.fromName), to: hit.toNames,
      when: new Date(hit.ts).toISOString(), snippet: "", snippetTruncated: false,
      ...(hit.kind === "system" ? { kind: "system" } : {}),
      ...(index === 0 ? { context: context.map((m) => ({
        seq: m.seq, from: m.fromName, ...now(hit.roomId, m.from, m.fromName), to: m.toNames, when: new Date(m.ts).toISOString(), text: "", truncated: false,
        ...(m.kind === "system" ? { kind: "system" } : {}),
      })) } : {}),
    })),
    searched: { rooms: searched.length, messages: searched.reduce((sum, r) => sum + store.agentSearchCount(r.id, kinds), 0) },
    ...(holders ? { author: { name: args.author!, matched: holders.map((h) => describeHolder(h, (id) => names.get(id) ?? id, searched.length > 1)) } } : {}),
    ...(hints.length ? { names: hints } : {}),
    usedTrigram: found.usedTrigram,
    hint:
      emptyAdvice(found.hits.length, found.query) +
      (holders && !holders.length ? `Nobody here has been called ${args.author}; the author filter takes a participant's name, current or earlier. ` : "") +
      (holders?.some((h) => h.names.length > 1) ? "author finds what a participant wrote under every name it has borne; from is the name a message was written under, now the name its writer has today. " : "") +
      "Use read_message with seq, room (the result's room ID) and optional around (0–5) for full text; omit room for this room. " +
      (searched.length > 1
        ? `Searched ${searched.length} rooms: ${searched.map((r) => r.name).join(", ")}; each result names its room.`
        : args.rooms === "all"
          ? "Only this room is open to you; the other rooms do not share their history."
          : "Only this room is searched; pass rooms=\"all\" to include the rooms that share their history.") +
      " Recent messages are included. Context contains the top hit and up to two visible neighbours on each side. The response is capped at 16 KiB of JSON; snippetTruncated/truncated mark shortened text.",
  };
  let remaining = AGENT_SEARCH_RESPONSE_BYTES - Buffer.byteLength(JSON.stringify(response, null, 2), "utf8");
  if (remaining < 0) throw new Error("search result metadata exceeds the response budget; try a smaller limit");
  response.results.forEach((result, index) => {
    const part = excerpt(found.hits[index].snippet, Math.min(SNIPPET_BYTES, remaining));
    result.snippet = part.text;
    result.snippetTruncated = part.truncated;
    response.truncated ||= part.truncated;
    remaining -= part.bytes;
  });
  response.results[0]?.context?.forEach((result, index) => {
    const cap = context[index].seq === found.hits[0].seq ? HIT_BYTES : NEIGHBOUR_BYTES;
    const part = excerpt(context[index].text, Math.min(cap, Math.floor(remaining / (context.length - index))));
    result.text = part.text;
    result.truncated = part.truncated;
    response.truncated ||= part.truncated;
    remaining -= part.bytes;
  });
  return response;
}

export type AgentSearchResult = ReturnType<typeof searchAgentHistory>;
export interface HistorySearchReceipt {
  searchedAt: string;
  searched?: { rooms: number; messages: number };
  returned?: number;
  results?: { room: string; roomName: string; seq: number }[];
}

export function historySearchReceipt(result?: AgentSearchResult): HistorySearchReceipt {
  return { searchedAt: new Date().toISOString(), ...(result ? {
    searched: { ...result.searched }, returned: result.results.length,
    results: result.results.map(hit => ({ room: hit.room, roomName: hit.roomName, seq: hit.seq })),
  } : {}) };
}

export function historySearchTitle(result: AgentSearchResult): string {
  const scope = result.searched.rooms === 1 ? "this room" : `${result.searched.rooms} rooms`;
  const count = result.results.length;
  return `Searched ${scope} · ${count ? `${count} hit${count === 1 ? "" : "s"}` : "Nothing found"}`;
}
