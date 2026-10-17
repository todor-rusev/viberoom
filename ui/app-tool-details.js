// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create({ window: view = root, signal, current, get, isOpen, repaint }) {
    signal?.throwIfAborted();
    const lifetime = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let caches = new WeakMap(), epoch = 0;
    const entries = new Set();
    const snapshot = (state, value) => Object.freeze({ state, value });
    function retire(entry) {
      if (!entry.alive) return;
      entry.alive = false; entry.snapshot = undefined; entries.delete(entry);
      if (entry.group.calls.get(entry.target.toolCallId) === entry) entry.group.calls.delete(entry.target.toolCallId);
      if (!entry.group.calls.size && entry.group.parent.get(entry.target.sourceToken) === entry.group) entry.group.parent.delete(entry.target.sourceToken);
      entry.controller.abort();
    }
    function retireGroup(parent, token) {
      const group = parent?.get(token);
      if (!group) return;
      parent.delete(token);
      for (const entry of [...group.calls.values()]) retire(entry);
    }
    function clear() {
      epoch++; caches = new WeakMap();
      for (const entry of [...entries]) retire(entry);
    }
    function dispose() { lifetime.dispose(); clear(); }
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });
    function query(target) {
      if (lifetime.disposed) return undefined;
      const before = epoch, data = current(target);
      if (lifetime.disposed || before !== epoch || !data || data.roomIdentity !== target.roomIdentity || data.token !== target.sourceToken
        || data.call?.toolCallId !== target.toolCallId || data.call.detailsRevision !== target.revision) return undefined;
      return data;
    }
    function live(entry) {
      if (lifetime.disposed || !entry.alive) return undefined;
      const data = query(entry.target);
      if (!data || !entry.alive) return undefined;
      const group = caches.get(data.record)?.get(entry.target.sourceToken);
      if (group !== entry.group || group.calls.get(entry.target.toolCallId) !== entry || group.revision !== data.snapshotRevision) return undefined;
      return data;
    }
    function notify(entry) {
      if (!live(entry)) { retire(entry); return; }
      const open = isOpen(entry.target.toolCallId);
      if (lifetime.disposed || !entry.alive) return;
      if (!open || !live(entry)) { retire(entry); return; }
      repaint(entry.target);
    }
    function arrived(entry, value, failed) {
      if (!live(entry)) { retire(entry); return; }
      if (failed && value?.status === 409 && value.code === "room_replaced") { retire(entry); return; }
      if (failed) entry.snapshot = snapshot("error", entry.snapshot.value);
      else {
        const before = epoch;
        let owned;
        try { owned = root.VIBEROOM_OWNED_JSON.copyOrdered(value, "Tool call details"); }
        catch { if (live(entry)) { entry.snapshot = snapshot("error", entry.snapshot.value); notify(entry); } else retire(entry); return; }
        if (lifetime.disposed || before !== epoch || !live(entry)) { retire(entry); return; }
        entry.snapshot = snapshot("ready", owned);
      }
      notify(entry);
    }
    function load(entry) {
      if (!live(entry)) { retire(entry); return; }
      let request;
      try { request = get(entry.target, { signal: entry.controller.signal }); }
      catch (error) { request = Promise.reject(error); }
      Promise.resolve(request).then(value => arrived(entry, value, false), error => arrived(entry, error, true));
    }
    function read(input) {
      if (lifetime.disposed) return undefined;
      const target = Object.freeze({ roomId: input.roomId, roomIdentity: input.roomIdentity, messageId: input.messageId,
        sourceToken: input.sourceToken, toolCallId: input.toolCallId, revision: input.revision });
      const data = query(target);
      if (!data) return undefined;
      if (!data.call.detailsAvailable) return snapshot("ready", data.call);
      let parent = caches.get(data.record);
      if (!parent) { parent = new Map(); caches.set(data.record, parent); }
      let group = parent.get(target.sourceToken);
      if (group && group.revision !== data.snapshotRevision) {
        const checkpoint = ++epoch; retireGroup(parent, target.sourceToken);
        if (lifetime.disposed || checkpoint !== epoch) return undefined;
        parent = caches.get(data.record);
        if (!parent) { parent = new Map(); caches.set(data.record, parent); }
        group = parent.get(target.sourceToken);
      }
      if (!group) { group = { parent, revision: data.snapshotRevision, calls: new Map() }; parent.set(target.sourceToken, group); }
      const held = group.calls.get(target.toolCallId);
      if (held?.target.revision === target.revision) return held.snapshot;
      if (held) { const checkpoint = ++epoch; retire(held); if (lifetime.disposed || checkpoint !== epoch) return undefined; }
      parent.set(target.sourceToken, group);
      const entry = { target, group, alive: true, controller: new view.AbortController(), snapshot: snapshot("loading", data.call) };
      group.calls.set(target.toolCallId, entry); entries.add(entry); epoch++; load(entry);
      return entry.alive ? entry.snapshot : undefined;
    }
    function forget(target) {
      const data = query(target);
      if (!data) return;
      epoch++;
      const entry = caches.get(data.record)?.get(target.sourceToken)?.calls.get(target.toolCallId);
      if (entry) retire(entry);
    }
    function changed(record, change) {
      if (lifetime.disposed) return;
      epoch++;
      const parent = caches.get(record), group = parent?.get(change.token);
      if (!group) return;
      if (change.part === "all" || change.snapshotRevision !== group.revision + 1) { retireGroup(parent, change.token); return; }
      group.revision = change.snapshotRevision;
      if (change.part !== "tools") return;
      if (!change.toolVersions) { retireGroup(parent, change.token); return; }
      for (const tool of change.toolVersions) {
        const entry = group.calls.get(tool.toolCallId);
        if (entry && (!tool.detailsAvailable || tool.detailsRevision !== entry.target.revision)) retire(entry);
      }
    }
    function removed(record, tokens) {
      if (lifetime.disposed) return;
      epoch++;
      const parent = caches.get(record);
      for (const token of tokens) retireGroup(parent, token);
    }
    function reset(record) {
      if (lifetime.disposed) return;
      epoch++;
      const parent = caches.get(record);
      caches.delete(record);
      if (parent) for (const token of [...parent.keys()]) retireGroup(parent, token);
    }
    return Object.freeze({ read, forget, changed, removed, reset, clear, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  root.VIBEROOM_TOOL_DETAILS = Object.freeze({ create });
})(globalThis);
