// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  function markup() {
    return `<form method="dialog" class="folder-change-form">
      <div class="folder-change-heading"><span class="folder-change-mark" data-folder-icon="folder" aria-hidden="true"></span><div><p class="folder-change-room"></p><h3 id="folder-change-title">A new place to work</h3></div></div>
      <p class="lead" id="folder-change-description"></p>
      <div class="folder-change-paths"><div data-folder-from><span>Current folder</span><code></code></div><span class="folder-change-arrow" data-folder-icon="forward" aria-hidden="true"></span><div data-folder-to><span>New folder</span><code></code></div></div>
      <div class="folder-change-people"><span class="folder-change-caption"></span><div class="folder-change-names"></div></div>
      <p class="folder-change-note"></p>
      <div class="folder-change-options">
        <button type="submit" value="now" class="folder-change-option" data-ui="button" data-kind="primary"><span data-folder-icon="refresh" aria-hidden="true"></span><span><strong data-now-title>Restart now</strong><small data-now-detail></small></span><span class="folder-change-choice-arrow" data-folder-icon="forward" aria-hidden="true"></span></button>
        <button type="submit" value="later" class="folder-change-option" data-ui="button" data-kind="secondary"><span data-folder-icon="clock" aria-hidden="true"></span><span><strong>At the next restart</strong><small>Keep working for now. Switch folders when each vibemate next restarts.</small></span></button>
      </div>
      <div class="actions"><button type="submit" value="cancel" data-ui="button" data-kind="ghost">Cancel</button></div>
    </form>`;
  }
  function create(dialog, { window: view = dialog?.ownerDocument.defaultView, signal, icon = () => "", openDialog, closeDialog } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    dialog.innerHTML = markup();
    dialog.setAttribute("aria-labelledby", "folder-change-title");
    dialog.setAttribute("aria-describedby", "folder-change-description");
    const $ = selector => dialog.querySelector(selector);
    dialog.querySelectorAll("[data-folder-icon]").forEach(node => { node.innerHTML = icon(node.dataset.folderIcon); });
    let question = null;
    function settle(value) {
      const held = question; question = null;
      if (held) held.resolve(value);
    }
    function choose({ name, from, to, participants = [], restartOnly = false, allowLater = true, current = () => true }) {
      settle(null);
      if (owner.disposed || signal?.aborted || !current()) return Promise.resolve(null);
      $(".folder-change-room").textContent = name || "This room";
      $("#folder-change-title").textContent = restartOnly ? "Bring everyone into this folder" : "A new place to work";
      $("#folder-change-description").textContent = restartOnly
        ? "These vibemates have not switched to the selected folder yet. Restart them to use it."
        : "Vibemates open their working folder when they start. Choose when they move to the new one.";
      $("[data-folder-from]").hidden = restartOnly;
      $(".folder-change-arrow").hidden = restartOnly;
      $("[data-folder-from] code").textContent = from || "—";
      $("[data-folder-to] > span").textContent = restartOnly ? "Room folder" : "New folder";
      $("[data-folder-to] code").textContent = to;
      $(".folder-change-caption").textContent = participants.length ? "Vibemates to restart" : "No vibemates are running";
      const names = $(".folder-change-names"); names.replaceChildren();
      for (const participant of participants) {
        const chip = dialog.ownerDocument.createElement("span"); chip.className = "folder-change-person";
        chip.textContent = participant.name; names.appendChild(chip);
      }
      $(".folder-change-note").textContent = participants.length
        ? "Restarting stops replies in progress. Your conversation stays in this room." + (!allowLater && !restartOnly ? " This running version supports an immediate restart only. Restart viberoom to enable the later option." : "")
        : "The next vibemate you start will use the selected folder.";
      $("[data-now-title]").textContent = participants.length ? "Restart now" : "Use this folder";
      $("[data-now-detail]").textContent = participants.length ? "Start fresh in this folder, with the last messages replayed." : "Save the folder for this room.";
      $('button[value="later"]').hidden = restartOnly || !participants.length || !allowLater;
      dialog.returnValue = "";
      const answer = new Promise(resolve => { question = { resolve, current, allowLater: allowLater && !restartOnly && !!participants.length }; });
      const entered = question;
      openDialog(dialog);
      if (!owner.disposed && question === entered && dialog.open && current()) $('button[value="now"]').focus();
      return answer;
    }
    owner.on(dialog, "close", () => {
      const value = dialog.returnValue;
      settle(!owner.disposed && question?.current() && (value === "now" || (value === "later" && question.allowLater)) ? value : null);
    });
    function dispose() {
      if (owner.disposed) return;
      settle(null); owner.dispose();
      if (dialog.open) closeDialog(dialog);
    }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ choose, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  function pendingMarkup(participants, UI) {
    const pending = participants.filter(p => p.kind === "agent" && p.folderPending);
    if (!pending.length) return "";
    return `<div class="folder-pending" role="status"><strong>Folder change waiting</strong><p>${pending.map(p => esc(p.name)).join(", ")} ${pending.length === 1 ? "has" : "have"} not switched to the selected folder yet.</p>${UI.html("button", { label: "Restart them now", icon: "refresh", kind: "secondary", size: "sm", id: "rp-folder-restart" })}</div>`;
  }
  root.VIBEROOM_FOLDER_CHANGE = Object.freeze({ markup, create, pendingMarkup });
})(typeof window !== "undefined" ? window : globalThis);
