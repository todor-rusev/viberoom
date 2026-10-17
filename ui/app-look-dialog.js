// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function markup({ icon = () => "" } = {}) { return `<form id="look-form" method="dialog">
      <h3><span class="h-ico">${icon("eye")}</span>Pick a look</h3>
      <p class="lead">How viberoom is drawn. A click tries a look on the window at once; change it, or fine-tune it, any time under Settings → Appearance.</p>
      <div class="look-cards" id="look-dialog-cards"></div>
      <div class="actions"><button type="submit" data-ui="button" data-kind="primary" data-size="lg">Keep this look</button></div>
    </form>`; }
  function create(dialog, { window: view = dialog?.ownerDocument.defaultView, signal, UI, icon, getLooks,
    saveLook, onError, onClosed, openDialog, closeDialog } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let disposed = false, visit = 0;
    dialog.innerHTML = markup({ icon });
    const cards = dialog.querySelector("#look-dialog-cards"), form = dialog.querySelector("#look-form");
    const active = entered => !disposed && !signal?.aborted && visit === entered && dialog.open && !dialog.classList.contains("closing");
    function open() {
      if (disposed) return false;
      ++visit;
      const { current, looks } = getLooks();
      cards.innerHTML = looks.map(({ look, tag }) => UI.html("look-card", { look, tag, on: look.id === current, data: { look: look.id } })).join("");
      openDialog(dialog); return true;
    }
    owner.on(cards, "click", async event => {
      const card = event.target.closest?.('[data-ui="look-card"]');
      if (!card || !cards.contains(card) || !active(visit)) return;
      const entered = visit, look = card.dataset.look;
      cards.querySelectorAll('[data-ui="look-card"]').forEach(one => { UI.setState(one, one === card ? "on" : null); one.setAttribute("aria-pressed", one === card ? "true" : "false"); });
      try { await saveLook(look); }
      catch (failure) { if (active(entered)) onError(failure); }
    });
    owner.on(form, "submit", event => { event.preventDefault(); closeDialog(dialog); });
    owner.on(dialog, "close", () => { if (!dialog.open) { ++visit; if (!disposed) onClosed(); } });
    function dispose() { if (disposed) return; disposed = true; ++visit; owner.dispose(); if (dialog.open) closeDialog(dialog); }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ open, dispose, get signal() { return owner.signal; } });
  }
  Object.defineProperty(create, "disposable", { value: true }); Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_LOOK_DIALOG = Object.freeze({ markup, create });
})(typeof window !== "undefined" ? window : globalThis);
