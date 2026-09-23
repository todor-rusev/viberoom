// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export interface NameUse { roomId: string; id: string; name: string; first: number; last: number }
export interface CurrentName { roomId: string; id: string; name: string }

export interface NameHolder {
  roomId: string;
  id: string;
  now?: string;
  names: { name: string; first?: number; last?: number }[];
}

const fold = (name: string): string => name.toLowerCase();
const key = (roomId: string, id: string): string => `${roomId}\u0000${id}`;
const time = (t: number | undefined): number => t ?? Infinity;

export class NameDirectory {
  private readonly byParticipant = new Map<string, NameHolder>();

  constructor(uses: Iterable<NameUse>, current: Iterable<CurrentName>) {
    for (const use of uses) {
      const holder = this.holder(use.roomId, use.id);
      const same = holder.names.find((n) => fold(n.name) === fold(use.name));
      if (same) {
        same.first = Math.min(time(same.first), use.first);
        same.last = Math.max(same.last ?? -Infinity, use.last);
      } else holder.names.push({ name: use.name, first: use.first, last: use.last });
    }
    for (const c of current) {
      const holder = this.holder(c.roomId, c.id);
      holder.now = c.name;
      if (!holder.names.some((n) => fold(n.name) === fold(c.name))) holder.names.push({ name: c.name });
    }
    for (const holder of this.byParticipant.values()) holder.names.sort((a, b) => time(a.first) - time(b.first) || time(a.last) - time(b.last));
  }

  private holder(roomId: string, id: string): NameHolder {
    let holder = this.byParticipant.get(key(roomId, id));
    if (!holder) this.byParticipant.set(key(roomId, id), (holder = { roomId, id, names: [] }));
    return holder;
  }

  holders(name: string): NameHolder[] {
    const wanted = fold(name.trim());
    return [...this.byParticipant.values()].filter((h) => h.names.some((n) => fold(n.name) === wanted));
  }

  now(roomId: string, id: string): string | undefined {
    return this.byParticipant.get(key(roomId, id))?.now;
  }

  formerNames(roomId: string, id: string): string[] {
    const holder = this.byParticipant.get(key(roomId, id));
    if (!holder) return [];
    return holder.names
      .filter((n) => !holder.now || fold(n.name) !== fold(holder.now))
      .sort((a, b) => time(b.last) - time(a.last))
      .map((n) => n.name);
  }
}

const QUERY_OPERATORS = new Set(["AND", "OR", "NOT", "NEAR"]);

export function queryWords(query: string): string[] {
  const words = new Map<string, string>();
  for (const raw of query.replace(/"/g, " ").split(/\s+/)) {
    const word = raw.replace(/^@/, "").replace(/\*$/, "");
    if (word && !QUERY_OPERATORS.has(word) && !words.has(word.toLowerCase())) words.set(word.toLowerCase(), word);
  }
  return [...words.values()];
}

export interface NameInQuery { term: string; holder: NameHolder; others: string[] }

export function namesInQuery(query: string, names: NameDirectory): NameInQuery[] {
  return queryWords(query).flatMap((term) =>
    names.holders(term)
      .filter((holder) => holder.names.length > 1)
      .map((holder) => ({ term, holder, others: holder.names.map((n) => n.name).filter((n) => n.toLowerCase() !== term.toLowerCase()) })));
}
