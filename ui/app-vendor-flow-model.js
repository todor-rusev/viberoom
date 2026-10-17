// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create() {
    let logins = new Map(), installs = new Map(), disposed = false;
    const own = value => root.VIBEROOM_OWNED_JSON.copy(value, "Vendor flow");
    function acceptSnapshot(flows) {
      if (disposed) return;
      const nextLogins = new Map(), nextInstalls = new Map();
      for (const flow of flows) {
        const target = flow.purpose === "install" ? nextInstalls : !flow.purpose || flow.purpose === "login" ? nextLogins : null;
        if (target) { const copied = own(flow); target.set(copied.recipeId, copied); }
      }
      logins = nextLogins; installs = nextInstalls;
    }
    function acceptEvent(flow) {
      if (disposed || flow.purpose === "update") return;
      const copied = own(flow);
      (copied.purpose === "install" ? installs : logins).set(copied.recipeId, copied);
    }
    function acceptReply(target, flow) {
      if (disposed) return;
      const known = target.get(flow.recipeId);
      if (!known || known.id !== flow.id) { const copied = own(flow); target.set(copied.recipeId, copied); }
    }
    function states(map) {
      return Object.freeze([...map].map(([id, flow]) => Object.freeze([id, Object.freeze({ state: flow.state })])));
    }
    function dispose() { disposed = true; logins.clear(); installs.clear(); }
    return Object.freeze({
      reader: Object.freeze({ login: id => logins.get(id), install: id => installs.get(id),
        inviteStates: () => Object.freeze({ installs: states(installs), logins: states(logins) }) }),
      acceptSnapshot, acceptEvent,
      acceptLoginReply: flow => acceptReply(logins, flow),
      acceptInstallReply: flow => acceptReply(installs, flow), dispose,
    });
  }
  Object.defineProperty(create, "disposable", { value: true });
  root.VIBEROOM_VENDOR_FLOW_MODEL = Object.freeze({ create });
})(globalThis);
