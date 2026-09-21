// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  const MAX_BODIES = 256, MAX_BYTES = 8 * 1024 * 1024;
  const weights = new WeakMap();
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
    const loaded = room.messages.filter(m => !m.bodyMissing);
    let count = loaded.length, total = loaded.reduce((n, m) => n + bytes(m), 0);
    const evicted = new Set();
    for (const m of loaded.sort((a, b) => (uses.get(a.id) || 0) - (uses.get(b.id) || 0))) {
      if (count <= maxBodies && total <= maxBytes) break;
      if (m.streaming || m.pending || protectedIds.has(m.id)) continue;
      evicted.add(m.id); count--; total -= bytes(m); uses.delete(m.id);
    }
    if (evicted.size) for (const m of room.messages) if (evicted.has(m.id)) {
      const header = indexEntry(m);
      for (const key of Object.keys(m)) delete m[key];
      Object.assign(m, header);
      weights.delete(m);
    }
    const known = new Set(room.messages.map(m => m.id));
    for (const id of uses.keys()) if (!known.has(id)) uses.delete(id);
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
  root.WindowBodies = { MAX_BODIES, MAX_BYTES, indexEntry, touch, trim, merge, retain, invalidate: m => weights.delete(m) };
})(typeof window !== "undefined" ? window : globalThis);
