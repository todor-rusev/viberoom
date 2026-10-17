// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function(root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);
  function markup() { return '<form id="secret-form" method="dialog"><div id="sd-body"></div></form>'; }
  function create(dialog, ports) {
    const { window: view = dialog.ownerDocument.defaultView, signal, UI, icon: ic, time, pairLinkWords, consentTitle, noPeekHtml, geekTip, keyHelp: KEY_GEEK,
      readCard, wasCopied, refresh, decideBudget, revokeBudget, closeCard, connectCard, consentCard, saveKey, copyLink, toast, onError, openDialog, closeDialog } = ports;
    signal?.throwIfAborted(); const owner = root.VIBEROOM_APP_LIFETIME.create({window:view});
    dialog.innerHTML = markup(); const body=dialog.querySelector('#sd-body');
    let disposed=false, visit=0, model=null;
    const pending=new Set();
    const active = entered => !disposed && !signal?.aborted && entered===visit && dialog.open && !dialog.classList.contains('closing');
  function renderTrialBudgetDialog(card) {
    const offer = card.trialBudget;
    const valid = offer && offer.schema === "viberoom-human-whole-trial-offer-v1" && offer.launchEnabled === true
      && typeof offer.cardSha256 === "string" && /^[a-f0-9]{64}$/.test(offer.cardSha256)
      && typeof offer.viewSha256 === "string" && /^[a-f0-9]{64}$/.test(offer.viewSha256)
      && Number.isSafeInteger(offer.offerExpiresAt) && Number.isSafeInteger(offer.runMs) && offer.runMs > 0
      && offer.whole && typeof offer.whole === "object" && !Array.isArray(offer.whole)
      && Number.isFinite(offer.whole.policy?.limits?.localEstimatedCredits) && Number.isSafeInteger(offer.whole.policy?.kinds?.model);
    const disclosure = offer?.whole?.disclosure, schema = disclosure?.schema;
    const known = schema === "whole-private-trial-budget-disclosure-v2" || schema === "answers-only-budget-disclosure-v1";
    dialog.dataset.card = card.id;
    delete dialog.dataset.trialCardSha256; delete dialog.dataset.trialViewSha256;
    if (!valid || !known) {
      body.innerHTML = `<h3>Graph-memory comparison</h3><p class="lead">This offer is unavailable. Review a new card before approving a run.</p>
        <div class="actions">${UI.html("button", { label: "Close", kind: "ghost", act: "secret-close" })}</div>`;
    } else {
      const whole = offer.whole, limits = whole.policy?.limits || {}, kinds = whole.policy?.kinds || {};
      const expiry = `<p>The offer expires at ${esc(new Date(offer.offerExpiresAt).toLocaleString())}. This one run may last up to ${esc(String(offer.runMs / 60000))} minutes. Approval does not renew or resume an earlier run.</p>`;
      const told = schema === "answers-only-budget-disclosure-v1"
        ? `<h3><span class="h-ico">${ic("graph")}</span>Model answers only, once</h3>
        <p class="lead">Approve ${esc(String(kinds.model))} requests to ${esc(String(disclosure.answer?.model))} (${esc(String(disclosure.answer?.endpoint))}), each at most ${esc(String(disclosure.maxOutputTokensPerRequest))} output tokens (${esc(String(disclosure.maxOutputTokens))} in all), over ${esc(String(disclosure.inputTextUtf8Bytes))} bytes of input text. Zep is not asked: 0 requests, 0 credits.</p>
        <p class="field-note">Input tokens are not counted in advance; for reference, ${esc(String(disclosure.inputTokensReference))}.</p>
        ${expiry}
        <details open><summary>Exact inputs, model, request profile and limits</summary><pre>${esc(JSON.stringify(whole, null, 2))}</pre></details>`
        : `<h3><span class="h-ico">${ic("graph")}</span>One whole graph-memory comparison</h3>
        <p class="lead">Approve this whole trial once. Estimated DATA credits: ${esc(String(limits.localEstimatedCredits))}. Model jobs: ${esc(String(kinds.model))}. The estimate is not an invoice ceiling.</p>
        ${expiry}
        <details open><summary>Exact scope, providers, model, costs and limits</summary><pre>${esc(JSON.stringify(whole, null, 2))}</pre></details>`;
      body.innerHTML = `${told}
        <p class="field-note" id="sd-error" ${card.refusal ? "" : "hidden"}><b>${esc(card.refusal || "")}</b></p>
        <div class="actions">${UI.html("button", { label: "Not now", kind: "ghost", act: "trial-budget-reject" })}${UI.html("button", { label: "Approve this whole trial and run once", kind: "primary", act: "trial-budget-approve" })}</div>`;
      dialog.dataset.trialCardSha256 = offer.cardSha256;
      dialog.dataset.trialViewSha256 = offer.viewSha256;
    }
    if (!dialog.open) openDialog(dialog);
  }
    function render(card, facts = {}) {
      if(disposed || signal?.aborted) return;
      if(!card) { hide(); return; }
      if(model?.id !== card.id || model?.purpose !== card.purpose
        || (card.purpose === 'trial-budget' && model?.trialBudget?.viewSha256 !== card.trialBudget?.viewSha256)) ++visit;
      model=JSON.parse(JSON.stringify(card));
    if (card.purpose === "trial-budget") { renderTrialBudgetDialog(card); return; }
    if (card.purpose === "telegram-pair") {
      const link = card.link || {};
      const copied = wasCopied(card.id);
      const who = card.askedBy.kind === "vibemate" ? `<b>${esc(card.askedBy.name)}</b> asks you to pair your phone.` : "Pair your phone.";
      body.innerHTML = `
      <h3>Pair your phone</h3>
      <p class="lead">${who} Scan the QR code with the phone's camera, or open the link on the phone. Telegram opens the bot; the account that opens the link and presses Start is paired, on every device signed in to it.</p>
      <div class="field-note pair-offer">
        ${link.svg ? `<div class="pair-qr" title="Scan with the phone's camera">${link.svg}</div>` : ""}
        <div class="pair-words">
          <p>Good for ten minutes${link.expiresAt ? ` (until ${esc(time(link.expiresAt))})` : ""}: <a href="${esc(link.url || "#")}" target="_blank" rel="noopener">${esc(pairLinkWords(link.url || ""))}</a></p>
          <p>${copied ? "Copied: the link stays good until it runs out, even if you close this card." : "Closing this card withdraws the link, unless you copy it first."} ${UI.html("button", { label: copied ? "Copied" : "Copy link", size: "sm", act: "secret-copy" })}</p>
        </div>
      </div>
      <div class="actions">${UI.html("button", { label: "Close", kind: "ghost", act: "secret-close" })}</div>`;
      dialog.dataset.card = card.id;
      if (!dialog.open) openDialog(dialog);
      return;
    }
    if (card.purpose === "consent") {
      const c = card.consent || {};
      const CONSENT_HEADS = { memory: ["Turn on the long-term memory", "graph"], voice: ["Turn on the voice", "mic"], reading: ["Read the replies aloud", "speaker"] };
      const [title, icon] = CONSENT_HEADS[c.feature] || ["Turn it on", "lock"];
      const who = card.askedBy.kind === "vibemate" ? `<b>${esc(card.askedBy.name)}</b> asks you to turn it on. Only your press does; a vibemate cannot.` : "Read what it means first.";
      body.innerHTML = `
      <h3><span class="h-ico">${ic(icon)}</span>${title}</h3>
      <p class="lead">${who}</p>
      ${UI.html("consent-gate", { state: c.changed ? "lapsed" : "ask", icon, title: consentTitle(c.feature, c.recipient || "the provider", c.reader), words: c.words || "", answers: [{ label: "Not now", kind: "ghost", act: "secret-close" }, { label: c.changed ? "I agree" : "I agree, turn it on", kind: "primary", act: "secret-consent" }] })}
      <p class="field-note" id="sd-error" ${card.refusal && !c.changed ? "" : "hidden"}><b>${esc(card.refusal || "")}</b></p>`;
      dialog.dataset.card = card.id;
      if (!dialog.open) openDialog(dialog);
      return;
    }
    if (card.purpose === "connection") {
      const c = card.connection || {};
      const who = card.askedBy.kind === "vibemate"
        ? `<b>${esc(card.askedBy.name)}</b> asks you to ${c.add ? "add" : "connect"} <b>${esc(c.name || "")}</b> (${esc(c.blurb || "")}).`
        : `Connect <b>${esc(c.name || "")}</b>.`;
      const own = c.command
        ? `<p class="field-note">It runs on this computer with your rights, as <code class="cn-command">${esc(c.command)}</code>. Add it only if you trust where it comes from. Every one of its tools asks you before it runs, reading too.</p>`
        : c.url ? `<p class="field-note">Its address: <code>${esc(c.url)}</code>. viberoom has not looked at this server, so add it only if you trust who runs it. Every one of its tools asks you before it runs, reading too.</p>` : "";
      const headers = c.keysIn === "headers";
      const keys = (c.keys || []).map((name) => `<label>${esc(name)}<input type="password" class="sd-key" data-key="${esc(name)}" autocomplete="off" spellcheck="false" placeholder="${(c.keysSaved || []).includes(name) ? "saved; type to replace it" : headers ? "the whole value, such as Bearer sk-…" : "its value"}"></label>`).join("")
        + (headers && (c.keys || []).length ? `<p class="field-note">Each goes with every request to this server, and only there. Type the value whole, as the server's documentation gives it: often Bearer, a space, then the key.</p>` : "");
      body.innerHTML = `
      <h3>${UI.html("logo-tile", c.mark ? { icon: c.mark.url, brand: c.mark.hex } : { letter: (c.name || "?")[0] })}${c.add ? "Add" : "Connect"} ${esc(c.name || "")}</h3>
      <div class="sd-blind">${noPeekHtml("card", "The vibemate has turned its back: it never sees the access")}<p>${who}</p></div>
      ${own}
      ${c.signingIn ? "" : keys}
      <p class="lead">${c.signingIn ? (c.command ? "Starting it on this computer. This card closes by itself when it is done." : headers ? "Connecting with its key. This card closes by itself when it is done." : "Finish the sign-in in your browser, if it asks for one. This card closes by itself when it is done.") : c.command
        ? `${c.add ? "Add and connect puts" : "Connect starts"} ${esc(c.name || "it")} ${c.add ? "in Connections under Your own and starts it" : "on this computer"}.${(c.keys || []).length ? " The keys go into this computer's vault and to the program when it starts; no vibemate ever sees them." : ""} It stops when unused for a while and starts again when a vibemate needs it. You can turn it off for a room, or remove it, in Connections.`
        : headers
        ? `${c.add ? `Add and connect puts ${esc(c.name || "it")} in Connections under Your own and connects it` : `Connect connects ${esc(c.name || "it")}`} with its key. The key goes into this computer's vault and with every request to this server; no vibemate ever sees it. You can turn it off for a room, or remove it, in Connections.`
        : c.add
        ? `Add and connect puts ${esc(c.name || "it")} in Connections under Your own and connects it. If it asks for a sign-in, that opens in your browser; the access goes into this computer's vault, and no vibemate ever sees it. You can turn it off for a room, or remove it, in Connections.`
        : `Connect opens ${esc(c.name || "the system")}'s sign-in in your browser. You approve there what viberoom may do; the access goes into this computer's vault, and no vibemate ever sees it. It works in every room; you can turn it off for a room in Connections. Writing always asks you first, with the exact request.`}</p>
      <p class="field-note" id="sd-error" ${card.refusal ? "" : "hidden"}><b>${esc(card.refusal || "")}</b></p>
      <div class="actions">${UI.html("button", { label: "Not now", kind: "ghost", act: "secret-close" })}${c.signingIn ? "" : UI.html("button", { label: card.refusal ? "Try again" : c.add ? "Add and connect" : "Connect", kind: "primary", act: "secret-sign-in" })}</div>`;
      dialog.dataset.card = card.id;
      if (!dialog.open) openDialog(dialog);
      return;
    }
    const prior = body.querySelector("#sd-value");
    const typed = prior && dialog.dataset.card === card.id ? prior.value : "";
    const voiceTo = facts.voiceLabel || card.prefill?.provider || "the provider";
    const own = card.prefill?.provider === "compatible";
    const KEY_CARDS = {
      "telegram-token": { title: "Telegram bot key", asks: "for the key of your Telegram bot", lead: "Paste the key BotFather gave you: digits, a colon, then letters. It goes straight into viberoom's settings and the bot is started.", placeholder: "123456789:AbCdEf…", action: "Connect" },
      "memory-zep-key": { title: "Zep API key", asks: "for the key of your Zep project", lead: "Paste the project key from the Zep dashboard. It goes straight into this computer's vault; Zep Cloud becomes the memory provider, and the key is proven live before this card closes.", placeholder: "z_…", action: "Save" },
      "memory-sieve-key": { title: "Sieve API key", asks: "for the key of the memory sieve's endpoint", lead: "Paste the key of the sieve's endpoint. It goes straight into this computer's vault, and the sieve switches to its small model.", placeholder: "sk-…", action: "Save" },
      "voice-key": {
        title: `${voiceTo}: the key`, asks: `for the key of ${voiceTo}, to make your voice into words`,
        lead: own
          ? `Paste the server's key, or leave the field empty if it asks for none. ${voiceTo} becomes the voice's provider; nothing is sent until you turn the voice on.`
          : `Paste the key. It goes straight into this computer's vault; ${voiceTo} becomes the voice's provider, and the key is proven before this card closes. Nothing is sent until you turn the voice on.`,
        placeholder: card.prefill?.provider === "groq" ? "gsk_…" : own ? "empty for a server on this computer" : "sk-…", action: "Save",
        close: own ? "Not now" : undefined,
      },
    };
    const spec = KEY_CARDS[card.purpose] || KEY_CARDS["telegram-token"];
    const saved = card.purpose === "memory-sieve-key" || card.purpose === "voice-key"
      ? [card.prefill?.baseUrl && `endpoint <code>${esc(card.prefill.baseUrl)}</code>`, card.prefill?.model && `model <code>${esc(card.prefill.model)}</code>`, card.prefill?.language && `the language ${esc(new Intl.DisplayNames(["en"], { type: "language" }).of(card.prefill.language) || card.prefill.language)}`].filter(Boolean)
      : [];
    const prefill = saved.length ? `<p class="field-note">Saved together with the key: ${saved.join(", ")}.</p>` : "";
    const asker = card.askedBy.kind === "vibemate"
      ? `<b>${esc(card.askedBy.name)}</b> asks you ${spec.asks} — and is not looking: nothing pasted here is ever shown to a vibemate.`
      : `The setup asks you ${spec.asks}. Nothing pasted here is ever shown to a vibemate.`;
    body.innerHTML = `
      <h3><span class="h-ico">${ic("lock")}</span>${spec.title}</h3>
      <div class="sd-blind">${noPeekHtml("card", "The vibemate has turned its back and covers its eyes: it never sees this card")}<p>${asker}</p></div>
      <p class="lead">${spec.lead}</p>
      ${prefill}
      <label>Key<input type="password" id="sd-value" autocomplete="off" spellcheck="false" placeholder="${esc(spec.placeholder)}"></label>
      <p class="field-note" id="sd-error" ${card.refusal ? "" : "hidden"}><b>${esc(card.refusal || "")}</b></p>
      <div class="su-geek">${geekTip(KEY_GEEK)}</div>
      <div class="actions">${UI.html("button", { label: spec.close || "Close without a key", kind: "ghost", act: "secret-close" })}${UI.html("button", { label: spec.action, kind: "primary", act: "secret-connect" })}</div>`;
    dialog.dataset.card = card.id;
    const input = body.querySelector("#sd-value");
    input.value = typed;
    if (!dialog.open) openDialog(dialog);
    input.focus();
  }

    function hide() { ++visit; model=null; body.querySelectorAll('input').forEach(input => { input.value=''; }); if(dialog.open) closeDialog(dialog); }
    async function act(what) {
      if(disposed || !dialog.open) return;
      const card=readCard(), entered=visit;
      if(!card) return;
      if(card.id !== dialog.dataset.card) { refresh(); return; }
      const key=`${card.id}:${what}`; if(pending.has(key)) return;
      const report=error => { if(active(entered)) onError(error); };
      if(card.purpose==='trial-budget') {
        if(what==='secret-close') {
          pending.add(key); try { await revokeBudget(card.id); } catch(error) { report(error); } finally {pending.delete(key);} return;
        }
        if(what!=='trial-budget-approve' && what!=='trial-budget-reject') return;
        const shown=dialog.dataset, offer=card.trialBudget;
        if(!offer || shown.card!==card.id || !shown.trialCardSha256 || !shown.trialViewSha256
          || shown.trialCardSha256!==offer.cardSha256 || shown.trialViewSha256!==offer.viewSha256) {
          refresh(); onError(new Error('This offer changed. Review the displayed card before deciding.')); return;
        }
        const decision={cardSha256:shown.trialCardSha256,viewSha256:shown.trialViewSha256,decision:what==='trial-budget-approve'?'approve':'reject'};
        pending.add(key); try {await decideBudget(card.id,decision);} catch(error){report(error);} finally{pending.delete(key);} return;
      }
      pending.add(key);
      try {
        if(what==='secret-close') await closeCard(card.id,{copied:wasCopied(card.id)});
        else if(what==='secret-sign-in') {
          const keys=Object.fromEntries([...body.querySelectorAll('.sd-key')].map(input=>[input.dataset.key,input.value])); await connectCard(card.id,{keys});
        } else if(what==='secret-copy') {
          if(!card.link) return; await copyLink(card.id,card.link.url); if(active(entered)) {toast('Link copied.','ok');refresh();}
        } else if(what==='secret-consent') {try{await consentCard(card.id);}catch{}}
        else if(what==='secret-connect') {
          const value=body.querySelector('#sd-value')?.value.trim();
          if(!value && !(card.purpose==='voice-key' && card.prefill?.provider==='compatible')) return;
          try {await saveKey(card.id,{value:value||''});}
          catch(error){if(active(entered)){const note=body.querySelector('#sd-error');if(note){note.hidden=false;note.querySelector('b').textContent=error.message||String(error);}}}
        }
      }catch(error){report(error);}finally{pending.delete(key);}
    }
    owner.on(body,'click',event=>{const button=event.target.closest('[data-act]');if(button){event.preventDefault();void act(button.dataset.act);}});
    owner.on(body,'keydown',event=>{if(event.key==='Enter' && event.target.id==='sd-value'){event.preventDefault();void act('secret-connect');}});
    owner.on(dialog,'cancel',event=>{event.preventDefault();void act('secret-close');});
    owner.on(dialog,'close',()=>{++visit;body.querySelectorAll('input').forEach(input=>{input.value='';});});
    function dispose(){if(disposed)return;disposed=true;hide();owner.dispose();body.innerHTML='';}
    if(signal)owner.on(signal,'abort',dispose,{once:true});
    return Object.freeze({render,hide,dispose});
  }
  Object.defineProperty(create,'disposable',{value:true});Object.defineProperty(create,'scoped',{value:true});
  root.VIBEROOM_SECRET_DIALOG=Object.freeze({markup,create});
})(typeof window!=='undefined'?window:globalThis);
