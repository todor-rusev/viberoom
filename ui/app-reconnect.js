// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const isBack = p => ["idle", "queued", "thinking", "writing"].includes(p.status);
  const same = (a, b) => a?.id === b?.id && (a?.uuid || b?.uuid ? a?.uuid === b?.uuid : a?.createdAt === b?.createdAt);
  function markup({ icon = () => "" } = {}) { return `<form id="reconnect-form" method="dialog">
      <h3><span class="h-ico">${icon("refresh")}</span>Welcome back</h3>
      <p class="lead" id="rc-intro"></p>
      <div class="choice-list">
        <label class="choice"><input type="radio" name="rc-mode" value="replay" checked> <span><strong>Replay the last</strong> <span data-ui="number-field" class="rc-num"><input class="input" id="rc-replay" type="number" min="0" max="500" value="10"><span class="steps" aria-hidden="true"><button type="button" data-act="up" tabindex="-1" title="More"></button><button type="button" data-act="down" tabindex="-1" title="Less"></button></span></span> <strong>chat messages</strong> — a fresh start with the recent history.<span class="rc-is-default" hidden>default</span><button type="button" class="link-btn rc-default" data-mode="replay" hidden>Make default</button><button type="button" class="geek-tip" title="For geeks"><span>${icon("geek")}</span>for geeks</button><span class="geek-text" hidden>A new vibemate session that reads the recent room history (room events in between come along), like a person coming back from a break. Cheap and works for every vibemate.</span></span></label>
        <label class="choice"><input type="radio" name="rc-mode" value="load"> <span><strong>Restore the full session</strong> — the vibemate continues its saved session.<span class="rc-is-default" hidden>default</span><button type="button" class="link-btn rc-default" data-mode="load" hidden>Make default</button><button type="button" class="geek-tip" title="For geeks"><span>${icon("geek")}</span>for geeks</button><span class="geek-text" hidden>Continue the vibemate's saved conversation, including its previous work. A long conversation can make the next reply more costly. If it cannot be restored, the vibemate starts a new session with recent messages from this room.</span></span></label>
      </div>
      <table class="rc-table" id="rc-table"></table>
      <p class="error" id="rc-error" hidden></p>
      <div class="actions">
        <button type="button" data-ui="button" data-kind="ghost" data-reconnect-close>Later</button>
        <button type="submit" id="rc-submit" data-ui="button" data-kind="primary">Reconnect</button>
      </div>
    </form>`; }
  function create(dialog, { window: view = dialog?.ownerDocument.defaultView, signal, UI, icon = () => "",
    saveDefault, defaultMode, saveReplay, reconnect, onLogin, onBack, onError, openDialog, closeDialog } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let disposed = false, visit = 0, model = null, ids = [], only = "";
    const pending = new Set();
    dialog.innerHTML = markup({ icon });
    const find = selector => dialog.querySelector(selector);
    const form = find("#reconnect-form"), table = find("#rc-table"), replayField = find("#rc-replay");
    const error = find("#rc-error"), submit = find("#rc-submit");
    const active = entered => !disposed && !signal?.aborted && visit === entered && dialog.open && !dialog.classList.contains("closing");
    const listed = () => ids.map(id => model?.participants.find(p => p.id === id)).filter(p => p && (!p.muted || p.id === only));
    function defaults(mode) {
      for (const choice of form.querySelectorAll(".choice")) {
        const value = choice.querySelector('input[name="rc-mode"]').value;
        choice.querySelector(".rc-is-default").hidden = value !== mode;
        choice.querySelector(".rc-default").hidden = value === mode;
      }
    }
    function renderRows() {
      const all = listed();
      const prior = new Map([...table.querySelectorAll("tr")].map(tr => [tr.dataset.id, { choice: tr.querySelector(".rc-per")?.value || "", stuck: tr.dataset.stuck === "1" }]));
      const freed = [];
    table.innerHTML = all
      .map((p) => {
        const was = prior.get(p.id);
        const back = isBack(p);
        const starting = p.status === "starting";
        const stuck = !back && !starting && p.stuck;
        if (was && was.stuck && !stuck && !back && !starting) freed.push(p.id);
        const recipe = p.recipe;
        const middle = back
          ? UI.html("badge", { label: "back", tone: "ready" })
          : starting
          ? UI.html("badge", { label: "starting…", tone: "waiting" })
          : stuck
          ? `<span class="rc-note rc-stuck">${icon("unplugged")}not logged in</span>`
          : `<span class="rc-note">${p.supportsLoad === false ? "no session/load" : p.sessionId ? "stored session available" : "no stored session"}</span>`;
        const right = back || starting
          ? ""
          : stuck && recipe
          ? UI.html("button", { label: `Log in to ${recipe.vendor}`, kind: "primary", size: "sm", act: "open-login-dialog", icon: "lock", data: { recipe: recipe.id, purpose: "login" } })
          : `<select class="rc-per"><option value="">as above</option><option value="replay"${was && was.choice === "replay" ? " selected" : ""}>replay</option><option value="load"${p.supportsLoad === false || !p.sessionId ? " disabled" : ""}${was && was.choice === "load" ? " selected" : ""}>full session</option><option value="skip"${was && was.choice === "skip" ? " selected" : ""}>leave offline</option></select>`;
        return `<tr data-id="${esc(p.id)}" data-stuck="${stuck ? "1" : ""}">
          <td>${p.mark}<span><strong>${esc(p.name)}</strong> <span class="rc-note">${esc(p.tagline || p.agentVendor || "")}</span></span></td>
          <td>${middle}</td>
          <td>${right}</td>
        </tr>`;
      })
      .join("");
      const canGo = all.some(p => !isBack(p) && p.status !== "starting" && !p.stuck);
      submit.disabled = !canGo || [...pending].some(key => key.startsWith(`${visit}:`));
      submit.title = canGo ? "" : all.some(p => p.stuck) ? "Log in first; the room brings them back by itself" : "";
      if (freed.length) void reconnectRows(freed);
    }
    function refresh() {
      const all = listed();
      if (all.length && all.every(isBack)) {
        closeDialog(dialog);
        onBack(all.length === 1 ? `${all[0].name} is back.` : "Everyone is back.");
      } else renderRows();
    }
    async function reconnectRows(wanted) {
      const entered = visit, target = { id: model.id, uuid: model.uuid, createdAt: model.createdAt };
      const globalMode = form.querySelector('input[name="rc-mode"]:checked').value;
      const replay = Number(replayField.value);
      const rows = [...table.querySelectorAll("tr")].filter(tr => wanted.includes(tr.dataset.id))
        .map(tr => ({ id: tr.dataset.id, choice: tr.querySelector(".rc-per")?.value || globalMode }))
        .filter(row => row.choice !== "skip" && !pending.has(`${entered}:${row.id}`));
      const allowed = new Set(listed().map(p => p.id));
      for (const row of rows) pending.add(`${entered}:${row.id}`);
      if (Number.isFinite(replay) && replay !== model.replay) void saveReplay(target, replay).catch(failure => { if (active(entered)) onError(failure); });
      submit.disabled = true; UI.setState(submit, "loading"); error.hidden = true;
      const failures = [];
      for (const row of rows) {
        if (!allowed.has(row.id)) continue;
        try { await reconnect(target, row.id, { mode: row.choice, replay }); }
        catch (failure) { failures.push(`${row.id}: ${failure.message}`); }
      }
      for (const row of rows) pending.delete(`${entered}:${row.id}`);
      if (!active(entered)) return;
      UI.setState(submit, null);
      if (failures.length) { error.textContent = failures.join(" · "); error.hidden = false; }
      refresh();
    }
    function open(snapshot, { offlineIds, onlyId = "" } = {}) {
      if (disposed || !offlineIds?.length) return false;
      ++visit; model = JSON.parse(JSON.stringify(snapshot)); ids = [...offlineIds]; only = onlyId;
      error.hidden = true; error.textContent = ""; UI.setState(submit, null);
      replayField.value = model.replay; defaults(model.defaultMode);
      form.querySelector(`input[name="rc-mode"][value="${model.defaultMode}"]`).checked = true;
      const person = only && model.participants.find(p => p.id === only);
      submit.textContent = person ? person.wakeWord : "Reconnect";
      find("#rc-intro").textContent = person
        ? `${person.name} is ${person.asleep ? "asleep" : "offline"} in "${model.name}" (${person.asleep ? "you put it to sleep" : person.fell ? "its agent stopped" : "its session ended with the previous room run"}). Choose how it comes back:`
        : `${ids.length} vibemate${ids.length > 1 ? "s are" : " is"} offline in "${model.name}" (their sessions ended with the previous room run). Choose how they come back:`;
      table.dataset.ids = ids.join(","); table.dataset.only = only; table.innerHTML = "";
      renderRows(); openDialog(dialog); return true;
    }
    function update(snapshot, { loginOnly = false } = {}) {
      if (disposed || !dialog.open || !model) return;
      if (!same(model, snapshot)) return;
      model = JSON.parse(JSON.stringify(snapshot));
      if (loginOnly) renderRows(); else refresh();
    }
    owner.on(dialog, "close", () => { if (!dialog.open) ++visit; });
    owner.on(find("[data-reconnect-close]"), "click", () => closeDialog(dialog));
    owner.on(form, "click", async event => {
      const login = event.target.closest?.('[data-act="open-login-dialog"]');
      if (login && form.contains(login)) { event.stopPropagation(); onLogin(login.dataset.recipe, login.dataset.purpose); return; }
      const button = event.target.closest?.(".rc-default");
      if (!button || !form.contains(button)) return;
      const entered = visit, mode = button.dataset.mode;
      try {
        await saveDefault(mode);
        if (!active(entered)) return;
        form.querySelector(`input[name="rc-mode"][value="${mode}"]`).checked = true;
        defaults(defaultMode({ id: model.id, uuid: model.uuid }));
      } catch (failure) { if (active(entered)) onError(failure); }
    });
    owner.on(form, "submit", async event => {
      event.preventDefault();
      if (!dialog.open || !model || [...pending].some(key => key.startsWith(`${visit}:`))) return;
      const entered = visit;
      const wanted = listed().filter(p => !isBack(p) && p.status !== "starting" && !p.stuck).map(p => p.id);
      if (!wanted.length) return;
      await reconnectRows(wanted);
      if (active(entered) && !listed().some(p => p.stuck) && error.hidden) closeDialog(dialog);
    });
    function dispose() { if (disposed) return; disposed = true; ++visit; owner.dispose(); if (dialog.open) closeDialog(dialog); }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ open, update, dispose, get signal() { return owner.signal; } });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_RECONNECT = Object.freeze({ markup, create });
})(typeof window !== "undefined" ? window : globalThis);
