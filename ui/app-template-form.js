// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function render(t, { recipes = [], readsChoices, UI, esc, settingRow, settingsCard, selectHtml, numberHtml, avatar, fallbackColor } = {}) {
    const st = t.settings || {};
    const lang = st.language && st.language.mode === "fixed" ? st.language.language : "";
    const text = (id, value, props = "") => UI.raw(`<input type="text" class="input" id="${id}" value="${esc(value)}"${props}>`);
    const toggle = (label, id, on) => settingRow({ label, for: id, kind: "switch", checked: !!on });
    const pick = (label, id, value, options) => settingRow({ label, for: id, control: UI.raw(selectHtml(id, options, String(value))) });
    const number = (label, id, props) => settingRow({ label, for: id, control: numberHtml({ id, ...props }) });
    const cards = [
      settingsCard("stp-general", "General", [
        settingRow({ label: "Emoji", for: "stp-emoji", control: text("stp-emoji", t.emoji || "", ' maxlength="40" placeholder="none"') }),
        settingRow({ label: "Topic", for: "stp-topic", control: text("stp-topic", st.topic || "", ' maxlength="2000" placeholder="what the room is about"') }),
        settingRow({ label: "Folder", for: "stp-dir", stacked: true, control: UI.raw(`<span class="dir-row"><input type="text" class="input" id="stp-dir" maxlength="1000" value="${esc(t.dir || "")}" spellcheck="false">${UI.html("button", { label: "Browse", icon: "folder", kind: "ghost", hook: "browse-btn", title: "Choose a folder", data: { stpBrowse: true } })}</span>`) }),
        pick("About you", "stp-about", st.humanDescriptionMode || "inherit", [["inherit", "Program-wide description"], ["append", "Program-wide + this room's"], ["override", "Only this room's"], ["none", "Nothing about me"]]),
      ].join("")),
      settingsCard("stp-rules-card", "Rules", [
        settingRow({ label: "Room rules", for: "stp-rules", stacked: true, hint: "One rule per line.", control: UI.raw(`<textarea class="textarea" id="stp-rules" rows="5" placeholder="one rule per line">${esc(st.customRules || "")}</textarea>`) }),
        settingRow({ label: "Language", for: "stp-lang", control: text("stp-lang", lang, ' placeholder="follow the human (default), or e.g. English"') }),
        number("Max sentences per reply", "stp-maxlen", { value: String(st.maxSentences ?? ""), min: 1, max: 100, placeholder: "no limit" }),
        pick("Vibemates' own tools (files, shell, web)", "stp-tools", st.tools || "on-request", [["on-request", "Only when someone explicitly asks"], ["never", "Never (chat only)"]]),
      ].join("")),
      settingsCard("stp-conversation", "Conversation", [
        pick("Who may speak", "stp-turns", st.turnTaking || "parallel", [["one-at-a-time", "One vibemate at a time"], ["parallel", "All addressed vibemates at once"]]),
        number("Reply delay, seconds", "stp-delay", { value: String(st.replyDelay ?? 4), min: 0, max: 120, step: 0.5 }),
        toggle("Vibemates wake each other", "stp-wake", st.agentsWakeEachOther !== false),
        toggle("Wait while you are typing", "stp-wait", st.waitWhileHumanTypes !== false),
        number("Hop limit", "stp-hops", { value: String(st.hopLimit ?? 100), min: 0, max: 10000 }),
        toggle("Tell vibemates what they missed while working", "stp-missed-notice", st.missedMessagesNotice),
        toggle("Share this room's history with the other rooms", "stp-share-history", st.sharesHistory !== false),
        pick("Search the other rooms", "stp-reads-others", st.readsOtherRooms || "on-search", readsChoices),
        toggle("Reachable from messengers", "stp-reachable", st.reachableFromMessengers !== false),
      ].join("")),
      settingsCard("stp-start", "Start", [
        toggle("Start this room with viberoom", "stp-start-with-hub", st.startWithHub === true),
        pick("…and they come back", "stp-reconnect", st.reconnectMode || "inherit", [["inherit", "As Welcome back is set"], ["load", "Continuing their saved sessions"], ["replay", "Fresh, with the last messages replayed"]]),
        toggle("Wake vibemates after a restart", "stp-wake-restart", st.wakeAfterRestart === true),
        settingRow({ label: "Message after restart", for: "stp-restart-message", stacked: true, control: UI.raw(`<textarea class="textarea" id="stp-restart-message" rows="3" maxlength="8000">${esc(st.restartMessage || "")}</textarea>`) }),
        number("Replay last N chat messages after a reconnect", "stp-replay", { value: String(st.replayAfterRestart ?? 10), min: 0, max: 200 }),
      ].join("")),
      settingsCard("stp-briefs", "Briefs", [
        number("Full brief every N vibemate turns", "stp-brief-turns", { value: String(st.fullBriefEveryTurns ?? 8), min: 1, max: 10000 }),
        number("…or every N new context tokens", "stp-brief-tokens", { value: String(st.fullBriefEveryTokens ?? 20000), min: 1000, max: 10000000, step: 1000 }),
        toggle("Repeat core rules in every header", "stp-header-rules", st.headerRules !== false),
        toggle("Show vendor and model to other vibemates", "stp-vendor", st.showVendorInRoster),
        toggle("Ask vibemates for notes automatically", "stp-auto-notes", st.autoNotes !== false),
        number("Missed messages a vibemate reads at most on its next turn", "stp-backlog", { value: String(st.backlogCap ?? 50), min: 1, max: 1000 }),
        number("Most characters in a vibio or in the room rules", "stp-text-limit", { value: String(st.briefTextLimit ?? 8000), min: 500, max: 32000, step: 500 }),
        pick("When a reply breaks a mechanical rule", "stp-referee", st.refereeAction || "next-header", [["next-header", "Post it; remind the agent in its next header"], ["retry-hidden", "Hold it; ask for a corrected version in a hidden turn"]]),
      ].join("")),
    ];
    const agentOptions = [["", "none yet: cast when the room opens"], ...recipes.map((r) => [r.id, r.vendor + (r.unavailable ? " (not installed here)" : "")])];
    const vms = (t.vibemates || []).map((v, i) => {
      const id = (k) => `stp-vm-${i}-${k}`;
      const vmText = (label, k, value, props = "") => settingRow({ label, for: id(k), control: UI.raw(`<input type="text" class="input" id="${id(k)}" data-k="${k}" value="${esc(value || "")}"${props}>`) });
      return `<div class="stp-vm" data-i="${i}">${settingsCard(id("card"), v.name, [
        settingRow({ label: `Leave ${v.name} out of the template`, lead: UI.raw(avatar({ name: v.name, avatar: v.avatar, color: fallbackColor }, 36, {})), control: UI.raw(UI.html("button", { label: "Leave out", icon: "close", kind: "ghost", size: "sm", data: { stpRemove: true } })) }),
        vmText("Vibename", "name", v.name, ' maxlength="40" required'),
        vmText("Vibersona", "tagline", v.tagline, ' maxlength="80"'),
        settingRow({ label: "Vibio", for: id("role"), stacked: true, control: UI.raw(`<textarea class="textarea" id="${id("role")}" data-k="role" rows="3" maxlength="4000">${esc(v.role || "")}</textarea>`) }),
        vmText("Vibeface", "avatar", v.avatar, ' maxlength="40" placeholder="initials"'),
        settingRow({ label: "Coding agent", for: id("agentType"), control: UI.raw(`<select class="select" id="${id("agentType")}" data-k="agentType">${agentOptions.map(([value, label]) => `<option value="${esc(value)}"${(v.agentType || "") === value ? " selected" : ""}>${esc(label)}</option>`).join("")}</select>`) }),
        vmText("Model", "model", v.model, ' placeholder="the agent\'s default"'),
        vmText("Effort", "effort", v.effort, ' placeholder="default"'),
        vmText("Mode", "mode", v.mode, ' placeholder="default"'),
        settingRow({ label: "Reply delay override, seconds", for: id("replyDelay"), control: numberHtml({ id: id("replyDelay"), value: String(v.replyDelay ?? ""), min: 0, max: 120, step: 0.5, placeholder: "the room's", data: { k: "replyDelay" } }) }),
        vmText("Skills", "skills", (v.skills || []).join(", "), ' placeholder="comma-separated"'),
      ].join(""))}</div>`;
    }).join("");
    return `${cards.join("")}${vms || '<p class="hint">No vibemates in this room: the template has none.</p>'}`;
  }
  function read(editor) {
    const $ = selector => editor.querySelector(selector);
    const num = (id) => Number($(id).value);
    const langText = $("#stp-lang").value.trim();
    const settings = {
      topic: $("#stp-topic").value,
      language: langText ? { mode: "fixed", language: langText } : { mode: "follow-human" },
      tools: $("#stp-tools").value,
      turnTaking: $("#stp-turns").value,
      replyDelay: num("#stp-delay"),
      agentsWakeEachOther: $("#stp-wake").checked,
      waitWhileHumanTypes: $("#stp-wait").checked,
      sharesHistory: $("#stp-share-history").checked,
      readsOtherRooms: $("#stp-reads-others").value,
      reachableFromMessengers: $("#stp-reachable").checked,
      startWithHub: $("#stp-start-with-hub").checked,
      wakeAfterRestart: $("#stp-wake-restart").checked,
      restartMessage: $("#stp-restart-message").value,
      reconnectMode: $("#stp-reconnect").value,
      hopLimit: num("#stp-hops"),
      maxSentences: $("#stp-maxlen").value === "" ? null : num("#stp-maxlen"),
      refereeAction: $("#stp-referee").value,
      humanDescriptionMode: $("#stp-about").value,
      fullBriefEveryTurns: num("#stp-brief-turns"),
      fullBriefEveryTokens: num("#stp-brief-tokens"),
      replayAfterRestart: num("#stp-replay"),
      backlogCap: num("#stp-backlog"),
      headerRules: $("#stp-header-rules").checked,
      showVendorInRoster: $("#stp-vendor").checked,
      autoNotes: $("#stp-auto-notes").checked,
      missedMessagesNotice: $("#stp-missed-notice").checked,
      customRules: $("#stp-rules").value,
      briefTextLimit: num("#stp-text-limit"),
    };
    const vibemates = [...editor.querySelectorAll(".stp-vm")].map((row) => {
      const v = {};
      row.querySelectorAll("[data-k]").forEach((el) => {
        const k = el.dataset.k;
        const val = el.value.trim();
        if (k === "skills") v.skills = val.split(",").map((x) => x.trim()).filter(Boolean);
        else if (k === "replyDelay") { if (val !== "") v.replyDelay = Number(val); }
        else if (val) v[k] = val;
      });
      return v;
    });
    return { emoji: $("#stp-emoji").value.trim(), dir: $("#stp-dir").value.trim(), settings, vibemates };
  }
  root.VIBEROOM_TEMPLATE_FORM = Object.freeze({ render, read });
})(typeof window !== "undefined" ? window : globalThis);
