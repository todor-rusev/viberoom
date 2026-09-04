// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(() => {
  "use strict";

  const state = {
    settings: null,
    recipes: [],
    roomDefaults: null,
    skills: [],
    version: null,
    rooms: new Map(),
    currentRoomId: null,
    view: "home",
    selection: { kind: "room" },
    detailsOpen: false,
    unread: new Map(),
    search: "",
    roomSearch: "",
    expanded: new Set(),
    skillEditor: null,
    skillsRoom: null,
  };

  const $ = (selector) => document.querySelector(selector);
  const els = {
    app: $("#app"),
    fileDialog: $("#file-dialog"),
    fvTitle: $("#fv-title"),
    fvPath: $("#fv-path"),
    fvBody: $("#fv-body"),
    fvOpen: $("#fv-open"),
    rail: $("#rail"),
    railRoom: $("#rail-room"),
    railRoomLabel: $("#rail-room-label"),
    railUnread: $("#rail-unread"),
    railMe: $("#rail-me"),
    railMeAvatar: $("#rail-me-avatar"),
    railMeLabel: $("#rail-me-label"),
    railToggle: $("#rail-toggle"),
    conn: $("#conn"),
    sideRooms: $("#side-rooms"),
    sideRoom: $("#side-room"),
    roomSearch: $("#room-search"),
    roomList: $("#room-list"),
    backToRooms: $("#back-to-rooms"),
    sideRoomName: $("#side-room-name"),
    sideRoomSub: $("#side-room-sub"),
    roomSettingsBtn: $("#room-settings-btn"),
    inviteBtn: $("#invite-btn"),
    participants: $("#participants"),
    reconnectAllBtn: $("#reconnect-all-btn"),
    focusBtn: $("#focus-btn"),
    homeView: $("#home-view"),
    roomsView: $("#rooms-view"),
    roomsGrid: $("#rooms-grid"),
    roomsSub: $("#rooms-sub"),
    chatView: $("#chat-view"),
    chatRoomName: $("#chat-room-name"),
    chatRoomSub: $("#chat-room-sub"),
    chatInfoBtn: $("#chat-info-btn"),
    search: $("#search"),
    messages: $("#messages"),
    mentionMenu: $("#mention-menu"),
    emojiMenu: $("#emoji-menu"),
    emojiBtn: $("#emoji-btn"),
    sideRoomEmoji: $("#side-room-emoji"),
    composer: $("#composer"),
    input: $("#input"),
    pageView: $("#page-view"),
    pageInner: $("#page-inner"),
    details: $("#details"),
    detailsInner: $("#details-inner"),
    detailsResizer: $("#details-resizer"),
    toasts: $("#toasts"),
    pfDialog: $("#profile-dialog"),
    pfForm: $("#profile-form"),
    pfName: $("#pf-name"),
    pfAvatar: $("#pf-avatar"),
    pfAvatarPicker: $("#pf-avatar-picker"),
    pfDesc: $("#pf-desc"),
    pfError: $("#pf-error"),
    roomDialog: $("#room-dialog"),
    roomForm: $("#room-form"),
    roomName: $("#room-name"),
    roomDir: $("#room-dir"),
    roomError: $("#room-error"),
    dialog: $("#invite-dialog"),
    invForm: $("#invite-form"),
    invType: $("#inv-type"),
    invNote: $("#inv-note"),
    invWhere: $("#inv-where"),
    invStatus: $("#inv-status"),
    invName: $("#inv-name"),
    invAvatar: $("#inv-avatar"),
    invAvatarPicker: $("#inv-avatar-picker"),
    invTagline: $("#inv-tagline"),
    invRole: $("#inv-role"),
    invDelay: $("#inv-delay"),
    invSkills: $("#inv-skills"),
    invGeek: $("#inv-geek"),
    invAgents: $("#inv-agents"),
    invNone: $("#inv-none"),
    invOptions: $("#inv-options"),
    sideRoomsTitle: $("#side-rooms-title"),
    sideToggle: $("#side-toggle"),
    invModel: $("#inv-model"),
    invModelCustom: $("#inv-model-custom"),
    invEffort: $("#inv-effort"),
    invMode: $("#inv-mode"),
    invError: $("#inv-error"),
    invRefresh: $("#inv-refresh"),
    invSubmit: $("#inv-submit"),
    rcDialog: $("#reconnect-dialog"),
    rcForm: $("#reconnect-form"),
    rcIntro: $("#rc-intro"),
    rcReplay: $("#rc-replay"),
    rcTable: $("#rc-table"),
    rcError: $("#rc-error"),
    rcSubmit: $("#rc-submit"),
    eraseDialog: $("#erase-dialog"),
    eraseForm: $("#erase-form"),
    eraseWord: $("#erase-word"),
    eraseError: $("#erase-error"),
    eraseSubmit: $("#erase-submit"),
  };

  const STATUS_LABEL = { starting: "starting…", idle: "ready", queued: "waiting…", thinking: "thinking…", error: "error", offline: "offline", left: "left" };
  const CHAT_EMOJI = ["😀", "😄", "😂", "🙂", "😉", "😍", "🤔", "😎", "🥳", "😅", "😢", "😡", "👍", "👎", "👋", "🙏", "👏", "💪", "🔥", "✨", "🎉", "❤️", "💜", "✅", "❌", "⚠️", "💡", "🚀", "🐛", "🤖", "🤫", "☕"];
  const ROOM_EMOJI = ["🎭", "🚀", "🧪", "🛠️", "🎨", "📚", "🧠", "💬", "🔬", "🎯", "🐙", "☕", "🌈", "🏗️", "🎮", "🔥", "🧩", "📈", "🗺️", "🎧", "🌱", "🏠", "🛸", "🧭"];
  function emojiGrid(list, current, onPick) {
    const wrap = document.createElement("div");
    wrap.className = "avatar-picker";
    const render = (value) => {
      wrap.innerHTML = "";
      if (current !== null && current !== undefined) {
        const none = document.createElement("button");
        none.type = "button";
        none.className = "none" + (!value ? " selected" : "");
        none.textContent = "—";
        none.title = "No emoji";
        none.addEventListener("click", () => {
          onPick("");
          render("");
        });
        wrap.appendChild(none);
      }
      for (const e of list) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = e;
        b.className = e === value ? "selected" : "";
        b.addEventListener("click", () => {
          onPick(e);
          render(e);
        });
        wrap.appendChild(b);
      }
    };
    render(current || "");
    return wrap;
  }
  const CLAMP_CHARS = 700;

  window.Icons.install();
  const ic = (name, cls) => window.Icons.svg(name, cls);
  document.querySelectorAll("[data-icon]").forEach((el) => (el.innerHTML = ic(el.dataset.icon)));


  let stallNoticeAt = 0;
  function stallWatch(promise) {
    const timer = setTimeout(() => {
      if (Date.now() - stallNoticeAt > 30000) {
        stallNoticeAt = Date.now();
        toast("Still waiting for the hub… If several viberoom tabs are open, close the others: the browser allows only 6 connections to the hub and each tab keeps one.", "warn");
      }
    }, 8000);
    return promise.finally(() => clearTimeout(timer));
  }
  async function post(path, body) {
    const res = await stallWatch(fetch(path, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body || {}) }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  async function get(path) {
    const res = await fetch(path);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  const roomApi = (suffix) => `/api/rooms/${encodeURIComponent(state.currentRoomId)}${suffix}`;


  function esc(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function editingInDetails() {
    const el = document.activeElement;
    return !!el && !!el.closest && (!!el.closest("#details") || !!el.closest("#page-view")) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  }
  function currentRoom() {
    return state.rooms.get(state.currentRoomId) || null;
  }
  function findByName(room, name) {
    const lower = name.toLowerCase();
    return (room ? room.participants : []).find((p) => p.name.toLowerCase() === lower) || null;
  }
  function findById(room, id) {
    return (room ? room.participants : []).find((p) => p.id === id) || null;
  }
  const OPEN_RE = /(?:https?:\/\/|mailto:)[^\s<>"'`]+|(?<![\w:\/.])((?:[A-Za-z]:[\\/]|~[\\/])[^\s<>"'`*?|&]+|\/(?:[\w.@-]+\/)+[\w.@-][^\s<>"'`*?|&]*)/g;
  function linkify(html) {
    return html.replace(OPEN_RE, (m) => {
      const trail = (m.match(/[.,;:!?)\]]+$/) || [""])[0];
      const target = m.slice(0, m.length - trail.length);
      const isUrl = /^(https?:|mailto:)/i.test(target);
      return `<a class="open-link" data-open="${target}" href="#" title="${isUrl ? "Open in your browser" : "Open with the default app"}">${target}</a>${trail}`;
    });
  }
  function parseCsv(text) {
    const first = text.split(/\r?\n/, 1)[0] || "";
    let delimiter = ",";
    let best = -1;
    for (const d of [",", ";", "\t"]) {
      const n = first.split(d).length - 1;
      if (n > best) {
        delimiter = d;
        best = n;
      }
    }
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else quoted = false;
        } else field += c;
        continue;
      }
      if (c === '"' && field === "") quoted = true;
      else if (c === delimiter) {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else field += c;
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    while (rows.length && rows[rows.length - 1].every((f) => f === "")) rows.pop();
    return rows;
  }
  function csvBlock(raw) {
    const rows = parseCsv(raw.trim());
    const code = esc(raw.trim());
    if (rows.length < 2) return `<pre>${code}</pre>`;
    return `<div class="csv-block"><div class="mm-out">${csvTable(rows)}</div><pre class="mm-code" hidden>${code}</pre><div class="mm-bar"><button type="button" class="mm-src">source</button></div></div>`;
  }
  function mermaidBlock(code) {
    return `<div class="mermaid-block" data-src="${code}"><div class="mm-out"><pre>${code}</pre></div><pre class="mm-code" hidden>${code}</pre><div class="mm-bar"><button type="button" class="mm-src">source</button></div></div>`;
  }
  function mentions(room, html) {
    return html.replace(/(?<![\w.\/:])@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu, (m, name) => {
      const p = findByName(room, name);
      return p ? `<span class="mention" style="color:${p.color}">@${esc(name)}</span>` : m;
    });
  }
  const md = window.marked ? new window.marked.Marked({ gfm: true, breaks: true }) : null;
  if (md) {
    md.use({
      renderer: {
        html(token) {
          return esc(token.text != null ? token.text : token.raw || "");
        },
        code(token) {
          const lang = token.lang || "";
          if (/^\s*(csv|tsv)\b/i.test(lang)) return csvBlock(String(token.text || ""));
          const code = esc(String(token.text || "")).trim();
          return /^\s*mermaid\b/i.test(lang) ? mermaidBlock(code) : `<pre>${code}</pre>`;
        },
        link(token) {
          const inner = this.parser.parseInline(token.tokens || []);
          const href = String(token.href || "");
          if (!/^(https?:|mailto:)/i.test(href)) return inner;
          return `<a class="open-link" data-open="${esc(href)}" href="#" title="Open in your browser">${inner}</a>`;
        },
        image(token) {
          return esc(token.text || token.href || "");
        },
      },
    });
  }
  function decorate(room, html) {
    let inside = 0;
    let out = "";
    for (const part of html.split(/(<[^>]*>)/)) {
      if (!part) continue;
      if (part[0] === "<") {
        const m = /^<(\/?)(code|pre|a)\b/i.exec(part);
        if (m) inside += m[1] ? -1 : 1;
        out += part;
      } else out += inside > 0 ? part : mentions(room, linkify(part));
    }
    return out;
  }
  function renderText(room, text) {
    if (!md) return renderTextLight(room, text);
    return decorate(room, md.parse(String(text == null ? "" : text)));
  }
  function renderTextLight(room, text) {
    let html = esc(text);
    const blocks = [];
    html = html.replace(/```([^\n]*)\n([\s\S]*?)```/g, (m, lang, code) => {
      blocks.push(/^\s*mermaid\b/i.test(lang) ? mermaidBlock(code.trim()) : `<pre>${code}</pre>`);
      return `\u0000${blocks.length - 1}\u0000`;
    });
    html = linkify(html);
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    html = mentions(room, html);
    html = html.replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[Number(i)]);
    return html;
  }


  const VIEWABLE_RE = /\.(md|markdown|csv|tsv)$/i;
  function csvTable(rows) {
    if (!rows.length) return '<p class="lead">Empty file.</p>';
    const cell = (tag, v) => `<${tag}>${esc(v)}</${tag}>`;
    const [head, ...body] = rows;
    const width = Math.max(head.length, ...body.map((r) => r.length));
    const pad = (r) => r.concat(Array(Math.max(0, width - r.length)).fill(""));
    return `<div class="csv-wrap"><table class="csv"><thead><tr>${pad(head).map((v) => cell("th", v)).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${pad(r).map((v) => cell("td", v)).join("")}</tr>`).join("")}</tbody></table></div><p class="csv-count">${body.length} row${body.length === 1 ? "" : "s"} · ${width} column${width === 1 ? "" : "s"}</p>`;
  }
  async function viewFile(path) {
    const r = await get(`/api/file?path=${encodeURIComponent(path)}`);
    els.fvTitle.textContent = r.path.split(/[\\/]/).pop();
    els.fvPath.textContent = r.path;
    els.fvBody.className = `file-view ${r.kind}`;
    els.fvBody.innerHTML = r.kind === "csv" ? csvTable(r.rows) : renderText(currentRoom(), r.text);
    els.fvOpen.dataset.path = r.path;
    els.fvBody.scrollTop = 0;
    openDialog(els.fileDialog);
    if (r.kind === "markdown") renderDiagrams(els.fvBody);
  }


  const POP_PALETTE = [
    { fill: "#e4e6fb", stroke: "#5b5bf0" },
    { fill: "#d9f7e8", stroke: "#1d8f6a" },
    { fill: "#fff3cc", stroke: "#b8860b" },
    { fill: "#ffe4d6", stroke: "#d2691e" },
    { fill: "#ffe3ec", stroke: "#d6336c" },
    { fill: "#dcefff", stroke: "#2a6fbf" },
    { fill: "#f1e3fb", stroke: "#8a3fb8" },
  ];
  const DIAGRAM_PRESETS = {
    pop: { label: "Pop", palette: POP_PALETTE, primaryColor: "#e4e6fb", primaryBorderColor: "#5b5bf0", primaryTextColor: "#1c1b33", lineColor: "#8f8fb0", secondaryColor: "#d9f7e8", secondaryBorderColor: "#1d8f6a", tertiaryColor: "#fff3cc", tertiaryBorderColor: "#b8860b", textColor: "#1c1b33", clusterBkg: "#f8f8fd", clusterBorder: "#d9dbf5", edgeLabelBackground: "#ffffff", noteBkgColor: "#fff3cc", noteBorderColor: "#b8860b" },
    lavender: { label: "Lavender", primaryColor: "#ece9ff", primaryBorderColor: "#6d5dfc", primaryTextColor: "#24223d", lineColor: "#5a4be0", secondaryColor: "#e3f8f2", secondaryBorderColor: "#39c6a3", tertiaryColor: "#fff4d6", tertiaryBorderColor: "#f5a524", textColor: "#24223d", clusterBkg: "#f7f6fc", clusterBorder: "#d6d1f5", edgeLabelBackground: "#ffffff" },
    mint: { label: "Mint", primaryColor: "#e3f8f2", primaryBorderColor: "#39c6a3", primaryTextColor: "#0f3d33", lineColor: "#2a9d84", secondaryColor: "#ece9ff", secondaryBorderColor: "#6d5dfc", tertiaryColor: "#fff4d6", tertiaryBorderColor: "#f5a524", textColor: "#1b3a33", clusterBkg: "#f3fbf8", clusterBorder: "#b4ecdc", edgeLabelBackground: "#ffffff" },
    sunset: { label: "Sunset", primaryColor: "#ffe9d6", primaryBorderColor: "#f5a524", primaryTextColor: "#4a2b00", lineColor: "#d97706", secondaryColor: "#ffe9ec", secondaryBorderColor: "#ef5b6b", tertiaryColor: "#ece9ff", tertiaryBorderColor: "#6d5dfc", textColor: "#3b2a1a", clusterBkg: "#fff8f0", clusterBorder: "#fde1c2", edgeLabelBackground: "#ffffff" },
    slate: { label: "Slate", primaryColor: "#e9edf3", primaryBorderColor: "#64748b", primaryTextColor: "#1e293b", lineColor: "#475569", secondaryColor: "#f1f5f9", secondaryBorderColor: "#94a3b8", tertiaryColor: "#e2e8f0", tertiaryBorderColor: "#64748b", textColor: "#1e293b", clusterBkg: "#f8fafc", clusterBorder: "#cbd5e1", edgeLabelBackground: "#ffffff" },
  };
  function diagramSettings(d) {
    return d || (state.settings && state.settings.diagrams) || {};
  }
  function mermaidThemeVariables(d) {
    d = diagramSettings(d);
    const preset = DIAGRAM_PRESETS[d.preset] || DIAGRAM_PRESETS.pop;
    const vars = Object.assign({}, preset, { fontFamily: "Nunito, Segoe UI, system-ui, -apple-system, Roboto, sans-serif", fontSize: "13px" });
    delete vars.label;
    delete vars.palette;
    if (preset.palette) preset.palette.forEach((c, i) => (vars[`pie${i + 1}`] = c.fill));
    if (d.primary) {
      vars.primaryColor = d.primary;
      delete vars.primaryBorderColor;
      delete vars.primaryTextColor;
    }
    return vars;
  }
  function diagramPalette(d) {
    d = diagramSettings(d);
    const preset = DIAGRAM_PRESETS[d.preset] || DIAGRAM_PRESETS.pop;
    return preset.palette && !d.primary ? preset.palette : null;
  }
  const MERMAID_CSS = [
    ".node rect, .node .label-container, .node .basic, .cluster rect, rect.actor { rx: 12px; ry: 12px; }",
    ".node .label-container, .node .basic, .node rect, .node circle, .node ellipse, rect.actor { stroke-width: 1.8px; filter: drop-shadow(0 2px 0 rgba(28, 27, 51, 0.10)); }",
    ".edgePath .path, .flowchart-link, .messageLine0, .messageLine1, .transition, .relation { stroke-width: 2px; }",
    ".edgeLabel, .edgeLabel p { font-weight: 700; }",
    ".cluster rect { stroke-dasharray: 4 3; stroke-width: 1.5px; }",
    ".cluster-label, .cluster-label p { font-weight: 800; }",
  ].join(" ");
  function paintDiagram(root, palette) {
    const ink = "#1c1b33";
    const byKey = new Map();
    const pick = (key) => {
      if (!byKey.has(key)) byKey.set(key, palette[byKey.size % palette.length]);
      return byKey.get(key);
    };
    for (const node of root.querySelectorAll("g.node")) {
      const shape = node.querySelector(":scope > .label-container, :scope > .basic, :scope > rect, :scope > polygon, :scope > circle, :scope > ellipse, :scope > path");
      if (!shape) continue;
      const c = pick(node.id || node.getAttribute("data-id") || String(byKey.size));
      shape.style.fill = c.fill;
      shape.style.stroke = c.stroke;
      node.querySelectorAll(".nodeLabel, text").forEach((t) => {
        t.style.color = ink;
        t.style.fill = ink;
      });
    }
    const actors = new Map();
    for (const rect of root.querySelectorAll("rect.actor")) {
      const name = rect.getAttribute("name") || String(actors.size);
      if (!actors.has(name)) actors.set(name, palette[actors.size % palette.length]);
      rect.style.fill = actors.get(name).fill;
      rect.style.stroke = actors.get(name).stroke;
    }
    root.querySelectorAll("text.actor, text.actor tspan").forEach((t) => (t.style.fill = ink));
  }
  let mermaidLoading = null;
  function loadMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (!mermaidLoading) {
      mermaidLoading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "/vendor/mermaid.min.js";
        s.onload = () => resolve(window.mermaid);
        s.onerror = () => reject(new Error("could not load Mermaid from the hub"));
        document.head.appendChild(s);
      });
    }
    return mermaidLoading;
  }
  let mermaidSeq = 0;
  async function renderDiagrams(root, d) {
    const blocks = [...root.querySelectorAll(".mermaid-block:not([data-rendered])")];
    if (!blocks.length) return;
    for (const b of blocks) b.dataset.rendered = "1";
    let mermaid;
    try {
      mermaid = await loadMermaid();
    } catch (e) {
      showError(e);
      return;
    }
    const palette = diagramPalette(d);
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      securityLevel: "strict",
      themeVariables: mermaidThemeVariables(d),
      themeCSS: MERMAID_CSS,
      flowchart: { curve: "basis", padding: 14, nodeSpacing: 44, rankSpacing: 52 },
    });
    for (const block of blocks) {
      const out = block.querySelector(".mm-out");
      const src = block.dataset.src || "";
      try {
        const { svg } = await mermaid.render(`mm-${++mermaidSeq}`, src);
        out.innerHTML = svg;
        if (palette) paintDiagram(out, palette);
        block.classList.add("ok");
        block.classList.remove("failed");
      } catch (e) {
        block.classList.add("failed");
        out.innerHTML = `<pre>${esc(src)}</pre><div class="hint error">Mermaid: ${esc(String((e && e.message) || e).split("\n")[0])}</div>`;
      }
    }
  }
  function rerenderDiagrams() {
    document.querySelectorAll(".mermaid-block[data-rendered]:not(.preview)").forEach((b) => {
      delete b.dataset.rendered;
      b.querySelector(".mm-out").innerHTML = `<pre>${esc(b.dataset.src || "")}</pre>`;
    });
    renderDiagrams(document);
  }
  function time(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function fullTime(ts) {
    return new Date(ts).toLocaleString([], { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  function relTime(ts) {
    if (!ts) return "";
    const d = Date.now() - ts;
    if (d < 60000) return "just now";
    if (d < 3600000) return `${Math.floor(d / 60000)} min ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)} h ago`;
    return new Date(ts).toLocaleDateString([], { day: "numeric", month: "short" });
  }
  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  }
  function fmtTokens(n) {
    if (n === undefined || n === null) return "";
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  }
  function fmtCost(cost) {
    return cost ? `${cost.amount.toFixed(3)} ${cost.currency}` : "";
  }
  function nearBottom() {
    const el = els.messages;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }
  function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }
  function avatar(p, size, opts) {
    return window.Avatars.avatarHtml(p, size, Object.assign({ recipes: state.recipes }, opts || {}));
  }
  function meAvatarData() {
    const s = state.settings || {};
    return { name: s.humanName || "You", color: "#1f1d3a", avatar: s.humanAvatar, kind: "human" };
  }
  function toast(text, level) {
    const el = document.createElement("div");
    el.className = `toast ${level || "info"}`;
    el.innerHTML = `${ic(level === "error" ? "close" : level === "warn" ? "alert" : "info")}<span></span>`;
    el.lastChild.textContent = text;
    const leave = () => {
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 220);
    };
    el.addEventListener("click", leave);
    els.toasts.appendChild(el);
    if (level !== "error") setTimeout(leave, 9000);
    while (els.toasts.children.length > 6) els.toasts.firstChild.remove();
  }
  const notice = toast;
  function showError(error) {
    toast(error && error.message ? error.message : String(error), "error");
  }
  function geekTip(text) {
    return `<button type="button" class="geek-tip" title="For geeks">${ic("geek")}for geeks</button><span class="geek-text" hidden>${text}</span>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".geek-tip");
    if (!b) return;
    e.preventDefault();
    const t = b.nextElementSibling;
    if (!t || !t.classList.contains("geek-text")) return;
    t.hidden = !t.hidden;
    b.classList.toggle("on", !t.hidden);
  });
  function field(label, inputHtml, hint, geekText) {
    return `<label class="field"><span class="label">${label}${geekText ? geekTip(geekText) : ""}</span>${inputHtml}${hint ? `<span class="hint">${hint}</span>` : ""}</label>`;
  }
  function vendorLogo(r) {
    return `<span class="vc-logo">${r.icon ? `<img src="${esc(r.icon)}" alt="" onerror="this.replaceWith(document.createTextNode('${esc(r.vendor[0])}'))">` : esc(r.vendor[0])}</span>`;
  }
  function sectionTitle(iconName, text) {
    return `<h4>${ic(iconName)}${text}</h4>`;
  }
  function saveRow(id) {
    return `<div class="save-row"><button class="btn sm primary save" id="${id}" disabled>Save</button></div>`;
  }
  function geek(id, bodyHtml, hint) {
    return `<details class="geek" id="${id}"><summary>${ic("geek")}for geeks${hint ? `<span class="g-hint">${hint}</span>` : ""}<span class="chev">${ic("down")}</span></summary><div class="geek-body">${bodyHtml}</div></details>`;
  }
  function bindSave(container, button, onSave) {
    if (!container || !button) return;
    const arm = () => {
      button.disabled = false;
      button.classList.remove("saved");
      button.textContent = "Save";
    };
    container.addEventListener("input", arm);
    container.addEventListener("change", arm);
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.classList.add("loading");
      try {
        await onSave();
        button.classList.remove("loading");
        button.classList.add("saved");
        button.innerHTML = `${ic("check")} Saved`;
      } catch (e) {
        button.classList.remove("loading");
        button.disabled = false;
        showError(e);
      }
    });
  }
  function roomHue(room) {
    let h = 0;
    for (const ch of room.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 360;
  }
  function roomMark(room, lg) {
    const hue = roomHue(room);
    const emoji = (room.settings && room.settings.emoji) || "";
    if (emoji) return `<span class="room-mark emoji${lg ? " lg" : ""}" style="background:hsl(${hue} 70% 93%)">${esc(emoji)}</span>`;
    const letter = (room.name.trim()[0] || "?").toUpperCase();
    return `<span class="room-mark${lg ? " lg" : ""}" style="background:linear-gradient(135deg, hsl(${hue} 72% 66%), hsl(${(hue + 30) % 360} 68% 52%))">${esc(letter)}</span>`;
  }
  function roomTitle(room) {
    const emoji = (room.settings && room.settings.emoji) || "";
    return emoji ? `${room.name} ${emoji}` : room.name;
  }
  function flash(id) {
    const s = document.getElementById(id);
    if (!s) return;
    s.textContent = "saved";
    setTimeout(() => {
      const again = document.getElementById(id);
      if (again) again.textContent = "";
    }, 2200);
  }

  function openDialog(dialog) {
    if (dialog.open) return;
    dialog.classList.remove("closing");
    dialog.showModal();
  }
  function closeDialog(dialog) {
    if (!dialog.open) return;
    dialog.classList.add("closing");
    setTimeout(() => {
      dialog.classList.remove("closing");
      if (dialog.open) dialog.close();
    }, 190);
  }
  function confirmDialog(text, opts) {
    const o = opts || {};
    const dialog = $("#confirm-dialog");
    $("#cf-title").textContent = o.title || "Are you sure?";
    $("#cf-text").textContent = text;
    const ok = $("#cf-ok");
    ok.textContent = o.okLabel || "OK";
    ok.className = `btn ${o.danger ? "danger solid" : "primary"}`;
    return new Promise((resolve) => {
      const done = () => {
        dialog.removeEventListener("close", done);
        resolve(dialog.returnValue === "ok");
      };
      dialog.addEventListener("close", done);
      dialog.returnValue = "";
      openDialog(dialog);
      ok.focus();
    });
  }
  function remember(key, value) {
    try {
      localStorage.setItem(`viberoom.${key}`, String(value));
    } catch {
    }
  }
  function recall(key) {
    try {
      return localStorage.getItem(`viberoom.${key}`);
    } catch {
      return null;
    }
  }


  function setView(view) {
    state.view = view;
    els.app.classList.remove("view-home", "view-rooms", "view-room", "view-skills", "view-settings");
    els.app.classList.add(`view-${view}`);
    els.homeView.hidden = view !== "home";
    els.roomsView.hidden = view !== "rooms";
    els.chatView.hidden = view !== "room";
    els.pageView.hidden = !(view === "skills" || view === "settings");
    els.sideRooms.hidden = view === "room";
    els.sideRoom.hidden = view !== "room";
    if (view !== "room" && state.selection.kind !== "me") closeDetails();
    renderRail();
    if (view === "home") {
      renderSideRooms();
      renderHome();
    } else if (view === "rooms") {
      renderSideRooms();
      renderRoomsGrid();
    } else if (view === "room") {
      renderSideRoom();
      renderChatHead();
      renderMessages();
    } else if (view === "skills") {
      renderSideRooms();
      renderSkillsPage();
    } else if (view === "settings") {
      renderSideRooms();
      renderSettingsPage();
    }
  }

  function selectRoom(id, opts) {
    if (!state.rooms.has(id)) return;
    state.currentRoomId = id;
    state.unread.delete(id);
    state.selection = { kind: "room" };
    remember("room", id);
    setView("room");
    if (!(opts && opts.keepDetails)) closeDetails();
    maybeOfferReconnect();
  }

  function renderRail() {
    els.rail.querySelectorAll(".rail-item[data-nav]").forEach((b) => {
      const nav = b.dataset.nav;
      const active = nav === state.view || (nav === "me" && state.selection.kind === "me" && state.detailsOpen);
      b.classList.toggle("active", active);
    });
    const room = currentRoom();
    els.railRoom.hidden = !room;
    if (room) els.railRoomLabel.textContent = room.name;
    const unread = [...state.unread.values()].reduce((a, b) => a + b, 0);
    els.railUnread.hidden = !unread;
    els.railUnread.textContent = unread > 99 ? "99+" : String(unread);
    const s = state.settings;
    if (s) {
      els.railMeAvatar.innerHTML = avatar(meAvatarData(), 44, {});
      els.railMeLabel.textContent = s.humanName;
    }
    const open = els.app.classList.contains("rail-open");
    els.railToggle.title = open ? "Collapse the menu" : "Expand the menu";
    els.railToggle.innerHTML = ic(open ? "collapse" : "expand");
  }

  function setRailOpen(open) {
    els.app.classList.toggle("rail-open", open);
    remember("railOpen", open ? "1" : "0");
    renderRail();
  }


  function roomStats(room) {
    const agents = room.participants.filter((p) => p.kind === "agent");
    const online = agents.filter((p) => p.status !== "offline" && p.status !== "left").length;
    const chats = room.messages.filter((m) => m.kind === "chat");
    const last = chats.length ? chats[chats.length - 1].ts : room.createdAt;
    const thinking = agents.some((p) => p.status === "thinking");
    return { agents, online, chats, last, thinking, unread: state.unread.get(room.id) || 0 };
  }

  function sortedRooms() {
    return [...state.rooms.values()].sort((a, b) => roomStats(b).last - roomStats(a).last);
  }

  function renderSideSkills() {
    els.sideRoomsTitle.textContent = "Skills by room";
    els.roomList.innerHTML = "";
    const q = state.roomSearch.toLowerCase();
    const all = document.createElement("li");
    all.className = state.skillsRoom ? "" : "selected";
    all.innerHTML = `<span class="room-mark" style="background:var(--grad-primary)">${ic("skills")}</span><div class="p-body"><div class="p-name"><span>All skills</span></div><div class="p-preview">${(state.skills || []).length} in the library</div></div>`;
    all.addEventListener("click", () => {
      state.skillsRoom = null;
      renderSideSkills();
      renderSkillsPage();
    });
    els.roomList.appendChild(all);
    for (const room of sortedRooms()) {
      if (q && !room.name.toLowerCase().includes(q)) continue;
      const held = new Set();
      for (const p of room.participants) for (const s of p.skills || []) held.add(s.toLowerCase());
      const li = document.createElement("li");
      li.className = state.skillsRoom === room.id ? "selected" : "";
      const selected = state.skillsRoom === room.id;
      li.innerHTML = `${roomMark(room)}<div class="p-body"><div class="p-name"><span>${esc(room.name)}</span></div><div class="p-preview">${held.size ? `${held.size} skill${held.size === 1 ? "" : "s"} in use` : "no skills attached"}</div></div>${selected ? `<div class="p-actions"><button class="icon-btn sm goto-room" title="Go to the room">${ic("forward")}</button></div>` : ""}`;
      li.addEventListener("click", (e) => {
        if (e.target.closest(".goto-room")) return selectRoom(room.id);
        state.skillsRoom = room.id;
        renderSideSkills();
        renderSkillsPage();
      });
      els.roomList.appendChild(li);
    }
  }

  function renderSideRooms() {
    if (state.view === "skills") return renderSideSkills();
    els.sideRoomsTitle.textContent = "Rooms";
    els.roomList.innerHTML = "";
    const q = state.roomSearch.toLowerCase();
    for (const room of sortedRooms()) {
      if (q && !room.name.toLowerCase().includes(q) && !(room.settings.topic || "").toLowerCase().includes(q)) continue;
      const st = roomStats(room);
      const li = document.createElement("li");
      li.className = room.id === state.currentRoomId ? "selected" : "";
      const lastChat = st.chats[st.chats.length - 1];
      const preview = lastChat ? `${lastChat.fromName}: ${String(lastChat.text).replace(/\s+/g, " ")}` : room.settings.topic || `${st.agents.length} vibemate${st.agents.length === 1 ? "" : "s"}`;
      li.innerHTML = `
        ${roomMark(room)}
        <div class="p-body">
          <div class="p-name"><span>${esc(room.name)}</span>${st.thinking ? '<span class="live-dot" title="a vibemate is replying"></span>' : ""}</div>
          <div class="p-preview">${esc(preview)}</div>
        </div>
        <div class="p-right"><span>${esc(relTime(st.last))}</span>${st.unread ? `<span class="count-pill">${st.unread}</span>` : ""}</div>`;
      li.addEventListener("click", () => selectRoom(room.id));
      els.roomList.appendChild(li);
    }
    if (!els.roomList.children.length) els.roomList.innerHTML = `<li class="hint" style="cursor:default">${q ? "No room matches." : "No rooms yet."}</li>`;
  }


  const FEATURES = [
    { tone: "lav", emoji: "🏠", title: "Rooms", text: "A room is a folder and a topic. Every vibemate in it works in that folder, and the history stays with the room." },
    { tone: "mint", emoji: "🤖", title: "Vibemates", text: "Summon any installed coding agent, give it a Vibename, a Vibersona and a Vibeface. Several in one room is the point.", vendors: true },
    { tone: "warm", emoji: "💬", title: "Talk to all, or to one", text: "Write to the room and everyone answers in turn; @Name one of them and the others just listen. They read each other's replies." },
    { tone: "peach", emoji: "🧩", title: "Skills", text: "Reusable instructions in your library. Attach them to vibemates, invoke one with /name, or let a vibemate write its own." },
    { tone: "rose", emoji: "🤫", title: "Hush", text: "Too much at once? One click stops every running reply. The vibemates stay quiet until you write again." },
    { tone: "sky", emoji: "📊", title: "Links and diagrams", text: "Links and file paths open on your machine with one click. A ```mermaid block in a reply turns into a diagram." },
  ];
  const STEPS = [
    { n: 1, title: "Open a room", text: "Give it a name and a folder. The folder is where the vibemates read and write." },
    { n: 2, title: "Summon a vibemate", text: "Pick Claude, Codex, Gemini, Cursor, OpenCode or Copilot; name it, give it a face." },
    { n: 3, title: "Say hello", text: "Enter sends. @Name addresses one vibemate, /skill invokes a skill. Watch them talk." },
  ];
  function renderHome() {
    const s = state.settings || {};
    const name = s.humanName || "there";
    const rooms = sortedRooms().slice(0, 4);
    const vendors = state.recipes.filter((r) => !r.unavailableReason);
    const vendorLogos = (vendors.length ? vendors : state.recipes).map((r) => `<span class="home-vendor" title="${esc(r.vendor)}${r.unavailableReason ? " (not installed)" : ""}"${r.unavailableReason ? ' style="opacity:.45"' : ""}>${vendorLogo(r)}</span>`).join("");
    els.homeView.innerHTML = `
      <div class="home-inner">
        <section class="hero">
          <div class="hero-text">
            <div class="hero-eyebrow">viberoom</div>
            <h1>Welcome back, ${esc(name)} 👋</h1>
            <p>One chat, many coding agents. Summon your vibemates into a room, talk to all of them at once, and let them talk to each other.</p>
            <div class="hero-actions">
              <button class="btn cta hero-cta" id="home-open-room">${ic("plus")}Open a room</button>
              <button class="btn hero-ghost" id="home-rooms">${ic("rooms")}Your rooms</button>
            </div>
          </div>
          <div class="hero-art" aria-hidden="true">
            <div class="ha-bubble ha-a"><span class="ha-face">🦊</span><span>Ship the login fix today?</span></div>
            <div class="ha-bubble ha-b"><span class="ha-face">🤖</span><span>On it — tests first.</span></div>
            <div class="ha-bubble ha-c"><span class="ha-face">🐼</span><span>@Nova I'll review your diff.</span></div>
            <div class="ha-spark">✦</div>
          </div>
        </section>
        <section class="home-section">
          <div class="home-head"><h2>${rooms.length ? "Jump back in" : "Your first room"}</h2>${rooms.length ? `<button class="linklike" id="home-all-rooms">All rooms ${ic("forward")}</button>` : ""}</div>
          <div class="home-rooms">
            ${rooms
              .map((room) => {
                const st = roomStats(room);
                const last = st.chats[st.chats.length - 1];
                return `<button class="home-room" data-room="${esc(room.id)}">${roomMark(room)}<span class="hr-body"><span class="hr-name">${esc(room.name)}</span><span class="hr-sub">${esc(last ? `${last.fromName}: ${String(last.text).replace(/\s+/g, " ").slice(0, 70)}` : room.settings.topic || `${st.agents.length} vibemate${st.agents.length === 1 ? "" : "s"}`)}</span></span>${st.unread ? `<span class="count-pill">${st.unread}</span>` : `<span class="hr-time">${esc(relTime(st.last))}</span>`}</button>`;
              })
              .join("")}
            ${rooms.length ? "" : `<div class="home-room empty-room"><span class="room-mark" style="background:var(--grad-primary)">${ic("plus")}</span><span class="hr-body"><span class="hr-name">No rooms yet</span><span class="hr-sub">Open one, summon a vibemate, say hello.</span></span></div>`}
          </div>
        </section>
        <section class="home-section">
          <div class="home-head"><h2>What you can do here</h2></div>
          <div class="feature-grid">
            ${FEATURES.map((f) => `<div class="feature ${f.tone}"><div class="f-emoji">${f.emoji}</div><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p>${f.vendors ? `<div class="home-vendors">${vendorLogos}</div>` : ""}</div>`).join("")}
          </div>
        </section>
        <section class="home-section">
          <div class="home-head"><h2>Three steps to your first conversation</h2></div>
          <div class="steps">
            ${STEPS.map((st) => `<div class="step"><div class="step-n">${st.n}</div><div><h3>${esc(st.title)}</h3><p>${esc(st.text)}</p></div></div>`).join("")}
          </div>
        </section>
        <section class="home-section">
          <div class="home-head"><h2>Small things worth knowing</h2></div>
          <div class="tips">
            <span class="tip"><b>@Name</b> addresses one vibemate</span>
            <span class="tip"><b>/name</b> invokes a skill</span>
            <span class="tip"><b>Shift+Enter</b> is a new line</span>
            <span class="tip"><b>Double-click</b> a vibemate to mention it</span>
            <span class="tip"><b>✓✓ seen by</b> shows who has read your last message</span>
            <span class="tip"><b>for geeks</b> hides the technical settings</span>
            <span class="tip">Your face wears the <b>ring</b></span>
          </div>
        </section>
      </div>`;
    $("#home-open-room").addEventListener("click", openRoomDialog);
    $("#home-rooms").addEventListener("click", () => setView("rooms"));
    const all = $("#home-all-rooms");
    if (all) all.addEventListener("click", () => setView("rooms"));
    els.homeView.querySelectorAll(".home-room[data-room]").forEach((b) => b.addEventListener("click", () => selectRoom(b.dataset.room)));
  }


  function renderRoomsGrid() {
    if (state.view === "home") return renderHome();
    const grid = els.roomsGrid;
    grid.innerHTML = "";
    const cta = document.createElement("div");
    cta.className = "card cta hover room-card";
    cta.innerHTML = `<div class="plus">${ic("plus")}</div><div>Open a room</div><div class="hint">a space for you and some vibemates</div>`;
    cta.addEventListener("click", openRoomDialog);
    grid.appendChild(cta);
    const rooms = sortedRooms();
    els.roomsSub.textContent = rooms.length ? `${rooms.length} room${rooms.length === 1 ? "" : "s"}. Pick one, or open a new one.` : "No rooms yet. Open one and summon some vibemates.";
    for (const room of rooms) {
      const st = roomStats(room);
      const card = document.createElement("div");
      card.className = `card hover room-card${room.id === state.currentRoomId ? " current" : ""}`;
      const faces = st.agents.slice(0, 5).map((p) => avatar(p, 26, { vendor: true })).join("");
      card.innerHTML = `
        <div class="rc-head"><div class="rc-title">${roomMark(room)}<h3>${esc(room.name)}</h3></div>${st.unread ? `<span class="count-pill">${st.unread}</span>` : st.thinking ? '<span class="live-dot" title="a vibemate is replying"></span>' : ""}</div>
        <div class="rc-topic">${esc(room.settings.topic || (st.chats.length ? String(st.chats[st.chats.length - 1].text).slice(0, 140) : "Nothing said yet."))}</div>
        <div class="avatar-stack">${faces || '<span class="hint">no vibemates yet</span>'}</div>
        <div class="rc-foot"><span>${st.agents.length} vibemate${st.agents.length === 1 ? "" : "s"} · ${st.chats.length} message${st.chats.length === 1 ? "" : "s"}</span><span>${esc(relTime(st.last))}</span></div>`;
      card.addEventListener("click", () => selectRoom(room.id));
      grid.appendChild(card);
    }
  }


  function offlineAgents(room) {
    return room ? room.participants.filter((p) => p.kind === "agent" && p.status === "offline") : [];
  }

  function renderSideRoom() {
    const room = currentRoom();
    if (!room) return;
    const st = roomStats(room);
    els.sideRoomName.textContent = room.name;
    els.sideRoomEmoji.textContent = room.settings.emoji || "";
    els.sideRoomSub.textContent = room.settings.topic || `${st.agents.length} vibemate${st.agents.length === 1 ? "" : "s"}${st.agents.length ? ` · ${st.online} online` : ""}`;
    els.participants.innerHTML = "";
    const ordered = [...room.participants].sort((a, b) => (a.kind === "human" ? -1 : b.kind === "human" ? 1 : 0));
    for (const p of ordered) {
      const li = document.createElement("li");
      const selected = (state.selection.kind === "participant" && state.selection.id === p.id) || (p.kind === "human" && state.selection.kind === "me" && state.detailsOpen);
      const asleep = p.kind === "agent" && (p.status === "offline" || p.status === "left");
      li.className = (p.kind === "human" ? "me" : "") + (selected ? " selected" : "") + (asleep ? " offline" : "");
      const sub = p.kind === "human" ? "you, the human" : [p.tagline ? `"${p.tagline}"` : "", p.agentVendor || p.agentLabel, p.model].filter(Boolean).join(" · ");
      const warn = p.statusDetail && (p.status === "offline" || p.status === "error" || p.failedTurns) ? `<div class="p-warn" title="${esc(p.statusDetail)}">${esc(p.statusDetail)}</div>` : "";
      const status = asleep
        ? `<span class="zzz" title="${esc(STATUS_LABEL[p.status] || p.status)}">zzz</span>`
        : p.kind === "agent" && p.status !== "idle" ? `<span class="badge status-${p.status}">${p.status === "thinking" ? '<span class="dot"></span>' : ""}${STATUS_LABEL[p.status] || p.status}</span>` : "";
      li.innerHTML = `
        ${avatar(p.kind === "human" ? meAvatarData() : p, 44, { vendor: true, status: p.kind === "agent" })}
        <div class="p-body">
          <div class="p-name"><span>${esc(p.name)}</span>${p.muted ? '<span class="badge muted">muted</span>' : ""}${status}</div>
          <div class="p-sub">${esc(sub)}</div>
          ${warn}
        </div>
        <div class="p-actions">
          ${p.kind === "agent" && p.status === "thinking" ? `<button class="icon-btn sm stop-btn" title="Stop this reply">${ic("stop")}</button>` : ""}
          ${p.kind === "agent" && p.status === "offline" ? `<button class="icon-btn sm reconnect-btn" title="Reconnect">${ic("refresh")}</button>` : ""}
        </div>`;
      li.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        if (p.kind === "human") openDetails({ kind: "me" });
        else openDetails({ kind: "participant", id: p.id });
      });
      li.addEventListener("dblclick", () => {
        if (p.kind === "agent") insertMention(p.name);
      });
      const stop = li.querySelector(".stop-btn");
      if (stop) stop.addEventListener("click", () => post(roomApi(`/participants/${encodeURIComponent(p.id)}/cancel`)).catch(showError));
      const rec = li.querySelector(".reconnect-btn");
      if (rec) rec.addEventListener("click", () => openReconnectDialog(room));
      els.participants.appendChild(li);
    }
    renderHushButton(room);
    els.reconnectAllBtn.hidden = offlineAgents(room).length === 0;
  }

  function renderHushButton(room, busy) {
    const b = els.focusBtn;
    const label = b.querySelector(".label");
    b.classList.toggle("busy", !!busy);
    b.classList.toggle("on", !busy && !!room.focused);
    b.setAttribute("aria-pressed", room.focused ? "true" : "false");
    if (busy) {
      label.textContent = "Hushing…";
      b.title = "Stopping every running reply";
    } else if (room.focused) {
      label.textContent = "Hushed · waiting for you";
      b.title = "The vibemates stay quiet until you write again";
    } else {
      label.textContent = "Hush the room";
      b.title = "Stop every running reply; vibemates stay quiet until you speak again";
    }
  }

  function insertMention(name) {
    const input = els.input;
    const start = input.selectionStart || input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(start);
    const prefix = before && !/\s$/.test(before) ? " " : "";
    input.value = `${before}${prefix}@${name} ${after}`;
    input.focus();
    autosize();
  }


  function renderChatHead() {
    const room = currentRoom();
    if (!room) {
      els.chatRoomName.textContent = "No room";
      els.chatRoomSub.textContent = "";
      return;
    }
    const st = roomStats(room);
    els.chatRoomName.textContent = roomTitle(room);
    els.chatRoomSub.innerHTML =
      `<span>${st.agents.length} vibemate${st.agents.length === 1 ? "" : "s"}${st.agents.length ? ` · ${st.online} online` : ""}</span>` +
      (room.settings.topic ? `<span>· ${esc(room.settings.topic)}</span>` : "") +
      `<span class="chip dir-chip" title="working directory of the vibemates: ${esc(room.dir)}">${ic("folder")}${esc(room.dir.split(/[\\/]/).filter(Boolean).slice(-1)[0] || room.dir)}</span>`;
  }


  function messageMatches(m) {
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    return m.text.toLowerCase().includes(q) || (m.fromName || "").toLowerCase().includes(q);
  }

  function renderHidden(el, m) {
    const d = m.details || {};
    if (d.skill) {
      el.innerHTML = `
        <details class="hidden-turn">
          <summary>${ic("skills")} hub ↔ ${esc(m.fromName)} · ${esc(m.text)}${d.via ? ` (${esc(d.via)})` : ""}${d.outcome ? ` · <em>${esc(d.outcome)}</em>` : ""}</summary>
          <div class="hidden-body">
            ${d.original ? `<div class="hidden-label">Held reply (nobody in the room saw it)</div><div class="hidden-text">${esc(d.original)}</div>` : ""}
            <div class="hidden-label">What happened</div>
            <div>${d.via === "tool" ? "The vibemate called the hub's load_skill tool during its turn and received the skill text as the tool result." : "The vibemate asked for the skill with the marker; the hub attached the skill and re-ran the turn on the same messages."}</div>
          </div>
        </details>`;
      return;
    }
    el.innerHTML = `
      <details class="hidden-turn">
        <summary>${ic("tool")} hub ↔ ${esc(m.fromName)} · ${esc(m.text)}${d.outcome ? ` · <em>${esc(d.outcome)}</em>` : " · <em>waiting for the corrected reply…</em>"}</summary>
        <div class="hidden-body">
          <div class="hidden-label">Held reply (nobody in the room saw it)</div>
          <div class="hidden-text">${esc(d.original || "")}</div>
          <div class="hidden-label">Corrections sent in a hidden turn</div>
          <ul>${(d.corrections || []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        </div>
      </details>`;
  }

  function messageElement(room, m) {
    const el = document.createElement("div");
    el.dataset.id = m.id;
    el.dataset.seq = m.seq;
    if (m.kind === "hidden") {
      el.className = "msg hidden";
      renderHidden(el, m);
      return el;
    }
    if (m.kind === "system") {
      el.className = "msg system";
      if (m.audience === "agents") {
        el.className = "msg hidden";
        el.innerHTML = `<details class="hidden-turn"><summary>${ic("info")} hub → vibemates · ${esc(m.text.split(":")[0])}</summary><div class="hidden-body"><div class="hidden-label">What the vibemates were told</div><div class="hidden-text">${esc(m.text)}</div></div></details>`;
        return el;
      }
      const hush = /^(Hush|Focus):/.test(m.text);
      const warn = !hush && /could not answer|reported an error|Hop limit|was stopped/.test(m.text);
      el.innerHTML = hush
        ? `<div class="focus-pill" title="${esc(fullTime(m.ts))}"><span class="hush-face">🤫</span>${esc(m.text.replace(/^Focus:/, "Hush:"))}</div>`
        : `<div class="sys${warn ? " warn" : ""}" title="${esc(fullTime(m.ts))}">${esc(m.text)}</div>`;
      return el;
    }
    const p = findById(room, m.from) || { name: m.fromName, color: "#9ca3af", kind: m.from === "human" ? "human" : "agent" };
    const mine = m.from === "human";
    el.className = "msg " + (mine ? "mine" : "agent");
    el.innerHTML = `
      ${avatar(mine ? Object.assign(meAvatarData(), { color: p.color }) : p, 36, { vendor: true })}
      <div class="bubble-col">
        <div class="head"><span class="name" style="color:${p.color}">${esc(m.fromName)}</span><span class="edited" hidden></span>${mine ? `<button type="button" class="edit-btn" title="Edit this message">${ic("pencil")}</button>` : ""}<span class="time" title="${esc(fullTime(m.ts))}">${time(m.ts)}</span></div>
        <div class="bubble">
          ${m.skill ? `<div class="skill-invoke" title="skill invocation: the vibemates that have this skill got its instructions with this message">${ic("skills")} skill <b>${esc(m.skill.name)}</b></div>` : ""}
          <div class="edit-box" hidden></div>
          <details class="thought" hidden><summary>thoughts</summary><div class="thought-text"></div></details>
          <div class="agent-notices"></div>
          <div class="tools"></div>
          <div class="plan" hidden></div>
          <div class="text"></div>
          <button class="more" hidden></button>
          <div class="perms"></div>
        </div>
        <div class="meta"></div>
      </div>`;
    el.querySelector(".more").addEventListener("click", () => {
      if (state.expanded.has(m.id)) state.expanded.delete(m.id);
      else state.expanded.add(m.id);
      updateMessageElement(el, room, m);
    });
    const editBtn = el.querySelector(".edit-btn");
    if (editBtn) editBtn.addEventListener("click", () => openInlineEditor(el, room, m));
    updateMessageElement(el, room, m);
    return el;
  }

  function updateMessageElement(el, room, m) {
    el.classList.toggle("hidden-by-search", !messageMatches(m));
    const editedEl = el.querySelector(".edited");
    if (editedEl) {
      editedEl.hidden = !m.edited;
      if (m.edited) {
        editedEl.textContent = "edited";
        editedEl.title = `before: ${m.edited.previous}`;
      }
    }
    if (m.kind === "hidden") {
      const wasOpen = el.querySelector("details")?.open;
      renderHidden(el, m);
      if (wasOpen) el.querySelector("details").open = true;
      return;
    }
    if (m.kind === "system") return;
    const text = el.querySelector(".text");
    const more = el.querySelector(".more");
    const long = !m.streaming && m.text.length > CLAMP_CHARS;
    const expanded = state.expanded.has(m.id);
    text.innerHTML = renderText(room, m.text) + (m.streaming ? '<span class="caret"></span>' : "");
    if (!m.streaming) renderDiagrams(text);
    if (m.streaming && !m.text) text.innerHTML = '<span class="pending">…</span>';
    text.classList.toggle("clamped", long && !expanded);
    more.hidden = !long;
    more.textContent = expanded ? "Show less" : "Show more";
    const thought = el.querySelector(".thought");
    if (m.thought) {
      thought.hidden = false;
      thought.querySelector(".thought-text").textContent = m.thought;
    }
    el.querySelector(".agent-notices").innerHTML = (m.notices || []).map((n) => `<div class="agent-notice">${ic("info")} ${renderText(room, n)}</div>`).join("");
    const tools = el.querySelector(".tools");
    tools.innerHTML = "";
    for (const call of m.toolCalls || []) {
      const chip = document.createElement("span");
      chip.className = `chip chip-${call.status || "pending"}`;
      chip.title = call.rawInput ? JSON.stringify(call.rawInput, null, 1).slice(0, 800) : "";
      chip.innerHTML = `${ic("tool")}${esc(`${call.title}${call.kind ? ` · ${call.kind}` : ""} · ${call.status || "pending"}`)}`;
      tools.appendChild(chip);
    }
    const plan = el.querySelector(".plan");
    if (m.plan && m.plan.length) {
      plan.hidden = false;
      plan.innerHTML = m.plan.map((e) => `<div class="plan-entry ${e.status}">${esc(e.content)}</div>`).join("");
    }
    const meta = el.querySelector(".meta");
    if (!m.streaming && m.from !== "human") {
      const parts = [];
      if (m.stopReason && m.stopReason !== "end_turn") parts.push(`<span>${esc(m.stopReason)}</span>`);
      if (m.durationMs) parts.push(`<span title="how long the reply took">${ic("clock")} ${(m.durationMs / 1000).toFixed(1)} s</span>`);
      if (m.usage) parts.push(`<span title="tokens in">${ic("arrow-down")} ${fmtTokens(m.usage.inputTokens)}</span><span title="tokens out">${ic("arrow-up")} ${fmtTokens(m.usage.outputTokens)}</span>${m.usage.cachedWriteTokens ? `<span title="tokens written to the cache">${ic("database")} ${fmtTokens(m.usage.cachedWriteTokens)}</span>` : ""}`);
      meta.innerHTML = parts.join("<span class=\"sep\">·</span>");
    } else if (m.from === "human") refreshSeen(room);
    else meta.textContent = "";
  }

  function lastHumanMessage(room) {
    for (let i = room.messages.length - 1; i >= 0; i--) {
      const m = room.messages[i];
      if (m.kind === "chat" && m.from === "human") return m;
    }
    return null;
  }
  function seenHtml(room, m) {
    const seen = room.participants.filter((p) => p.kind === "agent" && p.lastSeenSeq != null && p.lastSeenSeq >= m.seq);
    if (!seen.length) return `<span class="ticks">✓</span> sent`;
    return `<span class="ticks">✓✓</span> seen by ${esc(seen.map((p) => p.name).join(", "))}`;
  }
  function refreshSeen(room) {
    const last = lastHumanMessage(room);
    for (const el of els.messages.querySelectorAll(".msg.mine")) {
      const meta = el.querySelector(".meta");
      if (!meta) continue;
      const isLast = last && el.dataset.id === last.id;
      meta.innerHTML = isLast ? seenHtml(room, last) : "";
      meta.classList.toggle("seen", !!isLast);
    }
  }

  function visibilityMarkers(room) {
    const bySeq = new Map();
    for (const p of room.participants) {
      if (p.kind !== "agent" || p.sawFromSeq === undefined || p.sawFromSeq === null) continue;
      if (!bySeq.has(p.sawFromSeq)) bySeq.set(p.sawFromSeq, []);
      bySeq.get(p.sawFromSeq).push(p);
    }
    return bySeq;
  }
  function visibilityFingerprint(room) {
    return [...visibilityMarkers(room).entries()].map(([seq, ps]) => `${seq}:${ps.map((p) => p.id).join(",")}`).sort().join("|");
  }
  function dividerElement(agents) {
    const el = document.createElement("div");
    el.className = "visibility-divider";
    const names = agents.map((p) => p.name);
    const label = names.length === 1 ? `${names[0]} has not seen anything above this line` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} have not seen anything above this line`;
    el.innerHTML = `<span class="vd-line"></span><span class="vd-label" title="Vibemates know the room only from their own starting point: the join, a replay of the last N messages, or a restored session.">↑ ${esc(label)}</span><span class="vd-line"></span>`;
    return el;
  }

  function renderMessages() {
    const room = currentRoom();
    els.messages.innerHTML = "";
    if (!room) return;
    if (!room.messages.length) {
      els.messages.innerHTML = `<div class="empty"><div class="art">${ic("chat")}</div><strong>${esc(room.name)}</strong> is quiet.<br>Summon a vibemate from the left, then say hello. Use @Name to address someone; without @ every vibemate hears you.</div>`;
      return;
    }
    const markers = visibilityMarkers(room);
    const placed = new Set();
    let lastDay = "";
    for (const m of room.messages) {
      const day = dayLabel(m.ts);
      if (day !== lastDay) {
        const d = document.createElement("div");
        d.className = "day";
        d.textContent = day;
        d.title = new Date(m.ts).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        els.messages.appendChild(d);
        lastDay = day;
      }
      for (const [seq, agents] of markers) {
        if (placed.has(seq) || !(m.seq >= seq)) continue;
        if (m.seq > 0) {
          placed.add(seq);
          els.messages.appendChild(dividerElement(agents));
        }
      }
      els.messages.appendChild(messageElement(room, m));
    }
    for (const [seq, agents] of markers) {
      if (!placed.has(seq)) els.messages.appendChild(dividerElement(agents));
    }
    for (const perm of room.permissions) renderPermission(room, perm);
    refreshSeen(room);
    scrollToBottom();
  }

  function upsertMessage(roomId, m) {
    const room = state.rooms.get(roomId);
    if (!room) return;
    const idx = room.messages.findIndex((x) => x.id === m.id);
    if (idx >= 0) Object.assign(room.messages[idx], m);
    else room.messages.push(m);
    const showing = roomId === state.currentRoomId && state.view === "room";
    if (!showing) {
      if (idx < 0 && m.kind === "chat" && !m.streaming && m.from !== "human" && roomId !== state.currentRoomId) state.unread.set(roomId, (state.unread.get(roomId) || 0) + 1);
      if ((state.view === "rooms" || state.view === "home")) {
        renderSideRooms();
        renderRoomsGrid();
      }
      renderRail();
      return;
    }
    const stick = nearBottom();
    const existing = els.messages.querySelector(`.msg[data-id="${m.id}"]`);
    if (existing) updateMessageElement(existing, room, room.messages[idx]);
    else {
      const empty = els.messages.querySelector(".empty");
      if (empty) empty.remove();
      els.messages.appendChild(messageElement(room, m));
      if (m.from === "human") refreshSeen(room);
    }
    if (stick) scrollToBottom();
  }

  function removeMessage(roomId, id) {
    const room = state.rooms.get(roomId);
    if (!room) return;
    room.messages = room.messages.filter((m) => m.id !== id);
    if (roomId !== state.currentRoomId) return;
    const el = els.messages.querySelector(`.msg[data-id="${id}"]`);
    if (el) el.remove();
  }

  function patchMessage(roomId, id, fn) {
    const room = state.rooms.get(roomId);
    if (!room) return;
    const m = room.messages.find((x) => x.id === id);
    if (!m) return;
    fn(m);
    if (roomId !== state.currentRoomId || state.view !== "room") return;
    const el = els.messages.querySelector(`.msg[data-id="${id}"]`);
    const stick = nearBottom();
    if (el) updateMessageElement(el, room, m);
    if (stick) scrollToBottom();
  }


  function openInlineEditor(el, room, m) {
    const box = el.querySelector(".edit-box");
    const text = el.querySelector(".text");
    if (!box.hidden) return;
    box.innerHTML = `<textarea class="edit-area" rows="3"></textarea><div class="row-btns"><button type="button" class="btn sm ghost edit-cancel">Cancel</button><button type="button" class="btn sm primary edit-save">Save</button></div>`;
    const area = box.querySelector(".edit-area");
    area.value = m.text;
    box.hidden = false;
    text.hidden = true;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    const close = () => {
      box.hidden = true;
      box.innerHTML = "";
      text.hidden = false;
    };
    box.querySelector(".edit-cancel").addEventListener("click", close);
    area.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) box.querySelector(".edit-save").click();
    });
    box.querySelector(".edit-save").addEventListener("click", async () => {
      const next = area.value.trim();
      if (!next || next === m.text) return close();
      try {
        const preview = await get(`/api/rooms/${encodeURIComponent(room.id)}/messages/${encodeURIComponent(m.id)}/edit-preview`);
        close();
        openEditDialog(room, m, next, preview);
      } catch (e) {
        showError(e);
      }
    });
  }

  const editEls = { dialog: $("#edit-dialog"), summary: $("#ed-summary"), rewriteDetail: $("#ed-rewrite-detail"), error: $("#ed-error"), notify: $("#ed-notify"), rewrite: $("#ed-rewrite") };
  let editRequest = null;

  function openEditDialog(room, m, next, preview) {
    const nobodySaw = preview.restart.length === 0 && preview.offline.length === 0;
    if (preview.laterRecords === 0 && nobodySaw) {
      submitEdit(room, m, next, "notify");
      return;
    }
    const later = preview.laterMessages === 0 ? "No chat messages follow it" : `${preview.laterMessages} chat message${preview.laterMessages > 1 ? "s" : ""} follow${preview.laterMessages > 1 ? "" : "s"} it`;
    const saw = preview.restart.length ? `Vibemates that already read it: ${preview.restart.join(", ")}.` : "No online vibemate has read it yet.";
    const off = preview.offline.length ? ` Offline with the old version: ${preview.offline.join(", ")} (a rewrite makes them replay the new history when they reconnect).` : "";
    editEls.summary.textContent = `${later}. ${saw}${off}`;
    editEls.rewriteDetail.textContent = preview.laterMessages
      ? `removes the ${preview.laterMessages} later chat message${preview.laterMessages > 1 ? "s" : ""} (and ${preview.laterRecords - preview.laterMessages} room event${preview.laterRecords - preview.laterMessages === 1 ? "" : "s"}).`
      : "nothing to remove after it.";
    editEls.error.hidden = true;
    editEls.rewrite.textContent = preview.restart.length ? `Rewrite from here (restart ${preview.restart.join(", ")})` : "Rewrite from here";
    editRequest = { room, m, next };
    openDialog(editEls.dialog);
    editEls.notify.focus();
  }

  async function submitEdit(room, m, next, mode) {
    try {
      const result = await post(`/api/rooms/${encodeURIComponent(room.id)}/messages/${encodeURIComponent(m.id)}/edit`, { text: next, mode });
      closeDialog(editEls.dialog);
      if (mode === "rewrite") toast(`Rewritten from here: ${result.removed} record${result.removed === 1 ? "" : "s"} removed${result.restarted.length ? `; restarted ${result.restarted.join(", ")}` : ""}.`, "info");
    } catch (e) {
      if (editEls.dialog.open) {
        editEls.error.textContent = e.message;
        editEls.error.hidden = false;
      } else showError(e);
    }
  }
  editEls.notify.addEventListener("click", () => editRequest && submitEdit(editRequest.room, editRequest.m, editRequest.next, "notify"));
  editEls.rewrite.addEventListener("click", () => editRequest && submitEdit(editRequest.room, editRequest.m, editRequest.next, "rewrite"));


  function renderPermission(room, perm) {
    const p = findById(room, perm.participantId);
    const card = document.createElement("div");
    card.className = "perm";
    card.dataset.key = perm.key;
    const tc = perm.toolCall || {};
    card.innerHTML = `
      <div class="perm-title">${ic("lock")} ${esc(p ? p.name : perm.participantId)} asks for permission: <strong>${esc(tc.title || tc.toolCallId || "tool call")}</strong>${tc.kind ? ` <span class="kind">${esc(tc.kind)}</span>` : ""}</div>
      ${tc.rawInput ? `<pre class="perm-input">${esc(JSON.stringify(tc.rawInput, null, 1).slice(0, 1200))}</pre>` : ""}
      <div class="perm-actions"></div>`;
    const actions = card.querySelector(".perm-actions");
    for (const option of perm.options || []) {
      const btn = document.createElement("button");
      btn.className = `perm-btn kind-${option.kind}`;
      btn.textContent = option.name;
      btn.title = option.kind;
      btn.addEventListener("click", () => post(roomApi(`/permissions/${encodeURIComponent(perm.key)}`), { optionId: option.optionId }).catch(showError));
      actions.appendChild(btn);
    }
    const cancel = document.createElement("button");
    cancel.className = "perm-btn";
    cancel.textContent = "Dismiss (cancelled)";
    cancel.addEventListener("click", () => post(roomApi(`/permissions/${encodeURIComponent(perm.key)}`), { optionId: null }).catch(showError));
    actions.appendChild(cancel);
    const draft = [...room.messages].reverse().find((m) => m.streaming && m.from === perm.participantId);
    const host = draft ? els.messages.querySelector(`.msg[data-id="${draft.id}"] .perms`) : null;
    (host || els.messages).appendChild(card);
    scrollToBottom();
  }
  function resolvePermissionCard(key, optionId) {
    const card = document.querySelector(`.perm[data-key="${key}"]`);
    if (!card) return;
    card.classList.add("resolved");
    card.querySelector(".perm-actions").innerHTML = `<span class="perm-result">${optionId ? `chosen: ${esc(optionId)}` : "dismissed"}</span>`;
  }


  const DETAILS_MIN = 320;
  const DETAILS_MAX = 760;
  const DETAILS_DEFAULT = { room: 420, participant: 420, me: 400 };

  function detailsKey() {
    return state.selection.kind === "participant" ? "participant" : state.selection.kind;
  }
  function applyDetailsWidth(px, persist) {
    const w = Math.max(DETAILS_MIN, Math.min(DETAILS_MAX, Math.round(px)));
    els.details.style.width = `${w}px`;
    if (persist) remember(`details.${detailsKey()}`, w);
  }
  function fitDetailsWidth() {
    const key = detailsKey();
    const saved = Number(recall(`details.${key}`));
    applyDetailsWidth(saved || DETAILS_DEFAULT[key] || 400, false);
  }
  function openDetails(selection) {
    state.selection = selection;
    state.detailsOpen = true;
    els.details.classList.remove("closing");
    els.details.hidden = false;
    fitDetailsWidth();
    renderDetails();
    if (state.view === "room") renderSideRoom();
    renderRail();
  }
  function closeDetails() {
    if (!state.detailsOpen) return;
    state.detailsOpen = false;
    els.details.classList.add("closing");
    setTimeout(() => {
      if (!state.detailsOpen) {
        els.details.hidden = true;
        els.details.classList.remove("closing");
      }
    }, 190);
    if (state.selection.kind === "me") state.selection = { kind: "room" };
    if (state.view === "room") renderSideRoom();
    renderRail();
  }
  function renderDetails() {
    if (!state.detailsOpen) return;
    const room = currentRoom();
    if (state.selection.kind === "me") return renderMePanel(room);
    if (!room) {
      els.detailsInner.innerHTML = '<div class="empty">Open a room to begin.</div>';
      return;
    }
    if (state.selection.kind === "participant") {
      const p = findById(room, state.selection.id);
      if (p && p.kind === "agent") return renderAgentPanel(room, p);
      if (p && p.kind === "human") return renderMePanel(room);
    }
    renderRoomPanel(room);
  }
  function profileHeader(p) {
    return `${avatar(p, 76, { vendor: true, status: true })}
        <h3>${esc(p.name)}</h3>
        <div class="tagline">${esc(p.tagline || "no vibersona")}</div>
        <div class="badges"><span class="badge">${esc(p.agentVendor || p.agentType || "vibemate")}</span><span class="badge status-${p.status}">${STATUS_LABEL[p.status] || p.status}</span>${p.muted ? '<span class="badge muted">muted</span>' : ""}</div>`;
  }
  function refreshDetailsHeader(p) {
    const header = els.detailsInner.querySelector(".profile");
    if (header) header.innerHTML = profileHeader(p);
  }
  function panelTitle(title, sub) {
    return `<div class="panel-title"><div><h3>${title}</h3>${sub ? `<div class="hint">${sub}</div>` : ""}</div><button class="icon-btn sm ghost" id="details-close" title="Close">${ic("close")}</button></div>`;
  }
  function wireDetailsClose() {
    const b = $("#details-close");
    if (b) b.addEventListener("click", closeDetails);
  }

  function renderAgentPanel(room, p) {
    const rec = state.recipes.find((r) => r.id === p.agentType);
    const offline = p.status === "offline";
    els.detailsInner.innerHTML = `
      ${panelTitle("Vibemate", esc(room.name))}
      <div class="profile">
        ${profileHeader(p)}
      </div>
      <div class="action-row">
        <button class="action" data-act="mention"><span class="ico">${ic("at")}</span>Mention</button>
        <button class="action" data-act="${p.muted ? "unmute" : "mute"}"><span class="ico">${ic(p.muted ? "bell" : "bell-off")}</span>${p.muted ? "Unmute" : "Mute"}</button>
        ${offline ? `<button class="action" data-act="reconnect"><span class="ico">${ic("refresh")}</span>Reconnect</button>` : `<button class="action" data-act="cancel" ${p.status !== "thinking" ? "disabled" : ""}><span class="ico">${ic("stop")}</span>Stop</button>`}
        <button class="action danger" data-act="remove"><span class="ico">${ic("trash")}</span>Remove</button>
      </div>
      <div class="section" id="pp-persona">
        ${sectionTitle("user", "Persona")}
        ${field("Vibename", `<input type="text" id="pp-name" maxlength="24" value="${esc(p.name)}">`)}
        ${field("Vibersona", `<input type="text" id="pp-tagline" maxlength="80" value="${esc(p.tagline || "")}" placeholder="a few words under the vibename">`, "Shown under the vibename.", "Everyone in the room sees it: you, and the other vibemates in their roster.")}
        ${field("Vibeface", `<div id="pp-avatar-picker"></div><input type="text" id="pp-avatar" maxlength="8" value="${esc(p.avatar || "")}" placeholder="custom emoji (optional)">`)}
        ${field("Vibio", `<textarea id="pp-role" rows="5" maxlength="4000" placeholder="who it is, how it speaks, what it cares about">${esc(p.role || "")}</textarea>`, "Only this vibemate reads it.", "Reaches the vibemate as refreshed instructions in its brief on its next turn; its memory is kept. The other participants never see it.")}
        ${saveRow("pp-save")}
      </div>
      ${p.statusDetail && (p.status === "offline" || p.status === "error" || p.failedTurns) ? `<p class="hint" style="color:var(--danger);margin:0 4px 10px">${esc(p.statusDetail)}</p>` : ""}
      ${geek(
        "pp-geek",
        `<div class="section" id="pp-skills-section">
        ${sectionTitle("skills", "Skills")}
        <div class="check-list" id="pp-skills"></div>
        <p class="hint" style="margin-top:8px">What this vibemate can load on request.${geekTip(`Listed in this vibemate's brief by name and description; the text arrives when you write /name or when the vibemate loads it. ${esc(skillChannelText(p))}`)}</p>
        ${saveRow("pp-skills-save")}
      </div>
      <div class="section" id="pp-timing">
        ${sectionTitle("bolt", "Timing")}
        ${field("Reply delay override, seconds", `<input type="number" id="pp-delay" min="0" max="120" step="0.5" value="${p.replyDelay ?? ""}" placeholder="the room's: ${room.settings.replyDelay ?? 4} s">`, `Overrides the room's delay (${room.settings.replyDelay ?? 4} s, used only when two or more vibemates are in) for this vibemate only, even when it is alone. Empty: it follows the room.`, "Before each turn the vibemate waits a random 0–N seconds, so replies cross less often. Messages that arrive during the wait land in its backlog, so it can react to them or stay silent.")}
        ${saveRow("pp-delay-save")}
      </div>
      <div class="section">
        ${sectionTitle("link", "Session")}
        <div id="pp-config"></div>
      </div>
      <div class="section">
        ${sectionTitle("info", "Stats")}
        <div class="kv">
          <span>Session</span><span>${p.sessionOrigin === "loaded" ? "restored (session/load)" : p.sessionOrigin === "replayed" ? "new, history replayed" : p.status === "offline" ? "offline" : "new"}${p.supportsLoad === false ? " · no session/load" : ""}</span>
          <span>Turns</span><span>${p.turns}</span>
          <span>Briefs sent</span><span>${p.briefsSent ?? 0}</span>
          <span>Referee reminders</span><span>${p.violations ?? 0}</span>
          <span>Hidden retries</span><span>${p.retries ?? 0}</span>
          <span>Failed turns</span><span>${p.failedTurns ?? 0}</span>
          <span>Context</span><span>${p.contextSize ? `${fmtTokens(p.contextUsed)} / ${fmtTokens(p.contextSize)}` : "—"}</span>
          <span>Cost (estimate)</span><span>${fmtCost(p.cost) || "—"}</span>
          <span>Adapter</span><span>${esc(rec ? rec.label : p.agentLabel || "")}${p.agentInfo && p.agentInfo.version ? ` ${esc(p.agentInfo.version)}` : ""}</span>
        </div>
      </div>`,
        "skills, timing, session, stats",
      )}`;
    wireDetailsClose();
    els.detailsInner.querySelectorAll(".action").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.dataset.act;
        try {
          if (act === "mention") insertMention(p.name);
          else if (act === "remove") {
            if (await confirmDialog(`${p.name} leaves the room and its session is closed. The history stays.`, { title: `Remove ${p.name}?`, okLabel: "Remove", danger: true })) {
              await post(roomApi(`/participants/${encodeURIComponent(p.id)}/remove`));
              closeDetails();
            }
          } else if (act === "reconnect") openReconnectDialog(room);
          else await post(roomApi(`/participants/${encodeURIComponent(p.id)}/${act}`));
        } catch (e) {
          showError(e);
        }
      });
    });
    $("#pp-avatar-picker").appendChild(
      window.Avatars.pickerElement(p.avatar || "", (emoji) => {
        $("#pp-avatar").value = emoji;
        $("#pp-avatar").dispatchEvent(new Event("input", { bubbles: true }));
      }),
    );
    renderSkillChecks($("#pp-skills"), p.skills || []);
    bindSave($("#pp-skills-section"), $("#pp-skills-save"), () => post(roomApi(`/participants/${encodeURIComponent(p.id)}/persona`), { skills: checkedSkills($("#pp-skills")) }));
    bindSave($("#pp-timing"), $("#pp-delay-save"), () => post(roomApi(`/participants/${encodeURIComponent(p.id)}/persona`), { replyDelay: $("#pp-delay").value === "" ? null : Number($("#pp-delay").value) }));
    bindSave($("#pp-persona"), $("#pp-save"), () => post(roomApi(`/participants/${encodeURIComponent(p.id)}/persona`), { name: $("#pp-name").value, tagline: $("#pp-tagline").value, role: $("#pp-role").value, avatar: $("#pp-avatar").value }));
    renderConfig($("#pp-config"), p, offline);
  }

  function flattenOptions(options) {
    const out = [];
    for (const entry of options || []) {
      if (entry && Array.isArray(entry.options)) out.push(...entry.options);
      else out.push(entry);
    }
    return out;
  }

  function renderConfig(panel, p, offline) {
    panel.innerHTML = "";
    if (offline) {
      panel.innerHTML = `<p class="hint">Offline. Reconnect to start a new session (${esc([p.launch && p.launch.model, p.launch && p.launch.effort, p.launch && p.launch.mode].filter(Boolean).join(" · ") || "vibemate defaults")}).</p>`;
      return;
    }
    const addSelect = (name, values, current, onChange) => {
      const label = document.createElement("label");
      label.className = "row";
      label.innerHTML = `<span>${esc(name)}</span>`;
      const select = document.createElement("select");
      for (const v of values) {
        const opt = document.createElement("option");
        opt.value = v.value;
        opt.textContent = v.name || v.value;
        if (v.description) opt.title = v.description;
        if (v.value === current) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener("change", () => onChange(select.value));
      label.appendChild(select);
      panel.appendChild(label);
    };
    const hasModeOption = (p.configOptions || []).some((o) => o.category === "mode");
    if (!hasModeOption && p.modes && p.modes.length) {
      addSelect("Mode", p.modes.map((m) => ({ value: m.id, name: m.name || m.id, description: m.description })), p.mode, (value) => post(roomApi(`/participants/${encodeURIComponent(p.id)}/config`), { configId: "mode", value }).catch(showError));
    }
    for (const option of p.configOptions || []) {
      if (option.type !== "select") continue;
      addSelect(option.name, flattenOptions(option.options), option.currentValue, (value) => post(roomApi(`/participants/${encodeURIComponent(p.id)}/config`), { configId: option.id, value }).catch(showError));
    }
    if (!panel.children.length) panel.innerHTML = '<p class="hint">This vibemate exposes no session options.</p>';
  }

  function renderMePanel(room) {
    const s = state.settings || {};
    const rs = room && state.view === "room" ? room.settings : null;
    els.detailsInner.innerHTML = `
      ${panelTitle("Your vibe", "how the vibemates know you")}
      <div class="profile">
        ${avatar(meAvatarData(), 84, {})}
        <h3>${esc(s.humanName || "")}</h3>
        <div class="tagline">${esc(s.humanDescription || "no vibe line yet")}</div>
      </div>
      <div class="section" id="me-vibe">
        ${sectionTitle("spark", "Vibe")}
        ${field("Vibename", `<input type="text" id="me-name" maxlength="24" value="${esc(s.humanName || "")}">`, "How you appear in every room.")}
        ${field("Vibeface", `<div id="me-avatar-picker"></div><input type="text" id="me-avatar" maxlength="8" value="${esc(s.humanAvatar || "")}" placeholder="custom emoji (optional)">`)}
        ${field("Your vibe line", `<textarea id="me-desc" rows="3" maxlength="200" placeholder="e.g. software engineer, curious about agent protocols; likes short answers">${esc(s.humanDescription || "")}</textarea>`, "A sentence or two about you.", "The vibemates get it in every room's brief, unless a room adds its own line or replaces it (below, when you are in a room).")}
        ${saveRow("me-save")}
      </div>
      ${
        rs
          ? `<div class="section" id="me-room">
        ${sectionTitle("chat", "In this room")}
        ${field("What vibemates get about you here", `<select id="hp-mode"><option value="inherit"${rs.humanDescriptionMode === "inherit" ? " selected" : ""}>Your vibe line</option><option value="append"${rs.humanDescriptionMode === "append" ? " selected" : ""}>Your vibe line + this room's</option><option value="override"${rs.humanDescriptionMode === "override" ? " selected" : ""}>Only this room's line</option><option value="none"${rs.humanDescriptionMode === "none" ? " selected" : ""}>Nothing about me in this room</option></select>`)}
        ${field("This room's line about you", `<textarea id="hp-desc" rows="3" maxlength="200" placeholder="e.g. host of this session, product owner">${esc(rs.humanDescription || "")}</textarea>`)}
        ${saveRow("hp-save")}
      </div>`
          : ""
      }
      <div class="section danger">
        ${sectionTitle("alert", "Danger zone")}
        <p class="field-note">Erases everything in this viberoom: your vibe, all rooms and their history, vibemate sessions, your skills. Not undoable.</p>
        <div class="row-btns start"><button class="btn danger sm" id="me-erase">${ic("bolt")}Erase my vibe</button></div>
      </div>`;
    wireDetailsClose();
    $("#me-avatar-picker").appendChild(
      window.Avatars.pickerElement(s.humanAvatar || "", (emoji) => {
        $("#me-avatar").value = emoji;
        $("#me-avatar").dispatchEvent(new Event("input", { bubbles: true }));
      }),
    );
    bindSave($("#me-vibe"), $("#me-save"), () => post("/api/settings", { humanName: $("#me-name").value, humanAvatar: $("#me-avatar").value, humanDescription: $("#me-desc").value }));
    bindSave($("#me-room"), $("#hp-save"), () => post(roomApi("/settings"), { humanDescriptionMode: $("#hp-mode").value, humanDescription: $("#hp-desc").value }));
    $("#me-erase").addEventListener("click", openEraseDialog);
  }

  function renderRoomPanel(room) {
    const rs = room.settings;
    const lang = rs.language && rs.language.mode === "fixed" ? rs.language.language : "";
    els.detailsInner.innerHTML = `
      ${panelTitle("Room settings", esc(room.name))}
      <div id="rp-form">
      <div class="section">
        ${sectionTitle("rooms", "Room")}
        ${field("Name", `<input type="text" id="rp-name" maxlength="60" value="${esc(room.name)}">`)}
        ${field("Emoji", `<div id="rp-emoji-picker"></div><input type="text" id="rp-emoji" maxlength="8" value="${esc(rs.emoji || "")}" placeholder="custom emoji (optional)">`, "A face for the room, next to its name.")}
        ${field("Topic", `<input type="text" id="rp-topic" maxlength="2000" value="${esc(rs.topic || "")}" placeholder="what this room is about (optional)">`)}
        ${field("Folder", `<input type="text" id="rp-dir" maxlength="1000" value="${esc(room.dir)}" spellcheck="false">`, "Where the vibemates read and write. Changing it restarts them in the new folder; they replay the last messages.")}
        <label class="field mention-host"><span class="label">Custom rules${geekTip("References follow renames and note when a participant has left. Rules go into every vibemate's brief as instructions, not as routing.")}</span><textarea id="rp-rules" rows="5" maxlength="4000" placeholder="e.g. Everyone listens to @Pesho, he is the manager.&#10;Keep answers under 3 sentences.">${esc(room.customRulesText != null ? room.customRulesText : rs.customRules || "")}</textarea><span class="hint">One rule per line; type @ to reference a participant.</span><div class="mention-menu inline" id="rp-rules-menu" hidden></div></label>
        ${field("Language", `<input type="text" id="rp-lang" value="${esc(lang)}" placeholder="follow the human (default), or e.g. English">`)}
      </div>
      <div class="section">
        ${sectionTitle("user", "Turn taking")}
        ${field("Who may speak", `<select id="rp-turns"><option value="one-at-a-time"${rs.turnTaking !== "parallel" ? " selected" : ""}>One vibemate at a time</option><option value="parallel"${rs.turnTaking === "parallel" ? " selected" : ""}>All addressed vibemates at once</option></select>`, null, "One at a time: the others queue and see the earlier replies before they answer; the addressed vibemates go first. All at once: fastest, but replies may cross.")}
        ${field("Reply delay, seconds", `<input type="number" id="rp-delay" min="0" max="120" step="0.5" value="${rs.replyDelay ?? 4}">`, "With two or more vibemates, each waits a random 0–N seconds before it answers, so replies cross less often. A vibemate alone answers at once. A vibemate's own delay (in its panel) always applies.")}
        <label class="switch"><span class="label">Wait while you are typing${geekTip("A vibemate about to start holds back while you type (a few seconds after your last keystroke). A reply already under way is not interrupted.")}</span><input type="checkbox" id="rp-wait-typing" ${rs.waitWhileHumanTypes !== false ? "checked" : ""}></label>
      </div>
      ${geek(
        "rp-geek",
        `<div class="section">
        ${sectionTitle("clock", "Right now")}
        <div class="kv">
          <span>Vibemate-to-vibemate replies since your last message</span><span>${room.hops} / ${room.hopLimit}</span>
          <span>Hushed</span><span>${room.focused ? "yes" : "no"}</span>
          <span>Full brief every</span><span>${rs.fullBriefEveryTurns} turns</span>
        </div>
      </div>
      <div class="section">
        ${sectionTitle("chat", "Conversation")}
        ${field("Vibemates' own tools (files, shell, web)", `<select id="rp-tools"><option value="on-request"${rs.tools === "on-request" ? " selected" : ""}>Only when someone explicitly asks</option><option value="never"${rs.tools === "never" ? " selected" : ""}>Never (chat only)</option></select>`, null, "An instruction in every vibemate's brief; the vibemate's mode is the real limit.")}
        ${field("Max sentences per reply", `<input type="number" id="rp-maxlen" min="1" max="100" value="${rs.maxSentences ?? ""}" placeholder="no limit">`)}
        ${field("Hop limit (vibemate-to-vibemate replies per human message)", `<input type="number" id="rp-hops" min="0" max="10000" value="${rs.hopLimit}">`)}
      </div>
      <div class="section">
        ${sectionTitle("eye", "Referee")}
        ${field("When a reply breaks a mechanical rule (unknown @, self-@, length)", `<select id="rp-referee"><option value="next-header"${rs.refereeAction !== "retry-hidden" ? " selected" : ""}>Post it; remind the agent in its next header</option><option value="retry-hidden"${rs.refereeAction === "retry-hidden" ? " selected" : ""}>Hold it; ask for a corrected version in a hidden turn</option></select>`)}
      </div>
      <div class="section">
        ${sectionTitle("save", "Instruction delivery")}
        ${field("Full brief every N vibemate turns", `<input type="number" id="rp-brief-turns" min="1" max="10000" value="${rs.fullBriefEveryTurns}">`)}
        ${field("…or every N new context tokens", `<input type="number" id="rp-brief-tokens" min="1000" max="10000000" step="1000" value="${rs.fullBriefEveryTokens}">`)}
        <label class="switch"><span class="label">Repeat core rules in every header</span><input type="checkbox" id="rp-header-rules" ${rs.headerRules ? "checked" : ""}></label>
        <label class="switch"><span class="label">Show vendor and model to other vibemates</span><input type="checkbox" id="rp-vendor" ${rs.showVendorInRoster ? "checked" : ""}></label>
        ${field("Replay last N chat messages after a reconnect", `<input type="number" id="rp-replay" min="0" max="200" value="${rs.replayAfterRestart}">`)}
      </div>`,
        "tools, hops, referee, briefs",
      )}
      <div class="save-row" style="margin-top:10px"><span class="hint">The vibemates get the changes on their next turn.</span><button class="btn sm primary save" id="rp-save" disabled>Save</button></div>
      </div>
      <div class="section danger" style="margin-top:12px">
        ${sectionTitle("alert", "Danger zone")}
        <p class="field-note">Closes every vibemate in this room and removes it from the list. The history file stays on disk.</p>
        <div class="row-btns start"><button class="btn danger sm" id="rp-delete">${ic("trash")}Close this room for good</button></div>
      </div>`;
    wireDetailsClose();
    attachMentions($("#rp-rules"), $("#rp-rules-menu"));
    $("#rp-emoji-picker").appendChild(
      emojiGrid(ROOM_EMOJI, rs.emoji || "", (emoji) => {
        $("#rp-emoji").value = emoji;
        $("#rp-emoji").dispatchEvent(new Event("input", { bubbles: true }));
      }),
    );
    bindSave($("#rp-form"), $("#rp-save"), async () => {
        const name = $("#rp-name").value;
        if (name.trim() !== room.name) await post(roomApi("/rename"), { name });
        const dir = $("#rp-dir").value.trim();
        if (dir && dir !== room.dir) await post(roomApi("/dir"), { dir });
        await post(roomApi("/settings"), {
          emoji: $("#rp-emoji").value,
          topic: $("#rp-topic").value,
          customRules: $("#rp-rules").value,
          language: $("#rp-lang").value.trim() || "follow-human",
          tools: $("#rp-tools").value,
          maxSentences: $("#rp-maxlen").value === "" ? null : Number($("#rp-maxlen").value),
          hopLimit: Number($("#rp-hops").value),
          fullBriefEveryTurns: Number($("#rp-brief-turns").value),
          fullBriefEveryTokens: Number($("#rp-brief-tokens").value),
          headerRules: $("#rp-header-rules").checked,
          showVendorInRoster: $("#rp-vendor").checked,
          replayAfterRestart: Number($("#rp-replay").value),
          refereeAction: $("#rp-referee").value,
          turnTaking: $("#rp-turns").value,
          waitWhileHumanTypes: $("#rp-wait-typing").checked,
          replyDelay: Number($("#rp-delay").value),
        });
    });
    $("#rp-delete").addEventListener("click", async () => {
      if (!(await confirmDialog("Every vibemate in it is closed and the room leaves the list. The history file stays on disk.", { title: `Close "${room.name}" for good?`, okLabel: "Close the room", danger: true }))) return;
      try {
        await post(roomApi("/delete"));
      } catch (e) {
        showError(e);
      }
    });
  }


  function renderSettingsPage() {
    const s = state.settings || { humanName: "", humanDescription: "", humanAvatar: "", roomDefaults: {}, vendorPresets: {} };
    const d = Object.assign({}, state.roomDefaults || {}, s.roomDefaults || {});
    const installed = state.recipes.filter((r) => !r.unavailableReason);
    const missing = state.recipes.filter((r) => r.unavailableReason);
    const dg = s.diagrams || { preset: "lavender", primary: null };
    const presets = installed
      .map((r) => {
        const v = (s.vendorPresets || {})[r.id] || {};
        return `<div class="vendor-card">
          <div class="vc-head"><span class="vc-logo">${r.icon ? `<img src="${esc(r.icon)}" alt="" onerror="this.replaceWith(document.createTextNode('${esc(r.vendor[0])}'))">` : esc(r.vendor[0])}</span><span class="vc-name">${esc(r.vendor)}</span><span class="badge status-idle"><span class="dot"></span>installed</span></div>
          <div class="vc-fields">
            ${field("Model", `<input type="text" data-vendor="${r.id}" data-key="model" value="${esc(v.model || "")}" placeholder="${esc(r.defaultModel || "vibemate default")}">`)}
            ${field("Effort", `<input type="text" data-vendor="${r.id}" data-key="effort" value="${esc(v.effort || "")}" placeholder="${esc(r.defaultEffort || "vibemate default")}">`)}
            ${field("Mode", `<input type="text" data-vendor="${r.id}" data-key="mode" value="${esc(v.mode || "")}" placeholder="${esc(r.defaultMode || "vibemate default")}">`)}
          </div>
        </div>`;
      })
      .join("");
    const logo = (r) => `<span class="vc-logo">${r.icon ? `<img src="${esc(r.icon)}" alt="" onerror="this.replaceWith(document.createTextNode('${esc(r.vendor[0])}'))">` : esc(r.vendor[0])}</span>`;
    const machine =
      installed.map((r) => `<div class="vendor-row">${logo(r)}<span class="vc-name">${esc(r.vendor)}<span class="hint" title="${esc(r.installedAt || "")}">${esc(r.installedAt || "bundled")}</span></span><span class="badge status-idle"><span class="dot"></span>installed</span></div>`).join("") +
      missing.map((r) => `<div class="vendor-row" style="opacity:.75">${logo(r)}<span class="vc-name">${esc(r.vendor)}<span class="hint">${esc(r.installHint || r.unavailableReason || "")}</span></span><span class="badge status-offline">not installed</span></div>`).join("");
    els.pageInner.innerHTML = `
      <div class="page-head"><div><h1>Settings</h1><div class="hint">${state.version ? `${esc(state.version.name)} ${esc(state.version.version)} · hub built ${esc(new Date(state.version.build).toLocaleString())}` : "hub build unknown (older hub process; run viberoom again to replace it)"}</div></div><div class="row-btns"><button class="btn primary save" id="sp-save" disabled>Save</button></div></div>
      <div id="sp-form">
      <div class="page-cols">
        <div>
          <div class="section">
            ${sectionTitle("lock", "Permissions")}
            <label class="switch"><span class="label">Vibemates act without asking<span class="hint">Off: they ask you before editing files or running commands.</span>${geekTip('New vibemates start in their vendor\'s "act without asking" mode (Claude bypassPermissions, Codex agent-full-access, Gemini yolo, Cursor agent, OpenCode build, Copilot agent + allow_all). Change it per vibemate when summoning one, or later in its panel.')}</span><input type="checkbox" id="sp-bypass" ${s.bypassPermissionsByDefault !== false ? "checked" : ""}></label>
          </div>
          <div class="section">
            ${sectionTitle("bolt", "Pace")}
            ${field("Turn taking in new rooms", `<select id="sp-turns"><option value="one-at-a-time"${d.turnTaking !== "parallel" ? " selected" : ""}>One vibemate at a time</option><option value="parallel"${d.turnTaking === "parallel" ? " selected" : ""}>All addressed vibemates at once</option></select>`)}
            ${field("Reply delay in new rooms, seconds", `<input type="number" id="sp-delay" min="0" max="120" step="0.5" value="${d.replyDelay ?? 4}">`, "Used when two or more vibemates share a room; each room can change it; a vibemate can override it in its own panel.", "Before each turn a vibemate waits a random 0–N seconds, so replies cross less often. Messages that arrive meanwhile land in its backlog. A vibemate alone answers at once unless it has its own delay.")}
          </div>
          <div class="section" id="sp-editor">
            ${sectionTitle("pencil", "Open files at a line")}
            <label class="field"><span class="label">A click on a path like main.ts:375 opens the file in${geekTip("Only an editor can jump to a line; the OS default app just opens the file. Auto looks for VS Code, Cursor, Windsurf, Zed, Sublime Text, Notepad++ and the JetBrains IDEs, in that order, on PATH and in their usual folders. Custom: a command with {file}, {line} and {column} placeholders, e.g. code --goto {file}:{line}.")}</span>
              <div class="chips editor-modes">
                <button type="button" class="chip-btn${(s.editor || {}).mode === "custom" ? "" : (s.editor || {}).mode === "default-app" ? "" : " on"}" data-mode="auto">Auto <span class="hint" id="sp-editor-auto">…</span></button>
                <button type="button" class="chip-btn${(s.editor || {}).mode === "default-app" ? " on" : ""}" data-mode="default-app">The default app</button>
                <button type="button" class="chip-btn${(s.editor || {}).mode === "custom" ? " on" : ""}" data-mode="custom">My own command</button>
              </div>
              <input type="hidden" id="sp-editor-mode" value="${esc((s.editor || {}).mode || "auto")}">
            </label>
            ${field("Command", `<input type="text" id="sp-editor-cmd" maxlength="500" value="${esc((s.editor || {}).command || "")}" placeholder="code --goto {file}:{line}">`, "{file}, {line} and {column} are filled in; quotes group arguments.")}
          </div>
          <div class="section" id="sp-diagrams">
            ${sectionTitle("wand", "Diagrams")}
            <div class="field"><span class="label">Colours of the boxes${geekTip("Vibemates draw diagrams as Mermaid (a ```mermaid block in a message); the room renders them here, with these colours. Mermaid derives the shades of borders and text from the box colour.")}</span>
              <div class="chips diagram-presets">${Object.entries(DIAGRAM_PRESETS).map(([id, p]) => `<button type="button" class="chip-btn${dg.preset === id ? " on" : ""}" data-preset="${id}"><span class="swatch" style="${p.palette ? `background:linear-gradient(90deg, ${p.palette.map((c) => c.fill).join(", ")});border-color:${p.palette[0].stroke}` : `background:${p.primaryColor};border-color:${p.primaryBorderColor}`}"></span>${p.label}</button>`).join("")}</div>
              <input type="hidden" id="sp-diagram-preset" value="${esc(dg.preset)}">
            </div>
            <label class="switch"><span class="label">My own colour for the boxes</span><input type="checkbox" id="sp-diagram-custom" ${dg.primary ? "checked" : ""}></label>
            <div class="field row" id="sp-diagram-color-row" ${dg.primary ? "" : "hidden"}><span class="label">Box colour</span><input type="color" id="sp-diagram-color" value="${esc(dg.primary || "#ece9ff")}" style="width:46px;height:30px;padding:2px"></div>
            ${mermaidBlock("graph LR\n  A[You] --> B(Vibemate)\n  B --> C{Agreed?}\n  C -->|yes| D[Done]\n  C -->|no| B").replace('class="mermaid-block"', 'class="mermaid-block preview"')}
          </div>
        </div>
        <div>
          <div class="section">
            ${sectionTitle("spark", "Vibemates on this machine")}
            ${machine || '<p class="hint">No supported vibemate is installed yet.</p>'}
          </div>
        </div>
      </div>
      ${geek(
        "sp-geek",
        `<div class="page-cols">
        <div>
          <div class="section">
            ${sectionTitle("rooms", "Defaults for new rooms")}
            <p class="field-note">Every new room starts with these; each room can change them in its own settings.</p>
            ${field("Hop limit", `<input type="number" id="sp-hops" min="0" max="10000" value="${d.hopLimit}">`, "How many vibemate-to-vibemate replies may follow one message of yours before the room waits for you again.")}
            ${field("Full brief every N turns", `<input type="number" id="sp-brief-turns" min="1" max="10000" value="${d.fullBriefEveryTurns}">`, "How often a vibemate gets the whole room brief again instead of the short header.")}
            ${field("Full brief every N tokens", `<input type="number" id="sp-brief-tokens" min="1000" max="10000000" step="1000" value="${d.fullBriefEveryTokens}">`, "…or after this much new context since its last full brief, whichever comes first.")}
            <label class="switch"><span class="label">Repeat core rules in every header<span class="hint">The short header before each turn repeats the room's core rules (who is here, how to address, how long to write).</span></span><input type="checkbox" id="sp-header-rules" ${d.headerRules ? "checked" : ""}></label>
            ${field("Tools", `<select id="sp-tools"><option value="on-request"${d.tools === "on-request" ? " selected" : ""}>Only when asked</option><option value="never"${d.tools === "never" ? " selected" : ""}>Never</option></select>`, "Whether vibemates may use their own tools (files, shell, web) without being asked to.")}
          </div>
          <div class="section">
            ${sectionTitle("skills", "Skills from vibemates")}
            <label class="switch"><span class="label">Vibemate-created skills need my approval<span class="hint">Off: a skill a vibemate creates is usable at once and shows as "unreviewed" until you open it. On: it stays a draft (not delivered, not attachable) until you approve it under Skills.</span></span><input type="checkbox" id="sp-skill-approval" ${s.agentSkillsNeedApproval ? "checked" : ""}></label>
          </div>
        </div>
        <div>
          <div class="section">
            ${sectionTitle("settings", "Presets per vibemate")}
            <p class="hint" style="margin-bottom:10px">Used when you summon one; leave a field empty for the built-in suggestion. The summon dialog always shows what the vibemate really offers. Bypass modes: Claude bypassPermissions, Codex agent-full-access, Gemini yolo, Cursor agent, OpenCode build, Copilot agent + allow_all.</p>
            ${presets || '<p class="hint">No supported vibemate is installed yet.</p>'}
          </div>
        </div>
      </div>`,
        "room defaults, presets per vibemate, vibemate skills",
      )}
      </div>`;
    const editorSection = $("#sp-editor");
    const editorCmdRow = $("#sp-editor-cmd").closest(".field");
    const showEditorCmd = () => (editorCmdRow.hidden = $("#sp-editor-mode").value !== "custom");
    showEditorCmd();
    editorSection.querySelectorAll(".editor-modes .chip-btn").forEach((b) =>
      b.addEventListener("click", () => {
        editorSection.querySelectorAll(".editor-modes .chip-btn").forEach((x) => x.classList.toggle("on", x === b));
        const input = $("#sp-editor-mode");
        input.value = b.dataset.mode;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        showEditorCmd();
      }),
    );
    get("/api/editor")
      .then((r) => {
        const auto = $("#sp-editor-auto");
        if (auto) auto.textContent = r.editor ? `(${r.editor.label})` : "(none found)";
      })
      .catch(() => undefined);
    const diagramSection = $("#sp-diagrams");
    const previewTheme = () => ({ preset: $("#sp-diagram-preset").value, primary: $("#sp-diagram-custom").checked ? $("#sp-diagram-color").value : null });
    const redrawPreview = () => {
      const block = diagramSection.querySelector(".mermaid-block.preview");
      delete block.dataset.rendered;
      block.querySelector(".mm-out").innerHTML = `<pre>${esc(block.dataset.src)}</pre>`;
      renderDiagrams(diagramSection, previewTheme());
    };
    diagramSection.querySelectorAll(".diagram-presets .chip-btn").forEach((b) =>
      b.addEventListener("click", () => {
        diagramSection.querySelectorAll(".diagram-presets .chip-btn").forEach((x) => x.classList.toggle("on", x === b));
        const input = $("#sp-diagram-preset");
        input.value = b.dataset.preset;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        redrawPreview();
      }),
    );
    $("#sp-diagram-custom").addEventListener("change", () => {
      $("#sp-diagram-color-row").hidden = !$("#sp-diagram-custom").checked;
      redrawPreview();
    });
    $("#sp-diagram-color").addEventListener("input", redrawPreview);
    renderDiagrams(diagramSection, previewTheme());
    bindSave($("#sp-form"), $("#sp-save"), async () => {
        const vendorPresets = {};
        els.pageInner.querySelectorAll("input[data-vendor]").forEach((inp) => {
          vendorPresets[inp.dataset.vendor] = vendorPresets[inp.dataset.vendor] || { model: null, effort: null, mode: null };
          vendorPresets[inp.dataset.vendor][inp.dataset.key] = inp.value.trim() || null;
        });
        await post("/api/settings", {
          bypassPermissionsByDefault: $("#sp-bypass").checked,
          agentSkillsNeedApproval: $("#sp-skill-approval").checked,
          diagrams: { preset: $("#sp-diagram-preset").value, primary: $("#sp-diagram-custom").checked ? $("#sp-diagram-color").value : null },
          editor: { mode: $("#sp-editor-mode").value, command: $("#sp-editor-cmd").value },
          roomDefaults: {
            turnTaking: $("#sp-turns").value,
            replyDelay: Number($("#sp-delay").value),
            hopLimit: Number($("#sp-hops").value),
            fullBriefEveryTurns: Number($("#sp-brief-turns").value),
            fullBriefEveryTokens: Number($("#sp-brief-tokens").value),
            headerRules: $("#sp-header-rules").checked,
            tools: $("#sp-tools").value,
          },
          vendorPresets,
        });
    });
  }

  function skillBadges(sk) {
    const out = [];
    if (sk.userInvocable === false) out.push('<span class="badge">vibemate only</span>');
    if (sk.agentInvocable === false) out.push('<span class="badge">human only</span>');
    if (sk.author && sk.author !== "human") out.push(`<span class="badge outline">${esc(sk.author === "viberoom" ? "built-in" : `by ${sk.author.replace(/^agent:/, "").replace(/@.*$/, "")} (agent)`)}</span>`);
    if (sk.draft) out.push('<span class="badge status-queued">draft: awaiting your approval</span>');
    else if (sk.reviewed === false) out.push('<span class="badge status-thinking">unreviewed</span>');
    if ((sk.problems || []).length) out.push(`<span class="badge status-error">${esc(sk.problems.join("; "))}</span>`);
    if ((sk.warnings || []).length) out.push(`<span class="badge status-thinking" title="${esc(sk.warnings.join("; "))}">${sk.warnings.length} warning${sk.warnings.length > 1 ? "s" : ""}</span>`);
    return out.join(" ");
  }

  function renderSkillsPage() {
    const skills = state.skills || [];
    const ed = state.skillEditor;
    const editing = ed ? skills.find((sk) => sk.name === ed.name) : null;
    const room = state.skillsRoom ? state.rooms.get(state.skillsRoom) : null;
    if (state.skillsRoom && !room) state.skillsRoom = null;
    const holdersOf = (name) => (room ? skillHolders(room, name) : []);
    const shown = room ? skills.filter((sk) => holdersOf(sk.name).length) : skills;
    const item = (sk) => `<li>
        <div class="sk-main">
          <div class="sk-head"><b>/${esc(sk.name)}</b>${sk.argumentHint ? ` <span class="hint">${esc(sk.argumentHint)}</span>` : ""}${skillBadges(sk)}</div>
          <div class="hint">${esc(sk.description)}</div>
          ${room ? `<div class="hint sk-holders">${ic("user")}${esc(holdersOf(sk.name).map((p) => p.name).join(", "))}</div>` : ""}
        </div>
        <span class="skill-actions">${sk.draft ? `<button class="btn sm primary" data-approve-skill="${esc(sk.name)}">Approve</button>` : ""}<button class="icon-btn sm ghost" data-edit-skill="${esc(sk.name)}" title="Edit this skill">${ic("pencil")}</button></span>
      </li>`;
    const list = shown.length
      ? `<ul class="skill-list">${shown.map(item).join("")}</ul>`
      : `<p class="hint">${room ? "No vibemate in this room has a skill attached yet. Attach one in a vibemate's panel (for geeks)." : "No skills yet. Create one, or let a vibemate write one."}</p>`;
    const editor = ed
      ? `<div class="section skill-editor">
          ${sectionTitle("pencil", editing ? `Edit /${esc(ed.name)}` : "New skill")}
          ${field("Name (also the /command)", `<input type="text" id="sk-name" maxlength="32" value="${esc(ed.name || "")}" ${ed.name ? "disabled" : ""} placeholder="letters, digits, _ or -">`)}
          ${field("Description", `<textarea id="sk-desc" rows="2" maxlength="300">${esc(ed.description || "")}</textarea>`, "What it does and when to use it; this is what triggers it.")}
          ${field("Argument hint (optional, shown in the / menu)", `<input type="text" id="sk-hint" maxlength="80" value="${esc(ed.argumentHint || "")}" placeholder="e.g. [PR number]">`)}
          ${field("Instructions", `<textarea id="sk-body" rows="12" maxlength="20000">${esc(ed.body || "")}</textarea>`, "$ARGUMENTS = what follows /name.")}
          <label class="switch"><span class="label">Human can invoke it with /name</span><input type="checkbox" id="sk-user" ${ed.userInvocable === false ? "" : "checked"}></label>
          <label class="switch"><span class="label">Vibemates may load it themselves</span><input type="checkbox" id="sk-agent" ${ed.agentInvocable === false ? "" : "checked"}></label>
          <p class="error" id="sk-error" hidden></p>
          ${editing && editing.author === "viberoom" ? `<p class="field-note">${ic("lock")} Built-in skill: it comes with viberoom, the hub keeps it up to date, and it is read-only. Copy the text into a new skill to make your own version.</p>` : ""}
          <div class="row-btns">${editing && editing.author !== "viberoom" ? '<button class="btn sm danger" id="sk-delete">Delete</button>' : ""}<span class="saved" id="sk-saved"></span><button class="btn sm ghost" id="sk-cancel">${editing && editing.author === "viberoom" ? "Close" : "Cancel"}</button>${editing && editing.author === "viberoom" ? "" : '<button class="btn sm primary" id="sk-save">Save skill</button>'}</div>
        </div>`
      : "";
    const about = ed
      ? ""
      : `<p class="hint sk-about">A skill is a folder <code>skills/&lt;name&gt;/SKILL.md</code> in the hub's data folder: a description (what triggers it) and the instructions. Attach skills to vibemates in their panels; invoke one with <code>/name</code> in the composer. Vibemates with the hub's tools can create skills too (they load <code>skill-writer</code> first).</p>`;
    els.pageInner.innerHTML = `
      <div class="page-head"><div><h1>${room ? `Skills in ${esc(room.name)}` : "Skills"}</h1><div class="hint">${room ? `${shown.length} of ${skills.length} in the library are attached to a vibemate here` : `${skills.length} skill${skills.length === 1 ? "" : "s"} in the library`}</div></div><div class="row-btns">${room ? `<button class="btn ghost" id="sk-all">${ic("skills")}All skills</button>` : ""}<button class="btn ghost" id="sk-reload" title="Re-read the skills folder">${ic("refresh")}Reload</button><button class="btn primary cta" id="sk-new"><span class="cta-ico">${ic("plus")}</span><span class="label">New skill</span></button></div></div>
      <div class="${ed ? "page-cols" : ""}"><div>${list}${about}</div>${editor}</div>`;
    const all = $("#sk-all");
    if (all)
      all.addEventListener("click", () => {
        state.skillsRoom = null;
        renderSideRooms();
        renderSkillsPage();
      });
    $("#sk-new").addEventListener("click", () => {
      state.skillEditor = { name: "", description: "", argumentHint: "", body: "", userInvocable: true, agentInvocable: true };
      renderSkillsPage();
      const n = $("#sk-name");
      if (n) n.focus();
    });
    $("#sk-reload").addEventListener("click", async () => {
      try {
        state.skills = (await get("/api/skills")).skills || [];
        renderSkillsPage();
      } catch (e) {
        showError(e);
      }
    });
    els.pageInner.querySelectorAll("[data-approve-skill]").forEach((btn) => btn.addEventListener("click", () => post(`/api/skills/${encodeURIComponent(btn.dataset.approveSkill)}/approve`).catch(showError)));
    els.pageInner.querySelectorAll("[data-edit-skill]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          state.skillEditor = (await get(`/api/skills/${encodeURIComponent(btn.dataset.editSkill)}`)).skill;
          renderSkillsPage();
        } catch (e) {
          showError(e);
        }
      });
    });
    if (ed) {
      const skError = (text) => {
        const e = $("#sk-error");
        e.textContent = text;
        e.hidden = !text;
      };
      $("#sk-cancel").addEventListener("click", () => {
        state.skillEditor = null;
        renderSkillsPage();
      });
      const saveBtn = $("#sk-save");
      if (saveBtn) saveBtn.addEventListener("click", async () => {
        try {
          await post("/api/skills", { name: $("#sk-name").value.trim(), description: $("#sk-desc").value, argumentHint: $("#sk-hint").value, body: $("#sk-body").value, userInvocable: $("#sk-user").checked, agentInvocable: $("#sk-agent").checked });
          state.skillEditor = null;
          renderSkillsPage();
          toast("Skill saved.", "info");
        } catch (e) {
          skError(e.message);
        }
      });
      if (editing && editing.author === "viberoom") $(".skill-editor").querySelectorAll("input, textarea").forEach((el) => (el.disabled = true));
      const del = $("#sk-delete");
      if (del) {
        del.addEventListener("click", async () => {
          if (!(await confirmDialog("Its folder is removed; vibemates that had it lose it.", { title: `Delete /${ed.name}?`, okLabel: "Delete", danger: true }))) return;
          try {
            await post(`/api/skills/${encodeURIComponent(ed.name)}/delete`);
            state.skillEditor = null;
            renderSkillsPage();
          } catch (e) {
            skError(e.message);
          }
        });
      }
    }
  }


  function renderSkillChecks(container, selected) {
    container.innerHTML = "";
    const chosen = new Set((selected || []).map((s) => s.toLowerCase()));
    const known = new Set();
    for (const s of state.skills || []) {
      if (s.author === "viberoom") continue;
      known.add(s.name.toLowerCase());
      const row = document.createElement("label");
      row.className = "check-row";
      const broken = (s.problems && s.problems.length) || s.draft;
      row.innerHTML = `<input type="checkbox" value="${esc(s.name)}" ${chosen.has(s.name.toLowerCase()) ? "checked" : ""} ${broken ? "disabled" : ""}><span><b>/${esc(s.name)}</b> <span class="hint">${esc(s.description)}</span>${s.draft ? '<span class="badge status-queued">draft</span>' : ""}${s.problems && s.problems.length ? `<span class="badge status-error">${esc(s.problems.join("; "))}</span>` : ""}</span>`;
      container.appendChild(row);
    }
    for (const name of selected || []) {
      if (known.has(name.toLowerCase())) continue;
      const row = document.createElement("label");
      row.className = "check-row";
      row.innerHTML = `<input type="checkbox" value="${esc(name)}" checked><span><b>/${esc(name)}</b> <span class="badge status-error">missing from the library</span></span>`;
      container.appendChild(row);
    }
    if (!container.children.length) container.innerHTML = '<span class="hint">No skills in the library yet (Skills in the menu).</span>';
  }
  function checkedSkills(container) {
    return [...container.querySelectorAll('input[type="checkbox"]:checked')].map((i) => i.value);
  }
  function skillHolders(room, name) {
    const lower = name.toLowerCase();
    return room.participants.filter((p) => p.kind === "agent" && (p.skills || []).some((s) => s.toLowerCase() === lower));
  }
  function skillChannelText(p) {
    if (p.status === "offline") return "";
    if (p.skillChannel === "tool") return "Loads skills through the load_skill tool (the hub's MCP server; no permission prompts).";
    if (p.skillChannel === "marker") return "Loads skills with the [skill:name] marker in a hidden turn (this vibemate did not take the hub's MCP server).";
    if (p.skillChannel === "pending") return "Deciding how this session loads skills…";
    return "";
  }

  function attachSlashMenu(textarea, menuEl) {
    const m = { open: false, items: [], index: 0, start: -1 };
    function context() {
      const value = textarea.value;
      const caret = textarea.selectionStart ?? value.length;
      const before = value.slice(0, caret);
      const match = before.match(/^((?:@[\p{L}\p{N}_-]+\s+)*)\/([A-Za-z0-9_-]*)$/u);
      if (!match) return null;
      return { start: caret - match[2].length - 1, prefix: match[2] };
    }
    function close() {
      if (!m.open) return;
      m.open = false;
      menuEl.hidden = true;
    }
    function render() {
      const ctx = context();
      const room = currentRoom();
      if (!ctx || !room) return close();
      const q = ctx.prefix.toLowerCase();
      const items = (state.skills || []).filter((s) => s.userInvocable !== false && !(s.problems || []).length && !s.draft && s.name.toLowerCase().startsWith(q));
      if (!items.length) return close();
      m.open = true;
      m.items = items;
      m.start = ctx.start;
      if (m.index >= items.length) m.index = 0;
      menuEl.innerHTML = "";
      items.forEach((s, i) => {
        const holders = skillHolders(room, s.name);
        const b = document.createElement("button");
        b.type = "button";
        b.className = i === m.index ? "active" : "";
        b.innerHTML = `<span class="mm-skill">/${esc(s.name)}</span><span class="mm-sub">${esc(s.argumentHint || s.description)}<br>${holders.length ? `${holders.map((p) => esc(p.name)).join(", ")} ${holders.length === 1 ? "has" : "have"} it` : "nobody in this room has it"}</span>`;
        b.addEventListener("mousedown", (e) => {
          e.preventDefault();
          pick(i);
        });
        menuEl.appendChild(b);
      });
      menuEl.hidden = false;
    }
    function pick(i) {
      const s = m.items[i];
      if (!s) return close();
      const value = textarea.value;
      const caret = textarea.selectionStart ?? value.length;
      textarea.value = `${value.slice(0, m.start)}/${s.name} ${value.slice(caret)}`;
      const pos = m.start + s.name.length + 2;
      textarea.setSelectionRange(pos, pos);
      close();
      textarea.focus();
      autosize();
    }
    textarea.addEventListener("input", () => {
      m.index = 0;
      render();
    });
    textarea.addEventListener("blur", () => setTimeout(close, 150));
    textarea.addEventListener("keydown", (event) => {
      if (!m.open) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        m.index = (m.index + (event.key === "ArrowDown" ? 1 : m.items.length - 1)) % m.items.length;
        render();
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(m.index);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
  }


  function fillSelect(select, values, defaultValue, emptyLabel) {
    select.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = emptyLabel;
    select.appendChild(opt);
    for (const v of values) {
      const entry = typeof v === "string" ? { value: v, name: v } : v;
      const o = document.createElement("option");
      o.value = entry.value;
      o.textContent = entry.name || entry.value;
      o.title = [entry.name && entry.name !== entry.value ? entry.value : "", entry.description || ""].filter(Boolean).join(" · ");
      if (entry.value === defaultValue) o.selected = true;
      select.appendChild(o);
    }
    select.disabled = values.length === 0;
    renderChips(select);
  }
  function renderChips(select) {
    const box = document.querySelector(`.chips[data-for="${select.id}"]`);
    if (!box) return;
    const options = [...select.options];
    const useSelect = options.length > 9;
    box.hidden = useSelect;
    select.hidden = !useSelect;
    if (useSelect) return;
    box.innerHTML = "";
    if (select.disabled) {
      box.innerHTML = '<span class="hint">nothing to choose here</span>';
      return;
    }
    for (const o of options) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `chip-btn${o.selected ? " on" : ""}${o.value === "" ? " none" : ""}`;
      b.textContent = o.textContent;
      if (o.title) b.title = o.title;
      b.addEventListener("click", () => {
        select.value = o.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        renderChips(select);
      });
      box.appendChild(b);
    }
  }
  function presetFor(recipe) {
    const s = state.settings || {};
    const v = (s.vendorPresets || {})[recipe.id] || {};
    const bypass = s.bypassPermissionsByDefault !== false;
    const defaultMode = bypass ? recipe.bypassMode || recipe.defaultMode : recipe.defaultMode;
    return { model: v.model || recipe.defaultModel, effort: v.effort || recipe.defaultEffort, mode: v.mode || defaultMode };
  }
  let optionsRequest = 0;
  async function loadAgentOptions(recipe, refresh) {
    const requestId = ++optionsRequest;
    els.invStatus.textContent = "Asking the vibemate what it offers…";
    els.invStatus.className = "hint accent";
    const preset = presetFor(recipe);
    try {
      const info = await get(`/api/recipes/${encodeURIComponent(recipe.id)}/options${refresh ? "?refresh=1" : ""}`);
      if (requestId !== optionsRequest) return;
      const byCategory = (category) => info.configOptions.find((o) => o.category === category && o.type === "select");
      const model = byCategory("model");
      const effort = byCategory("thought_level");
      const mode = byCategory("mode");
      const parts = [];
      const pick = (values, wanted, current) => (values.some((v) => v.value === wanted) ? wanted : current);
      if (model) {
        const values = flattenOptions(model.options);
        fillSelect(els.invModel, values, pick(values, preset.model, model.currentValue), "vibemate default");
        parts.push(`${values.length} models`);
      }
      if (effort) {
        const values = flattenOptions(effort.options);
        fillSelect(els.invEffort, values, pick(values, preset.effort, effort.currentValue), "vibemate default");
        parts.push(`effort: ${values.length}`);
      }
      if (mode) {
        const values = flattenOptions(mode.options);
        fillSelect(els.invMode, values, pick(values, preset.mode, mode.currentValue), "vibemate default");
        parts.push(`modes: ${values.length}`);
      } else if (info.modes && info.modes.availableModes && info.modes.availableModes.length) {
        const values = info.modes.availableModes.map((m) => ({ value: m.id, name: m.name, description: m.description }));
        fillSelect(els.invMode, values, pick(values, preset.mode, info.modes.currentModeId), "vibemate default");
        parts.push(`modes: ${values.length}`);
      }
      els.invModelCustom.hidden = !info.modelAtLaunch;
      const who = info.agentInfo && info.agentInfo.name ? `${info.agentInfo.name} ${info.agentInfo.version || ""}`.trim() : recipe.vendor;
      els.invStatus.textContent = parts.length ? `Options from ${who} (${parts.join(", ")}; ${(info.durationMs / 1000).toFixed(1)} s)` : `${who} exposes no config options over ACP${info.modelAtLaunch ? "; the model is a launch flag (built-in list, or type one)" : ""}.`;
    } catch (error) {
      if (requestId !== optionsRequest) return;
      els.invStatus.textContent = `Could not read the vibemate's options (${error.message}); showing the built-in list.`;
      els.invStatus.className = "hint error";
    }
  }
  function applyRecipe(refresh) {
    const recipe = state.recipes.find((r) => r.id === els.invType.value);
    if (!recipe) return;
    els.invAgents.querySelectorAll(".agent-tile").forEach((b) => b.classList.toggle("selected", b.dataset.agent === recipe.id));
    const preset = presetFor(recipe);
    const bypassOn = (state.settings || {}).bypassPermissionsByDefault !== false;
    els.invNote.textContent = (recipe.unavailableReason ? `${recipe.note} — ${recipe.unavailableReason}` : recipe.note) + (bypassOn && recipe.bypassMode ? ` Mode defaults to "${recipe.bypassMode}" (acts without asking; change it here or in Settings).` : "");
    els.invSubmit.disabled = !!recipe.unavailableReason;
    els.invWhere.textContent = recipe.unavailableReason ? `Not installed on this machine. To install: ${recipe.installHint || ""}` : `Found on this machine: ${recipe.installedAt || "bundled"}`;
    els.invWhere.className = recipe.unavailableReason ? "hint error" : "hint";
    fillSelect(els.invModel, recipe.modelPresets, preset.model, "vibemate default");
    fillSelect(els.invEffort, recipe.effortPresets, preset.effort, "vibemate default");
    fillSelect(els.invMode, recipe.modePresets, preset.mode, "vibemate default");
    els.invModelCustom.hidden = true;
    els.invModelCustom.value = "";
    els.invStatus.textContent = "";
    if (!recipe.unavailableReason) loadAgentOptions(recipe, refresh);
  }
  function openInvite() {
    if (!currentRoom()) return toast("Open a room first.", "warn");
    els.invError.hidden = true;
    els.invType.innerHTML = "";
    const installed = state.recipes.filter((r) => !r.unavailableReason);
    for (const r of installed) {
      const o = document.createElement("option");
      o.value = r.id;
      o.textContent = r.label;
      els.invType.appendChild(o);
    }
    els.invAgents.innerHTML = state.recipes
      .map(
        (r) =>
          `<button type="button" class="agent-tile${r.unavailableReason ? " off" : ""}" data-agent="${esc(r.id)}" title="${esc(r.unavailableReason ? `Not installed on this machine. ${r.installHint || ""}` : `Found at ${r.installedAt || "bundled"}`)}"><span class="at-logo">${vendorLogo(r)}</span><span class="at-name">${esc(r.vendor)}</span><span class="at-sub">${r.unavailableReason ? "not installed" : "installed"}</span></button>`,
      )
      .join("");
    els.invAgents.querySelectorAll(".agent-tile:not(.off)").forEach((b) =>
      b.addEventListener("click", () => {
        els.invType.value = b.dataset.agent;
        els.invOptions.hidden = false;
        els.invSubmit.disabled = false;
        applyRecipe(false);
      }),
    );
    els.invNone.hidden = installed.length > 0;
    els.invNone.innerHTML = installed.length
      ? ""
      : `No supported vibemate is installed on this machine yet. Install one and open this dialog again: ${state.recipes.map((r) => `<b>${esc(r.vendor)}</b> (<code>${esc(r.installHint || "")}</code>)`).join(", ")}.`;
    els.invSubmit.disabled = true;
    els.invType.value = "";
    els.invOptions.hidden = true;
    els.invWhere.textContent = "";
    els.invNote.textContent = "";
    els.invStatus.textContent = "";
    els.invDelay.value = "";
    els.invDelay.placeholder = `the room's: ${(currentRoom() || {}).settings?.replyDelay ?? 4} s`;
    renderSkillChecks(els.invSkills, []);
    els.invName.value = "";
    els.invAvatar.value = "";
    els.invTagline.value = "";
    els.invRole.value = "";
    els.invAvatarPicker.innerHTML = "";
    els.invAvatarPicker.appendChild(window.Avatars.pickerElement("", (emoji) => (els.invAvatar.value = emoji)));
    els.invGeek.open = false;
    openDialog(els.dialog);
    els.invName.focus();
  }
  async function submitInvite(event) {
    event.preventDefault();
    if (!els.invType.value) {
      els.invError.textContent = "Pick a vibemate first.";
      els.invError.hidden = false;
      return;
    }
    els.invSubmit.disabled = true;
    els.invSubmit.classList.add("loading");
    els.invError.hidden = true;
    try {
      await post(roomApi("/invite"), {
        agentType: els.invType.value,
        name: els.invName.value.trim(),
        avatar: els.invAvatar.value.trim() || null,
        tagline: els.invTagline.value.trim() || null,
        role: els.invRole.value.trim() || null,
        model: els.invModelCustom.value.trim() || els.invModel.value || null,
        effort: els.invEffort.value || null,
        mode: els.invMode.value || null,
        replyDelay: els.invDelay.value === "" ? null : Number(els.invDelay.value),
        skills: checkedSkills(els.invSkills),
      });
      closeDialog(els.dialog);
    } catch (error) {
      els.invError.textContent = error.message;
      els.invError.hidden = false;
    } finally {
      els.invSubmit.disabled = false;
      els.invSubmit.classList.remove("loading");
    }
  }


  const reconnectPrompted = new Set();
  function openReconnectDialog(room) {
    const offline = offlineAgents(room);
    if (!offline.length) return;
    reconnectPrompted.add(room.id);
    els.rcError.hidden = true;
    els.rcReplay.value = room.settings.replayAfterRestart ?? 10;
    els.rcForm.querySelector('input[name="rc-mode"][value="replay"]').checked = true;
    els.rcIntro.textContent = `${offline.length} vibemate${offline.length > 1 ? "s are" : " is"} offline in "${room.name}" (their sessions ended with the previous hub run). Choose how they come back:`;
    els.rcTable.innerHTML = offline
      .map(
        (p) => `<tr data-id="${esc(p.id)}">
          <td>${avatar(p, 28, { vendor: true })}<span><strong>${esc(p.name)}</strong> <span class="rc-note">${esc(p.tagline || p.agentVendor || "")}</span></span></td>
          <td class="rc-note">${p.supportsLoad === false ? "no session/load" : p.sessionId ? "stored session available" : "no stored session"}</td>
          <td><select class="rc-per"><option value="">as above</option><option value="replay">replay</option><option value="load"${p.supportsLoad === false || !p.sessionId ? " disabled" : ""}>full session</option><option value="skip">leave offline</option></select></td>
        </tr>`,
      )
      .join("");
    openDialog(els.rcDialog);
  }
  async function submitReconnect(event) {
    event.preventDefault();
    const room = currentRoom();
    if (!room) return closeDialog(els.rcDialog);
    const globalMode = els.rcForm.querySelector('input[name="rc-mode"]:checked').value;
    const replay = Number(els.rcReplay.value);
    const rows = [...els.rcTable.querySelectorAll("tr")].map((tr) => ({ id: tr.dataset.id, choice: tr.querySelector(".rc-per").value || globalMode }));
    els.rcSubmit.disabled = true;
    els.rcSubmit.classList.add("loading");
    els.rcError.hidden = true;
    const failures = [];
    for (const row of rows) {
      if (row.choice === "skip") continue;
      try {
        await post(roomApi(`/participants/${encodeURIComponent(row.id)}/reconnect`), { mode: row.choice, replay });
      } catch (error) {
        failures.push(`${row.id}: ${error.message}`);
      }
    }
    els.rcSubmit.disabled = false;
    els.rcSubmit.classList.remove("loading");
    if (failures.length) {
      els.rcError.textContent = failures.join(" · ");
      els.rcError.hidden = false;
      return;
    }
    closeDialog(els.rcDialog);
  }
  function maybeOfferReconnect() {
    const room = currentRoom();
    if (!room || state.view !== "room" || reconnectPrompted.has(room.id) || els.rcDialog.open || els.pfDialog.open) return;
    if (offlineAgents(room).length) openReconnectDialog(room);
  }


  function openRoomDialog() {
    els.roomError.hidden = true;
    els.roomName.value = "";
    els.roomDir.value = "";
    openDialog(els.roomDialog);
    els.roomName.focus();
  }
  async function submitRoom(event) {
    event.preventDefault();
    try {
      const res = await post("/api/rooms", { name: els.roomName.value, dir: els.roomDir.value.trim() || null });
      closeDialog(els.roomDialog);
      if (res.room && res.room.id) {
        state.rooms.set(res.room.id, res.room);
        selectRoom(res.room.id);
      }
      for (const n of res.notices || []) toast(n, "info");
    } catch (error) {
      els.roomError.textContent = error.message;
      els.roomError.hidden = false;
    }
  }


  function maybeOfferProfile() {
    const s = state.settings;
    if (!s || s.profileCompleted || els.pfDialog.open) return;
    els.pfName.value = s.humanName && s.humanName !== "Human" ? s.humanName : "";
    els.pfAvatar.value = s.humanAvatar || "";
    els.pfDesc.value = s.humanDescription || "";
    els.pfAvatarPicker.innerHTML = "";
    els.pfAvatarPicker.appendChild(window.Avatars.pickerElement(s.humanAvatar || "", (emoji) => (els.pfAvatar.value = emoji)));
    els.pfError.hidden = true;
    openDialog(els.pfDialog);
    els.pfName.focus();
  }
  els.pfForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await post("/api/settings", { humanName: els.pfName.value.trim(), humanAvatar: els.pfAvatar.value.trim(), humanDescription: els.pfDesc.value.trim(), profileCompleted: true });
      closeDialog(els.pfDialog);
      toast(`Welcome, ${els.pfName.value.trim()}. Open a room and summon a vibemate.`, "info");
    } catch (error) {
      els.pfError.textContent = error.message;
      els.pfError.hidden = false;
    }
  });
  els.pfDialog.addEventListener("cancel", (event) => event.preventDefault());

  function openEraseDialog() {
    els.eraseWord.value = "";
    els.eraseSubmit.disabled = true;
    els.eraseError.hidden = true;
    openDialog(els.eraseDialog);
    els.eraseWord.focus();
  }
  els.eraseWord.addEventListener("input", () => (els.eraseSubmit.disabled = els.eraseWord.value.trim().toLowerCase() !== "erase"));
  els.eraseForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      els.eraseSubmit.classList.add("loading");
      await post("/api/profile/erase", { confirm: els.eraseWord.value.trim().toLowerCase() });
      try {
        localStorage.clear();
      } catch {
      }
      location.href = "/";
    } catch (error) {
      els.eraseSubmit.classList.remove("loading");
      els.eraseError.textContent = error.message;
      els.eraseError.hidden = false;
    }
  });


  function renderAll() {
    renderRail();
    if (state.view === "home") {
      renderSideRooms();
      renderHome();
    } else if ((state.view === "rooms" || state.view === "home")) {
      renderSideRooms();
      renderRoomsGrid();
    } else if (state.view === "room") {
      renderSideRoom();
      renderChatHead();
      renderMessages();
    } else if (state.view === "skills") renderSkillsPage();
    else if (state.view === "settings") renderSettingsPage();
    renderDetails();
  }


  function loadSnapshot(snapshot) {
    state.settings = snapshot.settings;
    state.version = snapshot.version || null;
    state.skills = snapshot.skills || [];
    state.recipes = snapshot.recipes || [];
    state.roomDefaults = snapshot.roomDefaults || null;
    state.rooms = new Map((snapshot.rooms || []).map((r) => [r.id, r]));
    const params = new URLSearchParams(location.search);
    const wanted = params.get("room");
    const remembered = recall("room");
    let openRoom = false;
    if (wanted && state.rooms.has(wanted)) {
      state.currentRoomId = wanted;
      openRoom = true;
    } else if (!state.rooms.has(state.currentRoomId)) {
      state.currentRoomId = state.rooms.has(remembered) ? remembered : null;
      openRoom = !!state.currentRoomId && recall("view") === "room";
    } else openRoom = state.view === "room";
    const participant = params.get("participant");
    if (participant && currentRoom() && findById(currentRoom(), participant)) {
      state.selection = { kind: "participant", id: participant };
      state.detailsOpen = true;
      els.details.hidden = false;
    }
    setView(openRoom && state.currentRoomId && (wanted || state.view === "room") ? "room" : state.view === "room" ? "rooms" : state.view);
    renderDetails();
    maybeOfferProfile();
    if (!els.pfDialog.open) maybeOfferReconnect();
  }

  function onRoomEvent(roomId, event) {
    const room = state.rooms.get(roomId);
    if (!room) return;
    const current = roomId === state.currentRoomId;
    const showing = current && state.view === "room";
    switch (event.type) {
      case "participant": {
        const before = showing ? visibilityFingerprint(room) : "";
        const i = room.participants.findIndex((p) => p.id === event.participant.id);
        if (i >= 0) room.participants[i] = event.participant;
        else room.participants.push(event.participant);
        if (showing) {
          if (visibilityFingerprint(room) !== before) renderMessages();
          else refreshSeen(room);
          renderSideRoom();
          renderChatHead();
          if (state.detailsOpen && state.selection.kind === "participant" && state.selection.id === event.participant.id) {
            if (!editingInDetails()) renderDetails();
            else refreshDetailsHeader(event.participant);
          }
        } else if ((state.view === "rooms" || state.view === "home")) {
          renderSideRooms();
          renderRoomsGrid();
        }
        renderRail();
        return;
      }
      case "participant.removed":
        room.participants = room.participants.filter((p) => p.id !== event.id);
        if (state.selection.kind === "participant" && state.selection.id === event.id) closeDetails();
        if (showing) {
          renderMessages();
          renderSideRoom();
          renderChatHead();
        } else if ((state.view === "rooms" || state.view === "home")) renderRoomsGrid();
        return;
      case "message":
        upsertMessage(roomId, event.message);
        return;
      case "message.removed":
        removeMessage(roomId, event.id);
        return;
      case "messages.truncated":
        room.messages = room.messages.filter((m) => m.seq <= event.fromSeq);
        room.permissions = (room.permissions || []).filter((p) => room.messages.some((m) => m.from === p.participantId && m.streaming));
        if (showing) renderMessages();
        return;
      case "chunk":
        patchMessage(roomId, event.id, (m) => (m.text += event.text));
        return;
      case "thought":
        patchMessage(roomId, event.id, (m) => (m.thought = (m.thought || "") + event.text));
        return;
      case "toolcall":
        patchMessage(roomId, event.id, (m) => {
          m.toolCalls = m.toolCalls || [];
          const i = m.toolCalls.findIndex((c) => c.toolCallId === event.toolCall.toolCallId);
          if (i >= 0) m.toolCalls[i] = event.toolCall;
          else m.toolCalls.push(event.toolCall);
        });
        return;
      case "plan":
        patchMessage(roomId, event.id, (m) => (m.plan = event.entries));
        return;
      case "permission":
        room.permissions.push(event.permission);
        if (showing) renderPermission(room, event.permission);
        else toast(`${(findById(room, event.permission.participantId) || {}).name || "A vibemate"} in "${room.name}" asks for permission.`, "warn");
        return;
      case "permission.resolved":
        room.permissions = room.permissions.filter((p) => p.key !== event.key);
        if (showing) resolvePermissionCard(event.key, event.optionId);
        return;
      case "room":
        room.hopLimit = event.hopLimit;
        room.hops = event.hops;
        room.settings = event.settings;
        room.customRulesText = event.customRulesText != null ? event.customRulesText : room.customRulesText;
        room.focused = event.focused;
        room.name = event.name;
        if (event.dir) room.dir = event.dir;
        if (showing) {
          renderSideRoom();
          renderChatHead();
          if (state.detailsOpen && state.selection.kind === "room" && !editingInDetails()) renderDetails();
        } else if ((state.view === "rooms" || state.view === "home")) {
          renderSideRooms();
          renderRoomsGrid();
        }
        renderRail();
        return;
      case "notice":
        if (current) toast(event.text, event.level);
        return;
      default:
        return;
    }
  }

  let stream = null;
  let releaseTimer = null;
  function connect() {
    if (stream) return;
    const es = new EventSource("/events");
    stream = es;
    es.onopen = () => els.conn.classList.add("ok");
    es.onerror = () => els.conn.classList.remove("ok");
    es.addEventListener("snapshot", (e) => loadSnapshot(JSON.parse(e.data).snapshot));
    es.addEventListener("room.event", (e) => {
      const { roomId, event } = JSON.parse(e.data);
      onRoomEvent(roomId, event);
    });
    es.addEventListener("room.created", (e) => {
      const { room } = JSON.parse(e.data);
      state.rooms.set(room.id, room);
      if ((state.view === "rooms" || state.view === "home")) {
        renderSideRooms();
        renderRoomsGrid();
      }
      renderRail();
    });
    es.addEventListener("room.removed", (e) => {
      const { roomId } = JSON.parse(e.data);
      state.rooms.delete(roomId);
      if (state.currentRoomId === roomId) {
        state.currentRoomId = null;
        state.selection = { kind: "room" };
        closeDetails();
        setView("rooms");
      } else if ((state.view === "rooms" || state.view === "home")) {
        renderSideRooms();
        renderRoomsGrid();
      }
      renderRail();
    });
    es.addEventListener("skills", (e) => {
      state.skills = JSON.parse(e.data).skills || [];
      if (state.view === "skills" && !editingInDetails()) renderSkillsPage();
      if (state.detailsOpen && !editingInDetails()) renderDetails();
    });
    es.addEventListener("settings", (e) => {
      state.settings = JSON.parse(e.data).settings;
      rerenderDiagrams();
      renderRail();
      if (state.view === "settings" && !editingInDetails()) renderSettingsPage();
      if (state.detailsOpen && state.selection.kind === "me" && !editingInDetails()) renderDetails();
      if (state.view === "room") renderSideRoom();
    });
    es.addEventListener("reset", () => location.href = "/");
  }
  function releaseStream() {
    if (!stream) return;
    stream.close();
    stream = null;
    els.conn.classList.remove("ok");
    els.conn.title = "Paused while this tab is in the background; resumes when you come back";
  }
  document.addEventListener("visibilitychange", () => {
    clearTimeout(releaseTimer);
    if (document.hidden) releaseTimer = setTimeout(releaseStream, 15000);
    else {
      els.conn.title = "Connection to the hub";
      connect();
    }
  });


  function autosize() {
    els.input.style.height = "auto";
    els.input.style.height = Math.min(180, els.input.scrollHeight) + "px";
  }
  let typingSentAt = 0;
  els.input.addEventListener("input", () => {
    if (!currentRoom() || !els.input.value.trim()) return;
    const now = Date.now();
    if (now - typingSentAt < 2000) return;
    typingSentAt = now;
    post(roomApi("/typing"), {}).catch(() => undefined);
  });
  els.composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = els.input.value.trim();
    if (!text || !currentRoom()) return;
    els.input.value = "";
    typingSentAt = 0;
    autosize();
    try {
      await post(roomApi("/send"), { text });
    } catch (error) {
      showError(error);
      els.input.value = text;
    }
  });

  function attachMentions(textarea, menuEl, options) {
    const opts = options || {};
    const m = { open: false, items: [], index: 0, start: -1 };
    function context() {
      const value = textarea.value;
      const caret = textarea.selectionStart ?? value.length;
      const before = value.slice(0, caret);
      const match = before.match(/(^|\s)@([\p{L}\p{N}_-]*)$/u);
      if (!match) return null;
      return { start: caret - match[2].length - 1, prefix: match[2] };
    }
    function close() {
      if (!m.open) return;
      m.open = false;
      menuEl.hidden = true;
    }
    function render() {
      const ctx = context();
      const room = currentRoom();
      if (!ctx || !room) return close();
      const q = ctx.prefix.toLowerCase();
      const items = room.participants.filter((p) => (opts.includeHuman || p.id !== "human") && p.name.toLowerCase().startsWith(q));
      if (!items.length) return close();
      m.open = true;
      m.items = items;
      m.start = ctx.start;
      if (m.index >= items.length) m.index = 0;
      menuEl.innerHTML = "";
      items.forEach((p, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = i === m.index ? "active" : "";
        b.innerHTML = `${avatar(p, 24, { vendor: true })}<span>${esc(p.name)}</span><span class="mm-sub">${esc(p.kind === "human" ? "you" : p.tagline || p.agentVendor || "")}${p.status === "offline" ? " · offline" : ""}</span>`;
        b.addEventListener("mousedown", (e) => {
          e.preventDefault();
          pick(i);
        });
        menuEl.appendChild(b);
      });
      menuEl.hidden = false;
    }
    function pick(i) {
      const p = m.items[i];
      if (!p) return close();
      const value = textarea.value;
      const caret = textarea.selectionStart ?? value.length;
      textarea.value = `${value.slice(0, m.start)}@${p.name} ${value.slice(caret)}`;
      const pos = m.start + p.name.length + 2;
      textarea.setSelectionRange(pos, pos);
      close();
      textarea.focus();
      if (opts.onChange) opts.onChange();
    }
    textarea.addEventListener("input", () => {
      m.index = 0;
      render();
      if (opts.onChange) opts.onChange();
    });
    textarea.addEventListener("blur", () => setTimeout(close, 150));
    textarea.addEventListener("keydown", (event) => {
      if (!m.open) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        m.index = (m.index + (event.key === "ArrowDown" ? 1 : m.items.length - 1)) % m.items.length;
        render();
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(m.index);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
  }
  attachMentions(els.input, els.mentionMenu, { onChange: autosize });
  attachSlashMenu(els.input, els.mentionMenu);
  els.input.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      els.composer.requestSubmit();
    }
  });


  els.detailsResizer.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = els.details.getBoundingClientRect().width;
    els.app.classList.add("resizing");
    const move = (e) => applyDetailsWidth(startW + (startX - e.clientX), false);
    const up = (e) => {
      els.app.classList.remove("resizing");
      applyDetailsWidth(startW + (startX - e.clientX), true);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
  els.detailsResizer.addEventListener("dblclick", () => {
    const key = detailsKey();
    remember(`details.${key}`, "");
    applyDetailsWidth(DETAILS_DEFAULT[key] || 400, false);
  });


  els.rail.querySelectorAll(".rail-item[data-nav]").forEach((b) => {
    b.addEventListener("click", () => {
      const nav = b.dataset.nav;
      if (nav === "me") {
        if (state.detailsOpen && state.selection.kind === "me") closeDetails();
        else openDetails({ kind: "me" });
        return;
      }
      if (nav === "room") {
        if (currentRoom()) selectRoom(state.currentRoomId, { keepDetails: true });
        return;
      }
      setView(nav);
      remember("view", nav);
    });
  });
  els.railToggle.addEventListener("click", () => setRailOpen(!els.app.classList.contains("rail-open")));
  function setSideOpen(open) {
    els.app.classList.toggle("side-collapsed", !open);
    remember("sideOpen", open ? "1" : "0");
    els.sideToggle.title = open ? "Fold this column" : "Unfold this column";
    els.sideToggle.innerHTML = ic(open ? "collapse" : "expand");
  }
  els.sideToggle.addEventListener("click", () => setSideOpen(els.app.classList.contains("side-collapsed")));
  setSideOpen(recall("sideOpen") !== "0");
  $("#rail-logo").addEventListener("click", () => setView("home"));
  $("#rail-new-room").addEventListener("click", openRoomDialog);
  const connLabel = $("#conn-label");
  new MutationObserver(() => (connLabel.textContent = els.conn.classList.contains("ok") ? "connected" : "reconnecting…")).observe(els.conn, { attributes: true, attributeFilter: ["class"] });
  if (recall("railOpen") === "1") els.app.classList.add("rail-open");
  els.backToRooms.addEventListener("click", () => {
    setView("rooms");
    remember("view", "rooms");
  });
  els.roomSearch.addEventListener("input", () => {
    state.roomSearch = els.roomSearch.value.trim();
    renderSideRooms();
  });
  els.search.addEventListener("input", () => {
    state.search = els.search.value.trim();
    renderMessages();
  });
  els.inviteBtn.addEventListener("click", openInvite);
  els.invType.addEventListener("change", () => applyRecipe(false));
  els.invRefresh.addEventListener("click", () => applyRecipe(true));
  els.invForm.addEventListener("submit", submitInvite);
  els.roomForm.addEventListener("submit", submitRoom);
  els.reconnectAllBtn.addEventListener("click", () => openReconnectDialog(currentRoom()));
  els.rcForm.addEventListener("submit", submitReconnect);
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeDialog(b.closest("dialog"))));
  els.fvOpen.addEventListener("click", async () => {
    try {
      const r = await post("/api/open", { target: `${els.fvOpen.dataset.path}:1` });
      toast(r.message, "info");
    } catch (err) {
      showError(err);
    }
  });
  els.focusBtn.addEventListener("click", async () => {
    const room = currentRoom();
    if (!room || room.focused || els.focusBtn.classList.contains("busy")) return;
    renderHushButton(room, true);
    try {
      await post(roomApi("/focus"));
    } catch (e) {
      showError(e);
      renderHushButton(room);
    }
  });
  function insertAtCaret(text) {
    const input = els.input;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    const pos = start + text.length;
    input.setSelectionRange(pos, pos);
    autosize();
  }
  function toggleEmojiMenu(open) {
    const menu = els.emojiMenu;
    if (open === undefined) open = menu.hidden;
    if (!open) {
      menu.hidden = true;
      return;
    }
    if (!menu.children.length) {
      menu.appendChild(
        emojiGrid(CHAT_EMOJI, null, (emoji) => {
          insertAtCaret(emoji);
          toggleEmojiMenu(false);
          els.input.focus();
        }),
      );
    }
    menu.hidden = false;
  }
  els.emojiBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleEmojiMenu();
  });
  document.addEventListener("click", (e) => {
    if (!els.emojiMenu.hidden && !(e.target.closest && e.target.closest("#emoji-menu"))) toggleEmojiMenu(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.emojiMenu.hidden) toggleEmojiMenu(false);
  });
  document.addEventListener("click", async (e) => {
    const link = e.target.closest && e.target.closest(".open-link");
    if (link) {
      e.preventDefault();
      try {
        const target = link.dataset.open;
        if (!/^(https?:|mailto:)/i.test(target) && VIEWABLE_RE.test(target)) {
          await viewFile(target);
          return;
        }
        const r = await post("/api/open", { target });
        if (r.action !== "open-url") toast(r.message, "info");
      } catch (err) {
        showError(err);
      }
      return;
    }
    const src = e.target.closest && e.target.closest(".mm-src");
    if (src) {
      const code = src.closest(".mermaid-block, .csv-block").querySelector(".mm-code");
      code.hidden = !code.hidden;
      src.textContent = code.hidden ? "source" : "hide source";
    }
  });
  els.roomSettingsBtn.addEventListener("click", () => openDetails({ kind: "room" }));
  els.chatInfoBtn.addEventListener("click", () => openDetails({ kind: "room" }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.detailsOpen && !document.querySelector("dialog[open]") && !editingInDetails()) closeDetails();
  });
  window.addEventListener("beforeunload", () => remember("view", state.view));

  connect();
})();
