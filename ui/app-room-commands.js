// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create({ post } = {}) {
    if (typeof post !== "function") throw new TypeError("Application writes are required");
    const capture = value => JSON.parse(JSON.stringify(value ?? {}));
    function forRoom({ id, uuid } = {}) {
      if (typeof id !== "string" || !id) throw new TypeError("A room address is required");
      const base = `/api/rooms/${encodeURIComponent(id)}`;
      const meant = typeof uuid === "string" && uuid ? `?room=${encodeURIComponent(uuid)}` : "";
      async function write(action, value) {
        const body = capture(value);
        return post(`${base}/${action}${meant}`, body);
      }
      return Object.freeze({
        editMessage: (id, value) => write(`messages/${encodeURIComponent(id)}/edit`, value),
        pinMessage: (id, pinned) => write(`messages/${encodeURIComponent(id)}/pin`, { pinned }),
        labelPin: (id, label) => write(`messages/${encodeURIComponent(id)}/pin-label`, { label }),
        adoptCopy: () => write("recovery"),
        invite: value => write("invite", value),
        close: () => write("delete"),
        rename: name => write("rename", { name }),
        changeDirectory: (dir, restart) => write("dir", { dir, ...(restart ? { restart } : {}) }),
        restartInFolder: () => write("restart-in-folder"),
        saveSettings: patch => write("settings", patch),
        previewTemplate: () => write("template-preview"),
        saveTemplate: value => write("save-template", value),
        participant(id) {
          if (typeof id !== "string" || !id) throw new TypeError("A participant address is required");
          const prefix = `participants/${encodeURIComponent(id)}`;
          return Object.freeze({
            savePersona: patch => write(`${prefix}/persona`, patch),
            setConfig: (configId, value) => write(`${prefix}/config`, { configId, value }),
            staff: value => write(`${prefix}/staff`, value),
            reconnect: value => write(`${prefix}/reconnect`, value),
            restartInstalled: () => write(`${prefix}/restart-installed`),
          });
        },
      });
    }
    return Object.freeze({ forRoom, createRoom: value => post("/api/rooms", capture(value)),
      createFromTemplate: value => post("/api/rooms/from-template", capture(value)) });
  }
  Object.defineProperty(create, "meantRecovery", { value: true });
  root.VIBEROOM_ROOM_COMMANDS = Object.freeze({ create });
})(typeof window !== "undefined" ? window : globalThis);
