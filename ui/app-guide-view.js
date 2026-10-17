// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create(uiRoot, { signal, UI, src = "/guide.html", listenKey, window = uiRoot.ownerDocument.defaultView } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window });
    const scopes = root.VIBEROOM_APP_DOM_LIFETIME.create({ root: uiRoot, lifetime: owner });
    let visit = null;
    function open() {
      if (owner.disposed || visit || uiRoot.querySelector('[id="guide-view"]')) return;
      const scope = scopes.scope(), view = uiRoot.ownerDocument.createElement("div");
      view.id = "guide-view"; view.className = "guide-view";
      const safeSrc = String(src).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
      view.innerHTML = `<div class="gv-bar">${UI.html("button", { label: "Back", icon: "back", kind: "secondary", size: "sm", act: "guide-close", title: "Back to viberoom (Esc)" })}</div><iframe class="gv-frame" src="${safeSrc}" title="The guide"></iframe>`;
      const current = { scope, view }; visit = current;
      scope.own(() => { view.remove(); if (visit === current) visit = null; });
      scope.on(view.querySelector('[data-act="guide-close"]'), "click", scope.release);
      scope.own(listenKey(scope.guard(event => { if (event.key === "Escape") scope.release(); })));
      uiRoot.appendChild(view);
    }
    function close() { if (!owner.disposed) visit?.scope.release(); }
    const dispose = () => owner.dispose();
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ open, close, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_GUIDE_VIEW = Object.freeze({ create });
})(globalThis);
