// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create({ window: view = root } = {}) {
    const controller = new view.AbortController();
    const cleanups = new Set(), timeouts = new Set(), intervals = new Set(), frames = new Set();
    let disposed = false;

    function own(cleanup) {
      if (typeof cleanup !== "function") throw new TypeError("A cleanup function is required");
      let held = true;
      function release() {
        if (!held) return;
        held = false; cleanups.delete(release); cleanup();
      }
      if (disposed) release();
      else cleanups.add(release);
      return release;
    }
    function use(resource) {
      if (typeof resource?.dispose !== "function") throw new TypeError("A disposable resource is required");
      own(() => resource.dispose());
      return resource;
    }
    function guard(callback) {
      return function (...args) { if (!disposed) return callback.apply(this, args); };
    }
    function on(target, type, callback, options) {
      if (disposed || options?.signal?.aborted) return () => {};
      let listening = true, release;
      const listener = function (...args) {
        if (!listening || disposed) return;
        if (options?.once) release();
        return callback.apply(this, args);
      };
      target.addEventListener(type, listener, options);
      release = own(() => { listening = false; target.removeEventListener(type, listener, options); });
      return release;
    }
    function timeout(callback, ms, ...args) {
      if (disposed) return 0;
      const id = view.setTimeout(() => { if (timeouts.delete(id) && !disposed) callback(...args); }, ms);
      timeouts.add(id); return id;
    }
    function clearTimeout(id) { if (timeouts.delete(id)) view.clearTimeout(id); }
    function interval(callback, ms, ...args) {
      if (disposed) return 0;
      const id = view.setInterval(() => { if (intervals.has(id) && !disposed) callback(...args); }, ms);
      intervals.add(id); return id;
    }
    function clearInterval(id) { if (intervals.delete(id)) view.clearInterval(id); }
    function frame(callback) {
      if (disposed) return 0;
      const id = view.requestAnimationFrame(time => { if (frames.delete(id) && !disposed) callback(time); });
      frames.add(id); return id;
    }
    function cancelFrame(id) { if (frames.delete(id)) view.cancelAnimationFrame(id); }
    function observer(Observer, callback, ...args) {
      if (disposed) throw controller.signal.reason;
      const value = new Observer(guard(callback), ...args);
      own(() => value.disconnect());
      return value;
    }
    function wait(promise) {
      return new Promise((resolve, reject) => {
        let settled = false, release = () => {};
        const finish = (settle, value) => {
          if (settled) return;
          settled = true; release(); settle(value);
        };
        Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
        release = own(() => finish(reject, controller.signal.reason));
      });
    }
    function delay(ms) {
      if (disposed) return Promise.reject(controller.signal.reason);
      return new Promise((resolve, reject) => {
        let settled = false, id = 0;
        const release = own(() => {
          if (settled) return;
          settled = true; clearTimeout(id); reject(controller.signal.reason);
        });
        id = timeout(() => { settled = true; release(); resolve(); }, ms);
      });
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      for (const id of timeouts) view.clearTimeout(id);
      for (const id of intervals) view.clearInterval(id);
      for (const id of frames) view.cancelAnimationFrame(id);
      timeouts.clear(); intervals.clear(); frames.clear();
      const errors = [];
      for (const release of [...cleanups].reverse()) {
        try { release(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, "Application resource cleanup failed");
    }
    return Object.freeze({ own, use, guard, on, timeout, clearTimeout, interval, clearInterval, frame, cancelFrame,
      observer, wait, delay, dispose, signal: controller.signal, get disposed() { return disposed; } });
  }
  root.VIBEROOM_APP_LIFETIME = Object.freeze({ create });
})(globalThis);
