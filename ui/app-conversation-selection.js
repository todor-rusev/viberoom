// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function create(uiRoot, { signal, bar, messages, selected, onCopy, onClear }) {
    signal?.throwIfAborted();
    const owner = global.VIBEROOM_APP_LIFETIME.create({ window: uiRoot.ownerDocument.defaultView });
    const button = bar.querySelector('[data-act="copy"]');
    owner.on(button, "click", () => onCopy());
    owner.on(bar.querySelector('[data-act="clear"]'), "click", onClear);
    owner.on(uiRoot, "pointerdown", event => { if (selected() && !bar.contains(event.target)) onClear(); });
    owner.on(uiRoot, "focusin", event => { if (selected() && !bar.contains(event.target) && !messages.contains(event.target)) onClear(); });
    function render(value) {
      bar.hidden = !value;
      const pending = !!value?.busy;
      button.disabled = pending; button.textContent = pending ? "Copying…" : "Copy";
    }
    function busy(value, pending) {
      if (selected() !== value) return;
      button.disabled = pending; button.textContent = pending ? "Copying…" : "Copy";
    }
    owner.own(() => { bar.hidden = true; });
    const dispose = () => owner.dispose();
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ render: owner.guard(render), busy: owner.guard(busy), dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  global.VIBEROOM_CONVERSATION_SELECTION = Object.freeze({ create });
})(globalThis);
