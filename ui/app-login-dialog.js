// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);
  function markup() { return '<form id="login-form" method="dialog"><div id="ld-body"></div></form>'; }
  function loginStatusWords(recipe) {
    const own = recipe.loginChecked && recipe.loginChecked.how === "command" && recipe.loginChecked.detail ? ` · ${recipe.loginChecked.detail}` : "";
    return recipe.loginState === "ok" ? recipe.loginChecked?.how === "acp" ? "ready to connect" : `logged in${own}` : recipe.loginState === "configured" ? `sign-in configured${own}` : recipe.loginState === "missing" ? `not logged in${own}` : "login not known";
  }
  function presentation(recipe, purpose, known, openedAt) {
    const flow = known && (known.state === "running" || (known.endedAt || 0) >= openedAt) ? known : null;
    const running = !!flow && flow.state === "running";
    const checkedAfter = !!flow && !!recipe.loginChecked && recipe.loginChecked.at >= (flow.endedAt || 0) && !recipe.loginChecking;
    const base = { vendor: recipe.vendor, icon: recipe.icon || "", purpose, flowId: flow ? flow.id : undefined, data: { recipe: recipe.id } };
    let confirmed = false;
    let props;
    if (purpose === "install") {
      const kind = recipe.installHow === "url" ? "url" : recipe.installHow === "terminal" ? "terminal" : "command";
      const idleScene = kind === "terminal" ? "terminal" : kind === "url" ? "browser" : "package";
      const geek = `${esc(recipe.installNote || "")}${recipe.installCommand ? ` It runs <code>${esc(recipe.installCommand)}</code>${kind === "terminal" ? " in a terminal window" : " hidden, the way you would in a terminal"}.` : ""} viberoom downloads nothing itself: it is the vendor's own installer.`;
      if (!recipe.unavailableReason && !running && (!flow || flow.state === "done")) {
        confirmed = checkedAfter && recipe.loginState === "ok";
        const words = confirmed ? `${recipe.vendor} is installed and ready to join. You can summon it now.`
          : recipe.loginChecking ? `${recipe.vendor} is installed. Checking its sign-in…`
          : recipe.loginState === "missing" ? `${recipe.vendor} is installed. Log in to use it.`
          : recipe.loginState === "configured" ? `${recipe.vendor} is installed and has sign-in details configured. You can summon it; the vendor will confirm access.`
          : `${recipe.vendor} is installed. Its sign-in could not be confirmed. You can check again or open its sign-in.`;
        props = { ...base, kind, state: "done", scene: "done", words, status: recipe.installedAt || undefined, lines: flow ? flow.lines : undefined };
      } else if (running) {
        props = { ...base, kind, state: "running", scene: idleScene, words: flow.detail, lines: flow.lines, geek };
      } else if (flow && flow.state === "failed") {
        props = { ...base, kind, state: "failed", scene: "failed", words: flow.detail, lines: flow.lines, geek, terminal: kind === "command" };
      } else {
        const words = kind === "url" ? `${recipe.vendor} is installed from its website. Follow the steps there, come back, and press Check again.` : kind === "terminal" ? `A terminal window opens with ${recipe.vendor}'s installer. Finish there, then press I'm done.` : `${recipe.vendor} is fetched from npm; the tile turns live when it is done.`;
        props = { ...base, kind, state: "idle", scene: idleScene, words, status: "not installed on this machine", url: recipe.installUrl, geek };
      }
      return { props: { ...props, confirmed, checking: !!recipe.loginChecking }, confirmed };
    }
    const kind = recipe.loginHow === "terminal" ? "terminal" : "command";
    const geek = `${esc(recipe.loginHint || "")}${recipe.loginTerminalCommand ? ` In a terminal it is <code>${esc(recipe.loginTerminalCommand)}</code>.` : ""} ${esc(recipe.vendor)} handles sign-in. This dialog displays its output and forwards any answers you enter here.`;
    const terminal = kind !== "terminal" && !!recipe.loginTerminalCommand;
    const said = loginStatusWords(recipe);
    if (recipe.loginState === "ok" && flow && !running && checkedAfter) {
      confirmed = true;
      props = { ...base, kind, state: "done", scene: "done", words: `${recipe.vendor} is ready to join the room.`, status: said, lines: flow.lines };
    } else if (running) {
      const scene = kind === "terminal" ? "terminal" : flow.wantsInput ? "question" : flow.code ? "code" : "browser";
      props = { ...base, kind, state: "running", scene, words: flow.detail, url: flow.url, code: flow.code, wantsInput: !!flow.wantsInput, lines: flow.lines, geek };
    } else if (flow && flow.state === "done" && !checkedAfter && recipe.loginChecking) {
      props = { ...base, kind, state: "done", scene: "done", words: `The sign-in command finished. Checking ${recipe.vendor}…`, lines: flow.lines };
    } else if (flow && flow.state === "done" && recipe.loginState === "missing") {
      props = { ...base, kind, state: "failed", scene: "failed", words: `The sign-in command finished, but ${recipe.vendor} reports: ${said || "not logged in"}.`, lines: flow.lines, geek, terminal };
    } else if (flow && flow.state === "done") {
      props = { ...base, kind, state: "done", scene: "done", words: recipe.loginState === "configured"
        ? `${recipe.vendor} has sign-in details configured. Access is confirmed when the vendor uses them.`
        : `The sign-in command finished, but ${recipe.vendor}'s access could not be confirmed. Check again or reopen sign-in.`, status: said, lines: flow.lines };
    } else if (flow && flow.state === "failed") {
      props = { ...base, kind, state: "failed", scene: "failed", words: flow.detail, lines: flow.lines, geek, terminal };
    } else {
      const scene = recipe.loginScene || "browser";
      const words = scene === "terminal" ? `A terminal window opens with ${recipe.vendor}'s own sign-in. Complete its menu and exit the vendor's screen; viberoom then checks the result.` : scene === "code" ? `${recipe.vendor} shows a page and a code. Open the page, type the code, and it signs you in.` : `${recipe.vendor} opens your browser. Sign in there and come back; viberoom waits.`;
      props = { ...base, kind, state: "idle", scene, words: flow && flow.state === "cancelled" ? `Cancelled. ${words}` : words, status: said, geek };
    }
    return { props: { ...props, confirmed, checking: !!recipe.loginChecking }, confirmed };
  }

  function create(dialog, { window: view = dialog.ownerDocument.defaultView, signal, UI, readFacts,
    startLogin, startInstall, checkRecipe, cancelFlow, sendAnswer, openUrl, copyText,
    toast, onError, openDialog, closeDialog } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let disposed = false, target = null, visit = 0, closeTimer = 0;
    dialog.innerHTML = markup(); const body = dialog.querySelector('#ld-body');
    const active = entered => !disposed && !signal?.aborted && entered === visit && dialog.open && !dialog.classList.contains('closing');
    const clearClose = () => { if (closeTimer) owner.clearTimeout(closeTimer); closeTimer = 0; };
    function render(force = false) {
      if (disposed || !target || (!force && !dialog.open)) return;
      const facts = readFacts(target.recipeId);
      if (!facts?.recipe) { closeDialog(dialog); return; }
      const recipe = facts.recipe;
      if (target.purpose === 'install' && !recipe.unavailableReason) {
        const inst = facts.install;
        if (recipe.loginChecked && recipe.loginChecked.at >= (inst ? inst.endedAt || 0 : 0) && !recipe.loginChecking && recipe.loginState === 'missing') {
          target.purpose = 'login'; toast(`${recipe.vendor} is installed. Now log in.`, 'success');
        }
      }
      const { props, confirmed } = presentation(recipe, target.purpose, target.purpose === 'install' ? facts.install : facts.login, target.openedAt);
      const prior = body.querySelector('.answer input');
      const typed = prior ? { value: prior.value, focused: dialog.ownerDocument.activeElement === prior, start: prior.selectionStart, end: prior.selectionEnd } : null;
      body.innerHTML = UI.html('login-dialog', props);
      const input = body.querySelector('.answer input');
      if (input && typed) { input.value = typed.value; if (typed.focused) { input.focus(); try { input.setSelectionRange(typed.start, typed.end); } catch {} } }
      else if (input) input.focus();
      if (confirmed) {
        if (!closeTimer) {
          const entered = visit, purpose = target.purpose;
          closeTimer = owner.timeout(() => { closeTimer = 0; if (!active(entered)) return;
            closeDialog(dialog); toast(purpose === 'install' ? `${recipe.vendor} is installed and logged in.` : `${recipe.vendor} is logged in.`, 'success');
          }, 1600);
        }
      } else clearClose();
    }
    function open(recipeId, purpose) {
      if (disposed) return false;
      const facts = readFacts(recipeId);
      if (!facts?.recipe) { toast('That agent is not on this machine.', 'warn'); return false; }
      ++visit; clearClose(); target = { recipeId, purpose: purpose || (facts.recipe.unavailableReason ? 'install' : 'login'), openedAt: Date.now() };
      body.innerHTML = ''; render(true); openDialog(dialog); return true;
    }
    async function answer(rootNode) {
      const input = rootNode?.querySelector('.answer input'); if (!input || !rootNode.dataset.flow) return;
      const text = input.value, flow = rootNode.dataset.flow; input.value = ''; await sendAnswer(flow, text);
    }
    async function action(btn) {
      if (!target || disposed) return;
      const entered = visit, recipeId = target.recipeId, purpose = target.purpose, act = btn.dataset.act;
      const rootNode = body.querySelector('[data-ui="login-dialog"]'), flowId = rootNode?.dataset.flow;
      try {
        if (act === 'close-login') closeDialog(dialog);
        else if (act === 'start-login' || (act === 'retry-login' && purpose === 'login')) { btn.disabled = true; target.purpose = 'login'; await startLogin(recipeId, false); }
        else if (act === 'start-install' || (act === 'retry-login' && purpose === 'install')) { btn.disabled = true; await startInstall(recipeId, false); }
        else if (act === 'terminal-login') { btn.disabled = true; await (purpose === 'install' ? startInstall(recipeId, true) : startLogin(recipeId, true)); }
        else if (act === 'rescan' || (act === 'recheck-login' && purpose === 'install')) { btn.disabled = true; await checkRecipe({ id: recipeId, rescan: true }); }
        else if (act === 'recheck-login') { btn.disabled = true; await checkRecipe({ id: recipeId, force: true }); }
        else if (act === 'cancel-login' && flowId) await cancelFlow(flowId);
        else if ((act === 'open-login-url' || act === 'open-install-url') && btn.dataset.url) openUrl(btn.dataset.url);
        else if (act === 'copy-login-code' && btn.dataset.code) { await copyText(btn.dataset.code); if (active(entered)) toast('Code copied.', 'ok'); }
        else if (act === 'send-login-answer') await answer(rootNode);
      } catch (error) { if (active(entered)) onError(error); }
    }
    owner.on(body, 'click', event => { const btn = event.target.closest('[data-act]'); if (btn) void action(btn); });
    owner.on(body, 'keydown', event => {
      if (event.key !== 'Enter' || !event.target.matches('.answer input')) return;
      event.preventDefault(); event.stopPropagation(); const entered = visit;
      answer(body.querySelector('[data-ui="login-dialog"]')).catch(error => { if (active(entered)) onError(error); });
    });
    owner.on(dialog, 'close', () => { ++visit; clearClose(); body.querySelectorAll('.answer input').forEach(input => { input.value = ''; }); });
    function dispose() { if (disposed) return; disposed = true; ++visit; clearClose(); owner.dispose(); if (dialog.open) closeDialog(dialog); body.innerHTML = ''; }
    if (signal) owner.on(signal, 'abort', dispose, { once: true });
    return Object.freeze({ open, render, dispose });
  }
  Object.defineProperty(create, 'disposable', {value:true}); Object.defineProperty(create, 'scoped', {value:true});
  root.VIBEROOM_LOGIN_DIALOG = Object.freeze({ markup, presentation, statusWords: loginStatusWords, create });
})(typeof window !== 'undefined' ? window : globalThis);
