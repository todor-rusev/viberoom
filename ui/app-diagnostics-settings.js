// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function markup({ mode = "off", roomValues, help, trace = "" }, { UI, row, select, action }) {
    return row({ label: "Save diagnostic details", for: "sp-transcripts-mode", ...roomValues,
      hint: `${help} You can choose a different setting for each room.`,
      control: UI.raw(select("sp-transcripts-mode", [["off", "Off (default)"], ["errors", "When something fails"], ["full", "All activity"]], mode)) })
      + row({ label: "Saved details", hint: "Includes current and removed rooms. Clearing these details keeps your conversations and shared files. Recording can create new details while vibemates work.",
        status: "Checking saved diagnostic details…", statusId: "sp-log-size", control: UI.raw(UI.html("button", { label: "Check size", kind: "secondary", size: "sm", id: "sp-log-check" })
          + UI.html("button", { label: "Clear diagnostic details", kind: "warn", size: "sm", id: "sp-log-clear", disabled: true })) })
      + row({ label: "Tool connection details", hint: "Recent tool connection timings stay in memory. Copy them when reporting a connection problem; message text and access keys are not included.",
        control: action({ label: "Copy tool connection details", id: "sp-connection-copy" }) }) + trace;
  }
  function mount(section, { signal, pageShown, readRequests, readLogs, clearLogs, saveMode, bindSave, copyText, manualCopy, confirm, onError }) {
    if (!section?.ownerDocument || typeof readRequests !== "function" || typeof readLogs !== "function" || typeof clearLogs !== "function") throw new TypeError("A diagnostics root and application operations are required");
    signal?.throwIfAborted();
    const active = global.VIBEROOM_APP_LIFETIME.create({ window: section.ownerDocument.defaultView });
    const dispose = () => active.dispose();
    signal?.addEventListener("abort", dispose, { once: true });
    active.own(() => signal?.removeEventListener("abort", dispose));
    const current = () => !active.disposed && section.isConnected;
    try {
      const label = section.querySelector("#sp-log-size"), check = section.querySelector("#sp-log-check"), clear = section.querySelector("#sp-log-clear"), copy = section.querySelector("#sp-connection-copy");
      const page = section.closest('[data-ui="settings-category"]');
      let known = false, busy = false;
      const describe = stats => {
        const size = stats.bytes >= 1024 * 1024 ? `${(stats.bytes / (1024 * 1024)).toFixed(1)} MB`
          : stats.bytes >= 1024 ? `${(stats.bytes / 1024).toFixed(1)} KB` : `${stats.bytes} B`;
        return `${stats.files} file${stats.files === 1 ? "" : "s"} · ${size}`;
      };
      const setBusy = value => { busy = value; check.disabled = value; clear.disabled = value || !known; copy.disabled = value; };
      const refresh = async () => {
        if (busy || !current()) return;
        setBusy(true);
        try {
          const stats = await active.wait(readLogs({ signal: active.signal }));
          if (!current()) return;
          known = true;
          label.textContent = `Saved diagnostic details: ${describe(stats)}.` + (stats.skipped || stats.unavailable ? " Some locations could not be checked or were left alone." : "");
        } catch { if (current()) label.textContent = "Could not check saved diagnostic details. Try again."; }
        finally { if (current()) setBusy(false); }
      };
      active.on(check, "click", refresh);
      active.on(copy, "click", async () => {
        if (busy || !current()) return;
        setBusy(true);
        try {
          const report = await active.wait(readRequests({ signal: active.signal }));
          if (!current()) return;
          const text = JSON.stringify(report, null, 2);
          try { await active.wait(copyText(text)); }
          catch {
            if (!current()) return;
            await active.wait(manualCopy(text));
            return;
          }
          if (current()) copy.querySelector(".label").textContent = "Copied";
        } catch (error) { if (current()) onError(error); }
        finally { if (current()) setBusy(false); }
      });
      active.on(clear, "click", async () => {
        if (busy || !known || !current()) return;
        setBusy(true);
        try {
          const accepted = await active.wait(confirm("This clears saved and buffered diagnostic details from all rooms. Conversations and shared files stay saved. Recording can create new details afterwards.",
            { title: "Clear diagnostic details?", okLabel: "Clear details" }));
          if (!accepted || !current()) return;
          label.textContent = "Clearing diagnostic details…";
          const result = await active.wait(clearLogs());
          if (!current()) return;
          const partial = result.failedFiles || result.skipped || result.unavailable || result.remaining.skipped || result.remaining.unavailable;
          label.textContent = `Cleared ${result.removedFiles} file${result.removedFiles === 1 ? "" : "s"}. Remaining: ${describe(result.remaining)}.`
            + (partial ? " Some details could not be cleared or were left alone." : " New details may appear if recording is on.");
        } catch (error) { if (current()) { label.textContent = "Could not clear all diagnostic details. Check the size and try again."; onError(error); } }
        finally { if (current()) setBusy(false); }
      });
      for (const type of ["input", "change"]) active.on(section, type, event => { if (!event.target.closest?.("[data-own-save]")) event.stopPropagation(); });
      bindSave(section, async currentSave => { await saveMode(section.querySelector("#sp-transcripts-mode").value); if (!currentSave()) return false; },
        { listen: active.on, canStart: () => !active.disposed });
      if (page) {
        active.on(page, pageShown, () => { if (!known) void refresh(); });
        if (!page.hidden) void refresh();
      }
    } catch (error) { dispose(); throw error; }
    return Object.freeze({ dispose });
  }
  Object.defineProperty(mount, "disposable", { value: true });
  Object.defineProperty(mount, "scoped", { value: true });
  global.VIBEROOM_DIAGNOSTICS_SETTINGS = Object.freeze({ markup, mount });
})(globalThis);
