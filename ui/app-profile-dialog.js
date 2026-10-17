// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function markup({ icon = () => "" } = {}) { return `<form id="profile-form" method="dialog">
      <div class="welcome-art scene-art wb-scene" id="pf-art" role="img" aria-label="Three vibemates come up one after another and wave hello; one of them says it with a heart"></div>
      <h3 class="welcome-title">Welcome to viberoom</h3>
      <p class="lead welcome-lead">Your vibemates are glad you are here. Start with your name: it is how they will know you in every room. The face and the line are up to you, and you can change all of it later under Your vibe.</p>
      <label>Vibename <span class="hint">(your name in every room)</span><input id="pf-name" type="text" maxlength="24" required autocomplete="off" placeholder="letters, digits, _ or -"></label>
      <label>Vibeface <span class="hint">(pick one, or type any emoji)</span>
        <div id="pf-avatar-picker"></div>
        <input id="pf-avatar" type="text" maxlength="40" placeholder="custom emoji (optional)"></label>
      <label>Your vibe line <span class="hint">(a sentence or two about you)</span><button type="button" class="geek-tip" title="For geeks"><span>${icon("geek")}</span>for geeks</button><span class="geek-text" hidden>The vibemates get this line in every room's brief, so they know who they are talking to. A room can add its own line or replace it (Your vibe, in the room).</span>
        <textarea id="pf-desc" rows="3" maxlength="200" placeholder="e.g. software engineer, enjoys learning; likes short answers"></textarea></label>
      <p class="error" id="pf-error" hidden></p>
      <div class="actions"><button type="submit" data-ui="button" data-kind="primary" data-size="lg">Start vibing</button></div>
    </form>`; }
  function create(dialog, { window: view = dialog?.ownerDocument.defaultView, signal, icon, scene, makePicker,
    saveProfile, onSaved, onContinue, openDialog, closeDialog } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let disposed = false, visit = 0, pending = false, picker = null;
    dialog.innerHTML = markup({ icon });
    const find = selector => dialog.querySelector(selector);
    const form = find("#profile-form"), name = find("#pf-name"), face = find("#pf-avatar"), description = find("#pf-desc");
    const error = find("#pf-error"), pickerHost = find("#pf-avatar-picker");
    const active = entered => !disposed && !signal?.aborted && visit === entered && dialog.open && !dialog.classList.contains("closing");
    owner.own(() => picker?.dispose());
    function open(value) {
      if (disposed || dialog.open) return false;
      const entered = ++visit;
      picker?.dispose(); picker = null;
      name.value = value.humanName && value.humanName !== "Human" ? value.humanName : "";
      face.value = value.humanAvatar || ""; description.value = value.humanDescription || "";
      pickerHost.innerHTML = "";
      picker = makePicker(face.value, chosen => { if (active(entered)) face.value = chosen; }, face, { root: dialog, signal: owner.signal });
      pickerHost.appendChild(picker);
      error.hidden = true; error.textContent = "";
      find("#pf-art").innerHTML = scene();
      openDialog(dialog); name.focus(); return true;
    }
    owner.on(dialog, "close", () => { if (!dialog.open) ++visit; });
    owner.on(dialog, "cancel", event => event.preventDefault());
    owner.on(form, "submit", async event => {
      event.preventDefault();
      if (pending || !active(visit)) return;
      const entered = visit;
      const value = { humanName: name.value.trim(), humanAvatar: face.value.trim(), humanDescription: description.value.trim(), profileCompleted: true };
      pending = true;
      let result;
      try { result = await saveProfile(value); }
      catch (failure) { if (active(entered)) { error.textContent = failure.message; error.hidden = false; } return; }
      finally { pending = false; }
      if (disposed || signal?.aborted) return;
      onSaved(result, value);
      if (!active(entered)) return;
      closeDialog(dialog); onContinue(result);
    });
    function dispose() { if (disposed) return; disposed = true; ++visit; owner.dispose(); if (dialog.open) closeDialog(dialog); }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ open, dispose, get signal() { return owner.signal; } });
  }
  Object.defineProperty(create, "disposable", { value: true }); Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_PROFILE_DIALOG = Object.freeze({ markup, create });
})(typeof window !== "undefined" ? window : globalThis);
