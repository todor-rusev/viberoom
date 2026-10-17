// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  function loginWords(r) {
    if (r.unavailableReason) return { state: "off", text: "not installed" };
    if (r.loginChecking && !r.loginChecked) return { state: "checking", text: "checking…" };
    if (r.loginState === "missing") return { state: "missing", text: "not logged in" };
    if (r.loginState === "ok") return { state: "ok", text: r.loginChecked?.how === "acp" ? "ready" : "logged in" };
    if (r.loginState === "configured") return { state: "unknown", text: "sign-in set up" };
    return { state: "unknown", text: "installed" };
  }
  function markup() { return `    <form id="invite-form" method="dialog">
      <h3><span class="h-ico" data-icon="spark"></span>Summon a Vibemate</h3>
      <p class="lead">Pick a vibemate, give it a vibename and a character, and it joins the room.</p>
      <div class="agent-grid" id="inv-agents"></div>
      <p class="hint inv-tools">Each tile says whether that agent is installed and logged in, in its own words. <button type="button" data-ui="button" data-kind="ghost" data-size="sm" id="inv-recheck" title="Look for every agent on this machine again, and ask each one whether it is logged in">Check again</button></p>
      <div id="inv-login" class="login-host" hidden></div>
      <p class="hint" id="inv-none" hidden></p>
      <select id="inv-type" hidden></select>
      <div id="inv-options" hidden>
        <div class="choice-row"><span class="label">Model</span><div class="chips" data-for="inv-model"></div><select id="inv-model" hidden></select><input id="inv-model-custom" type="text" placeholder="or type a model name" hidden></div>
        <div class="choice-row"><span class="label">Effort</span><div class="chips" data-for="inv-effort"></div><select id="inv-effort" hidden></select></div>
        <div class="choice-row"><span class="label">Mode</span><div class="chips" data-for="inv-mode"></div><select id="inv-mode" hidden></select></div>
      </div>
      <div class="two-col">
        <label>Vibename <span class="hint req">(required)</span><input id="inv-name" type="text" maxlength="24" required autocomplete="off" placeholder="letters, digits, _ or -"></label>
        <label>Vibersona <span class="hint">(optional; a few words under the vibename)</span><input id="inv-tagline" type="text" maxlength="80" placeholder="e.g. curious analyst"></label>
      </div>
      <label>Vibeface <span class="hint">(pick one, or type any emoji)</span>
        <div id="inv-avatar-picker"></div>
        <input id="inv-avatar" type="text" maxlength="40" placeholder="custom emoji (optional)"></label>
      <label>Vibio <span class="hint">(only this vibemate reads it)</span><button type="button" class="geek-tip" title="For geeks"><span data-icon="geek"></span>for geeks</button><span class="geek-text" hidden>Who it is, how it speaks, what it cares about. It reaches the vibemate as instructions in its brief; the other participants never see it. You can change it later in the vibemate's panel.</span>
        <textarea id="inv-role" rows="4" maxlength="4000" placeholder="e.g. A calm team lead who asks one question at a time."></textarea></label>
      <details class="geek" id="inv-geek">
        <summary><span data-icon="geek"></span>for geeks<span class="g-hint">reply delay, skills, where the vibemate lives</span><span class="chev" data-icon="down"></span></summary>
        <div class="geek-body">
          <label>Reply delay override, seconds<button type="button" class="geek-tip" title="For geeks"><span data-icon="geek"></span>for geeks</button><span class="geek-text" hidden>Empty: the room's delay. A value here overrides it for this vibemate only. Before each turn the vibemate waits a random 0–N seconds, so replies cross less often; messages that arrive meanwhile land in its backlog.</span><span data-ui="number-field"><input class="input" id="inv-delay" type="number" min="0" max="120" step="0.5" placeholder="the room's"><span class="steps" aria-hidden="true"><button type="button" data-act="up" tabindex="-1" title="More"></button><button type="button" data-act="down" tabindex="-1" title="Less"></button></span></span></label>
          <label>Skills <span class="hint">(from the library)</span><div id="inv-skills" class="check-list"></div></label>
          <p class="hint" id="inv-where"></p>
          <p class="hint" id="inv-note"></p>
          <p class="hint accent" id="inv-status"></p>
          <div class="row-btns start"><button type="button" id="inv-refresh" data-ui="button" data-kind="ghost" data-size="sm" title="Ask the vibemate again what it offers"><span data-icon="refresh"></span>Ask the vibemate again what it offers</button></div>
        </div>
      </details>
      <p class="error" id="inv-error" hidden></p>
      <div class="actions">
        <button type="button" data-ui="button" data-kind="ghost" data-invite-close>Cancel</button>
        <button type="submit" id="inv-submit" data-ui="button" data-kind="primary">Summon</button>
      </div>
    </form>
`; }
  function create(dialog, ports) {
    const { window: view = dialog.ownerDocument.defaultView, signal, UI, icon: ic, vendorLogo, makePicker,
      renderSkillChecks, checkedSkills, readOptions, checkRecipes, invite, staff, openLoginDialog,
      openDialog, closeDialog, onError: showError, getSnapshot } = ports;
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    const domResources = root.VIBEROOM_APP_DOM_LIFETIME.create({ root: dialog, lifetime: owner });
    const lifetime = owner, document = dialog.ownerDocument, $ = selector => dialog.querySelector(selector);
    const Event = view.Event, flattenOptions = root.VIBEROOM_AGENT_CONFIG.flattenOptions;
    let disposed = false, visit = 0, pending = false, room = null, optionsRequest = 0, optionsController = null, picker = null;
    const staffing = { id: null }, state = { recipes: [], settings: {}, installs: new Map(), logins: new Map() };
    dialog.innerHTML = markup();
    dialog.querySelectorAll("[data-icon]").forEach(node => { node.innerHTML = ic(node.dataset.icon); });
    const els = { dialog,
      invForm: $("#invite-form"),
      invType: $("#inv-type"),
      invNote: $("#inv-note"),
      invLogin: $("#inv-login"),
      invWhere: $("#inv-where"),
      invStatus: $("#inv-status"),
      invName: $("#inv-name"),
      invAvatar: $("#inv-avatar"),
      invAvatarPicker: $("#inv-avatar-picker"),
      invTagline: $("#inv-tagline"),
      invRole: $("#inv-role"),
      invDelay: $("#inv-delay"),
      invSkills: $("#inv-skills"),
      invGeek: $("#inv-geek"),
      invAgents: $("#inv-agents"),
      invNone: $("#inv-none"),
      invOptions: $("#inv-options"),
      invModel: $("#inv-model"),
      invModelCustom: $("#inv-model-custom"),
      invEffort: $("#inv-effort"),
      invMode: $("#inv-mode"),
      invError: $("#inv-error"),
      invRefresh: $("#inv-refresh"),
      invSubmit: $("#inv-submit"),
    };
    const active = entered => !disposed && !signal?.aborted && dialog.open && !dialog.classList.contains("closing") && entered === visit;
    const PERSONA_FIELDS = () => [els.invName, els.invTagline, els.invRole, els.invAvatar];
    const inviteBlocked = recipe => !recipe || !!recipe.unavailableReason || recipe.loginState === "missing";
    const agentUpdates = { tileAction: recipe => recipe.updateAction || "", bulkAction: () => state.bulkAction || "" };
    function snapshot() {
      const facts = JSON.parse(JSON.stringify(getSnapshot()));
      state.recipes = facts.recipes || []; state.settings = facts.settings || {}; state.bulkAction = facts.bulkAction || "";
      state.installs = new Map(facts.installs || []); state.logins = new Map(facts.logins || []);
    }
    function cancelOptions() { ++optionsRequest; optionsController?.abort(); optionsController = null; }
  function fillSelect(select, values, defaultValue, emptyLabel) {
    select.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = emptyLabel;
    select.appendChild(opt);
    for (const v of values) {
      const entry = typeof v === "string" ? { value: v, name: v } : v;
      const o = document.createElement("option");
      o.value = entry.value;
      o.textContent = entry.name || entry.value;
      o.title = [entry.name && entry.name !== entry.value ? entry.value : "", entry.description || ""].filter(Boolean).join(" · ");
      if (entry.value === defaultValue) o.selected = true;
      select.appendChild(o);
    }
    select.disabled = values.length === 0;
    renderChips(select);
  }

  function renderChips(select) {
    const box = $(`.chips[data-for="${select.id}"]`);
    if (!box) return;
    const options = [...select.options];
    const useSelect = options.length > 9;
    box.hidden = useSelect;
    select.hidden = !useSelect;
    if (useSelect) return;
    box.innerHTML = "";
    if (select.disabled) {
      box.innerHTML = '<span class="hint">nothing to choose here</span>';
      return;
    }
    for (const o of options) {
      const b = UI.el("choice", { label: o.textContent, on: !!o.selected, quiet: o.value === "", title: o.title || undefined });
      domResources.nodeListener(b, "click", () => {
        select.value = o.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        renderChips(select);
      });
      box.appendChild(b);
    }
  }

  function presetFor(recipe) {
    const s = state.settings || {};
    const v = (s.vendorPresets || {})[recipe.id] || {};
    const bypass = s.bypassPermissionsByDefault !== false;
    const defaultMode = bypass ? recipe.bypassMode || recipe.defaultMode : recipe.defaultMode;
    return { model: v.model || recipe.defaultModel, effort: v.effort || recipe.defaultEffort, mode: v.mode || defaultMode };
  }

  async function loadAgentOptions(recipe, refresh) {
    cancelOptions();
    const requestId = optionsRequest, entered = visit;
    optionsController = new view.AbortController();
    els.invStatus.textContent = "Asking the vibemate what it offers…";
    els.invStatus.className = "hint accent";
    const preset = presetFor(recipe);
    try {
      const info = await readOptions(recipe.id, refresh, optionsController.signal);
      if (requestId !== optionsRequest || !active(entered)) return;
      const byCategory = (category) => info.configOptions.find((o) => o.category === category && o.type === "select");
      const model = byCategory("model");
      const effort = byCategory("thought_level");
      const mode = byCategory("mode");
      const parts = [];
      const pick = (values, wanted, current) => (values.some((v) => v.value === wanted) ? wanted : current);
      if (model) {
        const values = flattenOptions(model.options);
        fillSelect(els.invModel, values, pick(values, preset.model, model.currentValue), "vibemate default");
        parts.push(`${values.length} models`);
      }
      if (effort) {
        const values = flattenOptions(effort.options);
        fillSelect(els.invEffort, values, pick(values, preset.effort, effort.currentValue), "vibemate default");
        parts.push(`effort: ${values.length}`);
      }
      if (mode) {
        const values = flattenOptions(mode.options);
        fillSelect(els.invMode, values, pick(values, preset.mode, mode.currentValue), "vibemate default");
        parts.push(`modes: ${values.length}`);
      } else if (info.modes && info.modes.availableModes && info.modes.availableModes.length) {
        const values = info.modes.availableModes.map((m) => ({ value: m.id, name: m.name, description: m.description }));
        fillSelect(els.invMode, values, pick(values, preset.mode, info.modes.currentModeId), "vibemate default");
        parts.push(`modes: ${values.length}`);
      }
      els.invModelCustom.hidden = !info.modelAtLaunch;
      const who = info.agentInfo && info.agentInfo.name ? `${info.agentInfo.name} ${info.agentInfo.version || ""}`.trim() : recipe.vendor;
      els.invStatus.textContent = parts.length ? `Options from ${who} (${parts.join(", ")})` : `${who} has no additional settings available here.${info.modelAtLaunch ? " Choose a model from the list or enter its name before joining." : ""}${info.modeAtLaunch ? " Changing the mode restarts the session." : ""}`;
    } catch (error) {
      if (requestId !== optionsRequest || !active(entered)) return;
      els.invStatus.textContent = `Could not read the vibemate's options (${error.message}); showing the built-in list.`;
      els.invStatus.className = "hint error";
    }
  }

  function applyRecipe(refresh) {
    cancelOptions();
    const recipe = state.recipes.find((r) => r.id === els.invType.value);
    if (!recipe) return;
    els.invAgents.querySelectorAll(".agent-tile").forEach((b) => b.classList.toggle("selected", b.dataset.agent === recipe.id));
    const preset = presetFor(recipe);
    const blocked = inviteBlocked(recipe);
    els.invOptions.hidden = blocked;
    refreshInviteWords(recipe);
    updateInviteSubmit();
    if (blocked) return;
    fillSelect(els.invModel, recipe.modelPresets, preset.model, "vibemate default");
    fillSelect(els.invEffort, recipe.effortPresets, preset.effort, "vibemate default");
    fillSelect(els.invMode, recipe.modePresets, preset.mode, "vibemate default");
    els.invModelCustom.hidden = true;
    els.invModelCustom.value = "";
    els.invStatus.textContent = "";
    loadAgentOptions(recipe, refresh);
  }

  function refreshInviteWords(recipe) {
    const bypassOn = (state.settings || {}).bypassPermissionsByDefault !== false;
    els.invNote.textContent = (recipe.unavailableReason ? `${recipe.note} — ${recipe.unavailableReason}` : recipe.note) + (bypassOn && recipe.bypassMode ? ` Mode defaults to "${recipe.bypassMode}" (acts without asking; change it here or in Settings).` : "") + (recipe.loginState === "missing" ? " Not logged in yet: press Log in under its tile." : "");
    const noLogin = !recipe.unavailableReason && recipe.loginState === "missing";
    els.invWhere.textContent = recipe.unavailableReason
      ? `Not installed on this machine. To install: ${recipe.installHint || ""}`
      : noLogin
        ? `Found at ${recipe.installedAt || "bundled"}, but ${recipe.vendor} is not logged in${recipe.loginChecked ? ` (${recipe.vendor} reports: ${recipe.loginChecked.detail})` : ""}.${recipe.loginCommand && recipe.loginHow !== "card" ? ` Run \`${recipe.loginCommand}\` in a terminal, then press "Check again".` : ""}`
        : `Found on this machine: ${recipe.installedAt || "bundled"}`;
    els.invWhere.className = recipe.unavailableReason ? "hint error" : noLogin ? "hint warn" : "hint";
    renderInviteLogin();
    if (els.invType.value === recipe.id) {
      if (inviteBlocked(recipe)) { els.invOptions.hidden = true; updateInviteSubmit(); }
      else if (els.invOptions.hidden) applyRecipe(false);
      else updateInviteSubmit();
    }
  }

  function inviteWarnHtml(recipe) {
    const install = state.installs.get(recipe.id);
    const login = state.logins.get(recipe.id);
    let words = "";
    if (recipe.unavailableReason) words = install && install.state === "running" ? `${recipe.vendor} is being installed; the dialog follows it.` : `${recipe.vendor} is not installed on this machine. Install it first: the button under its tile.`;
    else if (login && login.state === "running") words = `${recipe.vendor} is signing you in; the dialog follows it.`;
    else if (recipe.loginState === "missing") words = `${recipe.vendor} is not logged in on this machine. Log in first: the button under its tile. Then summon.`;
    return words ? `<p class="inv-warn">${ic(recipe.unavailableReason ? "tool" : "unplugged")}<span>${esc(words)}</span></p>` : "";
  }

  function renderInviteLogin() {
    const host = els.invLogin;
    if (!host) return;
    const recipe = state.recipes.find((r) => r.id === els.invType.value);
    const row = recipe ? inviteWarnHtml(recipe) : "";
    host.hidden = !row;
    host.innerHTML = row;
  }

  function updateInviteSubmit() {
    const recipe = state.recipes.find((r) => r.id === els.invType.value);
    els.invSubmit.disabled = pending || inviteBlocked(recipe) || !els.invName.value.trim();
  }

  function pickForInstall(id) {
    els.invType.value = id;
    els.invOptions.hidden = true;
    applyRecipe(false);
    openLoginDialog(id, "install");
  }


  function loginTitle(r) {
    const said = r.loginChecked ? ` ${r.vendor} reports: ${r.loginChecked.detail}` : "";
    if (r.unavailableReason) return `Not installed on this machine. ${r.installHint || ""}`;
    if (r.loginState === "missing") return `Found at ${r.installedAt || "bundled"}, but not logged in.${r.loginCommand ? ` Run \`${r.loginCommand}\` in a terminal, then "Check again".` : ""}${said}`;
    return `Found at ${r.installedAt || "bundled"}.${said}`;
  }

  function renderInviteTiles() {
    const picked = els.invType.value;
    const installed = state.recipes.filter((r) => !r.unavailableReason);
    els.invAgents.innerHTML = state.recipes
      .map((r) => {
        const login = loginWords(r);
        const tile = `<button type="button" class="agent-tile${r.unavailableReason ? " off" : ""}${r.id === picked ? " selected" : ""}" data-agent="${esc(r.id)}" title="${esc(loginTitle(r))}">${vendorLogo(r, "lg")}<span class="at-name">${esc(r.vendor)}</span><span class="at-sub" data-state="${login.state}">${login.state === "missing" ? ic("unplugged") : ""}${login.text}</span></button>`;
        const installing = r.unavailableReason && state.installs.get(r.id)?.state === "running";
        const signingIn = !r.unavailableReason && state.logins.get(r.id)?.state === "running";
        const under = installing
          ? UI.html("button", { label: "Installing…", kind: "soft", size: "xs", act: "install-pick", icon: "tool", disabled: true, title: `${r.vendor} is being installed: the dialog follows it`, data: { agent: r.id } })
          : r.unavailableReason
          ? UI.html("button", { label: "Install", kind: "soft", size: "xs", act: "install-pick", icon: "tool", title: `${r.vendor} is not installed here: see how to install it`, data: { agent: r.id } })
          : signingIn
          ? UI.html("button", { label: "Signing in…", kind: "primary", size: "xs", act: "open-login-dialog", icon: "lock", title: `${r.vendor} is signing you in: the dialog follows it`, data: { recipe: r.id, purpose: "login" } })
          : r.loginState === "missing"
          ? UI.html("button", { label: "Log in", kind: "primary", size: "xs", act: "open-login-dialog", icon: "lock", title: `${r.vendor} is not logged in here: log in from the room`, data: { recipe: r.id, purpose: "login" } })
          : "";
        return `<div class="agent-cell">${tile}${under}${agentUpdates.tileAction(r)}</div>`;
      })
      .join("") + agentUpdates.bulkAction();
    els.invAgents.querySelectorAll('[data-act="install-pick"]').forEach((b) => domResources.nodeListener(b, "click", () => pickForInstall(b.dataset.agent)));
    els.invAgents.querySelectorAll(".agent-tile:not(.off)").forEach((b) =>
      domResources.nodeListener(b, "click", () => {
        els.invType.value = b.dataset.agent;
        applyRecipe(false);
      }),
    );
    els.invNone.hidden = installed.length > 0;
    els.invNone.innerHTML = installed.length
      ? ""
      : `No supported vibemate is installed on this machine yet. Install one and open this dialog again: ${state.recipes.map((r) => `<b>${esc(r.vendor)}</b> (<code>${esc(r.installHint || "")}</code>)`).join(", ")}.`;
  }

  function setStaffing(p) {
    staffing.id = p ? p.id : null;
    for (const f of PERSONA_FIELDS()) f.disabled = false;
    els.invSkills.classList.remove("locked");
    const lead = els.dialog.querySelector(".lead");
    lead.textContent = p
      ? `${p.name} comes from the room's template. Pick the coding agent that runs it; change the vibename or the character if you like.`
      : "Pick a vibemate, give it a vibename and a character, and it joins the room.";
  }

    function reset() {
      els.invSubmit.disabled = true; els.invType.value = ""; els.invOptions.hidden = true;
      els.invWhere.textContent = ""; els.invNote.textContent = ""; els.invStatus.textContent = "";
      els.invDelay.value = ""; els.invDelay.placeholder = `the room's: ${room.settings?.replyDelay ?? 4} s`;
      renderSkillChecks(els.invSkills, []);
      els.invName.value = ""; els.invAvatar.value = ""; els.invTagline.value = ""; els.invRole.value = "";
      picker?.dispose?.(); els.invAvatarPicker.innerHTML = ""; delete els.invAvatar.dataset.picked;
      const entered = visit;
      picker = makePicker("", face => { if (active(entered)) { els.invAvatar.value = face; els.invAvatar.dataset.picked = "1"; } }, els.invAvatar, { root: dialog, signal: owner.signal });
      els.invAvatarPicker.appendChild(picker); els.invGeek.open = false; setStaffing(null);
    }
    function open(target, participant) {
      if (disposed) return false;
      ++visit; cancelOptions(); room = JSON.parse(JSON.stringify(target)); snapshot();
      els.invError.hidden = true; els.invType.innerHTML = "";
      for (const recipe of state.recipes) { const option = document.createElement("option"); option.value = recipe.id; option.textContent = recipe.label; els.invType.appendChild(option); }
      renderInviteTiles(); reset(); renderInviteLogin();
      if (participant) {
        els.invName.value = participant.name; els.invTagline.value = participant.tagline || "";
        els.invRole.value = participant.role || ""; els.invAvatar.value = participant.avatar || "";
        renderSkillChecks(els.invSkills, participant.skills || []); setStaffing({ id: participant.id, name: participant.name });
      }
      openDialog(dialog); els.invName.focus();
      checkRecipes({}).catch(() => undefined);
      return true;
    }
    async function submitInvite(event) {
      event.preventDefault();
      if (disposed || pending || !dialog.open) return;
      if (!els.invType.value) { els.invError.textContent = "Pick a vibemate first."; els.invError.hidden = false; return; }
      const entered = visit, target = room, participantId = staffing.id;
      const value = { agentType: els.invType.value, name: els.invName.value.trim(),
        avatar: participantId ? els.invAvatar.value.trim() : els.invAvatar.dataset.picked || els.invAvatar.value.trim() ? els.invAvatar.value.trim() : null,
        tagline: participantId ? els.invTagline.value.trim() : els.invTagline.value.trim() || null,
        role: participantId ? els.invRole.value.trim() : els.invRole.value.trim() || null,
        model: els.invModelCustom.value.trim() || els.invModel.value || null,
        effort: els.invEffort.value || null, mode: els.invMode.value || null, skills: checkedSkills(els.invSkills),
        ...(!participantId ? { replyDelay: els.invDelay.value === "" ? null : Number(els.invDelay.value) } : {}),
      };
      pending = true; els.invSubmit.disabled = true; UI.setState(els.invSubmit, "loading"); els.invError.hidden = true;
      try { await (participantId ? staff(target, participantId, value) : invite(target, value)); if (active(entered)) closeDialog(dialog); }
      catch (error) { if (active(entered)) { els.invError.textContent = error.message; els.invError.hidden = false; } }
      finally { pending = false; if (!disposed) { UI.setState(els.invSubmit, null); updateInviteSubmit(); } }
    }
    function update({ tiles = true } = {}) {
      if (disposed || !dialog.open) return;
      snapshot(); if (tiles) renderInviteTiles();
      const recipe = state.recipes.find(r => r.id === els.invType.value);
      if (recipe) refreshInviteWords(recipe); else renderInviteLogin();
    }
    owner.on(els.invForm, "submit", submitInvite);
    owner.on(els.invType, "change", () => applyRecipe(false));
    owner.on(els.invRefresh, "click", () => applyRecipe(true));
    owner.on(els.invName, "input", updateInviteSubmit);
    owner.on($("[data-invite-close]"), "click", () => closeDialog(dialog));
    owner.on(dialog, "close", () => { ++visit; cancelOptions(); picker?.dispose?.(); picker = null; });
    owner.on($("#inv-recheck"), "click", () => {
      const entered = visit, button = $("#inv-recheck"); button.disabled = true;
      checkRecipes({ force: true, rescan: true }).catch(error => { if (active(entered)) showError(error); }).finally(() => { if (!disposed) button.disabled = false; });
    });
    function dispose() { if (disposed) return; disposed = true; ++visit; cancelOptions(); picker?.dispose?.(); owner.dispose(); if (dialog.open) closeDialog(dialog); }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ open, update, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_INVITE_DIALOG = Object.freeze({ markup, create, loginWords });
})(typeof window !== "undefined" ? window : globalThis);
