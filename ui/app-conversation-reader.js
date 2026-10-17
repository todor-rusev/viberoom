// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const previewText = (text, limit = 240) => root.WindowBodies.previewText(text, limit);
  const noQuietNotes = Object.freeze([]);
  function create({ window: view = root, signal, recordOf, identityOf, collectionsOf, rowsOf, messageOf, headerOf, stampOf, overviewMetaOf, quietHistoryOf }) {
    signal?.throwIfAborted();
    const lifetime = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let disposed = false;
    lifetime.own(() => { disposed = true; });
    let epochs = new WeakMap(), pinLists = new WeakMap(), overviewChoices = new WeakMap();
    let quietKinds = new WeakMap(), quietIds = new WeakMap(), quietNotes = new WeakMap();
    function epochCell(record) {
      let cell = epochs.get(record);
      if (!cell) { cell = { value: 0 }; epochs.set(record, cell); }
      return cell;
    }
    function changed(record) {
      if (disposed) return;
      epochCell(record).value++; quietNotes.delete(record);
    }
    function collectionsChanged(record, change) {
      if (disposed) return;
      epochCell(record).value++;
      if (change.held || change.heldHeaders || change.heldChats) quietNotes.delete(record);
      if (change.heldChats) overviewChoices.delete(record);
      if (change.held || change.olderPins || change.pins) pinLists.delete(record);
    }
    function reset(record) { changed(record); pinLists.delete(record); overviewChoices.delete(record); quietKinds.delete(record); quietIds.delete(record); }
    function dispose() { disposed = true;
      lifetime.dispose(); epochs = new WeakMap(); pinLists = new WeakMap(); overviewChoices = new WeakMap();
      quietKinds = new WeakMap(); quietIds = new WeakMap(); quietNotes = new WeakMap();
    }
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });
    function operation(record) {
      if (!record || disposed) return undefined;
      const cell = epochCell(record), before = cell.value;
      const live = () => !disposed && cell.value === before;
      function held() {
        if (!live()) return false;
        const value = recordOf(record.id);
        return live() && value === record;
      }
      function query(read, ...args) {
        if (!held()) return undefined;
        const result = read(...args);
        return held() ? result : undefined;
      }
      if (!record || !held()) return undefined;
      const identity = query(identityOf, record);
      if (!identity) return undefined;
      const collections = query(collectionsOf, record);
      if (!collections) return undefined;
      function valid(keys = []) {
        if (!held()) return false;
        const now = query(collectionsOf, record);
        return !!now && keys.every(key => now[key] === collections[key]) && held();
      }
      return { identity, collections, query, valid, alive: live };
    }
    function headerFor(record, id) {
      const op = operation(record);
      if (!op) return undefined;
      const source = op.query(messageOf, record, id);
      if (!source) return undefined;
      const result = op.query(headerOf, record, source);
      return result && op.valid(["heldHeaders", "olderPinHeaders"]) ? result : undefined;
    }
    function rangeFor(record, { collection, start, count }) {
      if (!["held", "olderPins"].includes(collection) || !Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 0) throw new TypeError("Choose a collection and non-negative integer range");
      const op = operation(record);
      if (!op) return undefined;
      const rows = op.query(rowsOf, record, collection);
      if (!rows) return undefined;
      const total = rows.length, headers = [];
      for (let i = start, end = Math.min(total, start + count); i < end; i++) {
        const value = op.query(headerOf, record, rows[i], collection);
        if (!value) return undefined;
        headers.push(value);
      }
      const stamp = collection === "held" ? "heldHeaders" : "olderPinHeaders";
      return op.valid([collection, stamp]) ? Object.freeze({ roomIdentity: op.identity, rangeToken: op.collections[collection], start, total, headers: Object.freeze(headers) }) : undefined;
    }
    function pinsFor(record) {
      const op = operation(record);
      if (!op) return undefined;
      const meta = op.collections;
      let cached = pinLists.get(record);
      if (!cached || cached.held !== meta.held || cached.olderPins !== meta.olderPins || cached.pins !== meta.pins) {
        const held = op.query(rowsOf, record, "held"), older = held && op.query(rowsOf, record, "olderPins");
        if (!older) return undefined;
        const ids = new Set(held.map(row => row.id));
        const selected = [...older.filter(row => !ids.has(row.id)), ...held.filter(row => row.pinned && row.kind === "chat")];
        selected.sort(root.HistoryWindow.compareMessages);
        if (!op.valid(["held", "olderPins", "pins"])) return undefined;
        cached = { held: meta.held, olderPins: meta.olderPins, pins: meta.pins, ids: Object.freeze(selected.map(row => row.id)) };
        pinLists.set(record, cached);
      }
      const headers = [];
      for (const id of cached.ids) {
        const source = op.query(messageOf, record, id), value = source && op.query(headerOf, record, source);
        if (!value) return undefined;
        headers.push(value);
      }
      return op.valid(["held", "olderPins", "pins", "heldHeaders", "olderPinHeaders"]) ? Object.freeze(headers) : undefined;
    }
    function previewFor(record, id, limit = 240) {
      if (!Number.isSafeInteger(limit) || limit < 0 || limit > 240) throw new TypeError("A preview is between 0 and 240 characters");
      const op = operation(record);
      if (!op) return undefined;
      const source = op.query(messageOf, record, id);
      if (!source) return undefined;
      const stamp = op.query(stampOf, source);
      if (!stamp?.token) return undefined;
      const header = op.query(headerOf, record, source);
      if (!header || header.token !== stamp.token || op.query(messageOf, record, id) !== source) return undefined;
      const prefix = limit ? previewText(String(source.text || ""), limit) : "";
      const imageCount = source.bodyMissing ? 0 : source.images?.length || 0;
      const result = Object.freeze({ preview: prefix, imageCount });
      const next = op.query(stampOf, source), current = next && op.query(messageOf, record, id);
      return current === source && next.token === stamp.token && next.snapshotRevision === stamp.snapshotRevision && op.valid() ? result : undefined;
    }
    function timelinePreviewsFor(record, ids) {
      if (!Array.isArray(ids) || ids.length > 5 || ids.some(id => typeof id !== "string")) throw new TypeError("Choose at most five message IDs");
      const op = operation(record);
      if (!op) return undefined;
      const previews = [];
      for (const id of ids) {
        const source = op.query(messageOf, record, id), stamp = source && op.query(stampOf, source);
        if (!stamp?.token) return undefined;
        const text = String(source.text || "").trim().replace(/\s+/g, " ").slice(0, 240);
        const next = op.query(stampOf, source), current = next && op.query(messageOf, record, id);
        if (current !== source || next.token !== stamp.token || next.snapshotRevision !== stamp.snapshotRevision) return undefined;
        previews.push(Object.freeze({ id, text }));
      }
      return op.valid() ? Object.freeze(previews) : undefined;
    }
    function timelineHeadersFor(record, ids) {
      if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new TypeError("Choose message IDs");
      const op = operation(record);
      if (!op) return undefined;
      const columns = { ids: [], from: [], kind: [], pinned: [] };
      const held = op.query(rowsOf, record, "held");
      if (!held) return undefined;
      const wholeRange = held.length === ids.length && held.every((source, at) => op.alive() && source.id === ids[at]);
      const scalar = value => value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
      for (let at = 0; at < ids.length; at++) {
        const source = wholeRange ? held[at] : op.query(messageOf, record, ids[at]);
        if (!op.alive()) return undefined;
        if (!source) return undefined;
        const actualId = source.id;
        if (!op.alive()) return undefined;
        const from = source.from;
        if (!op.alive()) return undefined;
        const kind = source.kind;
        if (!op.alive()) return undefined;
        const pinned = source.pinned;
        if (!op.alive()) return undefined;
        if (actualId !== ids[at] || !scalar(from) || !scalar(kind)) return undefined;
        columns.ids.push(actualId); columns.from.push(from); columns.kind.push(kind); columns.pinned.push(!!pinned);
      }
      return op.valid(["held", "heldHeaders"]) ? Object.freeze(Object.fromEntries(Object.entries(columns).map(([key, values]) => [key, Object.freeze(values)]))) : undefined;
    }
    function timelineMatchesFor(record, id, search) {
      const op = operation(record);
      if (!op) return undefined;
      const source = op.query(messageOf, record, id), stamp = source && op.query(stampOf, source);
      if (!stamp?.token) return undefined;
      const text = op.query(row => row.text, source), q = search.toLowerCase();
      if (typeof text !== "string") return undefined;
      let accepted = text.toLowerCase().includes(q);
      if (!accepted) {
        const name = op.query(row => row.fromName || "", source);
        if (typeof name !== "string") return undefined;
        accepted = name.toLowerCase().includes(q);
      }
      if (!accepted) {
        const quotes = op.query(row => row.quotes || [], source);
        if (!Array.isArray(quotes)) return undefined;
        for (const quote of quotes) {
          const words = op.query(value => value.text || "", quote);
          if (typeof words !== "string") return undefined;
          if (words.toLowerCase().includes(q)) { accepted = true; break; }
        }
      }
      const next = op.query(stampOf, source), current = next && op.query(messageOf, record, id);
      return current === source && next.token === stamp.token && next.snapshotRevision === stamp.snapshotRevision && op.valid()
        ? accepted : undefined;
    }
    function overviewRead(record) {
      const op = operation(record);
      if (!op) return undefined;
      let choice = overviewChoices.get(record);
      if (!choice || choice.stamp !== op.collections.heldChats) {
        const rows = op.query(rowsOf, record, "held");
        if (!rows) return undefined;
        let id;
        for (const row of rows) if (row.kind === "chat") id = row.id;
        if (!op.valid(["heldChats"])) return undefined;
        choice = Object.freeze({ stamp: op.collections.heldChats, id });
        overviewChoices.set(record, choice);
      }
      const meta = op.query(overviewMetaOf, record);
      if (!meta?.counts) return undefined;
      const held = choice.id !== undefined;
      const source = held ? op.query(messageOf, record, choice.id) : meta.lastChat;
      if (held && !source) return undefined;
      const header = held ? op.query(headerOf, record, source) : undefined;
      const stamp = held ? op.query(stampOf, source) : undefined;
      if (held && (!header || !stamp || header.token !== stamp.token)) return undefined;
      const fields = held ? header.header : source;
      const result = Object.freeze({ roomIdentity: op.identity, selectionToken: choice.stamp,
        historyToken: op.collections.historyOverview, sourceToken: stamp?.token || op.collections.historyOverview,
        snapshotRevision: stamp?.snapshotRevision, hasChat: !!source, id: fields?.id, fromName: fields?.fromName,
        ts: fields?.ts, last: meta.lastChatAt ?? (source ? fields.ts : op.identity.createdAt),
        count: meta.chats !== undefined ? meta.chats + meta.counts.streaming : meta.counts.held + (meta.hidden || 0) });
      function valid() {
        if (!op.valid(["heldChats", "historyOverview", "heldHeaders"])) return false;
        const now = op.query(overviewMetaOf, record);
        if (!now || now.lastChat !== meta.lastChat || now.lastChatAt !== meta.lastChatAt || now.chats !== meta.chats
          || now.hidden !== meta.hidden || now.counts !== meta.counts) return false;
        if (held) {
          if (op.query(messageOf, record, choice.id) !== source) return false;
          const next = op.query(stampOf, source);
          if (!next || next.token !== stamp.token || next.snapshotRevision !== stamp.snapshotRevision) return false;
        }
        return op.valid(["heldChats", "historyOverview", "heldHeaders"]);
      }
      return { source, result, valid };
    }
    function overviewFor(record) {
      const read = overviewRead(record);
      return read?.valid() ? read.result : undefined;
    }
    function overviewTextFor(record, kind) {
      if (!["side", "home", "grid"].includes(kind)) throw new TypeError("Choose an overview text kind");
      const read = overviewRead(record);
      if (!read?.valid()) return undefined;
      let text;
      if (read.source) {
        const value = String(read.source.text);
        if (kind === "grid") text = value.slice(0, 140);
        else if (kind === "side") text = value.replace(/\s+/g, " ");
        else {
          text = ""; let spacing = false;
          for (let i = 0; i < value.length && text.length < 70; i++) {
            const ch = value[i], space = /\s/.test(ch);
            if (!space || !spacing) text += space ? " " : ch;
            spacing = space;
          }
        }
        if (kind === "grid") text = JSON.parse(JSON.stringify(text));
      }
      return read.valid() ? Object.freeze({ ...read.result, text }) : undefined;
    }
    function quietFor(record) {
      const op = operation(record);
      if (!op) return undefined;
      const rows = op.query(rowsOf, record, "held");
      if (!rows) return undefined;
      const history = op.query(quietHistoryOf, record);
      if (!history) return undefined;
      const { bodyProtocol, indexed, total } = history;
      const heldCount = rows.length, keys = ["held", "heldChats", "historyOverview"];
      let kinds = quietKinds.get(record);
      if (!kinds || kinds.stamp !== op.collections.heldChats) {
        const nonQuiet = rows.some(row => row.kind !== "system" && row.kind !== "hidden");
        if (!op.valid(keys)) return undefined;
        kinds = { stamp: op.collections.heldChats, nonQuiet }; quietKinds.set(record, kinds);
      }
      const eligible = !kinds.nonQuiet && (!heldCount || !bodyProtocol || !!indexed);
      let idsKey = "", notes = noQuietNotes;
      if (eligible) {
        let ids = quietIds.get(record);
        if (!ids || ids.stamp !== op.collections.held) {
          const value = rows.map(row => row.id).join(",");
          if (!op.valid(keys)) return undefined;
          ids = { stamp: op.collections.held, value }; quietIds.set(record, ids);
        }
        idsKey = ids.value;
        let selected = quietNotes.get(record);
        if (!selected) {
          const entries = [];
          for (let i = rows.length - 1; i >= 0 && entries.length < 3; i--) {
            const source = rows[i];
            if (source.kind !== "system" || source.audience === "agents") continue;
            const before = op.query(stampOf, source);
            if (!before?.token) return undefined;
            const id = source.id, text = String(source.text || "");
            const after = op.query(stampOf, source);
            if (!after || after.token !== before.token || after.snapshotRevision !== before.snapshotRevision
              || op.query(messageOf, record, id) !== source) return undefined;
            entries.push(Object.freeze({ id, token: before.token, revision: before.snapshotRevision, text }));
          }
          if (!op.valid(keys)) return undefined;
          entries.reverse();
          selected = Object.freeze({ entries: Object.freeze(entries), notes: Object.freeze(entries.map(({ id, text }) => Object.freeze({ id, text }))) });
          quietNotes.set(record, selected);
        }
        for (const entry of selected.entries) {
          const source = op.query(messageOf, record, entry.id), stamp = source && op.query(stampOf, source);
          if (!stamp || stamp.token !== entry.token || stamp.snapshotRevision !== entry.revision) return undefined;
        }
        notes = selected.notes;
      }
      const next = op.query(quietHistoryOf, record);
      if (!next || next.bodyProtocol !== bodyProtocol || next.indexed !== indexed || next.total !== total
        || !op.valid(keys)) return undefined;
      return Object.freeze({ roomIdentity: op.identity, eligible, heldCount, historyTotal: total, idsKey, notes });
    }
    return Object.freeze({ headerFor, rangeFor, pinsFor, previewFor, timelineHeadersFor, timelineMatchesFor, timelinePreviewsFor, overviewFor, overviewTextFor, quietFor, changed, collectionsChanged, reset, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "overview", { value: true });
  Object.defineProperty(create, "quiet", { value: true });
  Object.defineProperty(create, "timelinePreviews", { value: true });
  Object.defineProperty(create, "timelineHeaders", { value: true });
  root.VIBEROOM_CONVERSATION_READER = Object.freeze({ create, previewText });
})(globalThis);
