// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(() => {
  "use strict";
  const DATA = window.DEMO_DATA;
  if (!DATA) return;
  const state = DATA.state;
  const files = DATA.files || {};
  const images = DATA.images || {};
  const READ_ONLY = "This is a recorded conversation, not a live hub: nobody is listening here. Run viberoom to talk to real vibemates.";
  if (window.DEMO_LOOK) state.settings.appearance = { ...state.settings.appearance, look: window.DEMO_LOOK };
  window.DEMO_QUERY = state.openRooms && state.openRooms.length ? `?room=${encodeURIComponent(state.openRooms[0])}` : "";

  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fail = (message, status = 400) => json({ error: message }, status);
  const sockets = new Set();
  const emit = (message) => { for (const s of sockets) if (s.onmessage) s.onmessage({ data: JSON.stringify(message) }); };

  const WINDOW_MAX_LINES = 400;
  const normalise = (p) => String(p || "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  const resolveInRoom = (roomId, asked) => {
    const text = String(asked || "").trim();
    if (!text) return null;
    if (/^[a-z]:[\\/]/i.test(text) || text.startsWith("/") || text.startsWith("~") || /^[a-z][a-z0-9+.-]*:/i.test(text)) return files[normalise(text)] ? text : null;
    const room = (state.rooms || []).find((r) => r.id === roomId);
    if (!room || !room.dir) return null;
    const full = `${room.dir.replace(/[\\/]+$/, "")}\\${text.replace(/^[.][\\/]/, "").replace(/\//g, "\\")}`;
    return files[normalise(full)] ? full : null;
  };
  const sliceLines = (text, from, to) => {
    const all = text.split(/\r?\n/);
    if (all.length && all[all.length - 1] === "") all.pop();
    const lines = all.length;
    const start = Math.max(1, Math.min(Math.floor(from ?? 1) || 1, Math.max(1, lines)));
    const wanted = Math.floor(to ?? start + WINDOW_MAX_LINES - 1) || start;
    const end = Math.max(start, Math.min(wanted, lines, start + WINDOW_MAX_LINES - 1));
    return { text: all.slice(start - 1, end).join("\n"), from: start, to: end, lines };
  };
  const parseCsv = (text) => {
    const first = text.split(/\r?\n/, 1)[0] || "";
    let delimiter = ",";
    let best = -1;
    for (const d of [",", ";", "\t"]) { const n = first.split(d).length - 1; if (n > best) { best = n; delimiter = d; } }
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c !== ""));
  };
  const fileAnswer = (roomId, params) => {
    const asked = params.get("path") || "";
    const target = resolveInRoom(params.get("room"), asked);
    if (!target) return fail(`no such file: ${asked}`, 404);
    const entry = files[normalise(target)];
    const num = (name) => { const raw = params.get(name); if (raw === null || raw === "") return undefined; const v = Number(raw); return Number.isFinite(v) ? Math.max(1, Math.floor(v)) : undefined; };
    const from = num("from");
    const to = num("to");
    if (entry.kind === "csv") return json({ ok: true, kind: "csv", path: target, rows: parseCsv(entry.text) });
    if (entry.kind === "markdown" && from === undefined) return json({ ok: true, kind: "markdown", path: target, text: entry.text, lines: entry.text.split(/\r?\n/).length });
    return json({ ok: true, kind: entry.kind, path: target, language: entry.language, ...sliceLines(entry.text, from, to), bytes: entry.text.length });
  };

  const route = (method, path, params, body) => {
    const room = (id) => (state.rooms || []).find((r) => r.id === decodeURIComponent(id));
    if (method === "GET") {
      if (path === "/api/state") return json(state);
      if (path === "/api/version") return json(state.version || {});
      if (path === "/api/settings") return json(state.settings);
      if (path === "/api/skills") return json({ skills: state.skills || [] });
      if (path === "/api/templates") return json({ templates: [] });
      if (path === "/api/looks") return json({ looks: state.looks || [] });
      if (path === "/api/update") return json(state.update || {});
      if (path === "/api/resolve") {
        const target = resolveInRoom(params.get("room"), params.get("path") || "");
        return target ? json({ ok: true, path: target, kind: "file" }) : fail("not a file of this room's folder", 404);
      }
      if (path === "/api/file") return fileAnswer(params.get("room"), params);
      const one = path.match(/^\/api\/rooms\/([^/]+)$/);
      if (one) { const r = room(one[1]); return r ? json(r) : fail("no such room", 404); }
      if (path === "/api/rooms") return json(state.rooms || []);
      if (path.startsWith("/api/fs/dirs")) return json({ path: "", dirs: [] });
      if (path.startsWith("/api/recipes/")) return fail(READ_ONLY);
      return fail("not part of the recorded demo", 404);
    }
    if (path === "/api/settings") {
      const patch = body || {};
      const next = { ...state.settings };
      if (patch.appearance && typeof patch.appearance === "object") {
        const a = { ...next.appearance, ...patch.appearance };
        if (patch.appearance.custom) {
          a.custom = { ...(next.appearance.custom || {}) };
          for (const [lookId, values] of Object.entries(patch.appearance.custom)) { if (values === null) delete a.custom[lookId]; else a.custom[lookId] = { ...(a.custom[lookId] || {}), ...values }; }
        }
        next.appearance = a;
      }
      for (const key of ["diagrams", "humanName", "humanDescription", "humanAvatar", "checkForUpdates", "reconnectMode"]) if (patch[key] !== undefined) next[key] = patch[key];
      state.settings = next;
      setTimeout(() => emit({ type: "settings", settings: next }), 0);
      return json({ ok: true, settings: next });
    }
    if (path === "/api/window") return json({ ok: true });
    if (/^\/api\/rooms\/[^/]+\/(open|typing)$/.test(path)) return json({ ok: true });
    if (/^\/api\/rooms\/[^/]+\/send$/.test(path)) return fail(READ_ONLY);
    if (path === "/api/open") return fail("In the demo a file cannot open on your machine; it is shown here when the room can draw it.");
    return fail(READ_ONLY);
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    if (!url.startsWith("/api/")) return realFetch(input, init);
    const q = url.indexOf("?");
    const path = q >= 0 ? url.slice(0, q) : url;
    const params = new URLSearchParams(q >= 0 ? url.slice(q + 1) : "");
    const method = (init && init.method ? init.method : "GET").toUpperCase();
    let body = null;
    if (init && typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = null; } }
    try {
      return Promise.resolve(route(method, path, params, body));
    } catch (error) {
      return Promise.resolve(fail(error && error.message ? error.message : String(error), 500));
    }
  };

  class DemoSocket {
    constructor() {
      sockets.add(this);
      this.readyState = 1;
      setTimeout(() => {
        if (this.onopen) this.onopen({});
        if (this.onmessage) this.onmessage({ data: JSON.stringify({ type: "snapshot", snapshot: state }) });
      }, 0);
    }
    send() {}
    close() { sockets.delete(this); this.readyState = 3; if (this.onclose) this.onclose({}); }
    addEventListener() {}
    removeEventListener() {}
  }
  window.WebSocket = DemoSocket;

  window.DEMO = {
    imageUrl(path, roomId) {
      const direct = images[normalise(path)];
      if (direct) return direct;
      const room = (state.rooms || []).find((r) => r.id === roomId);
      if (room && room.dir) {
        const full = `${room.dir.replace(/[\\/]+$/, "")}\\${String(path).replace(/^[.][\\/]/, "").replace(/\//g, "\\")}`;
        if (images[normalise(full)]) return images[normalise(full)];
      }
      return null;
    },
  };
})();
