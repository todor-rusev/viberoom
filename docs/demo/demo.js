// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(() => {
  "use strict";
  const DATA = window.DEMO_DATA;
  if (!DATA) return;
  const state = DATA.state;
  const files = DATA.files || {};
  const images = DATA.images || {};
  const READ_ONLY = "This is a recorded conversation, not a live hub: nobody is listening here. Run viberoom to talk to real vibemates.";
  const RECORDING = (what) => `${what} on a live hub; this page is a recording of one conversation.`;
  if (window.DEMO_LOOK) state.settings.appearance = { ...state.settings.appearance, look: window.DEMO_LOOK };
  window.DEMO_QUERY = state.openRooms && state.openRooms.length ? `?room=${encodeURIComponent(state.openRooms[0])}` : "";

  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const plain = (body, type) => new Response(body, { status: 200, headers: { "content-type": type } });
  const fail = (message, status = 400) => json({ error: message }, status);
  const sockets = new Set();
  const emit = (message) => { for (const s of sockets) if (s.onmessage) s.onmessage({ data: JSON.stringify(message) }); };
  const changed = () => setTimeout(() => emit({ type: "snapshot", snapshot: state }), 0);
  const roomOf = (id) => (state.rooms || []).find((r) => r.id === decodeURIComponent(id));
  const agentsOf = (room) => (room.participants || []).filter((p) => p.kind === "agent" && p.status !== "left").map((p) => ({ id: p.id, name: p.name, status: p.status, muted: !!p.muted }));

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

  const memoryView = () => ({
    limits: { notes: 8, noteChars: 240, scopeChars: 1600, revisions: 20 },
    rule: "Shared memory is written by the vibemates of a live room and reviewed by you. This recording carries none.",
    user: { revision: 0, enabled: true, notes: [] }, room: { revision: 0, enabled: true, notes: [] },
    warnings: { user: [], room: [] }, revisions: { user: [], room: [] },
  });
  const updatesView = () => ({ instance: "demo", revision: 1, checking: false, enabled: false, checkedAt: null, nextCheckAt: null, snoozeUntil: 0, updates: [], notification: null, batch: null });
  const automationsView = (room) => ({ available: true, error: "", participants: agentsOf(room), jobs: [], runs: [], proposals: [] });
  const search = (params) => {
    const q = String(params.get("q") || "").trim().toLowerCase();
    const scope = params.get("rooms") || "all";
    const limit = Math.max(1, Math.min(200, Number(params.get("limit")) || 40));
    const hits = [];
    if (q) for (const room of state.rooms || []) {
      if (scope !== "all" && room.id !== scope) continue;
      for (const m of room.messages || []) {
        if (m.kind !== "chat" || !m.text) continue;
        const at = m.text.toLowerCase().indexOf(q);
        if (at < 0) continue;
        const start = Math.max(0, at - 60);
        const end = Math.min(m.text.length, at + q.length + 80);
        hits.push({ roomId: room.id, roomName: room.name, seq: m.seq, from: m.from, fromName: m.fromName, ts: m.ts, deleted: false, snippet: `${start ? "…" : ""}${m.text.slice(start, end).replace(/\s+/g, " ")}${end < m.text.length ? "…" : ""}` });
      }
    }
    hits.sort((a, b) => b.ts - a.ts);
    return json({ hits: hits.slice(0, limit), stale: false, usedTrigram: false });
  };
  const exportMarkdown = (room) => {
    const lines = [`# ${room.name}`, ""];
    for (const m of room.messages || []) {
      if (m.kind !== "chat") continue;
      lines.push(`**${m.fromName || m.from}** · ${new Date(m.ts).toISOString()}`, "", m.text || "", "");
    }
    return plain(lines.join("\n"), "text/markdown; charset=utf-8");
  };

  const route = (method, path, params, body) => {
    const roomPath = path.match(/^\/api\/rooms\/([^/]+)(\/.*)?$/);
    const room = roomPath ? roomOf(roomPath[1]) : null;
    const rest = roomPath ? roomPath[2] || "" : "";
    if (roomPath && !room) return fail("no such room", 404);
    if (method === "GET") {
      if (path === "/api/state") return json(state);
      if (path === "/api/version") return json(state.version || {});
      if (path === "/api/settings") return json(state.settings);
      if (path === "/api/skills") return json({ skills: state.skills || [] });
      const skill = path.match(/^\/api\/skills\/([^/]+)$/);
      if (skill) { const found = (state.skills || []).find((s) => s.name === decodeURIComponent(skill[1])); return found ? json({ skill: found }) : fail("no such skill", 404); }
      if (path === "/api/templates") return json({ templates: [] });
      if (path === "/api/looks") return json({ looks: state.looks || [] });
      if (path === "/api/update") return json(state.update || {});
      if (path === "/api/memory") return json(memoryView());
      if (path === "/api/channels") return json(state.channels);
      if (path === "/api/search") return search(params);
      if (path === "/api/diagnostic-logs") return json({ bytes: 0, files: 0, skipped: 0, unavailable: "A recording keeps no diagnostic details; a live hub writes them to its data folder." });
      if (path === "/api/diagnostic-requests") return json({ recording: true, note: "This page is a recorded conversation; there were no diagnostic requests." });
      if (path === "/api/resolve") {
        const target = resolveInRoom(params.get("room"), params.get("path") || "");
        return target ? json({ ok: true, path: target, kind: "file" }) : fail("not a file of this room's folder", 404);
      }
      if (path === "/api/file") return fileAnswer(params.get("room"), params);
      if (path === "/api/rooms") return json(state.rooms || []);
      if (path.startsWith("/api/fs/dirs")) return json({ path: "", dirs: [] });
      if (path.startsWith("/api/recipes/")) return fail(READ_ONLY);
      if (room) {
        if (rest === "") return json(room);
        if (rest === "/automations") return json(automationsView(room));
        if (rest === "/export") return exportMarkdown(room);
        const tool = rest.match(/^\/messages\/([^/]+)\/tools\/([^/]+)$/);
        if (tool) {
          const message = (room.messages || []).find((m) => m.id === decodeURIComponent(tool[1]));
          const call = message && (message.toolCalls || []).find((c) => c.toolCallId === decodeURIComponent(tool[2]));
          return call ? json(call) : fail("This tool call is no longer available.", 404);
        }
        if (rest.startsWith("/history")) return fail("The whole recording is on this page already; there is no older history to load.", 404);
        if (/^\/messages\/[^/]+\/edit-preview$/.test(rest)) return fail(RECORDING("Messages are edited"));
      }
      return fail("not part of the recorded demo", 404);
    }
    if (path === "/api/settings") {
      const patch = body || {};
      const next = { ...state.settings };
      for (const [key, value] of Object.entries(patch)) {
        if (key === "appearance" && value && typeof value === "object") {
          const a = { ...next.appearance, ...value };
          if (value.custom) {
            a.custom = { ...(next.appearance.custom || {}) };
            for (const [lookId, values] of Object.entries(value.custom)) { if (values === null) delete a.custom[lookId]; else a.custom[lookId] = { ...(a.custom[lookId] || {}), ...values }; }
          }
          next.appearance = a;
        } else if (key === "roomDefaults" && value && typeof value === "object") next.roomDefaults = { ...(next.roomDefaults || {}), ...value };
        else next[key] = value;
      }
      state.settings = next;
      changed();
      return json({ ok: true, settings: next });
    }
    if (path === "/api/window" || path === "/api/window/finding") return json({ ok: true });
    if (path === "/api/recipes/check") return json({ ok: true });
    if (path === "/api/agents/updates/check") return json({ updates: updatesView() });
    if (path.startsWith("/api/agents/updates/")) return fail(RECORDING("Agents are updated"));
    if (path === "/api/memory") return fail(RECORDING("Shared memory is edited"));
    if (path.startsWith("/api/carry")) return fail(RECORDING("Conversations are carried between machines"));
    if (path.startsWith("/api/channels") || path.startsWith("/api/secrets") || path === "/api/qr") return fail(RECORDING("A phone is paired"));
    if (path.startsWith("/api/restart") || path === "/api/autostart" || path === "/api/data-folder/narrow" || path === "/api/update/install" || path === "/api/profile/erase") return fail(RECORDING("viberoom itself is managed"));
    if (path.startsWith("/api/looks")) return fail(RECORDING("Looks are imported and kept"));
    if (path.startsWith("/api/skills")) return fail(RECORDING("Skills are written"));
    if (path === "/api/fs/mkdir" || path === "/api/rooms" || path === "/api/rooms/from-template") return fail(RECORDING("Rooms and folders are made"));
    if (path === "/api/open") return fail("In the demo a file cannot open on your machine; it is shown here when the room can draw it.");
    if (room) {
      if (rest === "/open" || rest === "/typing") return json({ ok: true });
      const pin = rest.match(/^\/messages\/([^/]+)\/pin$/);
      if (pin) {
        const message = (room.messages || []).find((m) => m.id === decodeURIComponent(pin[1]));
        if (!message) return fail("no such message", 404);
        message.pinned = body && typeof body.pinned === "boolean" ? body.pinned : !message.pinned;
        changed();
        return json({ ok: true, pinned: message.pinned });
      }
      if (rest.startsWith("/automations/")) return fail(RECORDING("Automations are scheduled and run"));
      if (rest === "/send" || rest === "/invite" || rest === "/save-template" || /^\/participants\//.test(rest) || /^\/messages\/[^/]+\/edit$/.test(rest)) return fail(READ_ONLY);
    }
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
