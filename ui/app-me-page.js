// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  function markup(value, { UI, settingsCard, settingRow, pickNowHtml, actHtml }) {
    return `
      <div class="page-head"><div><h1>Your vibe</h1><div class="hint">How the vibemates know you, in every room.</div></div></div>
      <div class="me-page">
      <div class="profile">
        ${value.heroAvatar}
        <div class="who">
          <h3>${esc(value.humanName || "")}</h3>
          <div class="tagline">${esc(value.humanDescription || "no vibe line yet")}</div>
        </div>
      </div>
      <div class="panel-sections">
        ${settingsCard("me-vibe", "", [
          settingRow({ label: "Vibename", for: "me-name", hint: "How you appear in every room.", control: UI.raw(`<input type="text" class="input" id="me-name" maxlength="24" value="${esc(value.humanName || "")}">`) }),
          settingRow({ label: "Vibeface", id: "me-avatar-row", hint: "Your face in every room.", control: UI.raw(pickNowHtml(value.smallAvatar, "Pick another face")), fold: UI.raw(`<div id="me-avatar-picker"></div><input type="text" class="input" id="me-avatar" maxlength="40" value="${esc(value.humanAvatar || "")}" placeholder="custom emoji (optional)">`) }),
          settingRow({ label: "Your vibe line", for: "me-desc", stacked: true, hint: "A sentence or two about you.", geek: "The vibemates get it in every room's brief, unless a room adds its own line or replaces it (the room's settings, You in this room).", control: UI.raw(`<textarea class="textarea" id="me-desc" rows="3" maxlength="200" placeholder="e.g. software engineer, enjoys learning; likes short answers">${esc(value.humanDescription || "")}</textarea>`) }),
        ].join(""))}
        ${settingsCard("me-memory", "", settingRow({ label: "Shared memory about you", hint: "Inspect, edit or remove the preferences learned across rooms.", control: actHtml({ label: "Open…", data: { memoryOpen: "user" } }) }))}
        ${settingsCard("me-danger", "Danger zone", settingRow({ label: "Erase my vibe", hint: "Erases everything in this viberoom: your vibe, all rooms and their history, vibemate sessions, your skills. Not undoable.", control: UI.raw(UI.html("button", { label: "Erase my vibe", icon: "bolt", kind: "danger", size: "sm", id: "me-erase" })) }), "danger")}
      </div>
      </div>`;
  }
  function read(page) {
    const find = selector => page.querySelector(selector);
    return { humanName: find("#me-name").value, humanAvatar: find("#me-avatar").value, humanDescription: find("#me-desc").value };
  }
  function render(page, value, ports) {
    page.innerHTML = markup(value, ports);
    const find = selector => page.querySelector(selector), face = find("#me-avatar");
    const picker = ports.makePicker(value.humanAvatar || "", chosen => {
      face.value = chosen; face.dispatchEvent(new page.ownerDocument.defaultView.Event("change", { bubbles: true }));
      ports.closeFold(find("#me-avatar-row"));
    }, face);
    find("#me-avatar-picker").appendChild(picker);
    ports.bindSave(find("#me-vibe"), () => ports.saveProfile(read(page)));
    ports.listen(find("#me-erase"), "click", ports.onErase);
  }
  root.VIBEROOM_ME_PAGE = Object.freeze({ markup, read, render });
})(typeof window !== "undefined" ? window : globalThis);
