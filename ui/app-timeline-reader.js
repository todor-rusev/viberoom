// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create({ window: view = root, signal, current, keyOf, itemsOf, accountOf, headersFor, headerStampOf, matches,
    positionsOf, previewsFor, authorFor, colorsFor, changed: notify }) {
    signal?.throwIfAborted();
    const lifetime = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let disposed = false;
    lifetime.own(() => { disposed = true; });
    let epochs = new WeakMap(), metadata = new WeakMap(), placements = new WeakMap();
    function epochCell(record) {
      let cell = epochs.get(record);
      if (!cell) { cell = { value: 0, selection: 0 }; epochs.set(record, cell); }
      return cell;
    }
    const epoch = record => epochCell(record).value;
    function context() {
      if (disposed) return undefined;
      const value = current();
      return !disposed && value?.record && value.roomIdentity && value.held()
        && !disposed ? value : undefined;
    }
    function same(value, generation, cell) {
      const now = context();
      return !!now && now.record === value.record && now.roomIdentity === value.roomIdentity
        && now.search === value.search && cell.value === generation;
    }
    function operation(facts) {
      const value = context();
      if (!value) return undefined;
      const cell = epochCell(value.record), generation = cell.value;
      if (facts && (facts.roomIdentity !== value.roomIdentity || facts.search !== value.search
        || facts.generation !== generation)) return undefined;
      const live = () => same(value, generation, cell);
      const read = (port, ...args) => {
        if (!live()) return undefined;
        const result = port(...args);
        return live() ? result : undefined;
      };
      const alive = () => !disposed && cell.value === generation;
      return { value, read, live, alive, generation, selectionGeneration: cell.selection };
    }
    function currentFacts() {
      const value = context();
      return value ? Object.freeze({ roomIdentity: value.roomIdentity, search: value.search,
        generation: epoch(value.record) }) : undefined;
    }
    function holds(identity) { return !!identity && context()?.roomIdentity === identity; }
    function valid(facts) {
      const value = context();
      return !!value && facts.roomIdentity === value.roomIdentity && facts.search === value.search && facts.generation === epoch(value.record);
    }
    function list(op) {
      const items = op.read(itemsOf, op.value.record);
      const account = items && op.read(accountOf, op.value.record);
      return items && op.live() ? { items, account: account?.items.length === items.length ? account : null } : undefined;
    }
    function mapFor(facts) {
      const op = operation(facts), data = op && !facts.search && list(op);
      if (!data || !op.live()) return undefined;
      const recordKey = op.read(keyOf, op.value.record);
      if (recordKey === undefined) return undefined;
      const key = `${recordKey}|${data.items.length}|${data.items[0]?.name}|${data.items[data.items.length - 1]?.name}`;
      return op.live() ? Object.freeze({ key, accounted: !!data.account }) : undefined;
    }
    function metadataFor(op, items, fill = false) {
      const stamp = op.read(headerStampOf, op.value.record);
      if (!stamp) return undefined;
      const held = metadata.get(op.value.record);
      const cache = held?.stamp === stamp ? held : { stamp, entries: new Map(), ids: [], from: [], kind: [], pinned: [] };
      if (cache !== held || fill) {
        const missing = [];
        for (const item of items) {
          if (!op.alive()) return undefined;
          if (item.kind === "msg" && !cache.entries.has(item.m.id)) missing.push(item.m.id);
        }
        if (missing.length) {
          const headers = op.read(headersFor, op.value.record, missing);
          if (!headers) return undefined;
          if (!cache.entries.size && [headers.ids, headers.from, headers.kind, headers.pinned]
            .every(column => Array.isArray(column) && Object.isFrozen(column))) {
            for (let at = 0; at < headers.ids.length; at++) cache.entries.set(headers.ids[at], at);
            cache.ids = headers.ids; cache.from = headers.from; cache.kind = headers.kind; cache.pinned = headers.pinned;
          } else append(cache, headers);
        }
      }
      return cache;
    }
    function append(cache, columns) {
      if (Object.isFrozen(cache.ids)) {
        cache.ids = cache.ids.slice(); cache.from = cache.from.slice();
        cache.kind = cache.kind.slice(); cache.pinned = cache.pinned.slice();
      }
      for (let at = 0; at < columns.ids.length; at++) {
        const id = columns.ids[at];
        let index = cache.entries.get(id);
        if (index === undefined) { index = cache.ids.length; cache.entries.set(id, index); cache.ids.push(id); }
        cache.from[index] = columns.from[at]; cache.kind[index] = columns.kind[at]; cache.pinned[index] = columns.pinned[at];
      }
    }
    function headerAt(op, cache, id) {
      const held = cache.entries.get(id);
      if (held !== undefined) return held;
      const headers = op.read(headersFor, op.value.record, [id]);
      if (!headers?.ids.length) return undefined;
      if (!op.live()) return undefined;
      append(cache, headers);
      return cache.entries.get(id);
    }
    function rowsFor(facts, mine) {
      const op = operation(facts), data = op && list(op);
      if (!data) return undefined;
      if (!data.account) return Object.freeze([]);
      const cache = metadataFor(op, data.items, true);
      if (!cache) return undefined;
      const rows = [];
      for (let at = 0; at < data.items.length; at++) {
        if (!op.alive()) return undefined;
        const item = data.items[at];
        if (item.kind !== "msg") continue;
        const index = headerAt(op, cache, item.m.id);
        if (index === undefined) return undefined;
        const id = cache.ids[index], from = cache.from[index], pinned = cache.pinned[index];
        if ((from === "human") !== mine || cache.kind[index] === "hidden") continue;
        if (facts.search) {
          const accepted = op.read(matches, op.value.record, id, facts.search);
          if (accepted === undefined) return undefined;
          if (!accepted) continue;
        }
        rows.push(Object.freeze({ id, contentId: id, at, pinned, from }));
      }
      if (!op.live()) return undefined;
      metadata.set(op.value.record, cache);
      return Object.freeze(rows);
    }
    function positionsFor(facts, rows, heights = false) {
      const op = operation(facts), data = op && list(op);
      if (!data?.account) return undefined;
      const cache = metadataFor(op, data.items);
      if (!cache) return undefined;
      let selected = placements.get(op.value.record);
      if (!selected) { selected = new WeakMap(); placements.set(op.value.record, selected); }
      let placement = selected.get(rows);
      if (!placement || placement.items !== data.items || placement.stamp !== cache.stamp || placement.generation !== op.selectionGeneration) {
        let refreshed;
        for (let at = 0; at < rows.length; at++) {
          if (!op.alive()) return undefined;
          const row = rows[at];
          const source = data.items[row.at]?.m;
          const index = source ? headerAt(op, cache, source.id) : undefined;
          if (source && index === undefined) return undefined;
          if (index !== undefined && (cache.ids[index] !== row.contentId || cache.from[index] !== row.from)) {
            refreshed ||= rows.slice();
            refreshed[at] = Object.freeze({ ...row, contentId: cache.ids[index], from: cache.from[index] });
          }
        }
        if (!op.live()) return undefined;
        placement = { items: data.items, stamp: cache.stamp, generation: op.selectionGeneration, rows: refreshed ? Object.freeze(refreshed) : rows };
        selected.set(rows, placement);
      }
      const numbers = op.read(positionsOf, data.account, rows, heights);
      if (!numbers || !op.live()) return undefined;
      metadata.set(op.value.record, cache);
      return Object.freeze({ rows: placement.rows, tops: numbers.tops, heights: numbers.heights });
    }
    function selectedPreviews(facts, ids) {
      if (!Array.isArray(ids) || ids.length > 5) throw new TypeError("Choose at most five timeline previews");
      const op = operation(facts), value = op && op.read(previewsFor, op.value.record, ids);
      return value && op.live() ? value : undefined;
    }
    function author(facts, from, avatar = false) {
      const op = operation(facts), value = op && op.read(authorFor, op.value.record, from, avatar);
      if (!value) return undefined;
      const result = Object.freeze({ color: value.color, avatar: value.avatar });
      return op.live() ? result : undefined;
    }
    function colors(facts, froms) {
      const op = operation(facts);
      if (!op || !Array.isArray(froms)) return undefined;
      const count = froms.length, wanted = [];
      if (!op.alive()) return undefined;
      for (let at = 0; at < count; at++) {
        const from = froms[at];
        if (!op.alive() || (from !== null && !["string", "number", "boolean", "undefined"].includes(typeof from))) return undefined;
        wanted.push(from);
      }
      Object.freeze(wanted);
      const value = op.read(colorsFor, op.value.record, wanted);
      if (!Array.isArray(value) || value.length !== count || !op.alive()) return undefined;
      const result = [];
      for (let at = 0; at < count; at++) {
        const entry = value[at];
        if (!op.alive() || !entry || typeof entry !== "object") return undefined;
        const from = entry.from;
        if (!op.alive() || from !== wanted[at]) return undefined;
        const color = entry.color;
        if (!op.alive() || typeof color !== "string") return undefined;
        result.push(Object.freeze({ from, color }));
      }
      return op.live() ? Object.freeze(result) : undefined;
    }
    function changed(record) {
      if (disposed) return;
      const cell = epochCell(record); cell.value++; cell.selection++;
      placements.delete(record);
      notify?.(record);
    }
    function contentChanged(record) {
      if (disposed) return;
      epochCell(record).value++;
      notify?.(record);
    }
    function dispose() { disposed = true; lifetime.dispose(); epochs = new WeakMap(); metadata = new WeakMap(); placements = new WeakMap(); }
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ currentFacts, holds, valid, mapFor, rowsFor, positionsFor, previewsFor: selectedPreviews,
      authorFor: author, colorsFor: colors, changed, contentChanged, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "facts", { value: true });
  Object.defineProperty(create, "colorBatch", { value: true });
  Object.defineProperty(create, "contentChanges", { value: true });
  root.VIBEROOM_TIMELINE_READER = Object.freeze({ create });
})(globalThis);
