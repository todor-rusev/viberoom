// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  const SETUP_STEPS = ["what", "bot", "key", "name", "pair", "done"];
  const SETUP_STOPS = [["bot", "Bot"], ["key", "Key"], ["name", "Name"], ["pair", "Phone"]];
  const NEWBOT = "/newbot";
  const BOTFATHER_URL = "https://t.me/BotFather";
  const pairLinkWords = (url) => String(url || "").replace(/(start=)(.{4}).+$/, "$1$2…");
  function isSetupSecretCard(card) {
    return !!(card && card.purpose === "telegram-token" && card.state === "open"
      && card.askedBy?.kind === "window" && typeof card.id === "string" && card.id.length);
  }
  function setupKeyStatus(tg) {
    if (!tg || !tg.enabled || !tg.tokenSet) return { text: "", done: false };
    switch (tg.state) {
      case "listening": return { text: `Connected as @${tg.account || "?"}`, done: true };
      case "contested": return { text: "Another computer answers on this bot too: the phone gets every reply twice. Give this one a bot of its own.", done: true, another: true };
      case "connected": return { text: "Checking the line to the phone…", done: false };
      case "checking": return { text: "Another program answered for this bot; checking whether it lets go…", done: false };
      case "degraded": return { text: "Another computer is listening to this bot. Give this one a bot of its own.", done: false, another: true };
      case "paused": return { text: `Connected as @${tg.account || "?"}; the conversation store is not answering, it resumes by itself.`, done: true };
      default: return tg.detail ? { text: `Not listening: ${tg.detail}.`, done: false, bad: true } : { text: "Starting…", done: false };
    }
  }
  function setupStopsHtml(step) {
    const name = SETUP_STEPS[step];
    const at = SETUP_STOPS.findIndex(([s]) => s === name);
    const allDone = name === "done";
    return `<ol class="su-steps" aria-label="Steps">${SETUP_STOPS.map(([s, label], i) => `<li class="${allDone || (at >= 0 && i < at) ? "done" : at === i ? "on" : ""}">${label}</li>`).join("")}</ol>`;
  }
  function markup(step, facts, { UI, esc, ic, scene, noPeekHtml, geekTip, time }) {
    const stage = name => `<div class="su-stage" aria-hidden="true">${scene(name)}</div>`;
    const { tg, machine, card, paired, link, now, botfatherQr, linkFailed, guide } = facts;
    const key = setupKeyStatus(tg);
    const stops = setupStopsHtml(step);
    const last = step === SETUP_STEPS.length - 1;
    const nav = (nextLabel, nextOn = true, extra = "") => `<div class="actions">${extra}${UI.html("button", { label: "Close", kind: "ghost", act: "su-close" })}${step > 0 ? UI.html("button", { label: "Back", kind: "ghost", act: "su-back" }) : ""}${UI.html("button", { label: nextLabel, kind: "primary", act: last ? "su-close" : "su-next", disabled: !nextOn })}</div>`;
    const note = (icon, text) => `<p class="su-note">${ic(icon)}<span>${text}</span></p>`;
    const sign = (text) => `<p class="su-sign ok"><span class="su-check">${ic("check")}</span><span>${text}</span></p>`;
    const waiting = (text) => `<p class="su-sign"><span class="su-dot"></span><span>${text}</span></p>`;
    const bad = (text, id) => `<p class="su-sign bad"${id ? ` id="${id}"` : ""}><b>${text}</b></p>`;
    const botfather = UI.html("button", { label: "Open BotFather", kind: "primary", size: "sm", act: "su-open-botfather", title: "Opens Telegram on this computer, or the web page" });
    switch (SETUP_STEPS[step]) {
      case "what":
        return `${stops}<div class="su-stage wide" aria-hidden="true"><div>${scene("bot-mini")}<div class="su-cap">a bot</div></div><div class="su-arrow">→</div><div>${scene("key-mini")}<div class="su-cap">its key</div></div><div class="su-arrow">→</div><div>${scene("phone-mini")}<div class="su-cap">your phone</div></div></div>
      <h3>Set up Telegram</h3>
      <p class="lead">Three things: a bot, its key, your phone. About ten minutes.</p>
      ${note("link", "Once it is on, the messages of any room you open on the phone travel through Telegram.")}${nav("Start")}`;
      case "bot":
        return `${stops}${stage("bot")}
      <h3>Make the bot</h3>
      <p class="lead">In Telegram, send <code>${NEWBOT}</code> to BotFather. It asks for a name, then a username ending in <i>bot</i>.</p>
      <div class="su-paths">
        <div class="su-path"><b>On the phone</b>${botfatherQr ? `<div class="su-qr" title="Scan with the phone's camera: BotFather opens there">${botfatherQr}</div><span class="hint">Scan: BotFather opens there.</span>` : `<span class="hint">Open ${esc(BOTFATHER_URL)} there.</span>`}<span class="hint">Made the bot on the phone? The same chat is in Telegram on this computer — copy the key there.</span></div>
        <div class="su-path"><b>On this computer</b>${botfather}${UI.html("button", { label: `Copy ${NEWBOT}`, kind: "secondary", size: "xs", act: "su-copy-newbot" })}</div>
      </div>
      ${note("info", "Username taken? BotFather asks again — pick another one ending in <i>bot</i>.")}
      <p class="field-note">You make the bot yourself, so the key never passes through anyone else's server.</p>${nav("Next")}`;
      case "key": {
        const refusal = card && card.refusal ? bad(esc(card.refusal), "su-refusal") : "";
        let status = "";
        if (key.another) status = `${note("alert", esc(key.text))}<div class="su-row">${botfather}</div>`;
        else if (key.done) status = `${sign(esc(key.text))}<p class="field-note">Another bot? ${UI.html("button", { label: "Replace the key", kind: "secondary", size: "xs", act: "su-replace-key" })}</p>`;
        else if (key.bad) status = bad(esc(key.text));
        else if (key.text) status = waiting(esc(key.text));
        const field = key.done ? "" : `<div class="su-field">${noPeekHtml()}<input type="password" id="su-key" autocomplete="off" spellcheck="false" placeholder="paste here" aria-label="The key">${UI.html("button", { label: "Connect", kind: key.another ? "secondary" : "primary", size: "sm", act: "su-connect" })}</div>${refusal}`;
        return `${stops}${stage("key")}
      <h3>The key</h3>
      <p class="lead">BotFather answers with a long line: numbers, a colon, a secret. Paste the whole message here — I will take the key out of it.</p>
      ${field}${status}
      <div class="su-geek">${geekTip("Who sees the key: nobody in the chat. It is not shown to the vibemates and does not enter the conversation, the record or the model's context; viberoom keeps it on this computer and uses it to talk to Telegram. Replace it any time with Replace the key…, and /revoke in BotFather makes the old one useless.")}</div>${nav("Next", key.done)}`;
      }
      case "name":
        return `${stops}${stage("name")}
      <h3>The name</h3>
      <p class="lead">The name your phone shows for this bot. One bot is one computer.</p>
      <div class="su-field"><input type="text" id="su-name" maxlength="64" spellcheck="false" value="${esc((tg && (tg.wantedName || tg.name)) || "")}" placeholder="${esc(`viberoom on ${machine}`)}" aria-label="The name">${UI.html("button", { label: "Apply", kind: tg && tg.name ? "secondary" : "primary", size: "sm", act: "su-apply-name" })}</div>
      ${note("eye", "Anyone who opens the bot sees this name.")}
      ${tg && tg.name ? sign(`On the phone the bot is called “${esc(tg.name)}”${key.done ? "" : "; reconnecting…"}`) : ""}${nav("Next", key.done)}`;
      case "pair": {
        const live = !!(link && link.expiresAt > now);
        const expired = !!(link && link.expiresAt <= now);
        const done = paired.length ? `${sign(`Paired: ${esc(paired.join(", "))}`)}<p class="su-sign"><span>Not you? Unpair in Settings → Channels.</span></p>` : "";
        let body;
        if (!key.done) body = note("alert", "The bot has to be connected first (the previous steps).");
        else if (live) body = `<div class="su-pair"><div class="su-qr big" title="Scan with the phone's camera">${link.svg || ""}</div><div class="su-words"><p>Or open the link on the phone, within 10 minutes (until ${esc(time(link.expiresAt))}):</p><p><a href="${esc(link.url)}" target="_blank" rel="noopener">${esc(pairLinkWords(link.url))}</a></p><p>${UI.html("button", { label: link.copied ? "Copied" : "Copy link", kind: "secondary", size: "xs", act: "su-copy-link" })}</p></div></div>
      ${note("user", "What pairs is a Telegram account: every device signed in to it can write to your rooms.")}
      ${note("alert", "Anyone who opens this code pairs — do not show it on a shared screen.")}
      <p class="field-note">${link.copied ? "Copied: the link stays good until it runs out, even if you close this." : "Close this and the link is withdrawn, unless you copied it."}</p>`;
        else if (expired) body = `${bad("The code has run out.")}<div class="su-row">${UI.html("button", { label: "New code", kind: "primary", size: "sm", act: "su-make-link" })}</div>`;
        else if (linkFailed) body = `${bad("The code could not be made.")}<div class="su-row">${UI.html("button", { label: "Try again", kind: "primary", size: "sm", act: "su-make-link" })}</div>`;
        else if (paired.length) body = `<div class="su-row">${UI.html("button", { label: "Pair another phone…", kind: "secondary", size: "sm", act: "su-make-link" })}</div>`;
        else body = waiting("Making the code…");
        return `${stops}${stage("phone")}
      <h3>Pair your phone</h3>
      <p class="lead">Scan this with your phone's camera, then press Start in Telegram.</p>
      ${paired.length && !live ? done + body : body + done}${nav("Next", paired.length > 0)}`;
      }
      default:
        return `${stops}${stage("rooms")}
      <h3>Done</h3>
      <p class="lead">Send <code>/rooms</code> to the bot, open a room, write a line.</p>
      ${nav("Done", true, guide ? UI.html("button", { label: "Open the guide", kind: "secondary", act: "su-open-guide" }) : "")}`;
    }
  }
  function firstUndoneStep(facts) {
    if (!facts.tg || !facts.tg.tokenSet) return "bot";
    if (!setupKeyStatus(facts.tg).done) return "key";
    if (!facts.paired.length) return "pair";
    return "done";
  }
  function dialogMarkup() { return '<form id="setup-form" method="dialog"><div id="su-body"></div></form>'; }
  function create(dialog, { body, signal, readFacts, markupPorts, openDialog, closeDialog, openGuide, loadQr,
    requestToken, answerToken, closeToken, saveName, onNameAccepted, makeLink, onLinkAccepted, discardLink, dropLink,
    markCopied, copyText, openBotfather, toast, onClosed, onError }) {
    if (!dialog?.ownerDocument || typeof readFacts !== "function") throw new TypeError("A Telegram dialog and selected facts are required");
    signal?.throwIfAborted();
    if (!body) { dialog.innerHTML = dialogMarkup(); body = dialog.querySelector("#su-body"); }
    if (!dialog.contains(body)) throw new TypeError("A Telegram dialog and selected facts are required");
    const owner = global.VIBEROOM_APP_LIFETIME.create({ window: dialog.ownerDocument.defaultView });
    let visit = null, step = 0, wantCode = false, linkFailed = false, linkJob = null, cleanupLink = Promise.resolve(), expiry = 0;
    const current = scope => scope && scope === visit && !scope.disposed && !owner.disposed;
    const facts = () => ({ ...readFacts(), linkFailed });
    const clearExpiry = () => { if (expiry && visit) visit.clearTimeout(expiry); expiry = 0; };
    const report = (scope, error) => { if (current(scope)) onError(error); };
    function askLink() {
      const scope = visit;
      if (!current(scope) || linkJob) return;
      linkFailed = false;
      linkJob = (async () => {
        try {
          await cleanupLink;
          if (!current(scope)) return;
          const result = await makeLink();
          if (current(scope)) onLinkAccepted(result);
          else await discardLink();
        } catch (error) { if (current(scope)) { linkFailed = true; report(scope, error); } }
        finally { linkJob = null; if (visit) render(); }
      })();
    }
    function render() {
      const scope = visit;
      if (!current(scope)) return;
      const value = facts(), typed = {};
      for (const id of ["su-key", "su-name"]) {
        const input = body.querySelector(`#${id}`);
        if (input) typed[id] = { value: input.value, focused: dialog.ownerDocument.activeElement === input };
      }
      body.innerHTML = markup(step, value, markupPorts);
      for (const [id, saved] of Object.entries(typed)) {
        const input = body.querySelector(`#${id}`);
        if (!input) continue;
        if (saved.value) input.value = saved.value;
        if (saved.focused) input.focus();
      }
      if (!Object.keys(typed).length) body.querySelector("#su-key, #su-name")?.focus();
      clearExpiry();
      if (SETUP_STEPS[step] === "pair") {
        if (setupKeyStatus(value.tg).done && !value.link && !linkFailed && (wantCode || !value.paired.length)) askLink();
        if (value.link?.expiresAt > value.now) expiry = scope.timeout(() => { expiry = 0; render(); }, value.link.expiresAt - value.now + 50);
      }
    }
    function close() {
      if (!visit) return;
      const card = readFacts().card;
      clearExpiry(); const scope = visit; visit = null; scope.dispose(); wantCode = false; linkFailed = false;
      body.replaceChildren(); closeDialog(dialog);
      if (isSetupSecretCard(card)) Promise.resolve(closeToken(card.id)).catch(() => {});
      cleanupLink = Promise.resolve(dropLink()).catch(() => {});
      if (!owner.disposed) onClosed();
    }
    async function tokenCard(scope, retained) {
      if (isSetupSecretCard(retained)) return retained;
      const card = (await requestToken()).request;
      if (!isSetupSecretCard(card)) throw new Error("The Telegram key card is unavailable. Request a new card.");
      if (!current(scope)) { await closeToken(card.id); return null; }
      return card;
    }
    async function act(scope, what) {
      if (!current(scope)) return;
      const value = facts();
      if (what === "su-close") return close();
      if (what === "su-back") { step = Math.max(0, step - 1); return render(); }
      if (what === "su-next") { step = Math.min(SETUP_STEPS.length - 1, step + 1); return render(); }
      if (what === "su-open-guide") { close(); openGuide(); return; }
      try {
        if (what === "su-open-botfather") return await openBotfather();
        if (what === "su-copy-newbot") { await copyText(NEWBOT); if (current(scope)) toast(`${NEWBOT} copied.`, "ok"); return; }
        if (what === "su-copy-link") {
          if (!value.link || value.link.expiresAt <= value.now) return;
          const url = value.link.url;
          await copyText(url);
          if (current(scope)) { markCopied(url); toast("Link copied.", "ok"); render(); }
          return;
        }
        if (what === "su-replace-key") { await tokenCard(scope, null); return; }
        if (what === "su-connect") {
          const typed = (body.querySelector("#su-key")?.value || "").trim();
          if (!typed) return;
          const card = await tokenCard(scope, value.card);
          if (!card || !current(scope)) return;
          await answerToken(card.id, typed);
          return;
        }
        if (what === "su-apply-name") {
          const name = (body.querySelector("#su-name")?.value || "").trim();
          onNameAccepted(await saveName(name));
          if (current(scope)) render();
          return;
        }
        if (what === "su-make-link") { wantCode = true; askLink(); }
      } catch (error) {
        if (!current(scope)) return;
        if (what === "su-connect") {
          const note = body.querySelector("#su-refusal b");
          if (note) note.textContent = error.message || String(error); else render();
        } else report(scope, error);
      }
    }
    function open(at) {
      if (owner.disposed) return;
      if (!visit) {
        visit = global.VIBEROOM_APP_LIFETIME.create({ window: dialog.ownerDocument.defaultView });
        const scope = visit, busy = new Set();
        const invoke = what => {
          if (!current(scope) || busy.has(what)) return;
          busy.add(what);
          Promise.resolve(act(scope, what)).finally(() => busy.delete(what));
        };
        scope.on(body, "click", event => { const button = event.target.closest("[data-act]"); if (!button || !body.contains(button)) return; event.preventDefault(); invoke(button.dataset.act); });
        scope.on(body, "keydown", event => {
          if (event.key !== "Enter") return;
          if (event.target.id === "su-key" || event.target.id === "su-name") { event.preventDefault(); invoke(event.target.id === "su-key" ? "su-connect" : "su-apply-name"); }
        });
        scope.on(dialog, "cancel", event => { event.preventDefault(); close(); });
      }
      wantCode = at === "pair";
      const next = at === "next" ? firstUndoneStep(facts()) : at || SETUP_STEPS[0];
      step = Math.max(0, SETUP_STEPS.indexOf(next)); render(); openDialog(dialog); loadQr();
    }
    function dispose() { if (owner.disposed) return; owner.dispose(); close(); signal?.removeEventListener("abort", dispose); }
    signal?.addEventListener("abort", dispose, { once: true });
    return Object.freeze({ open, close, render, dispose, get isOpen() { return !!visit; } });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  global.VIBEROOM_TELEGRAM_SETUP = Object.freeze({ markup, dialogMarkup, create, steps: Object.freeze(SETUP_STEPS),
    keyStatus: setupKeyStatus, firstUndone: firstUndoneStep, maskLink: pairLinkWords, ownsTokenCard: isSetupSecretCard });

})(globalThis);
