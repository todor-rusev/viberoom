// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function markup() { return '<img alt="">'; }
  function create(element, { window: view = element?.ownerDocument.defaultView, signal, listenKey } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    element.innerHTML = markup();
    listenKey ??= callback => owner.on(element, "keydown", callback);
    const image = element.querySelector("img");
    function open(src, title) {
      if (owner.disposed) return;
      image.src = src; image.alt = title || ""; element.hidden = false;
    }
    function clear() { element.hidden = true; image.src = ""; }
    function close() { if (!owner.disposed) clear(); }
    owner.on(element, "click", close);
    owner.own(listenKey(owner.guard(event => { if (event.key === "Escape" && !element.hidden) close(); })));
    function dispose() { if (owner.disposed) return; owner.dispose(); clear(); }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ open, close, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_LIGHTBOX = Object.freeze({ markup, create });
})(globalThis);
