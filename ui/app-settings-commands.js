// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create({ window: view = root, requests, signal: owner } = {}) {
    if (typeof requests?.get !== "function" || typeof requests?.post !== "function") throw new TypeError("Application requests are required");
    const controller = new view.AbortController();
    let disposed = false;

    function capture(value) {
      const text = JSON.stringify(value ?? {});
      if (typeof text !== "string") throw new TypeError("A JSON value is required");
      const copy = JSON.parse(text);
      function freeze(part) {
        if (part && typeof part === "object") { Object.values(part).forEach(freeze); Object.freeze(part); }
      }
      freeze(copy);
      return copy;
    }
    async function write(path, value) {
      controller.signal.throwIfAborted();
      return requests.post(path, capture(value), { signal: controller.signal });
    }
    async function read(path, options) {
      controller.signal.throwIfAborted();
      options?.signal?.throwIfAborted();
      const signal = view.AbortSignal.any([controller.signal, ...(options?.signal ? [options.signal] : [])]);
      return requests.get(path, { signal, deadline: options?.deadline });
    }
    async function memoryDeliveries(filters, options) {
      controller.signal.throwIfAborted();
      const query = new view.URLSearchParams();
      for (const key of ["provider", "after", "cleanupAfter", "versionAfter", "bindingAfter"]) {
        if (filters?.[key] !== undefined && filters[key] !== null && filters[key] !== "") query.set(key, String(filters[key]));
      }
      return read(`/api/memory-deliveries?${query}`, options);
    }
    const commands = Object.freeze({
      saveSettings: patch => write("/api/settings", patch),
      eraseProfile: confirm => write("/api/profile/erase", { confirm }),
      checkLook: spec => write("/api/looks/check", { spec }),
      saveLook: (spec, replace) => write("/api/looks", { spec, replace: !!replace }),
      removeLook: id => write("/api/looks/remove", { id }),
      restart: choice => write("/api/restart", choice),
      setAutostart: enabled => write("/api/autostart", { enabled }),
      narrowDataFolder: () => write("/api/data-folder/narrow", {}),
      saveConsent: choice => write("/api/consent", choice),
      saveVoice: patch => write("/api/voice", patch),
      saveMemoryProvider: patch => write("/api/memory-provider", patch),
      memoryDeliveryAction: action => write("/api/memory-deliveries", action),
      cancelPairLink: () => write("/api/channels/pair-link/cancel", {}),
      makePairLink: () => write("/api/channels/pair-link", {}),
      openTelegramBotfather: () => write("/api/open", { target: "https://t.me/BotFather" }),
      saveTelegram: patch => write("/api/channels/telegram", patch),
      requestTelegramToken: () => write("/api/secrets", { purpose: "telegram-token" }),
      answerTelegramToken: (id, value) => write(`/api/secrets/${encodeURIComponent(id)}`, { value }),
      closeTelegramToken: id => write(`/api/secrets/${encodeURIComponent(id)}/close`, {}),
      unpairTelegram: (senderId, stopTurns) => write("/api/channels/unpair", { senderId, stopTurns: !!stopTurns }),
      clearDiagnosticLogs: () => write("/api/diagnostic-logs/clear", { confirm: true }),
    });
    const queries = Object.freeze({
      checkUpdates: options => read("/api/update?check=1", options),
      voice: options => read("/api/voice", options),
      memoryProvider: options => read("/api/memory-provider", options),
      memoryDeliveries,
      diagnosticRequests: options => read("/api/diagnostic-requests", options),
      diagnosticLogs: options => read("/api/diagnostic-logs", options),
    });
    function dispose() {
      if (disposed) return;
      disposed = true; owner?.removeEventListener("abort", dispose);
      controller.abort(owner?.aborted ? owner.reason : undefined);
    }
    if (owner?.aborted) dispose();
    else owner?.addEventListener("abort", dispose, { once: true });
    return Object.freeze({ commands, queries, dispose, signal: controller.signal });
  }
  Object.defineProperty(create, "disposable", { value: true });
  root.VIBEROOM_SETTINGS_COMMANDS = Object.freeze({ create });
})(globalThis);
