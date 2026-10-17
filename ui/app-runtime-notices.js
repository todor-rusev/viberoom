// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create(stack, { signal, read, connectionLabel: connLabel, UI, esc, setText, recall, remember, forget,
    post, onError: showError, openSettings, runOf, hubWords: hubSwapWords, nameList, waitedFor, checkAgain,
    closesWhenSeen, removeNotice, window = stack.ownerDocument.defaultView } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window });
    const resources = root.VIBEROOM_APP_DOM_LIFETIME.create({ root: stack, lifetime: owner });
    const document = stack.ownerDocument, Date = window.Date;
    const { timeout: setTimeout, clearTimeout } = owner;
    const made = new Map(), generations = new WeakMap();
    const $ = selector => { const node = stack.querySelector(selector); return made.has(node) ? node : null; };
    const QUIET_ENOUGH_MS = 5 * 60000, COMING_BACK_MS = 3000, NOBODY_THERE_MS = 15000;
    let updatePopSeen = "", restartPopTimer = null, goneTimer = 0;
    function makePop() {
      const pop = document.createElement("div"), scope = resources.scope(); made.set(pop, scope);
      scope.own(() => { removeNotice(pop); made.delete(pop); });
      return pop;
    }
    function drop(pop) { made.get(pop)?.release(); }
    function paint(pop, html) { generations.set(pop, (generations.get(pop) || 0) + 1); pop.innerHTML = html; }
    function listen(node, type, callback) {
      if (!node) return;
      const pop = node.closest(".update-pop"), scope = made.get(pop), revision = generations.get(pop);
      scope.on(node, type, event => { if (pop.isConnected && pop.contains(node) && generations.get(pop) === revision) callback(event); });
    }
    function seenClock(pop, close) { const scope = made.get(pop); return scope.own(closesWhenSeen(pop, scope.guard(close))); }
    function renderUpdatePop() {
    const state = read();
    if (state.embedded) return;
    const old = $("#update-pop");
    if (!old && stack.querySelector('#update-pop')) return;
    const u = state.update;
    const version = u?.latest;
    const show = u && u.available && version && recall("updateDismissed") !== version && updatePopSeen !== version;
    if (!show) {
      if (old && !old.dataset.busy) drop(old);
      return;
    }
    const stage = u.stage || "";
    if (old && old.dataset.version === version && old.dataset.stage === stage) {
      if (stage === "downloading") setText(old.querySelector(".up-progress"), `${u.progress ?? 0} %`);
      return;
    }
    if (old) drop(old);
    const pop = makePop();
    pop.id = "update-pop";
    pop.className = "update-pop";
    pop.dataset.version = version;
    pop.dataset.stage = stage;
    const acts = u.parts ? u.parts.acts : null;
    const name = acts === "application" ? "The viberoom application" : "viberoom";
    const words = stage === "downloading" ? `<b>${name} ${esc(version)}</b> is out, and on its way: <span class="up-progress">${u.progress ?? 0} %</span>. You have ${esc(u.current)}.`
      : stage === "ready" ? `<b>${name} ${esc(version)}</b> is ready. You have ${esc(u.current)}.`
      : `<b>${name} ${esc(version)}</b> is out. You have ${esc(u.current)}.`;
    const ready = acts === "product" ? "Update now" : "Restart to update";
    const go = stage === "downloading" ? "" : UI.html("button", { label: stage === "ready" ? ready : "Update now and restart", kind: "primary", size: "sm", hook: "up-go", ...(acts === "product" ? { title: "The room restarts into the new version; the application stays open" } : {}) });
    paint(pop, `<div class="up-main"><div class="up-text">${words}</div>${go}</div>
      <div class="up-side">${UI.html("icon-button", { icon: "close", title: "Not now", size: "sm", hook: "up-x" })}${UI.html("icon-button", { icon: "settings", title: "Update settings", size: "sm", hook: "up-settings" })}</div>`);
    listen(pop.querySelector(".up-x"), "click", () => {
      remember("updateDismissed", version);
      drop(pop);
    });
    listen(pop.querySelector(".up-settings"), "click", () => openSettings("system"));
    listen(pop.querySelector(".up-go"), "click", () => installUpdate(pop, version, acts === "application" ? "the viberoom application" : "viberoom"));
    stack.appendChild(pop);
    seenClock(pop, () => {
      if (pop.dataset.busy) return;
      updatePopSeen = version;
      drop(pop);
    });
  }

    function renderHubPop() {
    const state = read();
    const old = $("#hub-pop");
    if (!old && stack.querySelector('#hub-pop')) return;
    let swap = null;
    try {
      swap = JSON.parse(recall("hubSwap") || "null");
    } catch {
      swap = null;
    }
    const now = runOf(state.version);
    if (swap && now && swap.id !== now.id) {
      forget("hubSwap");
      swap = null;
    }
    if (!swap) {
      if (old) drop(old);
      return;
    }
    if (old && old.dataset.run === swap.id) return;
    if (old) drop(old);
    const pop = makePop();
    pop.id = "hub-pop";
    pop.className = "update-pop hub-pop";
    pop.dataset.run = swap.id;
    paint(pop, `<div class="up-main"><div class="up-text">${hubSwapWords(swap)}</div></div>
      <div class="up-side">${UI.html("icon-button", { icon: "close", title: "Got it", size: "sm", hook: "hp-x" })}</div>`);
    const gotIt = () => {
      forget("hubSwap");
      drop(pop);
    };
    listen(pop.querySelector(".hp-x"), "click", gotIt);
    stack.appendChild(pop);
    seenClock(pop, gotIt);
  }

    function renderRestartPop() {
    clearTimeout(restartPopTimer);
    const state = read();
    if (state.embedded) return;
    const old = $("#restart-pop");
    if (!old && stack.querySelector('#restart-pop')) return;
    const r = state.restart && state.restart.pending;
    if (!r) {
      if (old) drop(old);
      return;
    }
    const waiting = r.waitingFor || [];
    const quiet = r.quietSince ? Date.now() - r.quietSince : 0;
    const words = !waiting.length
      ? "<b>viberoom is restarting.</b> It comes back in a few seconds."
      : `<b>Restart when ${esc(nameList(waiting))} ${waiting.length > 1 ? "finish" : "finishes"}.</b> ${quiet >= QUIET_ENOUGH_MS
        ? `Nothing new from ${waiting.length > 1 ? "them" : "it"} for ${Math.round(quiet / 60000)} minutes.`
        : `Waiting ${esc(waitedFor(r.since))}.`}`;
    const acts = waiting.length
      ? `<div class="up-acts">${UI.html("button", { label: "Restart now", kind: "secondary", size: "sm", hook: "rp-now" })}${UI.html("button", { label: "Cancel", kind: "ghost", size: "sm", hook: "rp-cancel" })}</div>`
      : "";
    const pop = old || makePop();
    if (!old) {
      pop.id = "restart-pop";
      pop.className = "update-pop restart-pop";
      stack.appendChild(pop);
    }
    paint(pop, `<div class="up-main"><div class="up-text">${words}</div>${acts}</div>`);
    const now = pop.querySelector(".rp-now");
    const cancel = pop.querySelector(".rp-cancel");
    if (now) listen(now, "click", () => void post("/api/restart", { when: "now" }).catch(showError));
    if (cancel) listen(cancel, "click", () => void post("/api/restart/cancel", {}).catch(showError));
    clearTimeout(restartPopTimer);
    if (waiting.length) restartPopTimer = setTimeout(renderRestartPop, 30000);
  }

    function renderGonePop() {
    const state = read();
    const downSince = state.downSince || 0;
    if (owner.disposed || state.transportAlive === false) return;
    clearTimeout(goneTimer);
    const old = $("#gone-pop");
    if (!old && stack.querySelector('#gone-pop')) return;
    const down = downSince ? Date.now() - downSince : 0;
    if (!downSince || down < COMING_BACK_MS) {
      if (old) drop(old);
      if (downSince) goneTimer = setTimeout(renderGonePop, COMING_BACK_MS - down);
      if (connLabel) connLabel.textContent = downSince ? "reconnecting…" : "connected";
      return;
    }
    const gone = down >= NOBODY_THERE_MS;
    if (connLabel) connLabel.textContent = gone ? "not running" : "reconnecting…";
    const folder = state.dataFolder && state.dataFolder.known && state.dataFolder.path;
    const where = folder ? ` What happened is written down in <code>${esc(folder)}${folder.includes("\\") ? "\\" : "/"}hub.log</code>.` : "";
    const words = gone
      ? `<b>viberoom is not answering.</b> Everything in your rooms is kept on this computer and is safe — what has stopped is the program that serves them. Start viberoom again, and this window comes back on its own.${where}`
      : "<b>Reconnecting to viberoom.</b> The room comes back by itself in a few seconds.";
    const acts = gone
      ? `<div class="up-acts">${UI.html("button", { label: "Check again", kind: "secondary", size: "sm", hook: "gp-retry" })}</div>`
      : "";
    const pop = old || makePop();
    if (!old) {
      pop.id = "gone-pop";
      pop.className = "update-pop restart-pop";
      stack.appendChild(pop);
    }
    paint(pop, `<div class="up-main"><div class="up-text">${words}</div>${acts}</div>`);
    const retry = pop.querySelector(".gp-retry");
    if (retry) listen(retry, "click", checkAgain);
    if (!gone) goneTimer = setTimeout(renderGonePop, Math.max(500, NOBODY_THERE_MS - down));
  }

    async function installUpdate(pop, version, name = "viberoom") {
    const go = pop.querySelector(".up-go");
    const text = pop.querySelector(".up-text");
    pop.dataset.busy = "1";
    go.disabled = true;
    UI.setState(go, "loading");
    text.innerHTML = `Installing <b>${esc(name)} ${esc(version)}</b>… this takes a moment.`;
    try {
      await post("/api/update/install", {}, { deadline: 10 * 60000 });
      if (owner.disposed || !made.has(pop) || !pop.isConnected) return;
      UI.setState(go, null);
      text.innerHTML = `<b>${esc(name)} ${esc(version)}</b> is installed. Restarting…`;
      go.hidden = true;
    } catch (e) {
      if (owner.disposed || !made.has(pop) || !pop.isConnected) return;
      delete pop.dataset.busy;
      UI.setState(go, null);
      go.disabled = false;
      go.textContent = "Try again";
      text.innerHTML = `<span class="error">${esc(e.message || String(e))}</span>`;
    }
  }
    const dispose = () => owner.dispose();
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ update: owner.guard(renderUpdatePop), hub: owner.guard(renderHubPop),
      restart: owner.guard(renderRestartPop), connection: owner.guard(renderGonePop), dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_RUNTIME_NOTICES = Object.freeze({ create });
})(globalThis);
