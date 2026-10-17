// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";

  function record(value, name) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
    return value;
  }
  const ownJSON = value => root.VIBEROOM_OWNED_JSON.copy(value, "Settings data");
  function looks(value) {
    if (!Array.isArray(value)) throw new TypeError("looks must be an array");
    return ownJSON(value);
  }

  function create({ onError } = {}) {
    if (onError !== undefined && typeof onError !== "function") throw new TypeError("onError must be a function");
    const observers = new Set(), pending = [];
    let disposed = false, delivering = false, batchDepth = 0;
    const entry = value => ({ value: Object.freeze(value), signature: JSON.stringify(value) });
    let current = entry({ loaded: false, settings: null, roomDefaults: null, looks: Object.freeze([]) });
    const read = () => current.value;
    function report(error) {
      try { onError?.(error); } catch { }
    }
    function commit(value) {
      const next = entry(value);
      if (next.signature === current.signature) return;
      current = next;
    }
    function deliver() {
      if (delivering || batchDepth) return;
      delivering = true;
      try {
        while (!disposed && pending.length) {
          const next = pending.shift();
          if (next.work) {
            try { runBatch(next.work); } catch (error) { report(error); }
            continue;
          }
          current = next;
          for (const observer of [...observers]) {
            if (disposed) break;
            if (!observers.has(observer)) continue;
            try { const listener = observer.listener; listener(current.value); } catch (error) { report(error); }
          }
        }
      } finally { delivering = false; }
    }
    function runBatch(work) {
      const before = current;
      batchDepth++;
      try { return work(); }
      finally {
        if (--batchDepth === 0 && !disposed) {
          if (current.signature === before.signature) current = before;
          else pending.unshift(current);
        }
      }
    }
    function batch(work) {
      if (disposed) return;
      if (typeof work !== "function") throw new TypeError("A synchronous settings turn is required");
      if (batchDepth) return runBatch(work);
      if (delivering) { pending.push({ work }); return; }
      try { return runBatch(work); }
      finally { deliver(); }
    }
    function subscribe(listener, { signal } = {}) {
      if (disposed || signal?.aborted) return () => {};
      if (typeof listener !== "function") throw new TypeError("A settings listener is required");
      const observer = { listener, release: null };
      let active = true;
      function release() {
        if (!active) return;
        active = false;
        observers.delete(observer);
        signal?.removeEventListener("abort", release);
      }
      observer.release = release;
      observers.add(observer);
      signal?.addEventListener("abort", release, { once: true });
      if (signal?.aborted) release();
      return release;
    }
    function acceptSnapshot(snapshot) {
      if (disposed) return;
      record(snapshot, "snapshot");
      const settings = ownJSON(record(snapshot.settings, "settings"));
      const roomDefaults = snapshot.roomDefaults == null ? null : ownJSON(record(snapshot.roomDefaults, "roomDefaults"));
      const copiedLooks = Object.hasOwn(snapshot, "looks") ? looks(snapshot.looks) : Object.freeze([]);
      batch(() => commit({ loaded: true, settings, roomDefaults, looks: copiedLooks }));
    }
    function acceptSettings(settings) {
      if (disposed) return;
      const copy = ownJSON(record(settings, "settings"));
      batch(() => commit({ ...current.value, settings: copy }));
    }
    function acceptLooks(value) {
      if (disposed) return;
      const copy = looks(value);
      batch(() => commit({ ...current.value, looks: copy }));
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      pending.length = 0;
      for (const observer of [...observers]) observer.release();
    }
    const reader = Object.freeze({ read, subscribe });
    return Object.freeze({ reader, acceptSnapshot, acceptSettings, acceptLooks, batch, dispose });
  }

  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "batched", { value: true });
  root.VIBEROOM_SETTINGS_MODEL = Object.freeze({ create });
})(globalThis);
