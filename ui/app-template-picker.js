// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function markup({ icon = () => "" } = {}) { return `<form id="template-form" method="dialog">
      <h3><span class="h-ico">${icon("rooms")}</span>Start from a template</h3>
      <p class="lead">A template is a room's rules and its vibemates, ready to summon. Pick one, choose who runs each vibemate, name the room.</p>
      <div class="tpl-layout">
        <div class="tpl-pane"><div class="tpl-list" id="tpl-list"></div></div>
        <div class="tpl-pane"><div class="tpl-detail" id="tpl-detail"></div></div>
      </div>
      <label>Room name<input id="tpl-room-name" type="text" maxlength="60" required placeholder="e.g. Payments refactor"></label>
      <label>Working directory <span class="hint">(optional)</span>
        <span class="dir-row"><input id="tpl-room-dir" type="text" placeholder="C:\\projects\\my-app"><button type="button" data-ui="button" data-kind="ghost" class="browse-btn" id="tpl-dir-browse" title="Choose a folder"><span>${icon("folder")}</span>Browse</button></span></label>
      <p class="error" id="tpl-error" hidden></p>
      <div class="actions"><button type="button" data-ui="button" data-kind="ghost" data-picker-close>Cancel</button><button type="submit" data-ui="button" data-kind="primary" id="tpl-create">Create the room</button></div>
    </form>`; }
  function listMarkup(items, current, { UI, esc, avatar, fallbackColor, faceUrl, ic }) {
    return items
      .map((t) => {
        const on = current && t.id === current.id;
        const faces = t.vibemates.slice(0, 4).map((v) => avatar({ name: v.name, avatar: v.avatar, color: fallbackColor }, 20, { ring: true })).join("");
        return `<button type="button" class="tpl-item${on ? " on" : ""}" data-id="${esc(t.id)}" role="radio" aria-checked="${on ? "true" : "false"}">
          <span class="tpl-emoji">${faceUrl(t.emoji) ? `<img class="room-pic" src="${faceUrl(t.emoji)}" alt="">` : esc(t.emoji || "🧩")}</span>
          <span class="tpl-body"><b>${esc(t.name)}${t.builtin ? "" : UI.html("badge", { label: "your template", size: "xs" })}${t.recommended ? UI.html("badge", { label: "recommended", tone: "attention", size: "xs" }) : ""}</b><span class="tpl-meta">${t.vibemates.length} vibemate${t.vibemates.length === 1 ? "" : "s"}${t.builtin ? " · built in" : ""}</span><span class="avatar-stack">${faces}</span></span>
          <span class="tpl-check">${ic("check")}</span>
        </button>`;
      })
      .join("") || '<span class="hint">No templates yet.</span>';
  }
  function detailMarkup(t, ports) {
    const { UI, esc } = ports;
    const rules = String((t.settings || {}).customRules || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let html = `
      <p class="tpl-desc">${esc(t.description)}</p>
      ${rules.length ? `<div class="tpl-rules"><div class="label">Room rules</div><ul>${rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
      <div class="label">Vibemates</div>
      ${t.vibemates
        .map((v, i) => {
          return `<div class="tpl-vm" data-i="${i}">
            <div class="tpl-vm-head"><b>${esc(v.name)}</b>${v.tagline ? `<span class="hint">"${esc(v.tagline)}"</span>` : ""}</div>
            ${v.role ? `<div class="tpl-vm-role">${esc(v.role)}</div>` : ""}
            ${runsOn(v, ports)}
          </div>`;
        })
        .join("")}`;
    if (t.dir) html += `<p class="hint">Folder: <code>${esc(t.dir)}</code> (you can change it below)</p>`;
    html += t.vibemates.some((v) => v.agentType)
      ? '<p class="hint">A vibemate whose coding agent is not installed here waits in the roster until you pick another.</p>'
      : '<p class="hint">You pick the coding agent for each vibemate in the room, right after it opens.</p>';
    return html;
  }
  function runsOn(v, { recipes = [], UI }) {
    if (!v.agentType) return "";
    const rec = recipes.find((r) => r.id === v.agentType);
    const parts = [rec ? rec.vendor : v.agentType, v.model, v.effort, v.mode].filter(Boolean);
    return `<div class="chips tpl-runs">${parts.map((x) => UI.html("chip", { label: x })).join("")}${rec && rec.unavailable ? UI.html("badge", { label: "not installed here", tone: "asleep" }) : ""}</div>`;
  }
  function create(dialog, { window: view = dialog?.ownerDocument.defaultView, signal, icon, getMarkupPorts,
    listTemplates, createRoom, onCreated, onSelect, openDialog, closeDialog, chooseFolder, target } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let disposed = false, visit = 0, pending = false, items = [], current = null, autoName = "", opened = null;
    dialog.innerHTML = markup({ icon });
    const find = selector => dialog.querySelector(selector);
    const form = find("#template-form"), list = find("#tpl-list"), detail = find("#tpl-detail");
    const name = find("#tpl-room-name"), dir = find("#tpl-room-dir"), error = find("#tpl-error"), submit = find("#tpl-create");
    const active = entered => !disposed && !signal?.aborted && visit === entered && dialog.open && !dialog.classList.contains("closing");
    const busy = () => { if (!disposed) { submit.disabled = pending; submit.textContent = pending ? "Summoning…" : "Create the room"; } };
    function select(id) {
      current = items.find(t => t.id === id) || null;
      const ports = getMarkupPorts();
      list.innerHTML = listMarkup(items, current, ports);
      detail.innerHTML = current ? detailMarkup(current, ports) : "";
      if (current) { if (!name.value || name.value === autoName) name.value = current.name; autoName = current.name; }
    }
    async function open() {
      if (disposed) return false;
      const chosen = target?.();
      if (target && !chosen) return false;
      opened = chosen ? { scope: chosen.scope, dir: chosen.dir } : null;
      const entered = ++visit;
      items = []; current = null; autoName = ""; error.hidden = true; error.textContent = "";
      name.value = ""; dir.value = opened?.dir || ""; list.innerHTML = '<span class="hint">loading…</span>'; detail.innerHTML = "";
      busy(); openDialog(dialog);
      try {
        const result = await listTemplates();
        if (!active(entered)) return false;
        items = JSON.parse(JSON.stringify(result.templates || []));
        select(items[0]?.id || null); return true;
      } catch (failure) { if (active(entered)) { error.textContent = failure.message; error.hidden = false; } return false; }
    }
    owner.on(dialog, "close", () => { if (!dialog.open) ++visit; });
    owner.on(find("[data-picker-close]"), "click", () => closeDialog(dialog));
    owner.on(list, "click", event => { const button = event.target.closest?.(".tpl-item"); if (button && list.contains(button)) select(button.dataset.id); });
    owner.on(find("#tpl-dir-browse"), "click", () => {
      const entered = visit; chooseFolder(dir.value, chosen => { if (active(entered)) dir.value = chosen; });
    });
    owner.on(form, "submit", async event => {
      event.preventDefault();
      if (disposed || pending || !dialog.open || !current) return;
      const entered = visit;
      const value = { template: current.id, name: name.value, dir: dir.value.trim() || null,
        vibemates: current.vibemates.map(v => ({ name: v.name, agentType: "" })), ...(opened ? { scope: opened.scope } : {}) };
      pending = true; busy();
      let result;
      try { result = await createRoom(value); }
      catch (failure) { if (active(entered)) { error.textContent = failure.message; error.hidden = false; } return; }
      finally { pending = false; busy(); }
      if (disposed || signal?.aborted) return;
      onCreated(result);
      if (!active(entered)) return;
      closeDialog(dialog);
      if (result.room?.id) onSelect(result.room);
    });
    function dispose() { if (disposed) return; disposed = true; ++visit; owner.dispose(); if (dialog.open) closeDialog(dialog); }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ open, dispose, get signal() { return owner.signal; } });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_TEMPLATE_PICKER = Object.freeze({ markup, listMarkup, detailMarkup, create });
})(typeof window !== "undefined" ? window : globalThis);
