// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const short = version => /^[a-f0-9]{40}$/.test(version || "") ? version.slice(0, 10) : version || "unknown";
  function updatePhase(flow, busy, entry) {
    if (entry?.state === "queued") return "pending";
    if (flow?.state === "running" || entry?.state === "running") return "updating";
    return busy || entry?.state === "preparing" ? "preparing" : "";
  }
  function activity(phase) {
    if (!phase) return "";
    const label = phase === "pending" ? "Pending" : phase === "preparing" ? "Preparing…" : "Updating…";
    return `<span class="agent-update-activity" data-update-state="${phase}">${phase === "pending" ? "" : `<span class="agent-update-spinner" aria-hidden="true" style="animation-delay:-${Date.now() % 800}ms"></span>`}${label}</span>`;
  }
  function status(view) {
    if (!view) return "Installed agents have not been checked yet.";
    if (view.checking) return "Checking installed agents…";
    if (!view.checkedAt) return "Installed agents have not been checked yet.";
    const available = view.updates.filter(u => u.status === "available").length;
    const unknown = view.updates.filter(u => u.status === "unknown" || u.status === "manual").length;
    return `${available ? `${available} agent update${available === 1 ? "" : "s"} available.` : "No agent updates found."}${unknown ? ` ${unknown} check${unknown === 1 ? " needs" : "s need"} attention.` : ""}${view.checkedAt ? ` Checked ${new Date(view.checkedAt).toLocaleString()}.` : ""}`;
  }
  function row(update, recipe, flow, busy, { error, blocked, entry, quiet = false } = {}) {
    const name = recipe?.vendor || update.vendor;
    const running = flow?.state === "running";
    const phase = updatePhase(flow, busy, entry);
    const problem = error || (entry?.state === "failed" ? entry.detail : flow?.state === "failed" ? flow.detail : "");
    const loginFirst = !running && flow?.state === "failed" && flow.failedBecause === "sign-in";
    const action = running ? `<button type="button" data-ui="button" data-kind="ghost" data-stop="${esc(flow.id)}">Cancel update</button>`
      : update.status === "available" && update.canUpdate ? `<button type="button" data-ui="button" data-kind="${loginFirst || quiet ? "ghost" : "primary"}" data-update="${esc(update.vendor)}" ${phase || blocked ? "disabled" : ""}${blocked ? ` title="${esc(blocked)}"` : ""}>${phase ? activity(phase) : "Update"}</button>`
      : update.status !== "current" ? `<a data-ui="button" data-kind="ghost" href="${esc(update.help)}" target="_blank" rel="noopener noreferrer">Update instructions</a>` : "";
    const signIn = loginFirst
      ? `<button type="button" data-ui="button" data-kind="primary" data-act="open-login-dialog" data-recipe="${esc(flow.recipeId)}" data-purpose="login">Log in to ${esc(name)}</button>`
      : "";
    return `<article class="agent-update-row" data-vendor="${esc(update.vendor)}">
      <div class="agent-update-top">${recipe?.icon ? `<img src="${esc(recipe.icon)}" alt="" width="34" height="34">` : ""}<div><strong>${esc(name)}</strong>${running ? activity(phase) : ""}<div>${esc(short(update.current))}${update.status === "available" && update.latest ? ` → ${esc(short(update.latest))}` : ""}${update.skipped ? ' <span class="hint">Skipped</span>' : ""}</div></div>${signIn}${action}</div>
      <p class="hint">${esc(update.method)} · ${esc(update.channel)} · <span class="agent-update-path">${esc(update.executable)}</span></p>
      <p class="agent-update-detail${problem ? " agent-update-error" : ""}" role="${problem ? "alert" : "status"}">${esc(problem || (busy ? `Preparing ${name}’s update…` : entry?.detail || flow?.detail || update.detail))}</p>
      ${running && flow.wantsInput ? `<form data-answer="${esc(flow.id)}"><label>Answer the updater <input name="answer" autocomplete="off" spellcheck="false"></label><button type="submit" data-ui="button">Send answer</button></form>` : ""}
      ${flow?.lines?.length ? `<details><summary>Updater output</summary><pre>${esc(flow.lines.join("\n"))}</pre></details>` : ""}
    </article>`;
  }
  function create({ post, recipes, onStatus, onError, onChange = () => {} }) {
    let view = null, dialog = null, token = null, claiming = false, lastInput = Date.now(), closedLocallyUntil = 0;
    const windowId = crypto.randomUUID(), flows = new Map(), busy = new Set(), errors = new Map();
    let generalError = "", allPending = false, cancelPending = false;
    let pendingAllEntries = [];
    let visibleKeys = [];
    let dialogGeneration = 0, dismissRun = false, renewing = null;
    const dismissals = [];
    let startedHere = false;
    document.addEventListener("keydown", () => { lastInput = Date.now(); }, { passive: true });
    document.addEventListener("input", () => { lastInput = Date.now(); }, { passive: true });
    const safeToShow = () => document.visibilityState === "visible" && document.hasFocus() && !document.querySelector("dialog[open]") && Date.now() - lastInput > 4000;
    const batchActive = () => view?.batch?.state === "running" || view?.batch?.state === "cancelling";
    const active = vendor => busy.has(vendor) || flows.get(vendor)?.state === "running" || batchActive() && view.batch.entries.some(e => e.vendor === vendor);
    const activeVendor = () => [...busy][0] || [...flows.values()].find(flow => flow.state === "running")?.recipeId;
    const eligible = () => (view?.updates || []).filter(u => u.status === "available" && u.canUpdate && u.key);
    const updating = () => startedHere || allPending || batchActive() || !!activeVendor();
    const entryFor = vendor => {
      const pending = pendingAllEntries.find(e => e.vendor === vendor);
      if (pending) return pending;
      const entry = view?.batch?.entries.find(e => e.vendor === vendor);
      if (!entry || batchActive()) return entry;
      const flow = flows.get(vendor), update = view.updates.find(u => u.vendor === vendor);
      return flow && flow.startedAt >= view.batch.startedAt || update?.key && update.key !== entry.key ? null : entry;
    };
    function batchStatus() {
      if (allPending) return "Preparing Update all…";
      const batch = view?.batch; if (!batch) return "";
      if (batch.state === "interrupted") return "Update all stopped when viberoom restarted. Check updates before trying again.";
      const done = batch.entries.filter(e => e.state === "done").length, failed = batch.entries.filter(e => e.state === "failed").length;
      const cancelled = batch.entries.filter(e => e.state === "cancelled").length;
      if (batchActive()) return batch.state === "cancelling" ? "Cancelling updates; waiting for the current operation to stop…" : `Update all: ${done + failed + cancelled} of ${batch.entries.length} finished.`;
      return `Update all finished: ${done} updated${failed ? `; ${failed} need attention` : ""}${cancelled ? `; ${cancelled} cancelled` : ""}.`;
    }
    const blockedBy = vendor => {
      if (allPending) return "Preparing Update all…";
      if (batchActive()) return "Update all is running. Follow the queue below or cancel it first.";
      const other = activeVendor();
      return other && other !== vendor ? `Wait for ${recipes().find(r => r.id === other)?.vendor || other}’s update to finish.` : "";
    };
    function fail(error, vendor) {
      const message = error?.message || String(error);
      if (vendor) errors.set(vendor, message); else generalError = message;
      render();
      if (vendor) [...(dialog?.querySelectorAll("[data-vendor]") || [])].find(el => el.dataset.vendor === vendor)?.querySelector('[role="alert"]')?.scrollIntoView({ block: "nearest" });
      if (!dialog) onError(error);
    }
    function reveal(vendor) {
      const article = [...(dialog?.querySelectorAll("[data-vendor]") || [])].find(el => el.dataset.vendor === vendor);
      article?.scrollIntoView({ block: "nearest" });
      article?.querySelector("button, a")?.focus({ preventScroll: true });
    }
    function tileAction(recipe) {
      if (recipe.unavailableReason) return "";
      const update = view?.updates.find(u => u.vendor === recipe.id), running = active(recipe.id), entry = entryFor(recipe.id), flow = flows.get(recipe.id);
      const problem = errors.get(recipe.id) || (entry?.state === "failed" ? entry.detail : flow?.state === "failed" ? flow.detail : "");
      const detail = problem || (entry?.state === "done" || flow?.state === "done" ? "Updated and verified." : entry?.state === "cancelled" ? entry.detail : "");
      const feedback = detail ? `<span class="agent-tile-update-status${problem ? " agent-update-error" : ""}" role="${problem ? "alert" : "status"}">${esc(detail)}</span>` : "";
      if (!running && (!update || update.status !== "available")) return feedback;
      const blocked = running ? "" : blockedBy(recipe.id);
      const phase = updatePhase(flow, busy.has(recipe.id), entry);
      const label = phase ? activity(phase) : running ? "View update" : update.canUpdate ? "Update" : "Update info";
      const title = blocked || (running ? `View ${recipe.vendor}’s update` : `Update ${recipe.vendor} to ${update.latest}`);
      return `<button type="button" data-ui="button" data-kind="soft" data-size="xs" data-agent-update="${esc(recipe.id)}" title="${esc(title)}" ${blocked ? "disabled" : ""}>${label}</button>${feedback}`;
    }
    function bulkAction() {
      const count = eligible().length, active = batchActive() || allPending;
      if (!count && !active && !view?.batch) return "";
      return `<div class="agent-grid-update-all"><button type="button" data-ui="button" data-kind="soft" data-size="sm" data-agent-update-all ${!active && (!count || activeVendor()) ? "disabled" : ""}>${active ? "View updates…" : `Update all (${count})`}</button><span role="status">${esc(batchStatus())}</span></div>`;
    }
    async function startAll() {
      open(); if (batchActive() || allPending || activeVendor()) return;
      const keys = eligible().map(u => u.key); if (!keys.length) return;
      for (const update of eligible()) { errors.delete(update.vendor); if (flows.get(update.vendor)?.state !== "running") flows.delete(update.vendor); }
      pendingAllEntries = eligible().map(u => ({ vendor: u.vendor, key: u.key, state: "queued", detail: "Waiting for Update all to start…" }));
      generalError = ""; allPending = true; startedHere = true; render();
      try { const result = await post("/api/agents/updates/start-all", { keys }); setView(result.updates); }
      catch (error) { fail(error); }
      finally { allPending = false; pendingAllEntries = []; render(); }
    }
    async function start(vendor) {
      open(vendor);
      if (active(vendor)) return;
      const update = view?.updates.find(u => u.vendor === vendor);
      if (!update?.canUpdate || update.status !== "available") return;
      const blocked = blockedBy(vendor);
      if (blocked) { fail(new Error(blocked), vendor); return; }
      errors.delete(vendor); flows.delete(vendor); busy.add(vendor); startedHere = true; render(); reveal(vendor);
      try { const result = await post("/api/agents/updates/start", { vendor, key: update.key }, { deadline: 180000 }); setFlow(result.flow, true); }
      catch (error) { fail(error, vendor); }
      finally { busy.delete(vendor); render(); }
    }
    document.addEventListener("click", event => {
      const all = event.target.closest?.("[data-agent-update-all]");
      if (all && !all.disabled) { event.preventDefault(); void startAll(); return; }
      const button = event.target.closest?.("[data-agent-update]");
      if (!button || button.disabled) return;
      event.preventDefault(); void start(button.dataset.agentUpdate);
    });
    function render() {
      onStatus(status(view));
      onChange();
      if (!dialog) return;
      const focused = document.activeElement?.dataset.update || document.activeElement?.dataset.stop;
      const answers = new Map([...dialog.querySelectorAll("form[data-answer]")].map(form => [form.dataset.answer, { value: form.elements.answer.value, focus: document.activeElement === form.elements.answer, start: form.elements.answer.selectionStart, end: form.elements.answer.selectionEnd }]));
      const opened = new Set([...dialog.querySelectorAll("details[open]")].map(el => el.closest("[data-vendor]").dataset.vendor));
      const scrollTop = dialog.querySelector(".agent-update-body")?.scrollTop || 0;
      const all = view?.updates || [];
      visibleKeys = all.filter(u => u.status === "available").map(u => u.key).filter(Boolean);
      const buttons = `<div class="agent-update-actions"><button type="button" data-ui="button" data-kind="ghost" data-check ${view?.checking || activeVendor() || batchActive() || allPending ? "disabled" : ""}>Check now</button><span></span>${batchActive() ? `<button type="button" data-ui="button" data-kind="warn" data-cancel-all ${cancelPending || view.batch.state === "cancelling" ? "disabled" : ""}>${cancelPending || view.batch.state === "cancelling" ? "Cancelling…" : "Cancel updates"}</button>` : `<button type="button" data-ui="button" data-kind="${updating() ? "ghost" : "primary"}" data-update-all ${allPending || activeVendor() || !eligible().length ? "disabled" : ""}>${allPending ? "Preparing…" : `Update all (${eligible().length})`}</button>`}<button type="button" data-ui="button" data-kind="ghost" data-skip ${visibleKeys.length && !dismissals.some(d => d.action === "skip" && d.dialog === dialog) ? "" : "disabled"}>Skip these versions</button><button type="button" data-ui="button" data-kind="${updating() ? "primary" : "ghost"}" data-dismiss>${updating() ? "Close" : "Mute for now"}</button></div>`;
      dialog.innerHTML = `<div class="agent-update-body"><h2 id="agent-update-title">Updates for your agents</h2><p>${esc(status(view))}</p><p class="hint">Updates keep each agent’s installation method and run one at a time. Update all skips busy agents and reports why; installations needing manual steps keep their instructions. Idle vibemates reconnect afterwards; agents without session restore start with their notes and recent messages.</p><div class="agent-update-list">${all.length ? all.map(u => row(u, recipes().find(r => r.id === u.vendor), flows.get(u.vendor), busy.has(u.vendor), { error: errors.get(u.vendor), blocked: blockedBy(u.vendor), entry: entryFor(u.vendor), quiet: updating() })).join("") : '<p>No installed agents were found.</p>'}</div></div><footer class="agent-update-footer">${generalError ? `<p class="agent-update-error" role="alert">${esc(generalError)}</p>` : ""}${batchStatus() ? `<p role="status">${esc(batchStatus())}</p>` : ""}${buttons}<p class="hint">${updating() ? "Close" : "Mute for now"} waits 24 hours; updates already started keep running. Skip remembers these exact versions; a later version can be offered again.</p></footer>`;
      for (const details of dialog.querySelectorAll("details")) if (opened.has(details.closest("[data-vendor]").dataset.vendor)) details.open = true;
      dialog.querySelector(".agent-update-body").scrollTop = scrollTop;
      for (const form of dialog.querySelectorAll("form[data-answer]")) {
        const previous = answers.get(form.dataset.answer); if (!previous) continue;
        form.elements.answer.value = previous.value;
        if (previous.focus) { form.elements.answer.focus({ preventScroll: true }); form.elements.answer.setSelectionRange(previous.start, previous.end); }
      }
      if (focused) [...dialog.querySelectorAll("[data-update], [data-stop]")].find(el => el.dataset.update === focused || el.dataset.stop === focused)?.focus({ preventScroll: true });
    }
    function closeDialog(target) {
      if (!target || dialog !== target) return;
      token = null; dialog = null; dialogGeneration++;
      target.close(); target.remove(); render();
    }
    async function saveDismissals() {
      if (dismissRun) return;
      dismissRun = true;
      try {
        while (dismissals.length) {
          const request = dismissals[0], instance = view?.instance;
          if (request.retryAt > Date.now()) break;
          request.attempts++;
          try {
            const result = await post("/api/agents/updates/dismiss", { action: request.action, keys: request.keys });
            if (instance !== view?.instance) throw new Error("The room restarted while saving the update reminder pause.");
            dismissals.shift(); setView(result.updates);
            if (request.action === "skip" && dialog === request.dialog) {
              closedLocallyUntil = 0; closeDialog(request.dialog);
            }
          } catch (error) {
            if (request.action === "close") {
              if (request.attempts >= 3) {
                dismissals.shift();
                onError(new Error(`The update window is closed, but the room could not save its 24-hour pause. This window stays muted for 24 hours. ${error?.message || error}`));
                continue;
              }
              request.retryAt = Date.now() + request.attempts * 5000;
              break;
            }
            dismissals.shift();
            if (dialog === request.dialog) fail(error); else onError(error);
          }
        }
      } finally { dismissRun = false; }
    }
    function dismiss(action) {
      const target = dialog;
      if (!target || dismissals.some(d => d.action === action && d.dialog === target)) return;
      dismissals.push({ action, keys: [...visibleKeys], dialog: target, attempts: 0, retryAt: 0 });
      if (action === "close") { closedLocallyUntil = Date.now() + 86400000; closeDialog(target); }
      else render();
      void saveDismissals();
    }
    function open(vendor) {
      if (dialog) { if (vendor) reveal(vendor); else dialog.focus(); return; }
      visibleKeys = (view?.updates || []).filter(u => u.status === "available").map(u => u.key).filter(Boolean);
      startedHere = false;
      dialogGeneration++;
      dialog = document.createElement("dialog"); dialog.className = "dialog agent-updates-dialog"; dialog.id = "agent-updates-dialog";
      dialog.setAttribute("aria-labelledby", "agent-update-title");
      dialog.addEventListener("cancel", event => { event.preventDefault(); void dismiss("close"); });
      dialog.addEventListener("submit", async event => {
        const form = event.target.closest("form[data-answer]"); if (!form) return;
        event.preventDefault();
        const vendor = [...flows.values()].find(flow => flow.id === form.dataset.answer)?.recipeId;
        try { const result = await post(`/api/login/${encodeURIComponent(form.dataset.answer)}/input`, { text: form.elements.answer.value }); form.elements.answer.value = ""; if (vendor) errors.delete(vendor); setFlow(result.flow, true); }
        catch (error) { fail(error, vendor); }
      });
      dialog.addEventListener("click", async event => {
        const button = event.target.closest("button"); if (!button || button.disabled) return;
        if (button.hasAttribute("data-dismiss")) return void dismiss("close");
        if (button.hasAttribute("data-skip")) return void dismiss("skip");
        if (button.hasAttribute("data-check")) return void check();
        if (button.hasAttribute("data-update-all")) return void startAll();
        if (button.hasAttribute("data-cancel-all")) {
          if (cancelPending) return;
          cancelPending = true; render();
          try { const result = await post("/api/agents/updates/cancel-all", { id: view.batch.id }); setView(result.updates); }
          catch (error) { fail(error); }
          finally { cancelPending = false; render(); }
          return;
        }
        if (button.dataset.stop) {
          const vendor = [...flows.values()].find(flow => flow.id === button.dataset.stop)?.recipeId;
          try { const result = await post(`/api/login/${encodeURIComponent(button.dataset.stop)}/cancel`); if (vendor) errors.delete(vendor); setFlow(result.flow, true); } catch (error) { fail(error, vendor); }
          return;
        }
        if (button.dataset.update) await start(button.dataset.update);
      });
      document.body.appendChild(dialog); render(); dialog.showModal(); if (vendor) reveal(vendor);
    }
    async function check() {
      generalError = ""; render();
      try { const result = await post("/api/agents/updates/check", {}, { deadline: 180000 }); setView(result.updates); }
      catch (error) { fail(error); }
    }
    function setView(value) {
      if (view?.instance && value?.instance === view.instance && value.revision < view.revision) return;
      if (value?.batch?.id && value.batch.id !== view?.batch?.id) pendingAllEntries = [];
      if (view?.instance && value?.instance && value.instance !== view.instance) {
        flows.clear(); errors.clear(); token = null; dialogGeneration++;
      }
      if (value?.batch?.id && value.batch.id !== view?.batch?.id) for (const entry of value.batch.entries) {
        errors.delete(entry.vendor);
        if (flows.get(entry.vendor)?.state !== "running") flows.delete(entry.vendor);
      }
      view = value; render();
    }
    function setFlow(flow, response = false) {
      if (flow?.purpose !== "update") return;
      const known = flows.get(flow.recipeId);
      if (response && known?.id === flow.id && (flow.state === "running" || known.state !== "running")) return;
      if (known && (known.startedAt > flow.startedAt || known.id === flow.id && known.state !== "running" && flow.state === "running")) return;
      if (known?.id !== flow.id) errors.delete(flow.recipeId);
      flows.set(flow.recipeId, flow); render();
    }
    const timer = setInterval(async () => {
      if (dismissals.length) void saveDismissals();
      if (dialog && token) {
        const target = dialog, claimedToken = token;
        if (renewing?.dialog === target && renewing.token === claimedToken) return;
        const request = renewing = { dialog: target, token: claimedToken };
        try {
          const result = await post("/api/agents/updates/renew", { token: claimedToken });
          if (!result.ok && dialog === target && token === claimedToken) closeDialog(target);
        } catch { }
        finally { if (renewing === request) renewing = null; }
        return;
      }
      if (!view?.notification || claiming || dismissals.length || closedLocallyUntil > Date.now() || !safeToShow()) return;
      claiming = true;
      const generation = dialogGeneration, instance = view.instance, notification = view.notification;
      try {
        const answer = await post("/api/agents/updates/claim", { windowId, notification });
        if (answer.token && generation === dialogGeneration && instance === view?.instance && notification === view?.notification && !dismissals.length && closedLocallyUntil <= Date.now() && safeToShow()) { token = answer.token; open(); }
      } catch { }
      finally { claiming = false; }
    }, 5000);
    window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
    return { open, start, startAll, tileAction, bulkAction, check, setView, setFlow, status: () => status(view) };
  }
  root.VIBEROOM_AGENT_UPDATES = { create, status, row };
})(globalThis);
