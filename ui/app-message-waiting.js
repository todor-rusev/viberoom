// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function create(messages, { signal, UI, icon: ic, esc, onError }) {
    signal?.throwIfAborted();
    const lifetime = global.VIBEROOM_APP_LIFETIME.create({ window: messages.ownerDocument.defaultView });
    const domResources = global.VIBEROOM_APP_DOM_LIFETIME.create({ root: messages, lifetime });
    const bindings = new WeakMap();
    function draw(el, { agents, bodyVersion, stoppable }, prepareStop) {
      if (el.isConnected && !messages.contains(el)) return;
      const box = el.querySelector(".waiting");
      if (!box) return;
      const previous = bindings.get(box); previous?.release();
      const binding = { release: () => {} }; bindings.set(box, binding);
      el.classList.toggle("waiting", agents.length > 0);
      box.hidden = !agents.length;
      if (!agents.length) { if (box.innerHTML) box.innerHTML = ""; box.waitingKey = null; return; }
      const list = (people) => people.length === 1 ? people[0] : `${people.slice(0, -1).join(", ")} and ${people[people.length - 1]}`;
      const names = agents.map((p) => p.name);
      const checking = agents.filter(p => p.skillChannel === "tool");
      const hint = !checking.length ? "" : checking.length === agents.length ? `${names.length === 1 ? names[0] : "They"} can already read it while working.`
        : `${list(checking.map(p => p.name))} can already read it while working.`;
      const stopLabel = stoppable.length === 1 ? `Stop ${stoppable[0].name}'s reply` : "Stop these replies";
      const stopTitle = stoppable.length === 1 ? "Your message is sent as soon as the reply stops" : "Your message is sent as soon as the replies stop";
      const html = `<span class="waiting-text"${hint ? ` title="${esc(hint)}"` : ""}>${ic("clock")} Sends when ${esc(list(names))} ${names.length === 1 ? "finishes" : "finish"}</span>` +
        (stoppable.length ? UI.html("button", { label: stopLabel, kind: "inverse", size: "sm", act: "stop-waiting", title: stopTitle }) : "");
      const waitingKey = JSON.stringify([html, bodyVersion, stoppable.map(p => p.turnId)]);
      if (box.waitingKey !== waitingKey) { box.innerHTML = html; box.waitingKey = waitingKey; }
      const button = box.querySelector('[data-act="stop-waiting"]');
      if (!button) return;

      binding.release = domResources.nodeListener(button, "click", async (e) => {
        const live = () => bindings.get(box) === binding && !box.hidden && button.isConnected && messages.contains(el) && box.querySelector('[data-act="stop-waiting"]') === button;
        if (!live()) return;
        const stop = prepareStop();
        if (!stop) return;
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = "Stopping…";
        try { await lifetime.wait(stop()); }
        catch (error) {
          if (lifetime.disposed) return;
          onError(error);
          if (!live()) return;
          btn.disabled = false;
          btn.textContent = stopLabel;
        }
      });
    }
    const dispose = () => lifetime.dispose();
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ draw: lifetime.guard(draw), dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  global.VIBEROOM_MESSAGE_WAITING = Object.freeze({ create });
})(globalThis);
