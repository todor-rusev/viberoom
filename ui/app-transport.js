// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create({ window: view = root, signal: owner } = {}) {
    const controller = new view.AbortController(), resources = new Set(), responses = new WeakMap();
    let disposed = false;

    function pending(signal, start) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (deliver, value) => {
          if (settled) return;
          settled = true; signal.removeEventListener("abort", abort); deliver(value);
        };
        const abort = () => finish(reject, signal.reason);
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort, { once: true });
        try {
          Promise.resolve(start()).then(value => {
            if (signal.aborted) abort(); else finish(resolve, value);
          }, error => finish(reject, error));
        } catch (error) { finish(reject, error); }
      });
    }

    async function request(input, init = {}) {
      controller.signal.throwIfAborted();
      const { deadlineMs, signal: supplied, ...options } = init;
      const caller = supplied === undefined && typeof view.Request === "function" && input instanceof view.Request ? input.signal : supplied;
      caller?.throwIfAborted();
      const requestSignal = view.AbortSignal.any([controller.signal, ...(caller ? [caller] : []), view.AbortSignal.timeout(deadlineMs || 60000)]);
      const response = await pending(requestSignal, () => view.fetch(input, { ...options, signal: requestSignal }));
      requestSignal.throwIfAborted();
      responses.set(response, requestSignal);
      return response;
    }

    function read(response, method, caller) {
      const signal = responses.get(response);
      if (!signal) throw new TypeError("Read a response returned by this transport's request");
      if (!["json", "text", "blob"].includes(method)) throw new TypeError("Read the response as json, text or blob");
      return pending(caller ? view.AbortSignal.any([signal, caller]) : signal, () => response[method]());
    }

    function socket(url, handlers = {}) {
      controller.signal.throwIfAborted();
      const ws = new view.WebSocket(url), listeners = [];
      let active = true;
      const release = () => {
        if (!active) return;
        active = false; resources.delete(stop);
        for (const [type, listener] of listeners) ws.removeEventListener(type, listener);
      };
      const stop = () => { if (active) { release(); ws.close(); } };
      if (disposed) { stop(); throw controller.signal.reason; }
      resources.add(stop);
      for (const type of ["open", "message", "error", "close"]) {
        const listener = event => {
          if (!active || disposed) return;
          if (type === "close") release();
          handlers[type]?.call(ws, event);
        };
        listeners.push([type, listener]); ws.addEventListener(type, listener);
      }
      return ws;
    }

    function send(xhr, body, onProgress = () => {}) {
      return new Promise((resolve, reject) => {
        if (disposed) { reject(controller.signal.reason); return; }
        let active = true;
        const listeners = [];
        const finish = (deliver, value) => {
          if (!active) return;
          active = false; resources.delete(stop);
          for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
          deliver(value);
        };
        const stop = () => {
          if (!active) return;
          finish(reject, controller.signal.reason);
          xhr.abort();
        };
        const listen = (target, type, callback) => {
          const listener = event => { if (active && !disposed) callback(event); };
          listeners.push([target, type, listener]); target.addEventListener(type, listener);
        };
        resources.add(stop);
        listen(xhr, "load", () => finish(resolve, xhr));
        listen(xhr, "error", () => finish(reject, new view.DOMException("The upload failed", "NetworkError")));
        listen(xhr, "abort", () => finish(reject, new view.DOMException("The upload was aborted", "AbortError")));
        listen(xhr, "timeout", () => finish(reject, new view.DOMException("The upload timed out", "TimeoutError")));
        listen(xhr.upload, "progress", event => onProgress.call(xhr.upload, event));
        try { xhr.send(body); } catch (error) { finish(reject, error); }
      });
    }

    function dispose() {
      if (disposed) return;
      disposed = true; owner?.removeEventListener("abort", dispose);
      controller.abort(owner?.aborted ? owner.reason : undefined);
      const errors = [];
      for (const stop of [...resources]) {
        try { stop(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, "Application transport cleanup failed");
    }
    if (owner?.aborted) dispose();
    else owner?.addEventListener("abort", dispose, { once: true });
    return Object.freeze({ request, read, socket, send, dispose, signal: controller.signal });
  }
  Object.defineProperty(create, "disposable", { value: true });
  root.VIBEROOM_APP_TRANSPORT = Object.freeze({ create });
})(globalThis);
