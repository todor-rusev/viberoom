// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  function sections(room, view, h) {
    const { UI, settingsCard, settingRow, selectHtml, numberHtml, actHtml, pickNowHtml, roomMark, faceUrl, words } = h;
    const rs = room.settings;
    const forget = view.forget;
    const lang = rs.language && rs.language.mode === "fixed" ? rs.language.language : "";
    const toggle = (label, id, on, hint, geekText) => settingRow({ label, for: id, kind: "switch", checked: !!on, hint, geek: geekText });
    const text = (id, value, props = "") => UI.raw(`<input type="text" class="input" id="${id}" value="${esc(value)}"${props}>`);
    return {
      general: [
        settingsCard("rp-room", "", [
          settingRow({ label: "Name", for: "rp-name", control: text("rp-name", room.name, ' maxlength="60"') }),
          settingRow({ label: "Picture", id: "rp-emoji-row", hint: "A picture or an emoji for the room, next to its name.", control: UI.raw(pickNowHtml(rs.emoji && !faceUrl(rs.emoji) ? esc(rs.emoji) : roomMark(room), "Pick another")), fold: UI.raw(`<div id="rp-emoji-picker"></div><input type="text" class="input" id="rp-emoji" maxlength="40" value="${esc(rs.emoji || "")}" placeholder="custom emoji (optional)">`) }),
          settingRow({ label: "Topic", for: "rp-topic", control: text("rp-topic", rs.topic || "", ' maxlength="2000" placeholder="what this room is about (optional)"') }),
          settingRow({ label: "Folder", for: "rp-dir", stacked: true, hint: "Where the vibemates read and write. Choose whether to restart them now or use the new folder at their next restart.", control: UI.raw(`<span class="dir-row" data-own-save><input type="text" class="input" id="rp-dir" maxlength="1000" value="${esc(room.dir)}" spellcheck="false">${UI.html("button", { label: "Browse", icon: "folder", kind: "ghost", id: "rp-dir-browse", title: "Choose a folder", hook: "browse-btn" })}</span>`) }),
        ].join("")) + '<div id="rp-folder-pending"></div>',
        settingsCard("rp-you", "You in this room", [
          settingRow({ label: "What vibemates get about you here", for: "rp-you-mode", stacked: true, control: UI.raw(selectHtml("rp-you-mode", [["inherit", "Your vibe line"], ["append", "Your vibe line + this room's"], ["override", "Only this room's line"], ["none", "Nothing about me in this room"]], rs.humanDescriptionMode || "inherit")) }),
          settingRow({ label: "This room's line about you", for: "rp-you-desc", stacked: true, control: UI.raw(`<textarea class="textarea" id="rp-you-desc" rows="3" maxlength="200" placeholder="e.g. host of this session, product owner">${esc(rs.humanDescription || "")}</textarea>`) }),
        ].join("")),
        settingsCard("rp-messengers", "", toggle("Reachable from messengers", "rp-reachable", rs.reachableFromMessengers !== false, "A phone paired to viberoom (Settings → Channels) can open this room, write to it and read its replies. Off: the phone neither sees nor reaches this room.")),
        settingsCard("rp-turn-this-room-into-a-template", "", settingRow({ label: "Turn this room into a template", hint: 'Its settings, rules, folder and vibemates (with the coding agent each runs on) become one of your templates, listed first under "Start from a template". You see everything it will contain, and can change any of it, before you create it.', control: UI.raw(UI.html("button", { label: "Preview and create…", icon: "rooms", kind: "secondary", size: "sm", id: "rp-template" })) })),
        settingsCard("rp-danger-zone", "Danger zone", [
          settingRow({ label: "Close this local copy", hint: "Closes this room's vibemates on this computer and moves its history and files to your viberoom trash folder. Stops pending memory work here. Other copies and the shared cloud memory remain.", control: UI.raw(UI.html("button", { label: "Close this copy", icon: "trash", kind: "danger", size: "sm", id: "rp-delete" })) }),
          settingRow({ label: "Forget cloud memory of this room", hint: forget ? `${forget.description} Stops remembering in this copy; your conversation and files stay. Turning remembering back on sends only new messages.` : "Choose a provider that supports room deletion in Settings → Long-term memory to forget its cloud memory.", control: forget ? UI.raw(UI.html("button", { label: `Forget in ${view.memoryLabel}…`, icon: "trash", kind: "danger", size: "sm", id: "rp-memory-forget" })) : undefined }),
          forget ? '<p class="field-note" id="rp-memory-forget-status" role="status" aria-live="polite"></p>' : "",
        ].join(""), "danger"),
      ].join(""),
      rules: settingsCard("rp-rules-section", "", [
        settingRow({ label: "Room rules", stacked: true, hint: UI.raw('How the team works together. Vibemates can propose changes for your approval. One rule per line; type @ to reference a participant.<span class="count" id="rp-rules-count"></span>'), geek: "References follow renames and note when a participant has left. Updated rules reach each vibemate on its next turn. Mentions here describe responsibilities; they do not send messages.", control: UI.raw('<div class="mention-host"><div id="rp-rules" class="rules-editor" contenteditable="true" spellcheck="true" data-placeholder="e.g. Everyone listens to @Pesho, he is the manager. Keep answers under 3 sentences."></div><div class="mention-menu inline" id="rp-rules-menu" hidden></div></div>') }),
        settingRow({ label: "Language", for: "rp-lang", control: text("rp-lang", lang, ' placeholder="follow the human (default), or e.g. English"') }),
        settingRow({ label: "Max sentences per reply", for: "rp-maxlen", control: numberHtml({ id: "rp-maxlen", value: String(rs.maxSentences ?? ""), min: 1, max: 100, placeholder: "no limit" }) }),
        settingRow({ label: "Vibemates' own tools (files, shell, web)", for: "rp-tools", geek: "An instruction in every vibemate's brief; the vibemate's mode is the real limit.", control: UI.raw(selectHtml("rp-tools", [["on-request", "Only when someone explicitly asks"], ["never", "Never (chat only)"]], rs.tools === "never" ? "never" : "on-request")) }),
      ].join("")),
      conversation: [
        settingsCard("rp-turn-taking", "", [
          settingRow({ label: "Who may speak", for: "rp-turns", geek: "One at a time: the others queue and see the earlier replies before they answer; the addressed vibemates go first. All at once: fastest, but replies may cross.", control: UI.raw(selectHtml("rp-turns", [["one-at-a-time", "One vibemate at a time"], ["parallel", "All addressed vibemates at once"]], rs.turnTaking === "parallel" ? "parallel" : "one-at-a-time")) }),
          settingRow({ label: "Reply delay, seconds", for: "rp-delay", hint: "With two or more vibemates, each waits a random 0–N seconds before it answers, so replies cross less often. A vibemate alone answers at once. A vibemate's own delay (in its panel) always applies.", control: numberHtml({ id: "rp-delay", value: String(rs.replyDelay ?? 4), min: 0, max: 120, step: 0.5 }) }),
          toggle("Vibemates wake each other", "rp-wake", rs.agentsWakeEachOther !== false, "A reply without @ wakes every other vibemate, as yours does; each may answer or stay silent. Off: only @Name wakes a vibemate. The hop limit applies either way."),
          toggle("Wait while you are typing", "rp-wait-typing", rs.waitWhileHumanTypes !== false, "A vibemate about to start holds back while you type (a few seconds after your last keystroke). A reply already under way is not interrupted."),
          settingRow({ label: "Hop limit", for: "rp-hops", hint: "How many vibemate-to-vibemate replies may follow one message of yours before the room waits for you again.", control: numberHtml({ id: "rp-hops", value: String(rs.hopLimit), min: 0, max: 10000 }) }),
          toggle("Tell vibemates what they missed while working", "rp-missed-notice", rs.missedMessagesNotice, "When a vibemate finishes and messages arrived meanwhile that did not wake it, it is told how many and may read them or stay silent. They still arrive with its next turn. Each notice counts as one vibemate-to-vibemate reply."),
        ].join("")),
        settingsCard("rp-conversation", "Memory", [
          toggle("This room remembers", "rp-remembers", rs.remembers === true, "The room feeds the long-term memory provider (Settings → Long-term memory): its messages, sifted by the sieve set there, become facts vibemates can recall later. Does nothing until a provider is on and consented there."),
          settingRow({ label: "Memory input", for: "rp-memory-input", hint: words.MEMORY_INPUT_HINT, geek: words.MEMORY_INPUT_GEEK, control: UI.raw(selectHtml("rp-memory-input", words.MEMORY_INPUT, rs.memoryInput || "excerpts")) }),
          settingRow({ label: "Recover room memory", hint: "Rebuild from eligible originals with your budget and review. The current memory stays active during preparation.", control: UI.raw(UI.html("button", { label: "Review rebuilds…", kind: "secondary", size: "sm", id: "rp-memory-recovery" })) }),
          toggle("Share this room's history with the other rooms", "rp-share-history", rs.sharesHistory !== false, words.SHARES_HISTORY_HINT),
          settingRow({ label: "Search the other rooms", for: "rp-reads-others", hint: words.READS_OTHER_ROOMS_HINT, geek: words.READS_OTHER_ROOMS_GEEK, control: UI.raw(selectHtml("rp-reads-others", words.READS_OTHER_ROOMS, rs.readsOtherRooms || "on-search")) }),
        ].join("")),
      ].join(""),
      start: settingsCard("rp-startup", "", [
        toggle("Start this room with viberoom", "rp-start-with-hub", rs.startWithHub, "Its vibemates are started when viberoom starts, one room after another. They pay nothing until the first turn; their processes and memory stay while they wait. With viberoom starting at sign-in, the phone reaches this room without a click."),
        settingRow({ label: "…and they come back", for: "rp-reconnect", hint: "Only for the start above: when this room brings its own vibemates back, it decides with how much memory.", geek: "A room that decides whether it starts also decides with how much memory its vibemates come back; the app-wide Welcome back setting is what a room follows when it has not chosen. It is not asked again in a dialog, because by the time a window could ask, the room has already begun.", control: UI.raw(selectHtml("rp-reconnect", [["inherit", "As Welcome back is set"], ["load", "Continuing their saved sessions"], ["replay", "Fresh, with the last messages replayed"]], rs.reconnectMode || "inherit")) }),
        toggle("Wake vibemates after a restart", "rp-wake-restart", rs.wakeAfterRestart, "Off by default. After Restart finishes restoring this room, or the viberoom application takes it over from viberoom run with npm, send the message below once. Requires Start this room with viberoom. Muted, stopped or unavailable vibemates stay quiet. Ordinary launches and sign-in do not send it."),
        settingRow({ label: "Message after restart", for: "rp-restart-message", stacked: true, hint: "Your saved instruction appears as an automatic room event. Empty text starts no replies.", control: UI.raw(`<textarea class="textarea" id="rp-restart-message" rows="3" maxlength="8000" placeholder="Continue your tasks, if you have any.">${esc(rs.restartMessage || "")}</textarea>`) }),
        settingRow({ label: "Replay last N chat messages after a reconnect", for: "rp-replay", control: numberHtml({ id: "rp-replay", value: String(rs.replayAfterRestart), min: 0, max: 200 }) }),
      ].join("")),
      briefs: [
        settingsCard("rp-instruction-delivery", "Briefs", [
          settingRow({ label: "Full brief every N vibemate turns", for: "rp-brief-turns", hint: "How often a vibemate gets the whole room brief again instead of the short header.", control: numberHtml({ id: "rp-brief-turns", value: String(rs.fullBriefEveryTurns), min: 1, max: 10000 }) }),
          settingRow({ label: "…or every N new context tokens", for: "rp-brief-tokens", hint: "…or after this much new context since its last full brief, whichever comes first.", control: numberHtml({ id: "rp-brief-tokens", value: String(rs.fullBriefEveryTokens), min: 1000, max: 10000000, step: 1000 }) }),
          toggle("Repeat core rules in every header", "rp-header-rules", rs.headerRules, "The short header before each turn repeats the room's core rules (who is here, how to address, how long to write)."),
          toggle("Show vendor and model to other vibemates", "rp-vendor", rs.showVendorInRoster),
          toggle("Ask vibemates for notes automatically", "rp-auto-notes", rs.autoNotes !== false, "When a vibemate's context fills past 80% or is compacted, it writes short notes on its work, so a restart can carry them. Off: notes are written only when you ask (Take notes now in its panel, a change of role or of coding agent)."),
          settingRow({ label: "Missed messages a vibemate reads at most on its next turn", for: "rp-backlog", hint: "Everything posted since its last turn counts, including while it was muted; older messages are dropped with a note in its prompt.", control: numberHtml({ id: "rp-backlog", value: String(rs.backlogCap), min: 1, max: 1000 }) }),
          settingRow({ label: "Most characters in a vibio or in the room rules", for: "rp-text-limit", hint: "The limit applies separately to each text. Text over it is refused with the numbers, never cut.", control: numberHtml({ id: "rp-text-limit", value: String(rs.briefTextLimit ?? 8000), min: 500, max: 32000, step: 500 }) }),
        ].join("")),
        settingsCard("rp-referee-section", "Referee", settingRow({ label: "When a reply breaks a mechanical rule (unknown @, self-@, length)", for: "rp-referee", stacked: true, control: UI.raw(selectHtml("rp-referee", [["next-header", "Post it; remind the agent in its next header"], ["retry-hidden", "Hold it; ask for a corrected version in a hidden turn"]], rs.refereeAction === "retry-hidden" ? "retry-hidden" : "next-header")) })),
        settingsCard("rp-shared-memory", "", settingRow({ label: "Shared memory for this room", hint: "What its vibemates have learned here, with its history: inspect, edit or remove it.", control: actHtml({ label: "Open…", data: { memoryOpen: "room" } }) })),
        settingsCard("rp-troubleshooting", "Troubleshooting", settingRow({ label: "Save diagnostic details", for: "rp-transcripts", stacked: true, hint: words.DIAGNOSTIC_LOG_HELP, control: UI.raw(selectHtml("rp-transcripts", [["inherit", view.followsAppTranscripts], ["off", "Off"], ["errors", "When something fails"], ["full", "All activity"]], rs.transcripts || "inherit")) })),
      ].join(""),
    };
  }

  function patch(find, rulesText) {
    return {
      emoji: find("#rp-emoji").value,
      topic: find("#rp-topic").value,
      humanDescriptionMode: find("#rp-you-mode").value,
      humanDescription: find("#rp-you-desc").value,
      customRules: rulesText(),
      briefTextLimit: Number(find("#rp-text-limit").value),
      language: find("#rp-lang").value.trim() || "follow-human",
      tools: find("#rp-tools").value,
      maxSentences: find("#rp-maxlen").value === "" ? null : Number(find("#rp-maxlen").value),
      hopLimit: Number(find("#rp-hops").value),
      fullBriefEveryTurns: Number(find("#rp-brief-turns").value),
      fullBriefEveryTokens: Number(find("#rp-brief-tokens").value),
      headerRules: find("#rp-header-rules").checked,
      showVendorInRoster: find("#rp-vendor").checked,
      replayAfterRestart: Number(find("#rp-replay").value),
      autoNotes: find("#rp-auto-notes").checked,
      missedMessagesNotice: find("#rp-missed-notice").checked,
      backlogCap: Number(find("#rp-backlog").value),
      refereeAction: find("#rp-referee").value,
      turnTaking: find("#rp-turns").value,
      waitWhileHumanTypes: find("#rp-wait-typing").checked,
      agentsWakeEachOther: find("#rp-wake").checked,
      sharesHistory: find("#rp-share-history").checked,
      readsOtherRooms: find("#rp-reads-others").value,
      remembers: find("#rp-remembers").checked,
      memoryInput: find("#rp-memory-input").value,
      reachableFromMessengers: find("#rp-reachable").checked,
      startWithHub: find("#rp-start-with-hub").checked,
      wakeAfterRestart: find("#rp-wake-restart").checked,
      restartMessage: find("#rp-restart-message").value,
      reconnectMode: find("#rp-reconnect").value,
      replyDelay: Number(find("#rp-delay").value),
      transcripts: find("#rp-transcripts").value,
    };
  }
  root.VIBEROOM_ROOM_PANEL = Object.freeze({ sections, patch });
})(typeof window !== "undefined" ? window : globalThis);
