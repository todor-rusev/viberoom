// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function markup() { return `<form method="dialog">
      <h3 id="cf-title">Are you sure?</h3>
      <p class="lead" id="cf-text"></p>
      <div id="cf-extra" hidden></div>
      <div class="actions"><button data-ui="button" data-kind="ghost" id="cf-cancel" value="cancel" type="submit">Cancel</button><button data-ui="button" data-kind="ghost" id="cf-alt" value="alt" type="submit" hidden>Alt</button><button data-ui="button" data-kind="primary" id="cf-ok" value="ok" type="submit">OK</button></div>
    </form>`; }
  function create(dialog, { window: view = dialog?.ownerDocument.defaultView, signal, openDialog } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    dialog.innerHTML = markup();
    const $ = selector => dialog.querySelector(selector);
    function choose(text, opts) {
      if (owner.disposed) return Promise.resolve("cancel");
      const o = opts || {};
      $("#cf-title").textContent = o.title || "Are you sure?";
      $("#cf-text").textContent = text;
      const extra = $("#cf-extra");
      extra.innerHTML = o.extraHtml || "";
      extra.hidden = !o.extraHtml;
      const buttons = { ok: $("#cf-ok"), alt: $("#cf-alt"), cancel: $("#cf-cancel") };
      buttons.ok.textContent = o.okLabel || "OK";
      buttons.cancel.textContent = o.cancelLabel || "Cancel";
      buttons.cancel.hidden = !!o.hideCancel;
      buttons.alt.textContent = o.altLabel || "";
      buttons.alt.hidden = !o.altLabel;
      dialog.classList.toggle("three-way", !!o.altLabel);
      const primary = o.primary || "ok";
      for (const [name, button] of Object.entries(buttons)) button.dataset.kind = name === primary ? (o.danger ? "danger" : "primary") : "ghost";
      return new Promise((resolve) => {
        let settled = false;
        const release = owner.own(() => {
          if (settled) return;
          settled = true;
          dialog.removeEventListener("close", done);
          resolve("cancel");
        });
        const done = () => {
          if (settled) return;
          if (owner.disposed) { release(); return; }
          settled = true;
          dialog.removeEventListener("close", done);
          release();
          if (o.beforeClose) o.beforeClose();
          resolve(dialog.returnValue === "ok" ? "ok" : dialog.returnValue === "alt" ? "alt" : "cancel");
        };
        dialog.addEventListener("close", done);
        dialog.returnValue = "";
        openDialog(dialog);
        buttons[primary].focus();
      });
    }
    function dispose() { owner.dispose(); }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ choose, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_CONFIRM_DIALOG = Object.freeze({ markup, create });
})(typeof window !== "undefined" ? window : globalThis);
