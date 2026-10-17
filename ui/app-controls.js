// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function mount(uiRoot, { signal, window = uiRoot.ownerDocument.defaultView } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window });
    owner.on(uiRoot, "click", e => {
      const b = e.target.closest && e.target.closest(".geek-tip");
      if (!b || !uiRoot.contains(b)) return;
      e.preventDefault();
      const next = b.nextElementSibling;
      const t = next && next.classList.contains("geek-text") ? next : b.closest('[data-ui="setting"]')?.querySelector(":scope > .geek-text");
      if (!t || !uiRoot.contains(t)) return;
      t.hidden = !t.hidden;
      b.classList.toggle("on", !t.hidden);
      if (b.hasAttribute("aria-expanded")) b.setAttribute("aria-expanded", String(!t.hidden));
    });
    owner.on(uiRoot, "click", e => {
      const step = e.target.closest && e.target.closest('[data-ui="number-field"] > .steps > button');
      if (!step || !uiRoot.contains(step)) return;
      e.preventDefault();
      const field = step.closest('[data-ui="number-field"]');
      if (!uiRoot.contains(field)) return;
      const input = field.querySelector("input");
      if (!input || input.disabled) return;
      try {
        if (step.dataset.act === "up") input.stepUp();
        else input.stepDown();
      } catch { return; }
      const Event = input.ownerDocument.defaultView.Event;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const dispose = () => owner.dispose();
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ dispose });
  }
  Object.defineProperty(mount, "disposable", { value: true });
  Object.defineProperty(mount, "scoped", { value: true });
  root.VIBEROOM_CONTROLS = Object.freeze({ mount });
})(globalThis);
