// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function buildWords(build) {
    if ((typeof build !== "string" && typeof build !== "number") || build === "") return "build unknown";
    const date = new Date(build);
    return Number.isFinite(date.getTime()) ? `built ${date.toLocaleString()}` : `build ${String(build)}`;
  }
  function configurationProblemHtml(id, problem, { settingsCard, settingRow }) {
    return problem ? settingsCard(id, "", settingRow({ label: "Saved settings need attention", hint: problem, stacked: true, statusTone: "warn" })) : "";
  }

  function dataFolderRow(f, { UI, esc }) {
    if (!f || !f.known || !f.others || !f.others.length) return "";
    return UI.html("settings-group", {
      id: "sp-folder",
      title: "This folder is not private",
      tone: "danger",
      body: UI.raw(UI.html("setting", {
        label: "Other accounts can open it",
        hint: UI.raw(`Another account on this computer — ${esc(f.others.join(", "))} — can open <code>${esc(f.path)}</code>. Everything viberoom keeps is in there: every room's whole record, and the keys of any messenger you have paired. Other folders in your profile keep the permissions they have: this closes viberoom's own folder and nothing else.`),
        geek: "Closing it removes the inherited permissions and grants this account alone, beside the system and administrators, who can read anything on the machine in any case. Nothing else in your profile is touched, and it is undone with one command.",
        statusId: "sp-folder-result",
        control: UI.raw(UI.html("button", { label: "Make it private", icon: "lock", kind: "primary", size: "sm", id: "sp-folder-narrow" })),
      })),
    });
  }

  function render({ data, theme: TOKENS, fonts: FONTS, diagrams: DIAGRAM_PRESETS,
    fields, labels, parts, roomValues, categories, shown, development, UI, esc, vendorLogo }) {
    const { row: settingRow, card: settingsCard, select: selectHtml, number: numberHtml, action: actHtml } = fields;
    const { DIAGNOSTIC_LOG_HELP, KEEP_AWAKE_CHOICES, READS_OTHER_ROOMS, READS_OTHER_ROOMS_GEEK,
      READS_OTHER_ROOMS_HINT, REMEMBERS_HINT, SHARES_HISTORY_HINT, WHEEL_STEP_DEFAULT } = labels;

    const s = data.settings || { humanName: "", humanDescription: "", humanAvatar: "", roomDefaults: {}, vendorPresets: {} };
    const d = Object.assign({}, data.roomDefaults || {}, s.roomDefaults || {});
    const installed = data.recipes.filter((r) => !r.unavailableReason);
    const missing = data.recipes.filter((r) => r.unavailableReason);
    const dg = s.diagrams || { preset: "lavender", primary: null };
    const a = s.appearance || {};
    const ed = s.editor || {};
    const staleNote = [
      data.version && data.version.staleBuild ? `Older build running. There is a newer build on this machine — <code>${esc(data.version.staleBuild)}</code> was written after this room started — and the room keeps running the one it started with. Restart takes the new one.` : "",
      data.version && data.version.staleSource ? `This room is older than the code on disk: <code>${esc(data.version.staleSource)}</code> changed after it was built. Restart takes what is built; in a source checkout run <code>node scripts/update.mjs</code>, which builds first.` : "",
    ].filter(Boolean).join(" ");
    const row = settingRow;
    const presets = installed
      .map((r) => {
        const v = (s.vendorPresets || {})[r.id] || {};
        const input = (key, label, fallback) => `<label class="preset-field"><span>${label}</span><input type="text" class="input" data-vendor="${r.id}" data-key="${key}" list="sp-list-${r.id}-${key}" autocomplete="off" value="${esc(v[key] || "")}" placeholder="${esc(fallback || "vibemate default")}"></label>`;
        return row({ label: r.vendor, lead: UI.raw(vendorLogo(r)), stacked: true, control: UI.raw(`<div class="preset-fields">${input("model", "Model", r.defaultModel)}${input("effort", "Effort", r.defaultEffort)}${input("mode", "Mode", r.defaultMode)}</div>`) });
      })
      .join("");
    const vendorRow = (r, here) => {
      const out = here && r.loginState === "missing";
      const where = !here ? r.installHint || r.unavailableReason || "" : out ? UI.raw(`not logged in — run <code>${esc(r.loginCommand)}</code>`) : r.installedAt || "bundled";
      const badge = !here ? { label: "not installed", tone: "asleep" } : out ? { label: "no login", tone: "thinking", dot: true } : { label: "installed", tone: "ready", dot: true };
      return row({ label: r.vendor, lead: UI.raw(vendorLogo(r)), hint: where, control: UI.raw(UI.html("badge", badge)) });
    };
    const machine = installed.map((r) => vendorRow(r, true)).join("") + missing.map((r) => vendorRow(r, false)).join("");
    const lookId = TOKENS.looks[a.look] ? a.look : TOKENS.current.id;
    const look = TOKENS.looks[lookId];
    const custom = (a.custom || {})[lookId] || {};
    const adjustGroups = [...new Set(TOKENS.adjustables.map((f) => f.group))];
    const adjustRows = (group) => TOKENS.adjustables.filter((f) => f.group === group).map((f) => UI.html("adjust-row", { key: f.key, label: f.label, hint: f.hint, kind: f.kind, value: custom[f.key] || String(f.of(look)), own: String(f.of(look)), min: f.min, max: f.max, step: f.step })).join("");
    const card = settingsCard;
    const installation = data.installation || { updates: "npm", autostart: true, restart: true };
    const appName = data.version?.name || "the application";
    const groups = {
      "sp-appearance": card("sp-appearance", "Look", `
          <div class="look-preview" id="sp-look-preview">${parts.lookSample}</div>
          <input type="hidden" id="sp-look" value="${esc(lookId)}">
          <div class="look-cards">${Object.values(TOKENS.looks).map((l) => UI.html("look-card", { look: l, tag: (parts.lookTags[l.id] || ""), on: lookId === l.id, data: { look: l.id } })).join("")}</div>
          <div class="look-own" id="sp-look-own">${UI.html("button", { label: "Import a look…", kind: "ghost", size: "xs", hook: "sp-look-import", title: "A look file (.json) saved from viberoom, yours or someone else's" })}<span class="own-only"${look.custom ? "" : " hidden"}>${UI.html("button", { label: "Export", kind: "ghost", size: "xs", hook: "sp-look-export", title: "Save this look as a file, to share or keep" })}${UI.html("button", { label: "Delete", kind: "danger", size: "xs", hook: "sp-look-delete", title: "Remove this look from your own looks" })}</span><input type="file" id="sp-look-file" accept=".json,application/json" hidden></div>
          <p class="hint">Every element keeps what it does; only its look changes. The sample above wears the look you pick; the window changes on save. Your own looks (a vibemate's, or a file you import) come after the ones viberoom ships.</p>`),
      "sp-look-adjust": card("sp-look-adjust", "", `
          ${row({ id: "sp-adj-head", label: `Fine-tune ${look.label}`, hint: "Kept for this look alone. The sample follows as you pick; the window follows on save.", control: actHtml({ label: "Reset all", kind: "ghost", hook: "sp-adj-reset", title: "Back to the look as designed" }) })}
          ${adjustGroups.map((g) => `<div class="adjust-group"><h5>${esc(g)}</h5>${adjustRows(g)}</div>`).join("")}`),
      "sp-scale": card("sp-scale", "Size", row({ label: "Scale, %", for: "sp-ui-scale", hint: "The whole window at once: boxes, buttons, panels, icons and text. 100 is the default; the window follows on save. The text size below comes on top of it, and so does the browser's own zoom.", control: UI.raw(UI.html("slider-field", { id: "sp-ui-scale", value: String(a.scale || 100), min: 70, max: 150, step: 5, unit: "%", label: "Scale of the whole window" })) })),
      "sp-text": card("sp-text", "Text", `
          ${row({ label: "Size, px", for: "sp-chat-fs", hint: "Only the text changes size; the boxes, buttons and panels stay (the Scale above changes everything). 14.5 is the default.", control: numberHtml({ id: "sp-chat-fs", value: String(a.chatFontSize || 14.5), min: 12, max: 32, step: 0.5 }) })}
          ${row({ label: "Font", for: "sp-font", geek: "The named fonts come with viberoom and look the same on every OS (all free, with Cyrillic); the system entries use what this machine has. A look with a font of its own (Terminal, Clay) keeps it while this stays at the default.", control: UI.raw(selectHtml("sp-font", Object.entries(FONTS.text).map(([id, f]) => [id, f.label]), a.font || "nunito")) })}
          ${row({ label: "Code font", for: "sp-mono", hint: "For code blocks, paths and tool output.", control: UI.raw(selectHtml("sp-mono", Object.entries(FONTS.mono).map(([id, f]) => [id, f.label]), a.mono || "jetbrains-mono")) })}
          <div class="bubble" id="sp-chat-sample" style="display:inline-block;font-size:${a.chatFontSize || 14.5}px">Messages will read like this, with <code>code</code> a step smaller.</div>`),
      "sp-diagrams": card("sp-diagrams", "Diagrams", `
          ${row({ label: "Colours of the boxes", stacked: true, geek: "Vibemates draw diagrams as Mermaid (a ```mermaid block in a message); the room renders them here, with these colours. Mermaid derives the shades of borders and text from the box colour.", control: UI.raw(`<div class="chips diagram-presets">${Object.entries(DIAGRAM_PRESETS).map(([id, p]) => UI.html("choice", { label: p.label, on: dg.preset === id, data: { preset: id }, lead: UI.raw(`<span class="swatch" style="${p.palette ? `background:linear-gradient(90deg, ${p.palette.map((c) => c.fill).join(", ")});border-color:${p.palette[0].stroke}` : `background:${p.primaryColor};border-color:${p.primaryBorderColor}`}"></span>`) })).join("")}</div><input type="hidden" id="sp-diagram-preset" value="${esc(dg.preset)}">`) })}
          ${row({ label: "My own colour for the boxes", for: "sp-diagram-custom", kind: "switch", checked: !!dg.primary })}
          ${row({ id: "sp-diagram-color-row", hidden: !dg.primary, label: "Box colour", for: "sp-diagram-color", control: UI.raw(`<input type="color" id="sp-diagram-color" value="${esc(dg.primary || TOKENS.diagrams.customBoxDefault)}">`) })}
          ${parts.diagramSample}`),
      "sp-messages": card("sp-messages", "", row({ label: "A click on a long message shows all of it", for: "sp-more-on-click", kind: "switch", checked: s.showMoreOnClick !== false, hint: "A long message is drawn folded, with Show more under it. On: a click anywhere on the folded message opens it too, except on its links and buttons, or when you select words in it. Show less folds it again." })),
      "sp-scroll": card("sp-scroll", "", `${row({ label: "One notch of the mouse wheel, % of the chat", for: "sp-wheel-step", hint: "How far a notch moves the chat, as a share of its height: 20 is five notches to a screen. Each notch eases to its place and stops there. A wheel set to fewer lines in the system moves that much less; a touchpad keeps its own scrolling.", geek: "Chromium moves a fixed 100 px a notch, about 11 % of this chat; Edge moves 15 % of what scrolls. A notch here arrives in 150 ms and has no tail, the way Firefox animates one over 50–200 ms.", control: numberHtml({ id: "sp-wheel-step", value: String(s.wheelStepPercent ?? WHEEL_STEP_DEFAULT), min: 5, max: 60, step: 5 }) })}
        ${row({ label: "Glide after the wheel stops", for: "sp-wheel-inertia", kind: "switch", checked: s.wheelInertia === true, hint: "On: after the last notch the chat glides on for a moment and comes to rest, as a flick does. Off: every notch moves its step and stops." })}`),
      "sp-notices": card("sp-notices", "", `${row({ label: "Notify me when a vibemate replies", for: "sp-notify", hint: "While viberoom is not in front of you: a notification of the system, one per room, the newest in place of the last. A click opens the room.", control: UI.raw(selectHtml("sp-notify", [["every", "Every reply"], ["to-me", "Replies to me, and when a room needs me"], ["off", "Never"]], s.notifyReplies || "every")) })}
        ${parts.notifyPermission}
        ${row({ label: "Count on the viberoom icon", for: "sp-badge", kind: "switch", checked: s.appBadge !== false, hint: "The replies you have not seen yet, on the icon in the taskbar or the Dock, and in the window's title.", geek: "The desktop app draws the count on Windows, macOS and Linux (where the desktop shows counts on icons). In a browser window only an installed app gets one from the browser; the title shows it everywhere." })}`),
      "sp-permissions": card("sp-permissions", "Permissions", row({ label: "Vibemates act without asking", for: "sp-bypass", kind: "switch", checked: s.bypassPermissionsByDefault !== false, hint: "Off: they ask you before editing files or running commands.", geek: 'New vibemates start in their vendor\'s "act without asking" mode (Claude bypassPermissions, Codex agent-full-access, Gemini yolo, Cursor agent, OpenCode build, Copilot agent + allow_all). Change it per vibemate when summoning one, or later in its panel.' })),
      "sp-pace": card("sp-pace", "Pace", `
          ${row({ label: "Turn taking in new rooms", for: "sp-turns", ...roomValues["sp-turns"], hint: "Each room can change it in its own settings.", control: UI.raw(selectHtml("sp-turns", [["one-at-a-time", "One vibemate at a time"], ["parallel", "All addressed vibemates at once"]], d.turnTaking === "parallel" ? "parallel" : "one-at-a-time")) })}
          ${row({ label: "Reply delay in new rooms, seconds", for: "sp-delay", ...roomValues["sp-delay"], hint: "Used when two or more vibemates share a room; each room can change it; a vibemate can override it in its own panel.", geek: "Before each turn a vibemate waits a random 0–N seconds, so replies cross less often. Messages that arrive meanwhile land in its backlog. A vibemate alone answers at once unless it has its own delay.", control: numberHtml({ id: "sp-delay", value: String(d.replyDelay ?? 4), min: 0, max: 120, step: 0.5 }) })}`),
      "sp-vibemates-on-this-machine": card("sp-vibemates-on-this-machine", "On this computer", machine || '<p class="hint">No supported vibemate is installed yet.</p>'),
      "sp-channels": card("sp-channels", "", parts.channels),
      "sp-voice": card("sp-voice", "", parts.voice),
      "sp-voice-reading": card("sp-voice-reading", "Replies read aloud", parts.reading),
      "sp-memory": card("sp-memory", "", parts.memory),
      "sp-carrying": card("sp-carrying", "", row({ label: "Rooms for another computer", hint: "Save selected rooms for another computer, bring in a copy, or inspect removed versions.", control: actHtml({ label: "Export / Import…", id: "sp-carry" }) })),
      "sp-editor": card("sp-editor", "Open files at a line", `
          ${row({ label: "A click on a path like main.ts:375 opens the file in", stacked: true, geek: "Only an editor can jump to a line; the OS default app just opens the file. Auto looks for VS Code, Cursor, Windsurf, Zed, Sublime Text, Notepad++ and the JetBrains IDEs, in that order, on PATH and in their usual folders. Custom: a command with {file}, {line} and {column} placeholders, e.g. code --goto {file}:{line}.", control: UI.raw(`<div class="chips editor-modes">${UI.html("choice", { label: "Auto", on: !["custom", "default-app"].includes(ed.mode), data: { mode: "auto" } })}${UI.html("choice", { label: "The default app", on: ed.mode === "default-app", data: { mode: "default-app" } })}${UI.html("choice", { label: "My own command", on: ed.mode === "custom", data: { mode: "custom" } })}</div><input type="hidden" id="sp-editor-mode" value="${esc(ed.mode || "auto")}">`) })}
          ${row({ label: "Command", for: "sp-editor-cmd", stacked: true, hint: "{file}, {line} and {column} are filled in; quotes group arguments.", control: UI.raw(`<input type="text" class="input" id="sp-editor-cmd" maxlength="500" value="${esc(ed.command || "")}" placeholder="code --goto {file}:{line}">`) })}`),
      "sp-update": card("sp-update", "Updates", `
          ${installation.updates ? `${row({ label: "Check for updates once a day", for: "sp-updates", kind: "switch", checked: s.checkForUpdates !== false, hint: installation.updates === "npm" ? "At start, one request to the npm registry for the latest viberoom version; nothing else leaves this machine. A newer version shows as a bubble over your avatar." : "Checks this application's update channel. A newer version appears when that channel can provide it." })}
          ${row({ label: "Version", status: parts.updateStatus, statusId: "sp-update-status", control: actHtml({ label: "Check now", id: "sp-update-check" }) })}` : ""}
          ${row({ label: "Check installed agents once a day", for: "sp-agent-updates", kind: "switch", checked: s.checkAgentUpdates !== false, hint: "Checks the existing installations and their release channels. Updates run only when you choose them." })}
          ${row({ label: "Installed agents", status: parts.agentUpdateStatus, statusId: "sp-agent-update-status", control: actHtml({ label: "Agent updates…", id: "sp-agent-update-open" }) })}`),
      "sp-autostart": installation.autostart ? card("sp-autostart", "Start with the computer", row({ label: `Start ${appName} when you sign in to this computer`, for: "sp-autostart-on", kind: "switch", checked: !!(data.autostart && data.autostart.enabled), disabled: !data.autostart || !!data.autostart.unavailable, hint: `A quiet start, without a window: the icon opens it when you want it. Rooms set to start with ${appName} bring their vibemates back by themselves, so a paired phone reaches them without a click. A copy already running is left alone. Switch this off before you remove or move the application.`, status: UI.raw(parts.autostartStatus), statusId: "sp-autostart-status" })) : "",
      "sp-folder": parts.dataFolder,
      "sp-sleep": card("sp-sleep", "Sleep", row({
        label: "Keep the computer awake while vibemates work", for: "sp-keep-awake", stacked: true,
        hint: "Only while a vibemate works, and only the computer: its screen still turns off and locks, and a closed lid still puts a laptop to sleep. When every vibemate is done, it sleeps as usual.",
        geek: "The application asks Electron to hold the computer awake; viberoom from npm asks the system's own helper: caffeinate on a Mac, systemd-inhibit on Linux, a hidden PowerShell (SetThreadExecutionState) on Windows and in WSL. The hold ends with viberoom, however viberoom ends, and a vibemate silent for over an hour no longer holds it.",
        control: UI.raw(`<div class="chips keep-awake-modes quiet-glyphs" role="group" aria-label="Keep the computer awake">${KEEP_AWAKE_CHOICES.map(([id, label, glyph, tone]) => UI.html("choice", { label, on: (s.keepAwake || "plugged-in") === id, data: { keepAwake: id }, lead: UI.raw(UI.html("settings-glyph", { glyph, tone, size: "xs" })) })).join("")}</div><input type="hidden" id="sp-keep-awake" value="${esc(s.keepAwake || "plugged-in")}">`),
        status: parts.keepAwakeStatus, statusId: "sp-keep-awake-status", statusTone: parts.keepAwakeTone,
      })),
      "sp-restart": installation.restart ? card("sp-restart", "Restart",row({ label: `Restart ${appName}`, hint: "Starts the room again with what is on disk. The vibemates come back the way Welcome back is set to bring them, and this window reconnects on its own. Closing the window does not do this: the room keeps running in the background, which is why it can stay on an older build than the one you have.", status: staleNote ? UI.raw(staleNote) : "", statusTone: "warn", control: actHtml({ label: "Restart", id: "sp-restart-now" }) })) : "",
      "sp-defaults-for-new-rooms": card("sp-defaults-for-new-rooms", "", `
          ${row({ label: "Hop limit", for: "sp-hops", ...roomValues["sp-hops"], hint: "How many vibemate-to-vibemate replies may follow one message of yours before the room waits for you again.", control: numberHtml({ id: "sp-hops", value: String(d.hopLimit), min: 0, max: 10000 }) })}
          ${row({ label: "Full brief every N turns", for: "sp-brief-turns", ...roomValues["sp-brief-turns"], hint: "How often a vibemate gets the whole room brief again instead of the short header.", control: numberHtml({ id: "sp-brief-turns", value: String(d.fullBriefEveryTurns), min: 1, max: 10000 }) })}
          ${row({ label: "Full brief every N tokens", for: "sp-brief-tokens", ...roomValues["sp-brief-tokens"], hint: "…or after this much new context since its last full brief, whichever comes first.", control: numberHtml({ id: "sp-brief-tokens", value: String(d.fullBriefEveryTokens), min: 1000, max: 10000000, step: 1000 }) })}
          ${row({ label: "Most characters in a vibio or in the room rules", for: "sp-text-limit", ...roomValues["sp-text-limit"], hint: "The limit applies separately to each text. Text over it is refused with the numbers, never cut; each room can raise or lower its own limit.", control: numberHtml({ id: "sp-text-limit", value: String(d.briefTextLimit ?? 8000), min: 500, max: 32000, step: 500 }) })}
          ${row({ label: "Repeat core rules in every header", for: "sp-header-rules", ...roomValues["sp-header-rules"], kind: "switch", checked: !!d.headerRules, hint: "The short header before each turn repeats the room's core rules (who is here, how to address, how long to write)." })}
          ${row({ label: "Tools", for: "sp-tools", ...roomValues["sp-tools"], hint: "Whether vibemates may use their own tools (files, shell, web) without being asked to.", control: UI.raw(selectHtml("sp-tools", [["on-request", "Only when asked"], ["never", "Never"]], d.tools === "never" ? "never" : "on-request")) })}
          ${row({ label: "Share the room's history with the other rooms", for: "sp-share-history", ...roomValues["sp-share-history"], kind: "switch", checked: d.sharesHistory !== false, hint: SHARES_HISTORY_HINT })}
          ${row({ label: "Search the other rooms", for: "sp-reads-others", ...roomValues["sp-reads-others"], hint: READS_OTHER_ROOMS_HINT, geek: READS_OTHER_ROOMS_GEEK, control: UI.raw(selectHtml("sp-reads-others", READS_OTHER_ROOMS, d.readsOtherRooms || "on-search")) })}
          ${row({ label: "Rooms remember", for: "sp-remembers", ...roomValues["sp-remembers"], kind: "switch", checked: d.remembers !== false, hint: REMEMBERS_HINT })}`),
      "sp-shared-memory": card("sp-shared-memory", "", row({ label: "Shared memory about you", hint: "Review learned preferences, protected notes and their revision history.", control: actHtml({ label: "Open…", data: { memoryOpen: "user" } }) })),
      "sp-skills-from-vibemates": card("sp-skills-from-vibemates", "", row({ label: "Vibemate-created skills need my approval", for: "sp-skill-approval", kind: "switch", checked: !!s.agentSkillsNeedApproval, hint: 'Off: a skill a vibemate creates is usable at once and shows as "unreviewed" until you open it. On: it stays a draft (not delivered, not attachable) until you approve it under Skills.' })),
      "sp-presets-per-vibemate": card("sp-presets-per-vibemate", "", `
          <p class="hint">Used when you summon one; leave a field empty for the built-in suggestion. The summon dialog always shows what the vibemate really offers. Bypass modes: Claude bypassPermissions, Codex agent-full-access, Gemini yolo, Cursor agent, OpenCode build, Copilot agent + allow_all.</p>
          ${presets || '<p class="hint">No supported vibemate is installed yet.</p>'}`),
      "sp-transcripts": card("sp-transcripts", "", parts.diagnostics),
      "sp-slow": development ? card("sp-slow", "", `
          <p class="hint">Only a viberoom run from its own sources shows this page: a copy installed from npm has no sources, so it never does. It measures this window, so a slow or choppy moment can be reported with the place it happened in.</p>
          ${row({ label: "Slow moments", hint: "Everything this window spent more than 8 ms on, newest first: the moment, the cost, what it was, and what the room was doing then. Anything over 50 ms the browser reports by itself, ours or not. When something feels slow, copy the list into the room: it says where to look, which a measurement from outside cannot.", control: actHtml({ label: "Copy the list", id: "sp-slow-copy" }) })}
          ${parts.slowTasks}
          ${row({ label: "Jumps to the newest message", hint: "Every time the chat moved to the newest message by itself, and who asked for it. A move while you were reading higher up is the one to report." })}
          ${parts.endJumps}`) : "",
      "sp-dev-prompts": development ? card("sp-dev-prompts", "What the vibemates are sent", row({ label: "Show each reply's prompt", for: "sp-dev-prompts-on", kind: "switch", checked: !!s.devShowPrompts, hint: "On: every vibemate's reply gets a Prompt button beside its tool calls. It unfolds what viberoom sent that vibemate for the turn, block by block and exactly as it went: the brief, the rules, the vibio, the memory, the header, the messages. Kept from the moment this is on, beside each room's history, the newest 300 turns of a room." })) : "",
      "sp-dev-memory": development ? card("sp-dev-memory", "What the memory receives", row({ label: "Record memory ingestion", for: "sp-dev-memory-on", kind: "switch", checked: !!s.devShowMemoryIngestion, hint: "Adds Memory to message bubbles: the actual sieve request, raw answer, applied decision and provider payload. Records new processing only, including shared batch context. Keeps up to 100 batches per room for 7 days, within a 16 MiB saved-payload budget and a separate 16 MiB active-buffer budget. Limits: 4 MiB per batch and 1 MiB per event; omissions are marked. Batches are saved on completion; unfinished recordings are lost on restart. Editing or deleting any source or context removes its recordings. Turning this off clears all recordings." })) : "",
      "sp-wheel": development ? card("sp-wheel", "The wheel", row({ label: "Wheel trace", hint: "Every wheel event on the chat in the last two minutes: its step, how long after the last one it came, how late this window heard it, and what the wheel made of it — a step, the glide, or the browser's own scroll; then the late frames and why the motion stopped. When the scroll feels choppy, scroll the same way again, then copy the trace into the room.", status: parts.wheelTrace, control: actHtml({ label: "Copy the trace", id: "sp-wheel-copy" }) })) : "",
    };

    return `
      <div class="settings-page">
        <div class="settings-side">
          <div class="page-head app-settings-head"><div class="app-settings-title">${UI.html("settings-glyph", { glyph: "settings", tone: "slate" })}<div><h1>Settings</h1><div class="hint">${data.version ? `${esc(data.version.name)} ${esc(data.version.version)} · ${esc(buildWords(data.version.build))}` : "room build unknown (older room process; run viberoom again to replace it)"}</div></div></div></div>
          ${UI.html("settings-nav", { items: categories, current: shown })}
        </div>
        <div id="sp-form" class="settings-pages">
          ${categories.map((c) => UI.html("settings-category", { id: c.id, title: c.label, about: c.about, glyph: c.glyph, tone: c.tone || "slate", geek: !!c.geek, current: c.id === shown, body: UI.raw(c.groups.map((id) => groups[id] || "").join("")) })).join("")}
        </div>
      </div>`;
  }
  root.VIBEROOM_SETTINGS_VIEW = Object.freeze({ configurationProblemHtml, dataFolderRow, render });
})(globalThis);
