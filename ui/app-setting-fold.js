// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function markup(now, title, UI) {
    return `<span class="pick-now" aria-hidden="true">${now}</span>${UI.html("button", { label: "Change…", kind: "secondary", size: "sm", act: "setting-fold", title })}`;
  }
  function create(uiRoot, { signal, window = uiRoot.ownerDocument.defaultView } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window });
    function close(row) {
      if (owner.disposed || !row || !uiRoot.contains(row)) return;
      const fold = row.querySelector(":scope > .fold");
      if (!fold || fold.hidden) return;
      fold.hidden = true;
      row.querySelector('[data-act="setting-fold"]')?.setAttribute("aria-expanded", "false");
    }
    owner.on(uiRoot, "click", event => {
      const button = event.target.closest?.('[data-ui="setting"] [data-act="setting-fold"]');
      if (!button || !uiRoot.contains(button)) return;
      const row = button.closest('[data-ui="setting"]'), fold = row.querySelector(":scope > .fold");
      if (!fold) return;
      fold.hidden = !fold.hidden;
      button.setAttribute("aria-expanded", String(!fold.hidden));
      if (!fold.hidden) fold.querySelector("input, button")?.focus({ preventScroll: true });
    });
    const dispose = () => owner.dispose();
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ close, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_SETTING_FOLD = Object.freeze({ create, markup });
})(globalThis);
