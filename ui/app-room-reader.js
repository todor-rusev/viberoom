// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const identityFields = ["id", "uuid", "createdAt", "scope"];
  function create({ window: view = root, signal, recordOf, factsOf }) {
    const lifetime = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let disposed = false;
    lifetime.own(() => { disposed = true; });
    let cache = new WeakMap(), identities = new WeakMap();
    function dispose() { disposed = true; lifetime.dispose(); cache = new WeakMap(); identities = new WeakMap(); }
    if (signal) {
      if (signal.aborted) dispose();
      else lifetime.on(signal, "abort", dispose, { once: true });
    }
    const current = record => {
      if (disposed || !record) return false;
      const accepted = recordOf(record.id);
      return !disposed && accepted === record;
    };
    function identityForRecord(record) {
      if (!current(record)) return undefined;
      const held = identities.get(record);
      if (held) return current(record) ? held : undefined;
      const fields = [];
      for (const key of identityFields) {
        if (disposed) return undefined;
        if (Object.hasOwn(record, key)) fields.push([key, record[key] === undefined ? undefined
          : root.VIBEROOM_OWNED_JSON.copyOrdered(record[key], "Room identity")]);
      }
      if (!current(record)) return undefined;
      const identity = Object.freeze(Object.fromEntries(fields));
      identities.set(record, identity);
      return identity;
    }
    function forRecord(record) {
      if (!current(record)) return undefined;
      const facts = factsOf(record.id);
      if (!current(record) || !facts) return undefined;
      const held = cache.get(record);
      if (held?.facts === facts) return held.dto;
      const identity = identityForRecord(record);
      if (!identity) return undefined;
      const dto = Object.freeze({ ...identity, ...facts });
      cache.set(record, { identity, facts, dto });
      return dto;
    }
    const reader = Object.freeze({ read(id) {
      if (disposed) return undefined;
      const record = recordOf(id);
      return disposed ? undefined : forRecord(record);
    } });
    return Object.freeze({ reader, forRecord, identityForRecord, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "identities", { value: true });
  root.VIBEROOM_ROOM_READER = Object.freeze({ create });
})(globalThis);
