// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function markup({ icon = () => "" } = {}) {
    return `<form id="save-template-form" method="dialog">
      <h3><span class="h-ico">${icon("rooms")}</span>Turn this room into a template</h3>
      <p class="lead">Everything below goes into the template: the room's settings and rules, its folder, and each vibemate with the coding agent it runs on. Check it, name it, create it.</p>
      <label>Template name<input id="stp-name" type="text" maxlength="60" required placeholder="e.g. Payments refactor"></label>
      <label>Description <span class="hint">(optional)</span><textarea id="stp-desc" rows="2" maxlength="400" placeholder="what this setup is good for"></textarea></label>
      <div class="stp-preview" id="stp-preview"></div>
      <p class="error" id="stp-error" hidden></p>
      <div class="actions"><button type="button" data-ui="button" data-kind="ghost" data-template-close>Cancel</button><button type="submit" data-ui="button" data-kind="primary" id="stp-create">Create the template</button></div>
    </form>`;
  }
  function create(dialog, { window: view = dialog?.ownerDocument.defaultView, signal, icon,
    renderForm, readForm, previewTemplate, saveTemplate, onSaved, openDialog, closeDialog, chooseFolder } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let visit = 0, disposed = false, pending = false, selected = null, ready = false;
    dialog.innerHTML = markup({ icon });
    const find = selector => dialog.querySelector(selector);
    const form = find("#save-template-form"), name = find("#stp-name"), description = find("#stp-desc");
    const preview = find("#stp-preview"), error = find("#stp-error"), submit = find("#stp-create");
    const active = entered => !disposed && !signal?.aborted && visit === entered && dialog.open && !dialog.classList.contains("closing");
    const busy = () => { if (!disposed) { submit.disabled = pending; submit.textContent = pending ? "Creating…" : "Create the template"; } };
    const showError = failure => { error.textContent = failure.message; error.hidden = false; };
    async function open(room) {
      if (disposed) return false;
      const entered = ++visit;
      selected = { id: room.id, uuid: room.uuid, name: room.name };
      const target = { ...selected };
      ready = false; error.hidden = true; error.textContent = "";
      name.value = target.name; description.value = "";
      preview.innerHTML = '<span class="hint">loading…</span>';
      busy(); openDialog(dialog);
      try {
        const result = await previewTemplate(target);
        if (!active(entered)) return false;
        preview.innerHTML = renderForm(result.template); ready = true;
        return true;
      } catch (failure) { if (active(entered)) showError(failure); return false; }
    }
    owner.on(dialog, "close", () => { if (!dialog.open) { ++visit; ready = false; } });
    owner.on(find("[data-template-close]"), "click", () => closeDialog(dialog));
    owner.on(preview, "click", event => {
      const button = event.target.closest?.("button");
      if (!button || !preview.contains(button)) return;
      if (button.hasAttribute("data-stp-remove")) button.closest(".stp-vm")?.remove();
      if (button.hasAttribute("data-stp-browse")) {
        const entered = visit, input = preview.querySelector("#stp-dir");
        chooseFolder(input.value, dir => { if (active(entered) && preview.contains(input)) input.value = dir; });
      }
    });
    owner.on(form, "submit", async event => {
      event.preventDefault();
      if (pending || disposed || !dialog.open || !ready) return;
      const entered = visit, target = { ...selected }, edited = readForm(preview);
      const value = { name: name.value, description: description.value, emoji: edited.emoji,
        template: { dir: edited.dir, settings: edited.settings, vibemates: edited.vibemates } };
      pending = true; busy();
      let result;
      try { result = await saveTemplate(target, value); }
      catch (failure) { if (active(entered)) showError(failure); return; }
      finally { pending = false; busy(); }
      if (disposed || signal?.aborted) return;
      onSaved(result);
      if (active(entered)) closeDialog(dialog);
    });
    function dispose() {
      if (disposed) return;
      disposed = true; ++visit; owner.dispose();
      if (dialog.open) closeDialog(dialog);
    }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ open, dispose, get signal() { return owner.signal; } });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_TEMPLATE_DIALOG = Object.freeze({ markup, create });
})(typeof window !== "undefined" ? window : globalThis);
