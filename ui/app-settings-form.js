// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function mount(formRoot, { signal, read, commands: settingsCommands, queries: settingsQueries,
    theme: TOKENS, fonts: FONTS, UI, esc, fields, dialogs, bindings, effects, previews, diagnostics }) {
    if (!formRoot?.ownerDocument || typeof read !== "function") throw new TypeError("A Settings render root and reader are required");
    signal?.throwIfAborted();
    const document = formRoot.ownerDocument, window = document.defaultView;
    const active = global.VIBEROOM_APP_LIFETIME.create({ window });
    const dispose = () => active.dispose();
    signal?.addEventListener("abort", dispose, { once: true });
    active.own(() => signal?.removeEventListener("abort", dispose));
    const $ = selector => formRoot.querySelector(selector);
    const on = (node, type, callback, options) => node ? active.on(node, type, callback, options) : () => {};
    const { card: settingsCard, row: settingRow, nameList } = fields;
    const { confirm: confirmDialog, choice: choiceDialog, restartSessionsChecked } = dialogs;
    const { vendorChoices: fillVendorChoices } = bindings;
    const bindCopy = (...args) => bindings.copy(...args, { listen: on });
    const bindSave = (...args) => bindings.save(...args, { listen: on, canStart: () => !active.disposed });
    const { applyCustomVars, renderDiagrams, loadMermaid, pageShown: SETTINGS_PAGE_SHOWN } = previews;
    const { slowTasksText, wheelTraceText, startTrace, traceText } = diagnostics;
    const { showError, acceptAutostart, acceptDataFolder, acceptUpdate, openAgentUpdates,
      requestNotificationPermission: askToKnock, refresh: renderAgain, updateStatusText, refreshUpdateNotice: renderUpdatePop,
      toast: showToast, saveFile } = effects;
    const reportError = error => { if (!active.disposed) showError(error); };
    const toast = (...args) => { if (!active.disposed) showToast(...args); };
    const refresh = () => { if (!active.disposed) renderAgain(); };
    const setTimeout = active.timeout;
    try {
    const editorSection = $("#sp-editor");
    const editorCmdRow = $("#sp-editor-cmd").closest('[data-ui="setting"]');
    const showEditorCmd = () => (editorCmdRow.hidden = $("#sp-editor-mode").value !== "custom");
    showEditorCmd();
    editorSection.querySelectorAll('.editor-modes [data-ui="choice"]').forEach((b) =>
      on(b, "click", () => {
        editorSection.querySelectorAll('.editor-modes [data-ui="choice"]').forEach((x) => UI.setState(x, x === b ? "on" : null));
        const input = $("#sp-editor-mode");
        input.value = b.dataset.mode;
        showEditorCmd();
        const command = $("#sp-editor-cmd");
        if (b.dataset.mode === "custom" && !command.value.includes("{file}")) {
          command.focus();
          return;
        }
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }),
    );
    const sleepChoices = [...($("#sp-sleep")?.querySelectorAll('.keep-awake-modes [data-ui="choice"]') || [])];
    sleepChoices.forEach((b) =>
      on(b, "click", () => {
        sleepChoices.forEach((x) => UI.setState(x, x === b ? "on" : null));
        const input = $("#sp-keep-awake");
        if (input.value === b.dataset.keepAwake) return;
        input.value = b.dataset.keepAwake;
        const glyph = b.querySelector(".rig");
        if (glyph && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) window.Icons.play(glyph);
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }),
    );
    const diagramSection = $("#sp-diagrams");
    const previewTheme = () => ({ preset: $("#sp-diagram-preset").value, primary: $("#sp-diagram-custom").checked ? $("#sp-diagram-color").value : null });
    const redrawPreview = () => {
      const block = diagramSection.querySelector(".mermaid-block.preview");
      delete block.dataset.rendered;
      block.querySelector(".mm-out").innerHTML = `<pre>${esc(block.dataset.src)}</pre>`;
      renderDiagrams(diagramSection, previewTheme());
    };
    diagramSection.querySelectorAll('.diagram-presets [data-ui="choice"]').forEach((b) =>
      on(b, "click", () => {
        diagramSection.querySelectorAll('.diagram-presets [data-ui="choice"]').forEach((x) => UI.setState(x, x === b ? "on" : null));
        const input = $("#sp-diagram-preset");
        input.value = b.dataset.preset;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        redrawPreview();
      }),
    );
    on($("#sp-diagram-custom"), "change", () => {
      $("#sp-diagram-color-row").hidden = !$("#sp-diagram-custom").checked;
      redrawPreview();
    });
    on($("#sp-diagram-color"), "input", redrawPreview);
    const drawSample = async () => {
      try {
        await active.wait(loadMermaid());
      } catch (e) {
        return reportError(e);
      }
      if (!active.disposed && diagramSection.isConnected) renderDiagrams(diagramSection, previewTheme());
    };
    const samplePage = diagramSection.closest('[data-ui="settings-category"]');
    if (samplePage.hidden) on(samplePage, SETTINGS_PAGE_SHOWN, drawSample, { once: true });
    else void drawSample();
    on($("#sp-ui-scale"), "input", (event) => { event.target.nextElementSibling.textContent = `${event.target.value}%`; });
    const sample = $("#sp-chat-sample");
    on($("#sp-chat-fs"), "input", () => {
      const px = Number($("#sp-chat-fs").value);
      if (px >= 12 && px <= 32) sample.style.fontSize = `${px}px`;
    });
    on($("#sp-font"), "change", () => (sample.style.fontFamily = FONTS.text[$("#sp-font").value].stack));
    const looksBox = $("#sp-cat-appearance");
    const pickedLook = () => TOKENS.looks[$("#sp-look").value] || TOKENS.current;
    const rowOf = (key) => looksBox.querySelector(`[data-ui="adjust-row"][data-key="${key}"]`);
    const inputOf = (key) => {
      const row = rowOf(key);
      return row ? row.querySelector("input") : null;
    };
    const pendingAdjust = () => {
      const look = pickedLook();
      const out = {};
      for (const f of TOKENS.adjustables) {
        const input = inputOf(f.key);
        const value = String(input ? input.value : "").toLowerCase();
        if (value && value !== String(f.of(look)).toLowerCase()) out[f.key] = value;
      }
      return out;
    };
    const paintRows = () => {
      const look = pickedLook();
      for (const f of TOKENS.adjustables) {
        const row = rowOf(f.key);
        const input = inputOf(f.key);
        if (!row || !input) continue;
        const own = String(f.of(look));
        UI.setState(row, input.value.toLowerCase() !== own.toLowerCase() ? "changed" : null);
        row.querySelector(".value").textContent = input.value;
        row.querySelector(".back").title = `Back to the look's own, ${own}`;
      }
    };
    const paintLookPreview = () => {
      const preview = $("#sp-look-preview");
      if (!preview) return;
      const look = pickedLook();
      preview.dataset.look = look.id;
      for (const [name, value] of Object.entries(TOKENS.cssVars(look))) preview.style.setProperty(name, value);
      applyCustomVars(preview, pendingAdjust());
      paintRows();
    };
    const fillRows = (lookId) => {
      const look = TOKENS.looks[lookId] || TOKENS.current;
      const custom = ((read().settings.appearance || {}).custom || {})[look.id] || {};
      for (const f of TOKENS.adjustables) {
        const input = inputOf(f.key);
        if (input) input.value = custom[f.key] || String(f.of(look));
      }
      $("#sp-adj-head .name").textContent = `Fine-tune ${look.label}`;
    };
    looksBox.querySelectorAll('.look-cards [data-ui="look-card"]').forEach((b) =>
      on(b, "click", () => {
        looksBox.querySelectorAll('.look-cards [data-ui="look-card"]').forEach((x) => {
          UI.setState(x, x === b ? "on" : null);
          x.setAttribute("aria-pressed", x === b ? "true" : "false");
        });
        const input = $("#sp-look");
        input.value = b.dataset.look;
        fillRows(b.dataset.look);
        paintLookPreview();
        paintOwnRow();
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }),
    );
    const paintOwnRow = () => {
      const own = looksBox.querySelector("#sp-look-own .own-only");
      if (own) own.hidden = !pickedLook().custom;
    };
    on(looksBox.querySelector(".sp-look-import"), "click", () => $("#sp-look-file").click());
    on($("#sp-look-file"), "change", async () => {
      const file = $("#sp-look-file").files && $("#sp-look-file").files[0];
      $("#sp-look-file").value = "";
      if (!file) return;
      try {
        const spec = JSON.parse(await file.text());
        active.signal.throwIfAborted();
        const checked = await settingsCommands.checkLook(spec);
        active.signal.throwIfAborted();
        if (!checked.ok) throw new Error(`${file.name} is not a look viberoom can wear: ${(checked.errors || []).map((x) => x.message).join("; ")}`);
        const taken = TOKENS.looks[checked.id];
        if (taken && !taken.custom) throw new Error(`"${checked.id}" is the id of a look viberoom ships; change the id in the file`);
        if (taken && !(await confirmDialog(`You have a look "${taken.label}" with this id already. Replace it with the one from ${file.name}?`, { title: "Replace the look?", okLabel: "Replace" }))) return;
        active.signal.throwIfAborted();
        const saved = await settingsCommands.saveLook(spec, !!taken);
        toast(`Look "${saved.look.label}" ${taken ? "replaced" : "added"}: it is in the list now.${(saved.warnings || []).length ? ` ${saved.warnings.map((w) => w.message).join(" ")}` : ""}`, "success");
      } catch (error) {
        reportError(error);
      }
    });
    on(looksBox.querySelector(".sp-look-export"), "click", async () => {
      const look = pickedLook();
      const spec = read().looks.find((l) => l.id === look.id);
      if (!spec) return;
      try {
        await saveFile({ name: `${look.id}.json`, blob: new Blob([`${JSON.stringify(spec, null, 2)}\n`], { type: "application/json" }), description: "A viberoom look", type: "application/json", extension: ".json" });
      } catch (error) {
        reportError(error);
      }
    });
    on(looksBox.querySelector(".sp-look-delete"), "click", async () => {
      const look = pickedLook();
      if (!look.custom) return;
      const ok = await confirmDialog(`"${look.label}" goes from your looks; a window wearing it falls back to VibeClassic. The file is gone too (export it first to keep it).`, { title: "Delete the look?", okLabel: "Delete", danger: true });
      if (!ok || active.disposed) return;
      try {
        await settingsCommands.removeLook(look.id);
        toast(`Look "${look.label}" deleted.`, "success");
      } catch (error) {
        reportError(error);
      }
    });
    looksBox.querySelectorAll('[data-ui="adjust-row"] input').forEach((i) => on(i, "input", paintLookPreview));
    on(looksBox, "click", (e) => {
      const back = e.target.closest && e.target.closest('[data-ui="adjust-row"] .back');
      if (!back) return;
      const row = back.closest('[data-ui="adjust-row"]');
      const f = TOKENS.adjustables.find((x) => x.key === row.dataset.key);
      const input = row.querySelector("input");
      if (!f || !input) return;
      input.value = String(f.of(pickedLook()));
      paintLookPreview();
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    on(looksBox.querySelector(".sp-adj-reset"), "click", () => {
      const look = pickedLook();
      for (const f of TOKENS.adjustables) {
        const input = inputOf(f.key);
        if (input) input.value = String(f.of(look));
      }
      paintLookPreview();
      $("#sp-look").dispatchEvent(new Event("change", { bubbles: true }));
    });
    paintLookPreview();
    on($("#sp-mono"), "change", () => sample.querySelectorAll("code").forEach((c) => (c.style.fontFamily = FONTS.mono[$("#sp-mono").value].stack)));
    bindCopy($("#sp-slow-copy"), slowTasksText, "nothing over 8 ms in this window");
    on($("#sp-trace-record"), "click", () => {
      startTrace();
    });
    bindCopy($("#sp-trace-copy"), traceText, "no trace recorded yet");
    bindCopy($("#sp-wheel-copy"), wheelTraceText, "no wheel on the chat in the last two minutes");
    on($("#sp-restart-now"), "click", async () => {
      let once = null;
      const keeps = (read().settings || {}).reconnectMode === "load";
      const writing = read().writingNames;
      const back = keeps
        ? "Rooms set to start with viberoom come back, and each vibemate returns with its session, so conversations continue. A vibemate whose session cannot be loaded returns with the last few messages instead — the room says which happened."
        : "Rooms set to start with viberoom come back, and each vibemate starts fresh with the last few messages of the room.";
      const cut = writing.length
        ? `${nameList(writing)} ${writing.length > 1 ? "are" : "is"} writing: viberoom can wait for ${writing.length > 1 ? "those replies" : "that reply"}, or restart now and cut ${writing.length > 1 ? "them" : "it"} short.`
        : "A reply being written right now would be cut short.";
      const other = keeps ? "Start the vibemates fresh instead" : "Bring the vibemates' sessions back instead";
      const choice = await choiceDialog(`viberoom closes and opens again on the same port; it takes a few seconds. ${back} ${cut}`, {
        title: "Restart viberoom?",
        okLabel: writing.length ? "When they finish" : "Restart",
        altLabel: writing.length ? "Restart now" : "",
        extraHtml: settingsCard("cf-sessions", "", settingRow({ label: other, for: "cf-sessions-once", kind: "switch", hint: "For this restart only. Your lasting choice is under Vibemates → Welcome back." })),
        beforeClose: () => { once = restartSessionsChecked() ? (keeps ? "replay" : "load") : null; },
      });
      if (choice === "cancel" || active.disposed) return;
      const button = $("#sp-restart-now");
      const say = (words) => (button.querySelector(".label").textContent = words);
      button.disabled = true;
      say("Restarting…");
      try {
        const res = await settingsCommands.restart({ when: choice === "alt" ? "now" : "idle", ...(once ? { sessions: once } : {}) });
        if (active.disposed) return;
        const held = (res && res.restart && res.restart.waitingFor) || [];
        toast(held.length ? `viberoom restarts when ${nameList(held)} ${held.length > 1 ? "finish" : "finishes"}.` : "viberoom is restarting; the window reconnects on its own.", "success");
        if (held.length) { button.disabled = false; say("Restart"); }
      } catch (error) {
        reportError(error);
        if (!active.disposed) { button.disabled = false; say("Restart"); }
      }
    });
    on($("#sp-autostart-on"), "change", async (e) => {
      e.stopPropagation();
      const box = e.target;
      const wanted = box.checked;
      box.disabled = true;
      try {
        const res = await settingsCommands.setAutostart(wanted);
        acceptAutostart(res.autostart);
        if (res.autostart?.enabled !== wanted) toast(res.autostart?.note || "The operating system did not apply the startup setting.", "warn");
        else toast(wanted ? "viberoom starts when you sign in." : "viberoom no longer starts when you sign in.", "success");
      } catch (error) {
        reportError(error);
      }
      refresh();
    });
    const narrowBtn = $("#sp-folder-narrow");
    if (narrowBtn) on(narrowBtn, "click", async () => {
      narrowBtn.disabled = true;
      UI.setState(narrowBtn, "loading");
      try {
        const { dataFolder } = await settingsCommands.narrowDataFolder();
        acceptDataFolder(dataFolder);
        if (active.disposed) return;
        const left = (dataFolder && dataFolder.others) || [];
        $("#sp-folder-result").textContent = left.length
          ? `Still open to ${left.join(", ")}. Your computer refused the change; an administrator can make it.`
          : "Private: this folder now opens for you alone.";
        if (!left.length) setTimeout(() => refresh(), 1500);
      } catch (e) {
        reportError(e);
      }
      if (!active.disposed) { narrowBtn.disabled = false; UI.setState(narrowBtn, null); }
    });
    on($("#sp-notify-allow"), "click", async () => {
      await askToKnock();
      refresh();
    });
    on($("#sp-update-check"), "click", async () => {
      const b = $("#sp-update-check");
      b.disabled = true;
      UI.setState(b, "loading");
      try {
        const update = await settingsQueries.checkUpdates({ signal: active.signal });
        if (active.disposed) return;
        acceptUpdate(update);
        $("#sp-update-status").textContent = updateStatusText();
        renderUpdatePop();
      } catch (e) {
        reportError(e);
      }
      if (!active.disposed) { b.disabled = false; UI.setState(b, null); }
    });
    on($("#sp-agent-update-open"), "click", () => openAgentUpdates());
    formRoot.querySelectorAll("input[data-vendor]").forEach((inp) => {
      const list = document.createElement("datalist"); list.id = inp.getAttribute("list"); inp.after(list);
      on(inp, "focus", () => void fillVendorChoices(inp.dataset.vendor, { signal: active.signal, root: formRoot }));
    });
    bindSave($("#sp-form"), async () => {
        const vendorPresets = {};
        formRoot.querySelectorAll("input[data-vendor]").forEach((inp) => {
          vendorPresets[inp.dataset.vendor] = vendorPresets[inp.dataset.vendor] || { model: null, effort: null, mode: null };
          vendorPresets[inp.dataset.vendor][inp.dataset.key] = inp.value.trim() || null;
        });
        await settingsCommands.saveSettings({
          bypassPermissionsByDefault: $("#sp-bypass").checked,
          agentSkillsNeedApproval: $("#sp-skill-approval").checked,
          showMoreOnClick: $("#sp-more-on-click").checked,
          wheelStepPercent: Number($("#sp-wheel-step").value),
          wheelInertia: $("#sp-wheel-inertia").checked,
          notifyReplies: $("#sp-notify").value,
          appBadge: $("#sp-badge").checked,
          keepAwake: $("#sp-keep-awake").value,
          devShowPrompts: $("#sp-dev-prompts-on")?.checked,
          devShowMemoryIngestion: $("#sp-dev-memory-on")?.checked,
          checkForUpdates: $("#sp-updates")?.checked,
          checkAgentUpdates: $("#sp-agent-updates").checked,
          transcripts: $("#sp-transcripts-mode").value,
          diagrams: { preset: $("#sp-diagram-preset").value, primary: $("#sp-diagram-custom").checked ? $("#sp-diagram-color").value : null },
          editor: { mode: $("#sp-editor-mode").value, command: $("#sp-editor-cmd").value },
          appearance: { chatFontSize: Number($("#sp-chat-fs").value), scale: Number($("#sp-ui-scale").value), font: $("#sp-font").value, mono: $("#sp-mono").value, look: $("#sp-look").value, custom: { [$("#sp-look").value]: Object.keys(pendingAdjust()).length ? pendingAdjust() : null } },
          roomDefaults: {
            turnTaking: $("#sp-turns").value,
            replyDelay: Number($("#sp-delay").value),
            hopLimit: Number($("#sp-hops").value),
            fullBriefEveryTurns: Number($("#sp-brief-turns").value),
            fullBriefEveryTokens: Number($("#sp-brief-tokens").value),
            briefTextLimit: Number($("#sp-text-limit").value),
            headerRules: $("#sp-header-rules").checked,
            tools: $("#sp-tools").value,
            sharesHistory: $("#sp-share-history").checked,
            readsOtherRooms: $("#sp-reads-others").value,
            remembers: $("#sp-remembers").checked,
          },
          vendorPresets,
        });
    });
    } catch (error) { dispose(); throw error; }
    return Object.freeze({ dispose });
  }
  Object.defineProperty(mount, "disposable", { value: true });
  Object.defineProperty(mount, "scoped", { value: true });
  global.VIBEROOM_SETTINGS_FORM = Object.freeze({ mount });
})(globalThis);
