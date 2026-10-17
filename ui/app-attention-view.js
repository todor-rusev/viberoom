// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function create(uiRoot, { window: view = uiRoot.ownerDocument.defaultView, signal, onAttention = () => {} }) {
    signal?.throwIfAborted();
    const document = uiRoot.ownerDocument, navigator = view.navigator;
    const owner = global.VIBEROOM_APP_LIFETIME.create({ window: view });
    const shownRooms = new Map();
    let shown = -1;
    function update({ embedded, rooms, unread, currentRoomId, unseenHere, appBadge, documentAttention = false, title = "viberoom" }) {
      if (owner.disposed) return;
      if (embedded) {
        for (const roomId of new Set([...rooms.keys(), ...shownRooms.keys()])) {
          const exists = rooms.has(roomId);
          const count = exists ? (unread.get(roomId) || 0) + (roomId === currentRoomId ? unseenHere : 0) : 0;
          if (shownRooms.get(roomId) !== count) onAttention({ roomId, unread: count });
          if (exists) shownRooms.set(roomId, count); else shownRooms.delete(roomId);
        }
        if (!documentAttention) return;
      }
      let count = unseenHere;
      for (const n of unread.values()) count += n;
      const n = appBadge === false ? 0 : count;
      if (n === shown) return;
      shown = n;
      document.title = n ? `(${n > 99 ? "99+" : n}) ${title}` : title;
      if (n) document.documentElement.dataset.unseen = String(n);
      else delete document.documentElement.dataset.unseen;
      if ("setAppBadge" in navigator) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
    }
    owner.own(() => shownRooms.clear());
    function dispose() { owner.dispose(); }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ update, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  global.VIBEROOM_ATTENTION_VIEW = Object.freeze({ create });
})(globalThis);
