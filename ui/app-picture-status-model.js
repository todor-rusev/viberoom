// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const keyOf = (room, file) => `${room}/${file}`;
  function create() {
    let pictures = new Map(), disposed = false;
    const own = value => root.VIBEROOM_OWNED_JSON.copy(value, "Picture status");
    function acceptSnapshot(values) {
      if (disposed) return;
      const next = new Map();
      for (const value of values) { const copied = own(value); next.set(keyOf(copied.room, copied.file), copied); }
      pictures = next;
    }
    function acceptChange(room, file, state) {
      if (disposed) return;
      const key = keyOf(room, file);
      if (state) pictures.set(key, own({ room, file, ...state }));
      else pictures.delete(key);
    }
    function dispose() { disposed = true; pictures.clear(); }
    return Object.freeze({ reader: Object.freeze({ get: (room, file) => pictures.get(keyOf(room, file)) }),
      acceptSnapshot, acceptChange, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  root.VIBEROOM_PICTURE_STATUS_MODEL = Object.freeze({ create });
})(globalThis);
