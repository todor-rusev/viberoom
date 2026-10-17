// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function markup() { return `    <div class="dv-stage" id="dv-stage"></div>
    <div class="dv-bar" id="dv-bar">
      <button type="button" class="dv-btn" id="dv-out" title="Zoom out (−)"><span data-icon="zoom-out"></span></button>
      <button type="button" class="dv-level" id="dv-level" title="Fit the diagram to the window">100%</button>
      <button type="button" class="dv-btn" id="dv-in" title="Zoom in (+)"><span data-icon="zoom-in"></span></button>
      <span class="dv-hint">drag to move · double-click to fit</span>
      <button type="button" class="dv-btn" id="dv-close" title="Close (Esc)"><span data-icon="minimize"></span></button>
    </div>
`; }
  function create(element, { window: view = element?.ownerDocument.defaultView, signal, layout, icon, listenKey } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    element.innerHTML = markup();
    listenKey ??= callback => owner.on(element, "keydown", callback);
    const $ = selector => element.querySelector(selector);
    element.querySelectorAll("[data-icon]").forEach(node => { node.innerHTML = icon(node.dataset.icon); });
    const dv = { el: element, stage: $("#dv-stage"), level: $("#dv-level"), scale: 1, x: 0, y: 0, fit: 1, dragging: false, moved: false };
    const DV_MIN = 0.1;
    const DV_MAX = 8;
    const DV_FIT_MAX = 3;
    const DV_BAR_SPACE = 120;
    function dvApply() {
      dv.stage.style.transform = `translate(${Math.round(dv.x)}px, ${Math.round(dv.y)}px) scale(${dv.scale})`;
      dv.level.textContent = `${Math.round((dv.scale / dv.fit) * 100)}%`;
    }
    function dvFit() {
      const svg = dv.stage.firstElementChild;
      if (!svg) return;
      const box = layout().rect(dv.el);
      const w = Number(svg.dataset.w) || layout().rect(svg).width || 1;
      const h = Number(svg.dataset.h) || layout().rect(svg).height || 1;
      dv.fit = Math.max(DV_MIN, Math.min((box.width - 80) / w, (box.height - DV_BAR_SPACE - 32) / h, DV_FIT_MAX));
      dv.scale = dv.fit;
      dv.x = (box.width - w * dv.scale) / 2;
      dv.y = Math.max(16, (box.height - DV_BAR_SPACE - h * dv.scale) / 2);
      dvApply();
    }
    function dvZoom(factor, cx, cy) {
      const next = Math.min(DV_MAX, Math.max(DV_MIN, dv.scale * factor));
      const box = layout().rect(dv.el);
      const px = (cx ?? box.left + box.width / 2) - box.left;
      const py = (cy ?? box.top + box.height / 2) - box.top;
      dv.x = px - ((px - dv.x) / dv.scale) * next;
      dv.y = py - ((py - dv.y) / dv.scale) * next;
      dv.scale = next;
      dvApply();
    }
    function openDiagram(block) {
      if (owner.disposed) return;
      const svg = block && block.querySelector(".mm-out svg");
      if (!svg) return;
      const rect = layout().rect(svg);
      const clone = svg.cloneNode(true);
      clone.dataset.w = String(rect.width || 800);
      clone.dataset.h = String(rect.height || 600);
      clone.style.maxWidth = "none";
      clone.style.width = `${rect.width || 800}px`;
      clone.style.height = `${rect.height || 600}px`;
      dv.stage.replaceChildren(clone);
      dv.el.hidden = false;
      dvFit();
    }
    function closeDiagram() {
      if (!owner.disposed) clearDiagram();
    }
    function clearDiagram() {
      dv.el.hidden = true;
      dv.stage.replaceChildren();
    }
    owner.on($("#dv-close"), "click", closeDiagram);
    owner.on($("#dv-in"), "click", () => dvZoom(1.25));
    owner.on($("#dv-out"), "click", () => dvZoom(0.8));
    owner.on(dv.level, "click", dvFit);
    owner.on(dv.el, "dblclick", (e) => {
      if (!e.target.closest("#dv-bar")) dvFit();
    });
    owner.on(dv.el, "wheel", (e) => {
        if (e.target.closest("#dv-bar")) return;
        e.preventDefault();
        dvZoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, layout().length(e.clientX), layout().length(e.clientY));
      }, { passive: false });
    owner.on(dv.el, "pointerdown", (e) => {
      if (e.target.closest("#dv-bar")) return;
      dv.dragging = true;
      dv.moved = false;
      dv.pointer = { x: layout().length(e.clientX), y: layout().length(e.clientY) };
      dv.pointerId = e.pointerId;
      dv.el.setPointerCapture(e.pointerId);
      dv.el.classList.add("dragging");
    });
    owner.on(dv.el, "pointermove", (e) => {
      if (!dv.dragging) return;
      const x = layout().length(e.clientX), y = layout().length(e.clientY);
      const dx = x - dv.pointer.x, dy = y - dv.pointer.y;
      if (dx || dy) dv.moved = true;
      dv.x += dx;
      dv.y += dy;
      dv.pointer = { x, y };
      dvApply();
    });
    for (const type of ["pointerup", "pointercancel"]) {
      owner.on(dv.el, type, (e) => {
        if (!dv.dragging) return;
        dv.dragging = false;
        dv.pointerId = null;
        dv.el.classList.remove("dragging");
        if (type === "pointerup" && !dv.moved && !e.target.closest("#dv-bar") && e.target === dv.el) closeDiagram();
      });
    }
    owner.on(view, "resize", () => {
      if (!dv.el.hidden) dvFit();
    });
    owner.own(listenKey(owner.guard((e) => {
      if (dv.el.hidden) return;
      if (e.key === "Escape") return void closeDiagram();
      if (e.key === "+" || e.key === "=") return void dvZoom(1.25);
      if (e.key === "-") return void dvZoom(0.8);
      if (e.key === "0") dvFit();
    })));
    function dispose() {
      if (owner.disposed) return;
      owner.dispose();
      if (dv.dragging) { try { dv.el.releasePointerCapture(dv.pointerId); } catch { } }
      dv.dragging = false; dv.pointerId = null; dv.el.classList.remove("dragging");
      clearDiagram();
    }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ open: openDiagram, close: closeDiagram, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_DIAGRAM_VIEW = Object.freeze({ markup, create });
})(globalThis);
