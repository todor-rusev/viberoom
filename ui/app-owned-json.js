// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function owned(value, label, ancestors, immutable, ordered = false) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || ancestors.has(value)) throw new TypeError(`${label} must be JSON`);
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== null && Object.getPrototypeOf(prototype) !== null) throw new TypeError(`${label} must be JSON`);
    ancestors.add(value);
    const keys = array ? null : Object.keys(value);
    const result = array ? Array.from(value, item => owned(item, label, ancestors, immutable, ordered))
      : Object.fromEntries((immutable && !ordered ? keys.sort() : keys).map(key => [key, owned(value[key], label, ancestors, immutable, ordered)]));
    ancestors.delete(value);
    return immutable ? Object.freeze(result) : result;
  }
  const copy = (value, label = "Application data") => owned(value, label, new Set(), true);
  const copyOrdered = (value, label = "Application data") => owned(value, label, new Set(), true, true);
  const clone = (value, label = "Application data") => owned(value, label, new Set(), false);
  root.VIBEROOM_OWNED_JSON = Object.freeze({ copy, copyOrdered, clone });
})(globalThis);
