// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function create({ root, lifetime }) {
    const view = root.ownerDocument.defaultView;
    function scope() {
      lifetime.signal.throwIfAborted();
      const child = global.VIBEROOM_APP_LIFETIME.create({ window: view });
      const release = lifetime.own(() => child.dispose());
      return Object.freeze({
        own: child.own,
        on: (target, type, callback, options) => child.on(target, type, lifetime.guard(callback), options),
        guard: callback => child.guard(lifetime.guard(callback)),
        observer: (Observer, callback, ...args) => child.observer(Observer, lifetime.guard(callback), ...args),
        frame: callback => child.frame(lifetime.guard(callback)),
        cancelFrame: child.cancelFrame,
        timeout: (callback, ms, ...args) => child.timeout(lifetime.guard(callback), ms, ...args),
        clearTimeout: child.clearTimeout,
        release,
        get disposed() { return child.disposed; },
      });
    }
    function observe(Observer, callback, ...args) {
      const active = scope();
      try { return Object.freeze({ observer: active.observer(Observer, callback, ...args), release: active.release }); }
      catch (error) { active.release(); throw error; }
    }
    function nodeListener(node, type, callback, options) {
      if (!node) return () => {};
      lifetime.signal.throwIfAborted();
      let active = true;
      const listener = lifetime.guard(function (...args) { if (active) return callback.apply(this, args); });
      node.addEventListener(type, listener, options);
      return () => { if (active) { active = false; node.removeEventListener(type, listener, options); } };
    }
    return Object.freeze({ scope, observe, nodeListener });
  }
  global.VIBEROOM_APP_DOM_LIFETIME = Object.freeze({ create });
})(globalThis);
