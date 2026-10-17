// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create({ window: view = root, transport, signal: owner, isHeld = () => false,
    onStall = () => {}, onTimeout, now = () => Date.now() } = {}) {
    if (typeof transport?.request !== "function" || typeof transport?.read !== "function"
      || typeof transport?.signal?.throwIfAborted !== "function") throw new TypeError("An application transport is required");
    const controller = new view.AbortController(), timers = new Set();
    let disposed = false, stalledAt = -Infinity, resyncedAt = -Infinity;

    function check(signal) {
      controller.signal.throwIfAborted();
      transport.signal.throwIfAborted();
      signal?.throwIfAborted();
    }
    function callerSignal(supplied) {
      check(supplied);
      return view.AbortSignal.any([controller.signal, ...(supplied ? [supplied] : [])]);
    }
    function heldByShell() {
      if (isHeld()) throw new Error("The room is restarting; the application brings this window back when it is ready.");
    }
    function clearTimer(timer) { if (timers.delete(timer)) view.clearTimeout(timer); }
    function stallWatch(promise, signal) {
      const timer = view.setTimeout(() => {
        timers.delete(timer);
        if (controller.signal.aborted || transport.signal.aborted || signal.aborted) return;
        if (now() - stalledAt > 30000) { stalledAt = now(); onStall(); }
      }, 8000);
      timers.add(timer);
      return promise.finally(() => clearTimer(timer));
    }
    function stoppedWaiting(error, signal) {
      if (controller.signal.aborted || transport.signal.aborted || signal?.aborted) return error;
      if (!error || (error.name !== "TimeoutError" && error.name !== "AbortError")) return error;
      if (onTimeout) {
        if (now() - resyncedAt > 2000) { resyncedAt = now(); onTimeout(); }
        return new Error("The room did not answer in time, so this window stopped waiting and read the room again. If what you asked for went through, it is already here.");
      }
      return new Error("The room did not answer in time, so this window stopped waiting. If what you asked for went through, it may already have completed.");
    }
    async function readJson(response, signal) {
      const reading = callerSignal(signal);
      try {
        const value = await transport.read(response, "json", reading);
        check(reading);
        return value;
      } catch (error) {
        check(reading);
        if (error?.name !== "SyntaxError") throw error;
        return {};
      }
    }
    async function post(path, body, options) {
      const signal = callerSignal(options?.signal);
      heldByShell();
      let response, data;
      try {
        response = await stallWatch(transport.request(path, { method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body || {}),
          deadlineMs: options?.deadline, signal }), signal);
        data = await readJson(response, signal);
        check(signal);
      } catch (error) { throw stoppedWaiting(error, signal); }
      if (!response.ok) throw Object.assign(new Error(data?.error || `HTTP ${response.status}`), { status: response.status });
      return data;
    }
    async function get(path, options) {
      const signal = callerSignal(options?.signal);
      heldByShell();
      let response, data;
      try {
        response = await transport.request(path, { deadlineMs: options?.deadline, signal });
        data = await readJson(response, signal);
        check(signal);
      } catch (error) { throw stoppedWaiting(error, signal); }
      if (!response.ok) throw Object.assign(new Error(data?.error || `HTTP ${response.status}`), {
        status: response.status, code: data?.code, data,
      });
      return data;
    }
    function dispose() {
      if (disposed) return;
      disposed = true; owner?.removeEventListener("abort", dispose);
      controller.abort(owner?.aborted ? owner.reason : undefined);
      for (const timer of [...timers]) clearTimer(timer);
    }
    if (owner?.aborted) dispose();
    else owner?.addEventListener("abort", dispose, { once: true });
    return Object.freeze({ get, post, readJson, dispose, signal: controller.signal });
  }
  Object.defineProperty(create, "disposable", { value: true });
  root.VIBEROOM_APP_REQUESTS = Object.freeze({ create });
})(globalThis);
