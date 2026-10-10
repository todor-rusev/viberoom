// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";

  const BEFORE_SAYING = Object.freeze(["window-bar", "unseen-badge", "trace", "save-dialog"]);

  function preload(doc = root.document) {
    const data = doc.documentElement.dataset;
    if (data.viberoomPreload) {
      try {
        const said = JSON.parse(data.viberoomPreload);
        const capabilities = Array.isArray(said?.capabilities) ? said.capabilities.filter((c) => typeof c === "string") : [];
        return { version: Number.isInteger(said?.version) ? said.version : 0, capabilities };
      } catch {
        return { version: 0, capabilities: [] };
      }
    }
    return data.viberoomDesktop ? { version: 0, capabilities: [...BEFORE_SAYING] } : null;
  }

  function can(capability, doc = root.document) {
    const said = preload(doc);
    return !!said && said.capabilities.includes(capability);
  }

  root.ViberoomDesktop = Object.freeze({ preload, can, BEFORE_SAYING });
})(typeof window !== "undefined" ? window : globalThis);
