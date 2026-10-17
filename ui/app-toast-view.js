// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create(stack, { signal, icon, window = stack.ownerDocument.defaultView } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window }), shown = new Map();
    function show(text, level, action) {
      if (owner.disposed) return;
      const life = root.VIBEROOM_APP_LIFETIME.create({ window }), el = stack.ownerDocument.createElement("div");
      el.className = `toast ${level || "info"}`;
      el.innerHTML = `${icon(level === "error" ? "close" : level === "warn" ? "alert" : "info")}<span></span>`;
      el.lastChild.textContent = text;
      if (action) {
        const button = stack.ownerDocument.createElement("button");
        button.type = "button";
        button.className = "toast-action";
        button.textContent = action.label;
        let done = false;
        life.on(button, "click", () => { if (done) return; done = true; action.run(); });
        el.appendChild(button);
      }
      const release = owner.own(() => { life.dispose(); el.remove(); shown.delete(el); });
      shown.set(el, release);
      let leaving = false;
      const leave = () => {
        if (leaving) return;
        leaving = true; el.classList.add("leaving"); life.timeout(release, 220);
      };
      life.on(el, "click", leave); stack.appendChild(el);
      life.timeout(leave, level === "error" ? 14000 : 9000);
      while (shown.size > 6) shown.values().next().value();
    }
    const dispose = () => owner.dispose();
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ show, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_TOAST_VIEW = Object.freeze({ create });
})(globalThis);
