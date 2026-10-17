// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create(uiRoot, { signal, layout, recall, remember, forget,
    window = uiRoot.ownerDocument.defaultView } = {}) {
    signal?.throwIfAborted();
    const document = uiRoot.ownerDocument, Element = window.Element;
    const lifetime = root.VIBEROOM_APP_LIFETIME.create({ window });
    const domResources = root.VIBEROOM_APP_DOM_LIFETIME.create({ root: uiRoot, lifetime });
    const owns = node => uiRoot.contains(node), $$ = selector => [...uiRoot.querySelectorAll(selector)];
    const ResizeObserver = window.ResizeObserver;
    const setTimeout = window.setTimeout.bind(window), clearTimeout = window.clearTimeout.bind(window);
    const DIALOG_MIN_W = 320;
    const DIALOG_MIN_H = 220;
    const dialogSizeKey = (dialog) => `dialog.${dialog.id || "unnamed"}.size`;
    const dialogFits = (w, h) => ({
      w: Math.max(DIALOG_MIN_W, Math.min(w, Math.round(layout().length(window.innerWidth) * 0.94))),
      h: Math.max(DIALOG_MIN_H, Math.min(h, Math.round(layout().length(window.innerHeight) * 0.92))),
    });
    function restoreDialogSize(dialog) {
      if (lifetime.disposed || !owns(dialog)) return;
      const saved = recall(dialogSizeKey(dialog));
      if (!saved) return;
      const [w, h] = String(saved).split("x").map(Number);
      if (!w || !h) return;
      const size = dialogFits(w, h);
      dialog.style.width = `${size.w}px`;
      dialog.style.height = `${size.h}px`;
      dialog.classList.add("sized");
    }
    function resetDialogSize(dialog) {
      if (lifetime.disposed || !owns(dialog)) return;
      clearTimeout(dialog.sizeTimer); dialog.sizeTimer = null;
      dialog.style.width = "";
      dialog.style.height = "";
      dialog.classList.remove("sized");
      remember(dialogSizeKey(dialog), "");
      try {
        forget(dialogSizeKey(dialog));
      } catch {
      }
    }
    let dialogSizes = null;
    const dialogSizeScopes = new WeakMap();
    function watchDialogSize(dialog) {
      if (lifetime.disposed || !owns(dialog) || !window.ResizeObserver) return;
      if (!dialogSizes) {
        dialogSizes = domResources.observe(ResizeObserver, (entries) => {
          for (const entry of entries) {
            const el = entry.target;
            if (!dialogSizeScopes.has(el) || !el.open || !el.style.width) continue;
            const box = entry.borderBoxSize && entry.borderBoxSize[0];
            const w = Math.round(box ? box.inlineSize : entry.contentRect.width);
            const h = Math.round(box ? box.blockSize : entry.contentRect.height);
            if (w >= DIALOG_MIN_W && h >= DIALOG_MIN_H) {
              clearTimeout(el.sizeTimer);
              const active = dialogSizeScopes.get(el);
              el.sizeTimer = setTimeout(() => {
                if (dialogSizeScopes.get(el) === active && el.open && el.style.width) remember(dialogSizeKey(el), `${w}x${h}`);
              }, 200);
            }
          }
        }).observer;
      }
      if (!dialogSizeScopes.has(dialog)) {
        const scope = domResources.scope();
        dialogSizeScopes.set(dialog, scope.release);
        scope.own(() => {
          dialogSizes.unobserve(dialog);
          clearTimeout(dialog.sizeTimer); dialog.sizeTimer = null;
          delete dialog.dataset.sized;
          dialogSizeScopes.delete(dialog);
        });
        scope.on(dialog, "close", scope.release, { once: true });
        dialog.dataset.sized = "1";
        dialogSizes.observe(dialog);
      }
    }
    lifetime.on(window, "resize", () => {
      for (const dialog of $$("dialog[open]")) {
        if (!dialog.style.width) continue;
        const size = dialogFits(parseInt(dialog.style.width, 10), parseInt(dialog.style.height, 10));
        dialog.style.width = `${size.w}px`;
        dialog.style.height = `${size.h}px`;
      }
    });
    const DIALOG_CORNER = 22;
    function dialogCornerAt(e) {
      const dialog = e.target instanceof Element ? e.target.closest("dialog.dialog[open]") : null;
      if (!dialog || !owns(dialog) || dialog.classList.contains("closing")) return null;
      const r = layout().rect(dialog);
      const right = r.left + dialog.clientLeft + dialog.clientWidth;
      const bottom = r.top + dialog.clientTop + dialog.clientHeight;
      const x = layout().length(e.clientX), y = layout().length(e.clientY);
      return x > right - DIALOG_CORNER && x <= right && y > bottom - DIALOG_CORNER && y <= bottom ? dialog : null;
    }
    let cornerDrag = null;
    let cornerShown = null;
    function showDialogCorner(dialog) {
      if (cornerShown === dialog) return;
      cornerShown?.classList.remove("at-corner");
      cornerShown = dialog;
      dialog?.classList.add("at-corner");
    }
    lifetime.on(uiRoot, "pointerdown", (e) => {
      const dialog = e.button === 0 ? dialogCornerAt(e) : null;
      if (!dialog) return;
      const r = layout().rect(dialog);
      const centred = (before, after) => Math.abs(before - after) < 2;
      cornerDrag = {
        dialog, pointer: e.pointerId, x: layout().length(e.clientX), y: layout().length(e.clientY), w: r.width, h: r.height,
        kx: centred(r.left, layout().length(window.innerWidth) - r.right) ? 2 : 1,
        ky: centred(r.top, layout().length(window.innerHeight) - r.bottom) ? 2 : 1,
      };
      dialog.setPointerCapture(e.pointerId);
      dialog.classList.add("resizing");
      e.preventDefault();
    }, true);
    lifetime.on(document, "pointermove", (e) => {
      if (!cornerDrag) return showDialogCorner(dialogCornerAt(e));
      if (!cornerDrag.dialog.open || !owns(cornerDrag.dialog) || cornerDrag.dialog.classList.contains("closing")) { cancelCorner(); return; }
      if (e.pointerId !== cornerDrag.pointer) return;
      const d = cornerDrag;
      const size = dialogFits(Math.round(d.w + d.kx * (layout().length(e.clientX) - d.x)), Math.round(d.h + d.ky * (layout().length(e.clientY) - d.y)));
      d.dialog.style.width = `${size.w}px`;
      d.dialog.style.height = `${size.h}px`;
      d.dialog.classList.add("sized");
    });
    function endCornerDrag(e) {
      if (!cornerDrag || e.pointerId !== cornerDrag.pointer) return;
      cornerDrag.dialog.classList.remove("resizing");
      cornerDrag = null;
    }
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) lifetime.on(document, type, endCornerDrag, true);
    lifetime.on(uiRoot, "close", (e) => {
      if (e.target === cornerShown) showDialogCorner(null);
      if (e.target === cornerDrag?.dialog) cancelCorner();
    }, true);
    lifetime.on(uiRoot, "dblclick", (e) => {
      const dialog = dialogCornerAt(e);
      if (dialog) resetDialogSize(dialog);
    });
    const holdCornerTouch = (e) => {
      if (e.touches.length === 1 && dialogCornerAt(e.touches[0])) e.preventDefault();
    };
    const touchNodes = new WeakSet();
    function wireCornerTouch(dialog) {
      if (lifetime.disposed || !owns(dialog) || touchNodes.has(dialog)) return;
      touchNodes.add(dialog);
      domResources.nodeListener(dialog, "touchstart", holdCornerTouch, { passive: false });
    }
    $$("dialog.dialog").forEach(wireCornerTouch);
    function cancelCorner() {
      if (!cornerDrag) return;
      const drag = cornerDrag; cornerDrag = null;
      try { drag.dialog.releasePointerCapture(drag.pointer); } catch { }
      drag.dialog.classList.remove("resizing");
    }
    function releaseNode(node) {
      if (lifetime.disposed) return;
      dialogSizeScopes.get(node)?.();
      if (node === cornerShown) showDialogCorner(null);
      if (node === cornerDrag?.dialog) cancelCorner();
    }
    lifetime.own(() => { cancelCorner(); showDialogCorner(null); });
    const dispose = () => lifetime.dispose();
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ restore: restoreDialogSize, reset: resetDialogSize, watch: watchDialogSize,
      wireTouch: wireCornerTouch, releaseNode, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_DIALOG_SIZING = Object.freeze({ create });
})(globalThis);
