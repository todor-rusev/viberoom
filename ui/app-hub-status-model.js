// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create() {
    let disposed = false;
    let current = Object.freeze({ version: null, dataFolder: null });
    const read = () => current;
    const own = value => value === undefined ? undefined : root.VIBEROOM_OWNED_JSON.copy(value, "Hub status");
    function accept(field, value) {
      if (disposed) return;
      const copied = own(value);
      current = Object.freeze({ ...current, [field]: copied });
    }
    function acceptAutomations(pending, jobs) {
      if (disposed) return;
      const automationPending = own(pending), automationJobs = own(jobs);
      current = Object.freeze({ ...current, automationPending, automationJobs });
    }
    function acceptRestartPending(value) {
      if (disposed) return;
      const pending = own(value || null);
      current = Object.freeze({ ...current, restart: Object.freeze({ ...(current.restart || { can: true }), pending }) });
    }
    function dispose() { disposed = true; }
    return Object.freeze({
      reader: Object.freeze({ read }),
      acceptVersion: value => accept("version", value),
      acceptInstallation: value => accept("installation", value),
      acceptDataFolder: value => accept("dataFolder", value),
      acceptUpdate: value => accept("update", value),
      acceptRestart: value => accept("restart", value),
      acceptAutostart: value => accept("autostart", value),
      acceptKeepAwake: value => accept("keepAwake", value),
      acceptPerMessage: value => accept("perMessage", value),
      acceptAutomations, acceptRestartPending, dispose,
    });
  }
  Object.defineProperty(create, "disposable", { value: true });
  root.VIBEROOM_HUB_STATUS_MODEL = Object.freeze({ create });
})(globalThis);
