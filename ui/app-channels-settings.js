// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function channelsState(c) {
    const tg = c.telegram;
    const paired = (c.pairings || []).filter((p) => !p.unpairedAt);
    if (!tg || !tg.tokenSet) return { kind: "unset", mark: { label: "Not set up", tone: "outline" }, line: "Make a bot for this computer and pair it; about ten minutes.", action: { label: "Set up Telegram…", act: "ch-setup" } };
    if (!tg.enabled) return { kind: "off", mark: { label: "Off", tone: "muted" }, line: "Switched off: the phone gets nothing until the channel is on again. The key and the paired accounts are kept.", action: { label: "Switch on", act: "ch-on" } };
    switch (tg.state) {
      case "degraded": return { kind: "problem", mark: { label: "Not listening", tone: "error" }, line: "Another computer is listening to this bot. Give this one a bot of its own.", action: { label: "Set up Telegram…", act: "ch-setup" } };
      case "contested": return { kind: "problem", mark: { label: "Two computers", tone: "error" }, line: "Another computer answers on this bot too: the phone gets every reply twice. Give this one a bot of its own.", action: { label: "Set up Telegram…", act: "ch-setup" } };
      case "checking": return { kind: "setting", mark: { label: "Checking…", tone: "waiting", dot: true }, line: "Another program answered for this bot; checking whether it lets go (a restart does within seconds).", action: null };
      case "paused": return { kind: paired.length ? "connected" : "setting", mark: { label: "Paused", tone: "waiting" }, line: "The conversation store is not answering; the channel resumes by itself.", action: null };
      case "connected":
      case "listening":
        if (paired.length) return { kind: "connected", mark: tg.state === "listening" ? { label: "Listening", tone: "ready", dot: true } : { label: "Connected", tone: "ready" }, line: "", action: null };
        return { kind: "setting", mark: { label: "Half done", tone: "waiting" }, line: "The key is in. Pair a phone to finish.", action: { label: "Continue setup…", act: "ch-continue" } };
      default:
        if (tg.detail) return { kind: "problem", mark: { label: "Not listening", tone: "error" }, line: `Not listening: ${tg.detail}.`, action: { label: "Replace the key…", act: "ch-replace-key" } };
        return { kind: "setting", mark: { label: "Starting…", tone: "waiting", dot: true }, line: "Connecting to Telegram…", action: null };
    }
  }
  function markup({ channels: c = { telegram: null, pairings: [] }, draft: channelsKeep, year }, { UI, esc, ic, geekTip, configurationProblemHtml }) {
    const tg = c.telegram;
    const st = channelsState(c);
    const active = (c.pairings || []).filter((p) => !p.unpairedAt);
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const when = (ts) => { const d = new Date(ts); return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === year ? "" : ` ${d.getFullYear()}`}`; };
    const machine = c.machine || "this computer";
    const title = tg && tg.tokenSet ? tg.name || tg.wantedName || `viberoom on ${machine}` : "Telegram";
    const head = `<div class="ch-head">${ic("send", "ch-mark")}<div class="ch-title">${esc(title)}${tg && tg.account ? `<small>@${esc(tg.account)}</small>` : ""}</div>${UI.html("badge", { label: st.mark.label, tone: st.mark.tone, dot: !!st.mark.dot })}</div>`;
    const line = st.line ? `<p class="ch-line">${esc(st.line)}</p>` : "";
    const facts = st.kind === "connected" ? `<ul class="ch-facts">
        <li>${ic("link")}<span>Room messages pass through Telegram.</span></li>
        <li>${ic("lock")}<span>Permission cards: ${c.phoneApprovals ? "can be answered from the phone." : "answered on this computer."}</span></li>
      </ul>` : "";
    const groups = st.kind === "connected" ? `<div class="ch-group"><div class="ch-group-title">Paired account${active.length === 1 ? "" : "s"}</div>
        ${active.map((p) => `<div class="ch-row">${ic("user")}<span class="grow"><b>${esc(p.name || p.senderId)}</b> — every device signed in to it <span class="hint">· paired ${esc(when(p.pairedAt))}</span></span>${UI.html("button", { label: "Unpair", kind: "danger-quiet", size: "xs", data: { unpair: p.senderId } })}</div>`).join("")}
        <div class="ch-acts">${UI.html("button", { label: "Pair another phone…", kind: "secondary", size: "sm", act: "ch-pair" })}</div>
      </div>
      <div class="ch-group"><div class="ch-group-title">This bot</div>
        <div class="ch-acts">${UI.html("button", { label: channelsKeep.rename ? "Keep the name" : "Rename…", kind: "secondary", size: "sm", act: "ch-rename" })}${UI.html("button", { label: "Replace the key…", kind: "secondary", size: "sm", act: "ch-replace-key" })}</div>
      </div>` : "";
    const acts = [];
    if (st.action) acts.push(UI.html("button", { label: st.action.label, kind: "primary", size: "sm", act: st.action.act }));
    if (st.kind === "problem" || st.kind === "setting") acts.push(UI.html("button", { label: "Switch off", kind: "secondary", size: "xs", act: "ch-off", title: "The key and the paired accounts are kept" }));
    acts.push(UI.html("button", { label: st.kind === "unset" ? "See the guide first" : "Open the guide", kind: "link", size: "xs", act: "ch-guide", title: "The steps, with pictures, inside viberoom" }));
    const rename = st.kind === "connected" && channelsKeep.rename
      ? UI.html("setting", {
        label: "Name shown on the phone",
        for: "sp-tg-name",
        hint: "One bot is one computer: a name that tells your computers apart. Anyone who opens the bot sees it. Saved when you leave the field; the bot reconnects with it.",
        control: UI.raw(`<input type="text" class="input" id="sp-tg-name" maxlength="64" spellcheck="false" value="${esc((tg && tg.wantedName) || "")}" placeholder="${esc(`viberoom on ${machine}`)}">`),
      })
      : "";
    const geek = st.kind === "unset"
      ? `<div class="ch-geek">${geekTip("Once it is on, the messages of any room you open on the phone travel through Telegram's servers. The bot's key is kept on this computer only and never shown again; a lost or leaked key is replaced with /revoke at BotFather, then the new one here. Every room is reachable from the phone unless switched off in the room's own settings.")}</div>`
      : "";
    const rows = (c.fileRoots || []).map((r) => `<div class="roots-row" data-root><input type="text" class="input roots-path" value="${esc(r.path)}" spellcheck="false" aria-label="Folder"><label class="check-row"><input type="checkbox" class="roots-deep" ${r.subfolders ? "checked" : ""}> and its subfolders</label>${UI.html("button", { label: "Remove", size: "xs", kind: "secondary", act: "roots-remove" })}</div>`).join("");
    const settings = st.kind === "connected" ? [
      rename,
      UI.html("setting", {
        label: "Folders the phone may be sent files from",
        stacked: true,
        geek: "Files named in a message, or asked for by name from the phone, get a Send button when they are inside one of these folders (with or without its subfolders), the room's own files or its working folder. What vibemates may read or write is their own matter and does not change here. Keep the list short: with its subfolders, a folder is the whole tree under it.",
        control: UI.raw(`<div class="roots-list" id="sp-tg-roots">${rows}<div class="roots-row"><input type="text" class="input" id="sp-tg-roots-new" value="${esc(channelsKeep.newRoot)}" placeholder="a folder" spellcheck="false" aria-label="A folder to add">${UI.html("button", { label: "Browse", icon: "folder", kind: "secondary", size: "sm", id: "sp-tg-roots-browse", title: "Choose a folder", hook: "browse-btn" })}${UI.html("button", { label: "Add", size: "sm", act: "roots-add" })}</div><div class="roots-row roots-depth"><label class="check-row"><input type="checkbox" id="sp-tg-roots-new-deep"${channelsKeep.newDeep ? " checked" : ""}> and its subfolders</label><span class="hint">For example ${esc(c.folderExample || "your Downloads folder")}; Browse finds it. The phone gets a Send button for files in these folders; vibemates get no access from this, and no file leaves this computer without your press.</span></div></div>`),
      }),
      UI.html("setting", {
        label: "Answer permission questions from the phone",
        for: "sp-tg-approvals",
        kind: "switch",
        checked: !!c.phoneApprovals,
        hint: `When a vibemate needs your permission — to edit a file, to run a command — the question reaches your phone too, so you do not walk to the computer to press Yes. Whoever holds the paired phone can allow that one action.${c.phoneApprovals ? "" : " Off: the phone only says the question is waiting on this computer."}`,
        geek: "Only for actions inside the room's folders; the choice for the whole session stays on this computer.",
      }),
      UI.html("setting", { label: "Channel on", for: "sp-tg-enabled", kind: "switch", checked: !!(tg && tg.enabled), hint: "Off keeps the key and the paired accounts; the phone gets nothing until it is on again." }),
    ].join("") : "";
    return `${configurationProblemHtml("channels-storage-problem", c.storageProblem)}<div class="ch-card" data-state="${st.kind}">${head}${line}${facts}${acts.length ? `<div class="ch-acts">${acts.join("")}</div>` : ""}${groups}${geek}</div>${settings}`;
  }
  function mount(section, { signal, UI, telegram, rename = false, saveTelegram, requestToken, unpair,
    onAccepted, onDraft, redraw, bindSave, chooseFolder, confirmUnpair, openSetup, openGuide, onError }) {
    if (!section?.ownerDocument || typeof saveTelegram !== "function" || typeof onAccepted !== "function") throw new TypeError("A channels root and application operations are required");
    signal?.throwIfAborted();
    const active = global.VIBEROOM_APP_LIFETIME.create({ window: section.ownerDocument.defaultView });
    const dispose = () => active.dispose();
    signal?.addEventListener("abort", dispose, { once: true });
    active.own(() => signal?.removeEventListener("abort", dispose));
    const current = () => !active.disposed && section.isConnected;
    const q = selector => section.querySelector(selector);
    const enabled = !!telegram?.enabled, wantedName = telegram?.wantedName || "";
    const report = error => { if (current()) onError(error); };
    const accept = result => { onAccepted(result); if (current()) redraw(); };
    try {
      for (const type of ["input", "change"]) active.on(section, type, event => event.stopPropagation());
      bindSave(section, async savedHere => {
        const patch = {};
        if (q("#sp-tg-enabled") && q("#sp-tg-enabled").checked !== enabled) patch.enabled = q("#sp-tg-enabled").checked;
        if (q("#sp-tg-name") && q("#sp-tg-name").value.trim() !== wantedName) patch.name = q("#sp-tg-name").value.trim();
        if (q("#sp-tg-approvals")) patch.phoneApprovals = q("#sp-tg-approvals").checked;
        if (q("#sp-tg-roots")) patch.fileRoots = [...section.querySelectorAll("#sp-tg-roots [data-root]")]
          .map(row => ({ path: row.querySelector(".roots-path").value.trim(), subfolders: row.querySelector(".roots-deep").checked })).filter(row => row.path);
        const result = await saveTelegram(patch);
        onAccepted(result);
        if (!savedHere()) return false;
        if (current()) redraw();
      }, { listen: active.on, canStart: () => current() });
      const rootsList = q("#sp-tg-roots"), newRoot = q("#sp-tg-roots-new"), newDeep = q("#sp-tg-roots-new-deep");
      if (newRoot) for (const type of ["input", "change"]) active.on(newRoot, type, event => { onDraft({ newRoot: newRoot.value }); event.stopPropagation(); });
      if (newDeep) for (const type of ["input", "change"]) active.on(newDeep, type, event => { onDraft({ newDeep: newDeep.checked }); event.stopPropagation(); });
      const addRoot = dir => {
        if (!current()) return;
        const path = (dir || "").trim();
        if (!path || !rootsList) return;
        if ([...rootsList.querySelectorAll("[data-root] .roots-path")].some(input => input.value.trim().toLowerCase() === path.toLowerCase())) {
          newRoot.value = ""; onDraft({ newRoot: "" }); return;
        }
        const row = section.ownerDocument.createElement("div"); row.className = "roots-row"; row.dataset.root = "";
        row.innerHTML = `<input type="text" class="input roots-path" spellcheck="false" aria-label="Folder"><label class="check-row"><input type="checkbox" class="roots-deep"> and its subfolders</label>${UI.html("button", { label: "Remove", size: "xs", kind: "secondary", act: "roots-remove" })}`;
        row.querySelector(".roots-path").value = path;
        row.querySelector(".roots-deep").checked = !newDeep || newDeep.checked;
        rootsList.insertBefore(row, newRoot.parentElement);
        newRoot.value = ""; if (newDeep) newDeep.checked = true;
        onDraft({ newRoot: "", newDeep: true });
        rootsList.dispatchEvent(new section.ownerDocument.defaultView.Event("change", { bubbles: true }));
      };
      if (newRoot) active.on(newRoot, "keydown", event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); addRoot(newRoot.value); } });
      const browse = q("#sp-tg-roots-browse");
      if (browse) active.on(browse, "click", () => chooseFolder(newRoot.value.trim(), active.guard(addRoot)));
      const setEnabled = async value => { try { accept(await saveTelegram({ enabled: value })); } catch (error) { report(error); } };
      active.on(section, "click", async event => {
        const button = event.target.closest("[data-act]");
        if (!button || !section.contains(button) || !current()) return;
        event.preventDefault();
        switch (button.dataset.act) {
          case "ch-setup": return openSetup();
          case "ch-continue": return openSetup("next");
          case "ch-pair": return openSetup("pair");
          case "ch-guide": return openGuide();
          case "ch-on": return setEnabled(true);
          case "ch-off": return setEnabled(false);
          case "ch-replace-key":
            try { await requestToken(); } catch (error) { report(error); } return;
          case "ch-rename": onDraft({ rename: !rename }); return redraw(true);
          case "roots-add": return addRoot(newRoot.value);
          case "roots-remove": button.closest("[data-root]").remove(); rootsList.dispatchEvent(new section.ownerDocument.defaultView.Event("change", { bubbles: true })); return;
        }
      });
      for (const button of section.querySelectorAll("[data-unpair]")) active.on(button, "click", async () => {
        if (!current()) return;
        const senderId = button.dataset.unpair;
        try {
          const choice = await active.wait(confirmUnpair("From now on that Telegram account is a stranger to the bot, on every device signed in to it: it can neither write to the rooms nor read their replies. What it already asked for keeps running unless you stop it too.",
            { title: "Unpair this account?", okLabel: "Unpair", altLabel: "Unpair and stop its turns" }));
          if (choice === "cancel" || !current()) return;
          accept(await unpair(senderId, choice === "alt"));
        } catch (error) { report(error); }
      });
    } catch (error) { dispose(); throw error; }
    return Object.freeze({ dispose });
  }
  Object.defineProperty(mount, "disposable", { value: true });
  Object.defineProperty(mount, "scoped", { value: true });
  global.VIBEROOM_CHANNELS_SETTINGS = Object.freeze({ markup, mount, state: channelsState });

})(globalThis);
