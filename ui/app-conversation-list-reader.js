// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create({ window: view = root, signal, current, rowsOf, stampOf, dayLabel, converted }) {
    signal?.throwIfAborted();
    const lifetime = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let disposed = false, epochs = new WeakMap(), caches = new WeakMap();
    const STOP = Symbol("list rows changed");
    lifetime.own(() => { disposed = true; });
    function cellOf(record) {
      let cell = epochs.get(record);
      if (!cell) { cell = { value: 0 }; epochs.set(record, cell); }
      return cell;
    }
    function context() {
      if (disposed) return undefined;
      const value = current();
      return !disposed && value?.record && value.roomIdentity && value.held() && !disposed ? value : undefined;
    }
    function currentFacts() {
      const value = context();
      return value ? Object.freeze({ roomIdentity: value.roomIdentity, search: value.search, drawing: value.drawing,
        generation: cellOf(value.record).value }) : undefined;
    }
    function matches(value, facts, cell) {
      return value.roomIdentity === facts.roomIdentity && value.search === facts.search && value.drawing === facts.drawing
        && cell.value === facts.generation;
    }
    function valid(facts) {
      const value = facts && context();
      return !!value && matches(value, facts, cellOf(value.record));
    }
    function operation(facts) {
      const value = facts && context();
      if (!value) return undefined;
      const cell = cellOf(value.record);
      if (!matches(value, facts, cell)) return undefined;
      const alive = () => !disposed && cell.value === facts.generation;
      const live = () => {
        if (!alive()) return false;
        const now = context();
        return !!now && now.record === value.record && matches(now, facts, cell) && alive();
      };
      const read = (port, ...args) => {
        if (!live()) throw STOP;
        const result = port(...args);
        if (!live()) throw STOP;
        return result;
      };
      const field = (object, name) => {
        if (!alive() || !object || typeof object !== "object") throw STOP;
        const result = object[name];
        if (!alive()) throw STOP;
        return result;
      };
      return { value, read, field, live };
    }
    const scalar = value => value === null || ["string", "number", "boolean", "undefined"].includes(typeof value);
    const same = (a, b) => a?.length === b.length && b.every((value, at) => value === a[at]);
    function rowsFor(facts, selection, phase = "visible") {
      const op = operation(facts);
      if (!op) return undefined;
      const cached = caches.get(op.value.record), previous = cached?.latest;
      const next = phase === "stream" ? new Map(cached?.base) : new Map();
      const { field, read } = op;
      const length = array => {
        const count = field(array, "length");
        if (!Number.isSafeInteger(count) || count < 0) throw STOP;
        return count;
      };
      function take(name, signature, make) {
        if (!signature.every(scalar)) throw STOP;
        const old = previous?.get(name);
        const value = same(old?.signature, signature) ? old.value : Object.freeze(make());
        next.set(name, { signature, value });
        if (value !== old?.value && converted) read(converted, value, phase);
        return value;
      }
      function message(source, name) {
        const stamp = read(stampOf, op.value.record, source);
        if (!stamp) throw STOP;
        const token = field(stamp, "token"), revision = field(stamp, "snapshotRevision"), arriving = !!field(stamp, "arriving");
        if (!token || typeof token !== "object" || !Object.isFrozen(token) || !Number.isSafeInteger(revision)) throw STOP;
        const old = previous?.get(name);
        if (old?.token === token && old.revision === revision && old.arriving === arriving && old.value.kind === "msg") {
          next.set(name, old); return old.value;
        }
        const id = field(source, "id"), ts = field(source, "ts"), bodyMissing = !!field(source, "bodyMissing");
        if (typeof id !== "string" || !scalar(ts)) throw STOP;
        const value = Object.freeze({ kind: "msg", name, id, ts, bodyMissing, arriving, sourceToken: token, snapshotRevision: revision });
        next.set(name, { token, revision, arriving, value });
        if (converted) read(converted, value, phase);
        return value;
      }
      function project(item) {
        const kind = field(item, "kind"), name = field(item, "name");
        if (typeof kind !== "string" || typeof name !== "string") throw STOP;
        if (kind === "msg") return message(field(item, "m"), name);
        if (kind === "pins") {
          const above = field(item, "above");
          if (!Array.isArray(above)) throw STOP;
          const count = length(above), rows = [];
          let day = "";
          for (let at = 0; at < count; at++) {
            const source = field(above, at), id = field(source, "id"), ts = field(source, "ts"), label = read(dayLabel, ts);
            if (typeof id !== "string" || typeof label !== "string" || !scalar(ts)) throw STOP;
            if (label !== day) {
              const key = `day:${label}:${id}`;
              rows.push(take(key, ["day", key, label, ts], () => ({ kind: "day", name: key, day: label, ts })));
              day = label;
            }
            rows.push(message(source, id));
          }
          const old = previous?.get(name);
          if (old?.value.kind === "pins" && old.value.count === count && same(old.value.rows, rows)) {
            next.set(name, old); return old.value;
          }
          const value = Object.freeze({ kind, name, count, rows: Object.freeze(rows) });
          next.set(name, { value });
          if (converted) read(converted, value, phase);
          return value;
        }
        if (kind === "mark") {
          const sources = field(item, "agents"), authors = [], signature = [kind, name];
          if (!Array.isArray(sources)) throw STOP;
          const count = length(sources);
          for (let at = 0; at < count; at++) {
            const source = field(sources, at), author = {};
            for (const key of ["name", "skillChannel", "sawFromSeq"]) {
              const value = field(source, key);
              if (!scalar(value)) throw STOP;
              author[key] = value; signature.push(value);
            }
            authors.push(Object.freeze(author));
          }
          return take(name, signature, () => ({ kind, name, authors: Object.freeze(authors) }));
        }
        const values = kind === "space" ? { px: field(item, "px") } : kind === "day" ? { day: field(item, "day"), ts: field(item, "ts") }
          : kind === "ceiling" ? { hidden: field(item, "hidden"), pinned: field(item, "pinned") } : kind === "beginning" ? {} : null;
        if (!values) throw STOP;
        return take(name, [kind, name, ...Object.values(values)], () => ({ kind, name, ...values }));
      }
      try {
        const items = read(rowsOf, op.value.record, selection);
        if (!Array.isArray(items)) return undefined;
        const count = length(items), rows = [];
        for (let at = 0; at < count; at++) rows.push(project(field(items, at)));
        if (!op.live()) return undefined;
        if (phase !== "sample") {
          const base = phase === "stream" ? cached?.base || new Map() : next;
          if (phase === "stream") for (const [name, entry] of next) if (base.has(name)) base.set(name, entry);
          caches.set(op.value.record, { base, latest: next });
        }
        return Object.freeze(rows);
      } catch (error) { if (error === STOP) return undefined; throw error; }
    }
    function changed(record) { if (!disposed) cellOf(record).value++; }
    function dispose() { disposed = true; lifetime.dispose(); caches = new WeakMap(); epochs = new WeakMap(); }
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ currentFacts, valid, rowsFor, changed, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "facts", { value: true });
  root.VIBEROOM_CONVERSATION_LIST_READER = Object.freeze({ create });
})(globalThis);
