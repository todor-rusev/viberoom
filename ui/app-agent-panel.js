// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  function troubleActions(p, recipes, { UI }) {
    const recipe = recipes.find((r) => r.id === p.agentType);
    const actions = (p.trouble && p.trouble.actions) || [];
    const buttons = actions
      .map((a, i) => {
        const kind = i === 0 ? "primary" : "paper";
        if (a === "retry") return UI.html("button", { label: "Retry", kind, size: "xs", act: "trouble-retry", icon: "refresh", title: "Send it the messages it missed again" });
        if (a === "respawn") return p.trouble.stage === "start"
          ? UI.html("button", { label: "Start again", kind, size: "xs", act: "trouble-respawn", icon: "bolt", title: "Start it again, with its notes and the last messages" })
          : UI.html("button", { label: "Fresh start", kind, size: "xs", act: "trouble-respawn", icon: "bolt", title: "A fresh session with its notes and the last messages; the history stays" });
        if (a === "login" && recipe && recipe.loginHow !== "none") return UI.html("button", { label: `Log in to ${recipe.vendor}`, kind, size: "xs", act: "trouble-login", icon: "lock" });
        return "";
      })
      .filter(Boolean);
    return buttons.length ? `<div class="fix">${buttons.join("")}</div>` : "";
  }
  function troubleRow(p, recipes, { UI, esc }) {
    return `<div class="p-trouble" title="${esc(`${p.trouble.advice}${p.statusDetail ? ` (${p.statusDetail})` : ""}`)}"><b>${esc(p.trouble.what)}</b>${troubleActions(p, recipes, { UI })}</div>`;
  }
  function markup(room, p, view, h) {
    const { UI, settingsCard, settingRow, wakeWord, vendorLogo, avatar, pickNowHtml, relTime, fmtTokens, numberHtml, skillChannelText, contextWords, lifeOf, contextEventText, lastReplyWords, fmtCost, panelTitle, profileHeader, ic, wedgeCardHtml, vendorLoggedOut, panelSearchHtml, panelSectionsHtml } = h;
    const rec = view.recipes.find((r) => r.id === p.agentType);
    const offline = p.status === "offline";
    const mutedStartup = offline && p.muted && p.startupSkipped === "muted";
    const byChoice = mutedStartup || (offline && !!p.asleep);
    const wake = wakeWord(p);
    const roomDelay = room.settings.replyDelay ?? 4;
    const stat = (label, value) => settingRow({ label, control: value });
    const tiles = view.recipes.filter((r) => !r.unavailableReason || r.id === p.agentType).map((r) => `<button type="button" class="agent-tile${r.id === p.agentType ? " selected" : ""}" data-agent="${esc(r.id)}" title="${esc(r.label)}">${vendorLogo(r, "lg")}<span class="at-name">${esc(r.vendor)}</span></button>`).join("");
    const sections = {
      persona: settingsCard("pp-persona", "", [
        settingRow({ label: "Vibename", for: "pp-name", control: UI.raw(`<input type="text" class="input" id="pp-name" maxlength="24" value="${esc(p.name)}">`) }),
        settingRow({ label: "Vibersona", for: "pp-tagline", hint: "Shown under the vibename.", geek: "Everyone in the room sees it: you, and the other vibemates in their roster.", control: UI.raw(`<input type="text" class="input" id="pp-tagline" maxlength="80" value="${esc(p.tagline || "")}" placeholder="a few words under the vibename">`) }),
        settingRow({ label: "Vibeface", id: "pp-avatar-row", hint: "Its face in the room and in the list of vibemates.", control: UI.raw(pickNowHtml(avatar(p, 36), "Pick another face")), fold: UI.raw(`<div id="pp-avatar-picker"></div><input type="text" class="input" id="pp-avatar" maxlength="40" value="${esc(p.avatar || "")}" placeholder="custom emoji (optional)">`) }),
        settingRow({ label: "Vibio", for: "pp-role", stacked: true, hint: UI.raw('Only this vibemate reads it.<span class="count" id="pp-role-count"></span>'), geek: "Changes reach this vibemate as updated instructions on its next turn; its memory is kept. Other vibemates never receive this text. The room settings limit the length of a vibio and the room rules separately; text over the limit is refused, never silently cut.", control: UI.raw(`<textarea class="textarea" id="pp-role" rows="5" placeholder="who it is, how it speaks, what it cares about">${esc(p.role || "")}</textarea>`) }),
      ].join("")),
      agent: [
        settingsCard("pp-engine", "", settingRow({ label: "Coding agent", id: "pp-recipe-row", hint: `${rec ? rec.vendor : p.agentVendor || "Its coding agent"} runs ${p.name}.`, geek: "A session cannot cross vendors, so the vibemate first writes its notes, then comes back on the new agent with those notes and the last messages of the room (like Fresh start with the last messages). Its name, vibio, colour and skills stay; model, effort and mode start from the new agent's defaults.", control: UI.raw(pickNowHtml(rec ? vendorLogo(rec) : UI.html("logo-tile", { letter: (p.agentVendor || p.agentType || "?")[0], title: p.agentVendor || p.agentType || "" }), `Run ${p.name} on another coding agent`)), fold: UI.raw(`<div class="agent-grid" id="pp-recipe">${tiles}</div><p class="hint">Another vendor: a new session with its notes and the last messages.</p>`) })),
        '<div id="pp-config"></div>',
        settingsCard("pp-notes-card", "Notes", [
          settingRow({ label: "Its notes", for: "pp-notes", stacked: true, hint: p.notes ? `Written ${p.notesWrittenAt ? relTime(p.notesWrittenAt) : "earlier"}, at ${fmtTokens(p.notesAt || 0)} tokens of context. Edit them here; an empty field clears them.` : "None yet. Write some here, or ask for them below.", geek: "About ten lines on its work, for a future restart: a fresh start with the last messages carries them, and so does a move to another coding agent. It writes them by itself when its context fills past 80% or is compacted (the room's Ask vibemates for notes automatically).", control: UI.raw(`<textarea class="textarea" id="pp-notes" rows="6" maxlength="4000" placeholder="what it is working on, what is decided, what is next">${esc(p.notes || "")}</textarea>`) }),
          settingRow({ label: "Take notes now", hint: p.notesTurn ? "Writing them now, in a hidden turn." : "A hidden turn: it writes them now. Nothing is posted in the room.", control: UI.raw(UI.html("button", { label: p.notes ? "Write them again" : "Take notes now", size: "sm", id: "pp-take-notes", disabled: !!p.notesTurn || p.status === "offline" || p.status === "unstaffed" })) }),
        ].join("")),
        settingsCard("pp-fresh-start", "Fresh start", [
          settingRow({ label: "Forget this conversation", hint: `${p.name} comes back with an empty head. The room's history stays and you still see everything.`, geek: "A session's context cannot be erased, so the vibemate's process and session are closed and it starts a new one with no replay. Its stored session is dropped too, or a later reconnect would bring the old context back. Same thing as typing /fresh-start @Name in the composer (/respawn still works).", control: UI.raw(UI.html("button", { label: "Fresh start", icon: "bolt", kind: "danger", size: "sm", act: "respawn" })) }),
          settingRow({ label: "Keep the last messages", for: "pp-respawn-n", hint: `A new session that gets only ${p.notes ? "its own notes and " : ""}the last N messages of this room; the rest is gone.`, control: UI.raw(`${UI.html("number-field", { id: "pp-respawn-n", value: String(room.settings.replayAfterRestart ?? 10), min: 0, max: 500 })}${UI.html("button", { label: "Fresh start with them", size: "sm", act: "respawn-mem" })}`) }),
        ].join(""), "danger"),
      ].join(""),
      skills: settingsCard("pp-skills-section", "", settingRow({ label: "Skills it can load", stacked: true, hint: "What this vibemate can load on request.", geek: `Listed in this vibemate's brief by name and description; the text arrives when you write /name or when the vibemate loads it. ${skillChannelText(p)}`, control: UI.raw('<div class="check-list" id="pp-skills"></div>') })),
      timing: settingsCard("pp-timing", "", settingRow({ label: "Reply delay override, seconds", for: "pp-delay", hint: `Overrides the room's delay (${roomDelay} s, used only when two or more vibemates are in) for this vibemate only, even when it is alone. Empty: it follows the room.`, geek: "Before each turn the vibemate waits a random 0–N seconds, so replies cross less often. Messages that arrive during the wait land in its backlog, so it can react to them or stay silent.", control: numberHtml({ id: "pp-delay", value: String(p.replyDelay ?? ""), min: 0, max: 120, step: 0.5, placeholder: `the room's: ${roomDelay} s` }) })),
      stats: settingsCard("pp-stats", "", [
        stat("Session", `${p.sessionOrigin === "loaded" ? "restored (session/load)" : p.sessionOrigin === "replayed" ? "new, history replayed" : p.status === "offline" ? "offline" : "new"}${p.supportsLoad === false ? " · no session/load" : ""}`),
        stat("Turns", String(p.turns ?? 0)),
        stat("Briefs sent", String(p.briefsSent ?? 0)),
        stat("Referee reminders", String(p.violations ?? 0)),
        stat("Hidden retries", String(p.retries ?? 0)),
        stat("Failed turns", String(p.failedTurns ?? 0)),
        settingRow({ label: "Context", hint: contextWords(p), control: UI.raw(`<span class="life-bar life-${lifeOf(p).tone}"><i style="width:${lifeOf(p).left ?? 0}%"></i></span>`) }),
        ...(p.contextEvent ? [stat("Last change of its context", contextEventText(p, p.contextEvent))] : []),
        stat("Last reply", lastReplyWords(room, p)),
        stat("Cost (estimate)", fmtCost(p.cost) || "—"),
        stat("Adapter", `${rec ? rec.label : p.agentLabel || ""}${p.agentInfo && p.agentInfo.version ? ` ${p.agentInfo.version}` : ""}`),
        ...(p.authStatus ? [settingRow({ label: "Account", hint: [p.authStatus.detail, p.authStatus.account?.organization].filter(Boolean).join(" · ") || "Reported by the agent itself.", control: `${p.authStatus.label}${p.authStatus.account && p.authStatus.account.email ? ` · ${p.authStatus.account.email}` : ""}` })] : []),
      ].join("")),
    };
    return `
      ${panelTitle("Vibemate", esc(room.name))}
      <div class="profile">
        ${profileHeader(p)}
      </div>
      <div class="action-row">
        <button class="action" data-act="mention"><span class="ico">${ic("at")}</span>Mention</button>
        <button class="action" data-act="${p.muted ? "unmute" : "mute"}"><span class="ico">${ic(p.muted ? "mute" : "unmute")}</span>${p.muted ? "Unmute" : "Mute"}</button>
        ${offline ? `<button class="action" data-act="reconnect"><span class="ico">${ic(wake === "Wake up" ? "sun" : "refresh")}</span>${wake}</button>` : `<button class="action" data-act="sleep" ${p.status === "starting" || p.status === "unstaffed" ? "disabled" : ""} title="${p.status === "starting" ? "It is starting; put it to sleep once it is up" : "Stop its agent now and give its memory back; it starts again only when you wake it up"}"><span class="ico">${ic("moon")}</span>Sleep</button><button class="action" data-act="cancel" ${p.status !== "thinking" && p.status !== "queued" ? "disabled" : ""}><span class="ico">${ic("stop")}</span>Stop</button>`}
        <button class="action danger" data-act="remove"><span class="ico">${ic("trash")}</span>Remove</button>
      </div>
      ${p.quiet ? wedgeCardHtml(p, Date.now()) : ""}
      ${p.trouble && p.status !== "thinking" && p.status !== "queued" ? `<div class="trouble"><b>${esc(p.trouble.what)}</b><span>${esc(p.trouble.advice)}</span>${troubleActions(p, view.recipes, { UI })}</div>` : ""}
      ${p.statusDetail && (p.status === "offline" || p.status === "error" || p.failedTurns) ? `<p class="hint" style="color:var(${byChoice ? "--warm-ink" : "--danger"});margin:0 4px 10px">${esc(p.statusDetail)}</p>` : ""}
      ${!mutedStartup && vendorLoggedOut(p) && p.trouble?.kind !== "login" ? `<div class="pp-login"><div class="row-btns">${UI.html("button", { label: `Log in to ${p.agentVendor || "the vendor"}`, icon: "lock", kind: "primary", size: "sm", act: "open-login-dialog", data: { recipe: p.agentType, purpose: "login" } })}</div><p class="hint">${esc(p.agentVendor || "The vendor")} is not logged in on this machine; log in, and ${esc(p.name)} comes back by itself.</p></div>` : ""}
      ${panelSearchHtml("vibemate", `Search ${p.name}'s settings`)}
      ${panelSectionsHtml("vibemate", sections, "pp-form")}`;

  }
  function render(panel, room, participant, view, helpers) {
    panel.dataset.panel = "vibemate";
    panel.innerHTML = markup(room, participant, view, helpers);
  }
  root.VIBEROOM_AGENT_PANEL = Object.freeze({ markup, render, troubleActions, troubleRow });
})(typeof window !== "undefined" ? window : globalThis);
