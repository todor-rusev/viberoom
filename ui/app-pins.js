// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

  function create({ button, panel, outside = panel.ownerDocument }, { window: view = panel.ownerDocument.defaultView, signal,
    icon = () => "", glyph = () => "", describe = (pin) => pin, canRender = () => true, refresh = () => {}, onJump = () => {}, onUnpin = () => {}, onLabel = () => {} } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    const document = panel.ownerDocument;
    const drawn = new WeakMap();
    const setHtml = (el, html) => { if (drawn.get(el) === html) return; el.innerHTML = html; drawn.set(el, html); };
    let pins = [];
    let scope = null;
    let rows = [];
    let rowsScope = null;
    function render(next, nextScope) {
      if (owner.disposed || !canRender(nextScope) || owner.disposed) return;
      const editing = !!panel.querySelector(".pin-label-input");
      let nextRows;
      if (!panel.hidden && next.length && !editing) {
        nextRows = [];
        for (const pin of next) {
          const row = describe(pin, nextScope);
          if (owner.disposed || !row || !canRender(nextScope) || owner.disposed) return;
          nextRows.push(row);
        }
      }
      if (!canRender(nextScope) || owner.disposed) return;
      pins = next;
      scope = nextScope;
      button.hidden = pins.length === 0;
      setHtml(button, `<span class="pad" aria-hidden="true"></span>${glyph()}<span class="pin-count"></span>`);
      setText(button.querySelector(".pin-count"), String(pins.length));
      button.title = `${pins.length} pinned message${pins.length === 1 ? "" : "s"}`;
      button.setAttribute("aria-label", button.title);
      if (!pins.length) panel.hidden = true;
      if (panel.hidden) return;
      if (panel.querySelector(".pin-label-input")) return;
      rows = nextRows;
      rowsScope = scope;
      setHtml(panel, rows
        .map((m) => {
          const shown = m.label ? `<span class="tl-text pin-label" title="${esc(m.text)}">${esc(m.label)}</span>` : `<span class="tl-text">${esc(m.text)}</span>`;
          return `<div class="tl-row pin-row${m.mine ? " mine" : ""}" data-id="${esc(m.id)}"><span class="tl-av">${m.face || ""}</span>${shown}<span class="pin-time">${esc(m.when)}</span><button type="button" class="pin-edit" title="${m.label ? "Change this pin's title" : "Give this pin a title of your own"}">${icon("pencil")}</button><button type="button" class="pin-x" title="Unpin">×</button></div>`;
        })
        .join(""));
    }
    let pinEdit = null;
    function editPinLabel(row) {
      const m = rows.find((x) => x.id === row.dataset.id);
      const text = row.querySelector(".tl-text");
      if (!m || !text) return;
      const meant = rowsScope;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "pin-label-input";
      input.maxLength = 120;
      input.value = m.label || "";
      input.placeholder = m.placeholder;
      input.setAttribute("aria-label", "The pin's title");
      text.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = async (keep) => {
        if (done) return;
        done = true;
        pinEdit = null;
        for (const release of releases) release();
        input.remove();
        drawn.delete(panel);
        refresh();
        if (!keep || input.value.trim() === (m.label || "")) return;
        await onLabel(meant, m.id, input.value);
      };
      const releases = [
        owner.on(input, "keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); void finish(true); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); void finish(false); }
        }),
        owner.on(input, "blur", () => void finish(true)),
      ];
      pinEdit = { id: m.id, finish };
    }
    owner.on(panel, "mousedown", (e) => {
      if (pinEdit && e.target.closest(".pin-x, .pin-edit")) e.preventDefault();
    });
    const pinRowOf = (id) => [...panel.querySelectorAll(".pin-row")].find((r) => r.dataset.id === id) || null;
    owner.on(button, "click", () => {
      panel.hidden = !panel.hidden;
      refresh();
    });
    owner.on(panel, "click", (e) => {
      const row = e.target.closest(".pin-row");
      const meant = rowsScope;
      if (!row || meant === null) return;
      if (e.target.closest(".pin-label-input")) return;
      const id = row.dataset.id;
      if (e.target.closest(".pin-edit")) {
        if (pinEdit) void pinEdit.finish(true);
        if (rowsScope !== meant) return;
        const fresh = pinRowOf(id);
        if (fresh) editPinLabel(fresh);
        return;
      }
      if (e.target.closest(".pin-x")) {
        if (pinEdit) void pinEdit.finish(pinEdit.id !== id);
        void onUnpin(meant, id);
        return;
      }
      onJump(meant, id);
      panel.hidden = true;
    });
    owner.on(outside, "click", (e) => {
      if (!panel.hidden && !panel.contains(e.target) && !button.contains(e.target)) panel.hidden = true;
    });
    const dispose = () => { pins = []; rows = []; scope = rowsScope = null; pinEdit = null; owner.dispose(); };
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ render, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  Object.defineProperty(create, "readerScopes", { value: true });
  root.VIBEROOM_PINS = Object.freeze({ create });
})(globalThis);
