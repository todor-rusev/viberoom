// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create({ window: view = root, signal, current, finish }) {
    signal?.throwIfAborted();
    const lifetime = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let bindings = new WeakMap(), groups = new WeakMap();
    const pending = new Set();
    function retire(ticket) {
      if (!ticket.alive) return;
      ticket.alive = false; pending.delete(ticket); ticket.group.delete(ticket);
      lifetime.clearTimeout(ticket.timer); lifetime.cancelFrame(ticket.frame);
    }
    function valid(ticket) {
      if (lifetime.disposed || !ticket.alive || bindings.get(ticket.node) !== ticket) return false;
      const accepted = current(ticket.node, ticket.target);
      return !lifetime.disposed && ticket.alive && bindings.get(ticket.node) === ticket && accepted;
    }
    function bind(node, target, record) {
      if (lifetime.disposed) return false;
      const old = bindings.get(node);
      if (old) retire(old);
      if (lifetime.disposed || bindings.get(node) !== old) return false;
      let group = groups.get(record);
      if (!group) { group = new Set(); groups.set(record, group); }
      const ticket = { node, group, target: Object.freeze({ roomId: target.roomId, roomIdentity: target.roomIdentity,
        sourceToken: target.sourceToken, textToken: target.textToken }), alive: true, timer: 0, frame: 0 };
      bindings.set(node, ticket); return true;
    }
    function targetOf(node) { const ticket = bindings.get(node); return !lifetime.disposed && ticket?.alive ? ticket.target : undefined; }
    function run(ticket) {
      pending.delete(ticket); ticket.group.delete(ticket);
      if (!valid(ticket)) { retire(ticket); return; }
      finish(ticket.node, ticket.target, () => valid(ticket));
    }
    function schedule(node, delay) {
      const ticket = bindings.get(node);
      if (!ticket || !ticket.alive || lifetime.disposed) return;
      lifetime.clearTimeout(ticket.timer); lifetime.cancelFrame(ticket.frame); pending.add(ticket); ticket.group.add(ticket);
      if (delay) ticket.timer = lifetime.timeout(() => run(ticket), delay);
      else ticket.frame = lifetime.frame(() => { if (valid(ticket)) ticket.timer = lifetime.timeout(() => run(ticket), 0); else retire(ticket); });
    }
    function clear() { const old = [...pending]; bindings = new WeakMap(); groups = new WeakMap(); for (const ticket of old) retire(ticket); }
    function changed(record, change) {
      if (change.part !== "all" && change.part !== "text" && change.part !== "bodyState") return;
      for (const ticket of [...(groups.get(record) || [])]) if (ticket.target.sourceToken === change.token) retire(ticket);
    }
    function removed(record, tokens) {
      const gone = new Set(tokens);
      for (const ticket of [...(groups.get(record) || [])]) if (gone.has(ticket.target.sourceToken)) retire(ticket);
    }
    function reset(record) { const old = groups.get(record); groups.delete(record); for (const ticket of [...(old || [])]) retire(ticket); }
    function dispose() { lifetime.dispose(); clear(); }
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ bind, targetOf, schedule, changed, removed, reset, clear, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  root.VIBEROOM_MESSAGE_TEXT_WORK = Object.freeze({ create });
})(globalThis);
