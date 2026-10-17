// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  function flattenOptions(options) {
    const out = [];
    for (const entry of options || []) {
      if (entry && Array.isArray(entry.options)) out.push(...entry.options);
      else out.push(entry);
    }
    return out;
  }

  function render(panel, p, offline, ports) {
    const { UI, settingsCard, settingRow, busy = false, change, setConfig, listen, restartInstalled, onError } = ports;
    const card = (body) => settingsCard("pp-options", "Session", body);
    if (offline) {
      panel.innerHTML = card(settingRow({ label: "Offline", hint: `Reconnect to start a new session (${[p.launch && p.launch.model, p.launch && p.launch.effort, p.launch && p.launch.mode].filter(Boolean).join(" · ") || "vibemate defaults"}).` }));
      return;
    }
    if (p.status === "starting") {
      panel.innerHTML = card(settingRow({ label: "Starting", hint: "Settings will be available when this vibemate is ready." }));
      return;
    }
    const rows = [];
    const binds = [];
    const cardGeek = () => (rows.length ? undefined : "These options come from the coding agent itself: the hub lists the ones it offers and sets your pick on its running session, so a change takes effect from the next turn, without restarting it or losing what it remembers.");
    const addSelect = (name, values, current, onChange, id, hint) => {
      const choices = current != null && !values.some(v => v.value === current)
        ? [{ value: String(current), name: `${current} (reported)` }, ...values] : values;
      rows.push(settingRow({ label: name, for: id, hint, geek: cardGeek(), control: UI.raw(`<select class="select" id="${esc(id)}"${busy ? " disabled" : ""}>${choices.map((v) => `<option value="${esc(v.value)}"${v.description ? ` title="${esc(v.description)}"` : ""}${v.value === current ? " selected" : ""}>${esc(v.name || v.value)}</option>`).join("")}</select>`) }));
      binds.push(() => {
        const select = panel.querySelector(`#${CSS.escape(id)}`);
        listen(select, "change", () => void change(select, onChange, select.value, id));
      });
    };
    const hasModeOption = (p.configOptions || []).some((o) => o.category === "mode");
    if (!hasModeOption && p.modes && p.modes.length) {
      addSelect("Mode", p.modes.map((m) => ({ value: m.id, name: m.name || m.id, description: m.description })), p.mode, (value) => setConfig("mode", value), `cfg-${p.id}-mode`);
    }
    for (const option of p.configOptions || []) {
      const id = `cfg-${p.id}-${String(option.id).replace(/[^\w-]/g, "_")}`;
      const apply = value => setConfig(option.id, value);
      if (option.type === "boolean") {
        rows.push(settingRow({ label: option.name, for: id, kind: "switch", checked: option.currentValue === true, disabled: busy, hint: option.description || undefined, geek: cardGeek() }));
        binds.push(() => {
          const input = panel.querySelector(`#${CSS.escape(id)}`);
          listen(input, "change", () => void change(input, apply, input.checked, id));
        });
      } else if (option.type === "select") addSelect(option.name, flattenOptions(option.options), option.currentValue, apply, id, option.description || undefined);
    }
    if (!rows.length) rows.push(settingRow({ label: "No options", hint: "This vibemate exposes no session options." }));
    const outdated = p.installOutdated
      ? settingRow({ label: `A newer ${p.agentVendor || "agent"} is installed`, hint: `${p.name} still runs the old one, so new models are not in this list yet. It keeps its conversation; only when it is not writing.`, control: UI.raw(UI.html("button", { label: "Restart on the new version", kind: "secondary", size: "sm", id: "pp-restart-installed", disabled: p.status === "thinking" })) })
      : "";
    const pending = p.pendingSettings?.length ? `<p class="hint config-pending" role="status">${esc("Pending: " + p.pendingSettings.map(setting => `${setting.name} → ${setting.value}`).join("; "))}</p>` : "";
    panel.innerHTML = card(`${outdated}${rows.join("")}${pending}`);
    binds.forEach((bind) => bind());
    const restart = panel.querySelector("#pp-restart-installed");
    if (restart) {
      listen(restart, "click", async () => {
        restart.disabled = true;
        try { await restartInstalled(); }
        catch (error) { onError(error); restart.disabled = false; }
      });
    }
  }
  root.VIBEROOM_AGENT_CONFIG = Object.freeze({ render, flattenOptions });
})(typeof window !== "undefined" ? window : globalThis);
