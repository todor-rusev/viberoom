// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function markup({ icon = () => "" } = {}) { return `<form id="erase-form" method="dialog">
      <h3><span class="h-ico danger">${icon("alert")}</span>Erase my vibe</h3>
      <p class="lead">This wipes <strong>everything</strong> in this viberoom: your vibe, all rooms and their history, every vibemate session, your skills (the built-in ones come back). The next start asks you to set a vibe again.</p>
      <label>Type <code>erase</code> to confirm<input id="erase-word" type="text" autocomplete="off" placeholder="erase"></label>
      <p class="error" id="erase-error" hidden></p>
      <div class="actions"><button type="button" data-ui="button" data-kind="ghost" data-erase-close>Keep my vibe</button><button type="submit" id="erase-submit" data-ui="button" data-kind="danger-solid" disabled>Erase everything</button></div>
    </form>`; }
  function create(dialog, { window: view = dialog?.ownerDocument.defaultView, signal, UI, icon, eraseProfile, onErased, openDialog, closeDialog } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let disposed = false, visit = 0, pending = false;
    dialog.innerHTML = markup({ icon });
    const form = dialog.querySelector("#erase-form"), word = dialog.querySelector("#erase-word"), submit = dialog.querySelector("#erase-submit"), error = dialog.querySelector("#erase-error");
    const active = entered => !disposed && !signal?.aborted && visit === entered && dialog.open && !dialog.classList.contains("closing");
    function busy() { if (disposed) return; UI.setState(submit, pending ? "loading" : null); submit.disabled = pending || word.value.trim().toLowerCase() !== "erase"; }
    function open() {
      if (disposed) return false;
      ++visit; word.value = ""; error.hidden = true; error.textContent = ""; busy(); openDialog(dialog); word.focus(); return true;
    }
    owner.on(dialog, "close", () => { if (!dialog.open) ++visit; });
    owner.on(word, "input", busy);
    owner.on(dialog.querySelector("[data-erase-close]"), "click", () => closeDialog(dialog));
    owner.on(form, "submit", async event => {
      event.preventDefault();
      const confirm = word.value.trim().toLowerCase();
      if (pending || !active(visit) || confirm !== "erase") return;
      const entered = visit;
      pending = true; busy();
      try { await eraseProfile(confirm); }
      catch (failure) { if (active(entered)) { error.textContent = failure.message; error.hidden = false; } return; }
      finally { pending = false; busy(); }
      if (!disposed && !signal?.aborted) onErased();
    });
    function dispose() { if (disposed) return; disposed = true; ++visit; owner.dispose(); if (dialog.open) closeDialog(dialog); }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ open, dispose, get signal() { return owner.signal; } });
  }
  Object.defineProperty(create, "disposable", { value: true }); Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_ERASE_DIALOG = Object.freeze({ markup, create });
})(typeof window !== "undefined" ? window : globalThis);
