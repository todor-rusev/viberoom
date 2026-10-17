// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const GROUPS = [["everyday", "For everyday life"], ["work", "For work"], ["developers", "For developers"], ["creative", "For creative work"], ["business", "For business"]];
  function mark(c, size, UI = root.UI) {
    return UI.html("logo-tile", c.mark ? { icon: c.mark.url, brand: c.mark.hex, title: c.name, size } : { letter: c.name[0], title: c.name, size });
  }
  function status(c) {
    if (c.state === "connected") return { label: "connected", tone: "ready" };
    if (c.state === "signing-in") return { label: c.command ? "starting…" : c.keysIn === "headers" ? "connecting…" : "signing in…", tone: "thinking" };
    if (c.state === "reconnect") return { label: c.keysIn === "headers" ? "key refused" : "sign in again", tone: "attention" };
    if (c.state === "changed") return { label: "tools changed", tone: "attention" };
    return null;
  }
  function heroHtml(icon, scene) {
    return `<div class="page-hero cn-hero">
        <div class="cn-scene scene-art" role="img" aria-label="A vibemate plugs viberoom into a board of systems, takes in what they hold, and asks before it writes">${scene("connect-plug")}</div>
        <b class="page-hero-title">What are connections</b>
        <div class="hero-notes">
          <div class="hero-note is-what"><div class="hero-note-head">${icon("plug")}Your tools, in every room</div><p>Connect Jira, Notion, Linear and the others once, and your vibemates can look things up there in any room: an issue, a page, a task.</p><p>A room you would rather keep out has its own switch, under each connection.</p></div>
          <div class="hero-note is-how"><div class="hero-note-head">${icon("hand")}You stay in charge</div><p>You sign in at the system itself, in your browser; no vibemate ever sees your password or the access. Reading runs at once. <b>Before anything is written, you see the exact request and say yes</b>, here or on your phone.</p><p>Or just ask a vibemate: "connect Notion". The card comes to you.</p></div>
        </div>
      </div>`;
  }

  function roomsSummary(c, rooms) {
    const off = rooms.filter((room) => (c.offInRooms || []).includes(room.id)).length;
    const all = rooms.length === 1 ? "the one room" : `all ${rooms.length} rooms`;
    if (!off) return `On in ${all}`;
    if (off === rooms.length) return `Off in ${all}`;
    return `On in ${rooms.length - off} of ${rooms.length} rooms, off in ${off}`;
  }

  function create(page, ports) {
    const { UI, icon, scene, settingsCard, settingRow, geekTip, roomListFold, roomValueRow, configurationProblemHtml } = ports;
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: page.ownerDocument.defaultView });
    const displayCurrent = () => !owner.disposed && ports.isShown();
    const $ = (selector) => page.querySelector(selector);
    const byId = (id) => [...page.querySelectorAll("[id]")].find((node) => node.id === id) || null;
    const markOf = (c, size) => mark(c, size, UI);
    function render() {
      if (owner.disposed) return;
      const view = ports.view();
      const all = view.connections || [];
      const joined = all.filter((c) => c.state !== "not-connected");
      const rooms = view.rooms;
      const btn = (label, act, id, kind = "secondary") => UI.html("button", { label, kind, size: "sm", data: { cnAct: act, cnId: id } });
      const lead = (c) => UI.raw(markOf(c));
      const badge = (c) => { const s = status(c); return s ? UI.html("badge", { label: s.label, tone: s.tone, dot: c.state === "signing-in" }) : ""; };
      const toolsLine = (c) => {
        const tools = c.tools || [];
        const reads = tools.filter((t) => t.rule === "read").length;
        if (c.group === "own") return `${tools.length} tool${tools.length === 1 ? "" : "s"}, and every one asks you first`;
        return `${tools.length} tool${tools.length === 1 ? "" : "s"}: ${reads} read at once, ${tools.length - reads} write and ask you first`;
      };
      const about = (c) => c.group !== "own" ? c.blurb : c.command ? `Your own, on this computer: ${c.command}` : `Your own server at ${c.url}`;
      const leave = (c) => ((c.keys || []).length ? btn("Keys…", "keys", c.id, "ghost") : "") + (c.group === "own" ? btn("Remove", "remove", c.id, "ghost") : btn("Disconnect", "disconnect", c.id, "ghost"));
      const tile = (c) => {
        const s_ = status(c);
        const sub = c.state === "signing-in" ? (c.command ? "starting…" : c.keysIn === "headers" ? "connecting…" : "signing in…") : `${(c.tools || []).length} tool${(c.tools || []).length === 1 ? "" : "s"}${c.group === "own" ? (c.command ? " · on this computer" : " · your own") : ""}`;
        return `<button type="button" class="cn-tile" data-cn-act="open" data-cn-id="${esc(c.id)}">${markOf(c)}<span class="cn-tile-words"><b>${esc(c.name)}</b><span>${esc(sub)}</span></span>${s_ ? `<span class="cn-tile-state" data-tone="${s_.tone}">${esc(s_.label)}</span>` : ""}</button>`;
      };
      const groupWords = (c) => c.group === "own" ? "Your own" : (GROUPS.find(([g]) => g === c.group) || [null, c.group])[1];
      const detail = (c) => {
        const controls = c.state === "signing-in" ? btn("Cancel", "cancel", c.id, "ghost")
          : c.state === "reconnect" ? btn(c.keysIn === "headers" ? "Connect again" : "Sign in again", "connect", c.id, "primary") + leave(c)
          : leave(c);
        const head = `<div class="cn-detail-head">${markOf(c, "lg")}<div class="cn-detail-words"><h2>${esc(c.name)}</h2><div class="hint">${esc(about(c))}</div></div><div class="cn-detail-acts">${badge(c)}${controls}</div></div>`;
        const cards_ = [];
        const keyed = c.keysIn === "headers";
        cards_.push(settingsCard(`cn-status-${c.id}`, "", settingRow({
          label: c.state === "reconnect" ? (keyed ? "Key refused" : "Sign in again") : c.state === "signing-in" ? (c.command ? "Starting" : keyed ? "Connecting" : "Signing in") : "Connected",
          hint: c.state === "reconnect" ? (keyed ? `${c.name} no longer accepts its key. Nothing runs until you change it under Keys… and connect again.` : `${c.name} no longer accepts viberoom's access. Nothing runs until you sign in again.`)
            : c.state === "signing-in" ? (c.command ? "Starting it on this computer." : keyed ? "Connecting with its key." : "Finish the sign-in in your browser.")
            : `${c.connectedAt ? `Since ${new Date(c.connectedAt).toLocaleDateString()}` : "Connected"}${c.server ? `, as ${c.server}` : ""}.`,
          statusTone: c.state === "reconnect" ? "warn" : "plain",
        })));
        if (c.state === "changed") {
          cards_.push(settingsCard(`cn-changed-${c.id}`, "", settingRow({
            label: "What changed", stacked: true, statusTone: "warn",
            hint: `${c.name} changed its tools since you connected it. A tool's description is an instruction to the vibemates, so nothing runs until you look.`,
            status: UI.raw(`<ul class="cn-changes">${(c.changes || []).map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`),
            control: UI.raw(btn("Accept the change", "accept", c.id, "primary")),
          })));
        }
        const tools = c.tools || [];
        if (tools.length) {
          const list = `<div class="cn-tools">${tools.map((t) => `<div class="cn-tool"><span class="cn-tool-name">${esc(t.title || t.name)}${t.title ? ` <code>${esc(t.name)}</code>` : ""}</span>${UI.html("badge", { label: t.rule === "read" ? "reads at once" : "asks you first", tone: t.rule === "read" ? "ready" : "plain" })}</div>`).join("")}</div>`;
          cards_.push(settingsCard(`cn-tools-${c.id}`, "", settingRow({ label: "Tools", id: `cn-tools-row-${c.id}`, hint: toolsLine(c) + ".", status: UI.raw(UI.html("button", { label: `All ${tools.length}`, kind: "link", act: "setting-fold", hook: "room-values-open", title: "Every tool, and whether it asks you first" })), fold: UI.raw(list) })));
        }
        if ((c.state === "connected" || c.state === "reconnect") && rooms.length) {
          const list = roomListFold(roomsSummary(c, rooms), "Turn it off for a room, or on again", `data-cn-id="${esc(c.id)}"`,
            rooms.map((room) => roomValueRow(room, `cn-room-${c.id}-${room.id}`, UI.html("switch", { id: `cn-room-${c.id}-${room.id}`, checked: !(c.offInRooms || []).includes(room.id) }))).join(""));
          cards_.push(settingsCard(`cn-rooms-card-${c.id}`, "", settingRow({ label: "Rooms", id: `cn-rooms-${c.id}`, hint: "The rooms whose vibemates may use it.", ...list })));
        }
        const info = [
          settingRow({ label: c.command ? "Command" : "Address", hint: UI.raw(`<code>${esc(c.command || c.address || "")}</code>`) }),
          ...((c.keys || []).length ? [settingRow({ label: "Keys", hint: `${c.keys.join(", ")}${c.keysIn === "headers" ? " (headers of every request)" : ""}, in this computer's vault.`, control: UI.raw(btn("Change…", "keys", c.id)) })] : []),
          settingRow({ label: "Kind", hint: c.command ? "A program on this computer (MCP over stdio)" : c.group === "own" ? (c.keysIn === "headers" ? "A remote MCP server you added, with an API key" : "A remote MCP server you added") : `${groupWords(c)}, from viberoom's catalogue` }),
          settingRow({ label: "Access", hint: c.access === "sign-in" ? "Your sign-in, made in your browser; the access is in this computer's vault" : c.access === "keys" ? "The keys you typed, in this computer's vault" : "None needed: it answers without a sign-in" }),
        ];
        cards_.push(settingsCard(`cn-info-${c.id}`, "Information", info.join("")));
        return `<div class="cn-detail">${head}<div class="cn-cards">${cards_.join("")}</div></div>`;
      };
      const ownRows = all.filter((c) => c.group === "own" && c.state === "not-connected").map((c) => settingRow({
        label: c.name, lead: lead(c), hint: c.command || c.url, control: UI.raw(btn("Connect", "connect", c.id, "primary") + btn("Remove", "remove", c.id, "ghost")),
      }));
      const addKind = view.addKind === "local" ? "local" : "remote";
      ownRows.push(settingRow({
        label: "A server of your own", id: "cn-add-row",
        hint: "Any MCP server: a remote one by its address, or one that runs on this computer by its command. Or ask a vibemate: \"connect Figma\" finds it and brings you the card.",
        control: UI.raw(UI.html("button", { label: "Add a connection…", kind: "secondary", size: "sm", act: "setting-fold" })),
        fold: UI.raw(`<div class="cn-add">
            <div class="cn-add-kind" role="group" aria-label="Kind of server">${UI.html("choice", { label: "By its address", on: addKind === "remote", data: { cnKind: "remote" } })}${UI.html("choice", { label: "A command on this computer", on: addKind === "local", data: { cnKind: "local" } })}</div>
            <label>Name<input type="text" class="input" id="cn-add-name" maxlength="60" placeholder="what you call it" autocomplete="off"></label>
            ${addKind === "local" ? `
            <label>Command<input type="text" class="input mono" id="cn-add-command" maxlength="4000" placeholder="npx -y @modelcontextprotocol/server-github" spellcheck="false" autocomplete="off"></label>
            <label>Keys<input type="text" class="input mono" id="cn-add-env" maxlength="1100" placeholder="GITHUB_PERSONAL_ACCESS_TOKEN (names only; optional)" spellcheck="false" autocomplete="off"></label>
            <p class="hint">The command runs on this computer with your rights, the way its documentation gives it; nothing goes through a shell. Keys are the names of the variables it reads them from: you type their values on the next card, and they go into this computer's vault. Every one of its tools asks you before it runs, reading too.</p>` : `
            <label>Address<input type="url" class="input" id="cn-add-url" maxlength="2000" placeholder="https://mcp.example.com/mcp" spellcheck="false" autocomplete="off"></label>
            <label>Keys in headers<input type="text" class="input mono" id="cn-add-headers" maxlength="600" placeholder="Authorization or X-API-Key (names only; optional)" spellcheck="false" autocomplete="off"></label>
            <p class="hint">viberoom has not looked at a server you add, so add only one you trust. Every one of its tools asks you before it runs, reading too. If it asks for a sign-in, that opens in your browser. If it takes an API key instead, name the headers its documentation gives: you type their values on the next card, and they go into this computer's vault and with every request to this server.</p>`}
            <div class="cn-add-acts">${btn("Add and connect", "add", "", "primary")}</div>
          </div>`),
      }));
      const catalogue = settingsCard("cn-group-own", "Your own", ownRows.join("")) + GROUPS.map(([group, title]) => {
        const rows = all.filter((c) => c.group === group && c.state === "not-connected").map((c) => settingRow({
          label: c.name, lead: lead(c), hint: c.blurb, control: UI.raw(btn("Connect", "connect", c.id, "primary")),
        }));
        return rows.length ? settingsCard(`cn-group-${group}`, title, rows.join("")) : "";
      }).join("");
      const cards = (html) => `<div class="cn-cards">${html}</div>`;
      const open = [...page.querySelectorAll('[data-ui="setting"][id]')].filter((row) => row.querySelector(":scope > .fold:not([hidden])")).map((row) => row.id);
      const typed = [...page.querySelectorAll(".cn-add input[id]")].map((input) => [input.id, input.value]);
      const shown = view.detail && joined.find((c) => c.id === view.detail);
      if (!shown && view.detail) ports.setDetail(null);
      page.innerHTML = shown ? `
        <div class="page-head cn-back-head">${UI.html("button", { label: "Connections", icon: "back", kind: "ghost", data: { cnAct: "back" } })}</div>
        ${detail(shown)}` : `
        <div class="page-head"><div><h1>Connections</h1></div></div>
        ${configurationProblemHtml("connections-storage-problem", view.storageProblem)}
        ${heroHtml(icon, scene)}
        ${joined.length ? `<h2 class="cn-head">Connected</h2><div class="cn-tiles">${joined.map(tile).join("")}</div>` : ""}
        ${catalogue ? `<h2 class="cn-head">${joined.length ? "More systems" : "Connect a system"}</h2>${cards(catalogue)}` : ""}
        <p class="hint cn-about">${geekTip("viberoom signs in at the system with OAuth in your browser; the access lives in this computer's vault and no vibemate ever sees it. A server of your own on this computer is a program viberoom starts (MCP over stdio), with the keys you typed from the vault; it stops when unused. The vibemates reach every system through the room's own tools (tool_search, tool_call), so every call is one the room can see and stop.")}</p>`;
      for (const id of open) {
        const row = byId(id);
        const fold = row?.querySelector(":scope > .fold");
        if (!fold) continue;
        fold.hidden = false;
        row.querySelector(':scope [data-act="setting-fold"]')?.setAttribute("aria-expanded", "true");
      }
      for (const [id, value] of typed) { const input = byId(id); if (input) input.value = value; }
    }
      owner.on(page, "click", async (e) => {
        if (!ports.isShown()) return;
        const kind = e.target.closest("[data-cn-kind]");
        if (kind) {
          e.preventDefault();
          const name = $("#cn-add-name")?.value || "";
          ports.setAddKind(kind.dataset.cnKind);
          ports.rerender();
          const fold = $("#cn-add-row")?.querySelector(":scope > .fold");
          if (fold?.hidden) $("#cn-add-row").querySelector('[data-act="setting-fold"]')?.click();
          const field = $("#cn-add-name");
          if (field) field.value = name;
          return;
        }
        const b = e.target.closest("[data-cn-act]");
        if (!b) return;
        e.preventDefault();
        const { cnAct: act, cnId: id } = b.dataset;
        if (act === "open" || act === "back") {
          ports.setDetail(act === "open" ? id : null);
          if (act === "open") ports.setLast(id);
          ports.rerender();
          ports.scrollTop();
          if (e.detail === 0) (act === "open" ? page.querySelector('[data-cn-act="back"]') : [...page.querySelectorAll('[data-cn-act="open"]')].find((tile) => tile.dataset.cnId === (ports.view().last || "")))?.focus();
          return;
        }
        if (act === "disconnect" && !(await ports.confirm("viberoom asks the system to revoke its access and forgets it on this computer. The vibemates lose these tools in every room.", { title: "Disconnect?", okLabel: "Disconnect", danger: true }))) return;
        if (act === "remove" && !(await ports.confirm("viberoom disconnects it, asking it to revoke any access it gave, and forgets its address. The vibemates lose its tools in every room.", { title: "Remove this server?", okLabel: "Remove", danger: true }))) return;
        if (!displayCurrent()) return;
        try {
          const res = act !== "add" ? await ports.requests.act(id, act)
            : ports.view().addKind === "local"
              ? await ports.requests.addOwn({ name: $("#cn-add-name").value, command: $("#cn-add-command").value, env: $("#cn-add-env").value })
              : await ports.requests.addOwn({ name: $("#cn-add-name").value, url: $("#cn-add-url").value, headers: $("#cn-add-headers").value });
          if (res.connections) { ports.setConnections(res.connections); if (displayCurrent()) ports.rerender(); }
          if (displayCurrent() && (act === "disconnect" || act === "remove") && res.revoked === false) ports.toast("Disconnected here. The system did not confirm the revocation; you can remove viberoom's access in its own settings.", "info");
        } catch (error) { if (displayCurrent()) ports.showError(error); }
      });
      owner.on(page, "change", async (e) => {
        if (!ports.isShown()) return;
        const list = e.target.closest(".room-values[data-cn-id]");
        const roomId = e.target.closest(".room-value")?.dataset.room;
        if (!list || !roomId || e.target.type !== "checkbox") return;
        try {
          const res = await ports.requests.room(list.dataset.cnId, { room: roomId, on: e.target.checked });
          const connections = res.connections || ports.view().connections;
          ports.setConnections(connections);
          if (!displayCurrent()) return;
          const c = connections.find((one) => one.id === list.dataset.cnId);
          const opener = list.closest('[data-ui="setting"]')?.querySelector(".room-values-open .label");
          if (c && opener) opener.textContent = roomsSummary(c, ports.view().rooms);
        } catch (error) { if (displayCurrent()) { ports.showError(error); ports.rerender(); } }
      });
    return Object.freeze({ render, dispose: () => owner.dispose() });
  }
  Object.defineProperty(create, "disposable", { value: true });
  root.VIBEROOM_CONNECTIONS_PAGE = Object.freeze({ create, mark, status, hero: heroHtml, roomsSummary, groups: GROUPS });
})(typeof window !== "undefined" ? window : globalThis);
