// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(() => {
  const PREFIX = "viberoom.draft.";
  const KINDS = ["img", "audio", "video"];

  const isText = (value) => typeof value === "string";
  const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
  const isNumbered = (item) => !!item && typeof item === "object" && Number.isSafeInteger(item.n) && item.n > 0;

  function isEmpty(draft) {
    return !draft || (!String(draft.text || "").trim() && KINDS.every((kind) => !(draft.files?.[kind] || []).length) && !(draft.quotes || []).length);
  }

  function save(storage, roomId, draft) {
    try {
      if (isEmpty(draft)) storage.removeItem(PREFIX + roomId);
      else storage.setItem(PREFIX + roomId, JSON.stringify({ v: 1, ...draft }));
      return true;
    } catch {
      return false;
    }
  }

  function load(storage, roomId) {
    let raw = null;
    try { raw = storage.getItem(PREFIX + roomId); } catch { return null; }
    if (!raw) return null;
    let draft;
    try { draft = JSON.parse(raw); } catch { return null; }
    if (!draft || draft.v !== 1 || !isText(draft.text)) return null;
    const files = {};
    for (const kind of KINDS) {
      const list = draft.files?.[kind] ?? [];
      if (!Array.isArray(list) || !list.every((f) => isNumbered(f) && isText(f.file) && f.file)) return null;
      files[kind] = list;
    }
    const quotes = draft.quotes ?? [];
    if (!Array.isArray(quotes) || !quotes.every((q) => isNumbered(q) && isText(q.text))) return null;
    const unsent = draft.unsent ?? [];
    if (!Array.isArray(unsent) || !unsent.every((u) => isNumbered(u) && KINDS.includes(u.kind))) return null;
    const seq = {};
    for (const kind of [...KINDS, "quote"]) seq[kind] = isCount(draft.seq?.[kind]) ? draft.seq[kind] : 0;
    return { text: draft.text, files, quotes, unsent, seq, at: Number(draft.at) || 0 };
  }

  function remove(storage, roomId) {
    try { storage.removeItem(PREFIX + roomId); } catch { }
  }

  function withoutMarkers(text, markers) {
    let out = text;
    for (const marker of markers) {
      const at = out.indexOf(marker);
      if (at < 0) continue;
      const before = out.slice(0, at), after = out.slice(at + marker.length);
      out = before.endsWith(" ") && (after.startsWith(" ") || !after) ? before.slice(0, -1) + after : before + (after.startsWith(" ") && !before ? after.slice(1) : after);
    }
    return out;
  }

  globalThis.VIBEROOM_DRAFTS = { save, load, remove, isEmpty, withoutMarkers, PREFIX, KINDS };
})();
