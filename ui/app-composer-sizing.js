// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create({ app, input, composer, grip }, { window: view = input.ownerDocument.defaultView,
    signal, layout, readHeight, writeHeight, onManualChange } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let minimum = Number(readHeight()) || 0, bounds = "", boundsMinimum = null, dirty = true, frame = 0, drag = null;
    const ceiling = () => Math.max(120, app.clientHeight - 260);
    function size() {
      if (owner.disposed) return;
      const min = Math.max(36, minimum);
      if (!dirty && boundsMinimum === min) return;
      const max = Math.min(ceiling(), Math.max(180, min));
      boundsMinimum = min; dirty = false;
      if (bounds === `${min}/${max}`) return;
      bounds = `${min}/${max}`;
      input.style.minHeight = `${min}px`; input.style.maxHeight = `${max}px`;
    }
    function soon() {
      if (owner.disposed || frame) return;
      frame = owner.frame(() => { frame = 0; size(); });
    }
    function invalidate() {
      if (owner.disposed) return;
      dirty = true; onManualChange(); soon();
    }
    owner.on(view, "resize", invalidate);
    owner.observer(view.ResizeObserver, invalidate).observe(app);
    owner.on(grip, "pointerdown", event => {
      if (event.button !== 0) return;
      drag = { y: layout().length(event.clientY), h: input.offsetHeight, pointer: event.pointerId };
      grip.setPointerCapture(event.pointerId); composer.classList.add("resizing"); event.preventDefault();
    });
    owner.on(grip, "pointermove", event => {
      if (!drag) return;
      minimum = Math.round(Math.min(ceiling(), Math.max(36, drag.h + drag.y - layout().length(event.clientY))));
      onManualChange(); size();
    });
    const stop = () => {
      if (!drag) return;
      drag = null; composer.classList.remove("resizing"); writeHeight(minimum);
    };
    owner.on(grip, "pointerup", stop);
    owner.on(grip, "pointercancel", stop);
    owner.on(grip, "dblclick", () => { minimum = 0; onManualChange(); writeHeight(0); size(); });
    owner.own(() => {
      if (drag) { try { grip.releasePointerCapture(drag.pointer); } catch { } }
      drag = null; composer.classList.remove("resizing");
    });
    const dispose = () => owner.dispose();
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ size, soon, invalidate, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_COMPOSER_SIZING = Object.freeze({ create });
})(globalThis);
