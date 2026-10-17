// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create({ window: view = root, signal: owner } = {}) {
    let current = null, disposed = false, generation = 0;
    function enter(key) {
      if (disposed) return null;
      if (key !== null && typeof key !== "string") throw new TypeError("A screen identity is required");
      if (current?.key === key) return current;
      current?.dispose(); current = null;
      if (key === null) return null;
      const lifetime = root.VIBEROOM_APP_LIFETIME.create({ window: view }), intents = new Map();
      const id = ++generation;
      const frame = Object.freeze({ key, generation: id, lifetime, signal: lifetime.signal,
        isCurrent: () => !disposed && current === frame && !lifetime.disposed,
        intent(name) {
          if (!frame.isCurrent()) throw lifetime.signal.reason;
          if (typeof name !== "string") throw new TypeError("An intent name is required");
          intents.get(name)?.abort();
          const controller = new view.AbortController();
          intents.set(name, controller);
          return Object.freeze({ signal: controller.signal,
            isCurrent: () => frame.isCurrent() && intents.get(name) === controller && !controller.signal.aborted });
        },
        dispose() {
          if (lifetime.disposed) return;
          for (const controller of intents.values()) controller.abort();
          intents.clear(); lifetime.dispose();
          if (current === frame) current = null;
        },
      });
      current = frame;
      return frame;
    }
    function dispose() {
      if (disposed) return;
      disposed = true; owner?.removeEventListener("abort", dispose);
      current?.dispose(); current = null;
    }
    if (owner?.aborted) dispose();
    else owner?.addEventListener("abort", dispose, { once: true });
    return Object.freeze({ enter, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  root.VIBEROOM_SCREEN_LIFETIME = Object.freeze({ create });
})(globalThis);
