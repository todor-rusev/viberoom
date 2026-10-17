// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create() {
    let disposed = false;
    let current = Object.freeze({ recipes: Object.freeze([]), skills: Object.freeze([]), voice: null });
    const read = () => current;
    const own = value => value === undefined ? undefined : root.VIBEROOM_OWNED_JSON.copy(value, "Service facts");
    function accept(field, value) {
      if (disposed) return;
      const copied = own(value);
      current = Object.freeze({ ...current, [field]: copied });
    }
    function acceptConnections(value, storageProblem = current.connectionStorageProblem) {
      if (disposed) return;
      const connections = own(value), connectionStorageProblem = own(storageProblem);
      current = Object.freeze({ ...current, connections, connectionStorageProblem });
    }
    function acceptFeatures(voice, memoryProvider) {
      if (disposed) return;
      const nextVoice = own(voice), nextMemory = own(memoryProvider);
      current = Object.freeze({ ...current, voice: nextVoice, memoryProvider: nextMemory });
    }
    function dispose() { disposed = true; }
    return Object.freeze({
      reader: Object.freeze({ read }),
      acceptRecipes: value => accept("recipes", value),
      acceptSkills: value => accept("skills", value),
      acceptChannels: value => accept("channels", value),
      acceptVoice: value => accept("voice", value),
      acceptMemoryProvider: value => accept("memoryProvider", value),
      acceptConnections, acceptFeatures, dispose,
    });
  }
  Object.defineProperty(create, "disposable", { value: true });
  root.VIBEROOM_SERVICE_FACTS_MODEL = Object.freeze({ create });
})(globalThis);
