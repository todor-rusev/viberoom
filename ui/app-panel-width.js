// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const MIN = 320, MAX = 960, storageKey = key => `panel-width.${key}`;
  function create({ app, panel, grip }, { window: view = panel.ownerDocument.defaultView,
    signal, layout, readTarget, defaultWidth, recall, remember } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let drag = null;
    function apply(px, persist, target = readTarget()) {
      if (owner.disposed) return;
      const width = Math.max(MIN, Math.min(MAX, Math.round(px)));
      panel.style.setProperty("--details-w", `${width}px`);
      if (persist) remember(storageKey(target.key), JSON.stringify({ width, against: defaultWidth() }));
    }
    function fit() {
      if (owner.disposed) return;
      let saved = null;
      try { saved = JSON.parse(recall(storageKey(readTarget().key)) || "null"); } catch { }
      if (saved && saved.against === defaultWidth() && Number.isFinite(saved.width) && saved.width > 0) apply(saved.width, false);
      else panel.style.removeProperty("--details-w");
    }
    function cancel() {
      if (!drag) return;
      const active = drag; drag = null; active.owner.dispose(); app.classList.remove("resizing");
    }
    function reset() {
      if (owner.disposed) return;
      cancel(); remember(storageKey(readTarget().key), ""); fit();
    }
    owner.own(cancel);
    owner.on(grip, "mousedown", event => {
      cancel();
      const target = { ...readTarget() }, against = defaultWidth();
      const active = { owner: root.VIBEROOM_APP_LIFETIME.create({ window: view }), target,
        x: layout().length(event.clientX), width: layout().rect(panel).width, toward: target.side === "left" ? -1 : 1 };
      drag = active; event.preventDefault(); app.classList.add("resizing");
      const current = (finishing = false) => {
        const now = readTarget();
        if (drag !== active || now.key !== target.key || now.identity !== target.identity || now.side !== target.side) {
          cancel(); return false;
        }
        if (finishing && defaultWidth() !== against) { cancel(); fit(); return false; }
        return true;
      };
      const widthAt = e => active.width + active.toward * (active.x - layout().length(e.clientX));
      active.owner.on(view, "mousemove", e => { if (current()) apply(widthAt(e), false, target); });
      active.owner.on(view, "mouseup", e => { if (current(true)) { apply(widthAt(e), true, target); cancel(); } });
    });
    owner.on(grip, "dblclick", reset);
    const dispose = () => owner.dispose();
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ apply, fit, cancel, reset, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_PANEL_WIDTH = Object.freeze({ create });
})(globalThis);
