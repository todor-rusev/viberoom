// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(() => {
  "use strict";

  const state = {
    settings: null,
    recipes: [],
    roomDefaults: null,
    logins: new Map(),
    installs: new Map(),
    skills: [],
    looks: [],
    version: null,
    rooms: new Map(),
    currentRoomId: null,
    view: "home",
    selection: { kind: "room" },
    detailsOpen: false,
    unread: new Map(),
    openRooms: [],
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
    fvTools: $("#fv-tools"),
    fvSearch: $("#fv-search"),
    fvHits: $("#fv-hits"),
    fvLine: $("#fv-line"),
    fvWrap: $("#fv-wrap"),
    fvCount: $("#fv-count"),
    rail: $("#rail"),
    railRooms: $("#rail-rooms"),
    railRoomsWrap: $("#rail-rooms-wrap"),
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
    jumpLatest: $("#jump-latest"),
    doneNotes: $("#done-notes"),
    mentionMenu: $("#mention-menu"),
    emojiMenu: $("#emoji-menu"),
    emojiBtn: $("#emoji-btn"),
    sideRoomEmoji: $("#side-room-emoji"),
    composer: $("#composer"),
    shotsTray: $("#shots-tray"),
    quotesTray: $("#quotes-tray"),
    lightbox: $("#lightbox"),
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
    invLogin: $("#inv-login"),
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
    loginDialog: $("#login-dialog"),
    ldBody: $("#ld-body"),
    rcSubmit: $("#rc-submit"),
    eraseDialog: $("#erase-dialog"),
    eraseForm: $("#erase-form"),
    eraseWord: $("#erase-word"),
    eraseError: $("#erase-error"),
    eraseSubmit: $("#erase-submit"),
  };

  const slowTasks = [];
  function busyLabel() {
    try {
      const room = currentRoom();
      const parts = [];
      const streaming = room ? room.messages.filter((m) => m.streaming).length : 0;
      if (streaming) parts.push(`${streaming} reply streaming`);
      if (document.activeElement === els.input) parts.push("composer focused");
      if (room) parts.push(`${room.messages.length} messages`);
      return parts.join(" \u00b7 ");
    } catch {
      return "";
    }
  }
  function noteSlow(name, ms) {
    if (!(ms >= 8)) return;
    slowTasks.push({ at: Date.now(), ms: Math.round(ms), name, busy: busyLabel() });
    if (slowTasks.length > 60) slowTasks.splice(0, slowTasks.length - 40);
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) noteSlow("browser task", e.duration);
    }).observe({ entryTypes: ["longtask"] });
  } catch {
  }

  const FONTS = globalThis.VIBEROOM_TOKENS.fonts;
  const STATUS_LABEL = { unstaffed: "needs a coding agent", starting: "starting…", idle: "ready", queued: "waiting…", thinking: "thinking…", writing: "writing…", error: "needs you", offline: "offline", left: "left" };
  const STATUS_TONE = { idle: "ready", queued: "waiting", starting: "waiting", thinking: "thinking", writing: "writing", error: "attention", offline: "asleep", left: "asleep", unstaffed: "attention" };
  const TOOL_STATUSES = new Set(["pending", "in_progress", "completed", "failed"]);
  const TOKENS = globalThis.VIBEROOM_TOKENS;
  const FALLBACK_COLOR = () => TOKENS.active().elements.face.fallback;
  const WORKING_SVG = '<svg class="working" viewBox="0 0 44 35" aria-hidden="true" title="working…">'
    + '<g class="body">'
    + '<circle cx="20" cy="6.5" r="5.6" fill="currentColor"/>'
    + '<path d="M6 35L13.7 16.5a4 4 0 0 1 8 0L14 35z" fill="currentColor"/>'
    + '</g>'
    + '<g class="forearm far"><path d="M22 25.6h10.5" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round"/></g>'
    + '<path d="M19 19.5L23 27" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round"/>'
    + '<g class="forearm"><path d="M23 27h10.5" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round"/></g>'
    + '<rect x="26" y="30.2" width="15.5" height="3" rx="1" fill="currentColor"/>'
    + '<path d="M35.9 30.2L41.1 14h2.4l-5.1 16.2z" fill="currentColor"/>'
    + '<rect x="18" y="33.2" width="25" height="1.3" rx=".6" fill="currentColor"/>'
    + '</svg>';

  function shownStatus(room, p) {
    if (p.status !== "thinking") return p.status;
    return room.messages.some((m) => m.streaming && m.from === p.id) ? "writing" : "thinking";
  }
  const CHAT_EMOJI = ["😀", "😄", "😂", "🙂", "😉", "😍", "🤔", "😎", "🥳", "😅", "😢", "😡", "👍", "👎", "👋", "🙏", "👏", "💪", "🔥", "✨", "🎉", "❤️", "💜", "✅", "❌", "⚠️", "💡", "🚀", "🐛", "🤖", "🤫", "☕"];
  const ROOM_EMOJI = [
    "🎭", "🚀", "🧪", "🛠️", "🎨", "📚", "🧠", "💬", "🔬", "🎯", "🐙", "☕", "🌈", "🏗️", "🎮", "🔥", "🧩", "📈", "🗺️", "🎧", "🌱", "🏠", "🛸", "🧭",
    "🧑‍💻", "⚒️", "🔨", "🔧", "🔩", "⚙️", "🧰", "🪛", "🧱", "🏭", "🔌", "🖥️", "💻", "⌨️", "🤖", "🐛", "🐞", "⚡", "🔋",
    "📊", "📉", "🧮", "🔍", "🔭", "🧬", "⚗️", "🧲", "📡", "🛰️", "🗄️", "💾", "🗃️", "🌐", "🔗", "☁️",
    "✍️", "📝", "📖", "📰", "📜", "📎", "📌", "🗂️", "🏷️", "✉️", "📣", "🗣️", "🤝", "👥",
    "🖌️", "🖼️", "📷", "🎬", "🎥", "🎵", "🎹", "🎸", "🎤", "🎲", "♟️", "🧸", "🎪", "🎁",
    "📅", "⏰", "⏳", "🗳️", "⚖️", "🧾", "💰", "📦", "🚚", "🛒", "🏦", "🏢", "🎓", "🏫", "🏁", "🏆", "💎",
    "🔐", "🔑", "🛡️", "🚨", "🚦", "🧯", "🩺", "🧹", "♻️", "🧑‍🍳", "🧑‍🔬", "🧑‍🎨", "🧑‍🏫", "🧑‍🚀", "🕵️", "🧙",
    "🦉", "🦊", "🐼", "🐝", "🐢", "🐬", "🦄", "🐲", "🌍", "🌙", "⭐", "🌊", "🏔️", "🏝️", "🌲", "🍀", "🌸", "🍕", "🍎", "✨", "💡", "🔮", "🪄", "❤️",
  ];
  function emojiGrid(list, current, onPick) {
    return window.Avatars.searchableGrid(list, current, onPick, current !== null && current !== undefined ? { label: "—", title: "No emoji" } : null);
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
        toast("Still waiting for the hub… It may be busy or restarting; this window reconnects on its own.", "warn");
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
    return !!el && !!el.closest && (!!el.closest("#details") || !!el.closest("#page-view")) && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
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
    return `<div class="mermaid-block" data-src="${code}"><div class="mm-out"><pre>${code}</pre></div><pre class="mm-code" hidden>${code}</pre><div class="mm-bar"><button type="button" class="mm-src">source</button><button type="button" class="mm-expand" title="See it big (zoom and drag)">${ic("maximize")}</button></div></div>`;
  }
  function mentions(room, html) {
    return html.replace(/(?<![\w.\/:])@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu, (m, name) => {
      if (name.toLowerCase() === "all") return `<span class="mention all">@${esc(name)}</span>`;
      const p = findByName(room, name);
      return p ? `<span class="mention" style="color:${p.color}">@${esc(name)}</span>` : m;
    });
  }
  const md = window.marked ? new window.marked.Marked({ gfm: true, breaks: true }) : null;
  if (md) {
    md.use({
      extensions: [
        {
          name: "loneTilde",
          level: "inline",
          start(src) {
            return src.indexOf("~");
          },
          tokenizer(src) {
            return /^~(?!~)/.test(src) ? { type: "loneTilde", raw: "~", text: "~" } : undefined;
          },
          renderer() {
            return "~";
          },
        },
      ],
      renderer: {
        html(token) {
          return esc(token.text != null ? token.text : token.raw || "");
        },
        code(token) {
          const lang = token.lang || "";
          if (/^\s*(csv|tsv)\b/i.test(lang)) return csvBlock(String(token.text || ""));
          const code = esc(String(token.text || "")).trim();
          if (/^\s*mermaid\b/i.test(lang)) return mermaidBlock(code);
          const id = prismLanguageOf(String(lang).trim().split(/\s+/)[0]);
          return id ? `<pre><code data-lang="${esc(id)}">${code}</code></pre>` : `<pre>${code}</pre>`;
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
        const m = /^<(\/?)(pre|a)\b/i.exec(part);
        if (m) inside += m[1] ? -1 : 1;
        out += part;
      } else out += inside > 0 ? part : mentions(room, linkify(part));
    }
    return out;
  }
  function renderText(room, text, images, quotes) {
    let html = md ? decorate(room, md.parse(String(text == null ? "" : text))) : renderTextLight(room, text);
    if (images && images.length) html = imageRefs(html, images);
    if (quotes && quotes.length) html = quoteRefs(html, quotes);
    return html;
  }
  function quoteRefs(html, quotes) {
    const byN = new Map(quotes.map((q, i) => [q.n || i + 1, q]));
    const placed = new Set();
    const out = html.replace(/\[quote (\d+)\]/gi, (whole, n) => {
      const q = byN.get(Number(n));
      if (!q || placed.has(q)) return whole;
      placed.add(q);
      return quoteCard(q);
    });
    const orphans = quotes.filter((q) => !placed.has(q));
    return orphans.length ? out + orphans.map(quoteCard).join("") : out;
  }
  function quoteCard(q) {
    const head = `${ic("quote")}<b>${esc(q.fromName || "")}</b><span class="q-when">#${esc(String(q.seq))}${q.ts ? ` · ${esc(time(q.ts))}` : ""}</span>`;
    return `<span class="quote" data-seq="${esc(String(q.seq))}" role="button" tabindex="0" title="Go to the message this comes from"><span class="q-head">${head}</span><span class="q-text">${esc(q.text || "")}</span></span>`;
  }
  function imageRefs(html, images) {
    const numbers = new Set(images.map((image, i) => image.n || i + 1));
    return html.replace(/\[img (\d+)\]/gi, (whole, n) =>
      numbers.has(Number(n)) ? `<button type="button" class="img-ref" data-n="${n}" title="Image ${n}">${IMG_GLYPH}<span>${n}</span></button>` : whole,
    );
  }
  const IMG_GLYPH = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="5.6" cy="6.4" r="1.4" fill="currentColor"/><path d="M2.6 12.2l3.4-3.4 2.6 2.6 2.2-2.2 3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
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

  let prismLoading = null;
  function loadPrism() {
    if (window.Prism && window.Prism.highlight) return Promise.resolve(window.Prism);
    if (!prismLoading) {
      window.Prism = window.Prism || {};
      window.Prism.manual = true;
      prismLoading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "/vendor/prism.js";
        s.onload = () => resolve(window.Prism);
        s.onerror = () => reject(new Error("the code colouring script could not be loaded"));
        document.head.appendChild(s);
      });
    }
    return prismLoading;
  }
  const PRISM_NEEDS = { tsx: ["jsx", "typescript"], jsx: [], cpp: ["c"], php: ["markup-templating"], twig: ["markup-templating"], scss: [], docker: [] };
  const prismLanguages = new Map();
  function loadLanguage(id) {
    if (!id) return Promise.resolve(null);
    if (window.Prism && window.Prism.languages && window.Prism.languages[id]) return Promise.resolve(id);
    if (!prismLanguages.has(id)) {
      const load = loadPrism()
        .then(() => Promise.all((PRISM_NEEDS[id] || []).map((need) => loadLanguage(need))))
        .then(
          () =>
            new Promise((resolve) => {
              if (window.Prism.languages[id]) return resolve(id);
              const s = document.createElement("script");
              s.src = `vendor/prism-lang/${encodeURIComponent(id)}.js`;
              s.onload = () => resolve(window.Prism.languages[id] ? id : null);
              s.onerror = () => resolve(null);
              document.head.appendChild(s);
            }),
        )
        .catch(() => null);
      prismLanguages.set(id, load);
    }
    return prismLanguages.get(id);
  }
  const LANGUAGE_ALIASES = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript", node: "javascript",
    py: "python", rb: "ruby", rs: "rust", golang: "go", sh: "bash", shell: "bash", zsh: "bash", console: "bash",
    ps: "powershell", ps1: "powershell", "c++": "cpp", cxx: "cpp", "c#": "csharp", cs: "csharp", yml: "yaml",
    html: "markup", xml: "markup", svg: "markup", vue: "markup", md: "markdown", dockerfile: "docker", make: "makefile",
  };
  function prismLanguageOf(word) {
    const id = String(word || "").toLowerCase();
    if (!id || id === "text" || id === "txt" || id === "plain") return null;
    return LANGUAGE_ALIASES[id] || (/^[a-z0-9-]{1,32}$/.test(id) ? id : null);
  }
  const highlighted = new Map();
  const HIGHLIGHT_CACHE = 200;
  async function highlight(code, language) {
    const key = `${language}::${code}`;
    if (highlighted.has(key)) return highlighted.get(key);
    const id = await loadLanguage(language);
    let html;
    try {
      html = id ? window.Prism.highlight(code, window.Prism.languages[id], id) : esc(code);
    } catch {
      html = esc(code);
    }
    if (highlighted.size >= HIGHLIGHT_CACHE) highlighted.delete(highlighted.keys().next().value);
    highlighted.set(key, html);
    return html;
  }
  async function highlightBlocks(root) {
    const blocks = [...root.querySelectorAll("pre code[data-lang]:not([data-coloured])")];
    for (const block of blocks) {
      block.dataset.coloured = "1";
      const html = await highlight(block.textContent, block.dataset.lang);
      block.innerHTML = html;
    }
  }
  function codeWithGutter(code, language, firstLine) {
    const lines = code.split("\n");
    const start = firstLine || 1;
    const gutter = lines.map((_, i) => `<span>${start + i}</span>`).join("");
    return `<div class="code-view"><div class="gutter" aria-hidden="true">${gutter}</div><pre class="code-body"><code data-lang="${esc(language || "")}">${esc(code)}</code></pre></div>`;
  }


  const VIEWABLE_RE = /\.(md|markdown|csv|tsv)$/i;
  const NOT_VIEWABLE_RE = /\.(exe|dll|so|dylib|bin|zip|gz|tgz|rar|7z|pdf|mp[34]|mov|avi|wav|ogg|ttf|otf|woff2?|class|jar|pyc|node|msi|iso|db|sqlite3?)$/i;
  const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif|ico|svg)$/i;
  const LINE_RE = /:(\d+)(?:-(\d+))?$/;
  const previewCache = new Map();

  function readableInRoom(target) {
    if (!target || /^(https?:|mailto:)/i.test(target)) return false;
    const spec = splitLine(target);
    const file = spec ? spec.path : target;
    if (NOT_VIEWABLE_RE.test(file) || IMAGE_RE.test(file)) return false;
    return /[\\/]/.test(file);
  }
  function imageUrl(path) {
    const room = currentRoom();
    const roomPart = room && room.id ? `&room=${encodeURIComponent(room.id)}` : "";
    return (window.DEMO && window.DEMO.imageUrl(path, room && room.id)) || `/api/image?path=${encodeURIComponent(path)}${roomPart}`;
  }
  function splitLine(target) {
    const m = LINE_RE.exec(target || "");
    if (!m) return null;
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : 0;
    return { path: target.slice(0, m.index), from, to: to && to >= from ? to : 0 };
  }

  const PREVIEW_CONTEXT = 3;
  const PREVIEW_PLAIN_LINES = 40;
  const fileName = (path) => String(path).split(/[\\/]/).pop();

  function previewCard(key, spec, data, error) {
    const range = data && data.from ? (data.to > data.from ? `lines ${data.from}–${data.to}` : `line ${data.from}`) : "";
    const el = UI.el("file-card", { name: fileName(spec.path), lines: range, body: error ? undefined : codeWithGutter(data.text, data.language, data.from || 1), error: error || undefined, data: { key } });
    const body = el.querySelector(".body");
    if (!error && spec.from) {
      const marked = body.querySelectorAll(".gutter span")[spec.from - (data.from || 1)];
      if (marked) marked.classList.add("line-mark");
    }
    el.querySelector('[data-act="open-file"]').addEventListener("click", () => viewFile(spec.path, spec.from || 0).catch(showError));
    if (!error) highlightBlocks(body);
    return el;
  }

  async function fetchPreview(key, spec, from, to) {
    if (previewCache.has(key)) return previewCache.get(key);
    const promise = get(`/api/file?path=${encodeURIComponent(spec.path)}&from=${from}&to=${to}`)
      .then((r) => ({ ok: true, data: r }))
      .catch((e) => ({ ok: false, error: e && e.message ? e.message : String(e) }));
    previewCache.set(key, promise);
    return promise;
  }

  const INLINE_TAGS = new Set(["CODE", "EM", "STRONG", "B", "I", "U", "S", "SPAN", "SMALL", "MARK", "SUB", "SUP", "A", "DEL", "INS", "ABBR", "Q"]);
  function placeFragmentCard(textEl, link, card) {
    let anchor = link;
    while (anchor.parentElement && anchor.parentElement !== textEl && INLINE_TAGS.has(anchor.parentElement.tagName)) anchor = anchor.parentElement;
    const table = anchor.closest("table");
    if (table && textEl.contains(table) && table !== textEl) anchor = table;
    if (anchor.parentElement) anchor.after(card);
    else textEl.appendChild(card);
  }

  function imageCard(key, path) {
    const el = UI.el("file-card", { name: fileName(path), kind: "image", openTitle: "Open it big", body: String(UI.h("img", { alt: fileName(path), loading: "lazy", src: imageUrl(path) })), data: { key } });
    const body = el.querySelector(".body");
    const img = body.querySelector("img");
    img.addEventListener("error", async () => {
      let why = "";
      try {
        const res = await fetch(img.src);
        const text = await res.text();
        try {
          why = JSON.parse(text).error || "";
        } catch {
          why = res.status === 404 ? "this hub does not serve pictures yet; restart it with the new build" : `the hub answered ${res.status}`;
        }
      } catch {
        why = "the hub did not answer";
      }
      body.innerHTML = `<div class="note">${esc(fileName(path))} could not be shown here${why ? `: ${esc(why)}` : ""}.</div>`;
    });
    img.addEventListener("load", () => {
      el.querySelector(".lines").textContent = `${img.naturalWidth}×${img.naturalHeight}`;
    });
    const big = () => openLightbox(img.src, fileName(path));
    el.querySelector('[data-act="open-file"]').addEventListener("click", big);
    img.addEventListener("click", big);
    return el;
  }

  function renderPreviews(textEl, m) {
    if (!textEl || m.streaming) return;
    for (const link of textEl.querySelectorAll(".open-link[data-open]:not([data-previewed])")) {
      const target = link.dataset.open;
      if (/^(https?:|mailto:)/i.test(target) || NOT_VIEWABLE_RE.test(target)) continue;
      const spec = splitLine(target);
      link.dataset.previewed = "1";
      if (IMAGE_RE.test(target) && /[\\/]/.test(target)) {
        const key = `img|${target}`;
        if (textEl.querySelector(`[data-ui="file-card"][data-key="${cssEscape(key)}"]`)) continue;
        placeFragmentCard(textEl, link, imageCard(key, target));
      } else if (spec && /[\\/]/.test(spec.path)) {
        const from = Math.max(1, spec.from - PREVIEW_CONTEXT);
        const to = (spec.to || spec.from) + PREVIEW_CONTEXT;
        const key = `${spec.path}|${from}|${to}`;
        if (textEl.querySelector(`[data-ui="file-card"][data-key="${cssEscape(key)}"]`)) continue;
        const place = (result) => {
          if (!textEl.isConnected || textEl.querySelector(`[data-ui="file-card"][data-key="${cssEscape(key)}"]`)) return;
          placeFragmentCard(textEl, link, previewCard(key, spec, result.data, result.ok ? null : result.error));
        };
        fetchPreview(key, spec, from, to).then(place);
      } else if (readableInRoom(target)) {
        const room = currentRoom();
        resolveInRoom(room ? room.id : "", target).then((found) => {
          if (!found || found.kind !== "file" || !link.isConnected || link.nextElementSibling?.dataset.act === "preview") return;
          const chip = UI.el("icon-button", { icon: "eye", title: `Preview: show the first ${PREVIEW_PLAIN_LINES} lines here`, kind: "inline", size: "xs", act: "preview" });
          const key = `${target}|1|${PREVIEW_PLAIN_LINES}`;
          const shown = () => textEl.querySelector(`[data-ui="file-card"][data-key="${cssEscape(key)}"]`);
          const label = () => {
            const open = !!shown();
            chip.innerHTML = open ? ic("close") : ic("eye");
            chip.title = open ? "Close the preview" : `Preview: show the first ${PREVIEW_PLAIN_LINES} lines here`;
            chip.setAttribute("aria-label", open ? "Close the preview" : "Preview");
            UI.setState(chip, open ? "on" : null);
          };
          chip.addEventListener("click", async () => {
            const card = shown();
            if (card) {
              card.remove();
              label();
              return;
            }
            chip.disabled = true;
            const result = await fetchPreview(key, { path: target, from: 0, to: 0 }, 1, PREVIEW_PLAIN_LINES);
            chip.disabled = false;
            if (!shown()) placeFragmentCard(textEl, link, previewCard(key, { path: target, from: 0, to: 0 }, result.data, result.ok ? null : result.error));
            label();
          });
          link.after(chip);
        });
      }
    }
  }
  const cssEscape = (value) => (window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&"));

  const RELATIVE_RE = /(?<![\p{L}\p{N}./\\:~_-])((?:\.{1,2}[\\/])?[\p{L}\p{N}_.-]+(?:[\\/][\p{L}\p{N}_.-]+)+\.[\p{L}\p{N}]{1,10})(:\d+(?:-\d+)?)?(?![\p{L}\p{N}/\\_-])/gu;
  const resolved = new Map();
  function resolveInRoom(roomId, path) {
    const key = `${roomId}|${path}`;
    if (!resolved.has(key)) {
      resolved.set(
        key,
        get(`/api/resolve?room=${encodeURIComponent(roomId)}&path=${encodeURIComponent(path)}`)
          .then((r) => (r.path ? { path: r.path, kind: r.kind || "file" } : null))
          .catch(() => null),
      );
    }
    return resolved.get(key);
  }
  function textNodesOf(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement && node.parentElement.closest('a, pre, .quote, [data-ui="file-card"], [data-ui="tool-call"], .mermaid-block, .csv-block')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  }
  async function linkRelativePaths(textEl, m) {
    const room = currentRoom();
    if (!textEl || m.streaming || !room || !room.dir) return;
    const nodes = textNodesOf(textEl);
    const found = new Map();
    for (const node of nodes) {
      for (const match of String(node.nodeValue).matchAll(RELATIVE_RE)) {
        if (NOT_VIEWABLE_RE.test(match[1])) continue;
        const hits = found.get(match[1]) || [];
        hits.push({ node, index: match.index, length: match[0].length, line: match[2] || "" });
        found.set(match[1], hits);
      }
    }
    if (!found.size) return;
    const paths = await Promise.all([...found.keys()].map((token) => resolveInRoom(room.id, token)));
    const resolved = new Map();
    [...found.keys()].forEach((token, i) => {
      const full = paths[i] && paths[i].path;
      if (full) resolved.set(token, full);
    });
    if (!resolved.size) return;
    const byNode = new Map();
    for (const [token, hits] of found) {
      if (!resolved.has(token)) continue;
      for (const hit of hits) byNode.set(hit.node, [...(byNode.get(hit.node) || []), { ...hit, token }]);
    }
    let linked = false;
    for (const [node, hits] of byNode) {
      if (!node.isConnected) continue;
      for (const hit of hits.sort((a, b) => b.index - a.index)) {
        const full = resolved.get(hit.token);
        const after = node.splitText(hit.index);
        after.nodeValue = after.nodeValue.slice(hit.length);
        const link = document.createElement("a");
        link.className = "open-link";
        link.href = "#";
        link.dataset.open = `${full}${hit.line}`;
        link.title = `${full} (relative to the room's folder)`;
        link.textContent = `${hit.token}${hit.line}`;
        node.parentNode.insertBefore(link, after);
        linked = true;
      }
    }
    if (linked) renderPreviews(textEl, m);
  }
  function csvTable(rows) {
    if (!rows.length) return '<p class="lead">Empty file.</p>';
    const cell = (tag, v) => `<${tag}>${esc(v)}</${tag}>`;
    const [head, ...body] = rows;
    const width = Math.max(head.length, ...body.map((r) => r.length));
    const pad = (r) => r.concat(Array(Math.max(0, width - r.length)).fill(""));
    return `<div class="csv-wrap"><table class="csv"><thead><tr>${pad(head).map((v) => cell("th", v)).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${pad(r).map((v) => cell("td", v)).join("")}</tr>`).join("")}</tbody></table></div><p class="csv-count">${body.length} row${body.length === 1 ? "" : "s"} · ${width} column${width === 1 ? "" : "s"}</p>`;
  }
  let fileView = null;
  async function viewFile(path, line) {
    const at = Number(line) || 0;
    const window = at > 1 ? `&from=${Math.max(1, at - 40)}&to=${at + 200}` : "";
    const r = await get(`/api/file?path=${encodeURIComponent(path)}${window}`);
    fileView = { path: r.path, kind: r.kind, language: r.language || null, from: r.from || 1, lines: r.lines || 0, more: !!r.more };
    els.fvTitle.textContent = r.path.split(/[\\/]/).pop();
    els.fvPath.textContent = r.path;
    els.fvBody.className = `file-view ${r.kind}`;
    els.fvTools.hidden = r.kind !== "text";
    els.fvBody.innerHTML =
      r.kind === "csv" ? csvTable(r.rows) : r.kind === "markdown" ? renderText(currentRoom(), r.text) : codeWithGutter(r.text, r.language, r.from || 1);
    els.fvOpen.dataset.path = r.path;
    els.fvBody.scrollTop = 0;
    els.fvSearch.value = "";
    els.fvHits.textContent = "";
    els.fvLine.value = at > 1 ? String(at) : "";
    if (r.kind === "text") {
      els.fvCount.textContent = `${r.lines}${r.more ? "+" : ""} lines${r.language ? ` · ${r.language}` : ""}${r.more ? " · shown in windows" : ""}`;
      els.fvBody.classList.toggle("wrap", els.fvWrap.checked);
    }
    openDialog(els.fileDialog);
    if (r.kind === "markdown") renderDiagrams(els.fvBody);
    if (r.kind === "text") {
      await highlightBlocks(els.fvBody);
      if (at > 1) markLine(at);
    }
  }
  function markLine(line) {
    const first = fileView ? fileView.from : 1;
    const index = line - first;
    const rows = els.fvBody.querySelectorAll(".gutter span");
    const row = rows[index];
    if (!row) return;
    els.fvBody.querySelectorAll(".line-mark").forEach((el) => el.classList.remove("line-mark"));
    row.classList.add("line-mark");
    const body = els.fvBody.querySelector(".code-body");
    if (body) {
      const lineHeight = row.getBoundingClientRect().height || 18;
      els.fvBody.scrollTop = Math.max(0, index * lineHeight - els.fvBody.clientHeight / 2);
    }
  }
  function findInFile(query) {
    const code = els.fvBody.querySelector(".code-body code");
    if (!code) return;
    if (code.dataset.plain === undefined) code.dataset.plain = "1";
    els.fvBody.querySelectorAll(".find-hit").forEach((el) => el.replaceWith(document.createTextNode(el.textContent)));
    els.fvBody.querySelectorAll(".code-body code").forEach((c) => c.normalize());
    if (!query) {
      els.fvHits.textContent = "";
      return;
    }
    const needle = query.toLowerCase();
    let hits = 0;
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    for (const node of texts) {
      const value = node.nodeValue;
      const lower = value.toLowerCase();
      if (!lower.includes(needle)) continue;
      const frag = document.createDocumentFragment();
      let at = 0;
      for (;;) {
        const i = lower.indexOf(needle, at);
        if (i < 0) break;
        frag.appendChild(document.createTextNode(value.slice(at, i)));
        const mark = document.createElement("mark");
        mark.className = "find-hit";
        mark.textContent = value.slice(i, i + query.length);
        frag.appendChild(mark);
        at = i + query.length;
        hits++;
      }
      frag.appendChild(document.createTextNode(value.slice(at)));
      node.replaceWith(frag);
    }
    els.fvHits.textContent = hits ? `${hits} hit${hits === 1 ? "" : "s"}` : "nothing found";
    const first = els.fvBody.querySelector(".find-hit");
    if (first) first.scrollIntoView({ block: "center" });
  }
  els.fvSearch.addEventListener("input", () => findInFile(els.fvSearch.value.trim()));
  els.fvWrap.addEventListener("change", () => els.fvBody.classList.toggle("wrap", els.fvWrap.checked));
  els.fvLine.addEventListener("change", async () => {
    const line = Number(els.fvLine.value);
    if (!fileView || !line) return;
    if (line < fileView.from || !els.fvBody.querySelectorAll(".gutter span")[line - fileView.from]) await viewFile(fileView.path, line);
    else markLine(line);
  });


  const DIAGRAM_PRESETS = TOKENS.diagrams.presets;
  function diagramSettings(d) {
    return d || (state.settings && state.settings.diagrams) || {};
  }
  function diagramPreset(d) {
    const look = TOKENS.active();
    return TOKENS.diagrams.forScheme(DIAGRAM_PRESETS[d.preset] || DIAGRAM_PRESETS.pop, look.scheme, look.elements.diagram.nodeInk);
  }
  function mermaidThemeVariables(d) {
    d = diagramSettings(d);
    const preset = diagramPreset(d);
    const vars = Object.assign({}, preset, { fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font").trim() || "Nunito, sans-serif", fontSize: "13px" });
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
    const preset = diagramPreset(d);
    return preset.palette && !d.primary ? preset.palette : null;
  }
  const mermaidCss = () => [
    ".node rect, .node .label-container, .node .basic, .cluster rect, rect.actor { rx: 12px; ry: 12px; }",
    `.node .label-container, .node .basic, .node rect, .node circle, .node ellipse, rect.actor { stroke-width: 1.8px; filter: drop-shadow(0 2px 0 ${TOKENS.active().elements.diagram.nodeShadow}); }`,
    ".edgePath .path, .flowchart-link, .messageLine0, .messageLine1, .transition, .relation { stroke-width: 2px; }",
    ".edgeLabel, .edgeLabel p { font-weight: 700; }",
    ".cluster rect { stroke-dasharray: 4 3; stroke-width: 1.5px; }",
    ".cluster-label, .cluster-label p { font-weight: 800; }",
  ].join(" ");
  function paintDiagram(root, palette) {
    const ink = TOKENS.active().elements.diagram.nodeInk;
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
        s.src = "vendor/mermaid.min.js";
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
      themeCSS: mermaidCss(),
      flowchart: { curve: "basis", padding: 14, nodeSpacing: 44, rankSpacing: 52 },
    });
    for (const block of blocks) {
      const out = block.querySelector(".mm-out");
      const src = block.dataset.src || "";
      try {
        const t0 = performance.now();
        const { svg } = await mermaid.render(`mm-${++mermaidSeq}`, src);
        out.innerHTML = svg;
        if (palette) paintDiagram(out, palette);
        block.classList.add("ok");
        block.classList.remove("failed");
        noteSlow("diagram drawn", performance.now() - t0);
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
    return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  }
  function fmtCost(cost) {
    return cost ? `${cost.amount.toFixed(3)} ${cost.currency}` : "";
  }
  function nearBottom() {
    const el = els.messages;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }
  let stuck = true;
  let settling = 0;
  function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
    els.jumpLatest.hidden = true;
    stuck = true;
    if (!settling) settleBottom(20);
  }
  function settleBottom(frames) {
    settling = frames;
    requestAnimationFrame(() => {
      const el = els.messages;
      if (stuck && el.scrollTop + el.clientHeight < el.scrollHeight - 1) el.scrollTop = el.scrollHeight;
      settling = frames - 1;
      if (settling > 0) settleBottom(settling);
    });
  }
  function avatar(p, size, opts) {
    return window.Avatars.avatarHtml(p, size, Object.assign({ recipes: state.recipes }, opts || {}));
  }
  function meAvatarData() {
    const s = state.settings || {};
    return { name: s.humanName || "You", color: TOKENS.active().elements.face.humanInk, avatar: s.humanAvatar, kind: "human" };
  }
  function copyableHtml(el) {
    const clone = (el.querySelector(".text > .words") || el.querySelector(".text")).cloneNode(true);
    for (const node of clone.querySelectorAll('[data-ui="file-card"], [data-ui="icon-button"], .live-tail, .mermaid-block svg, .mm-bar')) node.remove();
    for (const link of clone.querySelectorAll("a.open-link, .img-ref")) link.replaceWith(document.createTextNode(link.textContent));
    clone.classList.remove("clamped");
    return clone.innerHTML.trim();
  }
  async function copyMessage(el, m) {
    const html = copyableHtml(el);
    const text = String(m.text || "");
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      } else await navigator.clipboard.writeText(text);
      toast("Copied: the words, formatted; the tool calls stayed here.");
    } catch (error) {
      showError(error);
    }
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
    setTimeout(leave, level === "error" ? 14000 : 9000);
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
  document.addEventListener("click", (e) => {
    const step = e.target.closest && e.target.closest('[data-ui="number-field"] > .steps > button');
    if (!step) return;
    e.preventDefault();
    const input = step.closest('[data-ui="number-field"]').querySelector("input");
    if (!input || input.disabled) return;
    try {
      if (step.dataset.act === "up") input.stepUp();
      else input.stepDown();
    } catch {
      return;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  function field(label, inputHtml, hint, geekText) {
    return `<label class="field"><span class="label">${label}${geekText ? geekTip(geekText) : ""}</span>${inputHtml}${hint ? `<span class="hint">${hint}</span>` : ""}</label>`;
  }
  function vendorLogo(r, size) {
    return UI.html("logo-tile", { icon: r.icon || "", letter: r.vendor[0], size: size || "md", title: r.vendor });
  }
  function slowTasksHtml() {
    if (!slowTasks.length) return '<p class="hint">Nothing over 8 ms so far in this window.</p>';
    const rows = [...slowTasks]
      .reverse()
      .slice(0, 25)
      .map((t) => `<tr><td>${esc(new Date(t.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }))}</td><td><b>${t.ms} ms</b></td><td>${esc(t.name)}</td><td class="hint">${esc(t.busy)}</td></tr>`);
    return `<table class="slow-table">${rows.join("")}</table>`;
  }
  function slowTasksText() {
    return [...slowTasks].reverse().map((t) => `${new Date(t.at).toLocaleTimeString()} - ${t.ms} ms - ${t.name}${t.busy ? ` - ${t.busy}` : ""}`).join("\n");
  }
  function sectionTitle(iconName, text) {
    return `<h4>${ic(iconName)}${text}</h4>`;
  }
  function geek(id, bodyHtml, hint) {
    return `<details class="geek" id="${id}"><summary>${ic("geek")}for geeks${hint ? `<span class="g-hint">${hint}</span>` : ""}<span class="chev">${ic("down")}</span></summary><div class="geek-body">${bodyHtml}</div></details>`;
  }
  const SAVED_MARK_MS = 2000;
  const recentlySaved = new Map();
  function markSaved(fieldId, ms) {
    const el = fieldId && document.getElementById(fieldId);
    const host = el && el.closest(".field, .switch");
    const label = host && host.querySelector(":scope > .label");
    if (!label) return;
    const old = label.querySelector(".fsaved");
    if (old) old.remove();
    label.insertAdjacentHTML("beforeend", `<span class="fsaved">${ic("check")}Saved</span>`);
    const mark = label.lastElementChild;
    setTimeout(() => mark.remove(), ms == null ? SAVED_MARK_MS : ms);
  }
  function bindSave(container, onSave) {
    if (!container) return;
    let dirty = false;
    let saving = false;
    let again = false;
    let lastField = null;
    const arm = () => {
      dirty = true;
    };
    const save = async () => {
      if (!dirty) return;
      if (saving) {
        again = true;
        return;
      }
      saving = true;
      dirty = false;
      const field = lastField;
      lastField = null;
      try {
        const outcome = await onSave();
        if (field && outcome !== false) {
          recentlySaved.set(field, Date.now());
          markSaved(field);
        }
      } catch (e) {
        dirty = true;
        showError(e);
      }
      saving = false;
      if (again) {
        again = false;
        save();
      }
    };
    for (const [id, at] of recentlySaved) {
      const left = SAVED_MARK_MS - (Date.now() - at);
      if (left > 0 && container.querySelector(`#${CSS.escape(id)}`)) markSaved(id, left);
    }
    container.addEventListener("input", arm);
    container.addEventListener("change", (e) => {
      arm();
      if (e.target.id) lastField = e.target.id;
      save();
    });
    container.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const t = e.target;
      if (t.tagName === "INPUT" || (e.ctrlKey && (t.tagName === "TEXTAREA" || t.isContentEditable))) {
        e.preventDefault();
        t.blur();
      }
    });
    container.addEventListener("focusout", (e) => {
      if (e.target.isContentEditable) {
        if (e.target.id) lastField = e.target.id;
        save();
      }
    });
  }
  function roomHue(room) {
    let h = 0;
    for (const ch of room.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 360;
  }
  function roomMark(room, lg) {
    const emoji = (room.settings && room.settings.emoji) || "";
    return UI.html("room-mark", { hue: roomHue(room), emoji: emoji || undefined, letter: emoji ? undefined : room.name.trim()[0] || "?", size: lg ? "lg" : "md" });
  }
  function lookSampleHtml() {
    const withIcon = state.recipes.filter((r) => r.icon);
    const lead = withIcon[0] || state.recipes[0];
    const sam = { name: "Sam", kind: "agent", color: TOKENS.active().elements.face.avatarDefault, avatar: "🦊", agentType: lead ? lead.id : "", agentLabel: lead ? lead.vendor : "" };
    const marks = (withIcon.length ? withIcon : state.recipes).slice(0, 3).map((r) => vendorLogo(r, "sm")).join("");
    return `<div class="msg agent"><div class="bubble-col"><div class="head"><span class="head-av">${avatar(sam, 32, { vendor: true })}</span><span class="name" style="color:${sam.color}">Sam</span><span class="time">16:21</span></div><div class="bubble">A reply, on this look's paper, in its ink, with <code>code</code> a step smaller.</div><div class="meta"><span>seen</span></div></div></div>
      <div class="msg mine"><div class="bubble-col"><div class="bubble">Your message.</div></div></div>
      <div class="sample-row">${UI.html("hub-row", { text: "Sam finished the reply started at 16:21 · 2m 30s", ref: "sample", title: "a row the hub writes", face: UI.raw(avatar(sam, 20, {})) })}</div>
      <div class="sample-row">${UI.html("room-mark", { hue: 200, letter: "V", title: "a room" })}${UI.html("room-mark", { hue: 40, emoji: "🎭", title: "a room with an emoji" })}${marks}${UI.html("button", { label: "Send", kind: "primary", size: "sm" })}</div>`;
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

  function attachScrollHints(box) {
    if (!box || box.dataset.hinted) return;
    const inside = box.tagName === "DIALOG";
    const frame = box.parentElement;
    if (!frame && !inside) return;
    box.dataset.hinted = "1";
    if (!inside && getComputedStyle(frame).position === "static") frame.style.position = "relative";
    const make = (dir) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `scroll-hint ${dir}`;
      b.title = dir === "up" ? "There is more above" : "There is more below";
      b.innerHTML = ic(dir === "up" ? "chevrons-up" : "chevrons-down");
      b.hidden = true;
      b.addEventListener("click", () => box.scrollBy({ top: (dir === "up" ? -1 : 1) * Math.max(120, box.clientHeight * 0.85), behavior: "smooth" }));
      if (inside) {
        const slot = document.createElement("div");
        slot.className = `scroll-hint-slot ${dir}`;
        slot.appendChild(b);
        if (dir === "up") box.prepend(slot);
        else box.append(slot);
      } else frame.appendChild(b);
      return b;
    };
    const up = make("up");
    const down = make("down");
    const update = () => {
      const hidden = box.scrollHeight - box.clientHeight;
      up.hidden = !(hidden > 8 && box.scrollTop > 8);
      down.hidden = !(hidden > 8 && box.scrollTop < hidden - 8);
    };
    box.addEventListener("scroll", update, { passive: true });
    new ResizeObserver(update).observe(box);
    new MutationObserver(update).observe(box, { childList: true, subtree: true });
    update();
  }

  function openDialog(dialog) {
    if (dialog.open) return;
    dialog.classList.remove("closing");
    restoreDialogSize(dialog);
    dialog.showModal();
    if (dialog.classList.contains("light-dismiss") && !dialog.lightDismissWired) {
      dialog.lightDismissWired = true;
      dialog.addEventListener("click", (e) => {
        if (e.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog(dialog);
      });
    }
    dialog.querySelectorAll(".scrolls").forEach(attachScrollHints);
    watchDialogSize(dialog);
  }

  const DIALOG_MIN_W = 320;
  const DIALOG_MIN_H = 220;
  const dialogSizeKey = (dialog) => `dialog.${dialog.id || "unnamed"}.size`;
  const dialogFits = (w, h) => ({
    w: Math.max(DIALOG_MIN_W, Math.min(w, Math.round(window.innerWidth * 0.94))),
    h: Math.max(DIALOG_MIN_H, Math.min(h, Math.round(window.innerHeight * 0.92))),
  });
  function restoreDialogSize(dialog) {
    const saved = recall(dialogSizeKey(dialog));
    if (!saved) return;
    const [w, h] = String(saved).split("x").map(Number);
    if (!w || !h) return;
    const size = dialogFits(w, h);
    dialog.style.width = `${size.w}px`;
    dialog.style.height = `${size.h}px`;
    dialog.classList.add("sized");
  }
  function resetDialogSize(dialog) {
    dialog.style.width = "";
    dialog.style.height = "";
    dialog.classList.remove("sized");
    remember(dialogSizeKey(dialog), "");
    try {
      localStorage.removeItem(`viberoom.${dialogSizeKey(dialog)}`);
    } catch {
    }
  }
  let dialogSizes = null;
  function watchDialogSize(dialog) {
    if (!window.ResizeObserver) return;
    if (!dialogSizes) {
      dialogSizes = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const el = entry.target;
          if (!el.open || !el.style.width) continue;
          const box = entry.borderBoxSize && entry.borderBoxSize[0];
          const w = Math.round(box ? box.inlineSize : entry.contentRect.width);
          const h = Math.round(box ? box.blockSize : entry.contentRect.height);
          if (w >= DIALOG_MIN_W && h >= DIALOG_MIN_H) remember(dialogSizeKey(el), `${w}x${h}`);
        }
      });
    }
    if (!dialog.dataset.sized) {
      dialog.dataset.sized = "1";
      dialog.addEventListener("pointerdown", (e) => {
        const r = dialog.getBoundingClientRect();
        if (e.clientX > r.right - 22 && e.clientY > r.bottom - 22 && !dialog.style.width) {
          dialog.style.width = `${Math.round(r.width)}px`;
          dialog.style.height = `${Math.round(r.height)}px`;
          dialog.classList.add("sized");
        }
      });
      dialog.addEventListener("dblclick", (e) => {
        const r = dialog.getBoundingClientRect();
        if (e.clientX > r.right - 22 && e.clientY > r.bottom - 22) resetDialogSize(dialog);
      });
      dialogSizes.observe(dialog);
    }
  }
  window.addEventListener("resize", () => {
    for (const dialog of document.querySelectorAll("dialog[open]")) {
      if (!dialog.style.width) continue;
      const size = dialogFits(parseInt(dialog.style.width, 10), parseInt(dialog.style.height, 10));
      dialog.style.width = `${size.w}px`;
      dialog.style.height = `${size.h}px`;
    }
  });
  function closeDialog(dialog) {
    if (!dialog.open) return;
    dialog.classList.add("closing");
    setTimeout(() => {
      dialog.classList.remove("closing");
      if (dialog.open) dialog.close();
    }, 190);
  }
  function confirmDialog(text, opts) {
    return choiceDialog(text, opts).then((choice) => choice === "ok");
  }
  function choiceDialog(text, opts) {
    const o = opts || {};
    const dialog = $("#confirm-dialog");
    $("#cf-title").textContent = o.title || "Are you sure?";
    $("#cf-text").textContent = text;
    const buttons = { ok: $("#cf-ok"), alt: $("#cf-alt"), cancel: $("#cf-cancel") };
    buttons.ok.textContent = o.okLabel || "OK";
    buttons.cancel.textContent = o.cancelLabel || "Cancel";
    buttons.alt.textContent = o.altLabel || "";
    buttons.alt.hidden = !o.altLabel;
    dialog.classList.toggle("three-way", !!o.altLabel);
    const primary = o.primary || "ok";
    for (const [name, button] of Object.entries(buttons)) button.dataset.kind = name === primary ? (o.danger ? "danger" : "primary") : "ghost";
    return new Promise((resolve) => {
      const done = () => {
        dialog.removeEventListener("close", done);
        resolve(dialog.returnValue === "ok" ? "ok" : dialog.returnValue === "alt" ? "alt" : "cancel");
      };
      dialog.addEventListener("close", done);
      dialog.returnValue = "";
      openDialog(dialog);
      buttons[primary].focus();
    });
  }

  const BRIEF_TEXT_MAX = 32000;
  function briefTextLimit(room) {
    const r = room || currentRoom();
    return (r && r.settings && Number(r.settings.briefTextLimit)) || 8000;
  }
  function bindCount(el, countEl, limitOf) {
    if (!el || !countEl) return;
    const tick = () => {
      const n = (el.isContentEditable ? rulesText(el) : el.value).length;
      const limit = limitOf();
      countEl.textContent = `${n} / ${limit}`;
      countEl.classList.toggle("over", n > limit);
    };
    el.addEventListener("input", tick);
    tick();
  }
  async function fitBriefText(text, what, limit, limitInput) {
    if (text.length <= limit) return text;
    const needed = Math.min(BRIEF_TEXT_MAX, Math.ceil(text.length / 500) * 500);
    const canRaise = text.length <= BRIEF_TEXT_MAX;
    const choice = await choiceDialog(`${what} is ${text.length} characters; this room's limit is ${limit}. Cut it at the limit, or raise the limit for this room?${canRaise ? "" : ` ${BRIEF_TEXT_MAX} is the most a room can allow.`}`, { title: "Over the room's limit", okLabel: `Cut at ${limit}`, altLabel: canRaise ? `Raise the limit to ${needed}` : "", cancelLabel: "Go back", primary: "cancel" });
    if (choice === "ok") return text.slice(0, limit);
    if (choice !== "alt") return null;
    if (limitInput) limitInput.value = String(needed);
    else await post(roomApi("/settings"), { briefTextLimit: needed });
    return text;
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
    if (state.currentRoomId !== id) {
      clearShots();
      doneNotes.length = 0;
      renderDoneNotes();
    }
    state.currentRoomId = id;
    state.unread.delete(id);
    state.selection = { kind: "room" };
    remember("room", id);
    if (!state.openRooms.includes(id)) {
      state.openRooms.push(id);
      post(`/api/rooms/${encodeURIComponent(id)}/open`).catch(() => {});
    }
    setView("room");
    if (!(opts && opts.keepDetails)) closeDetails();
    maybeOfferReconnect();
  }

  function renderUpdatePop() {
    const old = $("#update-pop");
    const u = state.update;
    const show = u && u.available && u.latest && recall("updateDismissed") !== u.latest;
    if (!show) {
      if (old && !old.dataset.busy) old.remove();
      return;
    }
    if (old && old.dataset.version === u.latest) return;
    if (old) old.remove();
    const pop = document.createElement("div");
    pop.id = "update-pop";
    pop.className = "update-pop";
    pop.dataset.version = u.latest;
    pop.innerHTML = `<div class="up-main"><div class="up-text"><b>viberoom ${esc(u.latest)}</b> is out. You have ${esc(u.current)}.</div>${UI.html("button", { label: "Update now and restart", kind: "primary", size: "sm", hook: "up-go" })}</div>
      <div class="up-side">${UI.html("icon-button", { icon: "close", title: "Not now", size: "sm", hook: "up-x" })}${UI.html("icon-button", { icon: "settings", title: "Update settings", size: "sm", hook: "up-settings" })}</div>`;
    pop.querySelector(".up-x").addEventListener("click", () => {
      remember("updateDismissed", u.latest);
      pop.remove();
    });
    pop.querySelector(".up-settings").addEventListener("click", () => setView("settings"));
    pop.querySelector(".up-go").addEventListener("click", () => installUpdate(pop, u.latest));
    els.rail.querySelector(".rail-foot").appendChild(pop);
  }
  async function installUpdate(pop, version) {
    const go = pop.querySelector(".up-go");
    const text = pop.querySelector(".up-text");
    pop.dataset.busy = "1";
    go.disabled = true;
    UI.setState(go, "loading");
    text.innerHTML = `Installing <b>viberoom ${esc(version)}</b>… this takes a moment.`;
    try {
      await post("/api/update/install", {});
      UI.setState(go, null);
      text.innerHTML = `<b>viberoom ${esc(version)}</b> is installed. Restarting…`;
      go.hidden = true;
    } catch (e) {
      delete pop.dataset.busy;
      UI.setState(go, null);
      go.disabled = false;
      go.textContent = "Try again";
      text.innerHTML = `<span class="error">${esc(e.message || String(e))}</span>`;
    }
  }

  function renderRail() {
    els.rail.querySelectorAll(".rail-item[data-nav]").forEach((b) => {
      const nav = b.dataset.nav;
      const active = nav === state.view || (nav === "me" && state.selection.kind === "me" && state.detailsOpen);
      b.classList.toggle("active", active);
    });
    renderRailRooms();
    const s = state.settings;
    if (s) {
      els.railMeAvatar.innerHTML = avatar(meAvatarData(), 44, { kind: "bare" });
      els.railMeLabel.textContent = s.humanName;
    }
    const open = els.app.classList.contains("rail-open");
    els.railToggle.title = open ? "Collapse the menu" : "Expand the menu";
    els.railToggle.innerHTML = ic(open ? "collapse" : "expand");
  }

  function activeRooms() {
    const ids = state.openRooms.filter((id) => state.rooms.has(id));
    if (state.currentRoomId && state.rooms.has(state.currentRoomId) && !ids.includes(state.currentRoomId)) ids.push(state.currentRoomId);
    return ids.map((id) => state.rooms.get(id));
  }

  function renderRailRooms() {
    const rooms = activeRooms();
    const box = els.railRooms;
    els.railRoomsWrap.hidden = !rooms.length;
    const seen = new Set();
    let anchor = null;
    for (const room of rooms) {
      seen.add(room.id);
      let b = box.querySelector(`.rail-room[data-room="${CSS.escape(room.id)}"]`);
      if (!b) {
        b = document.createElement("button");
        b.className = "rail-item rail-room";
        b.dataset.room = room.id;
        b.innerHTML = `<span class="ico"></span><span class="label"></span><span class="rail-count" hidden></span>`;
      }
      if (!b.isConnected || b.previousElementSibling !== anchor) box.insertBefore(b, anchor ? anchor.nextSibling : box.firstChild);
      anchor = b;
      const mark = roomMark(room);
      const ico = b.querySelector(".ico");
      if (ico.dataset.mark !== mark) {
        ico.innerHTML = mark;
        ico.dataset.mark = mark;
      }
      b.querySelector(".label").textContent = room.name;
      b.title = roomTitle(room);
      b.classList.toggle("active", room.id === state.currentRoomId && state.view === "room");
      const unread = state.unread.get(room.id) || 0;
      const count = b.querySelector(".rail-count");
      const text = unread ? (unread > 99 ? "99+" : String(unread)) : "";
      if (count.textContent !== text) {
        count.textContent = text;
        count.hidden = !unread;
        if (unread) {
          count.classList.remove("bump");
          void count.offsetWidth;
          count.classList.add("bump");
        }
      }
    }
    for (const b of [...box.children]) if (!seen.has(b.dataset.room)) b.remove();
  }

  function setRailOpen(open) {
    els.app.classList.toggle("rail-open", open);
    remember("railOpen", open ? "1" : "0");
    renderRail();
  }


  function roomStats(room) {
    const agents = room.participants.filter((p) => p.kind === "agent");
    const online = agents.filter((p) => p.status !== "offline" && p.status !== "left" && p.status !== "unstaffed").length;
    const waiting = agents.filter((p) => p.status === "unstaffed").length;
    const chats = room.messages.filter((m) => m.kind === "chat");
    const last = chats.length ? chats[chats.length - 1].ts : room.createdAt;
    const thinking = agents.some((p) => p.status === "thinking");
    return { agents, online, waiting, chats, last, thinking, unread: state.unread.get(room.id) || 0 };
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
    all.innerHTML = `${UI.html("room-mark", { icon: "skills", title: "All skills" })}<div class="p-body"><div class="p-name"><span>All skills</span></div><div class="p-preview">${(state.skills || []).length} in the library</div></div>`;
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
      li.innerHTML = `${roomMark(room)}<div class="p-body"><div class="p-name"><span>${esc(room.name)}</span></div><div class="p-preview">${held.size ? `${held.size} skill${held.size === 1 ? "" : "s"} in use` : "no skills attached"}</div></div>${selected ? `<div class="p-actions">${UI.html("icon-button", { icon: "forward", title: "Go to the room", size: "sm", hook: "goto-room" })}</div>` : ""}`;
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
    { tone: "orchid", emoji: "🎨", title: "Looks", text: "VibeClassic and its dark twin, Terminal, Clay, Eye Comfort (the look the research on tired eyes asks for) or 3D clayful (soft clay objects, with weight): pick one with the button above or under Settings → Appearance, and fine-tune its paper, bubbles, ink and corners." },
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
    const vendorLogos = (vendors.length ? vendors : state.recipes).map((r) => `<span class="home-vendor" title="${esc(r.vendor)}${r.unavailableReason ? " (not installed)" : ""}"${r.unavailableReason ? ' style="opacity:.45"' : ""}>${vendorLogo(r, "sm")}</span>`).join("");
    els.homeView.innerHTML = `
      <div class="home-inner">
        <section class="hero">
          <div class="hero-text">
            <div class="hero-eyebrow">viberoom</div>
            <h1>${state.freshVibe ? "Welcome" : "Welcome back"}, ${esc(name)} 👋</h1>
            <p>One chat, many coding agents. Summon your vibemates into a room, talk to all of them at once, and let them talk to each other.</p>
            <div class="hero-actions">
              ${UI.html("button", { label: "Open room", icon: "rooms", size: "cta", id: "home-open-room", hook: "hero-cta" })}
              ${UI.html("button", { label: "Change the look", icon: "eye", size: "cta", id: "home-change-look", hook: "hero-cta", title: "Settings → Appearance: the looks and their fine-tuning" })}
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
            ${rooms.length ? "" : `<div class="home-room empty-room">${UI.html("room-mark", { icon: "plus" })}<span class="hr-body"><span class="hr-name">No rooms yet</span><span class="hr-sub">Open one, summon a vibemate, say hello.</span></span></div>`}
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
    $("#home-open-room").addEventListener("click", () => {
      setView("rooms");
      remember("view", "rooms");
    });
    const changeLook = $("#home-change-look");
    if (changeLook) changeLook.addEventListener("click", () => {
      setView("settings");
      remember("view", "settings");
      requestAnimationFrame(() => {
        const section = $("#sp-appearance");
        if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
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
    const tpl = document.createElement("div");
    tpl.className = "card cta hover room-card";
    tpl.innerHTML = `<div class="plus">${ic("rooms")}</div><div>Start from a template</div><div class="hint">rules and vibemates, ready to summon</div>`;
    tpl.addEventListener("click", openTemplateDialog);
    grid.appendChild(tpl);
    const rooms = sortedRooms();
    els.roomsSub.textContent = rooms.length ? `${rooms.length} room${rooms.length === 1 ? "" : "s"}. Pick one, or open a new one.` : "No rooms yet. Open one and summon some vibemates.";
    for (const room of rooms) {
      const st = roomStats(room);
      const card = document.createElement("div");
      card.className = `card hover room-card${room.id === state.currentRoomId ? " current" : ""}`;
      const faces = st.agents.slice(0, 5).map((p) => avatar(p, 26, { vendor: true, ring: true })).join("");
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
    updateCastGate(currentRoom());
    const room = currentRoom();
    if (!room) return;
    const st = roomStats(room);
    els.sideRoomName.textContent = room.name;
    els.sideRoomEmoji.textContent = room.settings.emoji || "";
    els.sideRoomSub.textContent = room.settings.topic || `${st.agents.length} vibemate${st.agents.length === 1 ? "" : "s"}${st.agents.length ? ` · ${st.online} online` : ""}${st.waiting ? ` · ${st.waiting} waiting` : ""}`;
    const ordered = [...room.participants].sort((a, b) => (a.kind === "human" ? -1 : b.kind === "human" ? 1 : 0));
    const rows = new Map([...els.participants.children].map((li) => [li.dataset.id, li]));
    for (const p of ordered) {
      let li = rows.get(p.id);
      const selected = state.detailsOpen && ((state.selection.kind === "participant" && state.selection.id === p.id) || (p.kind === "human" && state.selection.kind === "me"));
      const asleep = p.kind === "agent" && (p.status === "offline" || p.status === "left");
      const unstaffed = p.kind === "agent" && p.status === "unstaffed";
      const shown = shownStatus(room, p);
      const className = (p.kind === "human" ? "me" : "") + (selected ? " selected" : "") + (asleep ? " offline" : "") + (unstaffed ? " unstaffed" : "");
      const sub = p.kind === "human" ? "you, the human" : [p.tagline ? `"${p.tagline}"` : "", p.agentVendor || p.agentLabel, p.model].filter(Boolean).join(" · ");
      const troubled = p.kind === "agent" && p.trouble && (p.status === "error" || p.trouble.stage === "turn" || (p.trouble.actions && p.trouble.actions.length > 0));
      const unplugged = vendorLoggedOut(p);
      const loginRow = unplugged && p.status === "offline" && !troubled ? `<div class="p-fix">${UI.html("button", { label: "Log in", kind: "primary", size: "xs", act: "open-login-dialog", icon: "lock", title: `${p.agentVendor || "The vendor"} is not logged in: log in, and ${p.name} comes back`, data: { recipe: p.agentType, purpose: "login" } })}</div>` : "";
      const warn = troubled ? troubleHtml(p) : p.statusDetail && (p.status === "offline" || p.status === "error" || p.failedTurns) ? `<div class="p-warn" title="${esc(p.statusDetail)}">${esc(p.statusDetail)}</div>${loginRow}` : loginRow;
      const status = unstaffed
        ? UI.html("badge", { label: "summon", tone: "attention", title: "Click to summon this vibemate: pick the coding agent that runs it" })
        : asleep
        ? `<span class="zzz" title="${esc(STATUS_LABEL[p.status] || p.status)}">zzz</span>`
        : p.kind === "agent" && p.status !== "idle" ? UI.html("badge", { label: STATUS_LABEL[shown] || shown, tone: STATUS_TONE[shown] || "plain", dot: p.status === "thinking" }) : "";
      const avatarHtml = avatar(p.kind === "human" ? meAvatarData() : p, 44, { vendor: true, muted: p.muted, unplugged, me: p.kind === "human", alert: p.kind === "agent" && (p.status === "error" || (p.status === "offline" && !!(p.trouble && p.trouble.actions && p.trouble.actions.length))), dim: unstaffed ? "unstaffed" : asleep ? "asleep" : undefined });
      const statusValue = p.kind === "agent" ? shown || "idle" : "";
      const bodyHtml = `<div class="p-body">
          <div class="p-name"><span>${esc(p.name)}</span>${p.muted ? UI.html("badge", { label: "muted", tone: "muted" }) : ""}${status}</div>
          <div class="p-sub">${esc(sub)}</div>
          ${warn}
        </div>
        <div class="p-actions">
          ${p.kind === "agent" && p.status === "offline" && !unplugged ? UI.html("row-button", { icon: "refresh", title: `Wake ${p.name} up: reconnect it to the room`, act: "wake" }) : ""}
        </div>`;
      if (!li) {
        li = document.createElement("li");
        li.dataset.id = p.id;
        li.innerHTML = avatarHtml + bodyHtml + (p.kind === "agent" ? UI.html("row-button", { icon: "settings", title: `Open ${p.name}'s panel`, act: "panel" }) + UI.html("row-button", { icon: "last-reply", title: `Go to ${p.name}'s last reply`, act: "last-reply" }) : "");
        li.dataset.avatar = avatarHtml;
        if (statusValue) li.querySelector(".avatar").insertAdjacentHTML("beforeend", `<span class="status" data-status="${esc(statusValue)}"></span>`);
        li.dataset.body = bodyHtml;
      } else {
        if (li.dataset.avatar !== avatarHtml) {
          li.querySelector(".avatar").outerHTML = avatarHtml;
          li.dataset.avatar = avatarHtml;
        }
        const dot = li.querySelector(".avatar .status");
        if (statusValue && dot && dot.dataset.status !== statusValue) dot.dataset.status = statusValue;
        else if (statusValue && !dot) li.querySelector(".avatar").insertAdjacentHTML("beforeend", `<span class="status" data-status="${esc(statusValue)}"></span>`);
        if (li.dataset.body !== bodyHtml) {
          li.querySelectorAll(".p-body, .p-actions").forEach((el) => el.remove());
          li.insertAdjacentHTML("beforeend", bodyHtml);
          li.dataset.body = bodyHtml;
        }
      }
      if (li.className !== className) li.className = className;
      if (p.kind === "agent" && !unstaffed) patchLifeRing(li, p);
      if (li !== els.participants.children[ordered.indexOf(p)]) els.participants.appendChild(li);
      rows.delete(p.id);
    }
    for (const li of rows.values()) li.remove();
    renderLifePop();
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
    renderWorkingNow();
    if (!room) {
      els.chatRoomName.textContent = "No room";
      els.chatRoomSub.textContent = "";
      return;
    }
    const st = roomStats(room);
    els.chatRoomName.textContent = roomTitle(room);
    els.chatRoomSub.innerHTML =
      `<span>${st.agents.length} vibemate${st.agents.length === 1 ? "" : "s"}${st.agents.length ? ` · ${st.online} online` : ""}${st.waiting ? ` · ${st.waiting} waiting` : ""}</span>` +
      (room.settings.topic ? `<span>· ${esc(room.settings.topic)}</span>` : "") +
      UI.html("chip", { label: room.dir.split(/[\\/]/).filter(Boolean).slice(-1)[0] || room.dir, icon: "folder", title: `working directory of the vibemates: ${room.dir}`, hook: "dir-chip" });
  }


  function messageMatches(m) {
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    return m.text.toLowerCase().includes(q) || (m.fromName || "").toLowerCase().includes(q) || (m.quotes || []).some((x) => (x.text || "").toLowerCase().includes(q));
  }

  function renderHidden(el, m) {
    const d = m.details || {};
    if (d.skill) {
      el.innerHTML = `
        <details class="hidden-turn">
          <summary>${ic("skills")} room ↔ ${esc(m.fromName)} · ${esc(m.text)}${d.via ? ` (${esc(d.via)})` : ""}${d.outcome ? ` · <em>${esc(d.outcome)}</em>` : ""}</summary>
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
        <summary>${ic("tool")} room ↔ ${esc(m.fromName)} · ${esc(m.text)}${d.outcome ? ` · <em>${esc(d.outcome)}</em>` : " · <em>waiting for the corrected reply…</em>"}</summary>
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
    el.dataset.from = m.from;
    if (m.kind === "hidden") {
      el.className = "msg hidden";
      renderHidden(el, m);
      return el;
    }
    if (m.kind === "system") {
      if (m.audience === "agents") {
        el.className = "msg hidden";
        el.innerHTML = `<details class="hidden-turn"><summary>${ic("info")} hub → vibemates · ${esc(m.text.split(":")[0])}</summary><div class="hidden-body"><div class="hidden-label">What the vibemates were told</div><div class="hidden-text">${esc(m.text)}</div></div></details>`;
        return el;
      }
      const details = m.details || {};
      const who = details.agentId ? findById(room, details.agentId) : null;
      const tone = ["attention", "error", "hush"].includes(details.tone) ? details.tone : "news";
      const face = who ? avatar(who, 20, {}) : tone === "hush" ? '<span class="hush-face">🤫</span>' : "";
      el.className = "msg system";
      el.innerHTML = UI.html("hub-row", { text: m.text, tone, ref: details.refId || undefined, face: face ? UI.raw(face) : undefined, title: details.refId ? `${fullTime(m.ts)} · go to the reply` : fullTime(m.ts) });
      return el;
    }
    const p = findById(room, m.from) || { name: m.fromName, color: FALLBACK_COLOR(), kind: m.from === "human" ? "human" : "agent" };
    const mine = m.from === "human";
    el.className = "msg " + (mine ? "mine" : "agent");
    el.innerHTML = `
      <div class="bubble-col">
        <div class="head"><span class="head-av">${avatar(mine ? Object.assign(meAvatarData(), { color: p.color }) : p, 32, { vendor: true, me: mine })}</span><span class="name" style="color:${p.color}">${esc(m.fromName)}</span><span class="edited" hidden></span>${mine ? UI.html("icon-button", { icon: "pencil", title: "Edit this message", kind: "ghost", size: "xs", act: "edit" }) : ""}${UI.html("icon-button", { icon: "quote", title: "Quote this message in your next one", kind: "ghost", size: "xs", act: "quote" })}${UI.html("icon-button", { icon: "pin", title: "Pin this message", kind: "ghost", size: "xs", act: "pin" })}${UI.html("icon-button", { icon: "copy", title: "Copy this message, formatted; the tool calls stay here", kind: "ghost", size: "xs", act: "copy" })}<span class="time" title="${esc(fullTime(m.ts))}">${time(m.ts)}</span></div>
        <div class="bubble">
          ${m.skill ? `<div class="skill-invoke" title="skill invocation: the vibemates that have this skill got its instructions with this message">${ic("skills")} skill <b>${esc(m.skill.name)}</b></div>` : ""}
          <div class="edit-box" hidden></div>
          <details class="thought" hidden><summary>thoughts</summary><div class="thought-text"></div></details>
          <div class="agent-notices"></div>
          <div class="tools"></div>
          <div class="plan" hidden></div>
          <div class="text"></div>
          <div class="shots"></div>
          ${UI.html("button", { label: "Show more", kind: "link", act: "more", hidden: true })}
          <div class="stop-note"></div>
          <div class="perms"></div>
          <div class="waiting" hidden></div>
        </div>
        <div class="meta"></div>
      </div>`;
    el.querySelector('[data-act="more"]').addEventListener("click", () => {
      if (state.expanded.has(m.id)) state.expanded.delete(m.id);
      else state.expanded.add(m.id);
      updateMessageElement(el, room, m);
    });
    const editBtn = el.querySelector('[data-act="edit"]');
    if (editBtn) editBtn.addEventListener("click", () => openInlineEditor(el, room, m));
    el.querySelector('[data-act="quote"]').addEventListener("click", () => addQuote(m, ""));
    el.querySelector('[data-act="copy"]').addEventListener("click", () => copyMessage(el, (currentRoom() || room).messages.find((x) => x.id === m.id) || m));
    el.querySelector('[data-act="pin"]').addEventListener("click", async () => {
      if (m.pending) return;
      try {
        await post(`/api/rooms/${encodeURIComponent(room.id)}/messages/${encodeURIComponent(m.id)}/pin`, { pinned: !m.pinned });
      } catch (error) {
        showError(error);
      }
    });
    updateMessageElement(el, room, m);
    return el;
  }

  function shotUrl(roomId, image) {
    if (image.url) return image.url;
    return `/api/rooms/${encodeURIComponent(roomId)}/files/${encodeURIComponent(image.file)}`;
  }

  function renderShots(box, room, m) {
    if (!box) return;
    const images = m.images || [];
    box.hidden = !images.length;
    if (!images.length) return void (box.innerHTML = "");
    box.innerHTML = images
      .map((image, i) => `<button type="button" class="shot" data-n="${image.n || i + 1}" data-src="${esc(shotUrl(room.id, image))}" title="${esc(image.name)}"><img src="${esc(shotUrl(room.id, image))}" alt="${esc(image.name)}"><span class="shot-n">${image.n || i + 1}</span></button>`)
      .join("");
  }

  function openLightbox(src, title) {
    els.lightbox.querySelector("img").src = src;
    els.lightbox.querySelector("img").alt = title || "";
    els.lightbox.hidden = false;
  }
  function closeLightbox() {
    els.lightbox.hidden = true;
    els.lightbox.querySelector("img").src = "";
  }
  els.lightbox.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.lightbox.hidden) closeLightbox();
  });

  const dv = { el: $("#diagram-view"), stage: $("#dv-stage"), level: $("#dv-level"), scale: 1, x: 0, y: 0, fit: 1, dragging: false, moved: false };
  const DV_MIN = 0.1;
  const DV_MAX = 8;
  const DV_FIT_MAX = 3;
  const DV_BAR_SPACE = 120;
  function dvApply() {
    dv.stage.style.transform = `translate(${Math.round(dv.x)}px, ${Math.round(dv.y)}px) scale(${dv.scale})`;
    dv.level.textContent = `${Math.round((dv.scale / dv.fit) * 100)}%`;
  }
  function dvFit() {
    const svg = dv.stage.firstElementChild;
    if (!svg) return;
    const box = dv.el.getBoundingClientRect();
    const w = Number(svg.dataset.w) || svg.getBoundingClientRect().width || 1;
    const h = Number(svg.dataset.h) || svg.getBoundingClientRect().height || 1;
    dv.fit = Math.max(DV_MIN, Math.min((box.width - 80) / w, (box.height - DV_BAR_SPACE - 32) / h, DV_FIT_MAX));
    dv.scale = dv.fit;
    dv.x = (box.width - w * dv.scale) / 2;
    dv.y = Math.max(16, (box.height - DV_BAR_SPACE - h * dv.scale) / 2);
    dvApply();
  }
  function dvZoom(factor, cx, cy) {
    const next = Math.min(DV_MAX, Math.max(DV_MIN, dv.scale * factor));
    const box = dv.el.getBoundingClientRect();
    const px = (cx ?? box.left + box.width / 2) - box.left;
    const py = (cy ?? box.top + box.height / 2) - box.top;
    dv.x = px - ((px - dv.x) / dv.scale) * next;
    dv.y = py - ((py - dv.y) / dv.scale) * next;
    dv.scale = next;
    dvApply();
  }
  function openDiagram(block) {
    const svg = block && block.querySelector(".mm-out svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const clone = svg.cloneNode(true);
    clone.dataset.w = String(rect.width || 800);
    clone.dataset.h = String(rect.height || 600);
    clone.style.maxWidth = "none";
    clone.style.width = `${rect.width || 800}px`;
    clone.style.height = `${rect.height || 600}px`;
    dv.stage.replaceChildren(clone);
    dv.el.hidden = false;
    dvFit();
  }
  function closeDiagram() {
    dv.el.hidden = true;
    dv.stage.replaceChildren();
  }
  $("#dv-close").addEventListener("click", closeDiagram);
  $("#dv-in").addEventListener("click", () => dvZoom(1.25));
  $("#dv-out").addEventListener("click", () => dvZoom(0.8));
  dv.level.addEventListener("click", dvFit);
  dv.el.addEventListener("dblclick", (e) => {
    if (!e.target.closest("#dv-bar")) dvFit();
  });
  dv.el.addEventListener(
    "wheel",
    (e) => {
      if (e.target.closest("#dv-bar")) return;
      e.preventDefault();
      dvZoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
    },
    { passive: false },
  );
  dv.el.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#dv-bar")) return;
    dv.dragging = true;
    dv.moved = false;
    dv.el.setPointerCapture(e.pointerId);
    dv.el.classList.add("dragging");
  });
  dv.el.addEventListener("pointermove", (e) => {
    if (!dv.dragging) return;
    if (e.movementX || e.movementY) dv.moved = true;
    dv.x += e.movementX;
    dv.y += e.movementY;
    dvApply();
  });
  for (const type of ["pointerup", "pointercancel"]) {
    dv.el.addEventListener(type, (e) => {
      if (!dv.dragging) return;
      dv.dragging = false;
      dv.el.classList.remove("dragging");
      if (type === "pointerup" && !dv.moved && !e.target.closest("#dv-bar") && e.target === dv.el) closeDiagram();
    });
  }
  window.addEventListener("resize", () => {
    if (!dv.el.hidden) dvFit();
  });
  document.addEventListener("keydown", (e) => {
    if (dv.el.hidden) return;
    if (e.key === "Escape") return void closeDiagram();
    if (e.key === "+" || e.key === "=") return void dvZoom(1.25);
    if (e.key === "-") return void dvZoom(0.8);
    if (e.key === "0") dvFit();
  });
  els.messages.addEventListener("click", (e) => {
    const hubRow = e.target.closest('[data-ui="hub-row"][data-ref]');
    if (hubRow) return void jumpToMessage(els.messages.querySelector(`.msg[data-id="${hubRow.dataset.ref}"]`));
    const shot = e.target.closest(".shot");
    if (shot) return void openLightbox(shot.dataset.src, shot.title);
    const quote = e.target.closest(".quote");
    if (quote) return void jumpToMessage(els.messages.querySelector(`.msg[data-seq="${quote.dataset.seq}"]`));
    const ref = e.target.closest(".img-ref");
    if (!ref) return;
    const msg = ref.closest(".msg");
    const target = msg && msg.querySelector(`.shot[data-n="${ref.dataset.n}"]`);
    if (target) openLightbox(target.dataset.src, target.title);
  });

  function waitingFor(room, m) {
    if (m.from !== "human" || m.kind !== "chat" || !m.to || !m.to.length || m.pending) return [];
    return m.to.map((id) => findById(room, id)).filter((p) => p && p.kind === "agent" && p.status === "thinking" && p.lastSeenSeq != null && p.lastSeenSeq < m.seq);
  }

  function renderWaiting(el, room, m) {
    const box = el.querySelector(".waiting");
    if (!box) return;
    const agents = waitingFor(room, m);
    el.classList.toggle("waiting", agents.length > 0);
    box.hidden = !agents.length;
    if (!agents.length) return void (box.innerHTML = "");
    const names = agents.map((p) => p.name);
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const verb = names.length === 1 ? "is" : "are";
    const stopLabel = names.length === 1 ? `Stop ${names[0]} and send now` : "Stop them and send now";
    box.innerHTML = `<span class="waiting-text">${ic("clock")} ${esc(who)} ${verb} still working — this arrives when the current turn ends.</span>${UI.html("button", { label: stopLabel, kind: "inverse", size: "sm", act: "stop-and-send" })}`;
    box.querySelector('[data-act="stop-and-send"]').addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Stopping…";
      try {
        await Promise.all(agents.map((p) => post(roomApi(`/participants/${encodeURIComponent(p.id)}/cancel`))));
      } catch (error) {
        showError(error);
        btn.disabled = false;
        btn.textContent = stopLabel;
      }
    });
  }

  const openTools = new Set();
  const openToolGroups = new Set();
  els.messages.addEventListener("click", (e) => {
    const stop = e.target.closest('.live-tail [data-act="stop"]');
    if (stop) {
      const msgEl = stop.closest(".msg");
      const from = msgEl && msgEl.dataset.from;
      if (!from) return;
      stop.disabled = true;
      stop.textContent = "Stopping…";
      return void post(roomApi(`/participants/${encodeURIComponent(from)}/cancel`))
        .then((r) => {
          if (r && r.stopped === "nothing") resyncStream();
        })
        .catch((error) => {
          showError(error);
          stop.disabled = false;
          stop.textContent = "Stop";
        });
    }
    const choice = e.target.closest('[data-ui="ask-card"] [data-ui="button"][data-act]');
    if (choice) {
      const card = choice.closest('[data-ui="ask-card"]');
      if (choice.dataset.act === "permit") post(roomApi(`/permissions/${encodeURIComponent(card.dataset.key)}`), { optionId: choice.dataset.option || null }).catch(showError);
      else if (choice.dataset.act === "decide") post(roomApi(`/proposals/${encodeURIComponent(card.dataset.key)}`), { accept: choice.dataset.answer === "apply" }).catch(showError);
      else if (choice.dataset.act === "try-look") tryLook(choice.dataset.look);
      return;
    }
    const chip = e.target.closest('[data-ui="tool-call"] > [data-ui="chip"]');
    if (!chip) return;
    const msgEl = chip.closest(".msg");
    const room = currentRoom();
    const m = room && msgEl && room.messages.find((x) => x.id === msgEl.dataset.id);
    if (!m) return;
    if (openTools.has(chip.dataset.tool)) openTools.delete(chip.dataset.tool);
    else openTools.add(chip.dataset.tool);
    updateMessageElement(msgEl, room, m);
  });
  function updateMessageElement(el, room, m) {
    el.classList.toggle("hidden-by-search", !messageMatches(m));
    const wasPinned = el.classList.contains("pinned");
    el.classList.toggle("pinned", !!m.pinned);
    const pinBtn = el.querySelector('.head [data-act="pin"]');
    if (pinBtn) pinBtn.title = m.pinned ? "Unpin this message" : "Pin this message";
    const bubble = el.querySelector(".bubble");
    const mark = bubble && bubble.querySelector(":scope > .pin-mark");
    if (m.pinned && bubble && !mark) {
      bubble.insertAdjacentHTML("beforeend", UI.html("icon-button", { icon: "pin", title: "Pinned: click to unpin", kind: "primary", size: "xs", act: "unpin", hook: "pin-mark" }));
      bubble.querySelector(":scope > .pin-mark").addEventListener("click", (e) => {
        e.stopPropagation();
        if (pinBtn) pinBtn.click();
      });
    } else if (!m.pinned && mark) mark.remove();
    if (wasPinned !== !!m.pinned) renderTimeline();
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
    const more = el.querySelector('[data-act="more"]');
    const long = !m.streaming && m.text.length > CLAMP_CHARS;
    const expanded = state.expanded.has(m.id);
    let words = text.querySelector(":scope > .words");
    if (!words) {
      words = document.createElement("div");
      words.className = "words";
      text.replaceChildren(words);
    }
    words.innerHTML = renderText(room, m.text, m.images, m.quotes);
    if (!m.streaming) {
      renderDiagrams(words);
      highlightBlocks(words);
      renderPreviews(words, m);
      linkRelativePaths(words, m);
    }
    if (m.streaming && !m.text) words.innerHTML = '<span class="pending" title="thinking…"><i></i><i></i><i></i></span>';
    if (m.streaming) {
      let tail = el.liveTail;
      if (!tail) {
        tail = document.createElement("span");
        tail.className = "live-tail";
        tail.innerHTML = `${WORKING_SVG}${UI.html("button", { label: "Stop", kind: "ghost", size: "xs", act: "stop", title: "Stop this reply; what is written stays in the room" })}`;
        el.liveTail = tail;
      }
      tail.classList.toggle("no-figure", !m.text);
      if (tail.parentElement !== text) text.appendChild(tail);
    } else if (el.liveTail && el.liveTail.parentElement) el.liveTail.remove();
    text.classList.toggle("clamped", long && !expanded);
    more.hidden = !long;
    more.textContent = expanded ? "Show less" : "Show more";
    const stopNote = el.querySelector(".stop-note");
    if (stopNote) stopNote.innerHTML = !m.streaming && m.stopReason === "cancelled" ? UI.html("reply-note", { text: `Stopped by ${m.stoppedBy || (state.settings || {}).humanName || "you"}`, tone: "attention", icon: "stop" }) : "";
    renderShots(el.querySelector(".shots"), room, m);
    renderWaiting(el, room, m);
    const thought = el.querySelector(".thought");
    if (m.thought) {
      thought.hidden = false;
      thought.querySelector(".thought-text").textContent = m.thought;
    }
    el.querySelector(".agent-notices").innerHTML = (m.notices || []).map((n) => UI.html("reply-note", { text: n, tone: "attention" })).join("");
    const tools = el.querySelector(".tools");
    tools.innerHTML = "";
    const calls = m.toolCalls || [];
    const folded = !m.streaming && calls.length > 0;
    let host = tools;
    if (folded) {
      const group = UI.el("tool-fold", { count: calls.length, failed: calls.filter((c) => c.status === "failed").length, open: openToolGroups.has(m.id) });
      group.addEventListener("toggle", () => {
        if (group.open) openToolGroups.add(m.id);
        else openToolGroups.delete(m.id);
        group.querySelector("summary").title = group.open ? "Fold the tool calls away" : "Show every tool call";
      });
      tools.appendChild(group);
      host = group.querySelector(".list");
    }
    for (const call of calls) {
      const input = call.rawInput === undefined ? "" : typeof call.rawInput === "string" ? call.rawInput : JSON.stringify(call.rawInput, null, 1);
      host.appendChild(UI.el("tool-call", { id: call.toolCallId, title: call.title, kind: call.kind || undefined, status: TOOL_STATUSES.has(call.status) ? call.status : "pending", open: openTools.has(call.toolCallId), input: input || undefined, output: call.output || undefined }));
    }
    const plan = el.querySelector(".plan");
    if (m.plan && m.plan.length) {
      plan.hidden = false;
      plan.innerHTML = m.plan.map((e) => `<div class="plan-entry ${e.status}">${esc(e.content)}</div>`).join("");
    }
    const meta = el.querySelector(".meta");
    if (!m.streaming && m.from !== "human") {
      const parts = [];
      if (m.stopReason && m.stopReason !== "end_turn" && m.stopReason !== "cancelled") parts.push(`<span>${esc(m.stopReason)}</span>`);
      if (m.durationMs) parts.push(`<span title="how long the reply took">${ic("clock")} ${(m.durationMs / 1000).toFixed(1)} s</span>`);
      if (m.usage) parts.push(`<span title="tokens in">${ic("arrow-down")} ${fmtTokens(m.usage.inputTokens)}</span><span title="tokens out">${ic("arrow-up")} ${fmtTokens(m.usage.outputTokens)}</span>${m.usage.cachedWriteTokens ? `<span title="tokens written to the cache">${ic("database")} ${fmtTokens(m.usage.cachedWriteTokens)}</span>` : ""}`);
      meta.innerHTML = parts.length ? `<span class="stats">${parts.join('<span class="sep">·</span>')}</span>` : "";
      fillSeen(el, room, m);
    } else if (m.from === "human") fillSeen(el, room, m);
    else meta.innerHTML = liveMetaHtml(m) ? `<span class="stats">${liveMetaHtml(m)}</span>` : "";
  }

  function elapsedLabel(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    if (total < 60) return `${total} s`;
    const seconds = String(total % 60).padStart(2, "0");
    const minutes = Math.floor(total / 60) % 60;
    const hours = Math.floor(total / 3600);
    return hours ? `${hours}h ${String(minutes).padStart(2, "0")}m ${seconds}s` : `${minutes}m ${seconds}s`;
  }
  function liveMetaHtml(m) {
    if (!m.streaming || !m.ts) return "";
    const calls = (m.toolCalls || []).length;
    const tools = !m.text && calls ? `<span class="sep">·</span><span title="tool calls so far">${ic("tool")} ${calls}</span>` : "";
    return `<span class="live" data-since="${m.ts}" title="how long this reply has been coming">${ic("clock")} ${elapsedLabel(Date.now() - m.ts)}</span>${tools}`;
  }
  function tickLive() {
    for (const span of els.messages.querySelectorAll(".meta .live")) {
      const since = Number(span.dataset.since);
      if (since) span.innerHTML = `${ic("clock")} ${elapsedLabel(Date.now() - since)}`;
    }
  }

  function lastHumanMessage(room) {
    for (let i = room.messages.length - 1; i >= 0; i--) {
      const m = room.messages[i];
      if (m.kind === "chat" && m.from === "human") return m;
    }
    return null;
  }
  function seenHtml(room, m) {
    const present = room.participants.filter((p) => p.kind === "agent" && p.status !== "left" && p.status !== "offline" && p.id !== m.from);
    if (!present.length) return "";
    const seen = present.filter((p) => p.lastSeenSeq != null && p.lastSeenSeq >= m.seq);
    if (seen.length === present.length) return "";
    const you = m.from !== "human";
    if (!seen.length) return `<span class="ticks">✓</span> sent${you ? " · seen by you" : ""}`;
    return `<span class="ticks">✓✓</span> seen by ${esc([...(you ? ["you"] : []), ...seen.map((p) => p.name)].join(", "))}`;
  }
  function fillSeen(el, room, m) {
    if (m.kind !== "chat" || m.streaming) return;
    const html = seenHtml(room, m);
    if (m.from === "human") {
      const meta = el.querySelector(".meta");
      if (!meta) return;
      meta.innerHTML = html;
      meta.classList.toggle("seen", !!html);
    } else {
      const meta = el.querySelector(".meta");
      let span = meta && meta.querySelector(".seen-by");
      if (!span && meta && html) {
        span = document.createElement("span");
        span.className = "seen-by";
        meta.appendChild(span);
      }
      if (span) {
        span.innerHTML = html;
        span.hidden = !html;
      }
    }
  }
  function refreshSeen(room) {
    const present = room.participants.filter((p) => p.kind === "agent" && p.status !== "left" && p.status !== "offline");
    const floor = present.length ? Math.min(...present.map((p) => (p.lastSeenSeq == null ? 0 : p.lastSeenSeq))) : Infinity;
    const byId = new Map(room.messages.map((m) => [m.id, m]));
    for (const el of els.messages.querySelectorAll(".msg.mine, .msg.agent")) {
      const seq = Number(el.dataset.seq);
      const hasLabel = el.querySelector(".meta.seen, .seen-by:not([hidden])");
      if (seq <= floor && !hasLabel) continue;
      const m = byId.get(el.dataset.id);
      if (!m) continue;
      fillSeen(el, room, m);
      if (m.from === "human" && (seq > floor || el.classList.contains("waiting"))) renderWaiting(el, room, m);
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
    const names = agents.map((p) => p.name);
    const label = names.length === 1 ? `${names[0]} has not seen anything above this line` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} have not seen anything above this line`;
    return UI.el("unseen-line", { label, title: "Vibemates know the room only from their own starting point: the join, a replay of the last N messages, or a restored session." });
  }

  const PAGE_SIZE = 50;
  function placeInList(el) {
    let page = els.messages.lastElementChild;
    if (!page || !page.classList.contains("msgs-page") || page.childElementCount >= PAGE_SIZE) {
      page = document.createElement("div");
      page.className = "msgs-page";
      els.messages.appendChild(page);
    }
    page.appendChild(el);
  }
  function topInList(el) {
    const page = el.parentElement;
    if (!page || !page.classList.contains("msgs-page")) return el.offsetTop;
    if (els.messages.classList.contains("searching") || page.firstElementChild.checkVisibility({ contentVisibilityAuto: true })) return page.offsetTop + el.offsetTop;
    let i = 0;
    for (let n = el.previousElementSibling; n; n = n.previousElementSibling) i++;
    return page.offsetTop + (page.offsetHeight * i) / page.childElementCount;
  }

  function renderMessages() {
    const t0 = performance.now();
    const room = currentRoom();
    els.messages.innerHTML = "";
    els.messages.classList.toggle("searching", !!state.search);
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
        placeInList(d);
        lastDay = day;
      }
      for (const [seq, agents] of markers) {
        if (placed.has(seq) || !(m.seq >= seq)) continue;
        if (m.seq > 0) {
          placed.add(seq);
          placeInList(dividerElement(agents));
        }
      }
      placeInList(messageElement(room, m));
    }
    for (const [seq, agents] of markers) {
      if (!placed.has(seq)) placeInList(dividerElement(agents));
    }
    for (const perm of room.permissions) renderPermission(room, perm);
    for (const prop of room.proposals || []) renderProposal(room, prop);
    refreshSeen(room);
    scrollToBottom();
    renderTimeline();
    noteSlow("full render of the list", performance.now() - t0);
  }

  function upsertMessage(roomId, m) {
    const room = state.rooms.get(roomId);
    if (!room) return;
    if (m.from === "human" && !m.pending && !room.messages.some((x) => x.id === m.id)) {
      const local = room.messages.find((x) => x.pending && x.from === "human" && x.text === m.text);
      if (local) adoptLocalMessage(roomId, local.id, m.id);
    }
    const idx = room.messages.findIndex((x) => x.id === m.id);
    const wasFinal = idx >= 0 && !room.messages[idx].streaming;
    if (idx >= 0) {
      if (!("pinned" in m)) delete room.messages[idx].pinned;
      Object.assign(room.messages[idx], m);
    } else room.messages.push(m);
    const showing = roomId === state.currentRoomId && state.view === "room";
    if (!showing) {
      if (!wasFinal && m.kind === "chat" && !m.streaming && m.from !== "human" && roomId !== state.currentRoomId) state.unread.set(roomId, (state.unread.get(roomId) || 0) + 1);
      if ((state.view === "rooms" || state.view === "home")) {
        renderSideRooms();
        renderRoomsGrid();
      }
      renderRail();
      return;
    }
    const stick = stuck;
    const existing = els.messages.querySelector(`.msg[data-id="${m.id}"]`);
    if (existing) updateMessageElement(existing, room, room.messages[idx]);
    else {
      const empty = els.messages.querySelector(".empty");
      if (empty) empty.remove();
      placeInList(messageElement(room, m));
      if (m.from === "human") refreshSeen(room);
      if (m.streaming && m.from !== "human") renderSideRoom();
      else if (!stick && m.kind === "chat") noteNew(room, m);
    }
    if (stick) scrollToBottom();
    if (m.streaming) updateWorkingNow();
    if (!wasFinal && !m.streaming && m.kind === "chat" && m.from !== "human") noteFinished(room, m);
    if (m.from === "human") renderTimeline();
  }

  function removeMessage(roomId, id) {
    const room = state.rooms.get(roomId);
    if (!room) return;
    room.messages = room.messages.filter((m) => m.id !== id);
    if (roomId !== state.currentRoomId) return;
    const el = els.messages.querySelector(`.msg[data-id="${id}"]`);
    if (el) el.remove();
  }

  const dirty = new Map();
  let flushScheduled = false;
  let lastTypedAt = 0;
  const TYPING_FLUSH_MS = 100;
  const TYPING_WINDOW_MS = 1500;
  const watchingTheBottom = () => stuck;
  function patchMessage(roomId, id, fn) {
    const room = state.rooms.get(roomId);
    if (!room) return;
    const m = room.messages.find((x) => x.id === id);
    if (!m) return;
    fn(m);
    if (roomId !== state.currentRoomId || state.view !== "room") return;
    dirty.set(id, room);
    if (flushScheduled) return;
    flushScheduled = true;
    if (Date.now() - lastTypedAt < TYPING_WINDOW_MS || !watchingTheBottom()) setTimeout(() => requestAnimationFrame(flushPatches), TYPING_FLUSH_MS);
    else requestAnimationFrame(flushPatches);
  }
  function flushPatches() {
    flushScheduled = false;
    const t0 = performance.now();
    const batch = [...dirty];
    dirty.clear();
    let touched = false;
    for (const [id, room] of batch) {
      if (room.id !== state.currentRoomId || state.view !== "room") continue;
      const m = room.messages.find((x) => x.id === id);
      const el = m && els.messages.querySelector(`.msg[data-id="${id}"]`);
      if (!el) continue;
      updateMessageElement(el, room, m);
      touched = true;
    }
    if (touched && stuck) scrollToBottom();
    if (touched) updateWorkingNow();
    if (touched) noteSlow("streamed frame", performance.now() - t0);
  }


  function openInlineEditor(el, room, m) {
    const box = el.querySelector(".edit-box");
    const text = el.querySelector(".text");
    if (!box.hidden) return;
    box.innerHTML = `<textarea class="edit-area" rows="3"></textarea><div class="row-btns">${UI.html("button", { label: "Cancel", kind: "ghost", size: "sm", hook: "edit-cancel" })}${UI.html("button", { label: "Save", kind: "primary", size: "sm", hook: "edit-save" })}</div>`;
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


  function placeCard(card, room, ts) {
    let anchor = null;
    for (const m of room.messages) {
      if (m.ts > ts) break;
      const el = els.messages.querySelector(`.msg[data-id="${CSS.escape(m.id)}"]`);
      if (el) anchor = el;
    }
    if (anchor) anchor.insertAdjacentElement("afterend", card);
    else els.messages.appendChild(card);
  }
  const OPTION_TONE = { allow_once: "ok", allow_always: "ok", reject_once: "no", reject_always: "no" };
  function renderPermission(room, perm) {
    const p = findById(room, perm.participantId);
    const tc = perm.toolCall || {};
    const choices = (perm.options || []).map((option) => ({ label: option.name, tone: OPTION_TONE[option.kind] || "plain", act: "permit", title: option.kind, data: { option: option.optionId } }));
    choices.push({ label: "Dismiss (cancelled)", act: "permit" });
    const card = UI.el("ask-card", { kind: "permission", who: p ? p.name : perm.participantId, subject: tc.title || tc.toolCallId || "tool call", subjectKind: tc.kind || undefined, input: tc.rawInput ? JSON.stringify(tc.rawInput, null, 1) : undefined, choices, data: { key: perm.key } });
    const draft = [...room.messages].reverse().find((m) => m.streaming && m.from === perm.participantId);
    const host = draft ? els.messages.querySelector(`.msg[data-id="${draft.id}"] .perms`) : null;
    if (host) host.appendChild(card);
    else placeCard(card, room, perm.ts || Date.now());
    if (stuck) scrollToBottom();
  }
  function resolvePermissionCard(key, optionId) {
    const card = document.querySelector(`[data-ui="ask-card"][data-kind="permission"][data-key="${CSS.escape(key)}"]`);
    if (!card) return;
    UI.setState(card, "resolved");
    card.querySelector(".choices").replaceChildren(Object.assign(document.createElement("span"), { className: "outcome", textContent: optionId ? `chosen: ${optionId}` : "dismissed" }));
  }

  function proposalValue(v) {
    if (v === null || v === undefined || v === "") return "(empty)";
    if (typeof v === "object") return v.mode === "fixed" ? v.language : v.mode || JSON.stringify(v);
    return String(v);
  }
  function proposalDiffHtml(p) {
    const rows = [];
    for (const c of p.settings || []) {
      if (c.key === "customRules") {
        const before = String(c.from || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const after = String(c.to || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const lines = [...before.filter((l) => !after.includes(l)).map((l) => `<div class="prop-line del">− ${esc(l)}</div>`), ...after.filter((l) => !before.includes(l)).map((l) => `<div class="prop-line add">+ ${esc(l)}</div>`)];
        rows.push(`<div class="prop-row"><b>Room rules</b>${lines.join("")}</div>`);
      } else rows.push(`<div class="prop-row"><b>${esc(c.key)}</b> <span class="prop-from">${esc(proposalValue(c.from))}</span> → <span class="prop-to">${esc(proposalValue(c.to))}</span></div>`);
    }
    for (const c of p.appearance || []) rows.push(`<div class="prop-row"><b>${esc(c.key)}</b> <span class="prop-from">${esc(proposalValue(c.from))}</span> → <span class="prop-to">${esc(proposalValue(c.to))}</span></div>`);
    for (const v of p.vibemates || []) {
      if (v.op === "update") rows.push(`<div class="prop-row"><b>${esc(v.name)}</b>${(v.fields || []).map((f) => `<div class="prop-line">${esc(f.field)}: <span class="prop-from">${esc(f.from || "(empty)")}</span> → <span class="prop-to">${esc(f.to || "(empty)")}</span></div>`).join("")}</div>`);
      else rows.push(`<div class="prop-row"><b>${v.op === "add" ? "New vibemate" : "Remove"}</b> ${esc(v.name)}${v.op === "add" ? ' <span class="hint">(you pick its coding agent)</span>' : ""}</div>`);
    }
    return rows.join("");
  }
  function renderProposal(room, p) {
    const existing = els.messages.querySelector(`[data-ui="ask-card"][data-kind="proposal"][data-key="${CSS.escape(p.key)}"]`);
    const lookRow = (p.appearance || []).find((c) => c.key === "look");
    const lookTarget = lookRow && TOKENS.looks[lookRow.to];
    const windowNote = p.appearance && p.appearance.length
      ? `<div class="prop-window"><span class="note">${ic("eye")} This changes the whole window, not this room alone.</span>${lookTarget ? `<div class="prop-look">${UI.html("look-card", { look: lookTarget, tag: lookTag(lookTarget), title: lookTarget.label })}${p.status === "pending" ? UI.html("button", { label: document.documentElement.dataset.tried === lookTarget.id ? "Back" : "Try it on", kind: "soft", size: "xs", act: "try-look", data: { look: lookTarget.id }, title: "This window only, until you apply or reject" }) : ""}</div>` : ""}</div>`
      : "";
    const body =
      (p.why ? `<div class="prop-why">${esc(p.why)}</div>` : "") +
      `<div class="prop-diff">${proposalDiffHtml(p)}</div>` +
      windowNote +
      (p.warnings && p.warnings.length ? `<ul class="prop-warn">${p.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "") +
      (p.touchesOwn ? `<div class="prop-own">${ic("info")} This changes the rules or ${esc(p.participantName)}'s own persona: it decides how ${esc(p.participantName)} itself will behave.</div>` : "");
    const outcome = p.status === "pending" ? undefined : p.status === "applied" ? `applied${p.skipped && p.skipped.length ? ` · not applied: ${p.skipped.join("; ")}` : ""}` : "rejected";
    const card = UI.el("ask-card", { kind: "proposal", who: p.participantName, body, outcome, choices: [{ label: "Apply", tone: "ok", act: "decide", data: { answer: "apply" } }, { label: "Reject", tone: "no", act: "decide", data: { answer: "reject" } }], data: { key: p.key } });
    if (existing) existing.replaceWith(card);
    else {
      placeCard(card, room, p.ts || Date.now());
      if (stuck) scrollToBottom();
    }
  }
  function resolveProposalCard(room, key, status) {
    const p = (room.proposals || []).find((x) => x.key === key);
    if (p) {
      p.status = status;
      renderProposal(room, p);
    }
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
    return `${avatar(p, 76, { vendor: true, status: true, muted: p.muted })}
        <h3>${esc(p.name)}</h3>
        <div class="tagline">${esc(p.tagline || "no vibersona")}</div>
        <div class="badges">${UI.html("badge", { label: p.agentVendor || p.agentType || "vibemate" })}${UI.html("badge", { label: STATUS_LABEL[p.status] || p.status, tone: STATUS_TONE[p.status] || "plain" })}${p.muted ? UI.html("badge", { label: "muted", tone: "muted" }) : ""}</div>`;
  }
  function refreshDetailsHeader(p) {
    const header = els.detailsInner.querySelector(".profile");
    if (header) header.innerHTML = profileHeader(p);
  }
  function panelTitle(title, sub) {
    return `<div class="panel-title"><div><h3>${title}</h3>${sub ? `<div class="hint">${sub}</div>` : ""}</div>${UI.html("icon-button", { icon: "close", title: "Close", kind: "ghost", size: "sm", id: "details-close" })}</div>`;
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
        <button class="action" data-act="${p.muted ? "unmute" : "mute"}"><span class="ico">${ic(p.muted ? "mute" : "unmute")}</span>${p.muted ? "Unmute" : "Mute"}</button>
        ${offline ? `<button class="action" data-act="reconnect"><span class="ico">${ic("refresh")}</span>Reconnect</button>` : `<button class="action" data-act="cancel" ${p.status !== "thinking" && p.status !== "queued" ? "disabled" : ""}><span class="ico">${ic("stop")}</span>Stop</button>`}
        <button class="action danger" data-act="remove"><span class="ico">${ic("trash")}</span>Remove</button>
      </div>
      <div class="section" id="pp-persona">
        ${sectionTitle("user", "Persona")}
        ${field("Vibename", `<input type="text" id="pp-name" maxlength="24" value="${esc(p.name)}">`)}
        ${field("Vibersona", `<input type="text" id="pp-tagline" maxlength="80" value="${esc(p.tagline || "")}" placeholder="a few words under the vibename">`, "Shown under the vibename.", "Everyone in the room sees it: you, and the other vibemates in their roster.")}
        ${field("Vibeface", `<div id="pp-avatar-picker"></div><input type="text" id="pp-avatar" maxlength="8" value="${esc(p.avatar || "")}" placeholder="custom emoji (optional)">`)}
        ${field("Vibio", `<textarea id="pp-role" rows="5" placeholder="who it is, how it speaks, what it cares about">${esc(p.role || "")}</textarea>`, `Only this vibemate reads it.<span class="count" id="pp-role-count"></span>`, "Reaches the vibemate as refreshed instructions in its brief on its next turn; its memory is kept. The other participants never see it. A vibio and the room rules go into every brief, so the room has a limit for them (the room's settings, for geeks); text over it is never cut in silence.")}
      </div>
      ${p.trouble ? `<div class="trouble"><b>${esc(p.trouble.what)}</b><span>${esc(p.trouble.advice)}</span>${troubleActionsHtml(p)}</div>` : ""}
      ${p.statusDetail && (p.status === "offline" || p.status === "error" || p.failedTurns) ? `<p class="hint" style="color:var(--danger);margin:0 4px 10px">${esc(p.statusDetail)}</p>` : ""}
      ${vendorLoggedOut(p) && p.trouble?.kind !== "login" ? `<div class="pp-login"><div class="row-btns">${UI.html("button", { label: `Log in to ${p.agentVendor || "the vendor"}`, icon: "lock", kind: "primary", size: "sm", act: "open-login-dialog", data: { recipe: p.agentType, purpose: "login" } })}</div><p class="hint">${esc(p.agentVendor || "The vendor")} is not logged in on this machine; log in, and ${esc(p.name)} comes back by itself.</p></div>` : ""}
      <div class="section" id="pp-engine">
        ${sectionTitle("spark", "Coding agent")}
        <p class="hint">What runs ${esc(p.name)}${rec ? `: ${esc(rec.vendor)}` : ""}. Its model, how hard it thinks, what it may do without asking.${geekTip("These options come from the coding agent itself: the hub lists the ones it offers and sets your pick on its running session, so a change takes effect from the next turn, without restarting it or losing what it remembers.")}</p>
        <div id="pp-config"></div>
      </div>
      ${geek(
        "pp-geek",
        `<div class="section" id="pp-skills-section">
        ${sectionTitle("skills", "Skills")}
        <div class="check-list" id="pp-skills"></div>
        <p class="hint" style="margin-top:8px">What this vibemate can load on request.${geekTip(`Listed in this vibemate's brief by name and description; the text arrives when you write /name or when the vibemate loads it. ${esc(skillChannelText(p))}`)}</p>
      </div>
      <div class="section" id="pp-timing">
        ${sectionTitle("bolt", "Timing")}
        ${field("Reply delay override, seconds", `${UI.html("number-field", { id: "pp-delay", value: String(p.replyDelay ?? ""), min: 0, max: 120, step: 0.5, placeholder: `the room's: ${room.settings.replyDelay ?? 4} s` })}`, `Overrides the room's delay (${room.settings.replyDelay ?? 4} s, used only when two or more vibemates are in) for this vibemate only, even when it is alone. Empty: it follows the room.`, "Before each turn the vibemate waits a random 0–N seconds, so replies cross less often. Messages that arrive during the wait land in its backlog, so it can react to them or stay silent.")}
      </div>
      <div class="section danger">
        ${sectionTitle("bolt", "Respawn")}
        <p class="hint">${esc(p.name)} comes back with an empty head: it forgets this conversation entirely. The room's history stays and you still see everything.${geekTip("A session's context cannot be erased, so the vibemate's process and session are closed and it starts a new one with no replay. Its stored session is dropped too, or a later reconnect would bring the old context back. Same thing as typing /respawn @Name in the composer.")}</p>
        <div class="row-btns start">${UI.html("button", { label: `Respawn ${p.name}`, icon: "bolt", kind: "danger", size: "sm", act: "respawn" })}<label class="lp-with">${UI.html("button", { label: "With the last", size: "sm", act: "respawn-mem" })}${UI.html("number-field", { id: "pp-respawn-n", value: String(room.settings.replayAfterRestart ?? 10), min: 0, max: 500 })} messages</label></div>
        <p class="hint">With memory: a new session that gets only ${p.notes ? "its own notes and " : ""}the last N messages of this room; the rest is gone.</p>
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
        "skills, timing, stats",
      )}`;
    wireDetailsClose();
    els.detailsInner.querySelectorAll('.trouble [data-act^="trouble-"]').forEach((btn) => btn.addEventListener("click", () => troubleAction(room, p, btn.dataset.act.slice("trouble-".length), btn).catch(showError)));
    const respawnBtn = els.detailsInner.querySelector('button[data-act="respawn"]');
    if (respawnBtn) respawnBtn.addEventListener("click", () => respawnWith(p, 0));
    const respawnMem = els.detailsInner.querySelector('button[data-act="respawn-mem"]');
    if (respawnMem) respawnMem.addEventListener("click", () => respawnWith(p, Number($("#pp-respawn-n").value) || 0));
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
          } else if (act === "reconnect") openReconnectDialog(room, p);
          else await post(roomApi(`/participants/${encodeURIComponent(p.id)}/${act}`));
        } catch (e) {
          showError(e);
        }
      });
    });
    $("#pp-avatar-picker").appendChild(
      window.Avatars.pickerElement(p.avatar || "", (emoji) => {
        $("#pp-avatar").value = emoji;
        $("#pp-avatar").dispatchEvent(new Event("change", { bubbles: true }));
      }),
    );
    renderSkillChecks($("#pp-skills"), p.skills || []);
    bindSave($("#pp-skills-section"), () => post(roomApi(`/participants/${encodeURIComponent(p.id)}/persona`), { skills: checkedSkills($("#pp-skills")) }));
    bindSave($("#pp-timing"), () => post(roomApi(`/participants/${encodeURIComponent(p.id)}/persona`), { replyDelay: $("#pp-delay").value === "" ? null : Number($("#pp-delay").value) }));
    bindCount($("#pp-role"), $("#pp-role-count"), () => briefTextLimit(currentRoom()));
    bindSave($("#pp-persona"), async () => {
      const role = await fitBriefText($("#pp-role").value, `${p.name}'s vibio`, briefTextLimit(currentRoom()));
      if (role === null) return false;
      await post(roomApi(`/participants/${encodeURIComponent(p.id)}/persona`), { name: $("#pp-name").value, tagline: $("#pp-tagline").value, role, avatar: $("#pp-avatar").value });
      return true;
    });
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
        ${avatar(meAvatarData(), 84, { kind: "card" })}
        <h3>${esc(s.humanName || "")}</h3>
        <div class="tagline">${esc(s.humanDescription || "no vibe line yet")}</div>
      </div>
      <div class="section" id="me-vibe">
        ${sectionTitle("spark", "Vibe")}
        ${field("Vibename", `<input type="text" id="me-name" maxlength="24" value="${esc(s.humanName || "")}">`, "How you appear in every room.")}
        ${field("Vibeface", `<div id="me-avatar-picker"></div><input type="text" id="me-avatar" maxlength="8" value="${esc(s.humanAvatar || "")}" placeholder="custom emoji (optional)">`)}
        ${field("Your vibe line", `<textarea id="me-desc" rows="3" maxlength="200" placeholder="e.g. software engineer, curious about agent protocols; likes short answers">${esc(s.humanDescription || "")}</textarea>`, "A sentence or two about you.", "The vibemates get it in every room's brief, unless a room adds its own line or replaces it (below, when you are in a room).")}
      </div>
      ${
        rs
          ? `<div class="section" id="me-room">
        ${sectionTitle("chat", "In this room")}
        ${field("What vibemates get about you here", `<select id="hp-mode"><option value="inherit"${rs.humanDescriptionMode === "inherit" ? " selected" : ""}>Your vibe line</option><option value="append"${rs.humanDescriptionMode === "append" ? " selected" : ""}>Your vibe line + this room's</option><option value="override"${rs.humanDescriptionMode === "override" ? " selected" : ""}>Only this room's line</option><option value="none"${rs.humanDescriptionMode === "none" ? " selected" : ""}>Nothing about me in this room</option></select>`)}
        ${field("This room's line about you", `<textarea id="hp-desc" rows="3" maxlength="200" placeholder="e.g. host of this session, product owner">${esc(rs.humanDescription || "")}</textarea>`)}
      </div>`
          : ""
      }
      <div class="section danger">
        ${sectionTitle("alert", "Danger zone")}
        <p class="field-note">Erases everything in this viberoom: your vibe, all rooms and their history, vibemate sessions, your skills. Not undoable.</p>
        <div class="row-btns start">${UI.html("button", { label: "Erase my vibe", icon: "bolt", kind: "danger", size: "sm", id: "me-erase" })}</div>
      </div>`;
    wireDetailsClose();
    $("#me-avatar-picker").appendChild(
      window.Avatars.pickerElement(s.humanAvatar || "", (emoji) => {
        $("#me-avatar").value = emoji;
        $("#me-avatar").dispatchEvent(new Event("change", { bubbles: true }));
      }),
    );
    bindSave($("#me-vibe"), () => post("/api/settings", { humanName: $("#me-name").value, humanAvatar: $("#me-avatar").value, humanDescription: $("#me-desc").value }));
    bindSave($("#me-room"), () => post(roomApi("/settings"), { humanDescriptionMode: $("#hp-mode").value, humanDescription: $("#hp-desc").value }));
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
        ${field("Folder", `<span class="dir-row"><input type="text" id="rp-dir" maxlength="1000" value="${esc(room.dir)}" spellcheck="false">${UI.html("button", { label: "Browse", icon: "folder", kind: "ghost", id: "rp-dir-browse", title: "Choose a folder", hook: "browse-btn" })}</span>`, "Where the vibemates read and write. Changing it restarts them in the new folder; they replay the last messages.")}
        <div class="field mention-host"><span class="label">Room rules${geekTip("References follow renames and note when a participant has left. Rules go into every vibemate's brief as instructions, not as routing.")}</span><div id="rp-rules" class="rules-editor" contenteditable="true" spellcheck="true" data-placeholder="e.g. Everyone listens to @Pesho, he is the manager. Keep answers under 3 sentences."></div><span class="hint">One rule per line; type @ to reference a participant.<span class="count" id="rp-rules-count"></span></span><div class="mention-menu inline" id="rp-rules-menu" hidden></div></div>
        ${field("Language", `<input type="text" id="rp-lang" value="${esc(lang)}" placeholder="follow the human (default), or e.g. English">`)}
      </div>
      <div class="section">
        ${sectionTitle("user", "Turn taking")}
        ${field("Who may speak", `<select id="rp-turns"><option value="one-at-a-time"${rs.turnTaking !== "parallel" ? " selected" : ""}>One vibemate at a time</option><option value="parallel"${rs.turnTaking === "parallel" ? " selected" : ""}>All addressed vibemates at once</option></select>`, null, "One at a time: the others queue and see the earlier replies before they answer; the addressed vibemates go first. All at once: fastest, but replies may cross.")}
        ${field("Reply delay, seconds", `${UI.html("number-field", { id: "rp-delay", value: String(rs.replyDelay ?? 4), min: 0, max: 120, step: 0.5 })}`, "With two or more vibemates, each waits a random 0–N seconds before it answers, so replies cross less often. A vibemate alone answers at once. A vibemate's own delay (in its panel) always applies.")}
        <label class="switch"><span class="label">Vibemates wake each other<span class="hint">A reply without @ wakes every other vibemate, as yours does; each may answer or stay silent. Off: only @Name wakes a vibemate. The hop limit applies either way.</span></span><input type="checkbox" id="rp-wake" ${rs.agentsWakeEachOther !== false ? "checked" : ""}></label>
        <label class="switch"><span class="label">Wait while you are typing<span class="hint">A vibemate about to start holds back while you type (a few seconds after your last keystroke). A reply already under way is not interrupted.</span></span><input type="checkbox" id="rp-wait-typing" ${rs.waitWhileHumanTypes !== false ? "checked" : ""}></label>
      </div>
      <div class="section template">
        ${sectionTitle("rooms", "Turn this room into a template")}
        <p class="field-note">Its settings, rules, folder and vibemates (with the coding agent each runs on) become one of your templates, listed first under "Start from a template". You see everything it will contain, and can change any of it, before you create it.</p>
        <div class="row-btns start stp-row">${UI.html("button", { label: "Preview and create template", icon: "rooms", kind: "primary", size: "sm", id: "rp-template" })}</div>
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
        ${field("Max sentences per reply", `${UI.html("number-field", { id: "rp-maxlen", value: String(rs.maxSentences ?? ""), min: 1, max: 100, placeholder: "no limit" })}`)}
        ${field("Hop limit (vibemate-to-vibemate replies per human message)", `${UI.html("number-field", { id: "rp-hops", value: String(rs.hopLimit), min: 0, max: 10000 })}`)}
      </div>
      <div class="section">
        ${sectionTitle("eye", "Referee")}
        ${field("When a reply breaks a mechanical rule (unknown @, self-@, length)", `<select id="rp-referee"><option value="next-header"${rs.refereeAction !== "retry-hidden" ? " selected" : ""}>Post it; remind the agent in its next header</option><option value="retry-hidden"${rs.refereeAction === "retry-hidden" ? " selected" : ""}>Hold it; ask for a corrected version in a hidden turn</option></select>`)}
      </div>
      <div class="section">
        ${sectionTitle("save", "Instruction delivery")}
        ${field("Full brief every N vibemate turns", `${UI.html("number-field", { id: "rp-brief-turns", value: String(rs.fullBriefEveryTurns), min: 1, max: 10000 })}`)}
        ${field("…or every N new context tokens", `${UI.html("number-field", { id: "rp-brief-tokens", value: String(rs.fullBriefEveryTokens), min: 1000, max: 10000000, step: 1000 })}`)}
        <label class="switch"><span class="label">Repeat core rules in every header</span><input type="checkbox" id="rp-header-rules" ${rs.headerRules ? "checked" : ""}></label>
        <label class="switch"><span class="label">Show vendor and model to other vibemates</span><input type="checkbox" id="rp-vendor" ${rs.showVendorInRoster ? "checked" : ""}></label>
        ${field("Replay last N chat messages after a reconnect", `${UI.html("number-field", { id: "rp-replay", value: String(rs.replayAfterRestart), min: 0, max: 200 })}`)}
        ${field("Missed messages a vibemate reads at most on its next turn", `${UI.html("number-field", { id: "rp-backlog", value: String(rs.backlogCap), min: 1, max: 1000 })}`, "Everything posted since its last turn counts, including while it was muted; older messages are dropped with a note in its prompt.")}
        ${field("Most characters in a vibio or in the room rules", `${UI.html("number-field", { id: "rp-text-limit", value: String(rs.briefTextLimit ?? 8000), min: 500, max: 32000, step: 500 })}`, "Both go into every brief. Text over the limit is refused with the numbers, never cut.")}
      </div>`,
        "tools, hops, referee, briefs",
      )}
      <div class="save-row" style="margin-top:10px"><span class="hint">The vibemates get the changes on their next turn.</span></div>
      </div>
      <div class="section danger" style="margin-top:12px">
        ${sectionTitle("alert", "Danger zone")}
        <p class="field-note">Closes every vibemate in this room and removes it from the list. Its history and files move to the trash folder of your viberoom data; a new room with the same name starts empty.</p>
        <div class="row-btns start">${UI.html("button", { label: "Close this room for good", icon: "trash", kind: "danger", size: "sm", id: "rp-delete" })}</div>
      </div>`;
    wireDetailsClose();
    rulesToNodes($("#rp-rules"), room.customRulesText != null ? room.customRulesText : rs.customRules || "", room);
    attachRichMentions($("#rp-rules"), $("#rp-rules-menu"));
    bindCount($("#rp-rules"), $("#rp-rules-count"), () => Number($("#rp-text-limit").value) || briefTextLimit(room));
    $("#rp-text-limit").addEventListener("input", () => $("#rp-rules").dispatchEvent(new Event("input")));
    $("#rp-emoji-picker").appendChild(
      emojiGrid(ROOM_EMOJI, rs.emoji || "", (emoji) => {
        $("#rp-emoji").value = emoji;
        $("#rp-emoji").dispatchEvent(new Event("change", { bubbles: true }));
      }),
    );
    $("#rp-dir-browse").addEventListener("click", () => openFolderPicker($("#rp-dir").value, (dir) => {
      $("#rp-dir").value = dir;
      $("#rp-dir").dispatchEvent(new Event("change", { bubbles: true }));
    }));
    $("#rp-template").addEventListener("click", () => openSaveTemplateDialog(room));
    bindSave($("#rp-form"), async () => {
        const name = $("#rp-name").value;
        if (name.trim() !== room.name) await post(roomApi("/rename"), { name });
        const dir = $("#rp-dir").value.trim();
        if (dir && dir !== room.dir) await post(roomApi("/dir"), { dir });
        const rules = await fitBriefText(rulesText($("#rp-rules")), "The room rules text", Number($("#rp-text-limit").value) || briefTextLimit(room), $("#rp-text-limit"));
        if (rules === null) return false;
        await post(roomApi("/settings"), {
          emoji: $("#rp-emoji").value,
          topic: $("#rp-topic").value,
          customRules: rules,
          briefTextLimit: Number($("#rp-text-limit").value),
          language: $("#rp-lang").value.trim() || "follow-human",
          tools: $("#rp-tools").value,
          maxSentences: $("#rp-maxlen").value === "" ? null : Number($("#rp-maxlen").value),
          hopLimit: Number($("#rp-hops").value),
          fullBriefEveryTurns: Number($("#rp-brief-turns").value),
          fullBriefEveryTokens: Number($("#rp-brief-tokens").value),
          headerRules: $("#rp-header-rules").checked,
          showVendorInRoster: $("#rp-vendor").checked,
          replayAfterRestart: Number($("#rp-replay").value),
          backlogCap: Number($("#rp-backlog").value),
          refereeAction: $("#rp-referee").value,
          turnTaking: $("#rp-turns").value,
          waitWhileHumanTypes: $("#rp-wait-typing").checked,
          agentsWakeEachOther: $("#rp-wake").checked,
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
          <div class="vc-head">${vendorLogo(r)}<span class="vc-name">${esc(r.vendor)}</span>${UI.html("badge", { label: "installed", tone: "ready", dot: true })}</div>
          <div class="vc-fields">
            ${field("Model", `<input type="text" data-vendor="${r.id}" data-key="model" value="${esc(v.model || "")}" placeholder="${esc(r.defaultModel || "vibemate default")}">`)}
            ${field("Effort", `<input type="text" data-vendor="${r.id}" data-key="effort" value="${esc(v.effort || "")}" placeholder="${esc(r.defaultEffort || "vibemate default")}">`)}
            ${field("Mode", `<input type="text" data-vendor="${r.id}" data-key="mode" value="${esc(v.mode || "")}" placeholder="${esc(r.defaultMode || "vibemate default")}">`)}
          </div>
        </div>`;
      })
      .join("");
    const logo = (r) => vendorLogo(r);
    const machine =
      installed
        .map((r) => {
          const out = r.loginState === "missing";
          const where = out ? `not logged in — run <code>${esc(r.loginCommand)}</code>` : esc(r.installedAt || "bundled");
          return `<div class="vendor-row">${logo(r)}<span class="vc-name">${esc(r.vendor)}<span class="hint" title="${esc(r.installedAt || "")}">${where}</span></span>${UI.html("badge", { label: out ? "no login" : "installed", tone: out ? "thinking" : "ready", dot: true })}</div>`;
        })
        .join("") +
      missing.map((r) => `<div class="vendor-row" style="opacity:.75">${logo(r)}<span class="vc-name">${esc(r.vendor)}<span class="hint">${esc(r.installHint || r.unavailableReason || "")}</span></span>${UI.html("badge", { label: "not installed", tone: "asleep" })}</div>`).join("");
    els.pageInner.innerHTML = `
      <div class="page-head"><div><h1>Settings</h1><div class="hint">${state.version ? `${esc(state.version.name)} ${esc(state.version.version)} · hub built ${esc(new Date(state.version.build).toLocaleString())}` : "hub build unknown (older hub process; run viberoom again to replace it)"}</div></div></div>
      <div id="sp-form">
      <div class="page-cols">
        <div>
          <div class="section" id="sp-appearance">
            ${sectionTitle("eye", "Appearance")}
            ${(() => {
              const a = s.appearance || {};
              const lookId = TOKENS.looks[a.look] ? a.look : TOKENS.current.id;
              const look = TOKENS.looks[lookId];
              const custom = (a.custom || {})[lookId] || {};
              const cards = Object.values(TOKENS.looks).map((l) => UI.html("look-card", { look: l, tag: lookTag(l), on: lookId === l.id, data: { look: l.id } })).join("");
              const groups = [...new Set(TOKENS.adjustables.map((f) => f.group))];
              const rows = (group) => TOKENS.adjustables.filter((f) => f.group === group).map((f) => UI.html("adjust-row", { key: f.key, label: f.label, hint: f.hint, kind: f.kind, value: custom[f.key] || String(f.of(look)), own: String(f.of(look)), min: f.min, max: f.max, step: f.step })).join("");
              return `<div class="look-preview" id="sp-look-preview">${lookSampleHtml()}</div>
              ${field("Look", `<input type="hidden" id="sp-look" value="${esc(lookId)}"><div class="look-cards">${cards}</div><div class="look-own" id="sp-look-own">${UI.html("button", { label: "Import a look…", kind: "ghost", size: "xs", hook: "sp-look-import", title: "A look file (.json) saved from viberoom, yours or someone else's" })}<span class="own-only"${look.custom ? "" : " hidden"}>${UI.html("button", { label: "Export", kind: "ghost", size: "xs", hook: "sp-look-export", title: "Save this look as a file, to share or keep" })}${UI.html("button", { label: "Delete", kind: "danger", size: "xs", hook: "sp-look-delete", title: "Remove this look from your own looks" })}</span><input type="file" id="sp-look-file" accept=".json,application/json" hidden></div>`, "How the room is drawn. Every element keeps what it does; only its look changes. The sample above wears the look you pick; the window changes on save. Your own looks (a vibemate's, or a file you import) come after the ones viberoom ships.")}
              <div class="look-adjust" id="sp-look-adjust">
                <div class="adjust-head"><span class="label">Fine-tune <span id="sp-adj-name">${esc(look.label)}</span></span>${UI.html("button", { label: "Reset all", kind: "ghost", size: "xs", hook: "sp-adj-reset", title: "Back to the look as designed" })}</div>
                <p class="hint">Kept for this look alone. The sample follows as you pick; the window follows on save.</p>
                ${groups.map((g) => `<div class="adjust-group"><h5>${esc(g)}</h5>${rows(g)}</div>`).join("")}
              </div>`;
            })()}
            <div class="adjust-group text"><h5>Text</h5>
              <div class="field row"><span class="label">Size, px<span class="hint">Only the text changes size; the boxes, buttons and panels stay. 14.5 is the default.</span></span>${UI.html("number-field", { id: "sp-chat-fs", value: String((s.appearance || {}).chatFontSize || 14.5), min: 12, max: 24, step: 0.5 })}</div>
              <div class="field row"><span class="label">Font${geekTip("The named fonts come with viberoom and look the same on every OS (all free, with Cyrillic); the system entries use what this machine has. A look with a font of its own (Terminal, Clay) keeps it while this stays at the default.")}</span><select id="sp-font">${Object.entries(FONTS.text).map(([id, f]) => `<option value="${id}"${((s.appearance || {}).font || "nunito") === id ? " selected" : ""}>${esc(f.label)}</option>`).join("")}</select></div>
              <div class="field row"><span class="label">Code font<span class="hint">For code blocks, paths and tool output.</span></span><select id="sp-mono">${Object.entries(FONTS.mono).map(([id, f]) => `<option value="${id}"${((s.appearance || {}).mono || "jetbrains-mono") === id ? " selected" : ""}>${esc(f.label)}</option>`).join("")}</select></div>
              <div class="bubble" id="sp-chat-sample" style="display:inline-block;font-size:${(s.appearance || {}).chatFontSize || 14.5}px">Messages will read like this, with <code>code</code> a step smaller.</div>
            </div>
          </div>
          <div class="section">
            ${sectionTitle("lock", "Permissions")}
            <label class="switch"><span class="label">Vibemates act without asking<span class="hint">Off: they ask you before editing files or running commands.</span>${geekTip('New vibemates start in their vendor\'s "act without asking" mode (Claude bypassPermissions, Codex agent-full-access, Gemini yolo, Cursor agent, OpenCode build, Copilot agent + allow_all). Change it per vibemate when summoning one, or later in its panel.')}</span><input type="checkbox" id="sp-bypass" ${s.bypassPermissionsByDefault !== false ? "checked" : ""}></label>
          </div>
          <div class="section">
            ${sectionTitle("bolt", "Pace")}
            ${field("Turn taking in new rooms", `<select id="sp-turns"><option value="one-at-a-time"${d.turnTaking !== "parallel" ? " selected" : ""}>One vibemate at a time</option><option value="parallel"${d.turnTaking === "parallel" ? " selected" : ""}>All addressed vibemates at once</option></select>`)}
            ${field("Reply delay in new rooms, seconds", `${UI.html("number-field", { id: "sp-delay", value: String(d.replyDelay ?? 4), min: 0, max: 120, step: 0.5 })}`, "Used when two or more vibemates share a room; each room can change it; a vibemate can override it in its own panel.", "Before each turn a vibemate waits a random 0–N seconds, so replies cross less often. Messages that arrive meanwhile land in its backlog. A vibemate alone answers at once unless it has its own delay.")}
          </div>
          <div class="section" id="sp-editor">
            ${sectionTitle("pencil", "Open files at a line")}
            <label class="field"><span class="label">A click on a path like main.ts:375 opens the file in${geekTip("Only an editor can jump to a line; the OS default app just opens the file. Auto looks for VS Code, Cursor, Windsurf, Zed, Sublime Text, Notepad++ and the JetBrains IDEs, in that order, on PATH and in their usual folders. Custom: a command with {file}, {line} and {column} placeholders, e.g. code --goto {file}:{line}.")}</span>
              <div class="chips editor-modes">
                ${UI.html("choice", { label: "Auto", on: !["custom", "default-app"].includes((s.editor || {}).mode), data: { mode: "auto" } })}
                ${UI.html("choice", { label: "The default app", on: (s.editor || {}).mode === "default-app", data: { mode: "default-app" } })}
                ${UI.html("choice", { label: "My own command", on: (s.editor || {}).mode === "custom", data: { mode: "custom" } })}
              </div>
              <input type="hidden" id="sp-editor-mode" value="${esc((s.editor || {}).mode || "auto")}">
            </label>
            ${field("Command", `<input type="text" id="sp-editor-cmd" maxlength="500" value="${esc((s.editor || {}).command || "")}" placeholder="code --goto {file}:{line}">`, "{file}, {line} and {column} are filled in; quotes group arguments.")}
          </div>
          <div class="section" id="sp-diagrams">
            ${sectionTitle("wand", "Diagrams")}
            <div class="field"><span class="label">Colours of the boxes${geekTip("Vibemates draw diagrams as Mermaid (a ```mermaid block in a message); the room renders them here, with these colours. Mermaid derives the shades of borders and text from the box colour.")}</span>
              <div class="chips diagram-presets">${Object.entries(DIAGRAM_PRESETS).map(([id, p]) => UI.html("choice", { label: p.label, on: dg.preset === id, data: { preset: id }, lead: UI.raw(`<span class="swatch" style="${p.palette ? `background:linear-gradient(90deg, ${p.palette.map((c) => c.fill).join(", ")});border-color:${p.palette[0].stroke}` : `background:${p.primaryColor};border-color:${p.primaryBorderColor}`}"></span>`) })).join("")}</div>
              <input type="hidden" id="sp-diagram-preset" value="${esc(dg.preset)}">
            </div>
            <label class="switch"><span class="label">My own colour for the boxes</span><input type="checkbox" id="sp-diagram-custom" ${dg.primary ? "checked" : ""}></label>
            <div class="field row" id="sp-diagram-color-row" ${dg.primary ? "" : "hidden"}><span class="label">Box colour</span><input type="color" id="sp-diagram-color" value="${esc(dg.primary || TOKENS.diagrams.customBoxDefault)}" style="width:46px;height:30px;padding:2px"></div>
            ${mermaidBlock("graph LR\n  A[You] --> B(Vibemate)\n  B --> C{Agreed?}\n  C -->|yes| D[Done]\n  C -->|no| B").replace('class="mermaid-block"', 'class="mermaid-block preview"')}
          </div>
        </div>
        <div>
          <div class="section" id="sp-update">
            ${sectionTitle("refresh", "Updates")}
            <label class="switch"><span class="label">Check for updates once a day<span class="hint">At start, one request to the npm registry for the latest viberoom version; nothing else leaves this machine. A newer version shows as a bubble over your avatar.</span></span><input type="checkbox" id="sp-updates" ${s.checkForUpdates !== false ? "checked" : ""}></label>
            <p class="hint" id="sp-update-status">${updateStatusText()}</p>
            ${UI.html("button", { label: "Check now", size: "sm", id: "sp-update-check" })}
          </div>
          <div class="section" id="sp-restart">
            ${sectionTitle("refresh", "Restart")}
            <p class="hint" style="margin-bottom:10px">Starts the hub again with what is on disk. The vibemates' sessions end and they come back through "Welcome back"; this window reconnects on its own. Closing the window does not do this: the hub keeps running in the background, which is why it can stay on an older build than the one you have.</p>
            ${state.version && state.version.staleSource ? `<p class="hint warn" style="margin-bottom:10px">This hub is older than the code on disk: <code>${esc(state.version.staleSource)}</code> changed after it was built. Restart takes what is built; in a source checkout run <code>node scripts/update.mjs</code>, which builds first.</p>` : ""}
            ${UI.html("button", { label: "Restart viberoom", size: "sm", id: "sp-restart-now" })}
          </div>
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
            ${field("Hop limit", `${UI.html("number-field", { id: "sp-hops", value: String(d.hopLimit), min: 0, max: 10000 })}`, "How many vibemate-to-vibemate replies may follow one message of yours before the room waits for you again.")}
            ${field("Full brief every N turns", `${UI.html("number-field", { id: "sp-brief-turns", value: String(d.fullBriefEveryTurns), min: 1, max: 10000 })}`, "How often a vibemate gets the whole room brief again instead of the short header.")}
            ${field("Full brief every N tokens", `${UI.html("number-field", { id: "sp-brief-tokens", value: String(d.fullBriefEveryTokens), min: 1000, max: 10000000, step: 1000 })}`, "…or after this much new context since its last full brief, whichever comes first.")}
            ${field("Most characters in a vibio or in the room rules", `${UI.html("number-field", { id: "sp-text-limit", value: String(d.briefTextLimit ?? 8000), min: 500, max: 32000, step: 500 })}`, "Both go into every brief. Over the limit, the text is refused with the numbers, never cut; each room can raise or lower its own.")}
            <label class="switch"><span class="label">Repeat core rules in every header<span class="hint">The short header before each turn repeats the room's core rules (who is here, how to address, how long to write).</span></span><input type="checkbox" id="sp-header-rules" ${d.headerRules ? "checked" : ""}></label>
            ${field("Tools", `<select id="sp-tools"><option value="on-request"${d.tools === "on-request" ? " selected" : ""}>Only when asked</option><option value="never"${d.tools === "never" ? " selected" : ""}>Never</option></select>`, "Whether vibemates may use their own tools (files, shell, web) without being asked to.")}
          </div>
          <div class="section">
            ${sectionTitle("skills", "Skills from vibemates")}
            <label class="switch"><span class="label">Vibemate-created skills need my approval<span class="hint">Off: a skill a vibemate creates is usable at once and shows as "unreviewed" until you open it. On: it stays a draft (not delivered, not attachable) until you approve it under Skills.</span></span><input type="checkbox" id="sp-skill-approval" ${s.agentSkillsNeedApproval ? "checked" : ""}></label>
          </div>
        </div>
        <div>
          <div class="section" id="sp-slow">
            ${sectionTitle("clock", "Rendering in this window")}
            <p class="hint" style="margin-bottom:10px">Everything this window spent more than 8 ms on, newest first: the moment, the cost, what it was, and what the room was doing then. Anything over 50 ms the browser reports by itself, ours or not. When something feels slow, copy the list into the room: it says where to look, which a measurement from outside cannot.</p>
            ${slowTasksHtml()}
            ${UI.html("button", { label: "Copy the list", size: "sm", id: "sp-slow-copy" })}
          </div>
          <div class="section">
            ${sectionTitle("settings", "Presets per vibemate")}
            <p class="hint" style="margin-bottom:10px">Used when you summon one; leave a field empty for the built-in suggestion. The summon dialog always shows what the vibemate really offers. Bypass modes: Claude bypassPermissions, Codex agent-full-access, Gemini yolo, Cursor agent, OpenCode build, Copilot agent + allow_all.</p>
            ${presets || '<p class="hint">No supported vibemate is installed yet.</p>'}
          </div>
        </div>
      </div>`,
        "room defaults, presets per vibemate, vibemate skills, rendering",
      )}
      </div>`;
    const editorSection = $("#sp-editor");
    const editorCmdRow = $("#sp-editor-cmd").closest(".field");
    const showEditorCmd = () => (editorCmdRow.hidden = $("#sp-editor-mode").value !== "custom");
    showEditorCmd();
    editorSection.querySelectorAll('.editor-modes [data-ui="choice"]').forEach((b) =>
      b.addEventListener("click", () => {
        editorSection.querySelectorAll('.editor-modes [data-ui="choice"]').forEach((x) => UI.setState(x, x === b ? "on" : null));
        const input = $("#sp-editor-mode");
        input.value = b.dataset.mode;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        showEditorCmd();
      }),
    );
    const diagramSection = $("#sp-diagrams");
    const previewTheme = () => ({ preset: $("#sp-diagram-preset").value, primary: $("#sp-diagram-custom").checked ? $("#sp-diagram-color").value : null });
    const redrawPreview = () => {
      const block = diagramSection.querySelector(".mermaid-block.preview");
      delete block.dataset.rendered;
      block.querySelector(".mm-out").innerHTML = `<pre>${esc(block.dataset.src)}</pre>`;
      renderDiagrams(diagramSection, previewTheme());
    };
    diagramSection.querySelectorAll('.diagram-presets [data-ui="choice"]').forEach((b) =>
      b.addEventListener("click", () => {
        diagramSection.querySelectorAll('.diagram-presets [data-ui="choice"]').forEach((x) => UI.setState(x, x === b ? "on" : null));
        const input = $("#sp-diagram-preset");
        input.value = b.dataset.preset;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        redrawPreview();
      }),
    );
    $("#sp-diagram-custom").addEventListener("change", () => {
      $("#sp-diagram-color-row").hidden = !$("#sp-diagram-custom").checked;
      redrawPreview();
    });
    $("#sp-diagram-color").addEventListener("input", redrawPreview);
    renderDiagrams(diagramSection, previewTheme());
    const sample = $("#sp-chat-sample");
    $("#sp-chat-fs").addEventListener("input", () => {
      const px = Number($("#sp-chat-fs").value);
      if (px >= 12 && px <= 24) sample.style.fontSize = `${px}px`;
    });
    $("#sp-font").addEventListener("change", () => (sample.style.fontFamily = FONTS.text[$("#sp-font").value].stack));
    const looksBox = $("#sp-appearance");
    const pickedLook = () => TOKENS.looks[$("#sp-look").value] || TOKENS.current;
    const rowOf = (key) => looksBox.querySelector(`[data-ui="adjust-row"][data-key="${key}"]`);
    const inputOf = (key) => {
      const row = rowOf(key);
      return row ? row.querySelector("input") : null;
    };
    const pendingAdjust = () => {
      const look = pickedLook();
      const out = {};
      for (const f of TOKENS.adjustables) {
        const input = inputOf(f.key);
        const value = String(input ? input.value : "").toLowerCase();
        if (value && value !== String(f.of(look)).toLowerCase()) out[f.key] = value;
      }
      return out;
    };
    const paintRows = () => {
      const look = pickedLook();
      for (const f of TOKENS.adjustables) {
        const row = rowOf(f.key);
        const input = inputOf(f.key);
        if (!row || !input) continue;
        const own = String(f.of(look));
        UI.setState(row, input.value.toLowerCase() !== own.toLowerCase() ? "changed" : null);
        row.querySelector(".value").textContent = input.value;
        row.querySelector(".back").title = `Back to the look's own, ${own}`;
      }
    };
    const paintLookPreview = () => {
      const preview = $("#sp-look-preview");
      if (!preview) return;
      const look = pickedLook();
      preview.dataset.look = look.id;
      for (const [name, value] of Object.entries(TOKENS.cssVars(look))) preview.style.setProperty(name, value);
      applyCustomVars(preview, pendingAdjust());
      paintRows();
    };
    const fillRows = (lookId) => {
      const look = TOKENS.looks[lookId] || TOKENS.current;
      const custom = ((state.settings.appearance || {}).custom || {})[look.id] || {};
      for (const f of TOKENS.adjustables) {
        const input = inputOf(f.key);
        if (input) input.value = custom[f.key] || String(f.of(look));
      }
      $("#sp-adj-name").textContent = look.label;
    };
    looksBox.querySelectorAll('.look-cards [data-ui="look-card"]').forEach((b) =>
      b.addEventListener("click", () => {
        looksBox.querySelectorAll('.look-cards [data-ui="look-card"]').forEach((x) => {
          UI.setState(x, x === b ? "on" : null);
          x.setAttribute("aria-pressed", x === b ? "true" : "false");
        });
        const input = $("#sp-look");
        input.value = b.dataset.look;
        fillRows(b.dataset.look);
        paintLookPreview();
        paintOwnRow();
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }),
    );
    const paintOwnRow = () => {
      const own = looksBox.querySelector("#sp-look-own .own-only");
      if (own) own.hidden = !pickedLook().custom;
    };
    looksBox.querySelector(".sp-look-import").addEventListener("click", () => $("#sp-look-file").click());
    $("#sp-look-file").addEventListener("change", async () => {
      const file = $("#sp-look-file").files && $("#sp-look-file").files[0];
      $("#sp-look-file").value = "";
      if (!file) return;
      try {
        const spec = JSON.parse(await file.text());
        const checked = await post("/api/looks/check", { spec });
        if (!checked.ok) throw new Error(`${file.name} is not a look viberoom can wear: ${(checked.errors || []).map((x) => x.message).join("; ")}`);
        const taken = TOKENS.looks[checked.id];
        if (taken && !taken.custom) throw new Error(`"${checked.id}" is the id of a look viberoom ships; change the id in the file`);
        if (taken && !(await confirmDialog(`You have a look "${taken.label}" with this id already. Replace it with the one from ${file.name}?`, { title: "Replace the look?", okLabel: "Replace" }))) return;
        const saved = await post("/api/looks", { spec, replace: !!taken });
        toast(`Look "${saved.look.label}" ${taken ? "replaced" : "added"}: it is in the list now.${(saved.warnings || []).length ? ` ${saved.warnings.map((w) => w.message).join(" ")}` : ""}`, "success");
      } catch (error) {
        showError(error);
      }
    });
    looksBox.querySelector(".sp-look-export").addEventListener("click", () => {
      const look = pickedLook();
      const spec = state.looks.find((l) => l.id === look.id);
      if (!spec) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([`${JSON.stringify(spec, null, 2)}\n`], { type: "application/json" }));
      a.download = `${look.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    looksBox.querySelector(".sp-look-delete").addEventListener("click", async () => {
      const look = pickedLook();
      if (!look.custom) return;
      const ok = await confirmDialog(`"${look.label}" goes from your looks; a window wearing it falls back to VibeClassic. The file is gone too (export it first to keep it).`, { title: "Delete the look?", okLabel: "Delete", danger: true });
      if (!ok) return;
      try {
        await post("/api/looks/remove", { id: look.id });
        toast(`Look "${look.label}" deleted.`, "success");
      } catch (error) {
        showError(error);
      }
    });
    looksBox.querySelectorAll('[data-ui="adjust-row"] input').forEach((i) => i.addEventListener("input", paintLookPreview));
    looksBox.addEventListener("click", (e) => {
      const back = e.target.closest && e.target.closest('[data-ui="adjust-row"] .back');
      if (!back) return;
      const row = back.closest('[data-ui="adjust-row"]');
      const f = TOKENS.adjustables.find((x) => x.key === row.dataset.key);
      const input = row.querySelector("input");
      if (!f || !input) return;
      input.value = String(f.of(pickedLook()));
      paintLookPreview();
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    looksBox.querySelector(".sp-adj-reset").addEventListener("click", () => {
      const look = pickedLook();
      for (const f of TOKENS.adjustables) {
        const input = inputOf(f.key);
        if (input) input.value = String(f.of(look));
      }
      paintLookPreview();
      $("#sp-look").dispatchEvent(new Event("change", { bubbles: true }));
    });
    paintLookPreview();
    $("#sp-mono").addEventListener("change", () => sample.querySelectorAll("code").forEach((c) => (c.style.fontFamily = FONTS.mono[$("#sp-mono").value].stack)));
    $("#sp-slow-copy").addEventListener("click", async () => {
      const b = $("#sp-slow-copy");
      try {
        await navigator.clipboard.writeText(slowTasksText() || "nothing over 8 ms in this window");
        b.textContent = "Copied";
        setTimeout(() => (b.textContent = "Copy the list"), 1500);
      } catch (e) {
        showError(e);
      }
    });
    $("#sp-restart-now").addEventListener("click", async () => {
      const ok = await confirmDialog('Every vibemate loses its session and comes back through "Welcome back". This window reconnects on its own.', { title: "Restart viberoom?", okLabel: "Restart" });
      if (!ok) return;
      const button = $("#sp-restart-now");
      button.disabled = true;
      button.textContent = "Restarting…";
      try {
        await post("/api/restart");
        toast("viberoom is restarting; the window reconnects on its own.", "success");
      } catch (error) {
        showError(error);
        button.disabled = false;
        button.textContent = "Restart viberoom";
      }
    });
    $("#sp-update-check").addEventListener("click", async () => {
      const b = $("#sp-update-check");
      b.disabled = true;
      UI.setState(b, "loading");
      try {
        state.update = await get("/api/update?check=1");
        $("#sp-update-status").textContent = updateStatusText();
        renderUpdatePop();
      } catch (e) {
        showError(e);
      }
      b.disabled = false;
      UI.setState(b, null);
    });
    bindSave($("#sp-form"), async () => {
        const vendorPresets = {};
        els.pageInner.querySelectorAll("input[data-vendor]").forEach((inp) => {
          vendorPresets[inp.dataset.vendor] = vendorPresets[inp.dataset.vendor] || { model: null, effort: null, mode: null };
          vendorPresets[inp.dataset.vendor][inp.dataset.key] = inp.value.trim() || null;
        });
        await post("/api/settings", {
          bypassPermissionsByDefault: $("#sp-bypass").checked,
          agentSkillsNeedApproval: $("#sp-skill-approval").checked,
          checkForUpdates: $("#sp-updates").checked,
          diagrams: { preset: $("#sp-diagram-preset").value, primary: $("#sp-diagram-custom").checked ? $("#sp-diagram-color").value : null },
          editor: { mode: $("#sp-editor-mode").value, command: $("#sp-editor-cmd").value },
          appearance: { chatFontSize: Number($("#sp-chat-fs").value), font: $("#sp-font").value, mono: $("#sp-mono").value, look: $("#sp-look").value, custom: { [$("#sp-look").value]: Object.keys(pendingAdjust()).length ? pendingAdjust() : null } },
          roomDefaults: {
            turnTaking: $("#sp-turns").value,
            replyDelay: Number($("#sp-delay").value),
            hopLimit: Number($("#sp-hops").value),
            fullBriefEveryTurns: Number($("#sp-brief-turns").value),
            fullBriefEveryTokens: Number($("#sp-brief-tokens").value),
            briefTextLimit: Number($("#sp-text-limit").value),
            headerRules: $("#sp-header-rules").checked,
            tools: $("#sp-tools").value,
          },
          vendorPresets,
        });
    });
  }

  function updateStatusText() {
    const u = state.update;
    const v = state.version ? state.version.version : "?";
    if (!u || !u.checkedAt) return `This is viberoom ${v}; not checked yet.`;
    const when = new Date(u.checkedAt).toLocaleString();
    if (u.available) return `viberoom ${u.latest} is available (this is ${u.current}); checked ${when}.`;
    if (u.error) return `Could not reach the registry (${u.error}); checked ${when}.`;
    return `This is viberoom ${u.current}, the latest; checked ${when}.`;
  }

  function skillBadges(sk) {
    const out = [];
    if (sk.userInvocable === false) out.push(UI.html("badge", { label: "vibemate only" }));
    if (sk.agentInvocable === false) out.push(UI.html("badge", { label: "human only" }));
    if (sk.author && sk.author !== "human") out.push(UI.html("badge", { label: sk.author === "viberoom" ? "built-in" : `by ${sk.author.replace(/^agent:/, "").replace(/@.*$/, "")} (agent)`, tone: "outline" }));
    if (sk.draft) out.push(UI.html("badge", { label: "draft: awaiting your approval", tone: "waiting" }));
    else if (sk.reviewed === false) out.push(UI.html("badge", { label: "unreviewed", tone: "thinking" }));
    if ((sk.problems || []).length) out.push(UI.html("badge", { label: sk.problems.join("; "), tone: "error" }));
    if ((sk.warnings || []).length) out.push(UI.html("badge", { label: `${sk.warnings.length} warning${sk.warnings.length > 1 ? "s" : ""}`, tone: "thinking", title: sk.warnings.join("; ") }));
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
        <span class="skill-actions">${sk.draft ? UI.html("button", { label: "Approve", kind: "primary", size: "sm", data: { approveSkill: sk.name } }) : ""}${UI.html("icon-button", { icon: "pencil", title: "Edit this skill", kind: "ghost", size: "sm", data: { editSkill: sk.name } })}</span>
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
          <div class="row-btns">${editing && editing.author !== "viberoom" ? UI.html("button", { label: "Delete", kind: "danger", size: "sm", id: "sk-delete" }) : ""}<span class="saved" id="sk-saved"></span>${UI.html("button", { label: editing && editing.author === "viberoom" ? "Close" : "Cancel", kind: "ghost", size: "sm", id: "sk-cancel" })}${editing && editing.author === "viberoom" ? "" : UI.html("button", { label: "Save skill", kind: "primary", size: "sm", id: "sk-save" })}</div>
        </div>`
      : "";
    const about = ed
      ? ""
      : `<p class="hint sk-about">A skill is a folder <code>skills/&lt;name&gt;/SKILL.md</code> in the hub's data folder: a description (what triggers it) and the instructions. Attach skills to vibemates in their panels; invoke one with <code>/name</code> in the composer. Vibemates with the hub's tools can create skills too (they load <code>skill-writer</code> first).</p>`;
    els.pageInner.innerHTML = `
      <div class="page-head"><div><h1>${room ? `Skills in ${esc(room.name)}` : "Skills"}</h1><div class="hint">${room ? `${shown.length} of ${skills.length} in the library are attached to a vibemate here` : `${skills.length} skill${skills.length === 1 ? "" : "s"} in the library`}</div></div><div class="row-btns">${room ? UI.html("button", { label: "All skills", icon: "skills", kind: "ghost", id: "sk-all" }) : ""}${UI.html("button", { label: "Reload", icon: "refresh", kind: "ghost", id: "sk-reload", title: "Re-read the skills folder" })}${UI.html("button", { label: "New skill", icon: "plus", kind: "primary", size: "cta", id: "sk-new" })}</div></div>
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
      row.innerHTML = `<input type="checkbox" value="${esc(s.name)}" ${chosen.has(s.name.toLowerCase()) ? "checked" : ""} ${broken ? "disabled" : ""}><span><b>/${esc(s.name)}</b> <span class="hint">${esc(s.description)}</span>${s.draft ? UI.html("badge", { label: "draft", tone: "waiting" }) : ""}${s.problems && s.problems.length ? UI.html("badge", { label: s.problems.join("; "), tone: "error" }) : ""}</span>`;
      container.appendChild(row);
    }
    for (const name of selected || []) {
      if (known.has(name.toLowerCase())) continue;
      const row = document.createElement("label");
      row.className = "check-row";
      row.innerHTML = `<input type="checkbox" value="${esc(name)}" checked><span><b>/${esc(name)}</b> ${UI.html("badge", { label: "missing from the library", tone: "error" })}</span>`;
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
      const b = UI.el("choice", { label: o.textContent, on: !!o.selected, quiet: o.value === "", title: o.title || undefined });
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
      els.invStatus.textContent = parts.length ? `Options from ${who} (${parts.join(", ")}; ${(info.durationMs / 1000).toFixed(1)} s)` : `${who} exposes no config options over ACP${info.modelAtLaunch ? "; the model is a launch flag (built-in list, or type one)" : ""}${info.modeAtLaunch ? "; the mode is a launch flag (a change restarts the session)" : ""}.`;
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
    const blocked = inviteBlocked(recipe);
    els.invOptions.hidden = blocked;
    refreshInviteWords(recipe);
    updateInviteSubmit();
    if (blocked) return;
    fillSelect(els.invModel, recipe.modelPresets, preset.model, "vibemate default");
    fillSelect(els.invEffort, recipe.effortPresets, preset.effort, "vibemate default");
    fillSelect(els.invMode, recipe.modePresets, preset.mode, "vibemate default");
    els.invModelCustom.hidden = true;
    els.invModelCustom.value = "";
    els.invStatus.textContent = "";
    loadAgentOptions(recipe, refresh);
  }
  function refreshInviteWords(recipe) {
    const bypassOn = (state.settings || {}).bypassPermissionsByDefault !== false;
    els.invNote.textContent = (recipe.unavailableReason ? `${recipe.note} — ${recipe.unavailableReason}` : recipe.note) + (bypassOn && recipe.bypassMode ? ` Mode defaults to "${recipe.bypassMode}" (acts without asking; change it here or in Settings).` : "") + (recipe.loginState === "missing" ? " Not logged in yet: press Log in under its tile." : "");
    const noLogin = !recipe.unavailableReason && recipe.loginState === "missing";
    els.invWhere.textContent = recipe.unavailableReason
      ? `Not installed on this machine. To install: ${recipe.installHint || ""}`
      : noLogin
        ? `Found at ${recipe.installedAt || "bundled"}, but ${recipe.vendor} is not logged in${recipe.loginChecked ? ` (${recipe.loginChecked.how === "command" ? "its own status command says" : "asked over ACP"}: ${recipe.loginChecked.detail})` : ""}.${recipe.loginCommand && recipe.loginHow !== "card" ? ` Run \`${recipe.loginCommand}\` in a terminal, then press "Check again".` : ""}`
        : `Found on this machine: ${recipe.installedAt || "bundled"}`;
    els.invWhere.className = recipe.unavailableReason ? "hint error" : noLogin ? "hint warn" : "hint";
    renderInviteLogin();
    if (els.invType.value === recipe.id) {
      if (inviteBlocked(recipe)) { els.invOptions.hidden = true; updateInviteSubmit(); }
      else if (els.invOptions.hidden) applyRecipe(false);
      else updateInviteSubmit();
    }
  }
  function openInvite() {
    if (!currentRoom()) return toast("Open a room first.", "warn");
    els.invError.hidden = true;
    els.invType.innerHTML = "";
    for (const r of state.recipes) {
      const o = document.createElement("option");
      o.value = r.id;
      o.textContent = r.label;
      els.invType.appendChild(o);
    }
    renderInviteTiles();
    resetInviteForm();
    renderInviteLogin();
    if (!els.invName.dataset.bound) {
      els.invName.dataset.bound = "1";
      els.invName.addEventListener("input", updateInviteSubmit);
    }
    post("/api/recipes/check", {}).catch(() => undefined);
    const recheck = document.querySelector("#inv-recheck");
    if (recheck && !recheck.dataset.bound) {
      recheck.dataset.bound = "1";
      recheck.addEventListener("click", () => {
        recheck.disabled = true;
        post("/api/recipes/check", { force: true, rescan: true }).catch(showError).finally(() => { recheck.disabled = false; });
      });
    }
  }

  const loginDialog = { recipeId: null, purpose: "login", closeTimer: null, openedAt: 0 };
  const flowOf = (recipe, purpose) => (purpose === "install" ? state.installs : state.logins).get(recipe.id) || null;

  function openLoginDialog(recipeId, purpose) {
    const recipe = state.recipes.find((r) => r.id === recipeId);
    if (!recipe) return toast("That agent is not on this machine.", "warn");
    loginDialog.recipeId = recipeId;
    loginDialog.purpose = purpose || (recipe.unavailableReason ? "install" : "login");
    loginDialog.openedAt = Date.now();
    clearTimeout(loginDialog.closeTimer);
    loginDialog.closeTimer = null;
    bindLoginDialog();
    renderLoginDialog(true);
    openDialog(els.loginDialog);
  }

  function loginStatusWords(recipe) {
    const own = recipe.loginChecked && recipe.loginChecked.how === "command" && recipe.loginChecked.detail ? ` · ${recipe.loginChecked.detail}` : "";
    return recipe.loginState === "ok" ? `logged in${own}` : recipe.loginState === "missing" ? `not logged in${own}` : "login not known";
  }
  function loginDialogProps(recipe, purpose) {
    const known = flowOf(recipe, purpose);
    const flow = known && (known.state === "running" || (known.endedAt || 0) >= loginDialog.openedAt) ? known : null;
    const running = !!flow && flow.state === "running";
    const checkedAfter = !!flow && (flow.kind === "terminal" || (!!recipe.loginChecked && recipe.loginChecked.at >= (flow.endedAt || 0) && !recipe.loginChecking));
    const base = { vendor: recipe.vendor, icon: recipe.icon || "", purpose, flowId: flow ? flow.id : undefined, data: { recipe: recipe.id } };
    let confirmed = false;
    let props;
    if (purpose === "install") {
      const kind = recipe.installHow === "url" ? "url" : recipe.installHow === "terminal" ? "terminal" : "command";
      const idleScene = kind === "terminal" ? "terminal" : kind === "url" ? "browser" : "package";
      const geek = `${esc(recipe.installNote || "")}${recipe.installCommand ? ` It runs <code>${esc(recipe.installCommand)}</code>${kind === "terminal" ? " in a terminal window" : " hidden, the way you would in a terminal"}.` : ""} viberoom downloads nothing itself: it is the vendor's own installer.`;
      if (!recipe.unavailableReason && !(running)) {
        confirmed = checkedAfter && recipe.loginState === "ok";
        props = { ...base, kind, state: "done", scene: "done", words: confirmed ? `${recipe.vendor} is installed and logged in. You can summon it now.` : `${recipe.vendor} is installed. Asking whether it is logged in…`, status: recipe.installedAt || undefined, lines: flow ? flow.lines : undefined };
      } else if (running) {
        props = { ...base, kind, state: "running", scene: idleScene, words: flow.detail, lines: flow.lines, geek };
      } else if (flow && flow.state === "failed") {
        props = { ...base, kind, state: "failed", scene: "failed", words: flow.detail, lines: flow.lines, geek, terminal: kind === "command" };
      } else {
        const words = kind === "url" ? `${recipe.vendor} is installed from its website. Follow the steps there, come back, and press Check again.` : kind === "terminal" ? `A terminal window opens with ${recipe.vendor}'s installer. Finish there, then press I'm done.` : `${recipe.vendor} is fetched from npm; the tile turns live when it is done.`;
        props = { ...base, kind, state: "idle", scene: idleScene, words, status: "not installed on this machine", url: recipe.installUrl, geek };
      }
      return { props, confirmed };
    }
    const kind = recipe.loginHow === "terminal" ? "terminal" : "command";
    const geek = `${esc(recipe.loginHint || "")}${recipe.loginTerminalCommand ? ` In a terminal it is <code>${esc(recipe.loginTerminalCommand)}</code>.` : ""} viberoom never sees your password or keys: ${esc(recipe.vendor)} signs you in, this dialog only shows what it says.`;
    const terminal = kind !== "terminal" && !!recipe.loginTerminalCommand;
    const said = loginStatusWords(recipe);
    if (recipe.loginState === "ok" && flow && flow.state === "done" && checkedAfter) {
      confirmed = true;
      props = { ...base, kind, state: "done", scene: "done", words: `${recipe.vendor} confirms it is logged in.`, status: said, lines: flow.lines };
    } else if (running) {
      const scene = kind === "terminal" ? "terminal" : flow.wantsInput ? "question" : flow.code ? "code" : "browser";
      props = { ...base, kind, state: "running", scene, words: flow.detail, url: flow.url, code: flow.code, wantsInput: !!flow.wantsInput, lines: flow.lines, geek };
    } else if (flow && flow.state === "done" && !checkedAfter) {
      props = { ...base, kind, state: "done", scene: "done", words: `${recipe.vendor} says it is signed in. Asking it…`, lines: flow.lines };
    } else if (flow && flow.state === "done" && recipe.loginState === "missing") {
      props = { ...base, kind, state: "failed", scene: "failed", words: `${recipe.vendor} said it signed in, but asked again it says: ${said || "not logged in"}.`, lines: flow.lines, geek, terminal };
    } else if (flow && flow.state === "done") {
      props = { ...base, kind, state: "done", scene: "done", words: `${recipe.vendor} says it is signed in; asked again, it could not say for sure. Summon it and see.`, status: said, lines: flow.lines };
    } else if (flow && flow.state === "failed") {
      props = { ...base, kind, state: "failed", scene: "failed", words: flow.detail, lines: flow.lines, geek, terminal };
    } else {
      const scene = recipe.loginScene || "browser";
      const words = scene === "terminal" ? `A terminal window opens with ${recipe.vendor}'s own sign-in. Finish there, then press I'm done.` : scene === "code" ? `${recipe.vendor} shows a page and a code. Open the page, type the code, and it signs you in.` : `${recipe.vendor} opens your browser. Sign in there and come back; viberoom waits.`;
      props = { ...base, kind, state: "idle", scene, words: flow && flow.state === "cancelled" ? `Cancelled. ${words}` : words, status: said, geek };
    }
    return { props, confirmed };
  }

  function renderLoginDialog(force) {
    if (!loginDialog.recipeId || (!force && !els.loginDialog.open)) return;
    const recipe = state.recipes.find((r) => r.id === loginDialog.recipeId);
    if (!recipe) return closeDialog(els.loginDialog);
    if (loginDialog.purpose === "install" && !recipe.unavailableReason) {
      const inst = state.installs.get(recipe.id);
      if (recipe.loginChecked && recipe.loginChecked.at >= (inst ? inst.endedAt || 0 : 0) && !recipe.loginChecking && recipe.loginState === "missing") {
        loginDialog.purpose = "login";
        toast(`${recipe.vendor} is installed. Now log in.`, "success");
      }
    }
    const { props, confirmed } = loginDialogProps(recipe, loginDialog.purpose);
    const body = els.ldBody;
    const prior = body.querySelector(".answer input");
    const typed = prior ? { value: prior.value, focused: document.activeElement === prior, start: prior.selectionStart, end: prior.selectionEnd } : null;
    body.innerHTML = UI.html("login-dialog", props);
    const input = body.querySelector(".answer input");
    if (input && typed) {
      input.value = typed.value;
      if (typed.focused) { input.focus(); try { input.setSelectionRange(typed.start, typed.end); } catch { } }
    } else if (input) input.focus();
    if (confirmed) {
      if (!loginDialog.closeTimer) loginDialog.closeTimer = setTimeout(() => {
        loginDialog.closeTimer = null;
        closeDialog(els.loginDialog);
        toast(loginDialog.purpose === "install" ? `${recipe.vendor} is installed and logged in.` : `${recipe.vendor} is logged in.`, "success");
      }, 1600);
    } else {
      clearTimeout(loginDialog.closeTimer);
      loginDialog.closeTimer = null;
    }
  }

  function bindLoginDialog() {
    const body = els.ldBody;
    if (!body || body.dataset.bound) return;
    body.dataset.bound = "1";
    body.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      const recipeId = loginDialog.recipeId;
      const purpose = loginDialog.purpose;
      const root = body.querySelector('[data-ui="login-dialog"]');
      const flowId = root && root.dataset.flow;
      try {
        if (act === "close-login") closeDialog(els.loginDialog);
        else if (act === "start-login" || (act === "retry-login" && purpose === "login")) { btn.disabled = true; await startLoginFlow(recipeId, false); }
        else if (act === "start-install" || (act === "retry-login" && purpose === "install")) { btn.disabled = true; await startInstallFlow(recipeId, false); }
        else if (act === "terminal-login") { btn.disabled = true; await (purpose === "install" ? startInstallFlow(recipeId, true) : startLoginFlow(recipeId, true)); }
        else if (act === "rescan" || (act === "recheck-login" && purpose === "install")) { btn.disabled = true; await post("/api/recipes/check", { id: recipeId, rescan: true }); }
        else if (act === "recheck-login") { btn.disabled = true; await post("/api/recipes/check", { id: recipeId, force: true }); }
        else if (act === "cancel-login" && flowId) await post(`/api/login/${encodeURIComponent(flowId)}/cancel`, {});
        else if ((act === "open-login-url" || act === "open-install-url") && btn.dataset.url) window.open(btn.dataset.url, "_blank", "noopener");
        else if (act === "copy-login-code" && btn.dataset.code) { await navigator.clipboard.writeText(btn.dataset.code); toast("Code copied.", "ok"); }
        else if (act === "send-login-answer") await sendLoginAnswer(root);
      } catch (error) {
        showError(error);
      }
    });
    body.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !e.target.matches(".answer input")) return;
      e.preventDefault();
      e.stopPropagation();
      sendLoginAnswer(body.querySelector('[data-ui="login-dialog"]')).catch(showError);
    });
  }
  async function startLoginFlow(recipeId, terminal) {
    const { flow } = await post(`/api/recipes/${encodeURIComponent(recipeId)}/login`, terminal ? { terminal: true } : {});
    const known = state.logins.get(flow.recipeId);
    if (!known || known.id !== flow.id) state.logins.set(flow.recipeId, flow);
    renderLoginHosts();
  }
  async function startInstallFlow(recipeId, terminal) {
    const { flow } = await post(`/api/recipes/${encodeURIComponent(recipeId)}/install`, terminal ? { terminal: true } : {});
    const known = state.installs.get(flow.recipeId);
    if (!known || known.id !== flow.id) state.installs.set(flow.recipeId, flow);
    renderLoginHosts();
  }
  async function sendLoginAnswer(root) {
    const input = root && root.querySelector(".answer input");
    if (!root || !input) return;
    const text = input.value;
    input.value = "";
    await post(`/api/login/${encodeURIComponent(root.dataset.flow)}/input`, { text });
  }
  function renderLoginHosts() {
    if (document.querySelector("#invite-dialog")?.open) renderInviteLogin();
    if (els.rcDialog.open) renderReconnectLogin();
    if (els.loginDialog.open) renderLoginDialog();
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest('[data-act="open-login-dialog"]');
    if (!b) return;
    e.preventDefault();
    openLoginDialog(b.dataset.recipe, b.dataset.purpose || "login");
  });

  function inviteWarnHtml(recipe) {
    const install = state.installs.get(recipe.id);
    const login = state.logins.get(recipe.id);
    let words = "";
    if (recipe.unavailableReason) words = install && install.state === "running" ? `${recipe.vendor} is being installed; the dialog follows it.` : `${recipe.vendor} is not installed on this machine. Install it first: the button under its tile.`;
    else if (login && login.state === "running") words = `${recipe.vendor} is signing you in; the dialog follows it.`;
    else if (recipe.loginState === "missing") words = `${recipe.vendor} is not logged in on this machine. Log in first: the button under its tile. Then summon.`;
    return words ? `<p class="inv-warn">${ic(recipe.unavailableReason ? "tool" : "unplugged")}<span>${esc(words)}</span></p>` : "";
  }
  function renderInviteLogin() {
    const host = els.invLogin;
    if (!host) return;
    const recipe = state.recipes.find((r) => r.id === els.invType.value);
    const row = recipe ? inviteWarnHtml(recipe) : "";
    host.hidden = !row;
    host.innerHTML = row;
  }
  const inviteBlocked = (recipe) => !recipe || !!recipe.unavailableReason || recipe.loginState === "missing";
  const vendorLoggedOut = (p) => p.kind === "agent" && (p.trouble?.kind === "login" || (p.status === "offline" && state.recipes.find((r) => r.id === p.agentType)?.loginState === "missing"));
  function updateInviteSubmit() {
    const recipe = state.recipes.find((r) => r.id === els.invType.value);
    els.invSubmit.disabled = inviteBlocked(recipe) || !els.invName.value.trim();
  }
  function pickForInstall(id) {
    els.invType.value = id;
    els.invOptions.hidden = true;
    applyRecipe(false);
    openLoginDialog(id, "install");
  }

  function troubleActionsHtml(p) {
    const recipe = state.recipes.find((r) => r.id === p.agentType);
    const actions = (p.trouble && p.trouble.actions) || [];
    const buttons = actions
      .map((a, i) => {
        const kind = i === 0 ? "primary" : "paper";
        if (a === "retry") return UI.html("button", { label: "Retry", kind, size: "xs", act: "trouble-retry", icon: "refresh", title: "Send it the messages it missed again" });
        if (a === "respawn") return p.trouble.stage === "start"
          ? UI.html("button", { label: "Start again", kind, size: "xs", act: "trouble-respawn", icon: "bolt", title: "Start it again, with its notes and the last messages" })
          : UI.html("button", { label: "Respawn", kind, size: "xs", act: "trouble-respawn", icon: "bolt", title: "A fresh session with its notes and the last messages; the history stays" });
        if (a === "login" && recipe && recipe.loginHow !== "none") return UI.html("button", { label: `Log in to ${recipe.vendor}`, kind, size: "xs", act: "trouble-login", icon: "lock" });
        return "";
      })
      .filter(Boolean);
    return buttons.length ? `<div class="fix">${buttons.join("")}</div>` : "";
  }
  function troubleHtml(p) {
    return `<div class="p-trouble" title="${esc(`${p.trouble.advice}${p.statusDetail ? ` (${p.statusDetail})` : ""}`)}"><b>${esc(p.trouble.what)}</b>${troubleActionsHtml(p)}</div>`;
  }
  async function troubleAction(room, p, act, btn) {
    if (btn) btn.disabled = true;
    try {
      if (act === "retry") await post(roomApi(`/participants/${encodeURIComponent(p.id)}/retry`));
      else if (act === "respawn" && p.trouble?.stage === "start") await post(roomApi(`/participants/${encodeURIComponent(p.id)}/respawn`), { memory: true, replay: room.settings?.replayAfterRestart ?? 10 });
      else if (act === "respawn") await respawnWith(p, room.settings?.replayAfterRestart ?? 10);
      else if (act === "login") openLoginDialog(p.agentType, "login");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function loginWords(r) {
    if (r.unavailableReason) return { state: "off", text: "not installed" };
    if (r.loginChecking && !r.loginChecked) return { state: "checking", text: "checking…" };
    if (r.loginState === "missing") return { state: "missing", text: "not logged in" };
    if (r.loginState === "ok") return { state: "ok", text: "logged in" };
    return { state: "unknown", text: "installed" };
  }
  function loginTitle(r) {
    const said = r.loginChecked ? ` ${r.loginChecked.how === "command" ? "Its own status command says" : "Asked over ACP"}: ${r.loginChecked.detail}` : "";
    if (r.unavailableReason) return `Not installed on this machine. ${r.installHint || ""}`;
    if (r.loginState === "missing") return `Found at ${r.installedAt || "bundled"}, but not logged in.${r.loginCommand ? ` Run \`${r.loginCommand}\` in a terminal, then "Check again".` : ""}${said}`;
    return `Found at ${r.installedAt || "bundled"}.${said}`;
  }
  function renderInviteTiles() {
    const picked = els.invType.value;
    const installed = state.recipes.filter((r) => !r.unavailableReason);
    els.invAgents.innerHTML = state.recipes
      .map((r) => {
        const login = loginWords(r);
        const tile = `<button type="button" class="agent-tile${r.unavailableReason ? " off" : ""}${r.id === picked ? " selected" : ""}" data-agent="${esc(r.id)}" title="${esc(loginTitle(r))}">${vendorLogo(r, "lg")}<span class="at-name">${esc(r.vendor)}</span><span class="at-sub" data-state="${login.state}">${login.state === "missing" ? ic("unplugged") : ""}${login.text}</span></button>`;
        const installing = r.unavailableReason && state.installs.get(r.id)?.state === "running";
        const signingIn = !r.unavailableReason && state.logins.get(r.id)?.state === "running";
        const under = installing
          ? UI.html("button", { label: "Installing…", kind: "soft", size: "xs", act: "install-pick", icon: "tool", disabled: true, title: `${r.vendor} is being installed: the dialog follows it`, data: { agent: r.id } })
          : r.unavailableReason
          ? UI.html("button", { label: "Install", kind: "soft", size: "xs", act: "install-pick", icon: "tool", title: `${r.vendor} is not installed here: see how to install it`, data: { agent: r.id } })
          : signingIn
          ? UI.html("button", { label: "Signing in…", kind: "primary", size: "xs", act: "open-login-dialog", icon: "lock", title: `${r.vendor} is signing you in: the dialog follows it`, data: { recipe: r.id, purpose: "login" } })
          : r.loginState === "missing"
          ? UI.html("button", { label: "Log in", kind: "primary", size: "xs", act: "open-login-dialog", icon: "lock", title: `${r.vendor} is not logged in here: log in from the room`, data: { recipe: r.id, purpose: "login" } })
          : "";
        return `<div class="agent-cell">${tile}${under}</div>`;
      })
      .join("");
    els.invAgents.querySelectorAll('[data-act="install-pick"]').forEach((b) => b.addEventListener("click", () => pickForInstall(b.dataset.agent)));
    els.invAgents.querySelectorAll(".agent-tile:not(.off)").forEach((b) =>
      b.addEventListener("click", () => {
        els.invType.value = b.dataset.agent;
        applyRecipe(false);
      }),
    );
    els.invNone.hidden = installed.length > 0;
    els.invNone.innerHTML = installed.length
      ? ""
      : `No supported vibemate is installed on this machine yet. Install one and open this dialog again: ${state.recipes.map((r) => `<b>${esc(r.vendor)}</b> (<code>${esc(r.installHint || "")}</code>)`).join(", ")}.`;
  }
  function resetInviteForm() {
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
    setStaffing(null);
    openDialog(els.dialog);
    els.invName.focus();
  }
  const staffing = { id: null };
  const PERSONA_FIELDS = () => [els.invName, els.invTagline, els.invRole, els.invAvatar];
  function setStaffing(p) {
    staffing.id = p ? p.id : null;
    for (const f of PERSONA_FIELDS()) f.disabled = false;
    els.invSkills.classList.remove("locked");
    const lead = els.dialog.querySelector(".lead");
    lead.textContent = p
      ? `${p.name} comes from the room's template. Pick the coding agent that runs it; change the vibename or the character if you like.`
      : "Pick a vibemate, give it a vibename and a character, and it joins the room.";
  }
  function openStaffDialog(p) {
    openInvite();
    els.invName.value = p.name;
    els.invTagline.value = p.tagline || "";
    els.invRole.value = p.role || "";
    els.invAvatar.value = p.avatar || "";
    renderSkillChecks(els.invSkills, p.skills || []);
    setStaffing(p);
  }
  async function submitInvite(event) {
    event.preventDefault();
    if (!els.invType.value) {
      els.invError.textContent = "Pick a vibemate first.";
      els.invError.hidden = false;
      return;
    }
    els.invSubmit.disabled = true;
    UI.setState(els.invSubmit, "loading");
    els.invError.hidden = true;
    try {
      if (staffing.id) {
        await post(roomApi(`/participants/${encodeURIComponent(staffing.id)}/staff`), {
          agentType: els.invType.value,
          model: els.invModelCustom.value.trim() || els.invModel.value || null,
          effort: els.invEffort.value || null,
          mode: els.invMode.value || null,
          name: els.invName.value.trim(),
          tagline: els.invTagline.value.trim(),
          role: els.invRole.value.trim(),
          avatar: els.invAvatar.value.trim(),
          skills: checkedSkills(els.invSkills),
        });
        closeDialog(els.dialog);
        return;
      }
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
      UI.setState(els.invSubmit, null);
    }
  }


  const reconnectPrompted = new Set();
  function renderReconnectDefault() {
    const mode = (state.settings || {}).reconnectMode === "load" ? "load" : "replay";
    for (const choice of els.rcForm.querySelectorAll(".choice")) {
      const value = choice.querySelector('input[name="rc-mode"]').value;
      choice.querySelector(".rc-is-default").hidden = value !== mode;
      choice.querySelector(".rc-default").hidden = value === mode;
    }
    return mode;
  }
  els.rcForm.addEventListener("click", async (e) => {
    const button = e.target.closest(".rc-default");
    if (!button) return;
    const mode = button.dataset.mode;
    try {
      await post("/api/settings", { reconnectMode: mode });
      if (state.settings) state.settings.reconnectMode = mode;
      els.rcForm.querySelector(`input[name="rc-mode"][value="${mode}"]`).checked = true;
      renderReconnectDefault();
      toast(mode === "load" ? "Welcome back will offer the full session first." : "Welcome back will offer the replay first.", "success");
    } catch (error) {
      showError(error);
    }
  });
  function openReconnectDialog(room, only) {
    const offline = offlineAgents(room).filter((p) => !only || p.id === only.id);
    if (!offline.length) return;
    if (!only) reconnectPrompted.add(room.id);
    els.rcError.hidden = true;
    els.rcReplay.value = room.settings.replayAfterRestart ?? 10;
    els.rcForm.querySelector(`input[name="rc-mode"][value="${renderReconnectDefault()}"]`).checked = true;
    els.rcIntro.textContent = only
      ? `${only.name} is offline in "${room.name}" (its session ended with the previous hub run). Choose how it comes back:`
      : `${offline.length} vibemate${offline.length > 1 ? "s are" : " is"} offline in "${room.name}" (their sessions ended with the previous hub run). Choose how they come back:`;
    els.rcTable.dataset.ids = offline.map((p) => p.id).join(",");
    els.rcTable.innerHTML = "";
    renderReconnectRows(room);
    openDialog(els.rcDialog);
  }
  function reconnectListed(room) {
    return (els.rcTable.dataset.ids || "").split(",").filter(Boolean).map((id) => findById(room, id)).filter(Boolean);
  }
  const reconnectStuck = (p) => p.trouble?.kind === "login" || state.recipes.find((r) => r.id === p.agentType)?.loginState === "missing";
  const reconnectBack = (p) => ["idle", "queued", "thinking", "writing"].includes(p.status);
  function renderReconnectRows(room) {
    const listed = reconnectListed(room);
    const prior = new Map([...els.rcTable.querySelectorAll("tr")].map((tr) => [tr.dataset.id, { choice: tr.querySelector(".rc-per")?.value || "", stuck: tr.dataset.stuck === "1" }]));
    const freed = [];
    els.rcTable.innerHTML = listed
      .map((p) => {
        const was = prior.get(p.id);
        const back = reconnectBack(p);
        const starting = p.status === "starting";
        const stuck = !back && !starting && reconnectStuck(p);
        if (was && was.stuck && !stuck && !back && !starting) freed.push(p.id);
        const recipe = state.recipes.find((r) => r.id === p.agentType);
        const middle = back
          ? UI.html("badge", { label: "back", tone: "ready" })
          : starting
          ? UI.html("badge", { label: "starting…", tone: "waiting" })
          : stuck
          ? `<span class="rc-note rc-stuck">${ic("unplugged")}not logged in</span>`
          : `<span class="rc-note">${p.supportsLoad === false ? "no session/load" : p.sessionId ? "stored session available" : "no stored session"}</span>`;
        const right = back || starting
          ? ""
          : stuck && recipe
          ? UI.html("button", { label: `Log in to ${recipe.vendor}`, kind: "primary", size: "sm", act: "open-login-dialog", icon: "lock", data: { recipe: recipe.id, purpose: "login" } })
          : `<select class="rc-per"><option value="">as above</option><option value="replay"${was && was.choice === "replay" ? " selected" : ""}>replay</option><option value="load"${p.supportsLoad === false || !p.sessionId ? " disabled" : ""}${was && was.choice === "load" ? " selected" : ""}>full session</option><option value="skip"${was && was.choice === "skip" ? " selected" : ""}>leave offline</option></select>`;
        return `<tr data-id="${esc(p.id)}" data-stuck="${stuck ? "1" : ""}">
          <td>${avatar(p, 28, { vendor: true, unplugged: stuck })}<span><strong>${esc(p.name)}</strong> <span class="rc-note">${esc(p.tagline || p.agentVendor || "")}</span></span></td>
          <td>${middle}</td>
          <td>${right}</td>
        </tr>`;
      })
      .join("");
    const canGo = listed.some((p) => !reconnectBack(p) && p.status !== "starting" && !reconnectStuck(p));
    els.rcSubmit.disabled = !canGo;
    els.rcSubmit.title = canGo ? "" : listed.some(reconnectStuck) ? "Log in first; the hub brings them back by itself" : "";
    if (freed.length) reconnectRows(room, freed).catch(showError);
  }
  async function reconnectRows(room, ids) {
    const globalMode = els.rcForm.querySelector('input[name="rc-mode"]:checked').value;
    const replay = Number(els.rcReplay.value);
    if (Number.isFinite(replay) && replay !== (room.settings.replayAfterRestart ?? 10)) post(roomApi("/settings"), { replayAfterRestart: replay }).catch((error) => toast(error.message, "error"));
    const rows = [...els.rcTable.querySelectorAll("tr")].filter((tr) => ids.includes(tr.dataset.id)).map((tr) => ({ id: tr.dataset.id, choice: tr.querySelector(".rc-per")?.value || globalMode }));
    els.rcSubmit.disabled = true;
    UI.setState(els.rcSubmit, "loading");
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
    UI.setState(els.rcSubmit, null);
    if (failures.length) {
      els.rcError.textContent = failures.join(" · ");
      els.rcError.hidden = false;
    }
    if (els.rcDialog.open) refreshReconnectDialog(room);
  }
  function refreshReconnectDialog(room) {
    const listed = reconnectListed(room);
    if (listed.length && listed.every(reconnectBack)) {
      closeDialog(els.rcDialog);
      toast(listed.length === 1 ? `${listed[0].name} is back.` : "Everyone is back.", "success");
      return;
    }
    renderReconnectRows(room);
  }
  function renderReconnectLogin() {
    const room = currentRoom();
    if (room && els.rcDialog.open) renderReconnectRows(room);
  }
  async function submitReconnect(event) {
    event.preventDefault();
    const room = currentRoom();
    if (!room) return closeDialog(els.rcDialog);
    const ids = reconnectListed(room).filter((p) => !reconnectBack(p) && p.status !== "starting" && !reconnectStuck(p)).map((p) => p.id);
    if (!ids.length) return;
    const skipped = reconnectListed(room).filter((p) => ids.includes(p.id) && !reconnectBack(p)).length === 0;
    if (skipped) return;
    await reconnectRows(room, ids);
    if (els.rcDialog.open && !reconnectListed(room).some(reconnectStuck) && els.rcError.hidden) closeDialog(els.rcDialog);
  }
  function maybeOfferReconnect() {
    const room = currentRoom();
    if (!room || state.view !== "room" || reconnectPrompted.has(room.id) || els.rcDialog.open || els.pfDialog.open) return;
    if (offlineAgents(room).length) openReconnectDialog(room);
  }


  const tplEls = { dialog: $("#template-dialog"), form: $("#template-form"), list: $("#tpl-list"), detail: $("#tpl-detail"), name: $("#tpl-room-name"), dir: $("#tpl-room-dir"), error: $("#tpl-error"), create: $("#tpl-create") };
  const tpl = { items: [], current: null, autoName: "" };
  async function openTemplateDialog() {
    tplEls.error.hidden = true;
    tplEls.name.value = "";
    tplEls.dir.value = "";
    tplEls.list.innerHTML = '<span class="hint">loading…</span>';
    tplEls.detail.innerHTML = "";
    openDialog(tplEls.dialog);
    try {
      tpl.items = (await (await fetch("/api/templates")).json()).templates || [];
    } catch (error) {
      tplEls.error.textContent = error.message;
      tplEls.error.hidden = false;
      return;
    }
    renderTemplateList(tpl.items[0] ? tpl.items[0].id : null);
  }
  function renderTemplateList(currentId) {
    tpl.current = tpl.items.find((t) => t.id === currentId) || null;
    tplEls.list.innerHTML = tpl.items
      .map((t) => {
        const on = tpl.current && t.id === tpl.current.id;
        const faces = t.vibemates.slice(0, 4).map((v) => avatar({ name: v.name, avatar: v.avatar, color: FALLBACK_COLOR() }, 20, { ring: true })).join("");
        return `<button type="button" class="tpl-item${on ? " on" : ""}" data-id="${esc(t.id)}" role="radio" aria-checked="${on ? "true" : "false"}">
          <span class="tpl-emoji">${esc(t.emoji || "🧩")}</span>
          <span class="tpl-body"><b>${esc(t.name)}${t.builtin ? "" : UI.html("badge", { label: "your template", size: "xs" })}${t.recommended ? UI.html("badge", { label: "recommended", tone: "attention", size: "xs" }) : ""}</b><span class="tpl-meta">${t.vibemates.length} vibemate${t.vibemates.length === 1 ? "" : "s"}${t.builtin ? " · built in" : ""}</span><span class="avatar-stack">${faces}</span></span>
          <span class="tpl-check">${ic("check")}</span>
        </button>`;
      })
      .join("") || '<span class="hint">No templates yet.</span>';
    renderTemplateDetail();
  }
  tplEls.list.addEventListener("click", (e) => {
    const b = e.target.closest(".tpl-item");
    if (b) renderTemplateList(b.dataset.id);
  });
  function renderTemplateDetail() {
    const t = tpl.current;
    if (!t) return void (tplEls.detail.innerHTML = "");
    const rules = String((t.settings || {}).customRules || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!tplEls.name.value || tplEls.name.value === tpl.autoName) tplEls.name.value = t.name;
    tpl.autoName = t.name;
    tplEls.detail.innerHTML = `
      <p class="tpl-desc">${esc(t.description)}</p>
      ${rules.length ? `<div class="tpl-rules"><div class="label">Room rules</div><ul>${rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
      <div class="label">Vibemates</div>
      ${t.vibemates
        .map((v, i) => {
          return `<div class="tpl-vm" data-i="${i}">
            <div class="tpl-vm-head"><b>${esc(v.name)}</b>${v.tagline ? `<span class="hint">"${esc(v.tagline)}"</span>` : ""}</div>
            ${v.role ? `<div class="tpl-vm-role">${esc(v.role)}</div>` : ""}
            ${runsOn(v)}
          </div>`;
        })
        .join("")}`;
    if (t.dir) tplEls.detail.insertAdjacentHTML("beforeend", `<p class="hint">Folder: <code>${esc(t.dir)}</code> (you can change it below)</p>`);
    tplEls.detail.insertAdjacentHTML("beforeend", t.vibemates.some((v) => v.agentType)
      ? '<p class="hint">A vibemate whose coding agent is not installed here waits in the roster until you pick another.</p>'
      : '<p class="hint">You pick the coding agent for each vibemate in the room, right after it opens.</p>');
  }
  $("#tpl-dir-browse").addEventListener("click", () => openFolderPicker(tplEls.dir.value, (dir) => (tplEls.dir.value = dir)));
  tplEls.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const t = tpl.current;
    if (!t) return;
    const vibemates = t.vibemates.map((v) => ({ name: v.name, agentType: "" }));
    tplEls.create.disabled = true;
    tplEls.create.textContent = "Summoning…";
    try {
      const res = await post("/api/rooms/from-template", { template: t.id, name: tplEls.name.value, dir: tplEls.dir.value.trim() || null, vibemates });
      closeDialog(tplEls.dialog);
      if (res.room && res.room.id) {
        state.rooms.set(res.room.id, res.room);
        selectRoom(res.room.id);
      }
      for (const n of res.notices || []) toast(n, "info");
    } catch (error) {
      tplEls.error.textContent = error.message;
      tplEls.error.hidden = false;
    } finally {
      tplEls.create.disabled = false;
      tplEls.create.textContent = "Create the room";
    }
  });

  function runsOn(v) {
    if (!v.agentType) return "";
    const rec = state.recipes.find((r) => r.id === v.agentType);
    const parts = [rec ? rec.vendor : v.agentType, v.model, v.effort, v.mode].filter(Boolean);
    return `<div class="chips tpl-runs">${parts.map((x) => UI.html("chip", { label: x })).join("")}${rec && rec.unavailableReason ? UI.html("badge", { label: "not installed here", tone: "asleep" }) : ""}</div>`;
  }

  const stpEls = { dialog: $("#save-template-dialog"), form: $("#save-template-form"), name: $("#stp-name"), desc: $("#stp-desc"), preview: $("#stp-preview"), error: $("#stp-error"), create: $("#stp-create") };
  const stp = { room: null, template: null };
  async function openSaveTemplateDialog(room) {
    stp.room = room;
    stpEls.error.hidden = true;
    stpEls.name.value = room.name;
    stpEls.desc.value = "";
    stpEls.preview.innerHTML = '<span class="hint">loading…</span>';
    openDialog(stpEls.dialog);
    try {
      const t = (await post(roomApi("/template-preview"), {})).template;
      stp.template = t;
      stpEls.preview.innerHTML = renderTemplateForm(t);
      stpEls.preview.querySelectorAll("[data-stp-browse]").forEach((b) => b.addEventListener("click", () => {
        const input = $("#stp-dir");
        openFolderPicker(input.value, (dir) => (input.value = dir));
      }));
      stpEls.preview.querySelectorAll("[data-stp-remove]").forEach((b) => b.addEventListener("click", () => {
        b.closest(".stp-vm").remove();
        $("#stp-vm-count").textContent = String(stpEls.preview.querySelectorAll(".stp-vm").length);
      }));
    } catch (error) {
      stpEls.error.textContent = error.message;
      stpEls.error.hidden = false;
    }
  }
  const stpField = (label, html, wide) => `<label class="field${wide ? " wide" : ""}"><span class="label">${label}</span>${html}</label>`;
  const stpSwitch = (label, id, on) => `<label class="switch"><span class="label">${label}</span><input type="checkbox" id="${id}"${on ? " checked" : ""}></label>`;
  const stpSelect = (id, value, options) => `<select id="${id}">${options.map(([v, l]) => `<option value="${esc(v)}"${String(value) === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  function renderTemplateForm(t) {
    const st = t.settings || {};
    const lang = st.language && st.language.mode === "fixed" ? st.language.language : "";
    const room = `<div class="stp-grid">
      ${stpField("Emoji", `<input type="text" id="stp-emoji" maxlength="8" value="${esc(t.emoji || "")}" placeholder="none">`)}
      ${stpField("Topic", `<input type="text" id="stp-topic" maxlength="2000" value="${esc(st.topic || "")}" placeholder="what the room is about">`)}
      ${stpField("Language", `<input type="text" id="stp-lang" value="${esc(lang)}" placeholder="follow the human (default), or e.g. English">`)}
      ${stpField("Vibemates' own tools", stpSelect("stp-tools", st.tools || "on-request", [["on-request", "Only when someone explicitly asks"], ["never", "Never (chat only)"]]))}
      ${stpField("Who may speak", stpSelect("stp-turns", st.turnTaking || "parallel", [["parallel", "All addressed vibemates at once"], ["one-at-a-time", "One vibemate at a time"]]))}
      ${stpField("Reply delay, seconds", `${UI.html("number-field", { id: "stp-delay", value: String(st.replyDelay ?? 4), min: 0, max: 120, step: 0.5 })}`)}
      ${stpSwitch("Vibemates wake each other", "stp-wake", st.agentsWakeEachOther !== false)}
      ${stpSwitch("Wait while you are typing", "stp-wait", st.waitWhileHumanTypes !== false)}
      ${stpField("Hop limit", `${UI.html("number-field", { id: "stp-hops", value: String(st.hopLimit ?? 100), min: 0, max: 10000 })}`)}
      ${stpField("Max sentences per reply", `${UI.html("number-field", { id: "stp-maxlen", value: String(st.maxSentences ?? ""), min: 1, max: 100, placeholder: "no limit" })}`)}
      ${stpField("Referee", stpSelect("stp-referee", st.refereeAction || "next-header", [["next-header", "Post it; remind in the next header"], ["retry-hidden", "Hold it; retry in a hidden turn"]]))}
      ${stpField("About you", stpSelect("stp-about", st.humanDescriptionMode || "inherit", [["inherit", "Program-wide description"], ["append", "Program-wide + this room's"], ["override", "Only this room's"], ["none", "Nothing about me"]]))}
      ${stpField("Full brief every N turns", `${UI.html("number-field", { id: "stp-brief-turns", value: String(st.fullBriefEveryTurns ?? 8), min: 1, max: 10000 })}`)}
      ${stpField("…or every N tokens", `${UI.html("number-field", { id: "stp-brief-tokens", value: String(st.fullBriefEveryTokens ?? 20000), min: 1000, max: 10000000, step: 1000 })}`)}
      ${stpField("Replay after a reconnect", `${UI.html("number-field", { id: "stp-replay", value: String(st.replayAfterRestart ?? 10), min: 0, max: 200 })}`)}
      ${stpField("Missed messages read at most", `${UI.html("number-field", { id: "stp-backlog", value: String(st.backlogCap ?? 50), min: 1, max: 1000 })}`)}
      ${stpField("Most characters in a vibio or the rules", `${UI.html("number-field", { id: "stp-text-limit", value: String(st.briefTextLimit ?? 8000), min: 500, max: 32000, step: 500 })}`)}
      ${stpSwitch("Core rules in every header", "stp-header-rules", st.headerRules !== false)}
      ${stpSwitch("Show vendor and model to other vibemates", "stp-vendor", !!st.showVendorInRoster)}
    </div>`;
    const agentOptions = [["", "none yet: cast when the room opens"], ...state.recipes.map((r) => [r.id, r.vendor + (r.unavailableReason ? " (not installed here)" : "")])];
    const vms = (t.vibemates || []).map((v, i) => `<div class="stp-vm" data-i="${i}">${avatar({ name: v.name, avatar: v.avatar, color: FALLBACK_COLOR() }, 36, {})}<div>
        <div class="stp-vm-top"><b>${esc(v.name)}</b>${UI.html("icon-button", { icon: "close", title: "Leave this vibemate out of the template", kind: "ghost", size: "sm", data: { stpRemove: true } })}</div>
        <div class="stp-vm-fields">
          ${stpField("Vibename", `<input type="text" data-k="name" maxlength="40" value="${esc(v.name)}" required>`)}
          ${stpField("Vibersona", `<input type="text" data-k="tagline" maxlength="80" value="${esc(v.tagline || "")}">`)}
          ${stpField("Vibio", `<textarea data-k="role" rows="3" maxlength="4000">${esc(v.role || "")}</textarea>`, true)}
          ${stpField("Vibeface", `<input type="text" data-k="avatar" maxlength="8" value="${esc(v.avatar || "")}" placeholder="initials">`)}
          ${stpField("Coding agent", stpSelect("", v.agentType || "", agentOptions).replace('id=""', 'data-k="agentType"'))}
          ${stpField("Model", `<input type="text" data-k="model" value="${esc(v.model || "")}" placeholder="the agent's default">`)}
          ${stpField("Effort", `<input type="text" data-k="effort" value="${esc(v.effort || "")}" placeholder="default">`)}
          ${stpField("Mode", `<input type="text" data-k="mode" value="${esc(v.mode || "")}" placeholder="default">`)}
          ${stpField("Reply delay override, s", `${UI.html("number-field", { value: String(v.replyDelay ?? ""), min: 0, max: 120, step: 0.5, placeholder: "the room's", data: { k: "replyDelay" } })}`)}
          ${stpField("Skills, comma-separated", `<input type="text" data-k="skills" value="${esc((v.skills || []).join(", "))}">`, true)}
        </div>
      </div></div>`).join("");
    return `
      <div class="stp-section"><h5>Room</h5>${room}</div>
      <div class="stp-section"><h5>Room rules</h5><textarea id="stp-rules" rows="5" placeholder="one rule per line">${esc(st.customRules || "")}</textarea></div>
      <div class="stp-section"><h5>Folder</h5><span class="dir-row"><input type="text" id="stp-dir" maxlength="1000" value="${esc(t.dir || "")}" spellcheck="false">${UI.html("button", { label: "Browse", icon: "folder", kind: "ghost", hook: "browse-btn", data: { stpBrowse: true } })}</span></div>
      <div class="stp-section"><h5>Vibemates · <span id="stp-vm-count">${(t.vibemates || []).length}</span></h5>${vms || '<span class="hint">none</span>'}</div>`;
  }
  function readTemplateForm() {
    const num = (id) => Number($(id).value);
    const langText = $("#stp-lang").value.trim();
    const settings = {
      topic: $("#stp-topic").value,
      language: langText ? { mode: "fixed", language: langText } : { mode: "follow-human" },
      tools: $("#stp-tools").value,
      turnTaking: $("#stp-turns").value,
      replyDelay: num("#stp-delay"),
      agentsWakeEachOther: $("#stp-wake").checked,
      waitWhileHumanTypes: $("#stp-wait").checked,
      hopLimit: num("#stp-hops"),
      maxSentences: $("#stp-maxlen").value === "" ? null : num("#stp-maxlen"),
      refereeAction: $("#stp-referee").value,
      humanDescriptionMode: $("#stp-about").value,
      fullBriefEveryTurns: num("#stp-brief-turns"),
      fullBriefEveryTokens: num("#stp-brief-tokens"),
      replayAfterRestart: num("#stp-replay"),
      backlogCap: num("#stp-backlog"),
      headerRules: $("#stp-header-rules").checked,
      showVendorInRoster: $("#stp-vendor").checked,
      customRules: $("#stp-rules").value,
      briefTextLimit: num("#stp-text-limit"),
    };
    const vibemates = [...stpEls.preview.querySelectorAll(".stp-vm")].map((row) => {
      const v = {};
      row.querySelectorAll("[data-k]").forEach((el) => {
        const k = el.dataset.k;
        const val = el.value.trim();
        if (k === "skills") v.skills = val.split(",").map((x) => x.trim()).filter(Boolean);
        else if (k === "replyDelay") { if (val !== "") v.replyDelay = Number(val); }
        else if (val) v[k] = val;
      });
      return v;
    });
    return { emoji: $("#stp-emoji").value.trim(), dir: $("#stp-dir").value.trim(), settings, vibemates };
  }
  stpEls.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!stp.room) return;
    stpEls.create.disabled = true;
    stpEls.create.textContent = "Creating…";
    try {
      const edited = readTemplateForm();
      const res = await post(`/api/rooms/${encodeURIComponent(stp.room.id)}/save-template`, { name: stpEls.name.value, description: stpEls.desc.value, emoji: edited.emoji, template: { dir: edited.dir, settings: edited.settings, vibemates: edited.vibemates } });
      closeDialog(stpEls.dialog);
      toast(`Template "${res.template.name}" created. It is first under "Start from a template".`, "success");
    } catch (error) {
      stpEls.error.textContent = error.message;
      stpEls.error.hidden = false;
    } finally {
      stpEls.create.disabled = false;
      stpEls.create.textContent = "Create the template";
    }
  });

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
      if (!(state.settings || {}).profileCompleted) state.freshVibe = true;
      await post("/api/settings", { humanName: els.pfName.value.trim(), humanAvatar: els.pfAvatar.value.trim(), humanDescription: els.pfDesc.value.trim(), profileCompleted: true });
      closeDialog(els.pfDialog);
      if (state.view === "home") renderHome();
      toast(`Welcome, ${els.pfName.value.trim()}. Open a room and summon a vibemate.`, "info");
      if (state.freshVibe) offerLook();
    } catch (error) {
      els.pfError.textContent = error.message;
      els.pfError.hidden = false;
    }
  });
  els.pfDialog.addEventListener("cancel", (event) => event.preventDefault());
  function offerLook() {
    const current = (state.settings.appearance || {}).look || TOKENS.current.id;
    $("#look-dialog-cards").innerHTML = Object.values(TOKENS.looks).map((l) => UI.html("look-card", { look: l, tag: lookTag(l), on: l.id === current, data: { look: l.id } })).join("");
    openDialog($("#look-dialog"));
  }
  $("#look-dialog-cards").addEventListener("click", async (e) => {
    const card = e.target.closest('[data-ui="look-card"]');
    if (!card) return;
    $("#look-dialog-cards").querySelectorAll('[data-ui="look-card"]').forEach((x) => {
      UI.setState(x, x === card ? "on" : null);
      x.setAttribute("aria-pressed", x === card ? "true" : "false");
    });
    try {
      await post("/api/settings", { appearance: { look: card.dataset.look } });
    } catch (error) {
      toast(error.message, "error");
    }
  });
  $("#look-form").addEventListener("submit", (e) => {
    e.preventDefault();
    closeDialog($("#look-dialog"));
  });

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
      UI.setState(els.eraseSubmit, "loading");
      await post("/api/profile/erase", { confirm: els.eraseWord.value.trim().toLowerCase() });
      try {
        localStorage.clear();
      } catch {
      }
      location.href = "/";
    } catch (error) {
      UI.setState(els.eraseSubmit, null);
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


  const CUSTOM_VARS = [...new Set(TOKENS.adjustables.flatMap((f) => Object.keys(f.vars(f.kind === "scale" ? "1" : TOKENS.current.palette.black))))];
  function customVars(v) {
    const out = {};
    for (const f of TOKENS.adjustables) if (v[f.key]) Object.assign(out, f.vars(v[f.key]));
    return out;
  }
  function applyCustomVars(el, values) {
    for (const name of CUSTOM_VARS) el.style.removeProperty(name);
    for (const [name, value] of Object.entries(customVars(values || {}))) el.style.setProperty(name, value);
  }
  function registerLooks(specs) {
    for (const id of Object.keys(TOKENS.looks)) if (TOKENS.looks[id].custom) delete TOKENS.looks[id];
    for (const spec of specs || []) {
      try {
        TOKENS.looks[spec.id] = TOKENS.make(spec);
      } catch (error) {
        console.warn(`look ${spec.id} could not be built: ${error.message}`);
      }
    }
  }
  function refreshLooksCss() {
    const link = $("#looks-custom");
    if (link) link.href = `/looks-custom.css?v=${Date.now()}`;
  }
  function lookTag(look) {
    return look.custom ? `${(state.settings && state.settings.humanName) || "Your"}'s look` : undefined;
  }
  function tryLook(id) {
    const root = document.documentElement;
    if (root.dataset.tried === id || !TOKENS.looks[id]) {
      applyAppearance();
      return;
    }
    if (id === TOKENS.current.id) delete root.dataset.look;
    else root.dataset.look = id;
    applyCustomVars(root, (((state.settings || {}).appearance || {}).custom || {})[id] || {});
    root.dataset.tried = id;
    refreshTryButtons();
  }
  function refreshTryButtons() {
    const tried = document.documentElement.dataset.tried || "";
    document.querySelectorAll('[data-ui="ask-card"] [data-act="try-look"]').forEach((b) => {
      const label = b.querySelector(".label") || b;
      label.textContent = tried === b.dataset.look ? "Back" : "Try it on";
    });
  }
  let appliedScheme = null;
  function applyAppearance() {
    const a = (state.settings || {}).appearance || {};
    const root = document.documentElement;
    delete root.dataset.tried;
    root.style.setProperty("--fs-scale", String((a.chatFontSize || 14.5) / 14.5));
    const look = TOKENS.looks[a.look] ? a.look : TOKENS.current.id;
    if (look === TOKENS.current.id) delete root.dataset.look;
    else root.dataset.look = look;
    const scheme = TOKENS.looks[look].scheme;
    if (appliedScheme && appliedScheme !== scheme) {
      document.querySelectorAll(".mermaid-block[data-rendered]").forEach((b) => delete b.dataset.rendered);
      renderDiagrams(document);
    }
    appliedScheme = scheme;
    if (look !== TOKENS.current.id && (!a.font || a.font === "nunito")) root.style.removeProperty("--font");
    else root.style.setProperty("--font", (FONTS.text[a.font] || FONTS.text.nunito).stack);
    root.style.setProperty("--mono", (FONTS.mono[a.mono] || FONTS.mono["jetbrains-mono"]).stack);
    const frame = document.querySelector('meta[name="theme-color"]');
    if (frame) frame.content = TOKENS.looks[look].elements.browser.themeColor;
    applyCustomVars(root, (a.custom || {})[look] || {});
    document.querySelectorAll("#participants .avatar .life").forEach((ring) => setLifePath(ring, ring.parentElement));
    refreshTryButtons();
  }

  let hubIdentity = null;
  function loadSnapshot(snapshot) {
    const v = snapshot.version;
    const identity = v && v.build ? `${v.version} ${v.build} ${v.pid ?? ""}` : null;
    if (identity && hubIdentity && identity !== hubIdentity) {
      location.reload();
      return;
    }
    if (identity) hubIdentity = identity;
    state.settings = snapshot.settings;
    state.looks = snapshot.looks || [];
    registerLooks(state.looks);
    applyAppearance();
    state.update = snapshot.update || null;
    renderUpdatePop();
    state.version = snapshot.version || null;
    state.skills = snapshot.skills || [];
    state.recipes = snapshot.recipes || [];
    state.logins = new Map((snapshot.logins || []).filter((f) => f.purpose !== "install").map((f) => [f.recipeId, f]));
    state.installs = new Map((snapshot.logins || []).filter((f) => f.purpose === "install").map((f) => [f.recipeId, f]));
    state.roomDefaults = snapshot.roomDefaults || null;
    state.rooms = new Map((snapshot.rooms || []).map((r) => [r.id, r]));
    state.openRooms = [...(snapshot.openRooms || [])];
    const params = new URLSearchParams(location.search || window.DEMO_QUERY || "");
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
          if (els.rcDialog.open) refreshReconnectDialog(room);
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
      case "proposal":
        room.proposals = [...(room.proposals || []), event.proposal];
        if (showing) renderProposal(room, event.proposal);
        else toast(`${esc(event.proposal.participantName)} proposes changes to "${room.name}".`, "warn");
        return;
      case "proposal.resolved": {
        const p = (room.proposals || []).find((x) => x.key === event.key);
        if (p) p.skipped = event.skipped;
        if (showing) resolveProposalCard(room, event.key, event.status);
        else if (p) p.status = event.status;
        return;
      }
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

  const HUB_EVENTS = {
    snapshot: (m) => loadSnapshot(m.snapshot),
    "room.event": (m) => onRoomEvent(m.roomId, m.event),
    recipes: (m) => {
      state.recipes = m.recipes || [];
      if (document.querySelector("#invite-dialog")?.open) {
        renderInviteTiles();
        const picked = state.recipes.find((r) => r.id === els.invType.value);
        if (picked) refreshInviteWords(picked);
        else renderInviteLogin();
      }
      if (els.rcDialog.open) renderReconnectLogin();
      if (els.loginDialog.open) renderLoginDialog();
      if (state.view === "room") renderSideRoom();
    },
    login: (m) => {
      (m.flow.purpose === "install" ? state.installs : state.logins).set(m.flow.recipeId, m.flow);
      renderLoginHosts();
      if (document.querySelector("#invite-dialog")?.open) renderInviteTiles();
    },
    "room.created": (m) => {
      state.rooms.set(m.room.id, m.room);
      if ((state.view === "rooms" || state.view === "home")) {
        renderSideRooms();
        renderRoomsGrid();
      }
      renderRail();
    },
    "rooms.opened": (m) => {
      state.openRooms = m.roomIds || [];
      renderRail();
    },
    "room.removed": (m) => {
      const { roomId } = m;
      state.rooms.delete(roomId);
      state.openRooms = state.openRooms.filter((id) => id !== roomId);
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
    },
    skills: (m) => {
      state.skills = m.skills || [];
      if (state.view === "skills" && !editingInDetails()) renderSkillsPage();
      if (state.detailsOpen && !editingInDetails()) renderDetails();
    },
    looks: (m) => {
      state.looks = m.looks || [];
      registerLooks(state.looks);
      refreshLooksCss();
      applyAppearance();
      if (state.view === "settings" && !editingInDetails()) renderSettingsPage();
    },
    settings: (m) => {
      state.settings = m.settings;
      applyAppearance();
      rerenderDiagrams();
      renderRail();
      if (state.view === "settings" && !editingInDetails()) renderSettingsPage();
      if (state.detailsOpen && state.selection.kind === "me" && !editingInDetails()) renderDetails();
      if (state.view === "room") renderSideRoom();
    },
    update: (m) => {
      state.update = m.update;
      renderUpdatePop();
      if (state.view === "settings" && !editingInDetails()) renderSettingsPage();
    },
    reset: () => (location.href = "/"),
  };
  let stream = null;
  let releaseTimer = null;
  let retryTimer = null;
  let retryDelay = 1000;
  function connect() {
    if (stream) return;
    clearTimeout(retryTimer);
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    stream = ws;
    ws.onopen = () => {
      retryDelay = 1000;
      els.conn.classList.add("ok");
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      const handle = HUB_EVENTS[m.type];
      if (handle) handle(m);
    };
    ws.onerror = () => els.conn.classList.remove("ok");
    ws.onclose = () => {
      els.conn.classList.remove("ok");
      if (stream !== ws) return;
      stream = null;
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 10000);
    };
  }
  function releaseStream() {
    if (!stream) return;
    const ws = stream;
    stream = null;
    ws.close();
    els.conn.classList.remove("ok");
    els.conn.title = "Paused while this tab is in the background; resumes when you come back";
  }
  function resyncStream() {
    releaseStream();
    els.conn.title = "Connection to the hub";
    connect();
  }
  document.addEventListener("visibilitychange", () => {
    clearTimeout(releaseTimer);
    if (document.hidden) releaseTimer = setTimeout(releaseStream, 15000);
    else {
      els.conn.title = "Connection to the hub";
      connect();
    }
  });


  let composerMin = Number(recall("composerH")) || 0;
  const composerCeiling = () => Math.max(120, els.app.clientHeight - 260);
  const fieldSizing = CSS.supports("field-sizing", "content");
  let autosizeQueued = false;
  function autosizeSoon() {
    if (fieldSizing || autosizeQueued) return;
    autosizeQueued = true;
    requestAnimationFrame(() => {
      autosizeQueued = false;
      autosize();
    });
  }
  let composerBounds = "";
  function autosize() {
    const min = Math.max(36, composerMin);
    const cap = Math.max(180, min);
    if (fieldSizing) {
      const max = Math.min(composerCeiling(), cap);
      if (composerBounds === `${min}/${max}`) return;
      composerBounds = `${min}/${max}`;
      els.input.style.minHeight = `${min}px`;
      els.input.style.maxHeight = `${max}px`;
      return;
    }
    els.input.style.height = "auto";
    els.input.style.height = Math.min(composerCeiling(), Math.max(min, Math.min(cap, els.input.scrollHeight))) + "px";
  }
  window.addEventListener("resize", autosize);
  autosize();
  {
    const grip = $("#composer-grip");
    let drag = null;
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      drag = { y: e.clientY, h: els.input.offsetHeight };
      grip.setPointerCapture(e.pointerId);
      els.composer.classList.add("resizing");
      e.preventDefault();
    });
    grip.addEventListener("pointermove", (e) => {
      if (!drag) return;
      composerMin = Math.round(Math.min(composerCeiling(), Math.max(36, drag.h + drag.y - e.clientY)));
      autosize();
    });
    const stop = () => {
      if (!drag) return;
      drag = null;
      els.composer.classList.remove("resizing");
      remember("composerH", composerMin);
    };
    grip.addEventListener("pointerup", stop);
    grip.addEventListener("pointercancel", stop);
    grip.addEventListener("dblclick", () => {
      composerMin = 0;
      remember("composerH", 0);
      autosize();
    });
  }

  const SHOT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const SHOTS_MAX = 6;
  let pendingShots = [];
  let shotSeq = 0;
  const shotMarker = (n) => `[img ${n}]`;

  const composerClear = $("#composer-clear");
  function updateComposerClear() {
    composerClear.hidden = !(els.input.value.trim() || pendingShots.length || pendingQuotes.length);
  }
  composerClear.addEventListener("click", () => {
    els.input.value = "";
    clearShots();
    clearQuotes();
    autosize();
    updateComposerClear();
    els.input.focus();
  });
  els.input.addEventListener("input", updateComposerClear);
  function renderShotsTray() {
    updateComposerClear();
    els.shotsTray.hidden = !pendingShots.length;
    els.shotsTray.innerHTML = pendingShots
      .map((shot, i) => `<span class="shot-chip"><img src="${esc(shot.data)}" alt=""><span class="shot-n">${shot.n}</span><button type="button" class="shot-drop" data-i="${i}" title="Remove ${esc(shot.name)}">×</button></span>`)
      .join("");
  }

  function clearShots() {
    pendingShots = [];
    shotSeq = 0;
    renderShotsTray();
  }

  function insertMarker(text) {
    const el = els.input;
    const value = el.value;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const tail = after && !/^\s/.test(after) ? " " : "";
    const marker = `${lead}${text}${tail}`;
    el.value = before + marker + after;
    const caret = before.length + marker.length;
    el.setSelectionRange(caret, caret);
    autosize();
  }

  function removeMarker(pattern) {
    const el = els.input;
    const caret = el.selectionStart ?? el.value.length;
    const removedBefore = (el.value.slice(0, caret).match(pattern) || []).join("").length;
    el.value = el.value.replace(pattern, "");
    const at = Math.max(0, caret - removedBefore);
    el.setSelectionRange(at, at);
    autosize();
  }

  function addShotFiles(files) {
    const room = currentRoom();
    if (!room) return;
    for (const file of files) {
      if (!SHOT_TYPES.includes(file.type)) {
        showError(new Error(`${file.name || "that image"} is a ${file.type || "kind"} the room cannot show (png, jpeg, webp and gif only)`));
        continue;
      }
      if (pendingShots.length >= SHOTS_MAX) return void showError(new Error(`up to ${SHOTS_MAX} images per message`));
      const reader = new FileReader();
      const name = file.name || "";
      reader.onload = () => {
        if (pendingShots.length >= SHOTS_MAX) return void showError(new Error(`up to ${SHOTS_MAX} images per message`));
        const n = ++shotSeq;
        pendingShots.push({ n, name, mimeType: file.type, data: String(reader.result) });
        renderShotsTray();
        insertMarker(shotMarker(n));
      };
      reader.onerror = () => showError(new Error(`could not read ${name || "the image"}`));
      reader.readAsDataURL(file);
    }
  }

  function imageFilesFrom(transfer) {
    if (!transfer) return [];
    return Array.from(transfer.files || []).filter((f) => f && f.type && f.type.startsWith("image/"));
  }

  els.shotsTray.addEventListener("click", (e) => {
    const drop = e.target.closest(".shot-drop");
    if (!drop) return;
    const [shot] = pendingShots.splice(Number(drop.dataset.i), 1);
    if (shot) removeMarker(new RegExp(` ?\\[img ${shot.n}\\]`, "gi"));
    renderShotsTray();
  });

  const QUOTES_MAX = 6;
  let pendingQuotes = [];
  let quoteSeq = 0;
  const quoteMarker = (n) => `[quote ${n}]`;
  const CHIP_CHARS = 70;

  function renderQuotesTray() {
    updateComposerClear();
    els.quotesTray.hidden = !pendingQuotes.length;
    els.quotesTray.innerHTML = pendingQuotes
      .map(
        (q, i) =>
          `<span class="quote-chip" title="${esc(q.text)}"><span class="qc-n">${q.n}</span><b>${esc(q.fromName)}</b><span class="qc-text">${esc(q.text.replace(/\s+/g, " ").slice(0, CHIP_CHARS))}${q.text.length > CHIP_CHARS ? "…" : ""}</span><button type="button" class="qc-drop" data-i="${i}" title="Remove this quote">×</button></span>`,
      )
      .join("");
  }

  function clearQuotes() {
    pendingQuotes = [];
    quoteSeq = 0;
    renderQuotesTray();
  }

  function addQuote(m, text) {
    if (!m || m.kind !== "chat" || m.pending) return void showError(new Error("only a message the room has can be quoted"));
    if (pendingQuotes.length >= QUOTES_MAX) return void showError(new Error(`up to ${QUOTES_MAX} quotes per message`));
    const fragment = String(text || "").trim() || String(m.text || "").trim();
    if (!fragment) return void showError(new Error("there is no text to quote in that message"));
    const n = ++quoteSeq;
    pendingQuotes.push({ n, seq: m.seq, from: m.from, fromName: m.fromName, ts: m.ts, text: fragment });
    renderQuotesTray();
    insertMarker(quoteMarker(n));
    els.input.focus();
  }

  els.quotesTray.addEventListener("click", (e) => {
    const drop = e.target.closest(".qc-drop");
    if (!drop) return;
    const [quote] = pendingQuotes.splice(Number(drop.dataset.i), 1);
    if (quote) removeMarker(new RegExp(` ?\\[quote ${quote.n}\\]`, "gi"));
    renderQuotesTray();
  });

  function messageOfNode(node) {
    const el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    const msg = el && el.closest && el.closest(".msg[data-id]");
    const room = currentRoom();
    if (!msg || !room) return null;
    const m = room.messages.find((x) => x.id === msg.dataset.id);
    return m && m.kind === "chat" ? m : null;
  }

  function bubbleSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    const range = sel.getRangeAt(0);
    const m = messageOfNode(range.startContainer);
    if (!m || m !== messageOfNode(range.endContainer)) return null;
    if (!range.startContainer.parentElement || !range.startContainer.parentElement.closest(".bubble .text")) return null;
    return { m, text, rect: range.getBoundingClientRect() };
  }

  const quotePop = document.createElement("button");
  quotePop.type = "button";
  quotePop.className = "quote-pop";
  quotePop.hidden = true;
  quotePop.innerHTML = `${ic("quote")}Quote`;
  document.body.appendChild(quotePop);
  let quotePopFor = null;
  function placeQuotePop() {
    const found = bubbleSelection();
    if (!found) {
      quotePop.hidden = true;
      quotePopFor = null;
      return;
    }
    quotePopFor = found;
    quotePop.hidden = false;
    const top = Math.max(8, found.rect.top - 36);
    quotePop.style.top = `${top}px`;
    quotePop.style.left = `${Math.min(window.innerWidth - 96, Math.max(8, found.rect.left + found.rect.width / 2 - 40))}px`;
  }
  els.messages.addEventListener("mouseup", () => setTimeout(placeQuotePop, 0));
  els.messages.addEventListener("keyup", (e) => {
    if (e.shiftKey || e.key === "Shift") setTimeout(placeQuotePop, 0);
  });
  document.addEventListener("selectionchange", () => {
    if (!quotePop.hidden && !bubbleSelection()) {
      quotePop.hidden = true;
      quotePopFor = null;
    }
  });
  quotePop.addEventListener("mousedown", (e) => e.preventDefault());
  quotePop.addEventListener("click", () => {
    if (quotePopFor) addQuote(quotePopFor.m, quotePopFor.text);
    quotePop.hidden = true;
    quotePopFor = null;
    window.getSelection().removeAllRanges();
  });

  els.messages.addEventListener("copy", (e) => {
    const found = bubbleSelection();
    if (!found || !e.clipboardData) return;
    e.clipboardData.setData("text/plain", found.text);
    e.clipboardData.setData(
      "text/html",
      `<blockquote data-viberoom-seq="${found.m.seq}" data-viberoom-room="${esc(currentRoom().id)}" data-viberoom-from="${esc(found.m.fromName)}" cite="viberoom">${esc(found.text)}</blockquote>`,
    );
    e.preventDefault();
  });

  function pastedQuotes(transfer) {
    const room = currentRoom();
    const html = transfer && room ? transfer.getData("text/html") : "";
    if (!html || !html.includes("data-viberoom-seq")) return [];
    const box = document.createElement("div");
    box.innerHTML = html;
    return [...box.querySelectorAll("[data-viberoom-seq]")]
      .filter((node) => node.dataset.viberoomRoom === room.id)
      .map((node) => ({ m: room.messages.find((x) => x.seq === Number(node.dataset.viberoomSeq)), text: node.textContent }))
      .filter((q) => q.m);
  }

  els.input.addEventListener("paste", (e) => {
    const files = imageFilesFrom(e.clipboardData);
    if (files.length) {
      e.preventDefault();
      addShotFiles(files);
      return;
    }
    const quotes = pastedQuotes(e.clipboardData);
    if (!quotes.length) return;
    e.preventDefault();
    for (const q of quotes) addQuote(q.m, q.text);
  });
  for (const target of [els.composer, els.messages]) {
    target.addEventListener("dragover", (e) => {
      if (!imageFilesFrom(e.dataTransfer).length && !(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"))) return;
      e.preventDefault();
      els.composer.classList.add("drop-target");
    });
    target.addEventListener("dragleave", () => els.composer.classList.remove("drop-target"));
    target.addEventListener("drop", (e) => {
      const files = imageFilesFrom(e.dataTransfer);
      els.composer.classList.remove("drop-target");
      if (!files.length) return;
      e.preventDefault();
      addShotFiles(files);
      els.input.focus();
    });
  }
  let typingSentAt = 0;
  els.input.addEventListener("input", () => {
    lastTypedAt = Date.now();
    if (!currentRoom() || !els.input.value.trim()) return;
    const now = Date.now();
    if (now - typingSentAt < 2000) return;
    typingSentAt = now;
    post(roomApi("/typing"), {}).catch(() => undefined);
  });
  els.participants.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]");
    const room = currentRoom();
    if (!li || !room) return;
    const p = findById(room, li.dataset.id);
    if (!p) return;
    if (p.kind === "agent" && p.status !== "unstaffed" && e.target.closest(".avatar")) {
      if (!lifePop || lifePop.id !== p.id) openLifePop(p, li);
      else if (lifePop.hover) lifePop.hover = false;
      else closeLifePop();
      return;
    }
    const fix = e.target.closest('[data-act^="trouble-"]');
    if (fix) {
      troubleAction(room, p, fix.dataset.act.slice("trouble-".length), fix).catch(showError);
      return;
    }
    const action = e.target.closest('[data-ui="row-button"]');
    if (action) {
      const act = action.dataset.act;
      if (act === "panel") return openDetails({ kind: "participant", id: p.id });
      if (act === "last-reply") {
        const last = [...els.messages.querySelectorAll(`.msg.agent[data-from="${cssEscape(p.id)}"]`)].pop();
        if (last) jumpToMessage(last);
        else toast(`${p.name} has not replied in this room yet`);
        return;
      }
      if (act === "wake") return openReconnectDialog(room, p);
      return;
    }
    if (e.target.closest("button")) return;
    if (p.kind === "human") openDetails({ kind: "me" });
    else if (p.status === "unstaffed") openStaffDialog(p);
    else openDetails({ kind: "participant", id: p.id });
  });
  const castBanner = $("#cast-banner");
  castBanner.addEventListener("click", (e) => {
    const card = e.target.closest(".cast-card");
    const room = card && currentRoom();
    const p = room && findById(room, card.dataset.id);
    if (p && p.status === "unstaffed") openStaffDialog(p);
  });
  function updateCastGate(room) {
    const waiting = room ? room.participants.filter((p) => p.kind === "agent" && p.status === "unstaffed") : [];
    castBanner.hidden = waiting.length === 0;
    castBanner.innerHTML = waiting.length
      ? `<div class="cast-lead"><strong>Summon ${waiting.map((p) => esc(p.name)).join(" and ")} to begin.</strong> ${waiting.length === 1 ? "It comes" : "They come"} from the template with the character set; pick the coding agent that runs ${waiting.length === 1 ? "it" : "each"}.</div><div class="cast-list">${waiting.map((p) => `<button type="button" class="cast-card" data-id="${esc(p.id)}">${avatar(p, 44, { dim: "unstaffed" })}<b>${esc(p.name)}</b>${p.tagline ? `<span>"${esc(p.tagline)}"</span>` : ""}<em>Summon ${esc(p.name)}</em></button>`).join("")}</div>`
      : "";
    els.input.disabled = waiting.length > 0;
    els.input.placeholder = waiting.length ? `Summon ${waiting.map((p) => p.name).join(" and ")} to start the conversation` : "Message the room… @Name or /skill";
    els.composer.classList.toggle("gated", waiting.length > 0);
  }
  els.participants.addEventListener("dblclick", (e) => {
    const li = e.target.closest("li[data-id]");
    const p = li && findById(currentRoom(), li.dataset.id);
    if (p && p.kind === "agent") insertMention(p.name);
  });
  els.composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = els.input.value.trim();
    const room = currentRoom();
    if ((!text && !pendingShots.length && !pendingQuotes.length) || !room) return;
    const shots = pendingShots;
    const quotes = pendingQuotes;
    els.input.value = "";
    clearShots();
    clearQuotes();
    typingSentAt = 0;
    autosize();
    const local = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, seq: 0, from: "human", fromName: (state.settings || {}).humanName || "You", to: [], toNames: [], text, ts: Date.now(), kind: "chat", pending: true };
    if (shots.length) local.images = shots.map((shot) => ({ file: "", name: shot.name, mimeType: shot.mimeType, bytes: 0, n: shot.n, url: shot.data }));
    if (quotes.length) local.quotes = quotes.map((q) => ({ ...q }));
    const localId = local.id;
    upsertMessage(room.id, local);
    try {
      const r = await post(roomApi("/send"), { text, images: shots, quotes: quotes.map((q) => ({ n: q.n, seq: q.seq, text: q.text })) });
      if (r.command) removeMessage(room.id, localId);
      else adoptLocalMessage(room.id, localId, r.id);
    } catch (error) {
      removeMessage(room.id, localId);
      showError(error);
      els.input.value = text;
      pendingShots = shots;
      pendingQuotes = quotes;
      renderShotsTray();
      renderQuotesTray();
    }
  });
  function adoptLocalMessage(roomId, localId, realId) {
    const room = state.rooms.get(roomId);
    if (!room || !realId || localId === realId) return;
    if (room.messages.some((m) => m.id === realId)) return removeMessage(roomId, localId);
    const m = room.messages.find((x) => x.id === localId);
    if (!m) return;
    m.id = realId;
    delete m.pending;
    const el = els.messages.querySelector(`.msg[data-id="${localId}"]`);
    if (el) el.dataset.id = realId;
    const note = doneNotes.find((n) => n.id === localId);
    if (note) {
      note.id = realId;
      renderDoneNotes();
    }
  }


  const RULE_MENTION_RE = /(?<![\w.\/:])@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;
  function mentionChip(p) {
    const chip = document.createElement("span");
    chip.className = "mention-chip";
    chip.contentEditable = "false";
    chip.dataset.name = p.name;
    chip.style.color = p.color;
    chip.innerHTML = `${avatar(p, 16, { vendor: false })}<span class="chip-name">@${esc(p.name)}</span>`;
    return chip;
  }
  function rulesToNodes(editor, text, room) {
    editor.innerHTML = "";
    let last = 0;
    for (const m of text.matchAll(RULE_MENTION_RE)) {
      const p = findByName(room, m[1]);
      if (!p) continue;
      editor.appendChild(document.createTextNode(text.slice(last, m.index)));
      editor.appendChild(mentionChip(p));
      last = m.index + m[0].length;
    }
    editor.appendChild(document.createTextNode(text.slice(last)));
  }
  function rulesText(editor) {
    let out = "";
    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue;
        else if (n.nodeName === "BR") out += "\n";
        else if (n.classList && n.classList.contains("mention-chip")) out += `@${n.dataset.name}`;
        else if (n.nodeName === "DIV" || n.nodeName === "P") {
          if (out && !out.endsWith("\n")) out += "\n";
          walk(n);
          if (!out.endsWith("\n")) out += "\n";
        } else walk(n);
      }
    };
    walk(editor);
    return out.replace(/\n+$/, "");
  }
  function attachRichMentions(editor, menuEl) {
    const m = { open: false, items: [], index: 0, node: null, start: -1 };
    function caret() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
      const r = sel.getRangeAt(0);
      if (r.startContainer.nodeType !== Node.TEXT_NODE || !editor.contains(r.startContainer)) return null;
      return { node: r.startContainer, offset: r.startOffset };
    }
    function placeCaret(node, offset) {
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(node, offset);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    function context() {
      const c = caret();
      if (!c) return null;
      const before = c.node.nodeValue.slice(0, c.offset);
      const match = before.match(/(^|\s)@([\p{L}\p{N}_-]*)$/u);
      if (!match) return null;
      return { node: c.node, start: c.offset - match[2].length - 1, end: c.offset, prefix: match[2] };
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
      const items = room.participants.filter((p) => p.name.toLowerCase().startsWith(q));
      if (!items.length) return close();
      m.open = true;
      m.items = items;
      m.node = ctx.node;
      m.start = ctx.start;
      m.end = ctx.end;
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
    function chipify(node, start, end, p) {
      const after = document.createTextNode(" " + node.nodeValue.slice(end));
      node.nodeValue = node.nodeValue.slice(0, start);
      const chip = mentionChip(p);
      node.after(chip, after);
      return after;
    }
    function pick(i) {
      const p = m.items[i];
      if (!p) return close();
      const after = chipify(m.node, m.start, m.end, p);
      close();
      editor.focus();
      placeCaret(after, 1);
    }
    function chipifyComplete() {
      const room = currentRoom();
      if (!room) return;
      const c = caret();
      for (const node of [...editor.childNodes, ...[...editor.querySelectorAll("div, p")].flatMap((b) => [...b.childNodes])]) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        for (const match of [...node.nodeValue.matchAll(RULE_MENTION_RE)].reverse()) {
          const end = match.index + match[0].length;
          if (!/\s/.test(node.nodeValue[end] || "")) continue;
          const p = findByName(room, match[1]);
          if (!p) continue;
          const caretHere = c && c.node === node ? c.offset : -1;
          const after = chipify(node, match.index, end + 1, p);
          if (caretHere >= end + 1) placeCaret(after, caretHere - end);
          break;
        }
      }
    }
    editor.addEventListener("input", () => {
      m.index = 0;
      chipifyComplete();
      render();
    });
    editor.addEventListener("paste", (e) => {
      e.preventDefault();
      document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text/plain"));
    });
    editor.addEventListener("blur", () => setTimeout(close, 150));
    editor.addEventListener("keydown", (event) => {
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

  const ALL_MENTION = { id: "all", name: "All", kind: "all", tagline: "every vibemate in the room" };
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
      const agents = room.participants.filter((p) => p.kind === "agent" && p.status !== "left").length;
      if (!opts.includeHuman && agents > 1 && "all".startsWith(q)) items.unshift(ALL_MENTION);
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
        b.innerHTML = `${p === ALL_MENTION ? `<span class="mm-all">${ic("rooms")}</span>` : avatar(p, 24, { vendor: true })}<span>${esc(p.name)}</span><span class="mm-sub">${esc(p.kind === "human" ? "you" : p.tagline || p.agentVendor || "")}${p.status === "offline" ? " · offline" : ""}</span>`;
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
  attachMentions(els.input, els.mentionMenu, { onChange: autosizeSoon });
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
      setView(nav);
      remember("view", nav);
    });
  });
  els.railToggle.addEventListener("click", () => setRailOpen(!els.app.classList.contains("rail-open")));
  els.railRooms.addEventListener("click", (e) => {
    const b = e.target.closest(".rail-room");
    if (b) selectRoom(b.dataset.room, { keepDetails: true });
  });
  els.railRooms.addEventListener("animationend", (e) => e.target.classList.remove("bump"));
  function setSideOpen(open) {
    els.app.classList.toggle("side-collapsed", !open);
    remember("sideOpen", open ? "1" : "0");
    els.sideToggle.title = open ? "Fold this column" : "Unfold this column";
    els.sideToggle.innerHTML = ic(open ? "collapse" : "expand");
  }
  els.sideToggle.addEventListener("click", () => setSideOpen(els.app.classList.contains("side-collapsed")));
  let lastScrollTop = 0;
  let lastUserScrollAt = 0;
  for (const type of ["wheel", "touchmove", "keydown", "mousedown"]) {
    els.messages.addEventListener(type, () => (lastUserScrollAt = Date.now()), { passive: true });
  }
  els.messages.addEventListener("scroll", () => {
    const top = els.messages.scrollTop;
    const byHand = Date.now() - lastUserScrollAt < 700;
    if (byHand) {
      if (top < lastScrollTop) stuck = false;
      else if (els.messages.scrollHeight - top - els.messages.clientHeight < 12) stuck = true;
    } else if (nearBottom()) stuck = true;
    else if (top < lastScrollTop) stuck = false;
    lastScrollTop = top;
    els.jumpLatest.hidden = stuck;
    updateTimelineView();
    updateWorkingNow();
    if (stuck) clearNotes();
    else pruneDoneNotes();
  });
  els.jumpLatest.addEventListener("click", scrollToBottom);
  document.addEventListener("mousedown", (e) => {
    if (!state.detailsOpen) return;
    if (e.target.closest("#details, #side, .rail, .chat-actions, dialog, .mention-menu, .lightbox, .tl-pop, #pins-panel")) return;
    closeDetails();
  });
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
      const marked = els.fvBody.querySelector(".gutter span.line-mark");
      const line = marked ? Number(marked.textContent) : fileView ? fileView.from : 1;
      const r = await post("/api/open", { target: `${els.fvOpen.dataset.path}:${line || 1}` });
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
        if (IMAGE_RE.test(target) && !/^(https?:|mailto:)/i.test(target) && /[\\/]/.test(target)) {
          openLightbox(imageUrl(target), target.split(/[\\/]/).pop());
          return;
        }
        if (readableInRoom(target)) {
          const spec = splitLine(target);
          const file = spec ? spec.path : target;
          const room = currentRoom();
          const found = await resolveInRoom(room ? room.id : "", file);
          if (!found || found.kind === "file") {
            await viewFile(file, spec && !VIEWABLE_RE.test(file) ? spec.from : 0);
            return;
          }
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
      return;
    }
    const expand = e.target.closest && e.target.closest(".mm-expand");
    if (expand) openDiagram(expand.closest(".mermaid-block"));
  });
  els.roomSettingsBtn.addEventListener("click", () => openDetails({ kind: "room" }));
  els.chatInfoBtn.addEventListener("click", () => openDetails({ kind: "room" }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.detailsOpen && !document.querySelector("dialog[open]") && !editingInDetails()) closeDetails();
  });
  window.addEventListener("beforeunload", () => remember("view", state.view));

  const TICK_H = 5;
  function createTimeline(root, pick, opts) {
    const t = { el: root, ticks: root.querySelector(".tl-ticks"), view: root.querySelector(".tl-view"), pop: root.querySelector(".tl-pop"), items: [] };
    function render() {
      const room = currentRoom();
      const nodes = room && state.view === "room" ? pick(room) : [];
      t.items = nodes;
      t.el.hidden = nodes.length === 0;
      t.pop.hidden = true;
      if (!nodes.length) return;
      const total = els.messages.scrollHeight || 1;
      const h = Math.max(0, t.ticks.clientHeight - TICK_H);
      const fits = els.messages.scrollHeight <= els.messages.clientHeight + 1;
      const stripTop = fits ? t.ticks.getBoundingClientRect().top : 0;
      const tops = fits ? nodes.map((el) => el.getBoundingClientRect().top - stripTop) : nodes.map(topInList);
      const frag = document.createDocumentFragment();
      nodes.forEach((el, i) => {
        const tick = document.createElement("div");
        const pinned = el.classList.contains("pinned");
        tick.className = `tl-tick${pinned ? " pinned i i-pin" : ""}`;
        tick.dataset.i = i;
        if (opts.colorOf) tick.style.setProperty("--tick", opts.colorOf(room, el));
        tick.style.top = `${Math.round(fits ? Math.max(0, Math.min(h, tops[i] + 6)) : (tops[i] / total) * h)}px`;
        frag.appendChild(tick);
      });
      t.ticks.replaceChildren(frag);
      updateView();
      if (fits && !t.following) {
        t.following = true;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          render();
          t.following = false;
        }));
      }
    }
    function updateView() {
      if (t.el.hidden) return;
      const m = els.messages;
      const total = m.scrollHeight || 1;
      const h = t.ticks.clientHeight;
      t.view.style.top = `${(m.scrollTop / total) * h}px`;
      t.view.style.height = `${Math.max(8, (m.clientHeight / total) * h)}px`;
      const top = m.scrollTop;
      const bottom = m.scrollTop + m.clientHeight;
      const inView = t.items.map((el) => { const y = topInList(el); return y + el.offsetHeight > top && y < bottom; });
      inView.forEach((on, i) => {
        const tick = t.ticks.children[i];
        if (tick) tick.classList.toggle("in-view", on);
      });
    }
    function rowHtml(k, cls) {
      const el = t.items[k];
      const av = opts.avatarOf ? `<span class="tl-av">${opts.avatarOf(currentRoom(), el)}</span>` : "";
      const pinned = el.classList.contains("pinned");
      return `<div class="tl-row ${cls}${pinned ? " pinned" : ""}" data-i="${k}">${av}<span class="tl-text">${esc(timelineText(el))}</span>${pinned ? `<span class="tl-pin" title="Pinned">${ic("pin")}</span>` : ""}</div>`;
    }
    function showPop(i, keepPlace) {
      const rows = [[i - 2, "faded far"], [i - 1, "faded"], [i, "current"], [i + 1, "faded"], [i + 2, "faded far"]].filter(([k]) => t.items[k]);
      t.pop.innerHTML = rows.map(([k, c]) => rowHtml(k, c)).join("");
      t.pop.hidden = false;
      t.ticks.querySelectorAll(".tl-tick.active").forEach((x) => x.classList.remove("active"));
      const tick = t.ticks.children[i];
      if (tick) tick.classList.add("active");
      if (keepPlace) return;
      const current = t.pop.querySelector(".tl-row.current");
      let top = (tick ? tick.offsetTop : 0) - (current ? current.offsetTop + current.offsetHeight / 2 : 20) + TICK_H / 2;
      top = Math.max(0, Math.min(top, t.el.clientHeight - t.pop.offsetHeight));
      t.pop.style.top = `${top}px`;
    }
    function hidePop() {
      t.pop.hidden = true;
      t.ticks.querySelectorAll(".tl-tick.active").forEach((x) => x.classList.remove("active"));
    }
    t.ticks.addEventListener("mouseover", (e) => {
      const tick = e.target.closest(".tl-tick");
      if (tick) showPop(Number(tick.dataset.i));
    });
    let hideTimer = 0;
    t.el.addEventListener("mouseleave", () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hidePop, 320);
    });
    t.el.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    t.ticks.addEventListener("click", (e) => {
      const tick = e.target.closest(".tl-tick");
      if (tick) jumpToMessage(t.items[Number(tick.dataset.i)]);
    });
    t.pop.addEventListener("click", (e) => {
      const row = e.target.closest(".tl-row");
      if (row) jumpToMessage(t.items[Number(row.dataset.i)]);
    });
    const WHEEL_STEP = 30;
    let wheelAcc = 0;
    t.pop.addEventListener(
      "wheel",
      (e) => {
        if (t.pop.hidden || !t.items.length) return;
        e.preventDefault();
        wheelAcc += e.deltaY;
        if (Math.abs(wheelAcc) < WHEEL_STEP) return;
        const step = Math.sign(wheelAcc);
        wheelAcc = 0;
        const row = t.pop.querySelector(".tl-row.current");
        const current = row ? Number(row.dataset.i) : 0;
        const next = Math.max(0, Math.min(t.items.length - 1, current + step));
        if (next !== current) showPop(next, true);
      },
      { passive: false },
    );
    return { render, updateView };
  }
  function timelineText(el) {
    const t = el.querySelector(".text");
    return (t ? t.textContent : el.textContent).trim().replace(/\s+/g, " ").slice(0, 240);
  }
  const doneNotes = [];
  const NOTE_TTL_MS = 4000;
  function bubbleInView(id) {
    const head = els.messages.querySelector(`.msg[data-id="${id}"] .head`);
    if (!head) return false;
    const box = els.messages.getBoundingClientRect();
    const r = head.getBoundingClientRect();
    return r.bottom > box.top && r.top < box.bottom;
  }
  function pushNote(note) {
    const i = doneNotes.findIndex((n) => n.id === note.id);
    if (i >= 0) {
      clearTimeout(doneNotes[i].timer);
      doneNotes.splice(i, 1);
    }
    note.timer = setTimeout(() => dropNote(note.id), NOTE_TTL_MS);
    doneNotes.push(note);
    while (doneNotes.length > 4) dropNote(doneNotes[0].id);
    renderDoneNotes();
  }
  function dropNote(id) {
    const i = doneNotes.findIndex((n) => n.id === id);
    if (i < 0) return;
    clearTimeout(doneNotes[i].timer);
    doneNotes.splice(i, 1);
    renderDoneNotes();
  }
  function clearNotes() {
    for (const n of doneNotes) clearTimeout(n.timer);
    doneNotes.length = 0;
    renderDoneNotes();
  }
  function noteFinished(room, m) {
    if (room.id !== state.currentRoomId || state.view !== "room") return;
    requestAnimationFrame(() => {
      if (bubbleInView(m.id)) return;
      const p = findById(room, m.from) || { name: m.fromName, color: FALLBACK_COLOR(), kind: "agent" };
      pushNote({ id: m.id, kind: "done", p, text: `${p.name} finished`, sub: `started ${time(m.ts)}${m.durationMs ? ` · ${spanText(m.durationMs)}` : ""}` });
    });
  }
  function noteNew(room, m) {
    if (room.id !== state.currentRoomId || state.view !== "room") return;
    requestAnimationFrame(() => {
      if (bubbleInView(m.id)) return;
      const p = findById(room, m.from) || { name: m.fromName, color: FALLBACK_COLOR(), kind: "agent" };
      pushNote({ id: m.id, kind: "new", p, text: `${p.name} wrote below`, sub: time(m.ts) });
    });
  }
  function spanText(ms) {
    if (!ms) return "";
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  }
  function renderDoneNotes() {
    els.doneNotes.hidden = doneNotes.length === 0;
    els.doneNotes.innerHTML = doneNotes
      .map((n) => `<button type="button" class="done-note ${n.kind}" data-id="${esc(n.id)}" title="Go to the message">${avatar(n.p, 18, {})}<span class="done-text"><b>${esc(n.text)}</b><small>${esc(n.sub)}</small></span></button>`)
      .join("");
  }
  function pruneDoneNotes() {
    for (const n of [...doneNotes]) if (bubbleInView(n.id)) dropNote(n.id);
  }
  els.doneNotes.addEventListener("click", (e) => {
    const note = e.target.closest(".done-note");
    if (!note) return;
    const id = note.dataset.id;
    dropNote(id);
    jumpToMessage(els.messages.querySelector(`.msg[data-id="${id}"]`));
  });
  function jumpToMessage(el) {
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    requestAnimationFrame(() => el.scrollIntoView({ block: "center" }));
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }
  const authorOf = (room, el) => findById(room, el.dataset.from);
  const timelines = [
    createTimeline($("#timeline"), () => [...els.messages.querySelectorAll(".msg.mine:not(.hidden-by-search)")], {}),
    createTimeline($("#timeline-left"), () => [...els.messages.querySelectorAll(".msg.agent:not(.hidden-by-search)")], {
      colorOf: (room, el) => (authorOf(room, el) || {}).color || FALLBACK_COLOR(),
      avatarOf: (room, el) => { const p = authorOf(room, el); return p ? avatar(p, 16, {}) : ""; },
    }),
  ];
  function renderTimeline() {
    const t0 = performance.now();
    for (const t of timelines) t.render();
    renderPins();
    noteSlow("timeline strips", performance.now() - t0);
  }
  function updateTimelineView() { for (const t of timelines) t.updateView(); }
  attachScrollHints(els.pageInner);
  attachScrollHints(els.detailsInner);
  document.querySelectorAll("dialog.dialog").forEach((d) => attachScrollHints(d));
  const composerFollowers = [$("#timeline"), $("#timeline-left"), els.mentionMenu, els.emojiMenu, els.jumpLatest];
  new ResizeObserver(() => {
    const h = `${els.composer.offsetHeight}px`;
    for (const el of composerFollowers) el.style.setProperty("--composer-h", h);
    renderTimeline();
  }).observe(els.composer);
  new ResizeObserver(() => renderTimeline()).observe(els.messages);
  document.fonts.ready.then(() => renderTimeline());
  let timelineTimer = 0;
  new MutationObserver(() => {
    if (timelineTimer) return;
    timelineTimer = setTimeout(() => {
      timelineTimer = 0;
      renderTimeline();
    }, 300);
  }).observe(els.messages, { childList: true, subtree: true });

  const workingNow = $("#working-now");
  function renderWorkingNow() {
    const room = currentRoom();
    const working = room && state.view === "room" ? room.participants.filter((p) => p.kind === "agent" && p.status === "thinking") : [];
    workingNow.innerHTML = working.map((p, i) => `<button type="button" class="wn-av" data-id="${esc(p.id)}" style="--i:${i}" title="${esc(p.name)} is writing — click to go to the reply">${avatar(p, 22, {})}</button>`).join("");
    updateWorkingNow();
  }
  function updateWorkingNow() {
    const room = currentRoom();
    const buttons = [...workingNow.querySelectorAll(".wn-av")];
    if (!room || !buttons.length) return void (workingNow.hidden = true);
    const box = els.messages.getBoundingClientRect();
    let shown = 0;
    for (const b of buttons) {
      const draft = room.messages.find((x) => x.from === b.dataset.id && x.streaming);
      const el = draft && els.messages.querySelector(`.msg[data-id="${draft.id}"]`);
      let show = false;
      if (el) {
        const r = el.getBoundingClientRect();
        show = !(r.bottom > box.top && r.top < box.bottom);
      }
      b.hidden = !show;
      if (show) shown++;
    }
    workingNow.hidden = shown === 0;
  }
  workingNow.addEventListener("click", (e) => {
    const b = e.target.closest(".wn-av");
    const room = b && currentRoom();
    if (!room) return;
    const m = [...room.messages].reverse().find((x) => x.from === b.dataset.id && x.kind === "chat");
    const el = m && els.messages.querySelector(`.msg[data-id="${m.id}"]`);
    if (el && m.streaming) jumpToMessage(el);
    else scrollToBottom();
  });

  function lifeOf(p) {
    if (!p.contextSize) return (p.turns || 0) === 0 && !p.contextUsed ? { left: 100, tone: "fresh" } : { left: null, tone: "unknown" };
    const left = Math.max(0, Math.min(100, 100 - Math.round((100 * (p.contextUsed || 0)) / p.contextSize)));
    return { left, tone: left <= 20 ? "hot" : left <= 50 ? "warm" : "ok" };
  }
  function lifePathFor(r) {
    const s = 2.5, e = 49.5, mid = 26;
    r = Math.max(0, Math.min(23.5, r));
    const n = (v) => String(Math.round(v * 10) / 10);
    if (r < 0.5) return `M${mid} ${s}H${e}V${e}H${s}V${s}H${mid}`;
    const a = (x, y) => `A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y)}`;
    return `M${mid} ${s}H${n(e - r)}${a(e, s + r)}V${n(e - r)}${a(e - r, e)}H${n(s + r)}${a(s, e - r)}V${n(s + r)}${a(s + r, s)}H${mid}`;
  }
  function lifeRadius(av) {
    const cs = getComputedStyle(av.isConnected ? av : document.documentElement);
    const scale = parseFloat(cs.getPropertyValue("--r-scale"));
    const corner = parseFloat(cs.getPropertyValue("--face-corner"));
    return ((Number.isFinite(corner) ? corner : 0.32) * 44 + 4) * (Number.isFinite(scale) ? scale : 1);
  }
  function setLifePath(ring, av) {
    const d = lifePathFor(lifeRadius(av));
    if (ring.dataset.d === d) return;
    ring.querySelectorAll("path").forEach((path) => path.setAttribute("d", d));
    ring.dataset.d = d;
  }
  const LIFE_RING = `<svg class="life" viewBox="0 0 52 52" aria-hidden="true"><path class="life-track" pathLength="100"/><path class="life-arc" pathLength="100"/></svg>`;
  function patchLifeRing(li, p) {
    const av = li.querySelector(".avatar");
    if (!av) return;
    let ring = av.querySelector(".life");
    if (!ring) {
      av.insertAdjacentHTML("afterbegin", LIFE_RING);
      ring = av.querySelector(".life");
      av.classList.add("has-life");
    }
    setLifePath(ring, av);
    const { left, tone } = lifeOf(p);
    const cls = `life life-${tone}`;
    if (ring.getAttribute("class") !== cls) ring.setAttribute("class", cls);
    ring.querySelector(".life-arc").style.strokeDasharray = left === null ? "0 100" : `${left} 100`;
    const q = av.querySelector(".life-q");
    if (tone === "unknown" && !q) av.insertAdjacentHTML("beforeend", '<span class="life-q" title="This agent does not report its context">?</span>');
    else if (tone !== "unknown" && q) q.remove();
    const ev = recentContextEvent(p);
    av.classList.toggle("life-attn", !!ev && ev.kind !== "threshold");
    av.title = (tone === "fresh" ? "Context: fresh, nothing used yet." : tone === "unknown" ? (p.contextUsed ? `Context: ${fmtTokens(p.contextUsed)} tokens in use; this agent does not say how big its window is.` : "Context: not reported by this agent.") : `Context ${fmtTokens(p.contextUsed)} of ${fmtTokens(p.contextSize)} used · ${left} % left.`) + (ev ? ` ${contextEventText(p, ev)}.` : "") + " Click for details.";
  }
  const CONTEXT_EVENT_FRESH_MS = 15 * 60 * 1000;
  function recentContextEvent(p) {
    const ev = p.contextEvent;
    return ev && Date.now() - ev.at < CONTEXT_EVENT_FRESH_MS ? ev : null;
  }
  function contextEventText(p, ev) {
    const when = new Date(ev.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (ev.kind === "compacted") return `Compacted its context at ${when} (now ${fmtTokens(ev.used)})`;
    if (ev.kind === "full") return `Ran out of context at ${when}; respawned with memory`;
    return `Over 80 % since ${when}; leaves notes with its replies`;
  }
  let lifePop = null;
  let hoverTimer = null;
  function openLifePop(p, li, hover) {
    closeLifePop();
    const el = document.createElement("div");
    el.className = "life-pop";
    document.body.appendChild(el);
    lifePop = { id: p.id, anchor: li.querySelector(".avatar"), el, n: null, hover: !!hover };
    el.addEventListener("mouseenter", () => clearTimeout(hoverTimer));
    el.addEventListener("mouseleave", () => lifePop && lifePop.hover && scheduleHoverClose());
    renderLifePop();
  }
  function scheduleHoverClose() {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (lifePop && lifePop.hover && !lifePop.el.matches(":hover") && !lifePop.anchor.matches(":hover")) closeLifePop();
    }, 180);
  }
  els.participants.addEventListener("mouseover", (e) => {
    const av = e.target.closest("li[data-id] .avatar");
    const li = av && av.closest("li[data-id]");
    if (!av || (e.relatedTarget && av.contains(e.relatedTarget))) return;
    const room = currentRoom();
    const p = room && findById(room, li.dataset.id);
    if (!p || p.kind !== "agent" || p.status === "unstaffed") return;
    clearTimeout(hoverTimer);
    if (lifePop && lifePop.id === p.id) return;
    hoverTimer = setTimeout(() => {
      if (!lifePop || lifePop.hover) openLifePop(p, li, true);
    }, 220);
  });
  els.participants.addEventListener("mouseout", (e) => {
    const av = e.target.closest("li[data-id] .avatar");
    const li = av && av.closest("li[data-id]");
    if (!av || (e.relatedTarget && av.contains(e.relatedTarget))) return;
    clearTimeout(hoverTimer);
    if (lifePop && lifePop.hover && lifePop.id === li.dataset.id) scheduleHoverClose();
  });
  function closeLifePop() {
    if (!lifePop) return;
    lifePop.el.remove();
    lifePop = null;
  }
  function renderLifePop() {
    if (!lifePop) return;
    const room = currentRoom();
    const p = room && findById(room, lifePop.id);
    if (!p || state.view !== "room" || !lifePop.anchor.isConnected) return closeLifePop();
    const el = lifePop.el;
    if (el.contains(document.activeElement)) return;
    const { left, tone } = lifeOf(p);
    const last = [...room.messages].reverse().find((m) => m.from === p.id && m.usage);
    const n = lifePop.n ?? room.settings.replayAfterRestart ?? 10;
    el.innerHTML = `<div class="lp-main">
        <div class="lp-head">${avatar(p, 28, {})}<div><b>${esc(p.name)}</b><div class="lp-sub">${tone === "fresh" ? "fresh session: nothing used yet" : tone === "unknown" ? (p.contextUsed ? `context: ${fmtTokens(p.contextUsed)} tokens in use, window size not reported` : "context not reported by this agent") : `context ${fmtTokens(p.contextUsed)} of ${fmtTokens(p.contextSize)} used · <b>${left} % left</b>`}</div></div></div>
        <div class="life-bar life-${tone}"><i style="width:${left ?? 0}%"></i></div>
        ${p.contextEvent ? `<div class="lp-event${recentContextEvent(p) && p.contextEvent.kind !== "threshold" ? " fresh" : ""}">${ic("info")} ${esc(contextEventText(p, p.contextEvent))}</div>` : ""}
        <div class="kv lp-kv">
          <span>Turns</span><span>${p.turns}</span>
          <span>Last reply</span><span>${last ? `<span title="tokens in">${ic("arrow-down")} ${fmtTokens(last.usage.inputTokens)}</span> <span title="tokens out">${ic("arrow-up")} ${fmtTokens(last.usage.outputTokens)}</span>` : "—"}</span>
          <span>Cost (estimate)</span><span>${fmtCost(p.cost) || "—"}</span>
          <span>Briefs sent</span><span>${p.briefsSent ?? 0}</span>
          <span>Notes</span><span>${p.notes ? `taken at ${fmtTokens(p.notesAt || 0)} tokens` : "none yet"}${p.notesTurn ? ` · <span class="taking" title="The hidden turn is running; nothing is posted">taking notes<i></i><i></i><i></i></span>` : `${p.status === "offline" || p.status === "unstaffed" ? "" : ` · <button type="button" class="link-btn lp-take" title="A hidden turn: the vibemate writes 10 lines for a future restart; nothing is posted">${p.notes ? "refresh" : "take now"}</button>`}${p.notes ? ` · <button type="button" class="link-btn lp-edit">edit</button>` : ""}`}</span>
        </div>
        ${p.notes ? `<pre class="lp-notes">${esc(p.notes)}</pre><div class="lp-editor" hidden><textarea class="lp-notes-area" rows="6" maxlength="4000">${esc(p.notes)}</textarea><div class="row-btns">${UI.html("button", { label: "Clear", kind: "ghost", size: "sm", hook: "lp-notes-clear" })}${UI.html("button", { label: "Save", kind: "primary", size: "sm", hook: "lp-notes-save" })}</div></div>` : ""}
        ${vendorLoggedOut(p) ? `<div class="lp-respawn lp-login">${UI.html("button", { label: `Log in to ${p.agentVendor || "the vendor"}`, icon: "lock", kind: "primary", size: "sm", act: "open-login-dialog", data: { recipe: p.agentType, purpose: "login" } })}<span class="lp-sub">${esc(p.agentVendor || "The vendor")} is not logged in; a respawn would fail the same way.</span></div>` : `<div class="lp-respawn">
          ${UI.html("button", { label: "Respawn, empty head", icon: "bolt", kind: "danger", size: "sm", hook: "lp-empty", title: "A new session that knows nothing of this conversation" })}
          <label class="lp-with">${UI.html("button", { label: "Respawn with the last", size: "sm", hook: "lp-mem", title: `A new session that re-reads only the last N messages${p.notes ? " and its own notes" : ""}` })}${UI.html("number-field", { value: String(n), min: 0, max: 500, hook: "lp-n" })} messages</label>
        </div>`}
      </div>
      <div class="lp-side">${UI.html("icon-button", { icon: "close", title: "Close", size: "sm", hook: "lp-x" })}${UI.html("icon-button", { icon: "settings", title: "Open this vibemate's panel", size: "sm", hook: "lp-more" })}</div>`;
    el.querySelector(".lp-x").addEventListener("click", closeLifePop);
    el.querySelector(".lp-more").addEventListener("click", () => {
      closeLifePop();
      openDetails({ kind: "participant", id: p.id });
    });
    el.querySelector(".lp-empty")?.addEventListener("click", () => respawnWith(p, 0));
    el.querySelector(".lp-mem")?.addEventListener("click", () => respawnWith(p, Number(el.querySelector(".lp-n").value) || 0));
    el.querySelector(".lp-n")?.addEventListener("input", (e) => (lifePop.n = Number(e.target.value) || 0));
    el.querySelector('.lp-login [data-act="open-login-dialog"]')?.addEventListener("click", closeLifePop);
    const take = el.querySelector(".lp-take");
    if (take)
      take.addEventListener("click", async () => {
        take.disabled = true;
        take.textContent = "asking…";
        try {
          await post(roomApi(`/participants/${encodeURIComponent(p.id)}/take-notes`));
        } catch (e) {
          showError(e);
          renderLifePop();
        }
      });
    const edit = el.querySelector(".lp-edit");
    if (edit)
      edit.addEventListener("click", () => {
        el.querySelector(".lp-notes").hidden = true;
        el.querySelector(".lp-editor").hidden = false;
        el.querySelector(".lp-notes-area").focus();
      });
    const saveNotes = async (text) => {
      try {
        await post(roomApi(`/participants/${encodeURIComponent(p.id)}/notes`), { notes: text });
      } catch (e) {
        showError(e);
      }
      el.querySelector(".lp-notes-area").blur();
      renderLifePop();
    };
    const save = el.querySelector(".lp-notes-save");
    if (save) save.addEventListener("click", () => saveNotes(el.querySelector(".lp-notes-area").value));
    const clear = el.querySelector(".lp-notes-clear");
    if (clear) clear.addEventListener("click", () => saveNotes(""));
    const r = lifePop.anchor.getBoundingClientRect();
    el.style.left = `${Math.round(r.right + 12)}px`;
    el.style.top = `${Math.round(Math.max(8, Math.min(r.top - 10, window.innerHeight - el.offsetHeight - 8)))}px`;
  }
  async function respawnWith(p, n) {
    const text =
      n > 0
        ? `${p.name} starts over with a new session that gets only ${p.notes ? "its own notes and " : ""}the last ${n} messages of this room. You keep the history; the rest of its memory is gone.`
        : `${p.name} forgets this whole conversation and starts over. You keep the history; it does not.`;
    const ok = await confirmDialog(text, { title: `Respawn ${p.name}?`, okLabel: "Respawn", danger: true });
    if (!ok) return;
    closeLifePop();
    try {
      await post(roomApi(`/participants/${encodeURIComponent(p.id)}/respawn`), { memory: n > 0, replay: n });
    } catch (e) {
      showError(e);
    }
  }
  document.addEventListener("click", (e) => {
    if (lifePop && !e.target.closest(".life-pop") && !e.target.closest("#participants .avatar")) closeLifePop();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lifePop) closeLifePop();
  });

  const pinsBtn = $("#pins-btn");
  const pinsPanel = $("#pins-panel");
  function pinnedMessages(room) {
    return room.messages.filter((m) => m.pinned && m.kind === "chat").sort((a, b) => a.seq - b.seq);
  }
  function renderPins() {
    const room = currentRoom();
    const pins = room && state.view === "room" ? pinnedMessages(room) : [];
    pinsBtn.hidden = pins.length === 0;
    pinsBtn.innerHTML = `${ic("pin")} Pinned · ${pins.length}`;
    if (!pins.length) pinsPanel.hidden = true;
    if (pinsPanel.hidden) return;
    pinsPanel.innerHTML = pins
      .map((m) => {
        const p = findById(room, m.from);
        const who = m.from === "human" ? Object.assign(meAvatarData(), { color: (p || {}).color }) : p;
        const text = String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 160) || (m.images && m.images.length ? `[${m.images.length} image${m.images.length === 1 ? "" : "s"}]` : "");
        return `<div class="tl-row pin-row${m.from === "human" ? " mine" : ""}" data-id="${esc(m.id)}"><span class="tl-av">${who ? avatar(who, 16, {}) : ""}</span><span class="tl-text">${esc(text)}</span><span class="pin-time">${time(m.ts)}</span><button type="button" class="pin-x" title="Unpin">×</button></div>`;
      })
      .join("");
  }
  pinsBtn.addEventListener("click", () => {
    pinsPanel.hidden = !pinsPanel.hidden;
    renderPins();
  });
  pinsPanel.addEventListener("click", async (e) => {
    const row = e.target.closest(".pin-row");
    const room = currentRoom();
    if (!row || !room) return;
    if (e.target.closest(".pin-x")) {
      try {
        await post(`/api/rooms/${encodeURIComponent(room.id)}/messages/${encodeURIComponent(row.dataset.id)}/pin`, { pinned: false });
      } catch (error) {
        showError(error);
      }
      return;
    }
    jumpToMessage(els.messages.querySelector(`.msg[data-id="${row.dataset.id}"]`));
    pinsPanel.hidden = true;
  });
  document.addEventListener("click", (e) => {
    if (!pinsPanel.hidden && !e.target.closest("#pins-panel, #pins-btn")) pinsPanel.hidden = true;
  });

  const fp = { onChoose: null, selected: "", roots: [], home: "" };
  const fpEls = { dialog: $("#folder-dialog"), path: $("#fp-path"), tree: $("#fp-tree"), recent: $("#fp-recent"), error: $("#fp-error"), selected: $("#fp-selected"), choose: $("#fp-choose"), home: $("#fp-home"), newBtn: $("#fp-new") };
  const sepOf = (p) => (p.includes("\\") || /^[A-Za-z]:/.test(p) ? "\\" : "/");
  const sameFolder = (a, b) => a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
  const isUnder = (child, parent) => {
    const c = child.replace(/[\\/]+$/, "").toLowerCase();
    const p = parent.replace(/[\\/]+$/, "").toLowerCase();
    return c === p || c.startsWith(p + sepOf(parent)) || (parent.endsWith(sepOf(parent)) && c.startsWith(p + sepOf(parent)));
  };
  function fpFail(error) {
    fpEls.error.textContent = error.message || String(error);
    fpEls.error.hidden = false;
  }
  function fpNode(entry) {
    const li = document.createElement("li");
    li.dataset.path = entry.path;
    li.innerHTML = `<div class="tn${entry.hidden ? " hidden-dir" : ""}"><button type="button" class="tn-tw" title="Expand">${ic("forward")}</button><span class="tn-ico">📁</span><span class="tn-name">${esc(entry.name)}</span></div><ul hidden></ul>`;
    return li;
  }
  function fpSelect(path, li) {
    fp.selected = path;
    fpEls.tree.querySelectorAll(".tn.selected").forEach((el) => el.classList.remove("selected"));
    if (li) li.querySelector(":scope > .tn").classList.add("selected");
    fpEls.path.value = path;
    fpEls.selected.textContent = path;
    fpEls.error.hidden = true;
  }
  async function fpLoad(li) {
    const ul = li.querySelector(":scope > ul");
    if (li.dataset.loaded) return ul;
    const data = await get(`/api/fs/dirs?path=${encodeURIComponent(li.dataset.path)}`);
    ul.innerHTML = "";
    for (const d of data.dirs) ul.appendChild(fpNode(d));
    if (!data.dirs.length) ul.innerHTML = `<li class="tn-more">no sub-folders</li>`;
    li.dataset.loaded = "1";
    li.querySelector(":scope > .tn").classList.toggle("leaf", !data.dirs.length);
    return ul;
  }
  async function fpExpand(li, open) {
    const tn = li.querySelector(":scope > .tn");
    const ul = li.querySelector(":scope > ul");
    const want = open === undefined ? ul.hidden : open;
    if (!want) {
      ul.hidden = true;
      tn.classList.remove("open");
      return;
    }
    tn.classList.add("open");
    try {
      await fpLoad(li);
      ul.hidden = false;
    } catch (e) {
      tn.classList.remove("open");
      fpFail(e);
    }
  }
  async function fpReveal(path) {
    const target = path.replace(/[\\/]+$/, "") || path;
    let level = fpEls.tree;
    let found = null;
    for (let guard = 0; guard < 64; guard++) {
      const li = [...level.children].find((el) => el.dataset && el.dataset.path && isUnder(target, el.dataset.path));
      if (!li) break;
      found = li;
      if (sameFolder(li.dataset.path, target)) break;
      await fpExpand(li, true);
      level = li.querySelector(":scope > ul");
    }
    if (found && sameFolder(found.dataset.path, target)) {
      fpSelect(found.dataset.path, found);
      found.scrollIntoView({ block: "center" });
      return true;
    }
    return false;
  }
  async function fpGoTo(typed) {
    const p = typed.trim();
    if (!p) return;
    try {
      const data = await get(`/api/fs/dirs?path=${encodeURIComponent(p)}`);
      if (!(await fpReveal(data.path))) fpSelect(data.path, null);
    } catch (e) {
      fpFail(e);
    }
  }
  function fpRecent() {
    const dirs = [];
    for (const room of state.rooms.values()) if (room.dir && !dirs.some((d) => sameFolder(d, room.dir))) dirs.push(room.dir);
    fpEls.recent.innerHTML = "";
    for (const d of dirs.slice(0, 6)) {
      const b = UI.el("choice", { label: d.split(/[\\/]/).filter(Boolean).slice(-1)[0] || d, title: d });
      b.addEventListener("click", () => fpGoTo(d));
      fpEls.recent.appendChild(b);
    }
  }
  async function openFolderPicker(initial, onChoose) {
    fp.onChoose = onChoose;
    fpEls.error.hidden = true;
    fpEls.tree.innerHTML = `<li class="tn-more">loading…</li>`;
    fpSelect("", null);
    openDialog(fpEls.dialog);
    try {
      const data = await get("/api/fs/dirs");
      fp.roots = data.roots;
      fp.home = data.home;
      fpEls.tree.innerHTML = "";
      for (const r of data.roots) fpEls.tree.appendChild(fpNode(r));
      fpRecent();
      const start = (initial || "").trim() || data.home;
      await fpGoTo(start);
      fpEls.path.focus();
    } catch (e) {
      fpFail(e);
    }
  }
  fpEls.tree.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-path]");
    if (!li) return;
    if (e.target.closest(".tn-tw")) return void fpExpand(li);
    fpSelect(li.dataset.path, li);
  });
  fpEls.tree.addEventListener("dblclick", (e) => {
    const li = e.target.closest("li[data-path]");
    if (li && !e.target.closest(".tn-tw")) fpExpand(li);
  });
  fpEls.path.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      fpGoTo(fpEls.path.value);
    }
  });
  fpEls.home.addEventListener("click", () => fpGoTo(fp.home));
  fpEls.newBtn.addEventListener("click", async () => {
    const li = fpEls.tree.querySelector(".tn.selected")?.closest("li[data-path]");
    if (!li) return fpFail(new Error("select the folder to create it in first"));
    await fpExpand(li, true);
    const ul = li.querySelector(":scope > ul");
    if (ul.querySelector(".tn-new")) return;
    const row = document.createElement("li");
    row.className = "tn-new";
    row.innerHTML = `<span class="tn-ico">📁</span><input type="text" placeholder="folder name" maxlength="120">`;
    ul.prepend(row);
    const input = row.querySelector("input");
    input.focus();
    const done = async () => {
      const name = input.value.trim();
      row.remove();
      if (!name) return;
      try {
        const r = await post("/api/fs/mkdir", { parent: li.dataset.path, name });
        delete li.dataset.loaded;
        await fpExpand(li, true);
        await fpReveal(r.path);
      } catch (err) {
        fpFail(err);
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        done();
      } else if (e.key === "Escape") {
        e.preventDefault();
        row.remove();
      }
    });
    input.addEventListener("blur", () => setTimeout(() => row.isConnected && done(), 120));
  });
  fpEls.choose.addEventListener("click", () => {
    const chosen = fp.selected || fpEls.path.value.trim();
    if (!chosen) return fpFail(new Error("pick a folder first"));
    closeDialog(fpEls.dialog);
    if (fp.onChoose) fp.onChoose(chosen);
  });
  $("#room-dir-browse").addEventListener("click", () => openFolderPicker(els.roomDir.value, (dir) => (els.roomDir.value = dir)));

  if (window.matchMedia("(display-mode: standalone)").matches) {
    const placement = () => ({
      left: window.screenX,
      top: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight,
      maximized: window.outerWidth >= screen.availWidth - 2 && window.outerHeight >= screen.availHeight - 2,
      screen: { left: screen.availLeft, top: screen.availTop, width: screen.availWidth, height: screen.availHeight },
    });
    const minimized = (p) => p.left <= -30000 || p.top <= -30000 || p.width < 100 || p.height < 100;
    const overlaps = (p) => p.left < p.screen.left + p.screen.width - 40 && p.left + p.width > p.screen.left + 40 && p.top < p.screen.top + p.screen.height - 40 && p.top + p.height > p.screen.top;
    const first = placement();
    if (!minimized(first) && !overlaps(first)) {
      window.resizeTo(Math.min(first.width, first.screen.width), Math.min(first.height, first.screen.height));
      window.moveTo(first.screen.left, first.screen.top);
    }
    let lastReport = "";
    let reportTimer = null;
    const report = (keepalive) => {
      const p = placement();
      if (minimized(p)) return;
      const json = JSON.stringify(p);
      if (json === lastReport) return;
      lastReport = json;
      fetch("/api/window", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: json, keepalive }).catch(() => {});
    };
    const scheduleReport = () => {
      clearTimeout(reportTimer);
      reportTimer = setTimeout(() => report(false), 800);
    };
    window.addEventListener("resize", scheduleReport);
    setInterval(scheduleReport, 3000);
    window.addEventListener("pagehide", () => report(true));
  }

  setInterval(tickLive, 1000);

  connect();
})();
