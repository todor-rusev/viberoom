// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const fields = Object.freeze(("id seq from fromName to toNames text ts displayOrder kind details skill edited bodyDelivery bodyEdit via pinned pinLabel diagramRepairs images audio answerFrom video quotes audience wakes streaming thought origin numbering branch variantOf resourceRefs notices toolCalls plan stopReason stoppedBy cancelledBy failed usage durationMs numbersHere pending bodyMissing bodyChars bodyError").split(" "));
  const textFields = Object.freeze("id kind from fromName streaming text images quotes to audio video numbersHere resourceRefs diagramRepairs".split(" "));
  const headerFields = Object.freeze("id seq displayOrder kind from fromName to toNames ts pinned pinLabel streaming pending bodyMissing bodyChars bodyError".split(" "));
  function create({ window: view = root, signal, recordOf, messageOf, headerMessageOf = messageOf, stampOf }) {
    signal?.throwIfAborted();
    const lifetime = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let caches = new WeakMap(), roomEpochs = new WeakMap(), tokenEpochs = new WeakMap();
    const STOP = Symbol("message projection ended");
    const epoch = (map, key) => map.get(key) || 0;
    function dispose() { lifetime.dispose(); caches = new WeakMap(); roomEpochs = new WeakMap(); tokenEpochs = new WeakMap(); }
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });
    function current(record, source, find = messageOf) {
      if (lifetime.disposed || !record || !source) return false;
      const room = recordOf(record.id);
      if (lifetime.disposed || room !== record) return false;
      const message = find(record, source.id);
      if (lifetime.disposed || message !== source) return false;
      const again = recordOf(record.id);
      return !lifetime.disposed && again === record;
    }
    function forMessage(record, source) {
      if (!current(record, source)) return undefined;
      const stamp = stampOf(source);
      if (lifetime.disposed || !stamp?.token) return undefined;
      const roomEpoch = epoch(roomEpochs, record), tokenEpoch = epoch(tokenEpochs, stamp.token);
      const live = () => !lifetime.disposed && roomEpoch === epoch(roomEpochs, record) && tokenEpoch === epoch(tokenEpochs, stamp.token);
      const check = () => { if (!live()) throw STOP; };
      const same = next => next?.token === stamp.token && next.contentRevision === stamp.contentRevision && next.snapshotRevision === stamp.snapshotRevision;
      function valid() {
        if (!live() || !current(record, source) || !live()) return false;
        const next = stampOf(source);
        return live() && same(next) && current(record, source) && live();
      }
      if (!valid()) return undefined;
      let cache = caches.get(record), held = cache?.get(stamp.token);
      if (held?.snapshotRevision === stamp.snapshotRevision && held.projection) return held.projection;
      if (held?.snapshotRevision !== stamp.snapshotRevision) held = undefined;
      const entry = { snapshotRevision: stamp.snapshotRevision, parts: new Map(held?.parts), calls: held?.calls || new Map(), text: held?.text, header: held?.header, projection: null };
      const copy = value => {
        check();
        const result = value === undefined ? undefined : root.VIBEROOM_OWNED_JSON.copyOrdered(value, "Message projection");
        check(); return result;
      };
      function part(name, value) {
        if (value === null || typeof value !== "object") return value;
        const cached = entry.parts.get(name);
        if (cached?.source === value) return cached.value;
        let data;
        if (name === "toolCalls" && Array.isArray(value)) {
          const previous = entry.calls, next = new Map();
          data = Object.freeze(value.map(call => {
            check();
            const old = previous.get(call.toolCallId), item = old?.source === call ? old.value : copy(call);
            if (!next.has(call.toolCallId)) next.set(call.toolCallId, { source: call, value: item });
            return item;
          }));
          entry.calls = next;
        } else data = copy(value);
        entry.parts.set(name, { source: value, value: data });
        return data;
      }
      try {
        const data = [];
        for (const name of fields) {
          check();
          if (Object.hasOwn(source, name)) data.push([name, part(name, source[name])]);
        }
        if (!valid()) return undefined;
        entry.projection = Object.freeze({ token: stamp.token, contentRevision: stamp.contentRevision,
          snapshotRevision: stamp.snapshotRevision, message: Object.freeze(Object.fromEntries(data)) });
        if (!cache || caches.get(record) !== cache) { cache = new Map(); caches.set(record, cache); }
        cache.set(stamp.token, entry);
        return entry.projection;
      } catch (error) { if (error === STOP) return undefined; throw error; }
    }
    function changed(record, change) {
      if (lifetime.disposed) return;
      const { token, snapshotRevision, part, toolIds } = change;
      tokenEpochs.set(token, epoch(tokenEpochs, token) + 1);
      const cache = caches.get(record), entry = cache?.get(token);
      if (!entry) return;
      if (part === "all" || snapshotRevision !== entry.snapshotRevision + 1) { cache.delete(token); return; }
      const affected = root.VIBEROOM_CONVERSATION_STATE.projectionRules.fields[part];
      if (!affected) throw new TypeError("Unknown message projection part");
      entry.projection = null; entry.snapshotRevision = snapshotRevision;
      if (part === "bodyState" || affected.some(field => textFields.includes(field))) entry.text = undefined;
      if (affected.some(field => headerFields.includes(field))) entry.header = undefined;
      for (const field of affected) entry.parts.delete(field);
      if (part === "tools") {
        if (toolIds) for (const id of toolIds) entry.calls?.delete(id);
        else entry.calls?.clear();
      }
    }
    function removed(record, tokens) {
      if (lifetime.disposed) return;
      const cache = caches.get(record);
      for (const token of tokens) { tokenEpochs.set(token, epoch(tokenEpochs, token) + 1); cache?.delete(token); }
    }
    function reset(record) {
      if (lifetime.disposed || !record) return;
      roomEpochs.set(record, epoch(roomEpochs, record) + 1); caches.delete(record);
    }
    function forTool(record, source, toolCallId) {
      const projection = forMessage(record, source);
      if (!projection || projection.message.bodyMissing) return undefined;
      const toolCall = caches.get(record)?.get(projection.token)?.calls.get(toolCallId)?.value;
      return toolCall ? Object.freeze({ token: projection.token, contentRevision: projection.contentRevision,
        snapshotRevision: projection.snapshotRevision, toolCall }) : undefined;
    }
    function forText(record, source) {
      if (!current(record, source)) return undefined;
      const stamp = stampOf(source);
      if (lifetime.disposed || !stamp?.token) return undefined;
      const roomEpoch = epoch(roomEpochs, record), tokenEpoch = epoch(tokenEpochs, stamp.token);
      if (!current(record, source) || lifetime.disposed) return undefined;
      const again = stampOf(source);
      if (lifetime.disposed || epoch(roomEpochs, record) !== roomEpoch || epoch(tokenEpochs, stamp.token) !== tokenEpoch
        || again?.token !== stamp.token || again.snapshotRevision !== stamp.snapshotRevision) return undefined;
      const held = caches.get(record)?.get(stamp.token);
      if (held?.snapshotRevision === stamp.snapshotRevision && held.text) return held.text;
      const projection = forMessage(record, source);
      if (!projection || projection.message.bodyMissing) return undefined;
      const entry = caches.get(record)?.get(projection.token);
      if (!entry) return undefined;
      entry.text ||= Object.freeze({ token: projection.token, textToken: Object.freeze({}),
        frame: Object.freeze(Object.fromEntries(textFields.filter(field => Object.hasOwn(projection.message, field)).map(field => [field, projection.message[field]]))) });
      return entry.text;
    }
    function forHeader(record, source, collection) {
      const currentHeader = () => current(record, source, (record, id) => headerMessageOf(record, id, collection));
      if (!currentHeader()) return undefined;
      const stamp = stampOf(source);
      if (lifetime.disposed || !stamp?.token) return undefined;
      const roomEpoch = epoch(roomEpochs, record), tokenEpoch = epoch(tokenEpochs, stamp.token);
      const live = () => !lifetime.disposed && roomEpoch === epoch(roomEpochs, record) && tokenEpoch === epoch(tokenEpochs, stamp.token);
      function valid() {
        if (!live() || !currentHeader() || !live()) return false;
        const next = stampOf(source);
        return live() && next?.token === stamp.token && next.snapshotRevision === stamp.snapshotRevision && currentHeader() && live();
      }
      if (!valid()) return undefined;
      let cache = caches.get(record), entry = cache?.get(stamp.token);
      if (entry?.snapshotRevision !== stamp.snapshotRevision) entry = undefined;
      if (entry?.header) return entry.header;
      const next = entry || { snapshotRevision: stamp.snapshotRevision, parts: new Map(), projection: null };
      const data = [];
      for (const field of headerFields) {
        if (!live()) return undefined;
        if (!Object.hasOwn(source, field)) continue;
        const value = source[field], old = next.parts.get(field);
        const copy = value !== null && typeof value === "object"
          ? old?.source === value ? old.value : root.VIBEROOM_OWNED_JSON.copyOrdered(value, "Message header") : value;
        if (!live()) return undefined;
        if (value !== null && typeof value === "object") next.parts.set(field, { source: value, value: copy });
        data.push([field, copy]);
      }
      if (!valid()) return undefined;
      next.header = Object.freeze({ token: stamp.token, headerToken: Object.freeze({}), header: Object.freeze(Object.fromEntries(data)) });
      if (!cache || caches.get(record) !== cache) { cache = new Map(); caches.set(record, cache); }
      cache.set(stamp.token, next); return next.header;
    }
    return Object.freeze({ forMessage, forTool, forText, forHeader, changed, removed, reset, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "tools", { value: true });
  Object.defineProperty(create, "textFrames", { value: true });
  Object.defineProperty(create, "headers", { value: true });
  root.VIBEROOM_MESSAGE_PROJECTIONS = Object.freeze({ create, fields, headerFields });
})(globalThis);
