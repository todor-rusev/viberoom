// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  const MAX_BODIES = 256, MAX_BYTES = 8 * 1024 * 1024;
  const weights = new WeakMap();
  const bodyIndexes = new WeakMap();
  function bodyIndex(room) {
    const rows = room.messages;
    let index = bodyIndexes.get(rows);
    if (!index || index.length !== rows.length) {
      index = { length: rows.length, loaded: new Set(rows.filter(m => !m.bodyMissing)) };
      bodyIndexes.set(rows, index);
    }
    return index;
  }
  function changed(room, message) {
    weights.delete(message);
    const index = bodyIndexes.get(room.messages);
    if (index && index.length === room.messages.length) {
      if (message.bodyMissing) index.loaded.delete(message);
      else index.loaded.add(message);
    }
  }
  function bytes(message) {
    if (!weights.has(message)) weights.set(message, new TextEncoder().encode(JSON.stringify(message)).length);
    return weights.get(message);
  }
  function indexEntry(m) {
    return { id: m.id, seq: m.seq, displayOrder: m.displayOrder, kind: m.kind,
      from: m.from, fromName: m.fromName, to: m.to, toNames: m.toNames,
      ts: m.ts, pinned: m.pinned, streaming: m.streaming, text: String(m.text || "").trim().replace(/\s+/g, " ").slice(0, 240),
      bodyMissing: true, bodyChars: m.bodyChars ?? String(m.text || "").length };
  }
  function touch(room, ids) {
    const uses = room.bodyUses ||= new Map();
    for (const id of ids) uses.set(id, room.bodyClock = (room.bodyClock || 0) + 1);
  }
  function trim(room, protectedIds = new Set(), maxBodies = MAX_BODIES, maxBytes = MAX_BYTES) {
    if (!room.history?.indexed) return { count: 0, bytes: 0 };
    const uses = room.bodyUses ||= new Map();
    const index = bodyIndex(room);
    const loaded = [...index.loaded];
    let count = loaded.length, total = loaded.reduce((n, m) => n + bytes(m), 0);
    const evicted = new Set();
    for (const m of loaded.sort((a, b) => (uses.get(a.id) || 0) - (uses.get(b.id) || 0))) {
      if (count <= maxBodies && total <= maxBytes) break;
      if (m.streaming || m.pending || protectedIds.has(m.id)) continue;
      evicted.add(m.id); count--; total -= bytes(m); uses.delete(m.id);
    }
    if (evicted.size) for (const m of loaded) if (evicted.has(m.id)) {
      const header = indexEntry(m);
      for (const key of Object.keys(m)) delete m[key];
      Object.assign(m, header);
      weights.delete(m);
      index.loaded.delete(m);
    }
    for (const id of uses.keys()) if (!root.HistoryWindow.heldMessageById(room, id)) uses.delete(id);
    return { count, bytes: total };
  }
  function merge(room, page, generation) {
    if (room.historyGeneration !== generation || page.version !== room.history?.version || page.epoch !== room.history?.epoch) return false;
    const bodies = new Map(page.messages.map(m => [m.id, m]));
    room.messages = room.messages.map(m => {
      const body = bodies.get(m.id);
      if (!body || !m.bodyMissing || (room.bodyChanges?.get(m.id) || 0) > page.streamSequence) return m;
      return body;
    });
    touch(room, page.messages.map(m => m.id));
    return true;
  }
  function retain(previous, fresh) {
    if (previous.history?.version !== fresh.history?.version) return;
    const known = new Map(previous.messages.filter(m => !m.bodyMissing && !m.streaming).map(m => [m.id, m]));
    fresh.messages = fresh.messages.map(m => m.bodyMissing && known.has(m.id) ? known.get(m.id) : m);
  }
  root.WindowBodies = { MAX_BODIES, MAX_BYTES, indexEntry, touch, trim, merge, retain, changed, invalidate: m => weights.delete(m) };
})(typeof window !== "undefined" ? window : globalThis);
