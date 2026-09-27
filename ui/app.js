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
    dataFolder: null,
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
    watched: new Set(),
    skillEditor: null,
    skillsRoom: null,
    voice: null,
  };

  const UI_ZOOM_BASE = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
  let Layout = VIBEROOM_LAYOUT.create(parseFloat(getComputedStyle(document.documentElement).zoom) || 1);
  const agentUpdates = VIBEROOM_AGENT_UPDATES.create({
    post: (...args) => post(...args), recipes: () => state.recipes,
    onStatus: text => { const el = document.getElementById("sp-agent-update-status"); if (el) el.textContent = text; },
    onError: error => showError(error),
    onChange: () => { if (document.querySelector("#invite-dialog")?.open) renderInviteTiles(); },
  });

  const $ = (selector) => document.querySelector(selector);
  const els = {
    app: $("#app"),
    noKey: $("#no-key"),
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
    fvGoto: $(".fv-goto"),
    fvWrapBox: $(".fv-wrap"),
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
    inviteBtn: $("#invite-btn"),
    roster: $("#roster"),
    participantsMe: $("#participants-me"),
    sideRoomCount: $("#side-room-count"),
    participants: $("#participants"),
    reconnectAllBtn: $("#reconnect-all-btn"),
    focusBtn: $("#focus-btn"),
    homeView: $("#home-view"),
    roomsView: $("#rooms-view"),
    roomsGrid: $("#rooms-grid"),
    roomsSub: $("#rooms-sub"),
    chatView: $("#chat-view"),
    chatRoomSub: $("#chat-room-sub"),
    chatInfoBtn: $("#chat-info-btn"),
    carryBtn: $("#carry-btn"),
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
    roomOptions: $("#room-options"),
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
    secretDialog: $("#secret-dialog"),
    sdBody: $("#sd-body"),
    setupDialog: $("#setup-dialog"),
    suBody: $("#su-body"),
    rcSubmit: $("#rc-submit"),
    eraseDialog: $("#erase-dialog"),
    eraseForm: $("#erase-form"),
    eraseWord: $("#erase-word"),
    eraseError: $("#erase-error"),
    eraseSubmit: $("#erase-submit"),
  };
  const composer = Composer.attach(els.input, {
    resolveToken: (kind, n) => composerToken(kind, n),
    resolveMention: (name) => composerMention(name),
    onText: (text) => reconcileAttachments(text),
    onChange: () => composerChanged(),
    onPaste: (e) => pasteIntoComposer(e),
  });

  const reader = VIBEROOM_READER.create({
    fetchSpeech: async (text, signal) => {
      const res = await fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ text }), signal: AbortSignal.any([signal, deadline(75_000)]) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      return res.blob();
    },
    onChange: (key, st, error) => {
      drawReading(key, st);
      if (error) toast(error.message, "warn");
    },
  });
  window.speechSynthesis?.addEventListener?.("voiceschanged", () => { if (state.view === "settings" && $("#sp-read-voice")) renderSettingsPage(); });

  $("#voice-panel .vp-acts").innerHTML = UI.html("button", { label: "Cancel", kind: "ghost", size: "sm", title: "Let the recording go (Esc)", data: { vp: "cancel" } })
    + UI.html("button", { label: "Stop", icon: "stop", kind: "secondary", size: "sm", title: "Stop, and the words go into the field", data: { vp: "stop" } })
    + UI.html("button", { label: "Send as voice", icon: "send", kind: "primary", size: "sm", title: "Send the recording itself as a voice message", data: { vp: "send" } });
  const voiceControl = VIBEROOM_VOICE.attach({
    onListen: () => reader.stop(),
    button: $("#mic-btn"),
    panel: $("#voice-panel"),
    readiness: () => state.voice?.ready ? { ready: true } : { ready: false, reason: `${state.voice?.reason || "No provider is chosen yet"}: Settings → Voice.`, almost: almostOn(state.voice) },
    openSettings: () => openSettings("voice"),
    transcribe: async (recording) => (await post("/api/voice/transcribe", { ...recording, room: currentRoom()?.id })).text,
    insert: (text) => {
      const start = composer.selectionStart, end = composer.selectionEnd, value = composer.value;
      const before = value.slice(0, start), after = value.slice(end);
      composer.setRangeText(`${before && !/\s$/.test(before) ? " " : ""}${text}${after && !/^\s/.test(after) ? " " : ""}`, start, end, "end");
      composer.focus();
    },
    sendRecording: (recording) => {
      const item = { name: "voice message", mimeType: recording.mimeType, url: URL.createObjectURL(recording.blob), seconds: recording.seconds };
      if (addTimed("audio", item)) sendToRoom(item, recording.blob, "audio");
      els.composer.requestSubmit();
    },
    say: (text) => toast(text, "warn"),
  });

  const slowTasks = [];
  function busyLabel() {
    try {
      const room = currentRoom();
      const parts = [];
      const streaming = room ? room.messages.filter((m) => m.streaming).length : 0;
      if (streaming) parts.push(`${streaming} reply streaming`);
      if (document.activeElement === els.input) parts.push("composer focused");
      if (room) parts.push(`${HistoryWindow.count(room)} messages`);
      return parts.join(" \u00b7 ");
    } catch {
      return "";
    }
  }
  function noteSlow(name, ms) {
    if (blankWatch.since && blankWatch.redraws.length < 6 && !name.startsWith("browser task") && /render|drawn|caught up|streamed/.test(name)) blankWatch.redraws.push(name);
    if (!(ms >= 8)) return;
    slowTasks.push({ at: Date.now(), ms: Math.round(ms), name, busy: busyLabel() });
    if (slowTasks.length > 60) slowTasks.splice(0, slowTasks.length - 40);
  }
  function noteFinding(name) {
    slowTasks.push({ at: Date.now(), ms: 0, name, busy: busyLabel() });
    if (slowTasks.length > 60) slowTasks.splice(0, slowTasks.length - 40);
  }

  const BLANK_MIN_PX = 250;
  const blankWatch = { since: 0, scrolled: false, redraws: [], clear: 1, wired: false };
  function measureBlank() {
    const list = els.messages;
    if (!list) return null;
    const b = Layout.rect(list);
    if (!b.height) return null;
    const painted = [];
    const unpainted = [];
    const near = new Set();
    const pages = [];
    for (const page of list.querySelectorAll(".msgs-page")) {
      const pr = Layout.rect(page);
      if (pr.bottom < b.top || pr.top > b.bottom) continue;
      near.add(page);
      const inside = page.firstElementChild;
      const shown = inside && typeof inside.checkVisibility === "function" ? inside.checkVisibility({ contentVisibilityAuto: true }) : true;
      if (pages.length < 3) pages.push({ h: Math.round(pr.height), kids: page.children.length, skipped: !shown });
    }
    for (const e of list.querySelectorAll(".msg")) {
      const page = e.parentElement;
      if (page && page.classList.contains("msgs-page") && !near.has(page)) continue;
      const r = Layout.rect(e);
      if (r.bottom < b.top || r.top > b.bottom) continue;
      const ok = typeof e.checkVisibility === "function" ? e.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }) : true;
      const ink = e.querySelector(".bubble") || (e.classList.contains("system") || e.classList.contains("hidden") ? e.firstElementChild : null);
      const br = ink && Layout.rect(ink);
      if (ok && br && br.height > 0) painted.push([Math.max(br.top, b.top), Math.min(br.bottom, b.bottom)]);
      else if (unpainted.length < 5) unpainted.push({ seq: e.dataset.seq || "", cls: e.className, h: Math.round(r.height), op: getComputedStyle(e).opacity, skipped: !ok, ...animationOf(e) });
    }
    painted.sort((x, y) => x[0] - y[0]);
    let gap = 0;
    let gapAt = b.top;
    let cover = b.top;
    for (const [top, bottom] of painted) {
      if (top - cover > gap) {
        gap = top - cover;
        gapAt = cover;
      }
      cover = Math.max(cover, bottom);
    }
    if (b.bottom - cover > gap) {
      gap = b.bottom - cover;
      gapAt = cover;
    }
    const under = gap > 40 ? document.elementsFromPoint(Math.round(b.left + b.width / 2), Math.round(gapAt + gap / 2)).slice(0, 5).map((e) => `${e.tagName}.${(e.className || "").toString().split(" ")[0] || ""}`) : [];
    return { blankPx: Math.round(gap), blankTop: Math.round(gapAt - b.top), listPx: Math.round(b.height), scrollTop: Math.round(list.scrollTop), painted: painted.length, unpainted, pages, under, msgs: list.querySelectorAll(".msg").length };
  }
  function animationOf(el) {
    try {
      const run = typeof el.getAnimations === "function" ? el.getAnimations()[0] : null;
      if (!run) return { anim: "none" };
      return { anim: String(run.playState), animAt: Math.round(Number(run.currentTime) || 0) };
    } catch {
      return { anim: "unknown" };
    }
  }

  function reportBlank(stage, extra) {
    const room = currentRoom();
    if (!room || !blankWatch.facts) return;
    void post("/api/window/finding", {
      kind: "blank-fragment",
      roomId: room.id,
      since: blankWatch.since,
      stage,
      ...blankWatch.facts,
      ...extra,
    }).catch(() => {});
  }
  function watchBlank() {
    if (!els.messages) return;
    if (!blankWatch.wired) {
      blankWatch.wired = true;
      els.messages.addEventListener("scroll", () => { if (blankWatch.since) blankWatch.scrolled = true; }, { passive: true });
    }
    if (document.hidden || state.view !== "room") return;
    const facts = measureBlank();
    if (!facts) return;
    const blank = facts.blankPx > BLANK_MIN_PX && facts.blankPx > facts.listPx / 3;
    if (blank && !blankWatch.since && blankWatch.clear > 0) {
      blankWatch.since = Date.now();
      blankWatch.scrolled = false;
      blankWatch.redraws = [];
      const room = currentRoom();
      blankWatch.facts = { ...facts, streaming: !!room && room.messages.some((m) => m.streaming) };
      noteFinding(`blank fragment began: ${JSON.stringify(blankWatch.facts)}`);
      reportBlank("began", {});
    } else if (!blank && blankWatch.since) {
      const seconds = Math.round((Date.now() - blankWatch.since) / 1000);
      noteFinding(`blank fragment ended after ${seconds} s: ${blankWatch.scrolled ? "a scroll came in between" : "no scroll"}; redraws in between: ${blankWatch.redraws.join(" | ") || "none"}`);
      reportBlank("ended", { seconds, scrolled: blankWatch.scrolled, redraws: blankWatch.redraws.slice(0, 8) });
      blankWatch.since = 0;
      blankWatch.clear = 0;
    } else if (!blank) blankWatch.clear++;
  }
  setInterval(watchBlank, 3000);
  const LONG_FRAMES = typeof PerformanceObserver === "function" && (PerformanceObserver.supportedEntryTypes || []).includes("long-animation-frame");
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) noteSlow(`browser task${LONG_FRAMES ? heldBy(e) : ""}`, e.duration);
    }).observe({ entryTypes: [LONG_FRAMES ? "long-animation-frame" : "longtask"] });
  } catch {
  }
  function heldBy(entry) {
    const script = [...(entry.scripts || [])].sort((a, b) => b.duration - a.duration)[0];
    const before = entry.renderStart ? Math.max(0, Math.round(entry.renderStart - entry.startTime)) : Math.round(entry.duration);
    const after = Math.max(0, Math.round(entry.duration) - before);
    const named = script ? [script.sourceFunctionName || script.invoker, String(script.sourceURL || "").split(/[/\\]/).pop()].filter(Boolean).join(" in ") : "";
    const forced = Math.round([...(entry.scripts || [])].reduce((sum, s) => sum + (s.forcedStyleAndLayoutDuration || 0), 0));
    const blocking = entry.blockingDuration >= 1 ? `, ${Math.round(entry.blockingDuration)} ms blocking` : "";
    return ` · ${before} ms script${named ? ` in ${named}` : ""}${forced >= 1 ? ` (${forced} ms of it forced layout)` : ""}, ${after} ms style & paint${blocking}`;
  }

  const bursts = new Map();
  let burstTimer = 0;
  function noteBurst(kind, ms) {
    const seen = bursts.get(kind) || { times: 0, total: 0, worst: 0 };
    seen.times++;
    seen.total += ms;
    seen.worst = Math.max(seen.worst, ms);
    bursts.set(kind, seen);
    clearTimeout(burstTimer);
    burstTimer = setTimeout(flushBursts, 400);
  }
  function flushBursts() {
    for (const [kind, seen] of bursts) {
      noteSlow(seen.times === 1 ? `hub said ${kind}` : `hub said ${kind} ×${seen.times} (worst ${Math.round(seen.worst)} ms)`, seen.total);
    }
    bursts.clear();
  }

  const FONTS = globalThis.VIBEROOM_TOKENS.fonts;
  const STATUS_LABEL = { unstaffed: "needs a coding agent", starting: "starting…", idle: "ready", queued: "waiting…", thinking: "thinking…", working: "vibing…", writing: "vibing…", notes: "taking notes…", error: "needs you", offline: "offline", left: "left" };
  const STATUS_TONE = { idle: "ready", queued: "waiting", starting: "waiting", thinking: "thinking", working: "writing", writing: "writing", notes: "outline", error: "attention", offline: "asleep", left: "asleep", unstaffed: "attention" };
  const TOOL_STATUSES = new Set(["pending", "in_progress", "completed", "failed"]);
  const TOKENS = globalThis.VIBEROOM_TOKENS;
  const FALLBACK_COLOR = () => TOKENS.active().elements.face.fallback;
  const colourOf = (p) => window.Avatars.castColour(p);
  const WORKING_SVG = '<span class="working-box">'
    + '<svg class="working body" viewBox="0 0 44 35" aria-hidden="true"><circle cx="20" cy="6.5" r="5.6" fill="currentColor"/><path d="M6 35L13.7 16.5a4 4 0 0 1 8 0L14 35z" fill="currentColor"/></svg>'
    + '<svg class="working arm far" viewBox="0 0 44 35" aria-hidden="true"><path d="M22 25.6h10.5" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round"/></svg>'
    + '<svg class="working still" viewBox="0 0 44 35" aria-hidden="true"><path d="M19 19.5L23 27" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round"/></svg>'
    + '<svg class="working arm near" viewBox="0 0 44 35" aria-hidden="true"><path d="M23 27h10.5" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round"/></svg>'
    + '<svg class="working still" viewBox="0 0 44 35" aria-hidden="true" title="working…"><rect x="26" y="30.2" width="15.5" height="3" rx="1" fill="currentColor"/><path d="M35.9 30.2L41.1 14h2.4l-5.1 16.2z" fill="currentColor"/></svg>'
    + '</span>';
  const THINKING_DOTS = '<span class="pending" title="thinking…"><i></i><i></i><i></i></span>';

  function rawShownStatus(room, p) {
    if (p.status !== "thinking") return p.status;
    if (p.notesTurn) return "notes";
    const draft = room.messages.find((m) => m.streaming && m.from === p.id);
    if (!draft) return "thinking";
    if ((draft.toolCalls || []).some((c) => c.status === "pending" || c.status === "in_progress")) return "working";
    return draft.text ? "writing" : "thinking";
  }
  const SHOWN_HOLD_MS = 1000;
  const shownHold = new Map();
  function shownStatus(room, p) {
    const raw = rawShownStatus(room, p);
    if (raw !== "thinking" && raw !== "working" && raw !== "writing") { shownHold.delete(p.id); return raw; }
    const now = Date.now();
    const held = shownHold.get(p.id);
    if (!held || raw === "working" || raw === held.status) { shownHold.set(p.id, { status: raw, candidate: null, since: now }); return raw; }
    if (held.candidate !== raw) { held.candidate = raw; held.since = now; }
    const left = SHOWN_HOLD_MS - (now - held.since);
    if (left > 0) { scheduleRosterRedraw(left + 50); return held.status; }
    shownHold.set(p.id, { status: raw, candidate: null, since: now });
    return raw;
  }
  function bubbleWorking(room, m) {
    const p = findById(room, m.from);
    const shown = p && p.kind === "agent" ? shownStatus(room, p) : null;
    if (shown === "working" || shown === "writing") return true;
    if (shown === "thinking" || shown === "notes") return false;
    return !!(m.text || (m.toolCalls && m.toolCalls.length));
  }
  function stopNoteText(m) {
    if (m.cancelledBy === "room") return m.text ? "viberoom stopped during this turn" : "viberoom stopped before this turn wrote anything";
    if (m.cancelledBy === "agent") return m.text ? "The agent ended this turn; nobody here stopped it" : "The agent ended this turn before it wrote anything";
    if (!m.stoppedBy) return m.text ? "This turn was cut short" : "This turn was cut short before it wrote anything";
    return m.text ? `Stopped by ${m.stoppedBy}` : `Stopped by ${m.stoppedBy} before it wrote anything`;
  }
  function failNoteText(m) {
    return m.text ? `The turn failed after this: ${m.failed}` : `The turn failed before it wrote anything: ${m.failed}`;
  }
  function refreshLiveTails() {
    const room = currentRoom();
    if (!room) return;
    const byId = new Map(HistoryWindow.knownMessages(room).map((m) => [m.id, m]));
    for (const tail of els.messages.querySelectorAll(".msg[data-id] .live-tail")) {
      const m = byId.get(tail.closest(".msg").dataset.id);
      if (m && m.streaming) tail.classList.toggle("no-figure", !bubbleWorking(room, m));
    }
  }
  let rosterRedrawTimer = null;
  let rosterRedrawAt = 0;
  function scheduleRosterRedraw(ms) {
    const at = Date.now() + ms;
    if (rosterRedrawTimer && at >= rosterRedrawAt) return;
    if (rosterRedrawTimer) clearTimeout(rosterRedrawTimer);
    rosterRedrawAt = at;
    rosterRedrawTimer = setTimeout(() => { rosterRedrawTimer = null; renderSideRoom(); refreshLiveTails(); }, ms);
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
  const CLAMP_PREFIX_CHARS = 1200;
  function clampedSource(text) {
    if (!text || text.length <= CLAMP_PREFIX_CHARS) return text;
    const paragraph = text.lastIndexOf("\n\n", CLAMP_PREFIX_CHARS);
    let head = text.slice(0, paragraph > CLAMP_PREFIX_CHARS / 2 ? paragraph : CLAMP_PREFIX_CHARS);
    if (!head.endsWith("\n") && head.slice(head.lastIndexOf("\n") + 1).trimStart().startsWith("|")) head = head.slice(0, head.lastIndexOf("\n") + 1);
    const lines = head.split("\n");
    let end = lines.length;
    while (end > 0 && !lines[end - 1].trim()) end--;
    let from = end;
    while (from > 0 && lines[from - 1].trimStart().startsWith("|")) from--;
    const table = lines.slice(from, end);
    if (table.length && !table.some((line) => /^\s*\|[\s:|-]+\|\s*$/.test(line))) head = lines.slice(0, from).join("\n");
    if ((head.match(/^```/gm) || []).length % 2) head += "\n```";
    return head;
  }

  window.Icons.install();
  window.Icons.playOnHover(document);
  const ic = (name, cls) => window.Icons.svg(name, cls);
  const rig = (name, cls) => window.Icons.rig(name, cls);
  document.querySelectorAll("[data-icon]").forEach((el) => (el.innerHTML = ic(el.dataset.icon)));
  document.querySelectorAll("[data-rig]").forEach((el) => (el.innerHTML = rig(el.dataset.rig)));


  let stallNoticeAt = 0;
  function stallWatch(promise) {
    const timer = setTimeout(() => {
      if (Date.now() - stallNoticeAt > 30000) {
        stallNoticeAt = Date.now();
        toast("Still waiting for the room… It may be busy or restarting; this window reconnects on its own.", "warn");
      }
    }, 8000);
    return promise.finally(() => clearTimeout(timer));
  }
  const ROOM_DEADLINE_MS = 60000;
  const deadline = (ms) => AbortSignal.timeout(ms || ROOM_DEADLINE_MS);
  let resyncedAt = 0;
  function stoppedWaiting(error) {
    if (!error || (error.name !== "TimeoutError" && error.name !== "AbortError")) return error;
    if (Date.now() - resyncedAt > 2000) {
      resyncedAt = Date.now();
      resyncStream();
    }
    return new Error("The room did not answer in time, so this window stopped waiting and read the room again. If what you asked for went through, it is already here.");
  }
  async function post(path, body, options) {
    let res;
    try {
      res = await stallWatch(fetch(path, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body || {}), signal: deadline(options && options.deadline) }));
    } catch (error) {
      throw stoppedWaiting(error);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  async function get(path, options) {
    let res;
    try {
      res = await fetch(path, { signal: deadline(options && options.deadline) });
    } catch (error) {
      throw stoppedWaiting(error);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.error || `HTTP ${res.status}`);
      error.status = res.status;
      error.code = data.code;
      throw error;
    }
    return data;
  }
  const roomApi = (suffix) => `/api/rooms/${encodeURIComponent(state.currentRoomId)}${suffix}`;
  function uploadFile(roomId, blob, { as, name, type }, onProgress = () => {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const query = new URLSearchParams({ as, name: name || "", type: type || blob.type || "" });
      xhr.open("POST", `/api/rooms/${encodeURIComponent(roomId)}/files?${query}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      let shown = -1;
      xhr.upload.addEventListener("progress", (e) => {
        if (!e.lengthComputable) return;
        const percent = Math.floor((e.loaded / e.total) * 100);
        if (percent !== shown) onProgress((shown = percent));
      });
      xhr.addEventListener("load", () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || "{}"); } catch { }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `HTTP ${xhr.status}`));
      });
      xhr.addEventListener("error", () => reject(new Error(`${name || "the file"} could not be sent to the room`)));
      xhr.addEventListener("abort", () => reject(new Error(`sending ${name || "the file"} was stopped`)));
      xhr.send(blob);
    });
  }


  function esc(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function hoverDelayMs(slow) {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(slow ? "--hover-delay-slow" : "--hover-delay"));
    return Number.isFinite(v) ? v : 0;
  }
  VIBEROOM_HINTS.install({ layout: Layout, delayMs: () => hoverDelayMs(true) });
  VIBEROOM_CONTEXT_MENU.install();
  VIBEROOM_SAVE.install({ onError: (error) => showError(error) });
  function editingInDetails() {
    const el = document.activeElement;
    const typing = !!el && !!el.closest && (!!el.closest("#details") || !!el.closest("#page-view")) && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    return typing || !!document.querySelector('#details [data-ui="setting"] > .fold:not([hidden]), #page-view [data-ui="setting"] > .fold:not([hidden])');
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
  const OPEN_RE = /<code>([^<]+)<\/code>|(?:https?:\/\/|mailto:)[^\s<>"'`]+|(?<![\w:\/.])((?:(?:[A-Za-z]:[\\/]|~[\\/])[^\s<>"'`*?|&:]|\/[^\s<>"'`*?|&:\/])[^<>"'`*?|&:\n]*?\.[A-Za-z0-9]{1,8}(?::\d+(?:-\d+)?)?(?=$|[\s,;:!?)\]<»]|\.(?:\s|$))|(?:[A-Za-z]:[\\/]|~[\\/])[^\s<>"'`*?|&]+|\/(?:[\w.@-]+\/)+[\w.@-][^\s<>"'`*?|&]*)/g;
  const CODE_PATH_RE = /^(?:[A-Za-z]:[\\/]|~[\\/]|\/)[^<>"'`*?|&\n]+$/;
  function openLink(target, isUrl) {
    return `<a class="open-link" data-open="${target}" href="#" title="${isUrl ? "Open in your browser" : "Open with the default app"}">${target}</a>`;
  }
  function linkify(html) {
    return html.replace(OPEN_RE, (m, code) => {
      if (code !== undefined) return CODE_PATH_RE.test(code.trim()) ? `<code>${openLink(code.trim(), false)}</code>` : `<code>${linkify(code)}</code>`;
      const trail = (m.match(/[.,;:!?)\]]+$/) || [""])[0];
      const target = m.slice(0, m.length - trail.length);
      const isUrl = /^(https?:|mailto:)/i.test(target);
      return openLink(target, isUrl) + trail;
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
  function mentions(room, html, addressed = []) {
    return html.replace(/(?<![\w.\/:])@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu, (m, name) => {
      if (name.toLowerCase() === "all") return `<span class="mention all">@${esc(name)}</span>`;
      const lower = name.toLowerCase();
      const meant = addressed.length ? room.participants.find((x) => addressed.includes(x.id) && [x.name, ...(x.formerNames || [])].some((n) => n.toLowerCase() === lower)) : null;
      const p = meant || findByName(room, name);
      return p ? `<span class="mention" style="color:${colourOf(p)}">@${esc(name)}</span>` : m;
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
        {
          name: "windowsPath",
          level: "inline",
          start(src) {
            return src.search(/(?:[A-Za-z]:\\|~\\)/);
          },
          tokenizer(src) {
            if (!/^(?:[A-Za-z]:\\|~\\)/.test(src)) return;
            const match = new RegExp(OPEN_RE.source).exec(src);
            if (match && match.index === 0) return { type: "windowsPath", raw: match[0], text: match[0] };
          },
          renderer(token) {
            return esc(token.text);
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
  function decorate(room, html, addressed) {
    let inside = 0;
    let out = "";
    for (const part of html.split(/(<[^>]*>)/)) {
      if (!part) continue;
      if (part[0] === "<") {
        const m = /^<(\/?)(pre|a)\b/i.exec(part);
        if (m) inside += m[1] ? -1 : 1;
        out += part;
      } else out += inside > 0 ? part : mentions(room, linkify(part), addressed);
    }
    return out;
  }
  function renderStreamingWords(room, words, text, addressed) {
    if (holdsSelection(words)) return;
    let head = words.querySelector(":scope > .words-head");
    let tail = words.querySelector(":scope > .words-tail");
    if (!head || !tail || !text.startsWith(words.streamHeadText || "")) {
      words.innerHTML = '<div class="words-head"></div><div class="words-tail"></div>';
      head = words.firstElementChild;
      tail = words.lastElementChild;
      words.streamHeadText = "";
      words.streamFences = 0;
    }
    let done = words.streamHeadText.length;
    const cut = text.lastIndexOf("\n\n");
    if (cut > done) {
      const part = text.slice(done, cut + 2);
      const fences = (part.match(/```/g) || []).length;
      if ((words.streamFences + fences) % 2 === 0) {
        head.insertAdjacentHTML("beforeend", renderText(room, part, null, null, addressed));
        words.streamHeadText = text.slice(0, cut + 2);
        words.streamFences += fences;
        done = cut + 2;
      }
    }
    tail.innerHTML = renderText(room, text.slice(done), null, null, addressed);
  }
  let selectionDuringPatch = null;
  let chatSelection = null;
  function selectionSnapshot(selection) {
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    return { anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset, focusNode: selection.focusNode, focusOffset: selection.focusOffset, isCollapsed: false, range: selection.getRangeAt(0).cloneRange() };
  }
  const editors = new Map();
  function editingHere() {
    for (const held of editors.values()) if (held.roomId === state.currentRoomId) return true;
    return false;
  }
  function forgetGoneEditors(room) {
    for (const [id, held] of editors) if (held.roomId === room.id && !room.messages.some((m) => m.id === id)) editors.delete(id);
  }
  let textPress = null;
  const deferredMessageParts = new WeakMap();
  function holdsSelection(el) {
    if (textPress && el.contains(textPress)) return true;
    const sel = selectionDuringPatch || chatSelection;
    if (!sel || sel.isCollapsed) return false;
    if (el.contains(sel.anchorNode) || el.contains(sel.focusNode)) return true;
    return !!sel.range && sel.range.intersectsNode(el);
  }
  function canPaintMessagePart(el, part) {
    if (holdsSelection(el)) {
      const pending = deferredMessageParts.get(el) || new Set();
      pending.add(part); deferredMessageParts.set(el, pending);
      return false;
    }
    const pending = deferredMessageParts.get(el);
    pending?.delete(part);
    if (!pending?.size) deferredMessageParts.delete(el);
    return true;
  }
  function humanHoldsText() {
    return heldTextSelection || !!textPress || editingHere();
  }
  function renderMarkdown(room, text, addressed) {
    return md ? decorate(room, md.parse(String(text == null ? "" : text)), addressed) : renderTextLight(room, text, addressed);
  }
  function renderText(room, text, images, quotes, addressed, audio, video, numbers) {
    let html = messageRefs(renderMarkdown(room, text, addressed), numbers);
    if (images && images.length) html = imageRefs(html, images);
    if (audio && audio.length) html = soundRefs(html, audio);
    if (video && video.length) html = videoRefs(html, video);
    if (quotes && quotes.length) html = quoteRefs(html, quotes);
    return html;
  }
  function soundRefs(html, audio) {
    const numbers = new Set(audio.map((sound, i) => sound.n || i + 1));
    return html.replace(/\[audio (\d+)\]/gi, (whole, n) =>
      numbers.has(Number(n)) ? `<button type="button" class="audio-ref" data-n="${n}" data-hint="Play sound ${n}">${ic("mic")}<span>${n}</span></button>` : whole,
    );
  }
  function videoRefs(html, video) {
    const numbers = new Set(video.map((clip, i) => clip.n || i + 1));
    return html.replace(/\[video (\d+)\]/gi, (whole, n) =>
      numbers.has(Number(n)) ? `<button type="button" class="audio-ref video-ref" data-n="${n}" data-hint="Play video ${n}">${ic("video")}<span>${n}</span></button>` : whole,
    );
  }
  const MESSAGE_REF_RE = /(?<![\p{L}\p{N}_&#\/\\])#([1-9]\d{0,8})(?![\p{L}\p{N}_])/gu;
  function messageRefs(html, numbers) {
    let inside = 0;
    let out = "";
    const refer = (whole, n) => {
      if (!numbers || !Object.hasOwn(numbers.here, n)) return UI.html("message-ref", { seq: Number(n) });
      const here = numbers.here[n];
      return here === null ? whole : UI.html("message-ref", { seq: here, written: Number(n), copy: numbers.copy });
    };
    for (const part of html.split(/(<[^>]*>)/)) {
      if (!part) continue;
      if (part[0] === "<") {
        const tag = /^<(\/?)(a|code|pre)\b/i.exec(part);
        if (tag) inside = Math.max(0, inside + (tag[1] ? -1 : 1));
        out += part;
      } else out += inside > 0 ? part : part.replace(MESSAGE_REF_RE, refer);
    }
    return out;
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
    const numbered = Number(q.seq) > 0;
    const when = `${numbered ? `#${esc(String(q.seq))}` : ""}${q.ts ? `${numbered ? " · " : ""}${esc(time(q.ts))}` : ""}`;
    const goto = UI.html("button", { label: "Go to", icon: "go-to-message", kind: "link", hook: "q-goto", title: "Go to the quoted words, in the message they come from" });
    const head = `${ic("quote")}<b>${esc(q.fromName || "")}</b><span class="q-when">${when}</span>${goto}`;
    const ref = `${numbered ? ` data-seq="${esc(String(q.seq))}"` : ""}${q.id ? ` data-quoted-id="${esc(String(q.id))}"` : ""}`;
    return `<span class="quote"${ref}><span class="q-head">${head}</span><span class="q-text">${esc(q.text || "")}</span></span>`;
  }
  function imageRefs(html, images) {
    const numbers = new Set(images.map((image, i) => image.n || i + 1));
    return html.replace(/\[img (\d+)\]/gi, (whole, n) =>
      numbers.has(Number(n)) ? `<button type="button" class="img-ref" data-n="${n}" title="Image ${n}">${IMG_GLYPH}<span>${n}</span></button>` : whole,
    );
  }
  const IMG_GLYPH = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="5.6" cy="6.4" r="1.4" fill="currentColor"/><path d="M2.6 12.2l3.4-3.4 2.6 2.6 2.2-2.2 3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  function renderTextLight(room, text, addressed) {
    let html = esc(text);
    const blocks = [];
    html = html.replace(/```([^\n]*)\n([\s\S]*?)```/g, (m, lang, code) => {
      blocks.push(/^\s*mermaid\b/i.test(lang) ? mermaidBlock(code.trim()) : `<pre>${code}</pre>`);
      return `\u0000${blocks.length - 1}\u0000`;
    });
    html = linkify(html);
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    html = mentions(room, html, addressed);
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
              s.src = `/vendor/prism-lang/${encodeURIComponent(id)}.js`;
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
  const NOT_VIEWABLE_RE = /\.(exe|dll|so|dylib|bin|zip|gz|tgz|rar|7z|pdf|avi|mkv|wmv|ttf|otf|woff2?|class|jar|pyc|node|msi|iso|db|sqlite3?)$/i;
  const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif|ico|svg)$/i;
  const MEDIA_RE = /\.(mp4|m4v|mov|webm|ogv|mp3|m4a|wav|ogg|oga|opus|weba|flac)$/i;
  const VIDEO_RE = /\.(mp4|m4v|mov|webm|ogv)$/i;
  const LINE_RE = /:(\d+)(?:-(\d+))?$/;
  const previewCache = new Map();

  function readableInRoom(target) {
    if (!target || /^(https?:|mailto:)/i.test(target)) return false;
    const spec = splitLine(target);
    const file = spec ? spec.path : target;
    if (NOT_VIEWABLE_RE.test(file) || IMAGE_RE.test(file) || MEDIA_RE.test(file)) return false;
    return /[\\/]/.test(file);
  }
  function imageUrl(path) {
    const room = currentRoom();
    const roomPart = room && room.id ? `&room=${encodeURIComponent(room.id)}` : "";
    return `/api/image?path=${encodeURIComponent(path)}${roomPart}`;
  }
  function mediaUrl(path) {
    const room = currentRoom();
    const roomPart = room && room.id ? `&room=${encodeURIComponent(room.id)}` : "";
    return `/api/media?path=${encodeURIComponent(path)}${roomPart}`;
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

  const PREVIEW_ROWS = 20;
  const isDoc = (spec, data, error) => !error && !spec.from && !!data && (data.kind === "markdown" || data.kind === "csv");
  function docPreview(data) {
    if (data.kind === "csv") {
      const rows = data.rows || [];
      const shown = rows.slice(0, PREVIEW_ROWS + 1);
      const more = Math.max(0, rows.length - shown.length);
      return `<div class="file-view csv doc-preview">${csvTable(shown)}${more ? `<p class="csv-count">${more} more row${more === 1 ? "" : "s"} · "open" shows them all</p>` : ""}</div>`;
    }
    const fences = (data.text.match(/^```/gm) || []).length;
    const text = fences % 2 ? `${data.text}\n\`\`\`` : data.text;
    return `<div class="file-view markdown doc-preview">${renderMarkdown(currentRoom(), text)}</div>`;
  }
  function docRange(data) {
    if (data.kind === "csv") {
      const rows = Math.max(0, (data.rows || []).length - 1);
      return `${rows} row${rows === 1 ? "" : "s"}`;
    }
    const lines = data.lines || 0;
    return data.to && lines > data.to ? `first ${data.to} of ${lines} lines` : `${lines} line${lines === 1 ? "" : "s"}`;
  }

  function previewCard(key, spec, data, error) {
    const doc = isDoc(spec, data, error);
    const range = doc ? docRange(data) : data && data.from ? (data.to > data.from ? `lines ${data.from}–${data.to}` : `line ${data.from}`) : "";
    const el = UI.el("file-card", {
      name: fileName(spec.path),
      lines: range,
      kind: doc ? "doc" : "code",
      body: error ? undefined : doc ? docPreview(data) : codeWithGutter(data.text, data.language, data.from || 1),
      error: error || undefined,
      data: { key },
    });
    const body = el.querySelector(".body");
    if (!error && !doc && spec.from) {
      const marked = body.querySelectorAll(".gutter span")[spec.from - (data.from || 1)];
      if (marked) marked.classList.add("line-mark");
    }
    el.querySelector('[data-act="open-file"]').addEventListener("click", () => viewFile(spec.path, spec.from || 0).catch(showError));
    if (!error) highlightBlocks(body);
    if (doc && data.kind === "markdown") renderDiagrams(body);
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
        const res = await fetch(img.src, { signal: deadline(10000) });
        const text = await res.text();
        try {
          why = JSON.parse(text).error || "";
        } catch {
          why = res.status === 404 ? "this room does not serve pictures yet; restart it with the new build" : `the room answered ${res.status}`;
        }
      } catch {
        why = "the room did not answer";
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

  function mediaCard(key, path) {
    const video = VIDEO_RE.test(path);
    const player = video
      ? UI.h("video", { controls: true, preload: "metadata", playsinline: true, src: mediaUrl(path) })
      : UI.h("audio", { controls: true, preload: "metadata", src: mediaUrl(path) });
    const el = UI.el("file-card", { name: fileName(path), kind: "media", openTitle: "Open it with this computer's player", body: String(player), data: { key } });
    const body = el.querySelector(".body");
    const media = body.querySelector("video, audio");
    media.addEventListener("error", async () => {
      let why = "";
      try {
        const res = await fetch(media.src, { signal: deadline(10000), headers: { range: "bytes=0-0" } });
        if (res.ok) why = "this player cannot play how it is encoded; open it with this computer's player";
        else {
          const text = await res.text();
          try { why = JSON.parse(text).error || ""; } catch { why = res.status === 404 ? "this room does not play files yet; restart it with the new build" : `the room answered ${res.status}`; }
        }
      } catch {
        why = "the room did not answer";
      }
      body.innerHTML = `<div class="note">${esc(fileName(path))} could not be played here${why ? `: ${esc(why)}` : ""}.</div>`;
    });
    media.addEventListener("loadedmetadata", () => {
      const length = Number.isFinite(media.duration) ? soundLength(media.duration) : "";
      const size = video && media.videoWidth ? `${media.videoWidth}×${media.videoHeight}` : "";
      el.querySelector(".lines").textContent = [length, size].filter(Boolean).join(" · ");
    });
    el.querySelector('[data-act="open-file"]').addEventListener("click", async () => {
      try {
        const r = await post("/api/open", { target: path });
        if (r.action !== "open-url") toast(r.message, "info");
      } catch (error) {
        showError(error);
      }
    });
    return el;
  }

  function renderPreviews(textEl, m) {
    if (!textEl || m.streaming) return;
    const current = currentRoom();
    if (current?.filesDir && m.resourceRefs?.length) for (const link of textEl.querySelectorAll(".open-link[data-open]")) {
      const original = link.dataset.resourceSource || link.dataset.open;
      const spec = splitLine(original);
      const source = spec?.path || original;
      const ref = m.resourceRefs.find(r => r.source === source);
      if (ref) {
        link.dataset.resourceSource = original;
        link.dataset.open = `${current.filesDir.replace(/[\\/]$/, "")}/${ref.file}${spec ? `:${spec.from}${spec.to ? `-${spec.to}` : ""}` : ""}`;
        link.title = "Open the copy carried with this room";
      }
    }
    for (const link of textEl.querySelectorAll(".open-link[data-open]:not([data-previewed])")) {
      const target = link.dataset.open;
      if (/^(https?:|mailto:)/i.test(target) || NOT_VIEWABLE_RE.test(target)) continue;
      const spec = splitLine(target);
      link.dataset.previewed = "1";
      if (MEDIA_RE.test(target) && /[\\/]/.test(target)) {
        const key = `media|${target}`;
        if (textEl.querySelector(`[data-ui="file-card"][data-key="${cssEscape(key)}"]`)) continue;
        placeFragmentCard(textEl, link, mediaCard(key, target));
      } else if (IMAGE_RE.test(target) && /[\\/]/.test(target)) {
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
    const source = r.kind === "text";
    els.fvTools.hidden = false;
    els.fvGoto.hidden = !source;
    els.fvWrapBox.hidden = !source;
    els.fvBody.innerHTML =
      r.kind === "csv" ? csvTable(r.rows) : r.kind === "markdown" ? renderMarkdown(currentRoom(), r.text) : codeWithGutter(r.text, r.language, r.from || 1);
    els.fvOpen.dataset.path = r.path;
    els.fvBody.scrollTop = 0;
    els.fvSearch.value = "";
    els.fvHits.textContent = "";
    els.fvLine.value = at > 1 ? String(at) : "";
    if (source) {
      els.fvCount.textContent = `${r.lines}${r.more ? "+" : ""} lines${r.language ? ` · ${r.language}` : ""}${r.more ? " · shown in windows" : ""}`;
      els.fvBody.classList.toggle("wrap", els.fvWrap.checked);
    } else if (r.kind === "csv") {
      const rows = Math.max(0, (r.rows || []).length - 1);
      els.fvCount.textContent = `${rows} row${rows === 1 ? "" : "s"}`;
    } else {
      els.fvCount.textContent = `${r.lines || 0} line${r.lines === 1 ? "" : "s"} · Markdown`;
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
      const lineHeight = Layout.rect(row).height || 18;
      els.fvBody.scrollTop = Math.max(0, index * lineHeight - els.fvBody.clientHeight / 2);
    }
  }
  function findInFile(query) {
    const code = els.fvBody.querySelector(".code-body code") || els.fvBody;
    if (!code.firstChild) return;
    els.fvBody.querySelectorAll(".find-hit").forEach((el) => el.replaceWith(document.createTextNode(el.textContent)));
    code.normalize();
    if (!query) {
      els.fvHits.textContent = "";
      return;
    }
    const needle = query.toLowerCase();
    let hits = 0;
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement && node.parentElement.closest("svg") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
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
  function diagramFontPx() {
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--chat-fs")) || 1;
    return Math.round(13 * scale * 10) / 10;
  }
  function diagramStage() {
    let stage = document.getElementById("diagram-stage");
    if (!stage) {
      stage = document.createElement("div");
      stage.id = "diagram-stage";
      stage.setAttribute("aria-hidden", "true");
      stage.style.cssText = "position:absolute;left:-10000px;top:0;visibility:hidden;zoom:calc(1 / var(--ui-scale, 1))";
      document.body.appendChild(stage);
    }
    return stage;
  }
  function mermaidThemeVariables(d) {
    d = diagramSettings(d);
    const preset = diagramPreset(d);
    const vars = Object.assign({}, preset, { fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font").trim() || "Nunito, sans-serif", fontSize: `${diagramFontPx()}px` });
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
  function paintDiagram(root, palette, ink = TOKENS.active().elements.diagram.nodeInk) {
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
        s.onerror = () => reject(new Error("could not load Mermaid from the room"));
        document.head.appendChild(s);
      });
    }
    return mermaidLoading;
  }
  let mermaidSeq = 0;
  let mermaidTurn = Promise.resolve();
  function withMermaid(work) {
    const run = mermaidTurn.then(work, work);
    mermaidTurn = run.catch(() => {});
    return run;
  }
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
    return withMermaid(() => drawDiagrams(mermaid, blocks, d));
  }
  async function drawDiagrams(mermaid, blocks, d) {
    const palette = diagramPalette(d);
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      securityLevel: "strict",
      themeVariables: mermaidThemeVariables(d),
      themeCSS: mermaidCss(),
      htmlLabels: true,
      flowchart: { htmlLabels: true, curve: "basis", padding: 14, nodeSpacing: 44, rankSpacing: 52 },
    });
    for (const block of blocks) {
      const out = block.querySelector(".mm-out");
      const src = block.dataset.src || "";
      const owner = diagramOwner(block);
      if (owner && owner.repair && owner.repair.state === "repairing") {
        showDiagramRepairing(block, owner.message);
        continue;
      }
      try {
        const t0 = performance.now();
        const { svg } = await mermaid.render(`mm-${++mermaidSeq}`, src, diagramStage());
        out.innerHTML = svg;
        if (palette) paintDiagram(out, palette);
        block.classList.add("ok");
        block.classList.remove("failed", "repairing");
        noteSlow("diagram drawn", performance.now() - t0);
      } catch (e) {
        const error = String((e && e.message) || e);
        if (owner && !(owner.repair && owner.repair.state === "failed")) void reportDiagramFailure(block, owner, src, error);
        else showDiagramError(block, src, error);
      }
    }
  }
  function diagramOwner(block) {
    if (block.classList.contains("preview") || block.closest('[data-ui="file-card"]')) return null;
    const el = block.closest(".msg[data-id]"), words = block.closest(".words"), room = currentRoom();
    if (!el || !words || !room || !els.messages.contains(el)) return null;
    const message = room.messages.find((m) => m.id === el.dataset.id);
    if (!message || message.kind !== "chat" || message.from === "human" || message.streaming) return null;
    const index = [...words.querySelectorAll(".mermaid-block")].filter((b) => !b.closest('[data-ui="file-card"]')).indexOf(block) + 1;
    return { roomId: room.id, message, index, repair: (message.diagramRepairs || []).find((r) => r.block === index) };
  }
  async function reportDiagramFailure(block, owner, src, error) {
    let answer = null;
    try {
      answer = await post(`/api/rooms/${encodeURIComponent(owner.roomId)}/messages/${encodeURIComponent(owner.message.id)}/diagram`, { block: owner.index, source: src, error });
    } catch {
    }
    if (answer && answer.state === "repairing") showDiagramRepairing(block, owner.message);
    else showDiagramError(block, src, error);
  }
  function showDiagramRepairing(block, message) {
    block.classList.add("repairing");
    block.classList.remove("ok", "failed");
    block.querySelector(".mm-out").innerHTML = `<div class="mm-repairing">${ic("tool")}<span>${esc(message.fromName)} is fixing this diagram…</span></div>`;
  }
  function showDiagramError(block, src, error) {
    const [head, ...rest] = error.replace(/\s+$/, "").split("\n");
    block.classList.add("failed");
    block.classList.remove("ok", "repairing");
    block.querySelector(".mm-out").innerHTML = `<pre>${esc(src)}</pre><div class="hint error">Mermaid: ${esc(head)}</div>${rest.length ? `<pre class="mm-error">${esc(rest.join("\n"))}</pre>` : ""}`;
  }
  function rerenderDiagrams() {
    document.querySelectorAll(".mermaid-block[data-rendered]:not(.preview)").forEach((b) => {
      delete b.dataset.rendered;
      b.querySelector(".mm-out").innerHTML = `<pre>${esc(b.dataset.src || "")}</pre>`;
    });
    renderDiagrams(document);
  }
  const timeFormatter = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
  const fullTimeFormatter = new Intl.DateTimeFormat([], { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const shortDateFormatter = new Intl.DateTimeFormat([], { day: "numeric", month: "short" });
  const dayFormatter = new Intl.DateTimeFormat([], { weekday: "short", day: "numeric", month: "short" });
  const dayLabels = new Map();
  let dayLabelsFor = null;
  function time(ts) {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? "Invalid Date" : timeFormatter.format(d);
  }
  function fullTime(ts) {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? "Invalid Date" : fullTimeFormatter.format(d);
  }
  function relTime(ts) {
    if (!ts) return "";
    const d = Date.now() - ts;
    if (d < 60000) return "just now";
    if (d < 3600000) return `${Math.floor(d / 60000)} min ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)} h ago`;
    return shortDateFormatter.format(new Date(ts));
  }
  function localDay(ts) {
    const d = new Date(ts);
    return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
  }
  function dayLabel(ts) {
    const now = Date.now();
    if (!dayLabelsFor || now >= dayLabelsFor.until) {
      const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
      dayLabelsFor = { today: localDay(now), until: midnight.getTime() };
      dayLabels.clear();
    }
    const day = localDay(ts);
    if (Number.isNaN(day)) return "Invalid Date";
    let label = dayLabels.get(day);
    if (label === undefined) {
      label = day === dayLabelsFor.today ? "Today" : day === dayLabelsFor.today - 1 ? "Yesterday" : dayFormatter.format(new Date(ts));
      dayLabels.set(day, label);
    }
    return label;
  }
  function fmtTokens(n) {
    if (n === undefined || n === null) return "";
    return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  }
  function fmtDuration(ms) {
    if (!ms || ms < 0) return "";
    const total = Math.round(ms / 1000);
    if (total < 60) return `${(ms / 1000).toFixed(1)} s`;
    const ss = String(total % 60).padStart(2, "0");
    const m = Math.floor(total / 60);
    if (m < 60) return `${m}:${ss} min`;
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${ss} h`;
  }
  function fmtCost(cost) {
    return cost ? `${cost.amount.toFixed(3)} ${cost.currency}` : "";
  }
  function nearBottom() {
    const el = els.messages;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }
  function atEnd() {
    const el = els.messages;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 12;
  }
  function replyStreaming() {
    const room = currentRoom();
    return !!room && room.messages.some((m) => m.streaming);
  }
  function deliberateReturn() {
    return atEnd() && !replyStreaming();
  }
  let stuck = true;
  let readingAway = false;
  const CALM = (() => { const v = new URLSearchParams(location.search).get("calm"); return ["hold", "reserve", "reserve-cap"].includes(v) ? v : "off"; })();
  const calm = { held: false, reserve: 0, initial: 0, baseContent: 0 };
  if (CALM !== "off") document.documentElement.dataset.calm = CALM;
  function calmStart(id) {
    if (CALM === "hold") {
      scrollToBottom("a live reply begins");
      stuck = false;
      calm.held = true;
      els.jumpLatest.hidden = false;
      return;
    }
    const el = els.messages;
    const bubble = el.querySelector(`.msg[data-id="${id}"]`);
    if (!bubble) return scrollToBottom("a live reply begins");
    calmRelease();
    const third = Math.round(el.clientHeight / 3);
    let reserve = Math.max(0, el.clientHeight - third - bubble.offsetHeight);
    if (CALM === "reserve-cap") reserve = Math.min(reserve, Math.round(el.clientHeight / 2));
    calm.reserve = reserve;
    calm.initial = reserve;
    el.style.paddingBottom = `${reserve}px`;
    calm.baseContent = el.scrollHeight - reserve;
    el.scrollTop = Math.max(0, topInList(bubble) - third);
    lastScrollTop = el.scrollTop;
    stuck = false;
    calm.held = true;
    els.jumpLatest.hidden = false;
  }
  function calmAfterGrowth() {
    if (!calm.held || CALM === "hold" || humanHoldsText()) return;
    const el = els.messages;
    const grown = el.scrollHeight - calm.reserve - calm.baseContent;
    const next = Math.max(0, calm.initial - grown);
    if (next !== calm.reserve) {
      calm.reserve = next;
      el.style.paddingBottom = next ? `${next}px` : "";
    }
    if (next === 0) {
      calm.held = false;
      stuck = true;
      scrollToBottom("the room under the reply is used up");
    }
  }
  function calmRelease() {
    if (calm.reserve > 0) {
      calm.reserve = 0;
      calm.initial = 0;
      els.messages.style.paddingBottom = "";
    }
    calm.held = false;
  }
  let settling = 0;
  let settled = 0;
  const endJumps = [];
  function noteJump(why, byHand) {
    const el = els.messages;
    const entry = { at: Date.now(), why: why || "(unnamed)", byHand, following: stuck, readingAway, streaming: replyStreaming(), from: Math.round(el.scrollTop), fromEnd: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight) };
    endJumps.push(entry);
    if (endJumps.length > 30) endJumps.splice(0, endJumps.length - 20);
    if (!byHand && !stuck && entry.fromEnd > 12) reportJump(entry);
  }
  function noteHeldPlace(why) {
    const el = els.messages;
    endJumps.push({ at: Date.now(), why, held: true, following: stuck, readingAway, streaming: replyStreaming(), from: Math.round(el.scrollTop), fromEnd: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight) });
    if (endJumps.length > 30) endJumps.splice(0, endJumps.length - 20);
  }
  let lastListChange = null;
  let arrivalFromEnd = 0;
  function noteArrival(byHand) {
    const el = els.messages;
    const fromEnd = Math.round(el.scrollHeight - el.scrollTop - el.clientHeight);
    if (byHand) { arrivalFromEnd = fromEnd; return; }
    const was = arrivalFromEnd;
    if (stuck || fromEnd > 12 || was <= 40) return;
    arrivalFromEnd = 0;
    const last = lastListChange ? `${lastListChange.why}, ${Date.now() - lastListChange.at} ms ago` : "no change of the list noted";
    const entry = { at: Date.now(), why: `arrived at the end by itself (last: ${last})`, following: false, readingAway, streaming: replyStreaming(), from: Math.round(el.scrollTop), fromEnd: was };
    endJumps.push(entry);
    if (endJumps.length > 30) endJumps.splice(0, endJumps.length - 20);
    reportJump(entry);
  }
  function reportJump(entry) {
    const room = currentRoom();
    if (!room) return;
    const anchor = readerAnchor();
    void post("/api/window/finding", {
      kind: "end-jump",
      roomId: room.id,
      why: entry.why,
      fromEnd: entry.fromEnd,
      scrollTop: entry.from,
      readingAway: entry.readingAway,
      streaming: entry.streaming,
      holdsText: humanHoldsText(),
      msgs: room.messages.length,
      anchorId: anchor ? anchor.id : "",
      into: anchor ? Math.round(anchor.into) : 0,
    }).catch(() => {});
  }
  function scrollToBottom(why, { byHand = false } = {}) {
    calmRelease();
    glideStop("the list went to its end");
    noteJump(why, byHand);
    els.messages.scrollTop = els.messages.scrollHeight;
    els.jumpLatest.hidden = true;
    stuck = true;
    readingAway = false;
    settled = 0;
    if (!settling) settleBottom(20);
  }
  function followEnd(why) {
    if (stuck && !humanHoldsText()) scrollToBottom(why);
  }
  function settleBottom(frames) {
    settling = frames;
    requestAnimationFrame(() => {
      const el = els.messages;
      const short = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      if (stuck && short && !humanHoldsText()) el.scrollTop = el.scrollHeight;
      settled = short ? 0 : settled + 1;
      settling = settled >= 2 ? 0 : frames - 1;
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
  function copyClone(el, m) {
    const collapsed = m && el.querySelector(".text.clamped");
    let clone;
    if (collapsed) {
      clone = document.createElement("div");
      clone.innerHTML = renderText(currentRoom(), m.text, m.images, m.quotes, m.to, m.audio, m.video, m.numbersHere);
    } else clone = (el.querySelector(".text > .words") || el.querySelector(".text")).cloneNode(true);
    for (const node of clone.querySelectorAll('[data-ui="file-card"], [data-ui="icon-button"], .live-tail, .mermaid-block svg, .mm-bar')) node.remove();
    clone.classList.remove("clamped");
    return clone;
  }
  function copyableHtml(el, m) {
    const clone = copyClone(el, m);
    for (const link of clone.querySelectorAll('a.open-link, .img-ref, .audio-ref, [data-ui="message-ref"]')) link.replaceWith(document.createTextNode(link.textContent));
    return clone.innerHTML.trim();
  }

  const PORTABLE_STYLE = {
    pre: `font-family:Consolas,Menlo,'Courier New',monospace;font-size:90%;background:${TOKENS.portable.codeBg};border:1px solid ${TOKENS.portable.codeEdge};border-radius:6px;padding:8px 10px;white-space:pre-wrap`,
    code: `font-family:Consolas,Menlo,'Courier New',monospace;font-size:90%;background:${TOKENS.portable.codeBg};border-radius:4px;padding:1px 4px`,
    blockquote: `margin:6px 0;padding:2px 0 2px 10px;border-left:3px solid ${TOKENS.portable.rule};color:${TOKENS.portable.quoteInk}`,
    table: "border-collapse:collapse;margin:6px 0",
    th: `border:1px solid ${TOKENS.portable.rule};padding:4px 8px;background:${TOKENS.portable.codeBg};text-align:left`,
    td: `border:1px solid ${TOKENS.portable.rule};padding:4px 8px`,
    img: "max-width:100%;height:auto",
  };
  function readAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  async function pictureData(src) {
    const response = await fetch(src, { signal: deadline(30000) });
    if (!response.ok) throw new Error(`the picture did not load (${response.status})`);
    return readAsDataUrl(await response.blob());
  }
  function diagramPng(src) {
    return withMermaid(async () => {
      const mermaid = await loadMermaid();
      const d = diagramSettings();
      const preset = DIAGRAM_PRESETS[d.preset] || DIAGRAM_PRESETS.pop;
      const vars = Object.assign({}, preset, { fontFamily: "Arial, Helvetica, sans-serif", fontSize: "14px" });
      delete vars.label;
      delete vars.palette;
      if (preset.palette) preset.palette.forEach((c, i) => (vars[`pie${i + 1}`] = c.fill));
      if (d.primary) {
        vars.primaryColor = d.primary;
        delete vars.primaryBorderColor;
        delete vars.primaryTextColor;
      }
      mermaid.initialize({ startOnLoad: false, theme: "base", securityLevel: "strict", htmlLabels: false, themeVariables: vars, themeCSS: mermaidCss(), flowchart: { htmlLabels: false, curve: "basis", padding: 14, nodeSpacing: 44, rankSpacing: 52 } });
      const { svg } = await mermaid.render(`mm-copy-${++mermaidSeq}`, src, diagramStage());
      const holder = document.createElement("div");
      holder.innerHTML = svg;
      const root = holder.querySelector("svg");
      if (preset.palette && !d.primary) paintDiagram(root, preset.palette, preset.primaryTextColor || TOKENS.portable.ink);
      const box = root.viewBox && root.viewBox.baseVal;
      const width = Math.ceil(box && box.width ? box.width : 600), height = Math.ceil(box && box.height ? box.height : 400);
      root.setAttribute("width", String(width));
      root.setAttribute("height", String(height));
      root.removeAttribute("style");
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
      await image.decode();
      const canvas = document.createElement("canvas"), scale = 2;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const g = canvas.getContext("2d");
      g.fillStyle = TOKENS.portable.paper;
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { src: canvas.toDataURL("image/png"), width, height };
    });
  }
  async function portableHtml(el, m) {
    const room = currentRoom();
    const holder = copyClone(el, m);
    const codeColours = new Map();
    const liveCode = [...el.querySelectorAll(".text pre > code")], copyCode = [...holder.querySelectorAll("pre > code")];
    if (liveCode.length === copyCode.length) {
      copyCode.forEach((code, i) => {
        const block = getComputedStyle(liveCode[i].parentElement);
        codeColours.set(code.parentElement, `;background:${block.backgroundColor};color:${block.color};border-color:${block.backgroundColor}`);
        const liveWords = liveCode[i].querySelectorAll(".token"), copyWords = code.querySelectorAll(".token");
        if (liveWords.length === copyWords.length) copyWords.forEach((word, j) => codeColours.set(word, `color:${getComputedStyle(liveWords[j]).color}`));
      });
    }
    for (const block of holder.querySelectorAll(".mermaid-block")) {
      const src = block.getAttribute("data-src") || "";
      try {
        const png = await diagramPng(src);
        const img = document.createElement("img");
        img.src = png.src;
        img.width = png.width;
        img.alt = "Diagram";
        block.replaceWith(img);
      } catch {
        const pre = document.createElement("pre");
        pre.textContent = src;
        block.replaceWith(pre);
      }
    }
    for (const node of holder.querySelectorAll("[hidden], .mm-code, .q-goto")) node.remove();
    for (const ref of holder.querySelectorAll(".img-ref")) ref.replaceWith(document.createTextNode(`[image ${ref.dataset.n || ref.textContent.trim()}]`));
    for (const ref of holder.querySelectorAll(".audio-ref")) ref.replaceWith(document.createTextNode(`[${ref.classList.contains("video-ref") ? "video" : "sound"} ${ref.dataset.n || ref.textContent.trim()}]`));
    for (const ref of holder.querySelectorAll('[data-ui="message-ref"]')) ref.replaceWith(document.createTextNode(ref.textContent));
    for (const link of holder.querySelectorAll("a.open-link")) {
      const target = link.dataset.open || "";
      if (/^https?:\/\//i.test(target)) {
        const a = document.createElement("a");
        a.href = target;
        a.textContent = link.textContent;
        link.replaceWith(a);
      } else link.replaceWith(document.createTextNode(link.textContent));
    }
    for (const quote of holder.querySelectorAll(".quote")) {
      const block = document.createElement("blockquote");
      const head = document.createElement("b");
      head.textContent = (quote.querySelector(".q-head") || quote).textContent.trim();
      block.append(head, document.createElement("br"), (quote.querySelector(".q-text") || quote).textContent);
      quote.replaceWith(block);
    }
    for (const [i, image] of (m.images || []).entries()) {
      const figure = document.createElement("p"), n = image.n || i + 1;
      try {
        const img = document.createElement("img");
        img.src = image.url && image.url.startsWith("data:") ? image.url : await pictureData(shotUrl(room.id, image));
        img.alt = image.name || `Image ${n}`;
        figure.append(img, document.createElement("br"), `Image ${n}${image.name ? `: ${image.name}` : ""}`);
      } catch {
        figure.textContent = `[Image ${n}${image.name ? `: ${image.name}` : ""} could not be copied]`;
      }
      holder.appendChild(figure);
    }
    for (const [tag, style] of Object.entries(PORTABLE_STYLE)) {
      for (const node of holder.querySelectorAll(tag)) if (!(tag === "code" && node.closest("pre"))) node.setAttribute("style", style);
    }
    for (const [node, colours] of codeColours) if (node.isConnected || holder.contains(node)) node.setAttribute("style", `${node.getAttribute("style") || ""}${colours}`.replace(/^;/, ""));
    for (const node of holder.querySelectorAll("*")) {
      for (const attr of [...node.attributes]) if (attr.name === "class" || attr.name.startsWith("data-") || ["role", "tabindex", "title"].includes(attr.name)) node.removeAttribute(attr.name);
    }
    return holder.innerHTML.trim();
  }
  async function copyMessage(el, m) {
    const text = String(m.text || "");
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const html = portableHtml(el, m).then((h) => new Blob([h], { type: "text/html" }));
        await navigator.clipboard.write([new ClipboardItem({ "text/html": html, "text/plain": new Blob([text], { type: "text/plain" }) })]);
      } else await navigator.clipboard.writeText(text);
      toast((m.images || []).length || el.querySelector(".mermaid-block") ? "Copied with its formatting, pictures and diagrams; the tool calls stayed here." : "Copied with its formatting; the tool calls stayed here.");
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
  const TRANSCRIPT_LABEL = { off: "off", errors: "when something fails", full: "all activity" };
  function followsAppWords(now) {
    return now ? `Use the app setting (now: ${now})` : "Use the app setting";
  }
  const SHARES_HISTORY_HINT = "Vibemates of the other rooms may find messages written here, and their memory may read what this room's memory learned. Hidden and deleted messages are never shared. Off: this room is searched only from inside it.";
  const READS_OTHER_ROOMS = [["off", "No"], ["on-search", "When a vibemate searches"], ["every-turn", "Also in each turn's memory block"]];
  const READS_OTHER_ROOMS_HINT = "Vibemates here may search the rooms that share their history: their messages, and what their memory learned. With the last, in a room that remembers, each turn's memory block reads those rooms too.";
  const READS_OTHER_ROOMS_GEEK = "Only a room that shares its history can be searched, and only a room that remembers has a memory to read; each borrowed fact names the room it was heard in. In a turn's block the other rooms' facts are mostly noise where the rooms talk of different things: in 46 of your messages judged blind, 4.3 of the 9.0 unrelated facts a message came from the other rooms, and 0.1 of the useful ones. So a vibemate's own search is the usual way to them.";
  const DIAGNOSTIC_LOG_HELP = "Save details to help investigate problems with a vibemate. Choose All activity while checking a reply that gets stuck. Diagnostic files keep up to 64 MB across rooms, 5 MB per file, for up to seven days. Older details are removed and unusually large entries are shortened. Conversations are saved separately and are not shortened.";
  function geekTip(text) {
    return `<button type="button" class="geek-tip" title="For geeks">${ic("geek")}for geeks</button><span class="geek-text" hidden>${text}</span>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".geek-tip");
    if (!b) return;
    e.preventDefault();
    const next = b.nextElementSibling;
    const t = next && next.classList.contains("geek-text") ? next : b.closest('[data-ui="setting"]')?.querySelector(":scope > .geek-text");
    if (!t) return;
    t.hidden = !t.hidden;
    b.classList.toggle("on", !t.hidden);
    if (b.hasAttribute("aria-expanded")) b.setAttribute("aria-expanded", String(!t.hidden));
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
  function vendorLogo(r, size) {
    return UI.html("logo-tile", { icon: r.icon || "", letter: r.vendor[0], size: size || "md", title: r.vendor });
  }
  function devBuild() {
    return !!(state.version && state.version.sourceCheckout);
  }
  function slowTasksHtml() {
    if (!slowTasks.length) return '<p class="hint">Nothing over 8 ms so far in this window.</p>';
    const rows = [...slowTasks]
      .reverse()
      .slice(0, 25)
      .map((t) => `<tr><td>${esc(new Date(t.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }))}</td><td class="ms"><b>${t.ms} ms</b></td><td title="${esc(t.name)}">${esc(t.name)}</td><td class="hint" title="${esc(t.busy)}">${esc(t.busy)}</td></tr>`);
    return `<div class="slow-scroll"><table class="slow-table">${rows.join("")}</table></div>`;
  }
  function endJumpsHtml() {
    if (!endJumps.length) return '<p class="hint">The chat has not moved to the newest message by itself in this window.</p>';
    const rows = [...endJumps]
      .reverse()
      .slice(0, 20)
      .map((j) => `<tr><td>${esc(new Date(j.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }))}</td><td title="${esc(j.why)}">${j.held ? "held: " : ""}${esc(j.why)}</td><td class="dim">${j.following ? "following the end" : `${j.fromEnd} px above the end`}${j.streaming ? " · a reply was streaming" : ""}</td></tr>`)
      .join("");
    return `<div class="slow-scroll"><table class="slow-table">${rows}</table></div>`;
  }
  function endJumpsText() {
    return [...endJumps].reverse().map((j) => `${new Date(j.at).toLocaleTimeString()} - ${j.held ? "held: " : ""}${j.why} - ${j.following ? "following the end" : `${j.fromEnd} px above the end`}${j.streaming ? " - a reply was streaming" : ""}`).join("\n");
  }
  function slowTasksText() {
    return [...slowTasks].reverse().map((t) => `${new Date(t.at).toLocaleTimeString()} - ${t.ms ? `${t.ms} ms - ` : ""}${t.name}${t.busy ? ` - ${t.busy}` : ""}`).join("\n");
  }
  function wheelTraceText() {
    const since = performance.now() - 120_000;
    const lines = [];
    let start = 0;
    for (const w of wheelTrace) {
      if (w.at < since) continue;
      if (w.kind === "wheel" && w.gap === null) {
        start = w.at;
        lines.push(`a gesture at ${new Date(performance.timeOrigin + w.at).toLocaleTimeString()}${w.busy ? ` (${w.busy})` : ""}`);
      }
      const t = `+${Math.round(w.at - start)} ms`.padStart(10);
      if (w.kind === "wheel") lines.push(`${t}  wheel ${w.dy} ${["px", "lines", "pages"][w.mode] || "?"}${w.gap === null ? "" : `, ${w.gap} ms after the last`}, heard ${w.waited} ms late -> ${w.took}`);
      else if (w.kind === "frame") lines.push(`${t}  a late frame, ${w.late} ms after the last, ${w.step} px in one move`);
      else if (w.kind === "shift") lines.push(`${t}  the list moved ${w.px} px under the motion, which went on with it`);
      else lines.push(`${t}  the motion stopped: ${w.why}`);
    }
    if (!lines.length) return "";
    return [`viberoom ${state.version?.version || "?"}, devicePixelRatio ${window.devicePixelRatio}, CSS zoom ${Layout.scale}`, ...lines].join("\n");
  }
  function wheelTraceSummary() {
    const first = wheelTrace.findLastIndex((w) => w.kind === "wheel" && w.gap === null);
    if (first < 0) return "No wheel on the chat yet in this window.";
    const gesture = wheelTrace.slice(first);
    const wheels = gesture.filter((w) => w.kind === "wheel");
    const taken = wheels.filter((w) => /^(step|glide)/.test(w.took));
    const how = taken.length ? taken[0].took.split(/[: ]/)[0] : "";
    const late = gesture.filter((w) => w.kind === "frame").length;
    const waited = Math.max(...wheels.map((w) => w.waited));
    return `The last gesture: ${wheels.length} wheel event${wheels.length === 1 ? "" : "s"}, ${taken.length ? `${taken.length} taken by the ${how}` : "all native"}; heard up to ${waited} ms late${late ? `; ${late} late frame${late === 1 ? "" : "s"}` : ""}.`;
  }
  function bindCopy(button, textOf, empty) {
    if (!button) return;
    button.addEventListener("click", async () => {
      const words = button.querySelector(".label");
      const label = words.textContent;
      try {
        await navigator.clipboard.writeText(textOf() || empty);
        words.textContent = "Copied";
        setTimeout(() => (words.textContent = label), 1500);
      } catch (e) {
        showError(e);
      }
    });
  }
  function settingRow(props) {
    return UI.html("setting", props);
  }
  function selectHtml(id, options, value) {
    return `<select class="select" id="${id}">${options.map(([v, label]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(label)}</option>`).join("")}</select>`;
  }
  function numberHtml(props) {
    return UI.raw(UI.html("number-field", props));
  }
  function actHtml(props) {
    return UI.raw(UI.html("button", { kind: "secondary", size: "sm", ...props }));
  }
  function settingsCard(id, title, body, tone = "plain") {
    return UI.html("settings-group", { id, title, body: UI.raw(body), tone });
  }
  function revealSettingsFor(field) {
    const page = field?.closest?.('[data-ui="settings-category"]');
    if (page && page.hidden) {
      if (page.closest("#details-inner")) showPanelSection(page.dataset.category);
      else showSettingsCategory(page.dataset.category, { arrive: false });
    }
    for (let group = field?.closest?.("details"); group; group = group.parentElement?.closest("details")) group.open = true;
  }
  document.addEventListener("invalid", (e) => revealSettingsFor(e.target), true);
  const SAVED_MARK_MS = 2000;
  const recentlySaved = new Map();
  function markSaved(fieldId, ms) {
    const el = fieldId && document.getElementById(fieldId);
    const label = el && el.closest('[data-ui="setting"]')?.querySelector(".name-line");
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
        if (outcome === false) revealSettingsFor(document.getElementById(field) || container);
        if (field && outcome !== false) {
          recentlySaved.set(field, Date.now());
          markSaved(field);
        }
      } catch (e) {
        dirty = true;
        revealSettingsFor(document.getElementById(field) || container);
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
    const own = (e) => !!e.target.closest?.("[data-own-save]");
    container.addEventListener("input", (e) => { if (!own(e)) arm(); });
    container.addEventListener("change", (e) => {
      if (own(e)) return;
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
    const mark = TOKENS.active().elements.roomMark;
    const from = Number(mark.hueFrom);
    const span = Number(mark.hueSpan);
    const place = h % 360;
    if (!Number.isFinite(from) || !Number.isFinite(span) || span >= 360) return place;
    return Math.round(((from + (place * span) / 360) % 360 + 360) % 360);
  }
  function roomMark(room, size = "md") {
    const emoji = (room.settings && room.settings.emoji) || "";
    const picture = window.Avatars.faceUrl(emoji);
    return UI.html("room-mark", { hue: roomHue(room), picture: picture || undefined, emoji: !picture && emoji ? emoji : undefined, letter: emoji ? undefined : room.name.trim()[0] || "?", size });
  }
  function lookSampleHtml() {
    const withIcon = state.recipes.filter((r) => r.icon);
    const lead = withIcon[0] || state.recipes[0];
    const sam = { name: "Sam", kind: "agent", color: TOKENS.active().elements.face.avatarDefault, avatar: "🦊", agentType: lead ? lead.id : "", agentLabel: lead ? lead.vendor : "" };
    const marks = (withIcon.length ? withIcon : state.recipes).slice(0, 3).map((r) => vendorLogo(r, "sm")).join("");
    return `<div class="msg agent"><div class="bubble-col"><div class="head"><span class="head-av">${avatar(sam, 32, { vendor: true })}</span><span class="name" style="color:${sam.color}">Sam</span><span class="time">16:21</span></div><div class="bubble">A reply, on this look's paper, in its ink, with <code>code</code> a step smaller.</div><div class="meta"><span>seen</span></div></div></div>
      <div class="msg mine"><div class="bubble-col"><div class="bubble">Your message.</div></div></div>
      <div class="sample-row">${UI.html("hub-row", { text: "Sam finished the reply started at 16:21 · 2m 30s", ref: "sample", title: "a row the room writes", face: UI.raw(avatar(sam, 20, {})) })}</div>
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
    let queued = false;
    const updateSoon = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        update();
      });
    };
    box.addEventListener("scroll", update, { passive: true });
    new ResizeObserver(updateSoon).observe(box);
    new MutationObserver(updateSoon).observe(box, { childList: true, subtree: true });
    update();
  }

  function openDialog(dialog) {
    if (dialog.open) return;
    dialog.classList.remove("closing");
    restoreDialogSize(dialog);
    dialog.showModal();
    if (dialog.classList.contains("light-dismiss") && !dialog.lightDismissWired) {
      dialog.lightDismissWired = true;
      const outside = (e) => {
        const r = Layout.rect(dialog);
        return Layout.length(e.clientX) < r.left || Layout.length(e.clientX) > r.right || Layout.length(e.clientY) < r.top || Layout.length(e.clientY) > r.bottom;
      };
      let fromBackdrop = false;
      dialog.addEventListener("pointerdown", (e) => {
        fromBackdrop = e.target === dialog && outside(e);
      });
      dialog.addEventListener("click", (e) => {
        if (e.target !== dialog || !fromBackdrop) return;
        if (outside(e)) closeDialog(dialog);
      });
    }
    dialog.querySelectorAll(".scrolls").forEach(attachScrollHints);
    watchDialogSize(dialog);
  }

  const DIALOG_MIN_W = 320;
  const DIALOG_MIN_H = 220;
  const dialogSizeKey = (dialog) => `dialog.${dialog.id || "unnamed"}.size`;
  const dialogFits = (w, h) => ({
    w: Math.max(DIALOG_MIN_W, Math.min(w, Math.round(Layout.length(window.innerWidth) * 0.94))),
    h: Math.max(DIALOG_MIN_H, Math.min(h, Math.round(Layout.length(window.innerHeight) * 0.92))),
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
          if (w >= DIALOG_MIN_W && h >= DIALOG_MIN_H) {
            clearTimeout(el.sizeTimer);
            el.sizeTimer = setTimeout(() => remember(dialogSizeKey(el), `${w}x${h}`), 200);
          }
        }
      });
    }
    if (!dialog.dataset.sized) {
      dialog.dataset.sized = "1";
      dialog.addEventListener("pointerdown", (e) => {
        const r = Layout.rect(dialog);
        if (Layout.length(e.clientX) > r.right - 22 && Layout.length(e.clientY) > r.bottom - 22 && !dialog.style.width) {
          dialog.style.width = `${Math.round(r.width)}px`;
          dialog.style.height = `${Math.round(r.height)}px`;
          dialog.classList.add("sized");
        }
      });
      dialog.addEventListener("dblclick", (e) => {
        const r = Layout.rect(dialog);
        if (Layout.length(e.clientX) > r.right - 22 && Layout.length(e.clientY) > r.bottom - 22) resetDialogSize(dialog);
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
    const extra = $("#cf-extra");
    extra.innerHTML = o.extraHtml || "";
    extra.hidden = !o.extraHtml;
    const buttons = { ok: $("#cf-ok"), alt: $("#cf-alt"), cancel: $("#cf-cancel") };
    buttons.ok.textContent = o.okLabel || "OK";
    buttons.cancel.textContent = o.cancelLabel || "Cancel";
    buttons.cancel.hidden = !!o.hideCancel;
    buttons.alt.textContent = o.altLabel || "";
    buttons.alt.hidden = !o.altLabel;
    dialog.classList.toggle("three-way", !!o.altLabel);
    const primary = o.primary || "ok";
    for (const [name, button] of Object.entries(buttons)) button.dataset.kind = name === primary ? (o.danger ? "danger" : "primary") : "ghost";
    return new Promise((resolve) => {
      const done = () => {
        dialog.removeEventListener("close", done);
        if (o.beforeClose) o.beforeClose();
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
  function forget(key) {
    try {
      localStorage.removeItem(`viberoom.${key}`);
    } catch {
    }
  }


  function setView(view) {
    if (view !== "room") clearConversationSelection();
    if (state.view === "room" && view !== "room") rememberReader();
    if (view !== "room") toolDetailsCache.clear();
    if (state.view === "settings" && view !== "settings") dropPairLink(true);
    const arriving = view !== state.view;
    state.view = view;
    els.app.classList.remove("view-home", "view-rooms", "view-room", "view-skills", "view-settings", "view-connections", "view-me");
    els.app.classList.add(`view-${view}`);
    els.homeView.hidden = view !== "home";
    els.roomsView.hidden = view !== "rooms";
    els.chatView.hidden = view !== "room";
    els.pageView.hidden = !(view === "skills" || view === "settings" || view === "connections" || view === "me");
    els.sideRooms.hidden = view === "room";
    els.sideRoom.hidden = view !== "room";
    if (view !== "room") closeDetails();
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
      showRoomList("the room was opened");
    } else if (view === "skills") {
      renderSideRooms();
      renderSkillsPage();
    } else if (view === "settings") {
      renderSideRooms();
      renderSettingsPage();
      void refreshBuildAge();
    } else if (view === "connections") {
      renderSideRooms();
      renderConnectionsPage();
    } else if (view === "me") {
      renderSideRooms();
      renderMePage();
    }
    if (arriving && view !== "room") arriveAll(view);
  }

  async function refreshBuildAge() {
    try {
      const fresh = await (await fetch("/api/version", { signal: AbortSignal.timeout(4000) })).json();
      const before = (state.version && state.version.staleBuild) || null;
      state.version = fresh;
      if ((fresh.staleBuild || null) !== before && state.view === "settings") renderSettingsPage();
    } catch {
    }
  }

  function selectRoom(id, opts) {
    if (id !== state.currentRoomId) clearConversationSelection();
    if (!state.rooms.has(id)) return;
    const switching = state.currentRoomId !== id;
    const panelWas = state.detailsOpen ? state.selection.kind : null;
    if (state.currentRoomId !== id) {
      clearShots();
      doneNotes.length = 0;
      renderDoneNotes();
      keepReturnPlace(state.currentRoomId);
      const back = returnPlaces.get(id) || null;
      returnTo = back ? { roomId: id, anchor: back } : null;
      stuck = !back;
      readingAway = !!back;
    }
    state.currentRoomId = id;
    state.unread.delete(id);
    unseenHere = 0;
    showAttention();
    remember("room", id);
    if (!state.openRooms.includes(id)) {
      state.openRooms.push(id);
      post(`/api/rooms/${encodeURIComponent(id)}/open`).catch(() => {});
    }
    setView("room");
    if (!(opts && opts.keepDetails)) closeDetails();
    else if (switching && panelWas === "room") openDetails({ kind: "room" });
    else if (switching) closeDetails();
    if (!state.detailsOpen) state.selection = { kind: "room" };
    maybeOfferReconnect();
  }

  const POP_SEEN_MS = 30000;
  function closesWhenSeen(pop, close) {
    let seen = 0, since = 0, counting = false, timer = 0;
    const done = () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", tick);
      pop.removeEventListener("pointerenter", tick);
      pop.removeEventListener("pointerleave", tick);
    };
    function tick() {
      clearTimeout(timer);
      if (!pop.isConnected) return done();
      if (counting) { seen += Date.now() - since; counting = false; }
      if (seen >= POP_SEEN_MS) { done(); return close(); }
      if (!document.hidden && !pop.matches(":hover")) {
        counting = true;
        since = Date.now();
        timer = setTimeout(tick, POP_SEEN_MS - seen);
      }
    }
    document.addEventListener("visibilitychange", tick);
    pop.addEventListener("pointerenter", tick);
    pop.addEventListener("pointerleave", tick);
    tick();
  }
  let updatePopSeen = "";
  function renderUpdatePop() {
    const old = $("#update-pop");
    const u = state.update;
    const show = u && u.available && u.latest && recall("updateDismissed") !== u.latest && updatePopSeen !== u.latest;
    if (!show) {
      if (old && !old.dataset.busy) old.remove();
      return;
    }
    const stage = u.stage || "";
    if (old && old.dataset.version === u.latest && old.dataset.stage === stage) {
      if (stage === "downloading") setText(old.querySelector(".up-progress"), `${u.progress ?? 0} %`);
      return;
    }
    if (old) old.remove();
    const pop = document.createElement("div");
    pop.id = "update-pop";
    pop.className = "update-pop";
    pop.dataset.version = u.latest;
    pop.dataset.stage = stage;
    const words = stage === "downloading" ? `<b>viberoom ${esc(u.latest)}</b> is out, and on its way: <span class="up-progress">${u.progress ?? 0} %</span>. You have ${esc(u.current)}.`
      : stage === "ready" ? `<b>viberoom ${esc(u.latest)}</b> is ready. You have ${esc(u.current)}.`
      : `<b>viberoom ${esc(u.latest)}</b> is out. You have ${esc(u.current)}.`;
    const go = stage === "downloading" ? "" : UI.html("button", { label: stage === "ready" ? "Restart to update" : "Update now and restart", kind: "primary", size: "sm", hook: "up-go" });
    pop.innerHTML = `<div class="up-main"><div class="up-text">${words}</div>${go}</div>
      <div class="up-side">${UI.html("icon-button", { icon: "close", title: "Not now", size: "sm", hook: "up-x" })}${UI.html("icon-button", { icon: "settings", title: "Update settings", size: "sm", hook: "up-settings" })}</div>`;
    pop.querySelector(".up-x").addEventListener("click", () => {
      remember("updateDismissed", u.latest);
      pop.remove();
    });
    pop.querySelector(".up-settings").addEventListener("click", () => openSettings("system"));
    pop.querySelector(".up-go")?.addEventListener("click", () => installUpdate(pop, u.latest));
    $("#rail-pops").appendChild(pop);
    closesWhenSeen(pop, () => {
      if (pop.dataset.busy) return;
      updatePopSeen = u.latest;
      pop.remove();
    });
  }
  const runOf = (version) => (version && version.pid && version.startedAt ? { id: `${version.pid}.${version.startedAt}`, build: version.build || "", startedAs: version.startedAs || "by-hand" } : null);
  function hubSwap(before, now) {
    if (!now || !before || !before.id) return null;
    if (before.id === now.id) return null;
    return { id: now.id, was: before.build || "", build: now.build || "", startedAs: now.startedAs || "by-hand" };
  }
  function buildWhen(build) {
    const at = new Date(build);
    if (!build || Number.isNaN(at.getTime())) return "an unknown time";
    const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return at.toDateString() === new Date().toDateString() ? time : `${at.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
  }
  function hubSwapWords(swap) {
    const build = swap.was === swap.build
      ? "The build is the same one as before."
      : `The build is now the one from ${esc(buildWhen(swap.build))} — you were on ${esc(buildWhen(swap.was))}.`;
    const how = swap.startedAs === "at-login" ? "It came up with the computer."
      : swap.startedAs === "replacing-another" ? "It replaced the one that was running."
      : "It was started by hand.";
    return `<b>viberoom restarted.</b> ${build} ${how}`;
  }
  function noteHubRun() {
    const now = runOf(state.version);
    if (!now) return;
    let before = null;
    try {
      before = JSON.parse(recall("hubRun") || "null");
    } catch {
      before = null;
    }
    const swap = hubSwap(before, now);
    if (swap) remember("hubSwap", JSON.stringify(swap));
    remember("hubRun", JSON.stringify({ id: now.id, build: now.build }));
    renderHubPop();
  }
  function renderHubPop() {
    const old = $("#hub-pop");
    let swap = null;
    try {
      swap = JSON.parse(recall("hubSwap") || "null");
    } catch {
      swap = null;
    }
    const now = runOf(state.version);
    if (swap && now && swap.id !== now.id) {
      forget("hubSwap");
      swap = null;
    }
    if (!swap) {
      if (old) old.remove();
      return;
    }
    if (old && old.dataset.run === swap.id) return;
    if (old) old.remove();
    const pop = document.createElement("div");
    pop.id = "hub-pop";
    pop.className = "update-pop hub-pop";
    pop.dataset.run = swap.id;
    pop.innerHTML = `<div class="up-main"><div class="up-text">${hubSwapWords(swap)}</div></div>
      <div class="up-side">${UI.html("icon-button", { icon: "close", title: "Got it", size: "sm", hook: "hp-x" })}</div>`;
    const gotIt = () => {
      forget("hubSwap");
      pop.remove();
    };
    pop.querySelector(".hp-x").addEventListener("click", gotIt);
    $("#rail-pops").appendChild(pop);
    closesWhenSeen(pop, gotIt);
  }
  function renderRestartPop() {
    const old = $("#restart-pop");
    const r = state.restart && state.restart.pending;
    if (!r) {
      if (old) old.remove();
      return;
    }
    const waiting = r.waitingFor || [];
    const quiet = r.quietSince ? Date.now() - r.quietSince : 0;
    const words = !waiting.length
      ? "<b>viberoom is restarting.</b> It comes back in a few seconds."
      : `<b>Restart when ${esc(nameList(waiting))} ${waiting.length > 1 ? "finish" : "finishes"}.</b> ${quiet >= QUIET_ENOUGH_MS
        ? `Nothing new from ${waiting.length > 1 ? "them" : "it"} for ${Math.round(quiet / 60000)} minutes.`
        : `Waiting ${esc(waitedFor(r.since))}.`}`;
    const acts = waiting.length
      ? `<div class="up-acts">${UI.html("button", { label: "Restart now", kind: "secondary", size: "sm", hook: "rp-now" })}${UI.html("button", { label: "Cancel", kind: "ghost", size: "sm", hook: "rp-cancel" })}</div>`
      : "";
    const pop = old || document.createElement("div");
    if (!old) {
      pop.id = "restart-pop";
      pop.className = "update-pop restart-pop";
      $("#rail-pops").appendChild(pop);
    }
    pop.innerHTML = `<div class="up-main"><div class="up-text">${words}</div>${acts}</div>`;
    const now = pop.querySelector(".rp-now");
    const cancel = pop.querySelector(".rp-cancel");
    if (now) now.addEventListener("click", () => void post("/api/restart", { when: "now" }).catch(showError));
    if (cancel) cancel.addEventListener("click", () => void post("/api/restart/cancel", {}).catch(showError));
    clearTimeout(restartPopTimer);
    if (waiting.length) restartPopTimer = setTimeout(renderRestartPop, 30000);
  }
  let restartPopTimer = null;
  const QUIET_ENOUGH_MS = 5 * 60000;
  function nameList(names) {
    return names.length <= 1 ? (names[0] || "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  function waitedFor(since) {
    const s = Math.max(0, Math.round((Date.now() - since) / 1000));
    if (s < 60) return "a moment";
    const m = Math.round(s / 60);
    return m === 1 ? "a minute" : `${m} minutes`;
  }
  async function installUpdate(pop, version) {
    const go = pop.querySelector(".up-go");
    const text = pop.querySelector(".up-text");
    pop.dataset.busy = "1";
    go.disabled = true;
    UI.setState(go, "loading");
    text.innerHTML = `Installing <b>viberoom ${esc(version)}</b>… this takes a moment.`;
    try {
      await post("/api/update/install", {}, { deadline: 10 * 60000 });
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
      const active = nav === state.view;
      b.classList.toggle("active", active);
    });
    renderRailRooms();
    const s = state.settings;
    if (s) {
      setHtml(els.railMeAvatar, avatar(meAvatarData(), 44, { kind: "bare" }));
      setText(els.railMeLabel, s.humanName);
    }
    const open = els.app.classList.contains("rail-open");
    els.railToggle.title = open ? "Collapse the menu" : "Expand the menu";
    setHtml(els.railToggle, rig(open ? "collapse" : "expand"));
  }

  function activeRooms() {
    const ids = state.openRooms.filter((id) => state.rooms.has(id));
    if (state.currentRoomId && state.rooms.has(state.currentRoomId) && !ids.includes(state.currentRoomId)) ids.push(state.currentRoomId);
    return ids.map((id) => state.rooms.get(id));
  }

  let unseenHere = 0;
  let shownUnseen = -1;
  const ARRIVAL_FRESH_MS = 120_000;
  function attending() {
    return document.visibilityState === "visible" && document.hasFocus();
  }
  function unseenCount() {
    let n = unseenHere;
    for (const count of state.unread.values()) n += count;
    return n;
  }
  function showAttention() {
    const n = (state.settings || {}).appBadge === false ? 0 : unseenCount();
    if (n === shownUnseen) return;
    shownUnseen = n;
    document.title = n ? `(${n > 99 ? "99+" : n}) viberoom` : "viberoom";
    if (n) document.documentElement.dataset.unseen = String(n);
    else delete document.documentElement.dataset.unseen;
    if ("setAppBadge" in navigator) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  }
  function attentionBack() {
    if (!attending()) return;
    unseenHere = 0;
    showAttention();
  }
  window.addEventListener("focus", attentionBack);
  document.addEventListener("visibilitychange", attentionBack);
  function noticeArrival(room, m) {
    const reply = m.kind === "chat" && m.from !== "human";
    const needsYou = m.kind === "system" && m.details?.tone === "attention" && m.details?.about === "room";
    if (!reply && !needsYou) return;
    const looking = attending();
    if (reply && room.id !== state.currentRoomId) state.unread.set(room.id, (state.unread.get(room.id) || 0) + 1);
    else if (reply && !looking) unseenHere++;
    showAttention();
    if (!looking && Date.now() - (m.ts || 0) < ARRIVAL_FRESH_MS) knock(room, m, needsYou);
    if (reply) readArrival(room, m);
  }

  function readAloud(m, queued = false) {
    const r = state.voice?.reading;
    if (!r || r.reader === "off" || !r.ready) {
      if (!queued) {
        toast(`${r?.reason || "No reader is chosen yet"}: Settings → Voice.`, "warn");
        openSettings("voice");
      }
      return;
    }
    const answer = m.answerFrom > 0 && m.answerFrom < String(m.text || "").length ? m.text.slice(m.answerFrom) : m.text;
    const text = VIBEROOM_READER.speakable(answer);
    if (!text) return void (!queued && toast("There are no words to read in it: only code or pictures.", "warn"));
    const how = r.reader === "system" ? { mode: "system", voice: r.voice, language: state.voice.language || navigator.language } : { mode: "provider" };
    if (queued) reader.queue(m.id, text, how);
    else reader.read(m.id, text, how);
  }
  function readArrival(room, m) {
    const r = state.voice?.reading;
    if (!r || r.auto === "off" || !r.ready || r.reader === "off") return;
    if (room.id !== state.currentRoomId || document.visibilityState !== "visible" || voiceControl.listening) return;
    if (Date.now() - (m.ts || 0) >= ARRIVAL_FRESH_MS) return;
    if (r.auto === "to-me" && !(m.to || []).includes("human")) return;
    readAloud(m, true);
  }
  function drawReading(key, st) {
    const el = els.messages.querySelector(`.msg[data-id="${CSS.escape(key)}"]`);
    if (el) drawReadingOn(el, st);
  }
  function drawReadingOn(el, st) {
    const on = st === "loading" || st === "reading";
    el.classList.toggle("reading", on);
    const button = el.querySelector('.head [data-act="read"]');
    if (!button) return;
    button.innerHTML = ic(on ? "stop" : "speaker");
    UI.setState(button, on ? "on" : null);
    const words = on ? "Stop reading" : "Read it aloud";
    button.removeAttribute("title");
    button.dataset.hint = words;
    button.setAttribute("aria-label", words);
    button.setAttribute("aria-pressed", String(on));
  }
  function knock(room, m, needsYou) {
    const mode = (state.settings || {}).notifyReplies || "every";
    if (mode === "off" || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (mode === "to-me" && !needsYou && !(m.to || []).includes("human")) return;
    const words = String(m.text || "").replace(/```[\s\S]*?```/g, " [code] ").replace(/[*_`>#|]/g, "").replace(/\s+/g, " ").trim();
    try {
      const note = new Notification(needsYou ? room.name : `${m.fromName} · ${room.name}`, {
        body: words.length > 180 ? `${words.slice(0, 179)}…` : words,
        tag: `viberoom-room-${room.id}`, renotify: true, icon: "/icon-256.png?v=12",
      });
      note.onclick = () => { window.focus(); selectRoom(room.id); note.close(); };
    } catch { }
  }
  function askToKnock(again = false) {
    if (typeof Notification === "undefined" || Notification.permission !== "default") return Promise.resolve();
    if ((state.settings || {}).notifyReplies === "off" || (!again && recall("notify-asked"))) return Promise.resolve();
    remember("notify-asked", "1");
    return Notification.requestPermission().catch(() => {});
  }
  function notifyPermissionRow(row) {
    const allowed = typeof Notification === "undefined" ? "none" : Notification.permission;
    if (allowed === "granted") return "";
    if (allowed === "none") return row({ label: "Not on this system", status: "This window cannot show notifications of the system. The count on the icon still works.", statusTone: "warn" });
    if (allowed === "denied") return row({ label: "Blocked on this computer", status: "The system or the browser was told no. Allow notifications for viberoom in the browser's site settings (the icon left of the address) or in the system's settings.", statusTone: "warn" });
    return row({ label: "Not allowed yet", hint: "The system asks once, the first time you send a message; or ask it now.", control: actHtml({ label: "Allow…", id: "sp-notify-allow" }) });
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


  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  const drawnHtml = new WeakMap();
  function setHtml(el, html) {
    if (drawnHtml.get(el) === html) return;
    el.innerHTML = html;
    drawnHtml.set(el, html);
  }

  function arrival(el) {
    el.classList.add("arrive");
    const done = (event) => {
      if (event && event.target !== el) return;
      el.classList.remove("arrive");
      el.removeEventListener("animationend", done);
    };
    el.addEventListener("animationend", done);
    setTimeout(done, 1200);
  }

  function arriveAll(view) {
    for (const list of view === "rooms" ? [els.roomList, els.roomsGrid] : [els.roomList]) {
      for (const node of list.children) if (!node.classList.contains("arrive")) arrival(node);
    }
  }

  let overviewFrame = 0;
  function renderOverviewSoon() {
    if (overviewFrame) return;
    overviewFrame = requestAnimationFrame(() => {
      overviewFrame = 0;
      renderRail();
      if (state.view === "rooms" || state.view === "home") {
        renderSideRooms();
        renderRoomsGrid();
      }
    });
  }
  setInterval(() => {
    if (state.view === "rooms" || state.view === "home") renderOverviewSoon();
  }, 60000);


  function roomStats(room) {
    const agents = room.participants.filter((p) => p.kind === "agent");
    const online = agents.filter((p) => p.status !== "offline" && p.status !== "left" && p.status !== "unstaffed").length;
    const waiting = agents.filter((p) => p.status === "unstaffed").length;
    const loadedChats = room.messages.filter((m) => m.kind === "chat");
    const chats = loadedChats.length ? loadedChats : room.history?.lastChat ? [room.history.lastChat] : [];
    const last = room.history?.lastChatAt ?? (chats.length ? chats[chats.length - 1].ts : room.createdAt);
    const thinking = agents.some((p) => p.status === "thinking");
    return { agents, online, waiting, chats, last, thinking, unread: state.unread.get(room.id) || 0 };
  }

  function sortedRooms() {
    const last = new Map([...state.rooms.values()].map((room) => [room, roomStats(room).last]));
    return [...state.rooms.values()].sort((a, b) => last.get(b) - last.get(a));
  }


  function renderSideSkills() {
    setText(els.sideRoomsTitle, "Skills by room");
    const q = state.roomSearch.toLowerCase();
    const rooms = sortedRooms().filter((room) => !q || room.name.toLowerCase().includes(q));
    KeyedList.patch(els.roomList, [null, ...rooms], {
      key: "entry",
      id: (room) => (room ? `skills:${room.id}` : "skills:all"),
      make: (room) => {
        const li = document.createElement("li");
        const roomId = room ? room.id : null;
        li.addEventListener("click", (e) => {
          if (roomId && e.target.closest(".goto-room")) return selectRoom(roomId);
          state.skillsRoom = roomId;
          renderSideSkills();
          renderSkillsPage();
        });
        return li;
      },
      fill: (li, room, _index, fresh) => {
        const selected = (room ? room.id : null) === (state.skillsRoom || null);
        li.classList.toggle("selected", selected);
        if (!room) {
          setHtml(li, `${UI.html("room-mark", { icon: "skills", title: "All skills" })}<div class="p-body"><div class="p-name"><span>All skills</span></div><div class="p-preview">${(state.skills || []).length} in the library</div></div>`);
        } else {
          const held = new Set();
          for (const p of room.participants) for (const s of p.skills || []) held.add(s.toLowerCase());
          setHtml(li, `${roomMark(room)}<div class="p-body"><div class="p-name"><span>${esc(room.name)}</span></div><div class="p-preview">${held.size ? `${held.size} skill${held.size === 1 ? "" : "s"} in use` : "no skills attached"}</div></div>${selected ? `<div class="p-actions">${UI.html("icon-button", { icon: "forward", title: "Go to the room", size: "sm", hook: "goto-room" })}</div>` : ""}`);
        }
        if (fresh) arrival(li);
      },
    });
  }

  function renderSideRooms() {
    if (state.view === "skills") return renderSideSkills();
    setText(els.sideRoomsTitle, "Rooms");
    const q = state.roomSearch.toLowerCase();
    const rooms = sortedRooms().filter((room) => !q || room.name.toLowerCase().includes(q) || (room.settings.topic || "").toLowerCase().includes(q));
    KeyedList.patch(els.roomList, rooms.length ? rooms : [null], {
      key: "entry",
      id: (room) => (room ? `room:${room.id}` : "rooms:none"),
      make: (room) => {
        const li = document.createElement("li");
        if (room) {
          const roomId = room.id;
          li.addEventListener("click", () => selectRoom(roomId));
        } else {
          li.className = "hint";
          li.style.cursor = "default";
        }
        return li;
      },
      fill: (li, room, _index, fresh) => {
        if (!room) {
          setText(li, q ? "No room matches." : "No rooms yet.");
          return;
        }
        const st = roomStats(room);
        li.classList.toggle("selected", room.id === state.currentRoomId);
        const lastChat = st.chats[st.chats.length - 1];
        const preview = lastChat ? `${lastChat.fromName}: ${String(lastChat.text).replace(/\s+/g, " ")}` : room.settings.topic || `${st.agents.length} vibemate${st.agents.length === 1 ? "" : "s"}`;
        setHtml(li, `${roomMark(room)}
        <div class="p-body">
          <div class="p-name"><span>${esc(room.name)}</span>${st.thinking ? '<span class="live-dot" title="a vibemate is replying"></span>' : ""}</div>
          <div class="p-preview">${esc(preview)}</div>
        </div>
        <div class="p-right"><span>${esc(relTime(st.last))}</span>${st.unread ? `<span class="count-pill">${st.unread}</span>` : ""}</div>`);
        if (fresh) arrival(li);
      },
    });
  }


  const HUSH_FACE = '<span class="hush-face" aria-hidden="true"></span>';
  const FEATURES = [
    { tone: "lav", emoji: "🏠", title: "Rooms", text: "A room is a folder and a topic. Every vibemate in it works in that folder, and the history stays with the room." },
    { tone: "mint", emoji: "🤖", title: "Vibemates", text: "Summon any installed coding agent, give it a Vibename, a Vibersona and a Vibeface. Several in one room is the point.", strip: "vendors" },
    { tone: "warm", emoji: "💬", title: "Talk to all, or to one", text: "Write to the room and everyone answers in turn; @Name one of them and the others just listen. They read each other's replies." },
    { tone: "warm", emoji: "🧠", title: "Memory", text: "A room forgets nothing. Every word stays with it, and the vibemates can look back through everything — absolutely everything — even from before they joined or after a restart. What other rooms may see is your choice." },
    { tone: "sky", emoji: "🔌", title: "Connections", text: "Connect Jira, Notion, Linear and the others once, and the vibemates can look things up there in every room. You sign in at the system itself; before anything is written, you see the request and say yes.", strip: "systems" },
    { tone: "peach", emoji: "🧩", title: "Skills", text: "Reusable instructions in your library. Attach them to vibemates, invoke one with /name, or let a vibemate write its own." },
    { tone: "lav", emoji: "📱", title: "From your phone", text: "Pair Telegram and the rooms come with you: read what the vibemates wrote, answer them, stop a reply — from the phone in your pocket. Your own bot, paired once under Settings → Channels." },
    { tone: "rose", face: HUSH_FACE, title: "Hush", text: "Too much at once? One click stops every running reply. The vibemates stay quiet until you write again." },
    { tone: "sky", emoji: "📊", title: "Links and diagrams", text: "Links and file paths open on your machine with one click. A ```mermaid block in a reply turns into a diagram." },
    { tone: "orchid", emoji: "🎨", title: "Looks", text: "VibeClassic and its dark twin, Terminal, Clay, Eye Comfort (the look the research on tired eyes asks for) or 3D clayful (soft clay objects, with weight): pick one with the button above or under Settings → Appearance, and fine-tune its paper, bubbles, ink and corners." },
  ];
  const HOME_SYSTEMS = 8;
  const STEPS = [
    { n: 1, title: "Open a room", text: "Give it a name and a folder. The folder is where the vibemates read and write." },
    { n: 2, title: "Summon a vibemate", text: "Pick Claude, Codex, Gemini, Cursor, OpenCode or Copilot; name it, give it a face." },
    { n: 3, title: "Say hello", text: "Enter sends. @Name addresses one vibemate, /skill invokes a skill. Watch them talk." },
  ];
  let homeParts = null;
  function buildHome() {
    els.homeView.innerHTML = `
      <div class="home-inner">
        <section class="hero">
          <div class="hero-text">
            <div class="hero-eyebrow">viberoom</div>
            <h1></h1>
            <p>One chat, many coding agents. Summon your vibemates into a room, talk to all of them at once, and let them talk to each other.</p>
            <div class="hero-actions">
              ${UI.html("button", { label: "Open room", icon: "rooms", size: "cta", id: "home-open-room", hook: "hero-cta" })}
              ${UI.html("button", { label: "Change the look", icon: "eye", size: "cta", id: "home-change-look", hook: "hero-cta", title: "Settings → Appearance: the looks and their fine-tuning" })}
            </div>
          </div>
          <div class="hero-art" aria-hidden="true">
            <div class="ha-bubble ha-a"><span class="ha-face">🦊</span><span>Ship the login fix today?</span></div>
            <div class="ha-bubble ha-b"><span class="ha-face">🤖</span><span>On it — tests first.</span></div>
            <div class="ha-bubble ha-c"><span class="ha-face">🐼</span><span>Reviewing the diff now.</span></div>
            <div class="ha-spark">✦</div>
          </div>
        </section>
        <section class="home-section">
          <div class="home-head"><h2></h2><button class="linklike" id="home-all-rooms" hidden>All rooms ${ic("forward")}</button></div>
          <div class="home-rooms"></div>
        </section>
        <section class="home-section">
          <div class="home-head"><h2>What you can do here</h2></div>
          <div class="feature-grid">
            ${FEATURES.map((f) => `<div class="feature ${f.tone}"><div class="f-emoji">${f.face || f.emoji}</div><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p>${f.strip ? `<div class="home-vendors" data-strip="${f.strip}"></div>` : ""}</div>`).join("")}
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
    $("#home-change-look").addEventListener("click", () => openSettings("appearance"));
    const allRooms = $("#home-all-rooms");
    allRooms.addEventListener("click", () => setView("rooms"));
    const rooms = els.homeView.querySelector(".home-rooms");
    return {
      greeting: els.homeView.querySelector(".hero h1"),
      roomsTitle: rooms.previousElementSibling.querySelector("h2"),
      allRooms,
      rooms,
      vendors: els.homeView.querySelector('.home-vendors[data-strip="vendors"]'),
      systems: els.homeView.querySelector('.home-vendors[data-strip="systems"]'),
    };
  }

  function renderHome() {
    homeParts ||= buildHome();
    const s = state.settings || {};
    setText(homeParts.greeting, `${state.freshVibe ? "Welcome" : "Welcome back"}, ${s.humanName || "there"} 👋`);
    const rooms = sortedRooms().slice(0, 4);
    setText(homeParts.roomsTitle, rooms.length ? "Jump back in" : "Your first room");
    if (homeParts.allRooms.hidden !== !rooms.length) homeParts.allRooms.hidden = !rooms.length;
    KeyedList.patch(homeParts.rooms, rooms.length ? rooms : [null], {
      key: "entry",
      id: (room) => (room ? `room:${room.id}` : "rooms:none"),
      make: (room) => {
        if (!room) {
          const empty = document.createElement("div");
          empty.className = "home-room empty-room";
          empty.innerHTML = `${UI.html("room-mark", { icon: "plus" })}<span class="hr-body"><span class="hr-name">No rooms yet</span><span class="hr-sub">Open one, summon a vibemate, say hello.</span></span>`;
          return empty;
        }
        const tile = document.createElement("button");
        tile.className = "home-room";
        const roomId = room.id;
        tile.addEventListener("click", () => selectRoom(roomId));
        return tile;
      },
      fill: (tile, room) => {
        if (!room) return;
        const st = roomStats(room);
        const last = st.chats[st.chats.length - 1];
        const sub = last ? `${last.fromName}: ${String(last.text).replace(/\s+/g, " ").slice(0, 70)}` : room.settings.topic || `${st.agents.length} vibemate${st.agents.length === 1 ? "" : "s"}`;
        setHtml(tile, `${roomMark(room)}<span class="hr-body"><span class="hr-name">${esc(room.name)}</span><span class="hr-sub">${esc(sub)}</span></span>${st.unread ? `<span class="count-pill">${st.unread}</span>` : `<span class="hr-time">${esc(relTime(st.last))}</span>`}`);
      },
    });
    const vendors = state.recipes.filter((r) => !r.unavailableReason);
    setHtml(homeParts.vendors, (vendors.length ? vendors : state.recipes).map((r) => `<span class="home-vendor" title="${esc(r.vendor)}${r.unavailableReason ? " (not installed)" : ""}"${r.unavailableReason ? ' style="opacity:.45"' : ""}>${vendorLogo(r, "sm")}</span>`).join(""));
    const systems = state.connections || [];
    const joined = systems.filter((c) => c.state !== "not-connected");
    setHtml(homeParts.systems, (joined.length ? joined : systems.filter((c) => c.mark).slice(0, HOME_SYSTEMS)).map((c) => `<span class="home-vendor">${connectionMark(c, "sm")}</span>`).join(""));
  }


  const GRID_DOORS = [
    { entry: "door:open", icon: "plus", title: "Open a room", hint: "a space for you and some vibemates", open: () => openRoomDialog() },
    { entry: "door:template", icon: "rooms", title: "Start from a template", hint: "rules and vibemates, ready to summon", open: () => openTemplateDialog() },
  ];

  function renderRoomsGrid() {
    if (state.view === "home") return renderHome();
    const rooms = sortedRooms();
    setText(els.roomsSub, rooms.length ? `${rooms.length} room${rooms.length === 1 ? "" : "s"}. Pick one, or open a new one.` : "No rooms yet. Open one and summon some vibemates.");
    KeyedList.patch(els.roomsGrid, [...GRID_DOORS.map((door) => ({ door })), ...rooms.map((room) => ({ room }))], {
      key: "entry",
      id: (item) => (item.door ? item.door.entry : `room:${item.room.id}`),
      make: (item) => {
        const card = document.createElement("div");
        if (item.door) {
          card.className = "card cta hover room-card";
          card.innerHTML = `<div class="plus">${ic(item.door.icon)}</div><div>${item.door.title}</div><div class="hint">${item.door.hint}</div>`;
          card.addEventListener("click", item.door.open);
        } else {
          card.className = "card hover room-card";
          card.innerHTML = `<div class="rc-head"></div><div class="rc-topic"></div><div class="avatar-stack"></div><div class="rc-foot"></div>`;
          const roomId = item.room.id;
          card.addEventListener("click", () => selectRoom(roomId));
        }
        return card;
      },
      fill: (card, item, _index, fresh) => {
        if (item.room) fillRoomCard(card, item.room);
        if (fresh) arrival(card);
      },
    });
  }

  function fillRoomCard(card, room) {
    const st = roomStats(room);
    card.classList.toggle("current", room.id === state.currentRoomId);
    const [head, topic, faces, foot] = card.children;
    setHtml(head, `<div class="rc-title">${roomMark(room)}<h3>${esc(room.name)}</h3></div>${st.unread ? `<span class="count-pill">${st.unread}</span>` : st.thinking ? '<span class="live-dot" title="a vibemate is replying"></span>' : ""}`);
    setText(topic, room.settings.topic || (st.chats.length ? String(st.chats[st.chats.length - 1].text).slice(0, 140) : "Nothing said yet."));
    setHtml(faces, st.agents.slice(0, 5).map((p) => avatar(p, 26, { vendor: true, ring: true })).join("") || '<span class="hint">no vibemates yet</span>');
    const messages = HistoryWindow.count(room, true);
    setHtml(foot, `<span>${st.agents.length} vibemate${st.agents.length === 1 ? "" : "s"} · ${messages} message${messages === 1 ? "" : "s"}</span><span>${esc(relTime(st.last))}</span>`);
  }


  function offlineAgents(room, includeMuted = false) {
    return room ? room.participants.filter((p) => p.kind === "agent" && p.status === "offline" && (includeMuted || !p.muted)) : [];
  }

  function renderSideRoom() {
    updateCastGate(currentRoom());
    renderWedgeBanner(currentRoom());
    const room = currentRoom();
    if (!room) return;
    els.sideRoomName.textContent = room.name;
    const roomFace = room.settings.emoji || "", roomPicture = window.Avatars.faceUrl(roomFace);
    if (roomPicture) els.sideRoomEmoji.innerHTML = `<img class="room-pic" src="${roomPicture}" alt="">`;
    else els.sideRoomEmoji.textContent = roomFace;
    const st = roomStats(room);
    els.sideRoomCount.textContent = `${st.agents.length} vibemate${st.agents.length === 1 ? "" : "s"}${st.agents.length ? ` · ${st.online} online` : ""}${st.waiting ? ` · ${st.waiting} waiting` : ""}`;
    const rowSpec = {
      key: "id",
      id: (p) => p.id,
      make: () => document.createElement("li"),
      fill: (li, p, _at, fresh) => {
        const selected = state.detailsOpen && state.selection.kind === "participant" && state.selection.id === p.id;
        const asleep = p.kind === "agent" && (p.status === "offline" || p.status === "left");
        const mutedStartup = p.status === "offline" && p.muted && p.startupSkipped === "muted";
        const unstaffed = p.kind === "agent" && p.status === "unstaffed";
        const shown = shownStatus(room, p);
        const className = (p.kind === "human" ? "me" : "") + (selected ? " selected" : "") + (asleep ? " offline" : "") + (unstaffed ? " unstaffed" : "");
        const sub = p.kind === "human" ? "you, the human" : [p.tagline ? `"${p.tagline}"` : "", p.agentVendor || p.agentLabel, p.model].filter(Boolean).join(" · ");
        const working = p.kind === "agent" && (p.status === "thinking" || p.status === "queued");
        const troubled = p.kind === "agent" && !working && p.trouble && (p.status === "error" || p.trouble.stage === "turn" || (p.trouble.actions && p.trouble.actions.length > 0));
        const unplugged = vendorLoggedOut(p);
        const loginRow = unplugged && p.status === "offline" && !troubled ? `<div class="p-fix">${UI.html("button", { label: "Log in", kind: "primary", size: "xs", act: "open-login-dialog", icon: "lock", title: `${p.agentVendor || "The vendor"} is not logged in: log in, and ${p.name} comes back`, data: { recipe: p.agentType, purpose: "login" } })}</div>` : "";
        const warn = mutedStartup ? `<div class="p-warn muted-start" title="Unmute and reconnect when you want this vibemate to return">${esc(p.statusDetail || "Not summoned — muted")}</div>` : troubled ? troubleHtml(p) : working ? "" : p.statusDetail && (p.status === "offline" || p.status === "error" || p.failedTurns) ? `<div class="p-warn" title="${esc(p.statusDetail)}">${esc(p.statusDetail)}</div>${loginRow}` : loginRow;
        const status = unstaffed
          ? UI.html("badge", { label: "summon", tone: "attention", title: "Click to summon this vibemate: pick the coding agent that runs it" })
          : asleep
          ? `<span class="zzz" title="${esc(STATUS_LABEL[p.status] || p.status)}">zzz</span>`
          : p.kind === "agent" && p.status !== "idle" ? UI.html("badge", { label: STATUS_LABEL[shown] || shown, tone: STATUS_TONE[shown] || "plain", dot: p.status === "thinking" }) : "";
        const avatarHtml = avatar(p.kind === "human" ? meAvatarData() : p, 44, { vendor: true, muted: p.muted, unplugged, me: p.kind === "human", alert: p.kind === "agent" && (p.status === "error" || (p.status === "offline" && !!(p.trouble && p.trouble.actions && p.trouble.actions.length))), dim: unstaffed ? "unstaffed" : asleep ? "asleep" : undefined });
        const statusValue = p.kind === "agent" ? (shown === "working" ? "writing" : shown) || "idle" : "";
        const bodyHtml = `<div class="p-body">
            <div class="p-name"><span>${esc(p.name)}</span>${p.muted ? UI.html("badge", { label: "muted", tone: "muted" }) : ""}${status}</div>
            <div class="p-sub">${esc(sub)}</div>
            ${warn}
          </div>
          <div class="p-actions">
            ${p.kind === "agent" && p.status === "offline" && !unplugged ? UI.html("row-button", { icon: "refresh", title: `Wake ${p.name} up: reconnect it to the room`, act: "wake" }) : ""}
          </div>`;
        if (fresh) {
          li.innerHTML = avatarHtml + bodyHtml + (p.kind === "agent" ? UI.html("row-button", { icon: "settings", title: `Open ${p.name}'s panel`, act: "panel" }) + UI.html("row-button", { icon: "go-to-message", title: `Go to ${p.name}'s last reply`, act: "last-reply" }) : "");
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
      },
    };
    KeyedList.patch(els.participantsMe, room.participants.filter((p) => p.kind === "human"), rowSpec);
    KeyedList.patch(els.participants, room.participants.filter((p) => p.kind === "agent"), rowSpec);
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
    const start = composer.selectionStart || composer.value.length;
    const before = composer.value.slice(0, start);
    const prefix = before && !/\s$/.test(before) ? " " : "";
    composer.setRangeText(`${prefix}@${name} `, start, start, "end");
    composer.focus();
  }


  function renderChatHead() {
    renderAutomationBadge();
    composer.refresh();
    const room = currentRoom();
    renderWorkingNow();
    if (!room) return void setHtml(els.chatRoomSub, "");
    const directory = room.dir.split(/[\\/]/).filter(Boolean).slice(-1)[0] || room.dir;
    setHtml(els.chatRoomSub,
      `<button type="button" data-ui="button" data-kind="ghost" data-size="sm" class="dir-chip open-link" data-open-kind="directory" data-open="${esc(room.dir)}" title="${esc(`Open folder: ${room.dir}`)}" aria-label="${esc(`Open folder: ${room.dir}`)}"><span class="pad" aria-hidden="true"></span>${rig("folder-solid")}<span class="dir-label">${esc(directory)}</span></button>`);
  }

  function renderAutomationBadge() {
    const count = state.automationPending?.[currentRoom()?.id] || 0;
    const button = $("#automations-btn");
    if (button) {
      setHtml(button, `<span class="pad" aria-hidden="true"></span>${rig("clock-solid")}<span class="automation-count" aria-hidden="true" hidden></span>`);
      const badge = button.querySelector(".automation-count");
      setText(badge, count ? String(count) : "");
      badge.hidden = !count;
      button.title = count ? `Automations: ${count} proposal${count === 1 ? "" : "s"} to review` : "Automations: scheduled tasks and reminders";
      button.setAttribute("aria-label", button.title);
    }
  }


  function messageMatches(m) {
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    return m.text.toLowerCase().includes(q) || (m.fromName || "").toLowerCase().includes(q) || (m.quotes || []).some((x) => (x.text || "").toLowerCase().includes(q));
  }

  function nowNameHtml(m, p) {
    return p && p.name && m.fromName && p.name !== m.fromName ? `<span class="now-name" title="${esc(m.fromName)} is called ${esc(p.name)} now">Now: ${esc(p.name)}</span>` : "";
  }

  function refreshNowNames(room, p) {
    for (const el of els.messages.querySelectorAll(`.msg.agent[data-from="${cssEscape(p.id)}"]`)) {
      const name = el.querySelector(".head .name");
      if (!name) continue;
      el.querySelector(".head .now-name")?.remove();
      const html = nowNameHtml({ fromName: name.textContent }, p);
      if (html) name.insertAdjacentHTML("afterend", html);
    }
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
            <div>${d.via === "tool" ? "The vibemate called the room's load_skill tool during its turn and received the skill text as the tool result." : "The vibemate asked for the skill with the marker; the room attached the skill and re-ran the turn on the same messages."}</div>
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

  function landing(el) {
    el.classList.add("landing");
    const own = (e) => { if (e.target === el) done(); };
    const done = () => { el.classList.remove("landing"); el.removeEventListener("animationend", own); };
    el.addEventListener("animationend", own);
    setTimeout(done, 1200);
    return el;
  }

  function messageElement(room, m) {
    const el = buildMessageElement(room, m);
    noteDrawn(el, m);
    if (editors.get(m.id)?.roomId === room.id) openInlineEditor(el, room, m, { focus: false });
    return el;
  }
  function buildMessageElement(room, m) {
    const el = document.createElement("div");
    el.dataset.id = m.id;
    el.dataset.seq = m.seq;
    el.dataset.from = m.from;
    el.dataset.streaming = m.streaming ? "1" : "0";
    if (m.bodyMissing) { fillBodyPlaceholder(el, room, m); return el; }
    if (state.watched.has(m.id)) watchedLeave.observe(el);
    if (m.kind === "hidden") {
      el.className = "msg hidden";
      renderHidden(el, m);
      return el;
    }
    if (m.kind === "system") {
      if (m.audience === "agents") {
        el.className = "msg hidden";
        el.innerHTML = `<details class="hidden-turn"><summary>${ic("info")} room → vibemates · ${esc(m.text.split(":")[0])}</summary><div class="hidden-body"><div class="hidden-label">What the vibemates were told</div><div class="hidden-text">${esc(m.text)}</div></div></details>`;
        return el;
      }
      const details = m.details || {};
      const who = details.agentId ? findById(room, details.agentId) : null;
      const tone = ["attention", "error", "hush"].includes(details.tone) ? details.tone : "news";
      const face = who ? avatar(who, 20, {}) : tone === "hush" ? HUSH_FACE : "";
      el.className = "msg system";
      el.innerHTML = UI.html("hub-row", { text: m.text, tone, ref: details.refId || undefined, face: face ? UI.raw(face) : undefined, title: details.refId ? `${fullTime(m.ts)} · go to the reply` : fullTime(m.ts) });
      return el;
    }
    const p = findById(room, m.from) || { name: m.fromName, color: FALLBACK_COLOR(), kind: m.from === "human" ? "human" : "agent" };
    const mine = m.from === "human";
    el.className = "msg " + (mine ? "mine" : "agent");
    el.innerHTML = `
      <div class="bubble-col">
        <div class="head"><span class="head-av">${avatar(mine ? Object.assign(meAvatarData(), { color: colourOf(p) }) : p, 32, { vendor: true, me: mine })}</span><span class="name" style="color:${p.color}">${esc(m.fromName)}</span>${nowNameHtml(m, p)}<span class="edited" hidden></span>${mine ? UI.html("icon-button", { icon: "pencil", title: "Edit this message", kind: "ghost", size: "xs", act: "edit" }) : UI.html("icon-button", { icon: "speaker", title: "Read it aloud", kind: "ghost", size: "xs", act: "read" })}${UI.html("icon-button", { icon: "quote", title: "Quote this message in your next one", kind: "ghost", size: "xs", act: "quote" })}${UI.html("icon-button", { icon: "pin", title: "Pin this message", kind: "ghost", size: "xs", act: "pin" })}${UI.html("icon-button", { icon: "copy", title: "Copy this message, formatted; the tool calls stay here", kind: "ghost", size: "xs", act: "copy" })}${UI.html("icon-button", { icon: "arrow-up", title: "Go to their previous message", kind: "ghost", size: "xs", act: "up" })}${UI.html("icon-button", { icon: "arrow-down", title: "Go to their next message", kind: "ghost", size: "xs", act: "down" })}<span class="time" title="${esc(fullTime(m.ts))}">${time(m.ts)}</span></div>
        <div class="bubble">
          ${m.skill ? `<div class="skill-invoke" title="skill invocation: the vibemates that have this skill got its instructions with this message">${ic("skills")} skill <b>${esc(m.skill.name)}</b></div>` : ""}
          <div class="edit-box" hidden></div>
          <details class="thought" hidden><summary>thoughts</summary><div class="thought-text"></div></details>
          <div class="agent-notices"></div>
          <div class="tools-line"><div class="tools"></div></div>
          <div class="plan" hidden></div>
          <div class="text"></div>
          <div class="shots"></div>
          <div class="sounds" hidden></div>
          <div class="videos" hidden></div>
          ${UI.html("button", { label: "Show more", kind: "link", act: "more", hidden: true })}
          <div class="stop-note"></div>
          <div class="perms"></div>
          <div class="waiting" hidden></div>
        </div>
        <div class="meta"></div>
      </div>`;
    bindMessageActions(el, room.id);
    updateMessageElement(el, room, m);
    if (!mine && reader.state(m.id) !== "idle") drawReadingOn(el, reader.state(m.id));
    return el;
  }

  const devPromptsOn = () => devBuild() && state.settings?.devShowPrompts === true;
  function placeDevPrompt(el) {
    const wanted = devPromptsOn() && el.classList.contains("agent");
    const line = el.querySelector(".bubble .tools-line");
    const button = line?.querySelector(":scope > .dev-prompt-open");
    if (wanted && line) {
      const leading = !!el.querySelector(".bubble .live-tail");
      if (!button) line.insertAdjacentHTML(leading ? "afterbegin" : "beforeend", UI.html("button", { label: "Prompt", icon: "code", kind: "ghost", size: "xs", hook: "dev-prompt-open", title: "What viberoom sent this vibemate for this turn, exactly as it went" }));
      else if (leading && button !== line.firstElementChild) line.prepend(button);
      else if (!leading && button === line.firstElementChild) line.append(button);
      const panel = line?.querySelector(":scope > .dev-prompt");
      if (button && panel && button.nextElementSibling !== panel) button.after(panel);
    } else if (!wanted && button) {
      button.remove();
      el.querySelector(".bubble .dev-prompt")?.remove();
    }
  }
  function promptSections(text) {
    const out = [];
    const open = /^<([a-z][a-z-]*)\b[^>]*>/gm;
    let at = 0;
    for (let m = open.exec(text); m; m = open.exec(text)) {
      const close = text.indexOf(`</${m[1]}>`, m.index);
      if (close < 0) continue;
      const gap = text.slice(at, m.index);
      if (gap.trim()) out.push({ name: "", text: gap.replace(/^\n+|\n+$/g, "") });
      const end = close + m[1].length + 3;
      out.push({ name: m[1], text: text.slice(m.index, end) });
      at = end;
      open.lastIndex = end;
    }
    const rest = text.slice(at);
    if (rest.trim()) out.push({ name: "", text: rest.replace(/^\n+|\n+$/g, "") });
    return out;
  }
  function devMemorySearchHtml(m) {
    const sent = m.sent ? "" : " · the block had not changed, so it did not go again";
    const part = (words, body) => `<details class="dp-part"><summary><code>memory search · #${esc(String(m.seq))}</code><span class="dp-size">${esc(words)}</span></summary>${body}</details>`;
    if (m.pending) return part(`its search had not returned when this turn began${sent}`, '<p class="hint">No facts were given: the block said so and pointed the vibemate at search_history.</p>');
    const count = m.questions.length ? `${m.questions.length} question${m.questions.length === 1 ? "" : "s"}` : "no question";
    const why = m.fallback === "no model" ? "the sieve has no model"
      : m.fallback && m.fallback !== "slow" ? `the sieve's model ${m.fallback}`
      : "the sieve's model did not answer in time";
    const late = !m.late ? "" : m.late.questions ? `; it answered after ${m.late.ms} ms, too late` : `; it ended after ${m.late.ms} ms without questions (${m.late.failure})`;
    const unanswered = m.how !== "model" || m.unanswered === undefined ? ""
      : m.unanswered === "slow" ? `the sieve's model did not answer in ${m.modelMs} ms`
      : m.unanswered.startsWith("unavailable: ") ? `not waited for: the sieve's model was not answering (${m.unanswered.slice("unavailable: ".length)})`
      : `the sieve's model ${m.unanswered}`;
    const how = unanswered ? `${unanswered}${late}`
      : m.how === "model" ? `written by the sieve's model in ${m.modelMs} ms`
      : m.how === "split" ? `cut from the message, not rephrased: ${why}${late}`
      : "the whole message";
    const behind = m.newest ? ` · its facts not given: the search for #${m.newest}, the newest, had not returned when this turn began` : "";
    const list = m.questions.length
      ? `<ol class="dp-questions">${m.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>`
      : unanswered ? '<p class="hint">Nothing was searched: the block told the vibemate so and pointed it at search_history.</p>'
      : '<p class="hint">Nothing to look up in the memory: no search, no block.</p>';
    const lateList = m.late && m.late.questions && m.late.questions.length
      ? `<p class="hint">What the sieve's model wrote, ${esc(String(m.late.ms))} ms after it was asked:</p><ol class="dp-questions">${m.late.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>`
      : "";
    return part(`${count}, ${how}${sent}${behind}`, `${list}${lateList}`);
  }
  function devPromptHtml(p) {
    const parts = [];
    for (const block of p.blocks || []) {
      if (block.type === "text") parts.push(...promptSections(block.text));
      else parts.push({ name: "", text: block.type === "image" ? `[a picture: ${block.mimeType}, ${Math.round(block.bytes / 1024)} KB]` : `[a ${block.type} block]` });
    }
    const chars = (p.blocks || []).reduce((n, b) => n + (b.type === "text" ? b.text.length : 0), 0);
    const kind = p.correction ? " · a hidden correction" : p.hidden ? " · a hidden turn" : "";
    const head = `Sent to ${esc(p.vibemate)} at ${esc(new Date(p.at).toLocaleTimeString())}${kind} · ${parts.length} part${parts.length === 1 ? "" : "s"} · ${chars.toLocaleString()} characters`;
    const part = (s) => `<details class="dp-part"><summary><code>${esc(s.name ? `<${s.name}>` : "text")}</code><span class="dp-size">${s.text.length.toLocaleString()} characters</span></summary><pre>${esc(s.text)}</pre></details>`;
    return `<div class="dp-head"><span>${head}</span>${UI.html("button", { label: "Copy it all", kind: "ghost", size: "xs", hook: "dev-prompt-copy", title: "The prompt as it went, every block in its order" })}</div>${p.memory ? devMemorySearchHtml(p.memory) : ""}${parts.map(part).join("")}`;
  }
  els.messages.addEventListener("click", async (e) => {
    const open = e.target.closest(".dev-prompt-open");
    if (!open) return;
    const msg = open.closest(".msg[data-id]");
    let panel = msg.querySelector(".bubble .dev-prompt");
    if (panel) {
      panel.hidden = !panel.hidden;
      return;
    }
    panel = document.createElement("div");
    panel.className = "dev-prompt";
    panel.innerHTML = '<p class="hint">Reading what was sent…</p>';
    open.after(panel);
    try {
      const prompt = await get(roomApi(`/messages/${encodeURIComponent(msg.dataset.id)}/prompt`));
      panel.innerHTML = devPromptHtml(prompt);
      const all = (prompt.blocks || []).map((b) => (b.type === "text" ? b.text : `[a ${b.type} block]`)).join("\n");
      bindCopy(panel.querySelector(".dev-prompt-copy"), () => all, "");
    } catch (error) {
      panel.innerHTML = `<p class="hint">${esc(error.message || String(error))}</p>`;
    }
  });

  function setExpanded(el, roomId, m, open) {
    if (open) state.expanded.add(m.id);
    else state.expanded.delete(m.id);
    updateMessageElement(el, state.rooms.get(roomId), m);
  }
  const OWN_CLICKS = 'a, button, summary, input, textarea, select, label, [contenteditable="true"], [role="button"], .shot, [data-ui="tool-call"], .edit-box, .perms';
  function clickShowsMore(e, el) {
    if (state.settings?.showMoreOnClick === false) return false;
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (!el.querySelector(".bubble > .text.clamped") || e.target.closest(OWN_CLICKS)) return false;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) for (let i = 0; i < sel.rangeCount; i++) if (sel.getRangeAt(i).intersectsNode(el)) return false;
    return true;
  }

  function bindMessageActions(el, roomId) {
    const asItIsNow = () => {
      const now = state.rooms.get(roomId);
      if (!now) return null;
      return now.messages.find((x) => x.id === el.dataset.id) || (now.pinnedOlder || []).find((x) => x.id === el.dataset.id) || null;
    };
    el.querySelector('[data-act="more"]').addEventListener("click", () => {
      const now = asItIsNow();
      if (!now) return;
      const opening = !state.expanded.has(now.id);
      setExpanded(el, roomId, now, opening);
      if (!opening) scrollToMessage(el, "center");
    });
    el.querySelector(".bubble").addEventListener("click", (e) => {
      if (!clickShowsMore(e, el)) return;
      const now = asItIsNow();
      if (now) setExpanded(el, roomId, now, true);
    });
    const editBtn = el.querySelector('[data-act="edit"]');
    if (editBtn) editBtn.addEventListener("click", () => { const now = asItIsNow(); if (now) openInlineEditor(el, state.rooms.get(roomId), now); });
    const readBtn = el.querySelector('.head [data-act="read"]');
    if (readBtn) readBtn.addEventListener("click", () => { const now = asItIsNow(); if (now) readAloud(now); });
    el.querySelector('[data-act="quote"]').addEventListener("click", () => { const now = asItIsNow(); if (now) addQuote(now, ""); });
    el.querySelector('[data-act="copy"]').addEventListener("click", () => { const now = asItIsNow(); if (now) copyMessage(el, now); });
    el.querySelector('[data-act="pin"]').addEventListener("click", async () => {
      const now = asItIsNow();
      if (!now || now.pending) return;
      try {
        await post(`/api/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(now.id)}/pin`, { pinned: !now.pinned });
      } catch (error) {
        showError(error);
      }
    });
    el.addEventListener("pointerenter", () => refreshWalkArrows(el));
    for (const [act, back] of [["up", true], ["down", false]]) {
      el.querySelector(`.head [data-act="${act}"]`).addEventListener("click", async () => {
        const target = walkFrom(el, back);
        if (!target) return;
        if (!await jumpToId(target.id)) return;
        const landed = drawnRow(target.id);
        if (!landed) return;
        refreshWalkArrows(landed);
        const next = landed.querySelector(`.head [data-act="${act}"]`);
        if (next && !next.hidden) next.focus();
      });
    }
  }

  function walkFrom(el, back) {
    const room = currentRoom();
    if (!room) return null;
    const parts = foldParts(room);
    const rows = el.closest(".history-pins") ? parts.above : parts.drawn;
    const at = rows.findIndex(m => m.id === el.dataset.id);
    if (at < 0) return null;
    for (let i = at + (back ? -1 : 1); i >= 0 && i < rows.length; i += back ? -1 : 1) {
      const m = rows[i];
      if (m.kind === "chat" && m.from === el.dataset.from && messageMatches(m)) return m;
    }
    return null;
  }

  function refreshWalkArrows(el) {
    const up = el.querySelector('.head [data-act="up"]');
    const down = el.querySelector('.head [data-act="down"]');
    if (up) up.hidden = !walkFrom(el, true);
    if (down) down.hidden = !walkFrom(el, false);
  }

  function shotUrl(roomId, image) {
    if (image.url) return image.url;
    const version = state.rooms.get(roomId)?.resourceVersions?.[image.file];
    return `/api/rooms/${encodeURIComponent(roomId)}/files/${encodeURIComponent(image.file)}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
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

  function renderSounds(box, room, m) {
    if (!box) return;
    const sounds = m.audio || [];
    box.hidden = !sounds.length;
    const html = sounds
      .map((sound, i) => {
        const n = sound.n || i + 1;
        const said = sound.hearing ? '<p class="sound-note">Hearing it…</p>'
          : sound.words !== undefined ? (sound.words.trim() ? `<p class="sound-words">${esc(sound.words)}</p>` : '<p class="sound-note">No words were heard in it.</p>')
          : `<p class="sound-note">No words: ${esc(sound.unheard || "it was not heard")}</p>`;
        return `<figure class="sound" data-n="${n}"><figcaption><span class="shot-n">${n}</span>${ic("mic")}<span class="sound-name">${esc(sound.name)}</span>${sound.seconds ? `<span class="sound-len">${soundLength(sound.seconds)}</span>` : ""}</figcaption><audio controls preload="metadata" src="${esc(shotUrl(room.id, sound))}"></audio>${said}</figure>`;
      })
      .join("");
    if (box.dataset.drawn === html) return;
    box.dataset.drawn = html;
    box.innerHTML = html;
  }

  function renderVideos(box, room, m) {
    if (!box) return;
    const videos = m.video || [];
    box.hidden = !videos.length;
    const html = videos
      .map((clip, i) => {
        const n = clip.n || i + 1;
        return `<figure class="clip" data-n="${n}"><figcaption><span class="shot-n">${n}</span>${ic("video")}<span class="clip-name">${esc(clip.name)}</span>${clip.seconds ? `<span class="clip-len">${soundLength(clip.seconds)}</span>` : ""}</figcaption><video controls playsinline preload="metadata" src="${esc(shotUrl(room.id, clip))}"></video></figure>`;
      })
      .join("");
    if (box.dataset.drawn === html) return;
    box.dataset.drawn = html;
    box.innerHTML = html;
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
    const box = Layout.rect(dv.el);
    const w = Number(svg.dataset.w) || Layout.rect(svg).width || 1;
    const h = Number(svg.dataset.h) || Layout.rect(svg).height || 1;
    dv.fit = Math.max(DV_MIN, Math.min((box.width - 80) / w, (box.height - DV_BAR_SPACE - 32) / h, DV_FIT_MAX));
    dv.scale = dv.fit;
    dv.x = (box.width - w * dv.scale) / 2;
    dv.y = Math.max(16, (box.height - DV_BAR_SPACE - h * dv.scale) / 2);
    dvApply();
  }
  function dvZoom(factor, cx, cy) {
    const next = Math.min(DV_MAX, Math.max(DV_MIN, dv.scale * factor));
    const box = Layout.rect(dv.el);
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
    const rect = Layout.rect(svg);
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
      dvZoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, Layout.length(e.clientX), Layout.length(e.clientY));
    },
    { passive: false },
  );
  dv.el.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#dv-bar")) return;
    dv.dragging = true;
    dv.moved = false;
    dv.pointer = { x: Layout.length(e.clientX), y: Layout.length(e.clientY) };
    dv.el.setPointerCapture(e.pointerId);
    dv.el.classList.add("dragging");
  });
  dv.el.addEventListener("pointermove", (e) => {
    if (!dv.dragging) return;
    const x = Layout.length(e.clientX), y = Layout.length(e.clientY);
    const dx = x - dv.pointer.x, dy = y - dv.pointer.y;
    if (dx || dy) dv.moved = true;
    dv.x += dx;
    dv.y += dy;
    dv.pointer = { x, y };
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
    if (hubRow) return void jumpToId(hubRow.dataset.ref);
    const shot = e.target.closest(".shot");
    if (shot) return void openLightbox(shot.dataset.src, shot.title);
    const goto = e.target.closest(".quote .q-goto");
    if (goto) {
      const card = goto.closest(".quote");
      return void revealQuote(card.dataset, card.querySelector(".q-text")?.textContent || "");
    }
    const numbered = e.target.closest('[data-ui="message-ref"]');
    if (numbered) {
      if (!window.getSelection().isCollapsed) return;
      hidePeek();
      return void goToNumber(Number(numbered.dataset.seq));
    }
    const heard = e.target.closest(".audio-ref");
    if (heard) {
      const video = heard.classList.contains("video-ref");
      const player = heard.closest(".msg")?.querySelector(video ? `.clip[data-n="${heard.dataset.n}"] video` : `.sound[data-n="${heard.dataset.n}"] audio`);
      if (player && video) player.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (player) player.paused ? void player.play().catch(() => {}) : player.pause();
      return;
    }
    const ref = e.target.closest(".img-ref");
    if (!ref) return;
    const msg = ref.closest(".msg");
    const target = msg && msg.querySelector(`.shot[data-n="${ref.dataset.n}"]`);
    if (target) openLightbox(target.dataset.src, target.title);
  });

  function bodySupplied(p, m) {
    if (m.bodyDelivery) {
      const reader = m.bodyDelivery.readers?.[p.id];
      return !!reader && reader.epoch === p.deliveryEpoch && reader.version === m.bodyDelivery.version;
    }
    return p.lastSeenSeq != null && p.lastSeenSeq >= m.seq;
  }

  function waitingFor(room, m) {
    if (m.from !== "human" || m.kind !== "chat" || m.pending || !(m.seq > 0)) return [];
    return room.participants.filter(p => {
      if (p.kind !== "agent" || p.status !== "thinking") return false;
      if (m.to?.length && !m.to.includes(p.id)) return false;
      if (p.lastSeenSeq == null || p.lastSeenSeq >= m.seq) return false;
      if (m.bodyDelivery) return m.bodyDelivery.readers?.[p.id]?.epoch === p.deliveryEpoch && !!p.deliveryEpoch && !bodySupplied(p, m);
      return p.lastSeenSeq != null && p.lastSeenSeq < m.seq;
    });
  }

  function renderWaiting(el, room, m) {
    const box = el.querySelector(".waiting");
    if (!box) return;
    const agents = waitingFor(room, m);
    el.classList.toggle("waiting", agents.length > 0);
    box.hidden = !agents.length;
    if (!agents.length) { if (box.innerHTML) box.innerHTML = ""; box.waitingKey = null; return; }
    const names = agents.map((p) => p.name);
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const checking = agents.filter(p => p.skillChannel === "tool");
    const hint = !checking.length ? "" : checking.length === agents.length ? " They can check while working."
      : ` ${checking.map(p => p.name).join(", ")} can check while working.`;
    const bodyVersion = m.bodyDelivery?.version;
    const stoppable = agents.filter(p => p.activeTurnId && bodyVersion).map(p => ({ id: p.id, name: p.name, turnId: p.activeTurnId }));
    const stopLabel = stoppable.length === 1 ? `Stop ${stoppable[0].name}'s reply` : "Stop these replies";
    const html = `<span class="waiting-text">${ic("clock")} Not yet sent to ${esc(who)} — still working.${esc(hint)}</span>` +
      (stoppable.length ? UI.html("button", { label: stopLabel, kind: "inverse", size: "sm", act: "stop-waiting" }) : "");
    const waitingKey = JSON.stringify([html, bodyVersion, stoppable.map(p => p.turnId)]);
    if (box.waitingKey !== waitingKey) { box.innerHTML = html; box.waitingKey = waitingKey; }
    const button = box.querySelector('[data-act="stop-waiting"]');
    if (!button) return;
    button.onclick = async (e) => {
      if (currentRoom() !== room) return;
      const pending = waitingFor(room, m);
      const current = stoppable.filter(p => pending.some(now => now.id === p.id && now.activeTurnId === p.turnId));
      if (!current.length || m.bodyDelivery?.version !== bodyVersion) return void resyncStream();
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Stopping…";
      try {
        const stopped = await Promise.all(current.map(p => post(`/api/rooms/${encodeURIComponent(room.id)}/participants/${encodeURIComponent(p.id)}/cancel`,
          {turnId:p.turnId, messageId:m.id, bodyVersion})));
        if (stopped.some(result => result.stopped === "nothing")) resyncStream();
      } catch (error) {
        showError(error);
        btn.disabled = false;
        btn.textContent = stopLabel;
      }
    };
  }

  const openTools = new Set();
  const toolDetailsCache = new Map();
  const toolDetailsKey = (room, m, id) => `${room.id}/${m.id}/${id}`;
  function toolDetailsFor(room, m, call) {
    if (!call.detailsAvailable) return { state: "ready", value: call };
    const key = toolDetailsKey(room, m, call.toolCallId);
    let entry = toolDetailsCache.get(key);
    if (entry?.revision === call.detailsRevision) return entry;
    entry = { revision: call.detailsRevision, state: "loading", value: call };
    toolDetailsCache.set(key, entry);
    const part = encodeURIComponent;
    get(`/api/rooms/${part(room.id)}/messages/${part(m.id)}/tools/${part(call.toolCallId)}`).then(value => {
      entry.state = "ready"; entry.value = value;
    }, () => { entry.state = "error"; }).finally(() => {
      if (toolDetailsCache.get(key) !== entry) return;
      if (!openTools.has(call.toolCallId)) { toolDetailsCache.delete(key); return; }
      if (state.currentRoomId !== room.id || state.view !== "room") return;
      const latestRoom = state.rooms.get(room.id);
      if (!latestRoom) return;
      const current = HistoryWindow.knownMessages(latestRoom).find(row => row.id === m.id);
      const latest = current?.toolCalls?.find(c => c.toolCallId === call.toolCallId);
      if (!latest || latest.detailsRevision !== entry.revision) return;
      const el = els.messages.querySelector(`.msg[data-id="${CSS.escape(m.id)}"]`);
      if (el) updateMessageElement(el, latestRoom, current, new Set(["tools"]), new Set([call.toolCallId]));
    });
    return entry;
  }
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
      else if (choice.dataset.act === "make-room") post(roomApi(`/new-rooms/${encodeURIComponent(card.dataset.key)}`), { create: choice.dataset.answer === "create" }).catch(showError);
      else if (choice.dataset.act === "try-look") tryLook(choice.dataset.look);
      else if (choice.dataset.act === "adopt-copy") {
        choice.disabled = true;
        const roomId = state.currentRoomId;
        post(roomApi("/recovery"), {}).then((r) => applyRecoveryAnswer(roomId, r)).catch((error) => { showError(error); choice.disabled = false; });
      }
      return;
    }
    const retry = e.target.closest("[data-tool-retry]");
    const chip = retry ? retry.closest('[data-ui="tool-call"]').querySelector(':scope > [data-ui="chip"]') : e.target.closest('[data-ui="tool-call"] > [data-ui="chip"]');
    if (!chip) return;
    const msgEl = chip.closest(".msg");
    const room = currentRoom();
    const m = room && msgEl && HistoryWindow.knownMessages(room).find((x) => x.id === msgEl.dataset.id);
    if (!m) return;
    toolDetailsCache.delete(toolDetailsKey(room, m, chip.dataset.tool));
    if (!retry && openTools.has(chip.dataset.tool)) openTools.delete(chip.dataset.tool);
    else openTools.add(chip.dataset.tool);
    updateMessageElement(msgEl, room, m);
  });
  function updateMessageElement(el, room, m, parts, toolIds) {
    el.dataset.seq = String(m.seq);
    el.dataset.from = m.from;
    if (room.history?.indexed) (room.dirtyHeights ||= new Set()).add(m.id);
    if (m.bodyMissing) { fillBodyPlaceholder(el, room, m); noteDrawn(el, m); return; }
    if (el.classList.contains("history-placeholder")) { el.replaceWith(messageElement(room, m)); return; }
    applyMessageElement(el, room, m, parts, toolIds);
    noteDrawn(el, m);
  }
  function applyMessageElement(el, room, m, parts, toolIds) {
    let branch = el.querySelector(".carry-branch");
    if (m.branch && el.querySelector(".head")) {
      if (!branch) { branch = document.createElement("span"); branch.className = "carry-branch"; el.querySelector(".head .name")?.after(branch); }
      const label = (room.sources || []).find(source => source.uuid === m.branch.source)?.label || "another copy";
      branch.textContent = `branch · ${label}`;
      branch.title = "This part of the conversation was kept from a parallel branch.";
    } else branch?.remove();
    const want = (part) => !m.streaming || !parts || parts.has(part) || deferredMessageParts.get(el)?.has(part);
    el.dataset.streaming = m.streaming ? "1" : "0";
    el.classList.toggle("hidden-by-search", !messageMatches(m));
    const wasPinned = el.classList.contains("pinned");
    el.classList.toggle("pinned", !!m.pinned);
    const pinBtn = el.querySelector('.head [data-act="pin"]');
    if (pinBtn) pinBtn.title = m.pinned ? "Unpin this message" : "Pin this message";
    if (wasPinned !== !!m.pinned) renderTimeline(true);
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
    const long = !m.streaming && m.text.length > CLAMP_CHARS && !state.watched.has(m.id);
    const expanded = state.expanded.has(m.id);
    let words = text.querySelector(":scope > .words");
    if (!words) {
      words = document.createElement("div");
      words.className = "words";
      text.replaceChildren(words);
    }
    if (want("text") && canPaintMessagePart(el, "text")) {
      if (m.streaming && m.text && !(m.images && m.images.length) && !(m.quotes && m.quotes.length)) renderStreamingWords(room, words, m.text, m.to);
      else words.innerHTML = renderText(room, long && !expanded ? clampedSource(m.text) : m.text, m.images, m.quotes, m.to, m.audio, m.video, m.numbersHere);
      if (!m.streaming) {
        renderPreviews(words, m);
        linkRelativePaths(words, m);
        const finish = () => { if (words.isConnected && canPaintMessagePart(el, "text")) { renderDiagrams(words); highlightBlocks(words); } };
        if (Date.now() - lastTypedAt < TYPING_WINDOW_MS) setTimeout(finish, TYPING_WINDOW_MS);
        else requestAnimationFrame(() => setTimeout(finish, 0));
      }
    }
    const atWork = bubbleWorking(room, m);
    if (m.streaming) {
      let tail = el.liveTail;
      if (!tail) {
        tail = document.createElement("span");
        tail.className = "live-tail";
        tail.innerHTML = `${WORKING_SVG}${THINKING_DOTS}${UI.html("button", { label: "Stop", kind: "ghost", size: "xs", act: "stop", title: "Stop this reply; what is written stays in the room" })}`;
        el.liveTail = tail;
      }
      tail.classList.toggle("no-figure", !atWork);
      if (tail.parentElement !== text) text.appendChild(tail);
      if (CALM !== "off") text.classList.add("streamed");
    } else if (el.liveTail && el.liveTail.parentElement) el.liveTail.remove();
    text.classList.toggle("clamped", long && !expanded);
    text.closest(".bubble")?.classList.toggle("folded", long && !expanded);
    more.hidden = !long;
    more.textContent = expanded ? "Show less" : "Show more";
    const stopNote = el.querySelector(".stop-note");
    if (stopNote) stopNote.innerHTML = m.streaming ? ""
      : m.stopReason === "cancelled" ? UI.html("reply-note", { text: stopNoteText(m), tone: "attention", icon: "stop" })
      : m.failed ? UI.html("reply-note", { text: failNoteText(m), tone: "error", icon: "alert" })
      : "";
    renderShots(el.querySelector(".shots"), room, m);
    renderSounds(el.querySelector(".sounds"), room, m);
    renderVideos(el.querySelector(".videos"), room, m);
    renderWaiting(el, room, m);
    placeDevPrompt(el);
    const thought = el.querySelector(".thought");
    if (m.thought && want("thought") && canPaintMessagePart(el, "thought")) {
      thought.hidden = false;
      thought.querySelector(".thought-text").textContent = m.thought;
    }
    el.querySelector(".agent-notices").innerHTML = (m.notices || []).map((n) => UI.html("reply-note", { text: n, tone: "attention" })).join("");
    if (want("tools")) {
      const tools = el.querySelector(".tools");
      const heldChips = !canPaintMessagePart(el, "tools");
      if (heldChips) tools.dataset.held = "1";
      const calls = m.toolCalls || [];
      const chipFor = (call) => {
        const open = openTools.has(call.toolCallId);
        const loaded = open ? toolDetailsFor(room, m, call) : { state: "ready", value: call };
        const detail = loaded.value;
        const input = !open || detail.rawInput === undefined ? "" : typeof detail.rawInput === "string" ? detail.rawInput : JSON.stringify(detail.rawInput, null, 1);
        return UI.el("tool-call", { id: call.toolCallId, title: detail.title, kind: call.kind || undefined, variant: call.messageCheck ? "message-check" : call.historySearch ? "history-search" : "tool", status: TOOL_STATUSES.has(call.status) ? call.status : "pending", open, loadState: loaded.state, input: input || undefined, output: open ? detail.output || undefined : undefined });
      };
      const some = m.streaming && parts && toolIds && tools.dataset.held !== "1" && !tools.querySelector(":scope > details");
      if (heldChips) {
      } else if (some) {
        for (const id of toolIds) {
          const call = calls.find((c) => c.toolCallId === id);
          if (!call) continue;
          const old = tools.querySelector(`:scope > [data-ui="tool-call"] > [data-tool="${CSS.escape(id)}"]`);
          if (old) old.parentElement.replaceWith(chipFor(call));
          else {
            const later = calls.slice(calls.indexOf(call) + 1).map((c) => tools.querySelector(`:scope > [data-ui="tool-call"] > [data-tool="${CSS.escape(c.toolCallId)}"]`)).find(Boolean);
            tools.insertBefore(chipFor(call), later ? later.parentElement : null);
          }
        }
      } else {
        delete tools.dataset.held;
        tools.innerHTML = "";
        const folded = !m.streaming && calls.length > 0;
        let host = tools;
        if (folded) {
          const group = UI.el("tool-fold", { count: calls.length, failed: calls.filter((c) => c.status === "failed").length, open: openToolGroups.has(m.id) });
          group.addEventListener("toggle", () => {
            if (group.open) openToolGroups.add(m.id);
            else openToolGroups.delete(m.id);
            group.querySelector("summary").title = group.open ? "Fold the tool calls away" : "Show every tool call";
            const list = group.querySelector(".list");
            if (group.open && !list.childElementCount) for (const call of calls) list.appendChild(chipFor(call));
            else if (!group.open) list.replaceChildren();
          });
          tools.appendChild(group);
          host = group.querySelector(".list");
        }
        if (!folded || openToolGroups.has(m.id)) for (const call of calls) host.appendChild(chipFor(call));
      }
    }
    const plan = el.querySelector(".plan");
    if (m.plan && m.plan.length && want("plan")) {
      plan.hidden = false;
      plan.innerHTML = m.plan.map((e) => `<div class="plan-entry ${e.status}">${esc(e.content)}</div>`).join("");
    }
    const meta = el.querySelector(".meta");
    if (!m.streaming && m.from !== "human") {
      const parts = [];
      if (m.stopReason && m.stopReason !== "end_turn" && m.stopReason !== "cancelled") parts.push(`<span>${esc(m.stopReason)}</span>`);
      if (m.durationMs) parts.push(`<span title="how long the reply took">${ic("clock")} ${fmtDuration(m.durationMs)}</span>`);
      if (m.usage) parts.push(`<span title="tokens in">${ic("arrow-down")} ${fmtTokens(m.usage.inputTokens)}</span><span title="tokens out">${ic("arrow-up")} ${fmtTokens(m.usage.outputTokens)}</span>${m.usage.cachedWriteTokens ? `<span title="tokens written to the cache">${ic("database")} ${fmtTokens(m.usage.cachedWriteTokens)}</span>` : ""}`);
      meta.innerHTML = parts.length ? `<span class="stats">${parts.join('<span class="sep">·</span>')}</span>` : "";
      fillSeen(el, room, m);
    } else if (m.from === "human") fillSeen(el, room, m);
    else meta.innerHTML = liveMetaHtml(room, m) ? `<span class="stats">${liveMetaHtml(room, m)}</span>` : "";
  }

  function liveMetaHtml(room, m) {
    if (!m.streaming || !m.ts) return "";
    return `<span class="live" data-from="${esc(m.from)}" data-since="${m.ts}" title="what this reply is doing, and when it last showed a sign">${liveSignHtml(room, m)}</span>`;
  }
  function lastSignFor(room, m) {
    const who = room && findById(room, m.from);
    return (who && who.lastSignAt) || m.ts;
  }
  const DOING = { read: "reading", edit: "editing", delete: "deleting", move: "moving files", search: "searching", execute: "running a command", think: "thinking", fetch: "fetching" };
  function whatIsHappening(m) {
    const calls = m.toolCalls || [];
    const running = [...calls].reverse().find((c) => c.status === "pending" || c.status === "in_progress");
    if (running) return DOING[running.kind] || "working";
    return m.text ? "writing" : "thinking";
  }
  function staleLabel(ms) {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 20) return "";
    if (seconds < 60) return `last sign ${Math.floor(seconds / 10) * 10}s ago`;
    return `last sign ${Math.floor(seconds / 60)}m ago`;
  }
  function liveSignHtml(room, m) {
    const stale = staleLabel(Date.now() - lastSignFor(room, m));
    const doing = whatIsHappening(m);
    const calls = (m.toolCalls || []).length;
    const elapsed = fmtDuration(Math.max(0, Date.now() - (m.ts || Date.now()))) || "0 s";
    const parts = [`<span title="Time spent on this reply">${ic("clock")} ${elapsed}</span>`, `<span>${esc(doing)}</span>`];
    if (calls) parts.push(`<span title="Tool calls in this reply">${ic("tool")} ${calls} tool ${calls === 1 ? "call" : "calls"}</span>`);
    if (stale) parts.push(`<span title="Time since the last sign of activity">${stale}</span>`);
    return parts.join('<span class="sep">·</span>');
  }
  function tickLive() {
    const room = currentRoom();
    if (!room) return;
    for (const span of els.messages.querySelectorAll(".meta .live")) {
      const m = drawnFrom.get(span.closest(".msg"));
      if (m && m.streaming) span.innerHTML = liveSignHtml(room, m);
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
    const seen = present.filter((p) => bodySupplied(p, m));
    if (m.from === "human" && m.bodyDelivery) {
      return seen.length ? `<span class="ticks">✓✓</span> sent to ${esc(seen.map(p => p.name).join(", "))}` : `<span class="ticks">✓</span> sent`;
    }
    if (seen.length === present.length) return "";
    const you = m.from !== "human";
    if (!seen.length) return `<span class="ticks">✓</span> sent${you ? " · seen by you" : ""}`;
    return `<span class="ticks">✓✓</span> seen by ${esc([...(you ? ["you"] : []), ...seen.map((p) => p.name)].join(", "))}`;
  }
  function fillSeen(el, room, m) {
    if (m.kind !== "chat" || m.streaming) return;
    const seen = seenHtml(room, m);
    const html = (m.via ? `<span class="stats" data-hint="written from a phone paired to viberoom">via ${esc(m.via.platform === "telegram" ? "Telegram" : m.via.platform)}</span>${seen ? '<span class="sep">·</span>' : ""}` : "") + seen;
    if (m.from === "human") {
      const meta = el.querySelector(".meta");
      if (!meta) return;
      if (meta.innerHTML !== html) meta.innerHTML = html;
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
    const byId = new Map(HistoryWindow.knownMessages(room).map((m) => [m.id, m]));
    for (const el of els.messages.querySelectorAll(".msg.mine, .msg.agent")) {
      const seq = Number(el.dataset.seq);
      const hasLabel = el.querySelector(".meta.seen, .seen-by:not([hidden])");
      const m = byId.get(el.dataset.id);
      if (!m) continue;
      if (!m.bodyDelivery && seq <= floor && !hasLabel && !el.classList.contains("waiting")) continue;
      fillSeen(el, room, m);
      if (m.from === "human" && (m.bodyDelivery || seq > floor || el.classList.contains("waiting"))) renderWaiting(el, room, m);
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
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const searching = agents.filter(p => p.skillChannel === "tool");
    const they = agents.length === 1 ? "it" : "they";
    const detail = searching.length === agents.length ? `but ${they} can still read the earlier messages.`
      : searching.length ? "but some of these vibemates can still read the earlier messages." : "Earlier messages remain in the room history.";
    const title = "This marks the starting context supplied to the session, not everything the vibemate remembers." +
      (searching.length ? ` History search is available to ${searching.map(p => p.name).join(", ")}.` : "");
    const el = UI.el("unseen-line", { label: `${who} started from here`, detail, title });
    el.dataset.startSeq = agents[0].sawFromSeq;
    return el;
  }
  function refreshStartingLines(room) {
    for (const [seq, agents] of visibilityMarkers(room)) {
      const line = els.messages.querySelector(`[data-ui="unseen-line"][data-start-seq="${seq}"]`);
      if (line) line.replaceWith(dividerElement(agents));
    }
  }

  const PAGE_SIZE = 50;
  function placeInList(el, host = els.messages) {
    let page = host.lastElementChild;
    if (!page || !page.classList.contains("msgs-page") || page.childElementCount >= PAGE_SIZE) {
      page = document.createElement("div");
      page.className = "msgs-page";
      page.dataset.page = "";
      host.appendChild(page);
    }
    page.appendChild(el);
  }
  function topInList(el) {
    const page = el.parentElement;
    if (!page || !page.classList.contains("msgs-page")) return el.offsetTop;
    const first = page.firstElementChild;
    const laidOut = !first || typeof first.checkVisibility !== "function" || first.checkVisibility({ contentVisibilityAuto: true });
    if (els.messages.classList.contains("searching") || laidOut) {
      let top = 0;
      for (let node = el; node && node !== els.messages; node = node.offsetParent) top += node.offsetTop;
      return top;
    }
    let i = 0;
    for (let n = el.previousElementSibling; n; n = n.previousElementSibling) i++;
    return page.offsetTop + (page.offsetHeight * i) / page.childElementCount;
  }

  function readerAnchor() {
    const m = els.messages;
    const top = m.scrollTop;
    let previous = null;
    for (const el of m.querySelectorAll(".msg[data-id]")) {
      const y = topInList(el);
      if (y > top) return previous ? { id: previous.el.dataset.id, into: previous.y - top } : { id: el.dataset.id, into: y - top };
      previous = { el, y };
    }
    return previous ? { id: previous.el.dataset.id, into: previous.y - top } : null;
  }
  let settledReader = null;
  function rememberReader() {
    if (state.view !== "room" || !currentRoom()) return;
    settledReader = { roomId: state.currentRoomId, anchor: stuck ? null : readerAnchor(), stamp: pricesStamp(), following: stuck };
  }
  let readerRestoreCleanup = null;
  function restoreReader(anchor) {
    if (readerRestoreCleanup) readerRestoreCleanup();
    if (!anchor) return false;
    const el = els.messages.querySelector(`.msg[data-id="${CSS.escape(anchor.id)}"]`);
    if (!el) return false;
    if (els.messages.classList.contains("windowed")) {
      els.messages.scrollTop += Layout.rect(el).top - Layout.rect(els.messages).top - anchor.into;
      return true;
    }
    const page = el.closest(".msgs-page");
    const pageVisibility = page?.style.contentVisibility || "";
    if (page) page.style.contentVisibility = "visible";
    const measured = [];
    if (page) for (const row of page.children) {
      if (row.classList.contains("msg")) {
        measured.push([row, row.style.contentVisibility]);
        row.style.contentVisibility = "visible";
      }
      if (row === el) break;
    }
    let released = false;
    const releaseWhenHidden = () => { if (document.hidden) release(); };
    const release = () => {
      if (released) return;
      released = true;
      document.removeEventListener("visibilitychange", releaseWhenHidden);
      for (const [row, visibility] of measured) row.style.contentVisibility = visibility;
      if (page) page.style.contentVisibility = pageVisibility;
      if (readerRestoreCleanup === release) readerRestoreCleanup = null;
    };
    readerRestoreCleanup = release;
    document.addEventListener("visibilitychange", releaseWhenHidden);
    const put = () => {
      let top = 0;
      for (let node = el; node && node !== els.messages; node = node.offsetParent) top += node.offsetTop;
      els.messages.scrollTop = Math.max(0, top - anchor.into);
    };
    put();
    if (document.hidden) { release(); return true; }
    let left = 6;
    let was = els.messages.scrollTop;
    const settle = () => {
      if (readerRestoreCleanup !== release) return;
      if (!el.isConnected) { release(); return; }
      put();
      const now = els.messages.scrollTop;
      if (--left > 0 && Math.abs(now - was) > 1) {
        was = now;
        requestAnimationFrame(settle);
      } else release();
    };
    requestAnimationFrame(settle);
    return true;
  }
  let listRoomId = null;
  const returnPlaces = new Map();
  let returnTo = null;
  function keepReturnPlace(roomId) {
    if (!roomId) return;
    if (state.view === "room" && state.currentRoomId === roomId) rememberReader();
    const left = settledReader?.roomId === roomId && !settledReader.following ? settledReader.anchor : null;
    if (left) returnPlaces.set(roomId, left);
    else returnPlaces.delete(roomId);
  }
  function showRoomList(why) {
    const room = currentRoom();
    let back = returnTo?.roomId === room?.id ? returnTo.anchor : null;
    returnTo = null;
    if (back && !HistoryWindow.knownMessages(room).some((m) => m.id === back.id)) {
      back = null;
      stuck = true;
      readingAway = false;
    }
    if (room?.history?.bodyProtocol && !room.history.indexed && !room.historyRestoring) void refreshHeld(room.id, back ? { reader: back, returning: true } : {});
    if (room?.restoreFrom && !room.historyRestoring) void refreshHeld(room.id, back ? { ...room.restoreFrom, reader: back, returning: true } : room.restoreFrom);
    if (room?.historyRestoring) return renderMessages(why);
    return renderMessages(why, back || undefined);
  }
  const { FOLD_SHOWN, FOLD_STEP } = Fold;
  const foldAnchor = new Map();
  function foldShown(room) {
    const own = room && room.settings ? room.settings.foldAfter : null;
    const app = state.settings ? state.settings.foldAfter : null;
    return own || app || FOLD_SHOWN;
  }
  function foldSettingChanged(roomId) {
    const roomIds = roomId ? [roomId] : [...state.rooms.values()].filter((r) => !(r.settings && r.settings.foldAfter)).map((r) => r.id);
    for (const id of roomIds) foldAnchor.delete(id);
    const room = currentRoom();
    if (!room || !roomIds.includes(room.id)) return;
    if (room.history?.version && remoteHidden(room) && foldShown(room) > room.messages.length) {
      room.restoreFrom = {};
      if (state.view === "room") void refreshHeld(room.id);
      else listRoomId = null;
      return;
    }
    if (state.view === "room") renderMessages("the fold setting changed");
    else listRoomId = null;
  }
  function foldIndex(room) {
    if (room.history?.indexed) return 0;
    let anchor = foldAnchor.get(room.id);
    const shown = foldShown(room);
    if (!anchor && room.messages.length >= shown) {
      const index = room.messages.length - shown;
      const first = room.messages[index];
      anchor = room.history?.version && index === 0 && remoteHidden(room) && first.seq > 0
        ? { id: first.id, order: first.displayOrder ?? first.seq }
        : Fold.anchorAt(room.messages, index);
      foldAnchor.set(room.id, anchor);
    }
    return Fold.foldIndexFor(room.messages, anchor, shown);
  }
  const remoteHidden = (room) => (room?.history?.indexed ? 0 : room && room.history ? room.history.hidden : 0);
  const foldHidden = (room) => foldIndex(room) + remoteHidden(room);
  function setFoldIndex(room, index) {
    if (room.history?.indexed) return;
    const anchor = Fold.anchorAt(room.messages, index);
    const first = room.messages[Math.max(0, index)];
    foldAnchor.set(room.id, anchor.all && remoteHidden(room) && first
      ? { id: first.id, order: first.displayOrder ?? first.seq } : anchor);
  }
  function foldParts(room) {
    const local = Fold.partsOf(room.messages, foldIndex(room));
    const remote = remoteHidden(room);
    if (!remote) return local;
    const held = new Set(room.messages.map((m) => m.id));
    const older = (room.pinnedOlder || []).filter((p) => !held.has(p.id));
    return { hidden: local.hidden + remote, drawn: local.drawn, above: [...older, ...local.above] };
  }
  const cursorOf = (m) => ({ order: m.displayOrder != null ? m.displayOrder : m.seq, seq: m.seq });
  const before = (a, b) => a.order < b.order || (a.order === b.order && a.seq < b.seq);
  function trimBodyCache(room, extra = []) {
    if (!room.history?.bodyProtocol) return;
    if (!room.history.indexed) {
      const keep = new Set(room.messages.slice(-80).map(m => m.id));
      room.messages = room.messages.filter(m => keep.has(m.id) || m.streaming || m.pending);
      syncHistoryCount(room);
      return;
    }
    const protectedIds = new Set(extra);
    if (currentRoom() === room && state.view === "room") {
      for (const el of els.messages.querySelectorAll(".msg[data-id]")) protectedIds.add(el.dataset.id);
    }
    WindowBodies.trim(room, protectedIds);
  }
  function fillBodyPlaceholder(el, room, m) {
    el.className = "msg history-placeholder";
    const size = measuredRows.get(m.id) ?? (rowPrices.fallback ? priceItem({ kind: "msg", m }) : 100);
    el.style.minHeight = `${Math.max(64, size)}px`;
    el.setAttribute("aria-busy", m.bodyError ? "false" : "true");
    const label = m.bodyError ? "This message could not be loaded." : "Loading message…";
    if (el.dataset.loadLabel === label) return;
    el.dataset.loadLabel = label;
    el.innerHTML = `${m.bodyError ? "" : UI.html("skeleton", { lines: 2, shape: "bubble" })}<span class="placeholder-label">${esc(m.fromName || "Room")} · ${esc(label)}</span>${m.bodyError ? '<button class="linklike">Try again</button>' : ""}`;
    el.querySelector("button")?.addEventListener("click", () => {
      const visible = [...els.messages.querySelectorAll(".msg[data-id]")].map(node => node.dataset.id);
      void loadBodies(room, [...new Set([m.id, ...visible])], true);
    });
  }
  async function loadBodies(room, ids, retry = false) {
    if (!room.history?.indexed || state.rooms.get(room.id) !== room) return false;
    while (room.bodyFlight) { await room.bodyFlight; if (state.rooms.get(room.id) !== room) return false; }
    const wanted = new Set(ids);
    const missing = room.messages.filter(m => wanted.has(m.id) && m.bodyMissing && (retry || !m.bodyError)).slice(0, 64);
    if (!missing.length) return ids.every(id => room.messages.some(m => m.id === id && !m.bodyMissing));
    for (const m of missing) delete m.bodyError;
    const requested = missing.map(m => m.id);
    const flight = (async () => {
      try {
        let races = 0;
        for (let part = 0; part < requested.length + 2; part++) {
          const known = new Map(room.messages.map(m => [m.id, m]));
          const remaining = requested.filter(id => known.get(id)?.bodyMissing);
          if (!remaining.length) return requested.every(id => known.has(id));
          const generation = room.historyGeneration;
          const q = new URLSearchParams({ version: room.history.version });
          for (const id of remaining) q.append("id", id);
          try {
            const page = await get(`/api/rooms/${encodeURIComponent(room.id)}/history/bodies?${q}`);
            if (state.rooms.get(room.id) !== room) return false;
            if (!WindowBodies.merge(room, page, generation)) {
              if (++races > 1) break;
              continue;
            }
            const arrived = page.messages.filter(body => room.messages.some(m => m.id === body.id && !m.bodyMissing));
            if (!arrived.length) { if (++races > 1) break; continue; }
            trimBodyCache(room, requested);
            if (currentRoom() === room && state.view === "room") renderMessagesSoon("message bodies arrived");
            if (requested.every(id => room.messages.some(m => m.id === id && !m.bodyMissing))) return true;
          } catch (error) {
            if (error.code !== "history_changed" || ++races > 1) throw error;
            if (!await refreshHeld(room.id)) throw error;
          }
        }
        throw new Error("The conversation changed while these messages loaded. Try again.");
      } catch (error) {
        if (state.rooms.get(room.id) === room) {
          for (const m of room.messages) if (wanted.has(m.id) && m.bodyMissing) m.bodyError = error.message;
          if (currentRoom() === room && state.view === "room") renderMessagesSoon("message loading failed");
        }
        return false;
      }
    })();
    room.bodyFlight = flight;
    try { return await flight; } finally { if (room.bodyFlight === flight) room.bodyFlight = null; }
  }
  function syncHistoryCount(room) {
    if (room.history?.total === undefined) return;
    room.history.hidden = Math.max(0, room.history.total - room.messages.filter(m => m.seq > 0 && !m.streaming).length);
    room.history.oldest = room.history.hidden && room.messages.length ? cursorOf(room.messages[0]) : null;
  }
  const aboveHeld = (room, m) => !!(room.history && room.history.oldest && before(cursorOf(m), room.history.oldest));
  async function loadOlder(room, count) {
    if (room.loadingOlder) return 0;
    if (!room.history?.version) { showError(new Error("Restart viberoom to load earlier messages.")); return null; }
    const loading = Symbol("history page request");
    room.loadingOlder = loading;
    let inFlight;
    try {
      let got = 0;
      while (room.history && room.history.hidden > 0 && (count === "all" || got < count)) {
        const limit = Math.min(1000, count === "all" ? room.history.hidden : count - got);
        const c = room.history.oldest;
        if (!c) break;
        const ticket = HistoryWindow.capture(room);
        inFlight = ticket;
        const res = await get(`/api/rooms/${encodeURIComponent(room.id)}/history?before=${c.order}:${c.seq}&limit=${limit}&version=${encodeURIComponent(ticket.version)}`);
        if (state.rooms.get(room.id) !== room || !HistoryWindow.sameRange(room, ticket)) return null;
        const rows = res.messages || [];
        if (!HistoryWindow.mergePage(room, res, ticket)) {
          await refreshHeld(room.id);
          return null;
        }
        got += rows.length;
        if (!rows.length) break;
      }
      return got;
    } catch (error) {
      if (state.rooms.get(room.id) === room && (!inFlight || HistoryWindow.sameRange(room, inFlight))) {
        if (error.code === "history_changed") await refreshHeld(room.id);
        else showError(error);
      }
      return null;
    } finally {
      if (room.loadingOlder === loading) room.loadingOlder = false;
    }
  }
  async function refreshHeld(roomId, wanted = {}) {
    const room = state.rooms.get(roomId);
    if (!room) return false;
    const request = Symbol("history request");
    room.historyRequest = request;
    room.historyGeneration = (room.historyGeneration || 0) + 1;
    room.loadingOlder = false;
    room.historyRestoring = true;
    room.historyEvents = [];
    const reader = wanted.reader !== undefined ? wanted.reader : (roomId === state.currentRoomId && !stuck ? readerAnchor() : null);
    const oldMessage = reader && HistoryWindow.knownMessages(room).find(m => m.id === reader.id);
    const from = wanted.from || (room.messages[0] && cursorOf(room.messages[0]));
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const ticket = HistoryWindow.capture(room);
        const q = new URLSearchParams();
        if (ticket.epoch) q.set("epoch", ticket.epoch);
        if (room.history?.bodyProtocol) q.set("index", "1");
        else if (wanted.all || foldAnchor.get(roomId)?.all) q.set("all", "1");
        else if (from) q.set("from", `${from.order}:${from.seq}`);
        if (wanted.seq !== undefined) q.set("seq", wanted.seq);
        if (wanted.messageId) q.set("message", wanted.messageId);
        const fresh = await get(`/api/rooms/${encodeURIComponent(roomId)}?${q}`);
        if (state.rooms.get(roomId) !== room || room.historyRequest !== request) return false;
        if (!HistoryWindow.acceptSnapshot(room, fresh, ticket)) continue;
        if (fresh.history?.indexed) WindowBodies.retain(room, fresh);
        room.messages = (fresh.messages || []).sort(HistoryWindow.compareMessages);
        room.history = fresh.history;
        room.pinnedOlder = fresh.pinnedOlder || [];
        room.bodyChanges = new Map();
        room.indexError = null;
        const arrived = room.historyEvents;
        room.historyEvents = null;
        for (const event of arrived) if (event.streamSequence > (fresh.history?.streamSequence ?? Infinity)) onRoomEvent(roomId, event);
        room.restoreFrom = null;
        room.historyRestoring = false;
        room.historyGeneration = (room.historyGeneration || 0) + 1;
        let anchor = reader;
        const targetIndex = wanted.messageId ? room.messages.findIndex(m => m.id === wanted.messageId)
          : wanted.seq !== undefined ? room.messages.findIndex(m => m.seq === wanted.seq) : -1;
        if (targetIndex >= 0) {
          setFoldIndex(room, Math.min(foldIndex(room), Math.max(0, targetIndex - Fold.FOLD_STEP)));
          anchor = { id: room.messages[targetIndex].id, into: 12 };
        }
        if (anchor && !HistoryWindow.knownMessages(room).some(m => m.id === anchor.id)) {
          const replacement = oldMessage && room.messages.find(m => !before(cursorOf(m), cursorOf(oldMessage)));
          anchor = replacement ? { ...anchor, id: replacement.id } : null;
        }
        if (wanted.returning && !anchor && roomId === state.currentRoomId) {
          stuck = true;
          readingAway = false;
        }
        if (roomId === state.currentRoomId && state.view === "room") {
          if (targetIndex >= 0) leaveTheEnd();
          renderMessages("the loaded history was refreshed", anchor);
          renderSideRoom();
        }
        else if (listRoomId === roomId) listRoomId = null;
        return true;
      }
      throw new Error("The conversation is changing. Try loading its history again.");
    } catch (error) {
      if (state.rooms.get(roomId) === room && room.historyRequest === request) {
        room.indexError = error.message;
        showError(error);
      }
      return false;
    } finally {
      if (room.historyRequest === request) {
        const resumeDrawing = room.historyRestoring;
        room.historyEvents = null;
        room.historyRestoring = false;
        if (resumeDrawing && state.rooms.get(roomId) === room) {
          if (roomId === state.currentRoomId && state.view === "room") {
            renderMessages("history loading stopped");
            renderSideRoom();
          } else if (listRoomId === roomId) listRoomId = null;
        }
      }
    }
  }
  const ARRIVE_STAGGER_CAP = 8;
  async function growFold(more, why, roomId) {
    const room = state.rooms.get(roomId);
    if (!room || !foldHidden(room) || room.loadingOlder || room.historyRestoring) return;
    const generation = room.historyGeneration || 0;
    let oldIndex = foldIndex(room);
    if (remoteHidden(room) && (more === "all" || oldIndex < more)) {
      const firstShown = room.messages[oldIndex] ? room.messages[oldIndex].id : null;
      const got = await loadOlder(room, more === "all" ? "all" : more - oldIndex);
      if (got === null || state.rooms.get(roomId) !== room || (room.historyGeneration || 0) !== generation) return;
      if (firstShown) {
        const at = room.messages.findIndex((m) => m.id === firstShown);
        if (at >= 0) oldIndex = at;
      } else oldIndex = room.messages.length;
    }
    setFoldIndex(room, more === "all" ? 0 : oldIndex - more);
    if (roomId !== state.currentRoomId || state.view !== "room" || listRoomId !== room.id) return;
    const ceiling = els.messages.querySelector(".fold-ceiling");
    if (more === "all" || !ceiling) return renderMessages(why);
    const t0 = performance.now();
    const stretch = room.messages.slice(foldIndex(room), oldIndex);
    const standing = new Set([...els.messages.querySelectorAll(".msg[data-id]")].map((el) => el.dataset.id));
    arriving = new Set(stretch.map((m) => m.id));
    try {
      renderMessages(why);
    } finally {
      arriving = null;
    }
    const arrived = stretch
      .filter((m) => !standing.has(m.id))
      .map((m) => els.messages.querySelector(`.msg[data-id="${CSS.escape(m.id)}"]`))
      .filter(Boolean);
    noteSlow(`${stretch.length} older messages drawn (${why})`, performance.now() - t0);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const animate = !document.hidden && currentRoom() === room && state.view === "room";
      arrived.forEach((el, i) => {
        el.classList.remove("history-arriving");
        if (!animate || !el.isConnected) return;
        el.style.setProperty("--arrive", String(Math.min(ARRIVE_STAGGER_CAP, arrived.length - 1 - i)));
        el.classList.replace("history-static", "history-arrived");
        const own = (e) => { if (e.target !== el) return; el.style.removeProperty("--arrive"); el.removeEventListener("animationend", own); };
        el.addEventListener("animationend", own);
      });
    }));
  }

  async function revealQuote(ref, fragment = "") {
    const seq = Number(ref.seq);
    if (seq > 0) return revealSeq(seq, fragment);
    const live = ref.quotedId ? els.messages.querySelector(`.msg[data-id="${CSS.escape(ref.quotedId)}"]`) : null;
    if (live) return jumpToPassage(live, fragment);
    toast("That reply never finished, so there is no message to go to.", "warn");
    return false;
  }
  async function revealSeq(seq, fragment = "") {
    const room = currentRoom();
    if (!room || !Number.isFinite(seq)) return false;
    let index = room.messages.findIndex((m) => m.seq === seq);
    let loaded = false;
    if (index < 0 && remoteHidden(room)) {
      loaded = await refreshHeld(room.id, { seq, reader: null });
      if (!loaded || state.rooms.get(room.id) !== room || currentRoom() !== room) return false;
      index = room.messages.findIndex((m) => m.seq === seq);
    }
    if (index < 0) return false;
    if (room.messages[index].bodyMissing && !await loadBodies(room, [room.messages[index].id], true)) {
      toast("This message could not be loaded. Try again when the connection is back.", "warn");
      return false;
    }
    if (currentRoom() !== room) return false;
    if (loaded || index < foldIndex(room)) {
      setFoldIndex(room, Math.max(0, index - FOLD_STEP));
    }
    if (!els.messages.querySelector(`.msg[data-seq="${CSS.escape(String(seq))}"]`)) {
      leaveTheEnd();
      renderMessages("a message was asked for", { id: room.messages[index].id, into: 12 });
    }
    return jumpToPassage(els.messages.querySelector(`.msg[data-seq="${CSS.escape(String(seq))}"]`), fragment);
  }

  function messageBySeq(room, seq) {
    return (room && HistoryWindow.knownMessages(room).find((m) => m.seq === seq)) || null;
  }
  async function goToNumber(seq) {
    const room = currentRoom();
    if (!room) return;
    if (room.history?.indexed && !messageBySeq(room, seq)) return void toast(`This room has no message #${seq}.`, "warn");
    if (!await revealSeq(seq) && currentRoom() === room && !messageBySeq(room, seq)) toast(`Message #${seq} could not be reached; it may be older than this room holds.`, "warn");
  }
  const PEEK_CHARS = 240;
  function peekProps(room, seq) {
    const m = messageBySeq(room, seq);
    if (!m) {
      return room?.history?.indexed ? { seq, text: "This room has no message with this number.", missing: true } : { seq, text: "Its words are not loaded yet; a click goes to them." };
    }
    const p = findById(room, m.from);
    const who = m.from === "human" ? Object.assign(meAvatarData(), { color: (p || {}).color }) : p;
    const words = String(m.text || "").trim().replace(/\s+/g, " ");
    const cut = m.bodyMissing ? String(m.text || "").length >= PEEK_CHARS && (m.bodyChars || 0) > PEEK_CHARS : words.length > PEEK_CHARS;
    const heard = words ? "" : (m.audio || []).map((sound) => String(sound.words || "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
    const text = words ? `${words.slice(0, PEEK_CHARS).trimEnd()}${cut ? "…" : ""}`
      : heard ? `${heard.slice(0, PEEK_CHARS).trimEnd()}${heard.length > PEEK_CHARS ? "…" : ""}`
      : m.images?.length ? `[${m.images.length} image${m.images.length === 1 ? "" : "s"}]`
      : m.audio?.length ? `[${m.audio.length} sound${m.audio.length === 1 ? "" : "s"}]`
      : m.video?.length ? `[${m.video.length} video${m.video.length === 1 ? "" : "s"}]` : "";
    return { seq, name: m.fromName || (who && who.name) || "Room", color: p ? colourOf(p) : undefined, face: who ? UI.raw(avatar(who, 18, {})) : undefined, when: `${dayLabel(m.ts)} ${time(m.ts)}`, text };
  }
  const peek = { el: null, ref: null, timer: 0, frame: 0 };
  function showPeek(ref) {
    const room = currentRoom();
    if (!room || !ref.isConnected) return hidePeek();
    hidePeek();
    const written = ref.dataset.written ? { written: Number(ref.dataset.written), copy: ref.dataset.copy } : {};
    peek.el = UI.el("message-peek", { ...peekProps(room, Number(ref.dataset.seq)), ...written, id: "message-peek", hook: "peek-float" });
    document.body.appendChild(peek.el);
    peek.ref = ref;
    ref.setAttribute("aria-describedby", "message-peek");
    placePeek();
  }
  function placePeek() {
    if (!peek.el) return;
    if (!peek.ref || !peek.ref.isConnected) return hidePeek();
    const r = Layout.rect(peek.ref);
    const list = Layout.rect(els.messages);
    if (r.bottom <= list.top || r.top >= list.bottom) return hidePeek();
    const width = Layout.length(window.innerWidth), height = Layout.length(window.innerHeight);
    const w = peek.el.offsetWidth, h = peek.el.offsetHeight;
    const below = r.bottom + 6 + h <= height - 8;
    peek.el.style.top = `${Math.round(below ? r.bottom + 6 : Math.max(8, r.top - 6 - h))}px`;
    peek.el.style.left = `${Math.round(Math.max(8, Math.min(r.left, width - w - 8)))}px`;
  }
  function hidePeek() {
    clearTimeout(peek.timer);
    cancelAnimationFrame(peek.frame);
    peek.timer = 0;
    peek.frame = 0;
    if (peek.ref) peek.ref.removeAttribute("aria-describedby");
    if (peek.el) peek.el.remove();
    peek.el = null;
    peek.ref = null;
  }
  const numberOf = (target) => (target && target.closest ? target.closest('[data-ui="message-ref"]') : null);
  els.messages.addEventListener("mouseover", (e) => {
    const ref = numberOf(e.target);
    if (!ref || ref === peek.ref) return;
    clearTimeout(peek.timer);
    peek.timer = setTimeout(() => showPeek(ref), hoverDelayMs(true));
  });
  els.messages.addEventListener("mouseout", (e) => {
    const ref = numberOf(e.target);
    if (ref && !ref.contains(e.relatedTarget)) hidePeek();
  });
  els.messages.addEventListener("scroll", () => {
    if (peek.el && !peek.frame) peek.frame = requestAnimationFrame(() => { peek.frame = 0; placePeek(); });
  }, { passive: true });
  document.addEventListener("pointerdown", () => { if (peek.el) hidePeek(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && peek.el) hidePeek(); });

  function releaseFold(room) {
    if (room?.history?.indexed) { trimBodyCache(room); return false; }
    const anchor = room && foldAnchor.get(room.id);
    if (!anchor || !Fold.anchorSurplus(room.messages, anchor, foldShown(room))) return false;
    foldAnchor.delete(room.id);
    if (room.id !== state.currentRoomId || state.view !== "room" || listRoomId !== room.id) return true;
    const started = performance.now();
    const before = els.messages.querySelectorAll(".msg[data-id]").length;
    renderMessages("the list gave the fold back");
    const removed = before - els.messages.querySelectorAll(".msg[data-id]").length;
    noteSlow(`the list gave back ${removed} rows`, performance.now() - started);
    return true;
  }

  els.messages.addEventListener("copy", (event) => {
    const selection = getSelection();
    const room = currentRoom();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !room) return;
    const chosen = selection.getRangeAt(0);
    if ([...els.messages.querySelectorAll(".history-placeholder")].some(node => chosen.intersectsNode(node))) {
      event.preventDefault(); event.stopImmediatePropagation();
      toast("Some selected messages are still loading. Load or retry them before copying.", "warn");
      return;
    }
    const parts = [];
    const shaped = [];
    let whole = false;
    for (const msg of els.messages.querySelectorAll(".msg[data-id]")) {
      const words = msg.querySelector(".text > .words");
      if (!words || !selection.containsNode(words, true)) continue;
      const m = room.messages.find((x) => x.id === msg.dataset.id);
      if (m && msg.querySelector(".text.clamped") && selection.containsNode(words, false)) {
        parts.push(m.text);
        shaped.push(copyableHtml(msg, m));
        whole = true;
        continue;
      }
      const inside = document.createRange();
      inside.selectNodeContents(words);
      if (chosen.compareBoundaryPoints(Range.START_TO_START, inside) > 0) inside.setStart(chosen.startContainer, chosen.startOffset);
      if (chosen.compareBoundaryPoints(Range.END_TO_END, inside) < 0) inside.setEnd(chosen.endContainer, chosen.endOffset);
      parts.push(inside.toString());
      const shape = document.createElement("div");
      shape.appendChild(inside.cloneContents());
      shaped.push(shape.innerHTML);
    }
    if (!whole || !event.clipboardData) return;
    event.clipboardData.setData("text/plain", parts.filter((p) => p && p.trim()).join("\n\n"));
    event.clipboardData.setData("text/html", shaped.filter((p) => p && p.trim()).join("<br><br>"));
    event.preventDefault();
  });

  const FOLD_SETTLE_MS = 2000;
  let foldSettleTimer = 0;
  function foldSettleSoon() {
    clearTimeout(foldSettleTimer);
    if (!stuck) return;
    const settling = state.currentRoomId;
    foldSettleTimer = setTimeout(() => {
      const room = currentRoom();
      if (stuck && room && room.id === settling && state.view === "room" && !room.messages.some((m) => m.streaming)) releaseFold(room);
    }, FOLD_SETTLE_MS);
  }

  function ceilingElement(room, hidden, pinned) {
    const el = document.createElement("div");
    el.className = "fold-ceiling";
    el.innerHTML = `<span class="history-rule" aria-hidden="true"></span>`;
    el.appendChild(historyLoadElement(room, hidden, pinned));
    el.insertAdjacentHTML("beforeend", `<span class="history-rule" aria-hidden="true"></span>`);
    return el;
  }
  const historyHintObserver = new IntersectionObserver(entries => {
    for (const entry of entries) entry.target.classList.toggle("in-view", entry.isIntersecting);
  }, { root: els.messages });
  function historyLoadElement(room, hidden, pinned) {
    const el = document.createElement("div");
    el.className = "history-load";
    el.innerHTML = `<div class="history-next">` +
      `<span class="history-scroll-icon" aria-hidden="true">${ic("chevrons-up")}</span>` +
      `<span class="fc-hint">Scroll up to load more</span></div>` +
      `<span class="fc-label" role="status"><strong class="fc-what">${hidden} earlier message${hidden === 1 ? "" : "s"} hidden.</strong>` +
      `<span class="fc-pins"${pinned ? "" : " hidden"}>Only pinned are shown.</span></span>` +
      UI.html("button", { label: "Load whole history", icon: "chevrons-up", kind: "secondary", size: "sm", act: "fold-all", title: "Show all earlier messages at once" });
    el.querySelector('[data-act="fold-all"]').addEventListener("click", () => requestOlder(room, "all", "the whole history was asked for"));
    updateHistoryLoading(room, el);
    historyHintObserver.observe(el);
    return el;
  }
  function updateHistoryBoundary(room, hidden, pinned) {
    const controls = els.messages.querySelector(".history-load");
    const ceiling = els.messages.querySelector(".fold-ceiling");
    if (!hidden) {
      if (controls) { historyHintObserver.unobserve(controls); controls.remove(); }
      ceiling?.remove();
      return;
    }
    if (ceiling) {
      ceiling.querySelector(".fc-what").textContent = `${hidden} earlier message${hidden === 1 ? "" : "s"} hidden.`;
      ceiling.querySelector(".fc-pins").hidden = !pinned;
    }
  }
  function updateHistoryLoading(room, controls) {
    if (!controls) return;
    const busy = !!room.historyLoadAction || !!room.loadingOlder || !!room.historyRestoring;
    const all = controls.querySelector('[data-act="fold-all"]');
    controls.setAttribute("aria-busy", String(busy));
    all.disabled = busy;
    if (room.historyLoadAction?.more === "all") {
      all.dataset.state = "loading";
      all.setAttribute("aria-label", "Loading whole history");
    } else {
      delete all.dataset.state;
      all.removeAttribute("aria-label");
    }
  }
  function historyLoadingPaint() {
    return new Promise(resolve => {
      let frame, timer;
      const done = () => { cancelAnimationFrame(frame); clearTimeout(timer); resolve(); };
      timer = setTimeout(done, 100);
      frame = requestAnimationFrame(() => setTimeout(done, 0));
    });
  }
  async function requestOlder(room, more, why) {
    if (currentRoom() !== room || state.view !== "room" || room.historyLoadAction || room.loadingOlder || room.historyRestoring) return;
    const controls = els.messages.querySelector(".history-load");
    if (!controls || controls.getAttribute("aria-busy") === "true") return;
    const action = { more };
    room.historyLoadAction = action;
    updateHistoryLoading(room, controls);
    try {
      if (more === "all") await historyLoadingPaint();
      if (state.rooms.get(room.id) === room) await growFold(more, why, room.id);
    } catch (error) { showError(error); }
    finally {
      if (room.historyLoadAction === action) delete room.historyLoadAction;
      if (currentRoom() === room && state.view === "room") updateHistoryLoading(room, els.messages.querySelector(".history-load"));
    }
  }
  let foldBusy = false;
  function historyBoundaryReached() {
    const ceiling = els.messages.querySelector(".fold-ceiling");
    if (!ceiling) return false;
    const box = Layout.rect(els.messages), boundary = Layout.rect(ceiling);
    return boundary.bottom >= box.top && boundary.top <= box.bottom;
  }
  function requestHistoryAtTop(intent = false) {
    if (state.view !== "room" || foldBusy || !historyBoundaryReached()) return;
    if (!intent && Date.now() - lastUserScrollAt > 700) return;
    const room = currentRoom();
    if (!room || !foldHidden(room)) return;
    foldBusy = true;
    setTimeout(async () => {
      try {
        if (currentRoom() === room && state.view === "room" && historyBoundaryReached()) await requestOlder(room, FOLD_STEP, "the reader reached the ceiling");
      } finally { foldBusy = false; }
    }, 180);
  }
  let historyScrollTop = 0;
  els.messages.addEventListener("scroll", () => {
    const top = els.messages.scrollTop, up = top < historyScrollTop;
    historyScrollTop = top;
    if (up) requestHistoryAtTop();
  }, { passive: true });
  function canPullEarlier(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    if (els.messages.contains(event.target)) for (let node = event.target; node && node !== els.messages; node = node.parentElement) {
      if (node.scrollTop > 0 && node.scrollHeight > node.clientHeight && /^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowY)) return false;
    }
    return true;
  }
  els.messages.addEventListener("wheel", event => { if (event.deltaY < 0 && canPullEarlier(event)) requestHistoryAtTop(true); }, { passive: true });
  document.addEventListener("keydown", event => {
    if (!["ArrowUp", "PageUp", "Home"].includes(event.key) || !canPullEarlier(event) || event.target.closest?.("input, textarea, select, [contenteditable]")) return;
    if (event.target === document.body || els.messages.contains(event.target)) requestHistoryAtTop(true);
  });

  function dayElement(day, ts) {
    const el = document.createElement("div");
    el.className = "day";
    el.textContent = day;
    el.title = new Date(ts).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return el;
  }

  const drawnFrom = new WeakMap();
  const edits = new WeakMap();
  const drawnEdit = new WeakMap();
  let arriving = null;
  let listGeneration = 0;
  let listSearch = null;
  function edited(m) {
    edits.set(m, (edits.get(m) || 0) + 1);
  }
  function drawnCurrent(el, m) {
    return drawnFrom.get(el) === m && drawnEdit.get(el) === (edits.get(m) || 0) && listGeneration === Number(el.dataset.gen);
  }
  function pendingPatch(el, m) {
    const entry = m.streaming ? dirty.get(m.id) : null;
    if (!entry || !entry.parts || deferredMessageParts.has(el)) return null;
    if (drawnFrom.get(el) !== m || listGeneration !== Number(el.dataset.gen)) return null;
    if (drawnEdit.get(el) !== entry.base || (edits.get(m) || 0) !== entry.base + entry.patches) return null;
    return entry;
  }
  function noteDrawn(el, m) {
    drawnFrom.set(el, m);
    drawnEdit.set(el, edits.get(m) || 0);
    el.dataset.gen = String(listGeneration);
    el.dataset.w = String((m.text || "").length);
  }

  const itemLists = new WeakMap();
  function listItems(room) {
    const cacheKey = room.history?.indexed ? `${room.history.version}|${visibilityFingerprint(room)}|${new Date().toDateString()}` : null;
    const cached = cacheKey && itemLists.get(room);
    if (cached && cached.key === cacheKey && cached.messages === room.messages && cached.count === room.messages.length) return cached.items;
    const items = [];
    const { hidden, drawn, above } = foldParts(room);
    if (hidden) {
      if (above.length) items.push({ kind: "pins", name: "pins", above });
      items.push({ kind: "ceiling", name: "ceiling", hidden, pinned: above.length });
    }
    else if (!state.search) items.push({ kind: "beginning", name: "beginning" });
    const markers = visibilityMarkers(room);
    const placed = new Set();
    let lastDay = "";
    for (const m of drawn) {
      const day = dayLabel(m.ts);
      if (day !== lastDay) {
        items.push({ kind: "day", name: `day:${day}:${m.id}`, day, ts: m.ts });
        lastDay = day;
      }
      for (const [seq, agents] of markers) {
        if (placed.has(seq) || !(m.seq >= seq)) continue;
        if (m.seq > 0) {
          placed.add(seq);
          items.push({ kind: "mark", name: `mark:${seq}:${agents.map((p) => p.id).join(",")}`, agents });
        }
      }
      items.push({ kind: "msg", name: m.id, m });
    }
    for (const [seq, agents] of markers) {
      if (!placed.has(seq)) items.push({ kind: "mark", name: `mark:${seq}:${agents.map((p) => p.id).join(",")}`, agents });
    }
    if (cacheKey) itemLists.set(room, { key: cacheKey, messages: room.messages, count: room.messages.length, items });
    return items;
  }

  function listRow(room, item) {
    switch (item.kind) {
      case "space": {
        const el = document.createElement("div");
        el.className = "msgs-space";
        el.setAttribute("aria-hidden", "true");
        return el;
      }
      case "msg": {
        const el = messageElement(room, item.m);
        if (arriving && arriving.has(item.m.id)) el.classList.add("history-static", "history-arriving");
        return el;
      }
      case "day": return dayElement(item.day, item.ts);
      case "beginning": {
        const el = document.createElement("div");
        el.className = "conversation-start";
        el.textContent = "The room starts here";
        return el;
      }
      case "mark": return dividerElement(item.agents);
      case "ceiling": return ceilingElement(room, item.hidden, item.pinned);
      default: {
        const pins = document.createElement("section");
        pins.className = "history-pins";
        pins.setAttribute("aria-label", "Pinned messages from earlier history");
        pins.innerHTML = `<span class="history-rule" aria-hidden="true"></span><div class="history-pins-label">${ic("pin")}<span></span></div><div class="history-pins-rows"></div>`;
        return pins;
      }
    }
  }

  function fillListRow(room, node, item, fresh) {
    if (item.kind === "space") { node.style.height = `${Math.max(0, Math.round(item.px))}px`; return; }
    if (item.kind === "pins") return fillPins(room, node, item.above);
    if (fresh) return;
    switch (item.kind) {
      case "msg":
        if (item.m.bodyMissing) { fillBodyPlaceholder(node, room, item.m); noteDrawn(node, item.m); return; }
        if (!deferredMessageParts.has(node) && drawnCurrent(node, item.m)) return;
        const pending = pendingPatch(node, item.m);
        if (pending) {
          dirty.delete(item.m.id);
          updateMessageElement(node, room, item.m, pending.parts, pending.toolIds);
          return;
        }
        updateMessageElement(node, room, item.m);
        return;
      case "ceiling":
        updateHistoryBoundary(room, item.hidden, item.pinned);
        return;
      default:
        return;
    }
  }

  function fillPins(room, node, above) {
    node.querySelector(".history-pins-label").lastElementChild.textContent = `${above.length} pinned from earlier`;
    const rows = [];
    let day = "";
    for (const m of above) {
      const label = dayLabel(m.ts);
      if (label !== day) {
        rows.push({ kind: "day", name: `day:${label}:${m.id}`, day: label, ts: m.ts });
        day = label;
      }
      rows.push({ kind: "msg", name: m.id, m });
    }
    KeyedList.patch(node.querySelector(".history-pins-rows"), rows, {
      key: "id",
      id: (row) => row.name,
      make: (row) => {
        const el = listRow(room, row);
        if (row.kind === "msg") el.classList.add("above-fold");
        return el;
      },
      fill: (el, row, _at, born) => fillListRow(room, el, row, born),
    });
  }

  const SAMPLE_ROWS = 40;
  const rowPrices = { stamp: "", perKind: new Map(), fallback: null, middle: 0, gap: 0, chrome: 0, said: new Set() };
  const rowInsets = new Map();
  function rowFlowBox(node, borderSize) {
    const style = getComputedStyle(node);
    const top = parseFloat(style.marginTop) || 0, bottom = parseFloat(style.marginBottom) || 0;
    let height = borderSize;
    if (height === undefined) {
      height = parseFloat(style.height);
      if (!Number.isFinite(height)) height = node.offsetHeight;
      else if (style.boxSizing !== "border-box") height += (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
        + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    }
    return { height: Math.max(0, height + top + bottom), inset: top };
  }
  function itemKind(item) {
    if (item.kind !== "msg") return item.kind;
    const m = item.m;
    const long = !m.streaming && (m.bodyChars ?? (m.text || "").length) > CLAMP_CHARS && !state.watched.has(m.id);
    return long && !state.expanded.has(m.id) ? "clamped" : "open";
  }
  const itemWeight = (item) => (item.kind === "msg" ? item.m.bodyChars ?? (item.m.text || "").length : 0);
  function priceItem(item) {
    if (item.kind === "space") return item.px;
    const kind = itemKind(item);
    const price = rowPrices.perKind.get(kind);
    if (price) return price.floor + price.rate * itemWeight(item);
    if (!rowPrices.said.has(kind)) {
      rowPrices.said.add(kind);
      noteFinding(`the list has a row of a kind it has no price for (${kind}); its height is being guessed`);
    }
    return rowPrices.middle;
  }
  const pricesStamp = () =>
    `${els.messages.clientWidth}|${document.documentElement.dataset.look || ""}|${document.documentElement.style.getPropertyValue("--chat-fs")}`;

  function priceRows(room, items) {
    const stamp = pricesStamp();
    if (rowPrices.stamp === stamp) return !!rowPrices.fallback;
    if (!room || !items?.length || !els.messages.clientWidth) return false;
    items = items.filter(item => item.kind !== "msg" || !item.m.bodyMissing);
    if (!items.length) return false;
    const step = Math.max(1, Math.floor(items.length / SAMPLE_ROWS));
    const sample = [];
    const kinds = new Set();
    for (let i = 0; i < items.length && sample.length < SAMPLE_ROWS; i += step) {
      sample.push({ item: items[i] });
      kinds.add(itemKind(items[i]));
    }
    for (let i = 0; i < items.length; i++) {
      const kind = itemKind(items[i]);
      if (kinds.has(kind)) continue;
      kinds.add(kind);
      sample.push({ item: items[i] });
    }

    const host = document.createElement("div");
    host.style.cssText = "height:0;overflow:hidden;flex:0 0 0px";
    const page = document.createElement("div");
    page.className = "msgs-page";
    page.style.contentVisibility = "visible";
    host.appendChild(page);
    const clones = sample.map(({ item }) => {
      const row = listRow(room, item);
      fillListRow(room, row, item, true);
      row.style.contentVisibility = "visible";
      page.appendChild(row);
      return row;
    });
    els.messages.appendChild(host);
    for (const inner of page.querySelectorAll(".msg, .msgs-page")) inner.style.contentVisibility = "visible";
    const boxes = clones.map(clone => rowFlowBox(clone));
    const heights = boxes.map(box => box.height);
    sample.forEach(({ item }, at) => rowInsets.set(itemKind(item), boxes[at].inset));
    const gap = parseFloat(getComputedStyle(page).rowGap) || 0;
    const chrome = Math.max(0, rowFlowBox(page).height - heights.reduce((sum, h) => sum + h, 0) - gap * Math.max(0, heights.length - 1));
    host.remove();

    const byKind = new Map();
    sample.forEach(({ item }, at) => {
      const kind = itemKind(item);
      const seen = byKind.get(kind) || { w: [], h: [] };
      seen.w.push(itemWeight(item));
      seen.h.push(heights[at]);
      byKind.set(kind, seen);
    });
    rowPrices.perKind = new Map([...byKind].map(([kind, seen]) => [kind, fitHeight(seen.w, seen.h)]));
    rowPrices.fallback = fitHeight(sample.map(({ item }) => itemWeight(item)), heights);
    rowPrices.middle = heights.reduce((sum, h) => sum + h, 0) / heights.length;
    rowPrices.said.clear();
    rowPrices.gap = gap;
    rowPrices.chrome = chrome;
    rowPrices.stamp = stamp;
    return true;
  }

  function fitHeight(weights, heights) {
    const n = heights.length;
    if (!n) return { floor: 0, rate: 0 };
    const floor = Math.min(...heights);
    const carried = weights.reduce((sum, w) => sum + w, 0);
    const above = heights.reduce((sum, h) => sum + h, 0) - n * floor;
    return { floor, rate: carried > 0 ? Math.max(0, above / carried) : 0 };
  }

  const MARGIN_SCREENS = 1;
  let keepingScroll = null;
  let followTimer = 0;
  function followWindow() {
    followTimer = 0;
    const room = currentRoom();
    if (!room || state.view !== "room" || !drawnWindow || room.historyRestoring) return;
    if (rowPrices.stamp !== pricesStamp()) { repriceSoon(); return; }
    const screen = els.messages.clientHeight;
    const top = stuck ? Math.max(0, ListIndex.total(listAccount) - screen) : els.messages.scrollTop;
    const needed = ListIndex.rangeFor(listAccount, Math.max(0, top - screen / 4), top + screen * 1.25);
    if (needed.from >= drawnWindow.from && needed.to <= drawnWindow.to) return;
    const next = drawnRange(listAccount.items);
    if (!next || (next.from === drawnWindow.from && next.to === drawnWindow.to)) return;
    keepingScroll = { top: els.messages.scrollTop, eye: eyeRow() };
    try {
      renderMessages("the window moved");
    } finally {
      keepingScroll = null;
    }
  }
  function eyeRow() {
    const box = Layout.rect(els.messages);
    for (const row of els.messages.querySelectorAll(".msg[data-id]")) {
      const r = Layout.rect(row);
      if (r.bottom > box.top + 4 && r.top < box.bottom) return { id: row.dataset.id, at: r.top - box.top };
    }
    return null;
  }
  function holdTheEye(eye) {
    if (!eye) return;
    const row = els.messages.querySelector(`.msg[data-id="${CSS.escape(eye.id)}"]`);
    if (!row) return;
    const box = Layout.rect(els.messages);
    const target = eye.part ? row.querySelector(eye.part) || row : row;
    const moved = Layout.rect(target).top - box.top - eye.at;
    if (Math.abs(moved) > 0.5) els.messages.scrollTop += moved;
  }

  function settleSpacers() {
    if (!drawnWindow || !listAccount) return;
    const above = els.messages.querySelector('.msgs-space[data-id="space:above"]');
    const belowNode = els.messages.querySelector('.msgs-space[data-id="space:below"]');
    const opening = listAccount.before ? listAccount.before(0) : 0;
    const want = Math.max(0, ListIndex.topOf(listAccount, drawnWindow.from) - opening - listAccount.gap);
    const below = Math.max(0, ListIndex.total(listAccount) - ListIndex.topOf(listAccount, drawnWindow.to));
    if (belowNode) belowNode.style.height = `${Math.round(below)}px`;
    if (above) above.style.height = `${Math.round(want)}px`;
  }
  function followWindowSoon() {
    if (followTimer || !drawnWindow) return;
    followTimer = requestAnimationFrame(followWindow);
  }


  function drawnRange(items, anchor = null) {
    if (!listAccount || !rowPrices.fallback || listAccount.items.length !== items.length) return null;
    const screen = els.messages.clientHeight || 0;
    if (!screen) return null;
    let top = stuck && !keepingScroll ? Math.max(0, ListIndex.total(listAccount) - screen) : els.messages.scrollTop;
    if (anchor) {
      const at = items.findIndex(item => item.name === anchor.id || (item.kind === "pins" && item.above.some(m => m.id === anchor.id)));
      if (at >= 0) {
        let inset = rowInsets.get(itemKind(items[at])) || 0;
        if (items[at].kind === "pins") {
          const child = drawnRow(anchor.id), block = child?.closest(".history-pins");
          if (block) inset += Layout.rect(child).top - Layout.rect(block).top;
        }
        top = Math.max(0, ListIndex.topOf(listAccount, at) + inset - anchor.into);
      }
    }
    return widenForSelection(ListIndex.rangeFor(listAccount, top - screen * MARGIN_SCREENS, top + screen * (1 + MARGIN_SCREENS)), items);
  }
  function widenForSelection(range, items) {
    const selection = window.getSelection();
    if (!range) return range;
    const rowAt = node => {
      const el = node?.nodeType === 3 ? node.parentElement : node;
      const row = el?.closest?.(".msg[data-id]");
      return row && els.messages.contains(row) ? items.findIndex(item => item.kind === "msg" && item.name === row.dataset.id) : -1;
    };
    const nodes = selection && !selection.isCollapsed && selection.rangeCount ? [selection.anchorNode, selection.focusNode] : [];
    if (textPress) nodes.push(textPress);
    const ends = nodes.map(rowAt).filter(at => at >= 0);
    if (!ends.length) return range;
    return { from: Math.min(range.from, ...ends), to: Math.max(range.to, ...ends.map(at => at + 1)) };
  }
  let heldTextSelection = false;
  let heldTextElement = null, releasedTextEye = null;
  function textPart(node) {
    const el = node?.nodeType === 3 ? node.parentElement : node;
    return el?.closest?.(".words, .thought, .tools") || el?.closest?.(".msg[data-id]") || null;
  }
  function rememberReleasedText() {
    const part = heldTextElement, row = part?.closest(".msg[data-id]");
    if (row && els.messages.contains(row)) releasedTextEye = {
      roomId: state.currentRoomId, id: row.dataset.id,
      part: ["words", "thought", "tools"].find(name => part.classList.contains(name)),
      at: Layout.rect(part).top - Layout.rect(els.messages).top,
    };
    if (releasedTextEye?.part) releasedTextEye.part = `.${releasedTextEye.part}`;
    heldTextElement = null;
  }
  document.addEventListener("selectionchange", () => {
    const selection = window.getSelection();
    chatSelection = selectionSnapshot(selection);
    const wasHeld = heldTextSelection;
    const inside = !!selection && !selection.isCollapsed && (els.messages.contains(selection.anchorNode) || els.messages.contains(selection.focusNode));
    heldTextSelection = inside;
    if (inside) heldTextElement = textPart(els.messages.contains(selection.anchorNode) ? selection.anchorNode : selection.focusNode);
    if (inside && !wasHeld) leaveTheEnd();
    if (wasHeld && !inside && state.view === "room") {
      rememberReleasedText();
      renderMessagesSoon("the text selection was released");
      resumeAfterText();
    }
  });
  function leaveTheEnd() {
    stuck = false;
    readingAway = true;
    calm.held = false;
    els.jumpLatest.hidden = false;
  }
  function resumeAfterText() {
    if (stuck || humanHoldsText()) return;
    if (deliberateReturn()) scrollToBottom("the text selection was released at the end");
  }
  function windowedItems(items, range) {
    if (!range) return items;
    const opening = listAccount.before ? listAccount.before(0) : 0;
    const above = Math.max(0, ListIndex.topOf(listAccount, range.from) - opening - listAccount.gap);
    const below = Math.max(0, ListIndex.total(listAccount) - ListIndex.topOf(listAccount, range.to));
    const shown = items.slice(range.from, range.to);
    return [
      ...(range.from ? [{ kind: "space", name: "space:above", px: above }] : []),
      ...shown,
      ...(range.to < items.length ? [{ kind: "space", name: "space:below", px: below }] : []),
    ];
  }

  let listAccount = null;
  let drawnWindow = null;
  const measuredRows = new Map();
  let measuredRoom = null;
  let measuredStamp = "";
  let measuredPins = "";
  let measuredCeiling = "";
  const observedRows = new Set();
  let measuredIndexes = new Map();
  const rowSizeObserver = new ResizeObserver((entries) => {
    if (!drawnWindow || !listAccount || state.view !== "room") return;
    if (rowPrices.stamp !== pricesStamp()) { repriceSoon(); return; }
    const eye = stuck ? null : eyeRow();
    let changed = false;
    for (const entry of entries) {
      const node = entry.target;
      if (!node.isConnected || !els.messages.contains(node)) continue;
      const at = measuredIndexes.get(node.dataset.id);
      if (at === undefined) continue;
      if (listAccount.items[at]?.m?.bodyMissing) continue;
      const measured = rowFlowBox(node, entry.borderBoxSize?.[0]?.blockSize);
      const px = measured.height;
      rowInsets.set(itemKind(listAccount.items[at]), measured.inset);
      if (!(px > 0)) continue;
      if (ListIndex.heightAt(listAccount, at) !== px) changed = ListIndex.measured(listAccount, at, px) || changed;
      measuredRows.set(node.dataset.id, px);
    }
    if (!changed) return;
    settleSpacers();
    if (stuck && !humanHoldsText()) scrollToBottom("visible message size changed");
    else holdTheEye(eye);
    followWindowSoon();
    renderTimelineSoon(false);
  });
  function observeDrawnRows() {
    const rows = new Set([...els.messages.querySelectorAll(":scope > .msgs-page > [data-id]")].filter(row => !row.classList.contains("msgs-space")));
    for (const row of observedRows) if (!rows.has(row)) { rowSizeObserver.unobserve(row); observedRows.delete(row); }
    for (const row of rows) if (!observedRows.has(row)) { observedRows.add(row); rowSizeObserver.observe(row); }
  }
  function refreshAccount(room, items) {
    if (!priceRows(room, items)) return;
    const stamp = pricesStamp();
    const sameGeometry = measuredRoom === room.id && measuredStamp === stamp;
    const changed = room.dirtyHeights || new Set();
    if (sameGeometry && listAccount?.items === items) {
      for (const id of changed) {
        const at = measuredIndexes.get(id);
        if (at !== undefined) ListIndex.repriceRow(listAccount, at, measuredRows.get(id) ?? priceItem(items[at]));
      }
      changed.clear();
      return;
    }
    changed.clear();
    if (measuredRoom !== room.id || measuredStamp !== stamp) {
      measuredRows.clear();
      measuredRoom = room.id;
      measuredStamp = stamp;
    }
    const pins = items.find(item => item.kind === "pins")?.above.map(m => m.id).join("|") || "";
    const ceiling = items.find(item => item.kind === "ceiling");
    const ceilingKey = ceiling ? `${ceiling.hidden}:${ceiling.pinned}` : "";
    if (pins !== measuredPins) { measuredRows.delete("pins"); measuredPins = pins; }
    if (ceilingKey !== measuredCeiling) { measuredRows.delete("ceiling"); measuredCeiling = ceilingKey; }
    const opening = parseFloat(getComputedStyle(els.messages).paddingTop) || 0;
    const before = (i) => (i === 0 ? opening : 0);
    listAccount = ListIndex.build(items, priceItem, rowPrices.gap, before);
    measuredIndexes = new Map(items.map((item, i) => [item.name, i]));
    const kept = new Set();
    items.forEach((item, i) => {
      kept.add(item.name);
      if (measuredRows.has(item.name)) ListIndex.measured(listAccount, i, measuredRows.get(item.name));
    });
    for (const id of measuredRows.keys()) if (!kept.has(id)) measuredRows.delete(id);
    ListIndex.shown = listAccount;
  }
  function takeRealHeights(offset = 0) {
    if (!listAccount) return;
    const missed = [];
    let at = offset;
    for (const page of els.messages.children) {
      if (!page.classList.contains("msgs-page")) continue;
      const first = page.firstElementChild;
      const drawn = !first || typeof first.checkVisibility !== "function" || first.checkVisibility({ contentVisibilityAuto: true });
      if (!drawn) { at += page.childElementCount; continue; }
      for (const row of page.children) {
        if (row.classList.contains("msgs-space")) continue;
        const itself = typeof row.checkVisibility !== "function" || row.checkVisibility({ contentVisibilityAuto: true });
        if (!itself) { at++; continue; }
        const measured = rowFlowBox(row);
        const real = measured.height;
        const item = listAccount.items[at];
        if (item?.m?.bodyMissing) { at++; continue; }
        if (item) rowInsets.set(itemKind(item), measured.inset);
        if (item && real > 0) measuredRows.set(item.name, real);
        missed.push(Math.abs(ListIndex.heightAt(listAccount, at) - real));
        ListIndex.measured(listAccount, at++, real);
      }
    }
    if (missed.length < 8) return;
    missed.sort((a, b) => a - b);
    const typical = missed[missed.length >> 1];
    if (typical > 40 && !accountSaidItMisses) {
      accountSaidItMisses = true;
      noteFinding(`the list's account is out by about ${Math.round(typical)} px on a row it can see`);
    }
  }
  let accountSaidItMisses = false;

  function guessPages(room, items) {
    if (!priceRows(room, items)) return;
    let at = 0;
    for (const page of els.messages.children) {
      if (!page.classList.contains("msgs-page")) continue;
      const rows = page.childElementCount;
      if (!rows) continue;
      let sum = rowPrices.chrome + rowPrices.gap * (rows - 1);
      for (let i = 0; i < rows; i++) sum += priceItem(items[at + i]);
      at += rows;
      page.style.containIntrinsicSize = `auto ${Math.round(sum)}px`;
    }
  }

  const REPRICE_AFTER_MS = 400;
  let repriceTimer = 0;
  function repriceSoon() {
    clearTimeout(repriceTimer);
    repriceTimer = setTimeout(() => {
      if (state.view !== "room" || !currentRoom() || !els.messages.children.length) return;
      if (rowPrices.stamp === pricesStamp()) return;
      renderMessages("the window changed shape");
    }, REPRICE_AFTER_MS);
  }

  function measureBornAbove(born, anchorAt) {
    if (anchorAt < 0) return;
    const shown = [];
    for (const { node, at } of born) {
      if (at >= anchorAt) break;
      for (const el of [node.parentElement, node]) {
        if (!el || el === els.messages) continue;
        shown.push([el, el.style.contentVisibility]);
        el.style.contentVisibility = "visible";
      }
    }
    if (!shown.length) return;
    els.messages.offsetHeight;
    for (const [el, was] of shown) el.style.contentVisibility = was;
  }

  let afterRender = [];
  function afterListRender(fn) { afterRender.push(fn); }
  let listPaintFrame = 0;
  function renderMessagesSoon(why) {
    if (listPaintFrame) return;
    const roomId = state.currentRoomId;
    listPaintFrame = requestAnimationFrame(() => {
      listPaintFrame = 0;
      if (state.view === "room" && state.currentRoomId === roomId) renderMessages(why);
    });
  }
  function renderMessages(why, savedAnchor) {
    const anotherRoom = listRoomId !== (currentRoom()?.id ?? null);
    if (anotherRoom) glideStop("another room");
    drawList(why, savedAnchor);
    if (anotherRoom) lastScrollTop = els.messages.scrollTop;
  }
  function drawList(why, savedAnchor) {
    lastListChange = { why, at: Date.now() };
    if (listPaintFrame) { cancelAnimationFrame(listPaintFrame); listPaintFrame = 0; }
    const t0 = performance.now();
    const room = currentRoom();
    if (room?.historyRestoring) {
      if (listRoomId !== room.id) {
        const controls = els.messages.querySelector(".history-load");
        if (controls) historyHintObserver.unobserve(controls);
        els.messages.innerHTML = `<div class="conversation-loading" role="status">${UI.html("skeleton", { lines: 3, shape: "bubble" })}${UI.html("skeleton", { lines: 2, shape: "bubble" })}<span class="placeholder-label">Loading conversation…</span></div>`;
      }
      listRoomId = room.id;
      return;
    }
    const releasedEye = releasedTextEye?.roomId === room?.id ? releasedTextEye : null;
    releasedTextEye = null;
    listRoomId = room ? room.id : null;
    const resized = settledReader?.roomId === room?.id && settledReader.stamp !== pricesStamp();
    const anchor = savedAnchor !== undefined ? savedAnchor
      : keepingScroll ? (keepingScroll.eye ? { id: keepingScroll.eye.id, into: keepingScroll.eye.at } : null)
      : resized ? settledReader.anchor : stuck ? null : readerAnchor();
    if (resized && !humanHoldsText()) { stuck = settledReader.following; if (!stuck) readingAway = true; }
    const eyeBefore = stuck || humanHoldsText() ? null : eyeRow();
    els.messages.classList.toggle("searching", !!state.search);
    if (!room) { els.messages.innerHTML = ""; return; }
    if (room.history?.bodyProtocol && !room.history.indexed && room.indexError) {
      els.messages.innerHTML = `<div class="empty" role="status">The conversation could not be loaded. <button class="linklike">Try again</button></div>`;
      els.messages.querySelector("button").onclick = () => void refreshHeld(room.id);
      return;
    }
    if (!room.messages.length) {
      els.messages.innerHTML = `<div class="empty"><div class="art">${ic("chat")}</div><strong>${esc(room.name)}</strong> is quiet.<br>Summon a vibemate from the left, then say hello. Use @Name to address someone; without @ every vibemate hears you.</div>`;
      return;
    }
    if (listSearch !== (state.search || "")) {
      listSearch = state.search || "";
      listGeneration++;
    }
    const items = listItems(room);
    const leaving = els.messages.querySelector(".history-load");
    if (leaving && !items.some((item) => item.kind === "ceiling")) historyHintObserver.unobserve(leaving);
    refreshAccount(room, items);
    drawnWindow = drawnRange(items, anchor);
    els.messages.classList.toggle("windowed", !!drawnWindow);
    const shown = windowedItems(items, drawnWindow);
    const loadedIds = new Set(shown.filter(item => item.kind === "msg" && !item.m.bodyMissing).map(item => item.name));
    for (const node of els.messages.querySelectorAll(".history-placeholder")) if (loadedIds.has(node.dataset.id)) node.remove();
    const born = [];
    const selection = window.getSelection();
    const savedSelection = selection && (!selection.isCollapsed || textPress) && selection.rangeCount
      && els.messages.contains(selection.anchorNode) && els.messages.contains(selection.focusNode)
      ? { anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset, focusNode: selection.focusNode, focusOffset: selection.focusOffset, isCollapsed: selection.isCollapsed, rangeCount: 1, range: selection.getRangeAt(0).cloneRange(), getRangeAt() { return this.range; } } : null;
    selectionDuringPatch = savedSelection;
    const typing = els.messages.contains(document.activeElement) && document.activeElement.matches(".edit-area")
      ? { id: document.activeElement.closest(".msg[data-id]")?.dataset.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd, direction: document.activeElement.selectionDirection, scroll: document.activeElement.scrollTop }
      : null;
    try {
    const firstRow = drawnWindow && drawnWindow.from ? 1 : 0;
    KeyedList.patchPaged(els.messages, shown, {
      key: "id",
      pageSize: PAGE_SIZE,
      pageOf: drawnWindow ? (item, at) => Math.floor((item.name === "space:above" ? drawnWindow.from : item.name === "space:below" ? drawnWindow.to - 1 : drawnWindow.from + at - firstRow) / PAGE_SIZE) : undefined,
      makePage: () => {
        const page = document.createElement("div");
        page.className = "msgs-page";
        return page;
      },
      id: (item) => item.name,
      make: (item) => listRow(room, item),
      fill: (node, item, at, fresh) => {
        if (fresh) born.push({ node, at });
        fillListRow(room, node, item, fresh);
      },
    });
    } finally {
      selectionDuringPatch = null;
      const area = typing?.id ? els.messages.querySelector(`.msg[data-id="${CSS.escape(typing.id)}"] .edit-area`) : null;
      if (area && document.activeElement !== area) {
        area.focus({ preventScroll: true });
        area.setSelectionRange(typing.start, typing.end, typing.direction);
        area.scrollTop = typing.scroll;
      }
      if (savedSelection?.anchorNode.isConnected && savedSelection.focusNode.isConnected) {
        const { anchorNode, anchorOffset, focusNode, focusOffset } = savedSelection;
        const current = window.getSelection();
        if (current && (current.anchorNode !== anchorNode || current.anchorOffset !== anchorOffset || current.focusNode !== focusNode || current.focusOffset !== focusOffset)) {
          current.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
        }
      }
    }
    if (anchor) measureBornAbove(born, shown.findIndex((item) => item.kind === "msg" && item.name === anchor.id));
    if (!drawnWindow) guessPages(room, items);
    takeRealHeights(drawnWindow ? drawnWindow.from : 0);
    observeDrawnRows();
    for (const perm of room.permissions) renderPermission(room, perm);
    for (const prop of room.proposals || []) renderProposal(room, prop);
    for (const asked of room.newRooms || []) renderNewRoom(room, asked);
    syncRecovery(room);
    refreshSeen(room);
    settleSpacers();
    if (releasedEye) holdTheEye(releasedEye);
    else if (keepingScroll) {
      if (keepingScroll.eye) holdTheEye(keepingScroll.eye);
      else els.messages.scrollTop = keepingScroll.top;
    } else if (!restoreReader(anchor) && !humanHoldsText()) {
      if (stuck) scrollToBottom("the list was rebuilt");
      else {
        if (eyeBefore && els.messages.querySelector(`.msg[data-id="${CSS.escape(eyeBefore.id)}"]`)) holdTheEye(eyeBefore);
        noteHeldPlace(anchor ? "the list was rebuilt and the place was not found" : "the list was rebuilt without a place to return to");
      }
    }
    renderTimelineAfterList();
    rememberReader();
    if (room.history?.indexed) {
      const visibleIds = shown.filter(item => item.kind === "msg").map(item => item.name);
      WindowBodies.touch(room, visibleIds);
      trimBodyCache(room, visibleIds);
      void loadBodies(room, visibleIds);
    }
    followWindowSoon();
    const ready = afterRender;
    afterRender = [];
    for (const fn of ready) fn();
    const tally = (globalThis.VIBEROOM_LIST ||= { renders: 0, lastWhy: "", byWhy: {}, log: [] });
    tally.renders += 1;
    tally.lastWhy = why || "unnamed";
    tally.byWhy[tally.lastWhy] = (tally.byWhy[tally.lastWhy] || 0) + 1;
    (tally.log ||= []).push({ why: tally.lastWhy, at: Math.round(performance.now()), ms: Math.round(performance.now() - t0) });
    if (tally.log.length > 400) tally.log.shift();
    noteSlow(`full render of the list (${why || "unnamed"})`, performance.now() - t0);
  }

  function upsertMessage(roomId, m) {
    const room = state.rooms.get(roomId);
    if (!room) return;
    if (m.from === "human" && !m.pending && !room.messages.some((x) => x.id === m.id)) {
      const local = room.messages.find((x) => x.pending && x.from === "human" && x.text === m.text);
      if (local) adoptLocalMessage(roomId, local.id, m.id);
    }
    let idx = room.messages.findIndex((x) => x.id === m.id);
    if (idx < 0 && aboveHeld(room, m)) {
      room.pinnedOlder = (room.pinnedOlder || []).filter((p) => p.id !== m.id);
      if (m.pinned && m.kind === "chat") {
        room.pinnedOlder.push(m);
        room.pinnedOlder.sort((a, b) => (before(cursorOf(a), cursorOf(b)) ? -1 : 1));
      }
      syncHistoryCount(room);
      if (roomId === state.currentRoomId && state.view === "room") renderMessages("a message above the held part changed");
      return;
    }
    const wasFinal = idx >= 0 && !room.messages[idx].streaming;
    if (idx >= 0) {
      if (!("pinned" in m)) delete room.messages[idx].pinned;
      if (m.seq > 0 && !("displayOrder" in m)) delete room.messages[idx].displayOrder;
      Object.assign(room.messages[idx], m);
      if (room.history?.bodyProtocol && !m.bodyMissing) {
        delete room.messages[idx].bodyMissing;
        delete room.messages[idx].bodyChars;
        delete room.messages[idx].bodyError;
        WindowBodies.invalidate(room.messages[idx]);
      }
      edited(room.messages[idx]);
    } else room.messages.push(m);
    room.messages.sort(HistoryWindow.compareMessages);
    idx = room.messages.findIndex(x => x.id === m.id);
    syncHistoryCount(room);
    const inView = roomId === state.currentRoomId && state.view === "room";
    const existing = inView ? els.messages.querySelector(`.msg[data-id="${m.id}"]`) : null;
    const showing = inView && (!room.historyRestoring || !!existing);
    if (!wasFinal && !m.streaming) noticeArrival(room, room.messages[idx]);
    if (!showing) {
      if (listRoomId === room.id) listRoomId = null;
      renderOverviewSoon();
      return;
    }
    if (!stuck && !humanHoldsText() && restedAtEnd(Date.now())) {
      stuck = true;
      readingAway = false;
    }
    const stick = stuck;
    if (existing && !wasFinal && !m.streaming && m.kind === "chat") watchGrown(existing, m.id);
    if (existing) updateMessageElement(existing, room, room.messages[idx]);
    else {
      const mine = idx >= 0 ? room.messages[idx] : m;
      const at = room.messages.indexOf(mine);
      if (at >= 0 && at < foldIndex(room)) {
        if (mine.pinned && mine.kind === "chat") renderMessages("a folded message was pinned");
        return;
      }
      if (drawnWindow) {
        { const t = globalThis.VIBEROOM_LIST; if (t) { (t.arrivals ||= []).push({ id: m.id, streaming: !!m.streaming, kind: m.kind, at: Math.round(performance.now()), window: `${drawnWindow.from}..${drawnWindow.to}`, idx }); if (t.arrivals.length > 400) t.arrivals.shift(); } }
        renderMessagesSoon("a message arrived in the virtual list");
        afterListRender(() => {
          const born = els.messages.querySelector(`.msg[data-id="${CSS.escape(m.id)}"]`);
          if (born) landing(born);
        });
        if (m.streaming && m.from !== "human") renderSideRoom();
        else if (!stick && m.kind === "chat") noteNew(room, m);
        if (!wasFinal && !m.streaming && m.kind === "chat" && m.from !== "human") noteFinished(room, m);
        return;
      }
      const empty = els.messages.querySelector(".empty");
      if (empty) empty.remove();
      placeInList(landing(messageElement(room, m)));
      if (m.from === "human") refreshSeen(room);
      if (m.streaming && m.from !== "human") renderSideRoom();
      else if (!stick && m.kind === "chat") noteNew(room, m);
    }
    if (stick) {
      if (CALM !== "off" && m.streaming && m.from !== "human" && !existing && !humanHoldsText()) calmStart(m.id);
      else if (!humanHoldsText()) scrollToBottom("a message arrived");
    } else if (calm.held) calmAfterGrowth();
    if (m.streaming) updateWorkingNow();
    if (!wasFinal && !m.streaming && m.kind === "chat" && m.from !== "human") noteFinished(room, m);
    if (m.from === "human") renderTimeline();
  }

  function removeMessage(roomId, id) {
    const room = state.rooms.get(roomId);
    if (!room) return;
    room.messages = room.messages.filter((m) => m.id !== id);
    room.pinnedOlder = (room.pinnedOlder || []).filter(m => m.id !== id);
    syncHistoryCount(room);
    if (roomId !== state.currentRoomId) return;
    const el = els.messages.querySelector(`.msg[data-id="${id}"]`);
    if (el) el.remove();
    measuredRows.delete(id);
    if (state.view === "room") renderMessagesSoon("a message was removed");
  }

  const dirty = new Map();
  let flushScheduled = false;
  let lastTypedAt = 0;
  const TYPING_FLUSH_MS = 250;
  const STREAM_FLUSH_MS = 30;
  const TYPING_WINDOW_MS = 1500;
  const watchingTheBottom = () => stuck;
  const watchedLeave = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) continue;
      const el = entry.target;
      const id = el.dataset.id;
      if (!state.watched.has(id)) { watchedLeave.unobserve(el); continue; }
      const box = Layout.rect(els.messages);
      const r = Layout.fromRect(entry.boundingClientRect);
      const below = r.top >= box.bottom;
      const above = r.bottom <= box.top;
      if (!below && !(above && stuck)) continue;
      state.watched.delete(id);
      watchedLeave.unobserve(el);
      const room = currentRoom();
      const m = room && room.messages.find((x) => x.id === id);
      if (m && el.isConnected) updateMessageElement(el, room, m);
    }
  }, { root: els.messages, threshold: 0 });
  function watchGrown(el, id) {
    state.watched.add(id);
    watchedLeave.observe(el);
  }
  function patchMessage(roomId, id, fn, part, toolId) {
    const room = state.rooms.get(roomId);
    if (!room) return;
    const m = room.messages.find((x) => x.id === id);
    if (!m || !m.streaming) return;
    const base = edits.get(m) || 0;
    fn(m);
    edited(m);
    if (roomId !== state.currentRoomId || state.view !== "room") return;
    if (part === "tools" && m.from !== "human") scheduleRosterRedraw(60);
    const entry = dirty.get(id) || { room, parts: new Set(), toolIds: new Set(), base, patches: 0 };
    entry.patches += 1;
    if (part && entry.parts) entry.parts.add(part);
    else entry.parts = null;
    if (part === "tools" && entry.toolIds) {
      if (toolId) entry.toolIds.add(toolId);
      else entry.toolIds = null;
    }
    dirty.set(id, entry);
    if (flushScheduled) return;
    flushScheduled = true;
    const slow = Date.now() - lastTypedAt < TYPING_WINDOW_MS || !watchingTheBottom();
    setTimeout(() => requestAnimationFrame(flushPatches), slow ? TYPING_FLUSH_MS : STREAM_FLUSH_MS);
  }
  function flushPatches() {
    flushScheduled = false;
    if (Date.now() - lastTypedAt < TYPING_WINDOW_MS && navigator.scheduling?.isInputPending?.()) {
      flushScheduled = true;
      setTimeout(() => requestAnimationFrame(flushPatches), TYPING_FLUSH_MS);
      return;
    }
    const t0 = performance.now();
    const batch = [...dirty];
    dirty.clear();
    let touched = false;
    for (const [id, { room, parts, toolIds }] of batch) {
      if (state.rooms.get(room.id) !== room || room.historyRestoring || room.id !== state.currentRoomId || state.view !== "room") continue;
      const m = room.messages.find((x) => x.id === id);
      const el = m && els.messages.querySelector(`.msg[data-id="${id}"]`);
      if (!el) continue;
      updateMessageElement(el, room, m, parts, toolIds);
      touched = true;
    }
    if (touched) {
      if (calm.held) calmAfterGrowth();
      else followEnd("a reply grew");
    }
    if (touched) updateWorkingNow();
    if (touched) noteSlow("streamed frame", performance.now() - t0);
  }


  function openInlineEditor(el, room, m, options) {
    const focus = options?.focus !== false;
    const box = el.querySelector(".edit-box");
    const text = el.querySelector(".text");
    if (!box || !box.hidden) return;
    const opening = !editors.has(m.id);
    const held = editors.get(m.id) || { roomId: room.id, text: m.text, start: m.text.length, end: m.text.length };
    editors.set(m.id, held);
    box.innerHTML = `<textarea class="edit-area" rows="3"></textarea><div class="row-btns">${UI.html("button", { label: "Cancel", kind: "ghost", size: "sm", hook: "edit-cancel" })}${UI.html("button", { label: "Save", kind: "primary", size: "sm", hook: "edit-save" })}</div>`;
    const area = box.querySelector(".edit-area");
    area.value = held.text;
    box.hidden = false;
    text.hidden = true;
    el.classList.add("editing");
    const keep = () => { held.text = area.value; held.start = area.selectionStart; held.end = area.selectionEnd; };
    for (const kind of ["input", "select", "keyup", "pointerup"]) area.addEventListener(kind, keep);
    if (focus) {
      area.focus();
      area.setSelectionRange(held.start, held.end);
    }
    if (opening) leaveTheEnd();
    const close = () => {
      editors.delete(m.id);
      box.hidden = true;
      box.innerHTML = "";
      text.hidden = false;
      el.classList.remove("editing");
      resumeAfterText();
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


  function placeCard(card, room, at) {
    const anchorId = cardAnchor(room, at);
    if (anchorId) {
      const anchor = els.messages.querySelector(`.msg[data-id="${CSS.escape(anchorId)}"]`);
      if (anchor) { anchor.insertAdjacentElement("afterend", card); return true; }
      return false;
    }
    const firstId = room.messages[0] && room.messages[0].id;
    const first = firstId ? els.messages.querySelector(`.msg[data-id="${CSS.escape(firstId)}"]`) : null;
    if (first) { first.insertAdjacentElement("beforebegin", card); return true; }
    return false;
  }
  function cardAnchor(room, at) {
    if (Number.isFinite(at.afterSeq)) {
      let best = null;
      for (const m of room.messages) if (m.seq > 0 && m.seq <= at.afterSeq && (!best || m.seq > best.seq)) best = m;
      return best ? best.id : null;
    }
    const ts = at.ts || Date.now();
    let anchorId = null;
    for (const m of room.messages) if (m.ts <= ts) anchorId = m.id;
    return anchorId;
  }
  const OPTION_TONE = { allow_once: "ok", allow_always: "ok", reject_once: "no", reject_always: "no" };
  const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|\uDB40[\uDC00-\uDC7F]/g;
  function markInvisible(text) {
    let found = 0;
    const shown = text.replace(INVISIBLE, (ch) => { found++; return `⟦U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}⟧`; });
    return found ? `⚠ ${found} invisible character${found === 1 ? "" : "s"}, shown as ⟦U+…⟧\n${shown}` : text;
  }
  function renderPermission(room, perm) {
    const p = findById(room, perm.participantId);
    const tc = perm.toolCall || {};
    const choices = (perm.options || []).map((option) => ({ label: option.name, tone: OPTION_TONE[option.kind] || "plain", act: "permit", title: option.kind, data: { option: option.optionId } }));
    choices.push({ label: "Dismiss (cancelled)", act: "permit" });
    const card = UI.el("ask-card", { kind: "permission", who: p ? p.name : perm.participantId, subject: tc.title || tc.toolCallId || "tool call", subjectKind: tc.kind || undefined, input: tc.rawInput ? markInvisible(JSON.stringify(tc.rawInput, null, 1)) : undefined, choices, data: { key: perm.key } });
    const draft = [...room.messages].reverse().find((m) => m.streaming && m.from === perm.participantId);
    const host = draft ? els.messages.querySelector(`.msg[data-id="${draft.id}"] .perms`) : null;
    if (host) host.appendChild(card);
    else placeCard(card, room, perm);
    followEnd("a permission card");
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
  function modelName(room, agentType, model) {
    if (!model) return "";
    for (const other of (room.participants || [])) {
      if (agentType && other.agentType && other.agentType !== agentType) continue;
      for (const option of other.configOptions || []) {
        if (option.type !== "select") continue;
        const found = flattenOptions(option.options).find((c) => String(c && c.value) === String(model));
        if (found && found.name) return found.name;
      }
    }
    return model;
  }

  function renderNewRoom(room, p) {
    const existing = els.messages.querySelector(`[data-ui="ask-card"][data-kind="new-room"][data-key="${CSS.escape(p.key)}"]`);
    const plan = p.plan || {};
    const cast = (plan.vibemates || []).map((v) => `${esc(v.name)}${v.model ? ` (${esc(modelName(room, v.agentType, v.model))})` : ""}`);
    const who = cast.length > 1 ? `${cast.slice(0, -1).join(", ")} and ${cast[cast.length - 1]}` : cast[0] || "";
    const sessions = (plan.price && plan.price.sessions) || 0;
    const wanted = String(plan.name || "").trim().toLowerCase();
    const nameTaken = [...state.rooms.values()].some((r) => String(r.name || "").trim().toLowerCase() === wanted);
    const body =
      (p.plan && p.plan.why ? `<div class="prop-why">${esc(p.plan.why)}</div>` : "") +
      `<div class="prop-row">${who} — <b>${sessions} new session${sessions === 1 ? "" : "s"}</b></div>` +
      `<div class="prop-line">No working folder yet · not reachable from a messenger · ${cast.length === 1 ? "it starts in a mode that asks before it acts" : "they all start in a mode that asks before they act"}.</div>` +
      (nameTaken ? `<div class="prop-line">There is already a room called ${esc(plan.name || "")}.</div>` : "");
    const outcome = p.status === "pending" ? undefined : p.status === "created" ? "created" : "not created";
    const card = UI.el("ask-card", {
      kind: "new-room", who: p.participantName, lead: `proposes a room called ${plan.name || ""}`, body, outcome,
      choices: [{ label: "Create", tone: "ok", act: "make-room", data: { answer: "create" } }, { label: "No", tone: "no", act: "make-room", data: { answer: "no" } }],
      data: { key: p.key },
    });
    if (existing) existing.replaceWith(card);
    else {
      placeCard(card, room, p);
      followEnd("a new-room card");
    }
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
      placeCard(card, room, p);
      followEnd("a proposal card");
    }
  }
  function renderRecovery(room, r) {
    const existing = els.messages.querySelector('[data-ui="ask-card"][data-kind="recovery"]');
    const when = r.lastTs ? new Date(r.lastTs).toLocaleString() : null;
    const body = `<div class="prop-why">${r.rows} message${r.rows === 1 ? "" : "s"}${when ? `, the last from ${esc(when)}` : ""}. The copy may lack the newest changes. Until you decide, the room is read-only: nothing new is written and no vibemate answers. To use the original instead, put history.jsonl back in the room's folder and restart.</div>`;
    const card = UI.el("ask-card", { kind: "recovery", who: "The room", lead: "has no history file, only its own copy of the conversation", body, outcome: r.status === "adopted" ? "the copy is the record now; the room is open" : undefined, choices: [{ label: "Use the copy the room has", tone: "ok", act: "adopt-copy" }], data: { key: "recovery" } });
    if (existing) existing.replaceWith(card);
    else placeCard(card, room, r);
  }
  function syncRecovery(room) {
    if (room.recovery) renderRecovery(room, room.recovery);
    else {
      const stale = els.messages.querySelector('[data-ui="ask-card"][data-kind="recovery"]');
      if (stale) stale.remove();
    }
    applyReadOnly(room);
  }
  function applyRecoveryAnswer(roomId, r) {
    const target = state.rooms.get(roomId);
    if (!target || !r) return;
    target.recovery = r;
    if (r.status === "adopted") target.readOnly = false;
    if (roomId === state.currentRoomId && state.view === "room") syncRecovery(target);
  }
  const COMPOSER_PLACEHOLDER = composer.placeholder;
  function applyReadOnly(room) {
    const held = !!(room && room.readOnly);
    composer.disabled = held;
    composer.placeholder = held ? "Read-only until the room's record is settled (see the room line and the card)" : COMPOSER_PLACEHOLDER;
  }
  function resolveProposalCard(room, key, status) {
    const p = (room.proposals || []).find((x) => x.key === key);
    if (p) {
      p.status = status;
      renderProposal(room, p);
    }
  }


  const DETAILS_MIN = 320;
  const DETAILS_MAX = 960;
  const DETAILS_WIDTH_KEY = "panel-width";
  function defaultDetailsWidth() {
    return Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--details-w")) || 0);
  }

  function detailsKey() {
    return state.selection.kind === "participant" ? "participant" : state.selection.kind;
  }
  function panelSide() {
    return state.selection.kind === "participant" ? "left" : "right";
  }
  function applyDetailsWidth(px, persist) {
    const w = Math.max(DETAILS_MIN, Math.min(DETAILS_MAX, Math.round(px)));
    els.details.style.setProperty("--details-w", `${w}px`);
    if (persist) remember(`${DETAILS_WIDTH_KEY}.${detailsKey()}`, JSON.stringify({ width: w, against: defaultDetailsWidth() }));
  }
  function fitDetailsWidth() {
    const key = detailsKey();
    let saved = null;
    try { saved = JSON.parse(recall(`${DETAILS_WIDTH_KEY}.${key}`) || "null"); } catch { }
    if (saved && saved.against === defaultDetailsWidth() && Number.isFinite(saved.width) && saved.width > 0) applyDetailsWidth(saved.width, false);
    else els.details.style.removeProperty("--details-w");
  }
  function openDetails(selection) {
    state.selection = selection;
    state.detailsOpen = true;
    els.app.dataset.panel = panelSide();
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
        delete els.app.dataset.panel;
      }
    }, 190);
    if (state.view === "room") renderSideRoom();
    renderRail();
  }
  function renderDetails() {
    if (!state.detailsOpen) return;
    const room = currentRoom();
    if (!room) {
      els.detailsInner.innerHTML = '<div class="empty">Open a room to begin.</div>';
      return;
    }
    if (state.selection.kind === "participant") {
      const p = findById(room, state.selection.id);
      if (p && p.kind === "agent") return renderAgentPanel(room, p);
    }
    renderRoomPanel(room);
  }
  function profileHeader(p) {
    return `${avatar(p, 88, { vendor: true, status: true, muted: p.muted })}
        <div class="who">
          <h3>${esc(p.name)}</h3>
          <div class="tagline">${esc(p.tagline || "no vibersona")}</div>
          <div class="badges">${UI.html("badge", { label: p.agentVendor || p.agentType || "vibemate" })}${UI.html("badge", { label: STATUS_LABEL[p.status] || p.status, tone: STATUS_TONE[p.status] || "plain" })}${p.muted ? UI.html("badge", { label: "muted", tone: "muted" }) : ""}</div>
        </div>`;
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

  const PANEL_SECTIONS = {
    room: [
      { id: "general", label: "General", glyph: "rooms", tone: "violet" },
      { id: "rules", label: "Rules", glyph: "journal", tone: "amber" },
      { id: "conversation", label: "Conversation", glyph: "chat", tone: "sky" },
      { id: "start", label: "Start", glyph: "power", tone: "mint" },
      { id: "briefs", label: "Briefs", glyph: "sliders", geek: true },
    ],
    vibemate: [
      { id: "persona", label: "Persona", glyph: "smile", tone: "peach" },
      { id: "agent", label: "Agent", glyph: "bot", tone: "violet" },
      { id: "skills", label: "Skills", glyph: "skills", tone: "orchid" },
      { id: "timing", label: "Timing", glyph: "clock", geek: true },
      { id: "stats", label: "Stats", glyph: "gauge", geek: true },
    ],
  };
  const PANEL_PREFIX = { room: "rp", vibemate: "pp" };
  function panelSectionShown(kind) {
    const saved = recall(`panel.${kind}.section`);
    return PANEL_SECTIONS[kind].some((c) => c.id === saved) ? saved : PANEL_SECTIONS[kind][0].id;
  }
  function panelSectionsHtml(kind, bodies, formId) {
    const items = PANEL_SECTIONS[kind];
    const prefix = PANEL_PREFIX[kind];
    const shown = panelSectionShown(kind);
    return `${UI.html("settings-nav", { items, current: shown, layout: "row", prefix, label: `Sections of the ${kind === "room" ? "room's" : "vibemate's"} settings` })}
      <div id="${formId}" class="panel-sections" data-kind="${kind}">
        ${items.map((c) => UI.html("settings-category", { id: c.id, title: c.label, glyph: c.glyph, tone: c.tone || "slate", geek: !!c.geek, current: c.id === shown, form: "section", prefix, body: UI.raw(bodies[c.id] || "") })).join("")}
        <p class="hint panel-nothing" role="status" hidden></p>
      </div>`;
  }
  function showPanelSection(id, { focus = false } = {}) {
    const pages = els.detailsInner.querySelector(".panel-sections[data-kind]");
    const nav = els.detailsInner.querySelector('[data-ui="settings-nav"]');
    if (!pages || !nav || !pages.querySelector(`:scope > [data-category="${CSS.escape(id)}"]`)) return false;
    const kind = pages.dataset.kind;
    remember(`panel.${kind}.section`, id);
    if (panelQueries.get(kind)) {
      panelQueries.delete(kind);
      const search = document.getElementById("panel-search");
      if (search) search.value = "";
    }
    for (const b of nav.querySelectorAll("button[data-category]")) {
      const on = b.dataset.category === id;
      UI.setState(b, on ? "on" : null);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    applyPanelSearch();
    fitPanelTabs(nav);
    if (Layout.rect(nav).top < Layout.rect(els.detailsInner).top) nav.scrollIntoView({ block: "nearest" });
    return true;
  }
  function fitPanelTabs(nav) {
    if (!nav || !nav.isConnected) return;
    for (const state of [null, "compact", "tight"]) {
      UI.setState(nav, state);
      if (nav.scrollWidth <= nav.clientWidth + 1) break;
    }
    placeSettingsBar(nav);
  }
  let panelWidthWatch = null;
  function wirePanel() {
    fitPanelTabs(els.detailsInner.querySelector('[data-ui="settings-nav"]'));
    if (!panelWidthWatch && window.ResizeObserver) {
      panelWidthWatch = new ResizeObserver(() => fitPanelTabs(els.detailsInner.querySelector('[data-ui="settings-nav"]')));
      panelWidthWatch.observe(els.detailsInner);
    }
    applyPanelSearch();
  }

  const panelQueries = new Map();
  function searchWords(query) {
    return String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  }
  function holdsEvery(text, words) {
    const lower = text.toLowerCase();
    return words.every((w) => lower.includes(w));
  }
  function settingWords(row, withGeek) {
    const parts = [".name", ".hint", ".status", ":scope > .control", ...(withGeek ? [":scope > .geek-text"] : [])];
    return parts.map((s) => row.querySelector(s)?.textContent || "").join(" ");
  }
  function panelSearchHtml(kind, placeholder) {
    return `<label class="search panel-search"><span class="search-icon">${ic("search")}</span><input type="search" id="panel-search" data-panel-kind="${kind}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" value="${esc(panelQueries.get(kind) || "")}"></label>`;
  }
  function applyPanelSearch() {
    const pages = els.detailsInner.querySelector(".panel-sections[data-kind]");
    if (!pages) return;
    const kind = pages.dataset.kind;
    const query = panelQueries.get(kind) || "";
    const words = searchWords(query);
    for (const el of pages.querySelectorAll("[data-search-hid]")) {
      el.hidden = false;
      delete el.dataset.searchHid;
    }
    for (const el of pages.querySelectorAll("[data-search-opened]")) {
      el.hidden = true;
      delete el.dataset.searchOpened;
      const tip = el.closest('[data-ui="setting"]')?.querySelector(".geek-tip");
      if (tip) {
        tip.classList.remove("on");
        tip.setAttribute("aria-expanded", "false");
      }
    }
    if (globalThis.CSS?.highlights) CSS.highlights.delete("panel-search");
    const sections = [...pages.querySelectorAll(':scope > [data-ui="settings-category"]')];
    const nothing = pages.querySelector(":scope > .panel-nothing");
    if (!words.length) {
      const shown = panelSectionShown(kind);
      for (const section of sections) {
        section.hidden = section.dataset.category !== shown;
        UI.setState(section, null);
      }
      nothing.hidden = true;
      return;
    }
    const lit = [];
    for (const section of sections) {
      const sectionName = section.querySelector(":scope > .head h4")?.textContent || "";
      let found = 0;
      for (const card of section.querySelectorAll('[data-ui="settings-group"]')) {
        const cardName = card.querySelector(":scope > h3")?.textContent || "";
        let inCard = 0;
        for (const child of card.querySelectorAll(":scope > .group-body > *")) {
          if (child.hidden) continue;
          const row = child.matches('[data-ui="setting"]');
          if (!holdsEvery(`${sectionName} ${cardName} ${row ? settingWords(child, true) : child.textContent}`, words)) {
            child.hidden = true;
            child.dataset.searchHid = "";
            continue;
          }
          inCard++;
          if (!row) continue;
          lit.push(child);
          const geekText = child.querySelector(":scope > .geek-text");
          if (geekText && geekText.hidden && !holdsEvery(`${sectionName} ${cardName} ${settingWords(child, false)}`, words)) {
            geekText.hidden = false;
            geekText.dataset.searchOpened = "";
            const tip = child.querySelector(".geek-tip");
            if (tip) {
              tip.classList.add("on");
              tip.setAttribute("aria-expanded", "true");
            }
          }
        }
        if (!inCard) {
          card.hidden = true;
          card.dataset.searchHid = "";
        }
        found += inCard;
      }
      section.hidden = !found;
      UI.setState(section, found ? "found" : null);
    }
    nothing.hidden = lit.length > 0 || sections.some((s) => !s.hidden);
    nothing.textContent = nothing.hidden ? "" : `Nothing in these settings matches “${query.trim()}”.`;
    lightPanelSearch(lit, words);
  }
  function lightPanelSearch(rows, words) {
    if (!globalThis.CSS?.highlights || typeof Highlight !== "function") return;
    const ranges = [];
    for (const row of rows) {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest("select, textarea, [contenteditable]")) continue;
        const text = node.data.toLowerCase();
        for (const w of words) {
          for (let at = text.indexOf(w); at >= 0; at = text.indexOf(w, at + w.length)) {
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + w.length);
            ranges.push(range);
          }
        }
      }
    }
    CSS.highlights.set("panel-search", new Highlight(...ranges));
  }
  document.addEventListener("input", (e) => {
    if (e.target.id !== "panel-search") return;
    panelQueries.set(e.target.dataset.panelKind, e.target.value);
    applyPanelSearch();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || e.target.id !== "panel-search" || !e.target.value) return;
      e.preventDefault();
      e.stopPropagation();
      e.target.value = "";
      panelQueries.delete(e.target.dataset.panelKind);
      applyPanelSearch();
    },
    true,
  );
  function pickNowHtml(now, title) {
    return `<span class="pick-now" aria-hidden="true">${now}</span>${UI.html("button", { label: "Change…", kind: "secondary", size: "sm", act: "setting-fold", title })}`;
  }
  function closeSettingFold(row) {
    const fold = row && row.querySelector(":scope > .fold");
    if (!fold || fold.hidden) return;
    fold.hidden = true;
    row.querySelector('[data-act="setting-fold"]')?.setAttribute("aria-expanded", "false");
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest('[data-ui="setting"] [data-act="setting-fold"]');
    if (!b) return;
    const row = b.closest('[data-ui="setting"]');
    const fold = row.querySelector(":scope > .fold");
    if (!fold) return;
    fold.hidden = !fold.hidden;
    b.setAttribute("aria-expanded", String(!fold.hidden));
    if (!fold.hidden) fold.querySelector("input, button")?.focus({ preventScroll: true });
  });
  function roomPanelState(room) {
    return JSON.stringify([room.name, room.dir, room.settings, room.customRulesText, room.focused, room.startingWithHub, room.hopLimit]);
  }
  function refreshRoomHeader(room) {
    const header = els.detailsInner.dataset.panel === "room" && els.detailsInner.querySelector(".profile");
    if (header) header.innerHTML = roomProfileHeader(room);
  }
  function roomProfileHeader(room) {
    const rs = room.settings || {};
    return `${roomMark(room, "lg")}
        <div class="who">
          <h3>${esc(room.name)}</h3>
          <div class="tagline">${esc(rs.topic || "no topic")}</div>
        </div>`;
  }

  function renderAgentPanel(room, p) {
    const rec = state.recipes.find((r) => r.id === p.agentType);
    const offline = p.status === "offline";
    const mutedStartup = offline && p.muted && p.startupSkipped === "muted";
    const roomDelay = room.settings.replyDelay ?? 4;
    const stat = (label, value) => settingRow({ label, control: value });
    const tiles = state.recipes.filter((r) => !r.unavailableReason || r.id === p.agentType).map((r) => `<button type="button" class="agent-tile${r.id === p.agentType ? " selected" : ""}" data-agent="${esc(r.id)}" title="${esc(r.label)}">${vendorLogo(r, "lg")}<span class="at-name">${esc(r.vendor)}</span></button>`).join("");
    const sections = {
      persona: settingsCard("pp-persona", "", [
        settingRow({ label: "Vibename", for: "pp-name", control: UI.raw(`<input type="text" class="input" id="pp-name" maxlength="24" value="${esc(p.name)}">`) }),
        settingRow({ label: "Vibersona", for: "pp-tagline", hint: "Shown under the vibename.", geek: "Everyone in the room sees it: you, and the other vibemates in their roster.", control: UI.raw(`<input type="text" class="input" id="pp-tagline" maxlength="80" value="${esc(p.tagline || "")}" placeholder="a few words under the vibename">`) }),
        settingRow({ label: "Vibeface", id: "pp-avatar-row", hint: "Its face in the room and in the list of vibemates.", control: UI.raw(pickNowHtml(avatar(p, 36), "Pick another face")), fold: UI.raw(`<div id="pp-avatar-picker"></div><input type="text" class="input" id="pp-avatar" maxlength="40" value="${esc(p.avatar || "")}" placeholder="custom emoji (optional)">`) }),
        settingRow({ label: "Vibio", for: "pp-role", stacked: true, hint: UI.raw('Only this vibemate reads it.<span class="count" id="pp-role-count"></span>'), geek: "Changes reach this vibemate as updated instructions on its next turn; its memory is kept. Other vibemates never receive this text. The room settings limit the length of a vibio and the room rules separately; text over the limit is refused, never silently cut.", control: UI.raw(`<textarea class="textarea" id="pp-role" rows="5" placeholder="who it is, how it speaks, what it cares about">${esc(p.role || "")}</textarea>`) }),
      ].join("")),
      agent: [
        settingsCard("pp-engine", "", settingRow({ label: "Coding agent", id: "pp-recipe-row", hint: `${rec ? rec.vendor : p.agentVendor || "Its coding agent"} runs ${p.name}.`, geek: "A session cannot cross vendors, so the vibemate first writes its notes, then comes back on the new agent with those notes and the last messages of the room (like Fresh start with the last messages). Its name, vibio, colour and skills stay; model, effort and mode start from the new agent's defaults.", control: UI.raw(pickNowHtml(rec ? vendorLogo(rec) : UI.html("logo-tile", { letter: (p.agentVendor || p.agentType || "?")[0], title: p.agentVendor || p.agentType || "" }), `Run ${p.name} on another coding agent`)), fold: UI.raw(`<div class="agent-grid" id="pp-recipe">${tiles}</div><p class="hint">Another vendor: a new session with its notes and the last messages.</p>`) })),
        '<div id="pp-config"></div>',
        settingsCard("pp-notes-card", "Notes", [
          settingRow({ label: "Its notes", for: "pp-notes", stacked: true, hint: p.notes ? `Written ${p.notesWrittenAt ? relTime(p.notesWrittenAt) : "earlier"}, at ${fmtTokens(p.notesAt || 0)} tokens of context. Edit them here; an empty field clears them.` : "None yet. Write some here, or ask for them below.", geek: "About ten lines on its work, for a future restart: a fresh start with the last messages carries them, and so does a move to another coding agent. It writes them by itself when its context fills past 80% or is compacted (the room's Ask vibemates for notes automatically).", control: UI.raw(`<textarea class="textarea" id="pp-notes" rows="6" maxlength="4000" placeholder="what it is working on, what is decided, what is next">${esc(p.notes || "")}</textarea>`) }),
          settingRow({ label: "Take notes now", hint: p.notesTurn ? "Writing them now, in a hidden turn." : "A hidden turn: it writes them now. Nothing is posted in the room.", control: UI.raw(UI.html("button", { label: p.notes ? "Write them again" : "Take notes now", size: "sm", id: "pp-take-notes", disabled: !!p.notesTurn || p.status === "offline" || p.status === "unstaffed" })) }),
        ].join("")),
        settingsCard("pp-fresh-start", "Fresh start", [
          settingRow({ label: "Forget this conversation", hint: `${p.name} comes back with an empty head. The room's history stays and you still see everything.`, geek: "A session's context cannot be erased, so the vibemate's process and session are closed and it starts a new one with no replay. Its stored session is dropped too, or a later reconnect would bring the old context back. Same thing as typing /fresh-start @Name in the composer (/respawn still works).", control: UI.raw(UI.html("button", { label: "Fresh start", icon: "bolt", kind: "danger", size: "sm", act: "respawn" })) }),
          settingRow({ label: "Keep the last messages", for: "pp-respawn-n", hint: `A new session that gets only ${p.notes ? "its own notes and " : ""}the last N messages of this room; the rest is gone.`, control: UI.raw(`${UI.html("number-field", { id: "pp-respawn-n", value: String(room.settings.replayAfterRestart ?? 10), min: 0, max: 500 })}${UI.html("button", { label: "Fresh start with them", size: "sm", act: "respawn-mem" })}`) }),
        ].join(""), "danger"),
      ].join(""),
      skills: settingsCard("pp-skills-section", "", settingRow({ label: "Skills it can load", stacked: true, hint: "What this vibemate can load on request.", geek: `Listed in this vibemate's brief by name and description; the text arrives when you write /name or when the vibemate loads it. ${skillChannelText(p)}`, control: UI.raw('<div class="check-list" id="pp-skills"></div>') })),
      timing: settingsCard("pp-timing", "", settingRow({ label: "Reply delay override, seconds", for: "pp-delay", hint: `Overrides the room's delay (${roomDelay} s, used only when two or more vibemates are in) for this vibemate only, even when it is alone. Empty: it follows the room.`, geek: "Before each turn the vibemate waits a random 0–N seconds, so replies cross less often. Messages that arrive during the wait land in its backlog, so it can react to them or stay silent.", control: numberHtml({ id: "pp-delay", value: String(p.replyDelay ?? ""), min: 0, max: 120, step: 0.5, placeholder: `the room's: ${roomDelay} s` }) })),
      stats: settingsCard("pp-stats", "", [
        stat("Session", `${p.sessionOrigin === "loaded" ? "restored (session/load)" : p.sessionOrigin === "replayed" ? "new, history replayed" : p.status === "offline" ? "offline" : "new"}${p.supportsLoad === false ? " · no session/load" : ""}`),
        stat("Turns", String(p.turns ?? 0)),
        stat("Briefs sent", String(p.briefsSent ?? 0)),
        stat("Referee reminders", String(p.violations ?? 0)),
        stat("Hidden retries", String(p.retries ?? 0)),
        stat("Failed turns", String(p.failedTurns ?? 0)),
        settingRow({ label: "Context", hint: contextWords(p), control: UI.raw(`<span class="life-bar life-${lifeOf(p).tone}"><i style="width:${lifeOf(p).left ?? 0}%"></i></span>`) }),
        ...(p.contextEvent ? [stat("Last change of its context", contextEventText(p, p.contextEvent))] : []),
        stat("Last reply", lastReplyWords(room, p)),
        stat("Cost (estimate)", fmtCost(p.cost) || "—"),
        stat("Adapter", `${rec ? rec.label : p.agentLabel || ""}${p.agentInfo && p.agentInfo.version ? ` ${p.agentInfo.version}` : ""}`),
        ...(p.authStatus ? [settingRow({ label: "Account", hint: [p.authStatus.detail, p.authStatus.account?.organization].filter(Boolean).join(" · ") || "Reported by the agent itself.", control: `${p.authStatus.label}${p.authStatus.account && p.authStatus.account.email ? ` · ${p.authStatus.account.email}` : ""}` })] : []),
      ].join("")),
    };
    els.detailsInner.dataset.panel = "vibemate";
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
      ${p.quiet ? wedgeCardHtml(p, Date.now()) : ""}
      ${p.trouble && p.status !== "thinking" && p.status !== "queued" ? `<div class="trouble"><b>${esc(p.trouble.what)}</b><span>${esc(p.trouble.advice)}</span>${troubleActionsHtml(p)}</div>` : ""}
      ${p.statusDetail && (p.status === "offline" || p.status === "error" || p.failedTurns) ? `<p class="hint" style="color:var(${mutedStartup ? "--warm-ink" : "--danger"});margin:0 4px 10px">${esc(p.statusDetail)}</p>` : ""}
      ${!mutedStartup && vendorLoggedOut(p) && p.trouble?.kind !== "login" ? `<div class="pp-login"><div class="row-btns">${UI.html("button", { label: `Log in to ${p.agentVendor || "the vendor"}`, icon: "lock", kind: "primary", size: "sm", act: "open-login-dialog", data: { recipe: p.agentType, purpose: "login" } })}</div><p class="hint">${esc(p.agentVendor || "The vendor")} is not logged in on this machine; log in, and ${esc(p.name)} comes back by itself.</p></div>` : ""}
      ${panelSearchHtml("vibemate", `Search ${p.name}'s settings`)}
      ${panelSectionsHtml("vibemate", sections, "pp-form")}`;
    wireDetailsClose();
    els.detailsInner.querySelectorAll('.trouble [data-act^="trouble-"]').forEach((btn) => btn.addEventListener("click", () => troubleAction(room, p, btn.dataset.act.slice("trouble-".length), btn).catch(showError)));
    const respawnBtn = els.detailsInner.querySelector('button[data-act="respawn"]');
    if (respawnBtn) respawnBtn.addEventListener("click", () => respawnWith(p, 0));
    const respawnMem = els.detailsInner.querySelector('button[data-act="respawn-mem"]');
    if (respawnMem) respawnMem.addEventListener("click", () => respawnWith(p, Number($("#pp-respawn-n").value) || 0));
    $("#pp-take-notes").addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try { await post(roomApi(`/participants/${encodeURIComponent(p.id)}/take-notes`)); } catch (error) { showError(error); e.currentTarget.disabled = false; }
    });
    bindSave($("#pp-notes-card"), () => post(roomApi(`/participants/${encodeURIComponent(p.id)}/notes`), { notes: $("#pp-notes").value }));
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
        closeSettingFold($("#pp-avatar-row"));
      }, $("#pp-avatar")),
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
    wirePanel();
    $("#pp-recipe").querySelectorAll(".agent-tile").forEach((tile) =>
      tile.addEventListener("click", async () => {
        const rec2 = state.recipes.find((r) => r.id === tile.dataset.agent);
        if (!rec2 || rec2.id === p.agentType) return;
        const extraHtml = `<label class="lp-with">With ${p.notes ? "its own notes and " : ""}the last ${UI.html("number-field", { id: "cf-replay", value: String(room.settings?.replayAfterRestart ?? 10), min: 0, max: 500 })} messages</label>`;
        let n = 0;
        const ok = await choiceDialog(`${p.name} moves to ${rec2.vendor}: a new session that gets only what you pick below. You keep the history; the rest of its memory is gone.`, { title: `Run ${p.name} on ${rec2.vendor}?`, okLabel: `Move to ${rec2.vendor}`, danger: true, extraHtml, beforeClose: () => { n = Number($("#cf-replay").value) || 0; } });
        if (ok !== "ok") return;
        tile.disabled = true;
        try {
          await post(roomApi(`/participants/${encodeURIComponent(p.id)}/restaff`), { agentType: rec2.id, replay: n });
        } catch (e) {
          showError(e);
        } finally {
          tile.disabled = false;
        }
      }),
    );
  }

  function flattenOptions(options) {
    const out = [];
    for (const entry of options || []) {
      if (entry && Array.isArray(entry.options)) out.push(...entry.options);
      else out.push(entry);
    }
    return out;
  }

  const configChanging = new Map();
  function acceptConfigReply(roomId, reply) {
    const room = state.rooms.get(roomId), p = reply?.participant;
    if (!room || !p) return null;
    const order = room.participantOrder ||= new Map();
    if (reply.history?.epoch === room.history?.epoch && Number.isFinite(reply.history?.streamSequence)
      && reply.history.streamSequence >= (order.get(p.id) ?? -1)) {
      const at = room.participants.findIndex(who => who.id === p.id);
      if (at >= 0) {
        const showing = state.currentRoomId === roomId && state.view === "room";
        const before = showing ? visibilityFingerprint(room) : "";
        room.participants[at] = p; order.set(p.id, reply.history.streamSequence);
        if (showing) {
          if (visibilityFingerprint(room) !== before) renderMessagesSoon("reported settings changed the participant");
          renderSideRoom(); renderChatHead();
        }
      }
    }
    return findById(room, p.id);
  }
  const installationChecked = new Map();
  function checkInstallation(agentType) {
    if (!agentType) return;
    const last = installationChecked.get(agentType) || 0;
    if (Date.now() - last < 5000) return;
    installationChecked.set(agentType, Date.now());
    post(`/api/recipes/${encodeURIComponent(agentType)}/installation-check`, {}).catch(() => { });
  }
  function renderConfig(panel, p, offline) {
    panel.dataset.configRoom = state.currentRoomId || "";
    panel.dataset.configParticipant = p.id;
    const card = (body) => settingsCard("pp-options", "Session", body);
    if (offline) {
      panel.innerHTML = card(settingRow({ label: "Offline", hint: `Reconnect to start a new session (${[p.launch && p.launch.model, p.launch && p.launch.effort, p.launch && p.launch.mode].filter(Boolean).join(" · ") || "vibemate defaults"}).` }));
      return;
    }
    if (p.status === "starting") {
      panel.innerHTML = card(settingRow({ label: "Starting", hint: "Settings will be available when this vibemate is ready." }));
      return;
    }
    checkInstallation(p.agentType);
    const roomId = state.currentRoomId;
    const key = `${roomId}:${p.id}`;
    const change = async (control, onChange, value, id) => {
      if (configChanging.has(key)) return;
      const token = Symbol("settings change");
      configChanging.set(key, token);
      const focused = document.activeElement === control;
      for (const node of panel.querySelectorAll("select,input")) node.disabled = true;
      try {
        const reply = await onChange(value);
        const actual = acceptConfigReply(roomId, reply);
        if (id && state.currentRoomId === roomId && !actual?.pendingSettings?.length) { recentlySaved.set(id, Date.now()); markSaved(id); }
      } catch (error) { showError(error); }
      finally {
        if (configChanging.get(key) === token) configChanging.delete(key);
        const now = state.rooms.get(roomId)?.participants.find(who => who.id === p.id) || p;
        const shown = panel.isConnected ? panel : panel.id ? document.getElementById(panel.id) : null;
        if (shown?.dataset.configParticipant === p.id && shown.dataset.configRoom === roomId && state.currentRoomId === roomId) {
          renderConfig(shown, now, ["offline", "left"].includes(now.status));
          if (focused && id) document.getElementById(id)?.focus({ preventScroll: true });
        }
      }
    };
    const rows = [];
    const binds = [];
    const busy = configChanging.has(key);
    const cardGeek = () => (rows.length ? undefined : "These options come from the coding agent itself: the hub lists the ones it offers and sets your pick on its running session, so a change takes effect from the next turn, without restarting it or losing what it remembers.");
    const addSelect = (name, values, current, onChange, id, hint) => {
      const choices = current != null && !values.some(v => v.value === current)
        ? [{ value: String(current), name: `${current} (reported)` }, ...values] : values;
      rows.push(settingRow({ label: name, for: id, hint, geek: cardGeek(), control: UI.raw(`<select class="select" id="${esc(id)}"${busy ? " disabled" : ""}>${choices.map((v) => `<option value="${esc(v.value)}"${v.description ? ` title="${esc(v.description)}"` : ""}${v.value === current ? " selected" : ""}>${esc(v.name || v.value)}</option>`).join("")}</select>`) }));
      binds.push(() => {
        const select = panel.querySelector(`#${CSS.escape(id)}`);
        select.addEventListener("change", () => void change(select, onChange, select.value, id));
      });
    };
    const hasModeOption = (p.configOptions || []).some((o) => o.category === "mode");
    if (!hasModeOption && p.modes && p.modes.length) {
      addSelect("Mode", p.modes.map((m) => ({ value: m.id, name: m.name || m.id, description: m.description })), p.mode, (value) => post(roomApi(`/participants/${encodeURIComponent(p.id)}/config`), { configId: "mode", value }), `cfg-${p.id}-mode`);
    }
    for (const option of p.configOptions || []) {
      const id = `cfg-${p.id}-${String(option.id).replace(/[^\w-]/g, "_")}`;
      const apply = value => post(`/api/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(p.id)}/config`, { configId: option.id, value });
      if (option.type === "boolean") {
        rows.push(settingRow({ label: option.name, for: id, kind: "switch", checked: option.currentValue === true, disabled: busy, hint: option.description || undefined, geek: cardGeek() }));
        binds.push(() => {
          const input = panel.querySelector(`#${CSS.escape(id)}`);
          input.addEventListener("change", () => void change(input, apply, input.checked, id));
        });
      } else if (option.type === "select") addSelect(option.name, flattenOptions(option.options), option.currentValue, apply, id, option.description || undefined);
    }
    if (!rows.length) rows.push(settingRow({ label: "No options", hint: "This vibemate exposes no session options." }));
    const outdated = p.installOutdated
      ? settingRow({ label: `A newer ${p.agentVendor || "agent"} is installed`, hint: `${p.name} still runs the old one, so new models are not in this list yet. It keeps its conversation; only when it is not writing.`, control: UI.raw(UI.html("button", { label: "Restart on the new version", kind: "secondary", size: "sm", id: "pp-restart-installed", disabled: p.status === "thinking" })) })
      : "";
    const pending = p.pendingSettings?.length ? `<p class="hint config-pending" role="status">${esc("Pending: " + p.pendingSettings.map(setting => `${setting.name} → ${setting.value}`).join("; "))}</p>` : "";
    panel.innerHTML = card(`${outdated}${rows.join("")}${pending}`);
    binds.forEach((bind) => bind());
    const restart = panel.querySelector("#pp-restart-installed");
    if (restart) {
      restart.addEventListener("click", async () => {
        restart.disabled = true;
        try { await post(roomApi(`/participants/${encodeURIComponent(p.id)}/restart-installed`), {}); }
        catch (error) { showError(error); restart.disabled = false; }
      });
    }
  }

  function renderMePage() {
    const s = state.settings || {};
    els.pageInner.innerHTML = `
      <div class="page-head"><div><h1>Your vibe</h1><div class="hint">How the vibemates know you, in every room.</div></div></div>
      <div class="me-page">
      <div class="profile">
        ${avatar(meAvatarData(), 88, { kind: "card" })}
        <div class="who">
          <h3>${esc(s.humanName || "")}</h3>
          <div class="tagline">${esc(s.humanDescription || "no vibe line yet")}</div>
        </div>
      </div>
      <div class="panel-sections">
        ${settingsCard("me-vibe", "", [
          settingRow({ label: "Vibename", for: "me-name", hint: "How you appear in every room.", control: UI.raw(`<input type="text" class="input" id="me-name" maxlength="24" value="${esc(s.humanName || "")}">`) }),
          settingRow({ label: "Vibeface", id: "me-avatar-row", hint: "Your face in every room.", control: UI.raw(pickNowHtml(avatar(meAvatarData(), 36, { kind: "card" }), "Pick another face")), fold: UI.raw(`<div id="me-avatar-picker"></div><input type="text" class="input" id="me-avatar" maxlength="40" value="${esc(s.humanAvatar || "")}" placeholder="custom emoji (optional)">`) }),
          settingRow({ label: "Your vibe line", for: "me-desc", stacked: true, hint: "A sentence or two about you.", geek: "The vibemates get it in every room's brief, unless a room adds its own line or replaces it (the room's settings, You in this room).", control: UI.raw(`<textarea class="textarea" id="me-desc" rows="3" maxlength="200" placeholder="e.g. software engineer, enjoys learning; likes short answers">${esc(s.humanDescription || "")}</textarea>`) }),
        ].join(""))}
        ${settingsCard("me-memory", "", settingRow({ label: "Shared memory about you", hint: "Inspect, edit or remove the preferences learned across rooms.", control: actHtml({ label: "Open…", data: { memoryOpen: "user" } }) }))}
        ${settingsCard("me-danger", "Danger zone", settingRow({ label: "Erase my vibe", hint: "Erases everything in this viberoom: your vibe, all rooms and their history, vibemate sessions, your skills. Not undoable.", control: UI.raw(UI.html("button", { label: "Erase my vibe", icon: "bolt", kind: "danger", size: "sm", id: "me-erase" })) }), "danger")}
      </div>
      </div>`;
    $("#me-avatar-picker").appendChild(
      window.Avatars.pickerElement(s.humanAvatar || "", (emoji) => {
        $("#me-avatar").value = emoji;
        $("#me-avatar").dispatchEvent(new Event("change", { bubbles: true }));
        closeSettingFold($("#me-avatar-row"));
      }, $("#me-avatar")),
    );
    bindSave($("#me-vibe"), () => post("/api/settings", { humanName: $("#me-name").value, humanAvatar: $("#me-avatar").value, humanDescription: $("#me-desc").value }));
    $("#me-erase").addEventListener("click", openEraseDialog);
  }

  function renderRoomPanel(room) {
    const rs = room.settings;
    const lang = rs.language && rs.language.mode === "fixed" ? rs.language.language : "";
    const toggle = (label, id, on, hint, geekText) => settingRow({ label, for: id, kind: "switch", checked: !!on, hint, geek: geekText });
    const text = (id, value, props = "") => UI.raw(`<input type="text" class="input" id="${id}" value="${esc(value)}"${props}>`);
    const sections = {
      general: [
        settingsCard("rp-room", "", [
          settingRow({ label: "Name", for: "rp-name", control: text("rp-name", room.name, ' maxlength="60"') }),
          settingRow({ label: "Picture", id: "rp-emoji-row", hint: "A picture or an emoji for the room, next to its name.", control: UI.raw(pickNowHtml(rs.emoji && !window.Avatars.faceUrl(rs.emoji) ? esc(rs.emoji) : roomMark(room), "Pick another")), fold: UI.raw(`<div id="rp-emoji-picker"></div><input type="text" class="input" id="rp-emoji" maxlength="40" value="${esc(rs.emoji || "")}" placeholder="custom emoji (optional)">`) }),
          settingRow({ label: "Topic", for: "rp-topic", control: text("rp-topic", rs.topic || "", ' maxlength="2000" placeholder="what this room is about (optional)"') }),
          settingRow({ label: "Folder", for: "rp-dir", stacked: true, hint: "Where the vibemates read and write. Changing it restarts them in the new folder; they replay the last messages.", control: UI.raw(`<span class="dir-row"><input type="text" class="input" id="rp-dir" maxlength="1000" value="${esc(room.dir)}" spellcheck="false">${UI.html("button", { label: "Browse", icon: "folder", kind: "ghost", id: "rp-dir-browse", title: "Choose a folder", hook: "browse-btn" })}</span>`) }),
        ].join("")),
        settingsCard("rp-you", "You in this room", [
          settingRow({ label: "What vibemates get about you here", for: "rp-you-mode", stacked: true, control: UI.raw(selectHtml("rp-you-mode", [["inherit", "Your vibe line"], ["append", "Your vibe line + this room's"], ["override", "Only this room's line"], ["none", "Nothing about me in this room"]], rs.humanDescriptionMode || "inherit")) }),
          settingRow({ label: "This room's line about you", for: "rp-you-desc", stacked: true, control: UI.raw(`<textarea class="textarea" id="rp-you-desc" rows="3" maxlength="200" placeholder="e.g. host of this session, product owner">${esc(rs.humanDescription || "")}</textarea>`) }),
        ].join("")),
        settingsCard("rp-messengers", "", toggle("Reachable from messengers", "rp-reachable", rs.reachableFromMessengers !== false, "A phone paired to viberoom (Settings → Channels) can open this room, write to it and read its replies. Off: the phone neither sees nor reaches this room.")),
        settingsCard("rp-turn-this-room-into-a-template", "", settingRow({ label: "Turn this room into a template", hint: 'Its settings, rules, folder and vibemates (with the coding agent each runs on) become one of your templates, listed first under "Start from a template". You see everything it will contain, and can change any of it, before you create it.', control: UI.raw(UI.html("button", { label: "Preview and create…", icon: "rooms", kind: "secondary", size: "sm", id: "rp-template" })) })),
        settingsCard("rp-danger-zone", "Danger zone", settingRow({ label: "Close this room for good", hint: "Closes every vibemate in this room and removes it from the list. Its history and files move to the trash folder of your viberoom data; a new room with the same name starts empty.", control: UI.raw(UI.html("button", { label: "Close the room", icon: "trash", kind: "danger", size: "sm", id: "rp-delete" })) }), "danger"),
      ].join(""),
      rules: settingsCard("rp-rules-section", "", [
        settingRow({ label: "Room rules", stacked: true, hint: UI.raw('How the team works together. Vibemates can propose changes for your approval. One rule per line; type @ to reference a participant.<span class="count" id="rp-rules-count"></span>'), geek: "References follow renames and note when a participant has left. Updated rules reach each vibemate on its next turn. Mentions here describe responsibilities; they do not send messages.", control: UI.raw('<div class="mention-host"><div id="rp-rules" class="rules-editor" contenteditable="true" spellcheck="true" data-placeholder="e.g. Everyone listens to @Pesho, he is the manager. Keep answers under 3 sentences."></div><div class="mention-menu inline" id="rp-rules-menu" hidden></div></div>') }),
        settingRow({ label: "Language", for: "rp-lang", control: text("rp-lang", lang, ' placeholder="follow the human (default), or e.g. English"') }),
        settingRow({ label: "Max sentences per reply", for: "rp-maxlen", control: numberHtml({ id: "rp-maxlen", value: String(rs.maxSentences ?? ""), min: 1, max: 100, placeholder: "no limit" }) }),
        settingRow({ label: "Vibemates' own tools (files, shell, web)", for: "rp-tools", geek: "An instruction in every vibemate's brief; the vibemate's mode is the real limit.", control: UI.raw(selectHtml("rp-tools", [["on-request", "Only when someone explicitly asks"], ["never", "Never (chat only)"]], rs.tools === "never" ? "never" : "on-request")) }),
      ].join("")),
      conversation: [
        settingsCard("rp-turn-taking", "", [
          settingRow({ label: "Who may speak", for: "rp-turns", geek: "One at a time: the others queue and see the earlier replies before they answer; the addressed vibemates go first. All at once: fastest, but replies may cross.", control: UI.raw(selectHtml("rp-turns", [["one-at-a-time", "One vibemate at a time"], ["parallel", "All addressed vibemates at once"]], rs.turnTaking === "parallel" ? "parallel" : "one-at-a-time")) }),
          settingRow({ label: "Reply delay, seconds", for: "rp-delay", hint: "With two or more vibemates, each waits a random 0–N seconds before it answers, so replies cross less often. A vibemate alone answers at once. A vibemate's own delay (in its panel) always applies.", control: numberHtml({ id: "rp-delay", value: String(rs.replyDelay ?? 4), min: 0, max: 120, step: 0.5 }) }),
          toggle("Vibemates wake each other", "rp-wake", rs.agentsWakeEachOther !== false, "A reply without @ wakes every other vibemate, as yours does; each may answer or stay silent. Off: only @Name wakes a vibemate. The hop limit applies either way."),
          toggle("Wait while you are typing", "rp-wait-typing", rs.waitWhileHumanTypes !== false, "A vibemate about to start holds back while you type (a few seconds after your last keystroke). A reply already under way is not interrupted."),
          settingRow({ label: "Hop limit", for: "rp-hops", hint: "How many vibemate-to-vibemate replies may follow one message of yours before the room waits for you again.", control: numberHtml({ id: "rp-hops", value: String(rs.hopLimit), min: 0, max: 10000 }) }),
          toggle("Tell vibemates what they missed while working", "rp-missed-notice", rs.missedMessagesNotice, "When a vibemate finishes and messages arrived meanwhile that did not wake it, it is told how many and may read them or stay silent. They still arrive with its next turn. Each notice counts as one vibemate-to-vibemate reply."),
        ].join("")),
        settingsCard("rp-conversation", "Memory", [
          toggle("This room remembers", "rp-remembers", rs.remembers === true, "The room feeds the long-term memory provider (Settings → Long-term memory): its messages, sifted by the sieve set there, become facts vibemates can recall later. Does nothing until a provider is on and consented there."),
          toggle("Share this room's history with the other rooms", "rp-share-history", rs.sharesHistory !== false, SHARES_HISTORY_HINT),
          settingRow({ label: "Search the other rooms", for: "rp-reads-others", hint: READS_OTHER_ROOMS_HINT, geek: READS_OTHER_ROOMS_GEEK, control: UI.raw(selectHtml("rp-reads-others", READS_OTHER_ROOMS, rs.readsOtherRooms || "on-search")) }),
        ].join("")),
      ].join(""),
      start: settingsCard("rp-startup", "", [
        toggle("Start this room with viberoom", "rp-start-with-hub", rs.startWithHub, "Its vibemates are started when viberoom starts, one room after another. They pay nothing until the first turn; their processes and memory stay while they wait. With viberoom starting at sign-in, the phone reaches this room without a click."),
        settingRow({ label: "…and they come back", for: "rp-reconnect", hint: "Only for the start above: when this room brings its own vibemates back, it decides with how much memory.", geek: "A room that decides whether it starts also decides with how much memory its vibemates come back; the app-wide Welcome back setting is what a room follows when it has not chosen. It is not asked again in a dialog, because by the time a window could ask, the room has already begun.", control: UI.raw(selectHtml("rp-reconnect", [["inherit", "As Welcome back is set"], ["load", "Continuing their saved sessions"], ["replay", "Fresh, with the last messages replayed"]], rs.reconnectMode || "inherit")) }),
        toggle("Wake vibemates after a restart", "rp-wake-restart", rs.wakeAfterRestart, "Off by default. After Restart finishes restoring this room, send the message below once. Requires Start this room with viberoom. Muted, stopped or unavailable vibemates stay quiet. Ordinary launches and sign-in do not send it."),
        settingRow({ label: "Message after restart", for: "rp-restart-message", stacked: true, hint: "Your saved instruction appears as an automatic room event. Empty text starts no replies.", control: UI.raw(`<textarea class="textarea" id="rp-restart-message" rows="3" maxlength="8000" placeholder="Continue your tasks, if you have any.">${esc(rs.restartMessage || "")}</textarea>`) }),
        settingRow({ label: "Replay last N chat messages after a reconnect", for: "rp-replay", control: numberHtml({ id: "rp-replay", value: String(rs.replayAfterRestart), min: 0, max: 200 }) }),
      ].join("")),
      briefs: [
        settingsCard("rp-instruction-delivery", "Briefs", [
          settingRow({ label: "Full brief every N vibemate turns", for: "rp-brief-turns", hint: "How often a vibemate gets the whole room brief again instead of the short header.", control: numberHtml({ id: "rp-brief-turns", value: String(rs.fullBriefEveryTurns), min: 1, max: 10000 }) }),
          settingRow({ label: "…or every N new context tokens", for: "rp-brief-tokens", hint: "…or after this much new context since its last full brief, whichever comes first.", control: numberHtml({ id: "rp-brief-tokens", value: String(rs.fullBriefEveryTokens), min: 1000, max: 10000000, step: 1000 }) }),
          toggle("Repeat core rules in every header", "rp-header-rules", rs.headerRules, "The short header before each turn repeats the room's core rules (who is here, how to address, how long to write)."),
          toggle("Show vendor and model to other vibemates", "rp-vendor", rs.showVendorInRoster),
          toggle("Ask vibemates for notes automatically", "rp-auto-notes", rs.autoNotes !== false, "When a vibemate's context fills past 80% or is compacted, it writes short notes on its work, so a restart can carry them. Off: notes are written only when you ask (Take notes now in its panel, a change of role or of coding agent)."),
          settingRow({ label: "Missed messages a vibemate reads at most on its next turn", for: "rp-backlog", hint: "Everything posted since its last turn counts, including while it was muted; older messages are dropped with a note in its prompt.", control: numberHtml({ id: "rp-backlog", value: String(rs.backlogCap), min: 1, max: 1000 }) }),
          settingRow({ label: "Most characters in a vibio or in the room rules", for: "rp-text-limit", hint: "The limit applies separately to each text. Text over it is refused with the numbers, never cut.", control: numberHtml({ id: "rp-text-limit", value: String(rs.briefTextLimit ?? 8000), min: 500, max: 32000, step: 500 }) }),
        ].join("")),
        settingsCard("rp-referee-section", "Referee", settingRow({ label: "When a reply breaks a mechanical rule (unknown @, self-@, length)", for: "rp-referee", stacked: true, control: UI.raw(selectHtml("rp-referee", [["next-header", "Post it; remind the agent in its next header"], ["retry-hidden", "Hold it; ask for a corrected version in a hidden turn"]], rs.refereeAction === "retry-hidden" ? "retry-hidden" : "next-header")) })),
        settingsCard("rp-shared-memory", "", settingRow({ label: "Shared memory for this room", hint: "What its vibemates have learned here, with its history: inspect, edit or remove it.", control: actHtml({ label: "Open…", data: { memoryOpen: "room" } }) })),
        settingsCard("rp-troubleshooting", "Troubleshooting", settingRow({ label: "Save diagnostic details", for: "rp-transcripts", stacked: true, hint: DIAGNOSTIC_LOG_HELP, control: UI.raw(selectHtml("rp-transcripts", [["inherit", followsAppWords(TRANSCRIPT_LABEL[(state.settings || {}).transcripts || "off"])], ["off", "Off"], ["errors", "When something fails"], ["full", "All activity"]], rs.transcripts || "inherit")) })),
      ].join(""),
    };
    els.detailsInner.dataset.panel = "room";
    els.detailsInner.innerHTML = `
      ${panelTitle("Room settings", esc(room.name))}
      <div class="profile">${roomProfileHeader(room)}</div>
      ${panelSearchHtml("room", "Search this room's settings")}
      ${panelSectionsHtml("room", sections, "rp-form")}
      <p class="hint panel-foot">The vibemates get the changes on their next turn.</p>`;
    wireDetailsClose();
    rulesToNodes($("#rp-rules"), room.customRulesText != null ? room.customRulesText : rs.customRules || "", room);
    attachRichMentions($("#rp-rules"), $("#rp-rules-menu"));
    bindCount($("#rp-rules"), $("#rp-rules-count"), () => Number($("#rp-text-limit").value) || briefTextLimit(room));
    $("#rp-text-limit").addEventListener("input", () => $("#rp-rules").dispatchEvent(new Event("input")));
    $("#rp-emoji-picker").appendChild(
      window.Avatars.facePicker({ kind: "room", current: rs.emoji || "", emoji: ROOM_EMOJI, none: { label: "—", title: "None: the room's letter" }, field: $("#rp-emoji"), onPick: (face) => {
        $("#rp-emoji").value = face;
        $("#rp-emoji").dispatchEvent(new Event("change", { bubbles: true }));
        closeSettingFold($("#rp-emoji-row"));
      } }),
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
          humanDescriptionMode: $("#rp-you-mode").value,
          humanDescription: $("#rp-you-desc").value,
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
          autoNotes: $("#rp-auto-notes").checked,
          missedMessagesNotice: $("#rp-missed-notice").checked,
          backlogCap: Number($("#rp-backlog").value),
          refereeAction: $("#rp-referee").value,
          turnTaking: $("#rp-turns").value,
          waitWhileHumanTypes: $("#rp-wait-typing").checked,
          agentsWakeEachOther: $("#rp-wake").checked,
          sharesHistory: $("#rp-share-history").checked,
          readsOtherRooms: $("#rp-reads-others").value,
          remembers: $("#rp-remembers").checked,
          reachableFromMessengers: $("#rp-reachable").checked,
          startWithHub: $("#rp-start-with-hub").checked,
          wakeAfterRestart: $("#rp-wake-restart").checked,
          restartMessage: $("#rp-restart-message").value,
          reconnectMode: $("#rp-reconnect").value,
          replyDelay: Number($("#rp-delay").value),
          transcripts: $("#rp-transcripts").value,
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
    wirePanel();
  }


  function dataFolderRow() {
    const f = state.dataFolder;
    if (!f || !f.known || !f.others || !f.others.length) return "";
    return UI.html("settings-group", {
      id: "sp-folder",
      title: "This folder is not private",
      tone: "danger",
      body: UI.raw(UI.html("setting", {
        label: "Other accounts can open it",
        hint: UI.raw(`Another account on this computer — ${esc(f.others.join(", "))} — can open <code>${esc(f.path)}</code>. Everything viberoom keeps is in there: every room's whole record, and the keys of any messenger you have paired. Other folders in your profile keep the permissions they have: this closes viberoom's own folder and nothing else.`),
        geek: "Closing it removes the inherited permissions and grants this account alone, beside the system and administrators, who can read anything on the machine in any case. Nothing else in your profile is touched, and it is undone with one command.",
        statusId: "sp-folder-result",
        control: UI.raw(UI.html("button", { label: "Make it private", icon: "lock", kind: "primary", size: "sm", id: "sp-folder-narrow" })),
      })),
    });
  }

  function autostartStatusText() {
    const a = state.autostart;
    if (!a) return "Not known yet.";
    const when = (ts) => (ts ? new Date(ts).toLocaleString() : "never");
    const parts = [];
    if (a.enabled) parts.push(`Set up on ${when(a.installedAt)}.`);
    if (a.foreign) parts.push("Another viberoom, with another data folder, starts at sign-in; switching this on takes its place.");
    parts.push(`Last automatic start: ${when(a.lastAutoStartAt)}.`);
    if (a.targetMissing) parts.push(`The sign-in entry points at a missing file (${a.target || a.script}): switch it off, or start viberoom again from where it is now.`);
    else if (a.stale) parts.push("The entry points at an older copy of viberoom; the next start fixes it.");
    if (a.note) parts.push(a.note);
    return esc(parts.join(" "));
  }

  const SETTINGS_CATEGORIES = [
    { id: "appearance", label: "Appearance", glyph: "palette", tone: "peach", about: "How the room is drawn: its look, how large everything is, the size and font of its text, the colours of its diagrams.", groups: ["sp-appearance", "sp-look-adjust", "sp-scale", "sp-text", "sp-diagrams"] },
    { id: "messages", label: "Messages", glyph: "chat", tone: "sky", about: "How the messages of a room open and scroll while you read them.", groups: ["sp-messages", "sp-scroll"] },
    { id: "notifications", label: "Notifications", glyph: "bell", tone: "amber", about: "How viberoom tells you a vibemate replied while you were away: a count on its icon, and a notification of the system.", groups: ["sp-notices"] },
    { id: "vibemates", label: "Vibemates", glyph: "bot", tone: "violet", about: "What vibemates may do without asking, how quickly they answer, and which ones this computer has.", groups: ["sp-permissions", "sp-pace", "sp-vibemates-on-this-machine"] },
    { id: "channels", label: "Channels", glyph: "phone", tone: "sky", about: "Reach your rooms from a messenger app, on your phone or on your computer.", groups: ["sp-channels"] },
    { id: "voice", label: "Voice", glyph: "mic", tone: "sky", about: "Say a message instead of typing it, and hear the replies: who turns your voice into words, and who reads the replies aloud.", groups: ["sp-voice", "sp-voice-reading"] },
    { id: "memory", label: "Long-term memory", glyph: "graph", tone: "orchid", about: "Rooms that opt in feed a long-term memory: what was said becomes knowledge they can recall.", groups: ["sp-memory"] },
    { id: "carry", label: "Export / Import", glyph: "transfer", tone: "amber", about: "Rooms saved for another computer, copies brought in, and the versions you removed.", groups: ["sp-carrying"] },
    { id: "editor", label: "Editor", glyph: "code", tone: "mint", about: "What opens a file when you click a path like main.ts:375 in a message.", groups: ["sp-editor"] },
    { id: "system", label: "System", glyph: "power", tone: "slate", about: "Updates, starting with the computer, and a clean restart.", groups: ["sp-update", "sp-autostart", "sp-folder", "sp-restart"] },
    { id: "room-defaults", label: "Defaults for new rooms", glyph: "sliders", geek: true, about: "Where every new room starts; each room can change them in its own settings.", groups: ["sp-defaults-for-new-rooms"] },
    { id: "shared-memory", label: "Shared memory", glyph: "journal", geek: true, about: "What the rooms have learned about you: preferences, protected notes and their history.", groups: ["sp-shared-memory"] },
    { id: "skills", label: "Skills from vibemates", glyph: "skills", geek: true, about: "Whether a skill a vibemate writes is used at once or waits for you.", groups: ["sp-skills-from-vibemates"] },
    { id: "presets", label: "Presets per vibemate", glyph: "dial", geek: true, about: "The model, effort and mode a vibemate starts with when you summon one.", groups: ["sp-presets-per-vibemate"] },
    { id: "troubleshooting", label: "Troubleshooting", glyph: "pulse", geek: true, about: "Details to save when a vibemate fails or gets stuck, and the room they take on disk.", groups: ["sp-transcripts"] },
    { id: "development", label: "Development", glyph: "tool", geek: true, dev: true, about: "For the people who build viberoom: how this window draws and scrolls, and what the vibemates are sent.", groups: ["sp-slow", "sp-wheel", "sp-dev-prompts"] },
  ];
  const SETTINGS_PAGE_SHOWN = "settings-page-shown";
  function settingsCategories() {
    const f = state.dataFolder;
    const folderOpen = !!(f && f.known && f.others && f.others.length);
    const voice = state.voice, memory = state.memoryProvider?.view;
    const attention = {
      system: folderOpen ? "This folder is not private" : null,
      voice: almostOn(voice) ? `The voice is not on yet: ${voice.reason}` : almostOn(voice?.reading) ? `Reading aloud is not on yet: ${voice.reading.reason}` : null,
      memory: almostOn(memory) ? `The long-term memory is not on yet: ${memory.reason}` : null,
    };
    return SETTINGS_CATEGORIES.filter((c) => !c.dev || devBuild()).map((c) => (attention[c.id] ? { ...c, attention: attention[c.id] } : c));
  }
  function markSettingsRail() {
    const button = els.rail.querySelector('.rail-item[data-nav="settings"]');
    if (!button) return;
    const waiting = settingsCategories().filter((c) => c.attention).map((c) => c.attention);
    if (waiting.length) button.dataset.attention = "";
    else delete button.dataset.attention;
    button.dataset.hint = waiting.length ? `Settings: ${waiting[0]}${waiting.length > 1 ? ` (and ${waiting.length - 1} more)` : ""}` : "Settings";
  }
  function almostOn(view) {
    return !!view && !view.ready && !!view.missing && view.missing !== "provider" && view.missing !== "reader";
  }
  function settingsCategoryShown(categories) {
    const saved = recall("settings.category");
    return categories.some((c) => c.id === saved) ? saved : categories[0].id;
  }
  function openSettings(category) {
    if (category) remember("settings.category", category);
    setView("settings");
    remember("view", "settings");
  }
  function showSettingsCategory(id, { focus = false, arrive = true } = {}) {
    const nav = els.pageInner.querySelector('[data-ui="settings-nav"]');
    const page = document.getElementById(`sp-cat-${id}`);
    if (!nav || !page) return false;
    remember("settings.category", id);
    for (const b of nav.querySelectorAll("button[data-category]")) {
      const on = b.dataset.category === id;
      UI.setState(b, on ? "on" : null);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    const shown = !page.hidden;
    for (const p of els.pageInner.querySelectorAll('[data-ui="settings-category"]')) p.hidden = p !== page;
    placeSettingsBar(nav);
    if (shown) return true;
    els.pageInner.querySelector(".settings-pages").scrollTop = 0;
    page.dispatchEvent(new CustomEvent(SETTINGS_PAGE_SHOWN));
    if (!arrive) return true;
    page.dataset.arrive = "";
    const glyph = page.querySelector(":scope > .head .rig");
    if (glyph && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) window.Icons.play(glyph);
    Promise.allSettled(page.getAnimations({ subtree: true }).map((a) => a.finished)).then(() => delete page.dataset.arrive);
    return true;
  }
  function placeSettingsBar(nav) {
    const bar = nav && nav.querySelector(":scope > .bar");
    const on = nav && nav.querySelector('button[data-state="on"]');
    if (!bar || !on) return;
    bar.style.transform = nav.dataset.layout === "row"
      ? `translateX(${on.offsetLeft + (on.offsetWidth - bar.offsetWidth) / 2}px)`
      : `translateY(${on.offsetTop + (on.offsetHeight - bar.offsetHeight) / 2}px)`;
    if (!nav.dataset.bar) requestAnimationFrame(() => (nav.dataset.bar = "live"));
  }
  function showCategoryOf(entry, id, opts) {
    return entry.closest("#details-inner") ? showPanelSection(id, opts) : showSettingsCategory(id, opts);
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest('[data-ui="settings-nav"] button[data-category]');
    if (b) showCategoryOf(b, b.dataset.category);
  });
  document.addEventListener("keydown", (e) => {
    const b = e.target.closest && e.target.closest('[data-ui="settings-nav"] button[data-category]');
    if (!b || e.altKey || e.ctrlKey || e.metaKey) return;
    const nav = b.closest('[data-ui="settings-nav"]');
    const all = [...nav.querySelectorAll("button[data-category]")];
    const at = all.indexOf(b);
    const [next, back] = nav.dataset.layout === "row" ? ["ArrowRight", "ArrowLeft"] : ["ArrowDown", "ArrowUp"];
    const to = { [next]: at + 1, [back]: at - 1, Home: 0, End: all.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    showCategoryOf(b, all[(to + all.length) % all.length].dataset.category, { focus: true });
  });

  const ROOM_VALUE_ROWS = {
    "sp-turns": { key: "turnTaking", kind: "select", options: [["one-at-a-time", "One at a time"], ["parallel", "All at once"]] },
    "sp-delay": { key: "replyDelay", kind: "number", min: 0, max: 120, step: 0.5, unit: "s" },
    "sp-hops": { key: "hopLimit", kind: "number", min: 0, max: 10000 },
    "sp-brief-turns": { key: "fullBriefEveryTurns", kind: "number", min: 1, max: 10000 },
    "sp-brief-tokens": { key: "fullBriefEveryTokens", kind: "number", min: 1000, max: 10000000, step: 1000 },
    "sp-text-limit": { key: "briefTextLimit", kind: "number", min: 500, max: 32000, step: 500 },
    "sp-header-rules": { key: "headerRules", kind: "switch" },
    "sp-tools": { key: "tools", kind: "select", options: [["on-request", "Only when asked"], ["never", "Never"]] },
    "sp-transcripts-mode": { key: "transcripts", kind: "select", options: [["inherit", "As set here"], ["off", "Off"], ["errors", "When something fails"], ["full", "All activity"]] },
    "sp-share-history": { key: "sharesHistory", kind: "switch" },
    "sp-reads-others": { key: "readsOtherRooms", kind: "select", options: [["off", "No"], ["on-search", "When searching"], ["every-turn", "Every turn"]] },
  };
  function roomsByName() {
    return [...state.rooms.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  function roomValueWords(spec, value) {
    if (spec.kind === "switch") return value ? "On" : "Off";
    if (spec.kind === "select") return (spec.options.find(([v]) => v === value) || [value, String(value ?? "—")])[1];
    return value == null || value === "" ? "—" : `${value}${spec.unit ? ` ${spec.unit}` : ""}`;
  }
  function roomValuesSummary(spec, rooms) {
    const counts = new Map();
    for (const room of rooms) {
      const value = room.settings?.[spec.key];
      const seen = counts.get(value);
      if (seen) seen.n++;
      else counts.set(value, { n: 1, words: roomValueWords(spec, value) });
    }
    if (counts.size === 1) return `${rooms.length === 1 ? "The one room" : `All ${rooms.length} rooms`}: ${[...counts.values()][0].words}`;
    const order = (value) => (spec.kind === "number" ? Number(value) : spec.kind === "switch" ? (value ? 0 : 1) : spec.options.findIndex(([v]) => v === value));
    const counted = [...counts].sort((a, b) => b[1].n - a[1].n || order(a[0]) - order(b[0]));
    return `In ${rooms.length} rooms: ${counted.map(([, c]) => `${c.words} in ${c.n}`).join(", ")}`;
  }
  function roomValueRow(room, id, control) {
    return `<div class="room-value" data-room="${esc(room.id)}">${roomMark(room, "sm")}<label class="rv-name" for="${esc(id)}" title="${esc(room.name)}">${esc(room.name)}</label>${control}</div>`;
  }
  function roomListFold(summary, title, attrs, rowsHtml) {
    return {
      status: UI.raw(UI.html("button", { label: summary, kind: "link", act: "setting-fold", hook: "room-values-open", title })),
      fold: UI.raw(`<div class="room-values" ${attrs}>${rowsHtml}</div>`),
    };
  }
  function roomValueHtml(spec, room) {
    const value = room.settings?.[spec.key];
    const id = `rv-${spec.key}-${room.id}`;
    const control = spec.kind === "switch" ? UI.html("switch", { id, checked: !!value })
      : spec.kind === "select" ? selectHtml(id, spec.options, value)
      : UI.html("number-field", { id, value: String(value ?? ""), min: spec.min, max: spec.max, step: spec.step });
    return roomValueRow(room, id, control);
  }
  function roomValues(rowId) {
    const spec = ROOM_VALUE_ROWS[rowId];
    const rooms = roomsByName();
    if (!spec || !rooms.length) return {};
    return roomListFold(roomValuesSummary(spec, rooms), "Every room's own value; set any of them here", `data-own-save data-row="${rowId}"`, rooms.map((room) => roomValueHtml(spec, room)).join(""));
  }
  function roomValueOf(spec, control) {
    if (spec.kind === "switch") return control.checked;
    if (spec.kind === "select") return control.value;
    return Number(control.value);
  }
  document.addEventListener("change", async (e) => {
    const list = e.target.closest?.(".room-values[data-own-save]");
    if (!list || !e.target.id) return;
    const spec = ROOM_VALUE_ROWS[list.dataset.row];
    const roomId = e.target.closest(".room-value")?.dataset.room;
    if (!spec || !roomId) return;
    try {
      const answer = await post(`/api/rooms/${encodeURIComponent(roomId)}/settings`, { [spec.key]: roomValueOf(spec, e.target) });
      const room = state.rooms.get(roomId);
      if (room && answer?.settings) room.settings = answer.settings;
      const kept = answer?.settings?.[spec.key];
      if (kept !== undefined) { if (spec.kind === "switch") e.target.checked = !!kept; else e.target.value = String(kept); }
      const opener = list.closest('[data-ui="setting"]')?.querySelector(".room-values-open .label");
      if (opener) opener.textContent = roomValuesSummary(spec, roomsByName());
      markSaved(e.target.id);
    } catch (error) {
      showError(error);
    }
  });

  function renderSettingsPage() {
    const s = state.settings || { humanName: "", humanDescription: "", humanAvatar: "", roomDefaults: {}, vendorPresets: {} };
    const d = Object.assign({}, state.roomDefaults || {}, s.roomDefaults || {});
    const installed = state.recipes.filter((r) => !r.unavailableReason);
    const missing = state.recipes.filter((r) => r.unavailableReason);
    const dg = s.diagrams || { preset: "lavender", primary: null };
    const a = s.appearance || {};
    const ed = s.editor || {};
    const staleNote = [
      state.version && state.version.staleBuild ? `Older build running. There is a newer build on this machine — <code>${esc(state.version.staleBuild)}</code> was written after this room started — and the room keeps running the one it started with. Restart takes the new one.` : "",
      state.version && state.version.staleSource ? `This room is older than the code on disk: <code>${esc(state.version.staleSource)}</code> changed after it was built. Restart takes what is built; in a source checkout run <code>node scripts/update.mjs</code>, which builds first.` : "",
    ].filter(Boolean).join(" ");
    const row = settingRow;
    const presets = installed
      .map((r) => {
        const v = (s.vendorPresets || {})[r.id] || {};
        const input = (key, label, fallback) => `<label class="preset-field"><span>${label}</span><input type="text" class="input" data-vendor="${r.id}" data-key="${key}" list="sp-list-${r.id}-${key}" autocomplete="off" value="${esc(v[key] || "")}" placeholder="${esc(fallback || "vibemate default")}"></label>`;
        return row({ label: r.vendor, lead: UI.raw(vendorLogo(r)), stacked: true, control: UI.raw(`<div class="preset-fields">${input("model", "Model", r.defaultModel)}${input("effort", "Effort", r.defaultEffort)}${input("mode", "Mode", r.defaultMode)}</div>`) });
      })
      .join("");
    const vendorRow = (r, here) => {
      const out = here && r.loginState === "missing";
      const where = !here ? r.installHint || r.unavailableReason || "" : out ? UI.raw(`not logged in — run <code>${esc(r.loginCommand)}</code>`) : r.installedAt || "bundled";
      const badge = !here ? { label: "not installed", tone: "asleep" } : out ? { label: "no login", tone: "thinking", dot: true } : { label: "installed", tone: "ready", dot: true };
      return row({ label: r.vendor, lead: UI.raw(vendorLogo(r)), hint: where, control: UI.raw(UI.html("badge", badge)) });
    };
    const machine = installed.map((r) => vendorRow(r, true)).join("") + missing.map((r) => vendorRow(r, false)).join("");
    const lookId = TOKENS.looks[a.look] ? a.look : TOKENS.current.id;
    const look = TOKENS.looks[lookId];
    const custom = (a.custom || {})[lookId] || {};
    const adjustGroups = [...new Set(TOKENS.adjustables.map((f) => f.group))];
    const adjustRows = (group) => TOKENS.adjustables.filter((f) => f.group === group).map((f) => UI.html("adjust-row", { key: f.key, label: f.label, hint: f.hint, kind: f.kind, value: custom[f.key] || String(f.of(look)), own: String(f.of(look)), min: f.min, max: f.max, step: f.step })).join("");
    const card = settingsCard;
    const groups = {
      "sp-appearance": card("sp-appearance", "Look", `
          <div class="look-preview" id="sp-look-preview">${lookSampleHtml()}</div>
          <input type="hidden" id="sp-look" value="${esc(lookId)}">
          <div class="look-cards">${Object.values(TOKENS.looks).map((l) => UI.html("look-card", { look: l, tag: lookTag(l), on: lookId === l.id, data: { look: l.id } })).join("")}</div>
          <div class="look-own" id="sp-look-own">${UI.html("button", { label: "Import a look…", kind: "ghost", size: "xs", hook: "sp-look-import", title: "A look file (.json) saved from viberoom, yours or someone else's" })}<span class="own-only"${look.custom ? "" : " hidden"}>${UI.html("button", { label: "Export", kind: "ghost", size: "xs", hook: "sp-look-export", title: "Save this look as a file, to share or keep" })}${UI.html("button", { label: "Delete", kind: "danger", size: "xs", hook: "sp-look-delete", title: "Remove this look from your own looks" })}</span><input type="file" id="sp-look-file" accept=".json,application/json" hidden></div>
          <p class="hint">Every element keeps what it does; only its look changes. The sample above wears the look you pick; the window changes on save. Your own looks (a vibemate's, or a file you import) come after the ones viberoom ships.</p>`),
      "sp-look-adjust": card("sp-look-adjust", "", `
          ${row({ id: "sp-adj-head", label: `Fine-tune ${look.label}`, hint: "Kept for this look alone. The sample follows as you pick; the window follows on save.", control: actHtml({ label: "Reset all", kind: "ghost", hook: "sp-adj-reset", title: "Back to the look as designed" }) })}
          ${adjustGroups.map((g) => `<div class="adjust-group"><h5>${esc(g)}</h5>${adjustRows(g)}</div>`).join("")}`),
      "sp-scale": card("sp-scale", "Size", row({ label: "Scale, %", for: "sp-ui-scale", hint: "The whole window at once: boxes, buttons, panels, icons and text. 100 is the default; the window follows on save. The text size below comes on top of it, and so does the browser's own zoom.", control: UI.raw(UI.html("slider-field", { id: "sp-ui-scale", value: String(a.scale || 100), min: 70, max: 150, step: 5, unit: "%", label: "Scale of the whole window" })) })),
      "sp-text": card("sp-text", "Text", `
          ${row({ label: "Size, px", for: "sp-chat-fs", hint: "Only the text changes size; the boxes, buttons and panels stay (the Scale above changes everything). 14.5 is the default.", control: numberHtml({ id: "sp-chat-fs", value: String(a.chatFontSize || 14.5), min: 12, max: 32, step: 0.5 }) })}
          ${row({ label: "Font", for: "sp-font", geek: "The named fonts come with viberoom and look the same on every OS (all free, with Cyrillic); the system entries use what this machine has. A look with a font of its own (Terminal, Clay) keeps it while this stays at the default.", control: UI.raw(selectHtml("sp-font", Object.entries(FONTS.text).map(([id, f]) => [id, f.label]), a.font || "nunito")) })}
          ${row({ label: "Code font", for: "sp-mono", hint: "For code blocks, paths and tool output.", control: UI.raw(selectHtml("sp-mono", Object.entries(FONTS.mono).map(([id, f]) => [id, f.label]), a.mono || "jetbrains-mono")) })}
          <div class="bubble" id="sp-chat-sample" style="display:inline-block;font-size:${a.chatFontSize || 14.5}px">Messages will read like this, with <code>code</code> a step smaller.</div>`),
      "sp-diagrams": card("sp-diagrams", "Diagrams", `
          ${row({ label: "Colours of the boxes", stacked: true, geek: "Vibemates draw diagrams as Mermaid (a ```mermaid block in a message); the room renders them here, with these colours. Mermaid derives the shades of borders and text from the box colour.", control: UI.raw(`<div class="chips diagram-presets">${Object.entries(DIAGRAM_PRESETS).map(([id, p]) => UI.html("choice", { label: p.label, on: dg.preset === id, data: { preset: id }, lead: UI.raw(`<span class="swatch" style="${p.palette ? `background:linear-gradient(90deg, ${p.palette.map((c) => c.fill).join(", ")});border-color:${p.palette[0].stroke}` : `background:${p.primaryColor};border-color:${p.primaryBorderColor}`}"></span>`) })).join("")}</div><input type="hidden" id="sp-diagram-preset" value="${esc(dg.preset)}">`) })}
          ${row({ label: "My own colour for the boxes", for: "sp-diagram-custom", kind: "switch", checked: !!dg.primary })}
          ${row({ id: "sp-diagram-color-row", hidden: !dg.primary, label: "Box colour", for: "sp-diagram-color", control: UI.raw(`<input type="color" id="sp-diagram-color" value="${esc(dg.primary || TOKENS.diagrams.customBoxDefault)}">`) })}
          ${mermaidBlock("graph LR\n  A[You] --> B(Vibemate)\n  B --> C{Agreed?}\n  C -->|yes| D[Done]\n  C -->|no| B").replace('class="mermaid-block"', 'class="mermaid-block preview"')}`),
      "sp-messages": card("sp-messages", "", row({ label: "A click on a long message shows all of it", for: "sp-more-on-click", kind: "switch", checked: s.showMoreOnClick !== false, hint: "A long message is drawn folded, with Show more under it. On: a click anywhere on the folded message opens it too, except on its links and buttons, or when you select words in it. Show less folds it again." })),
      "sp-scroll": card("sp-scroll", "", `${row({ label: "One notch of the mouse wheel, % of the chat", for: "sp-wheel-step", hint: "How far a notch moves the chat, as a share of its height: 20 is five notches to a screen. Each notch eases to its place and stops there. A wheel set to fewer lines in the system moves that much less; a touchpad keeps its own scrolling.", geek: "Chromium moves a fixed 100 px a notch, about 11 % of this chat; Edge moves 15 % of what scrolls. A notch here arrives in 150 ms and has no tail, the way Firefox animates one over 50–200 ms.", control: numberHtml({ id: "sp-wheel-step", value: String(s.wheelStepPercent ?? WHEEL_STEP_DEFAULT), min: 5, max: 60, step: 5 }) })}
        ${row({ label: "Glide after the wheel stops", for: "sp-wheel-inertia", kind: "switch", checked: s.wheelInertia === true, hint: "On: after the last notch the chat glides on for a moment and comes to rest, as a flick does. Off: every notch moves its step and stops." })}`),
      "sp-notices": card("sp-notices", "", `${row({ label: "Notify me when a vibemate replies", for: "sp-notify", hint: "While viberoom is not in front of you: a notification of the system, one per room, the newest in place of the last. A click opens the room.", control: UI.raw(selectHtml("sp-notify", [["every", "Every reply"], ["to-me", "Replies to me, and when a room needs me"], ["off", "Never"]], s.notifyReplies || "every")) })}
        ${notifyPermissionRow(row)}
        ${row({ label: "Count on the viberoom icon", for: "sp-badge", kind: "switch", checked: s.appBadge !== false, hint: "The replies you have not seen yet, on the icon in the taskbar or the Dock, and in the window's title.", geek: "The desktop app draws the count on Windows, macOS and Linux (where the desktop shows counts on icons). In a browser window only an installed app gets one from the browser; the title shows it everywhere." })}`),
      "sp-permissions": card("sp-permissions", "Permissions", row({ label: "Vibemates act without asking", for: "sp-bypass", kind: "switch", checked: s.bypassPermissionsByDefault !== false, hint: "Off: they ask you before editing files or running commands.", geek: 'New vibemates start in their vendor\'s "act without asking" mode (Claude bypassPermissions, Codex agent-full-access, Gemini yolo, Cursor agent, OpenCode build, Copilot agent + allow_all). Change it per vibemate when summoning one, or later in its panel.' })),
      "sp-pace": card("sp-pace", "Pace", `
          ${row({ label: "Turn taking in new rooms", for: "sp-turns", ...roomValues("sp-turns"), hint: "Each room can change it in its own settings.", control: UI.raw(selectHtml("sp-turns", [["one-at-a-time", "One vibemate at a time"], ["parallel", "All addressed vibemates at once"]], d.turnTaking === "parallel" ? "parallel" : "one-at-a-time")) })}
          ${row({ label: "Reply delay in new rooms, seconds", for: "sp-delay", ...roomValues("sp-delay"), hint: "Used when two or more vibemates share a room; each room can change it; a vibemate can override it in its own panel.", geek: "Before each turn a vibemate waits a random 0–N seconds, so replies cross less often. Messages that arrive meanwhile land in its backlog. A vibemate alone answers at once unless it has its own delay.", control: numberHtml({ id: "sp-delay", value: String(d.replyDelay ?? 4), min: 0, max: 120, step: 0.5 }) })}`),
      "sp-vibemates-on-this-machine": card("sp-vibemates-on-this-machine", "On this computer", machine || '<p class="hint">No supported vibemate is installed yet.</p>'),
      "sp-channels": card("sp-channels", "", channelsSectionHtml()),
      "sp-voice": card("sp-voice", "", voiceSectionHtml()),
      "sp-voice-reading": card("sp-voice-reading", "Replies read aloud", readingSectionHtml()),
      "sp-memory": card("sp-memory", "", memorySectionHtml()),
      "sp-carrying": card("sp-carrying", "", row({ label: "Rooms for another computer", hint: "Save selected rooms for another computer, bring in a copy, or inspect removed versions.", control: actHtml({ label: "Export / Import…", id: "sp-carry" }) })),
      "sp-editor": card("sp-editor", "Open files at a line", `
          ${row({ label: "A click on a path like main.ts:375 opens the file in", stacked: true, geek: "Only an editor can jump to a line; the OS default app just opens the file. Auto looks for VS Code, Cursor, Windsurf, Zed, Sublime Text, Notepad++ and the JetBrains IDEs, in that order, on PATH and in their usual folders. Custom: a command with {file}, {line} and {column} placeholders, e.g. code --goto {file}:{line}.", control: UI.raw(`<div class="chips editor-modes">${UI.html("choice", { label: "Auto", on: !["custom", "default-app"].includes(ed.mode), data: { mode: "auto" } })}${UI.html("choice", { label: "The default app", on: ed.mode === "default-app", data: { mode: "default-app" } })}${UI.html("choice", { label: "My own command", on: ed.mode === "custom", data: { mode: "custom" } })}</div><input type="hidden" id="sp-editor-mode" value="${esc(ed.mode || "auto")}">`) })}
          ${row({ label: "Command", for: "sp-editor-cmd", stacked: true, hint: "{file}, {line} and {column} are filled in; quotes group arguments.", control: UI.raw(`<input type="text" class="input" id="sp-editor-cmd" maxlength="500" value="${esc(ed.command || "")}" placeholder="code --goto {file}:{line}">`) })}`),
      "sp-update": card("sp-update", "Updates", `
          ${row({ label: "Check for updates once a day", for: "sp-updates", kind: "switch", checked: s.checkForUpdates !== false, hint: "At start, one request to the npm registry for the latest viberoom version; nothing else leaves this machine. A newer version shows as a bubble over your avatar." })}
          ${row({ label: "Version", status: updateStatusText(), statusId: "sp-update-status", control: actHtml({ label: "Check now", id: "sp-update-check" }) })}
          ${row({ label: "Check installed agents once a day", for: "sp-agent-updates", kind: "switch", checked: s.checkAgentUpdates !== false, hint: "Checks the existing installations and their release channels. Updates run only when you choose them." })}
          ${row({ label: "Installed agents", status: agentUpdates.status(), statusId: "sp-agent-update-status", control: actHtml({ label: "Agent updates…", id: "sp-agent-update-open" }) })}`),
      "sp-autostart": card("sp-autostart", "Start with the computer", row({ label: "Start viberoom when you sign in to this computer", for: "sp-autostart-on", kind: "switch", checked: !!(state.autostart && state.autostart.enabled), disabled: !state.autostart, hint: 'A quiet start, without a window: the icon opens the window when you want it. Rooms with "Start this room with viberoom" bring their vibemates back by themselves, so a paired phone reaches them without a click. A viberoom already running is left alone. Switch this off before you remove or move viberoom.', status: UI.raw(autostartStatusText()), statusId: "sp-autostart-status" })),
      "sp-folder": dataFolderRow(),
      "sp-restart": card("sp-restart", "Restart", row({ label: "Restart viberoom", hint: "Starts the room again with what is on disk. The vibemates come back the way Welcome back is set to bring them, and this window reconnects on its own. Closing the window does not do this: the room keeps running in the background, which is why it can stay on an older build than the one you have.", status: staleNote ? UI.raw(staleNote) : "", statusTone: "warn", control: actHtml({ label: "Restart", id: "sp-restart-now" }) })),
      "sp-defaults-for-new-rooms": card("sp-defaults-for-new-rooms", "", `
          ${row({ label: "Hop limit", for: "sp-hops", ...roomValues("sp-hops"), hint: "How many vibemate-to-vibemate replies may follow one message of yours before the room waits for you again.", control: numberHtml({ id: "sp-hops", value: String(d.hopLimit), min: 0, max: 10000 }) })}
          ${row({ label: "Full brief every N turns", for: "sp-brief-turns", ...roomValues("sp-brief-turns"), hint: "How often a vibemate gets the whole room brief again instead of the short header.", control: numberHtml({ id: "sp-brief-turns", value: String(d.fullBriefEveryTurns), min: 1, max: 10000 }) })}
          ${row({ label: "Full brief every N tokens", for: "sp-brief-tokens", ...roomValues("sp-brief-tokens"), hint: "…or after this much new context since its last full brief, whichever comes first.", control: numberHtml({ id: "sp-brief-tokens", value: String(d.fullBriefEveryTokens), min: 1000, max: 10000000, step: 1000 }) })}
          ${row({ label: "Most characters in a vibio or in the room rules", for: "sp-text-limit", ...roomValues("sp-text-limit"), hint: "The limit applies separately to each text. Text over it is refused with the numbers, never cut; each room can raise or lower its own limit.", control: numberHtml({ id: "sp-text-limit", value: String(d.briefTextLimit ?? 8000), min: 500, max: 32000, step: 500 }) })}
          ${row({ label: "Repeat core rules in every header", for: "sp-header-rules", ...roomValues("sp-header-rules"), kind: "switch", checked: !!d.headerRules, hint: "The short header before each turn repeats the room's core rules (who is here, how to address, how long to write)." })}
          ${row({ label: "Tools", for: "sp-tools", ...roomValues("sp-tools"), hint: "Whether vibemates may use their own tools (files, shell, web) without being asked to.", control: UI.raw(selectHtml("sp-tools", [["on-request", "Only when asked"], ["never", "Never"]], d.tools === "never" ? "never" : "on-request")) })}
          ${row({ label: "Share the room's history with the other rooms", for: "sp-share-history", ...roomValues("sp-share-history"), kind: "switch", checked: d.sharesHistory !== false, hint: SHARES_HISTORY_HINT })}
          ${row({ label: "Search the other rooms", for: "sp-reads-others", ...roomValues("sp-reads-others"), hint: READS_OTHER_ROOMS_HINT, geek: READS_OTHER_ROOMS_GEEK, control: UI.raw(selectHtml("sp-reads-others", READS_OTHER_ROOMS, d.readsOtherRooms || "on-search")) })}`),
      "sp-shared-memory": card("sp-shared-memory", "", row({ label: "Shared memory about you", hint: "Review learned preferences, protected notes and their revision history.", control: actHtml({ label: "Open…", data: { memoryOpen: "user" } }) })),
      "sp-skills-from-vibemates": card("sp-skills-from-vibemates", "", row({ label: "Vibemate-created skills need my approval", for: "sp-skill-approval", kind: "switch", checked: !!s.agentSkillsNeedApproval, hint: 'Off: a skill a vibemate creates is usable at once and shows as "unreviewed" until you open it. On: it stays a draft (not delivered, not attachable) until you approve it under Skills.' })),
      "sp-presets-per-vibemate": card("sp-presets-per-vibemate", "", `
          <p class="hint">Used when you summon one; leave a field empty for the built-in suggestion. The summon dialog always shows what the vibemate really offers. Bypass modes: Claude bypassPermissions, Codex agent-full-access, Gemini yolo, Cursor agent, OpenCode build, Copilot agent + allow_all.</p>
          ${presets || '<p class="hint">No supported vibemate is installed yet.</p>'}`),
      "sp-transcripts": card("sp-transcripts", "", `
          ${row({ label: "Save diagnostic details", for: "sp-transcripts-mode", ...roomValues("sp-transcripts-mode"), hint: `${DIAGNOSTIC_LOG_HELP} You can choose a different setting for each room.`, control: UI.raw(selectHtml("sp-transcripts-mode", [["off", "Off (default)"], ["errors", "When something fails"], ["full", "All activity"]], s.transcripts || "off")) })}
          ${row({ label: "Saved details", hint: "Includes current and removed rooms. Clearing these details keeps your conversations and shared files. Recording can create new details while vibemates work.", status: "Checking saved diagnostic details…", statusId: "sp-log-size", control: UI.raw(UI.html("button", { label: "Check size", kind: "secondary", size: "sm", id: "sp-log-check" }) + UI.html("button", { label: "Clear diagnostic details", kind: "warn", size: "sm", id: "sp-log-clear", disabled: true })) })}
          ${row({ label: "Tool connection details", hint: "Recent tool connection timings stay in memory. Copy them when reporting a connection problem; message text and access keys are not included.", control: actHtml({ label: "Copy tool connection details", id: "sp-connection-copy" }) })}`),
      "sp-slow": devBuild() ? card("sp-slow", "", `
          <p class="hint">Only a viberoom run from its own sources shows this page: a copy installed from npm has no sources, so it never does. It measures this window, so a slow or choppy moment can be reported with the place it happened in.</p>
          ${row({ label: "Slow moments", hint: "Everything this window spent more than 8 ms on, newest first: the moment, the cost, what it was, and what the room was doing then. Anything over 50 ms the browser reports by itself, ours or not. When something feels slow, copy the list into the room: it says where to look, which a measurement from outside cannot.", control: actHtml({ label: "Copy the list", id: "sp-slow-copy" }) })}
          ${slowTasksHtml()}
          ${row({ label: "Jumps to the newest message", hint: "Every time the chat moved to the newest message by itself, and who asked for it. A move while you were reading higher up is the one to report." })}
          ${endJumpsHtml()}`) : "",
      "sp-dev-prompts": devBuild() ? card("sp-dev-prompts", "What the vibemates are sent", row({ label: "Show each reply's prompt", for: "sp-dev-prompts-on", kind: "switch", checked: !!s.devShowPrompts, hint: "On: every vibemate's reply gets a Prompt button beside its tool calls. It unfolds what viberoom sent that vibemate for the turn, block by block and exactly as it went: the brief, the rules, the vibio, the memory, the header, the messages. Kept from the moment this is on, beside each room's history, the newest 300 turns of a room." })) : "",
      "sp-wheel": devBuild() ? card("sp-wheel", "The wheel", row({ label: "Wheel trace", hint: "Every wheel event on the chat in the last two minutes: its step, how long after the last one it came, how late this window heard it, and what the wheel made of it — a step, the glide, or the browser's own scroll; then the late frames and why the motion stopped. When the scroll feels choppy, scroll the same way again, then copy the trace into the room.", status: wheelTraceSummary(), control: actHtml({ label: "Copy the trace", id: "sp-wheel-copy" }) })) : "",
    };
    const categories = settingsCategories();
    const shown = settingsCategoryShown(categories);
    const columns = [".settings-side", ".settings-pages"];
    const kept = columns.map((selector) => els.pageInner.querySelector?.(selector)?.scrollTop || 0);
    els.pageInner.innerHTML = `
      <div class="settings-page">
        <div class="settings-side">
          <div class="page-head app-settings-head"><div class="app-settings-title">${UI.html("settings-glyph", { glyph: "settings", tone: "slate" })}<div><h1>Settings</h1><div class="hint">${state.version ? `${esc(state.version.name)} ${esc(state.version.version)} · room built ${esc(new Date(state.version.build).toLocaleString())}` : "room build unknown (older room process; run viberoom again to replace it)"}</div></div></div></div>
          ${UI.html("settings-nav", { items: categories, current: shown })}
        </div>
        <div id="sp-form" class="settings-pages">
          ${categories.map((c) => UI.html("settings-category", { id: c.id, title: c.label, about: c.about, glyph: c.glyph, tone: c.tone || "slate", geek: !!c.geek, current: c.id === shown, body: UI.raw(c.groups.map((id) => groups[id] || "").join("")) })).join("")}
        </div>
      </div>`;
    columns.forEach((selector, i) => (els.pageInner.querySelector(selector).scrollTop = kept[i]));
    placeSettingsBar(els.pageInner.querySelector('[data-ui="settings-nav"]'));
    bindDiagnosticLogControls();
    document.querySelector("#sp-carry").addEventListener("click", () => void openCarry(null));
    bindChannelControls();
    bindMemoryControls();
    bindVoiceControls();
    bindReadingControls();
    const editorSection = $("#sp-editor");
    const editorCmdRow = $("#sp-editor-cmd").closest('[data-ui="setting"]');
    const showEditorCmd = () => (editorCmdRow.hidden = $("#sp-editor-mode").value !== "custom");
    showEditorCmd();
    editorSection.querySelectorAll('.editor-modes [data-ui="choice"]').forEach((b) =>
      b.addEventListener("click", () => {
        editorSection.querySelectorAll('.editor-modes [data-ui="choice"]').forEach((x) => UI.setState(x, x === b ? "on" : null));
        const input = $("#sp-editor-mode");
        input.value = b.dataset.mode;
        showEditorCmd();
        const command = $("#sp-editor-cmd");
        if (b.dataset.mode === "custom" && !command.value.includes("{file}")) {
          command.focus();
          return;
        }
        input.dispatchEvent(new Event("change", { bubbles: true }));
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
    const drawSample = async () => {
      try {
        await loadMermaid();
      } catch (e) {
        return showError(e);
      }
      if (diagramSection.isConnected) renderDiagrams(diagramSection, previewTheme());
    };
    const samplePage = diagramSection.closest('[data-ui="settings-category"]');
    if (samplePage.hidden) samplePage.addEventListener(SETTINGS_PAGE_SHOWN, drawSample, { once: true });
    else void drawSample();
    $("#sp-ui-scale").addEventListener("input", (event) => { event.target.nextElementSibling.textContent = `${event.target.value}%`; });
    const sample = $("#sp-chat-sample");
    $("#sp-chat-fs").addEventListener("input", () => {
      const px = Number($("#sp-chat-fs").value);
      if (px >= 12 && px <= 32) sample.style.fontSize = `${px}px`;
    });
    $("#sp-font").addEventListener("change", () => (sample.style.fontFamily = FONTS.text[$("#sp-font").value].stack));
    const looksBox = $("#sp-cat-appearance");
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
      $("#sp-adj-head .name").textContent = `Fine-tune ${look.label}`;
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
    looksBox.querySelector(".sp-look-export").addEventListener("click", async () => {
      const look = pickedLook();
      const spec = state.looks.find((l) => l.id === look.id);
      if (!spec) return;
      try {
        await VIBEROOM_SAVE.saveFile({ name: `${look.id}.json`, blob: new Blob([`${JSON.stringify(spec, null, 2)}\n`], { type: "application/json" }), description: "A viberoom look", type: "application/json", extension: ".json" });
      } catch (error) {
        showError(error);
      }
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
    bindCopy($("#sp-slow-copy"), slowTasksText, "nothing over 8 ms in this window");
    bindCopy($("#sp-wheel-copy"), wheelTraceText, "no wheel on the chat in the last two minutes");
    $("#sp-restart-now").addEventListener("click", async () => {
      let once = null;
      const keeps = (state.settings || {}).reconnectMode === "load";
      const writing = [...state.rooms.values()].flatMap((r) => (r.participants || []).filter((p) => p.kind === "agent" && p.status === "thinking").map((p) => p.name));
      const back = keeps
        ? "Rooms set to start with viberoom come back, and each vibemate returns with its session, so conversations continue. A vibemate whose session cannot be loaded returns with the last few messages instead — the room says which happened."
        : "Rooms set to start with viberoom come back, and each vibemate starts fresh with the last few messages of the room.";
      const cut = writing.length
        ? `${nameList(writing)} ${writing.length > 1 ? "are" : "is"} writing: viberoom can wait for ${writing.length > 1 ? "those replies" : "that reply"}, or restart now and cut ${writing.length > 1 ? "them" : "it"} short.`
        : "A reply being written right now would be cut short.";
      const other = keeps ? "Start the vibemates fresh instead" : "Bring the vibemates' sessions back instead";
      const choice = await choiceDialog(`viberoom closes and opens again on the same port; it takes a few seconds. ${back} ${cut}`, {
        title: "Restart viberoom?",
        okLabel: writing.length ? "When they finish" : "Restart",
        altLabel: writing.length ? "Restart now" : "",
        extraHtml: settingsCard("cf-sessions", "", settingRow({ label: other, for: "cf-sessions-once", kind: "switch", hint: "For this restart only. Your lasting choice is under Vibemates → Welcome back." })),
        beforeClose: () => { once = $("#cf-sessions-once") && $("#cf-sessions-once").checked ? (keeps ? "replay" : "load") : null; },
      });
      if (choice === "cancel") return;
      const button = $("#sp-restart-now");
      const say = (words) => (button.querySelector(".label").textContent = words);
      button.disabled = true;
      say("Restarting…");
      try {
        const res = await post("/api/restart", { when: choice === "alt" ? "now" : "idle", ...(once ? { sessions: once } : {}) });
        const held = (res && res.restart && res.restart.waitingFor) || [];
        toast(held.length ? `viberoom restarts when ${nameList(held)} ${held.length > 1 ? "finish" : "finishes"}.` : "viberoom is restarting; the window reconnects on its own.", "success");
        if (held.length) { button.disabled = false; say("Restart"); }
      } catch (error) {
        showError(error);
        button.disabled = false;
        say("Restart");
      }
    });
    $("#sp-autostart-on")?.addEventListener("change", async (e) => {
      e.stopPropagation();
      const box = e.target;
      const wanted = box.checked;
      box.disabled = true;
      try {
        const res = await post("/api/autostart", { enabled: wanted });
        state.autostart = res.autostart || state.autostart;
        if (res.autostart?.enabled !== wanted) toast(res.autostart?.note || "The operating system did not apply the startup setting.", "warn");
        else toast(wanted ? "viberoom starts when you sign in." : "viberoom no longer starts when you sign in.", "success");
      } catch (error) {
        showError(error);
      }
      if (state.view === "settings") renderSettingsPage();
    });
    const narrowBtn = $("#sp-folder-narrow");
    if (narrowBtn) narrowBtn.addEventListener("click", async () => {
      narrowBtn.disabled = true;
      UI.setState(narrowBtn, "loading");
      try {
        const { dataFolder } = await post("/api/data-folder/narrow");
        state.dataFolder = dataFolder;
        markSettingsRail();
        const left = (dataFolder && dataFolder.others) || [];
        $("#sp-folder-result").textContent = left.length
          ? `Still open to ${left.join(", ")}. Your computer refused the change; an administrator can make it.`
          : "Private: this folder now opens for you alone.";
        if (!left.length) setTimeout(() => renderSettingsPage(), 1500);
      } catch (e) {
        showError(e);
      }
      narrowBtn.disabled = false;
      UI.setState(narrowBtn, null);
    });
    $("#sp-notify-allow")?.addEventListener("click", async () => {
      await askToKnock(true);
      renderSettingsPage();
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
    $("#sp-agent-update-open").addEventListener("click", () => agentUpdates.open());
    els.pageInner.querySelectorAll("input[data-vendor]").forEach((inp) => {
      const list = document.createElement("datalist"); list.id = inp.getAttribute("list"); inp.after(list);
      inp.addEventListener("focus", () => void fillVendorChoices(inp.dataset.vendor));
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
          showMoreOnClick: $("#sp-more-on-click").checked,
          wheelStepPercent: Number($("#sp-wheel-step").value),
          wheelInertia: $("#sp-wheel-inertia").checked,
          notifyReplies: $("#sp-notify").value,
          appBadge: $("#sp-badge").checked,
          devShowPrompts: $("#sp-dev-prompts-on")?.checked,
          checkForUpdates: $("#sp-updates").checked,
          checkAgentUpdates: $("#sp-agent-updates").checked,
          transcripts: $("#sp-transcripts-mode").value,
          diagrams: { preset: $("#sp-diagram-preset").value, primary: $("#sp-diagram-custom").checked ? $("#sp-diagram-color").value : null },
          editor: { mode: $("#sp-editor-mode").value, command: $("#sp-editor-cmd").value },
          appearance: { chatFontSize: Number($("#sp-chat-fs").value), scale: Number($("#sp-ui-scale").value), font: $("#sp-font").value, mono: $("#sp-mono").value, look: $("#sp-look").value, custom: { [$("#sp-look").value]: Object.keys(pendingAdjust()).length ? pendingAdjust() : null } },
          roomDefaults: {
            turnTaking: $("#sp-turns").value,
            replyDelay: Number($("#sp-delay").value),
            hopLimit: Number($("#sp-hops").value),
            fullBriefEveryTurns: Number($("#sp-brief-turns").value),
            fullBriefEveryTokens: Number($("#sp-brief-tokens").value),
            briefTextLimit: Number($("#sp-text-limit").value),
            headerRules: $("#sp-header-rules").checked,
            tools: $("#sp-tools").value,
            sharesHistory: $("#sp-share-history").checked,
            readsOtherRooms: $("#sp-reads-others").value,
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
    if (u.available && u.stage === "downloading") return `viberoom ${u.latest} is downloading, ${u.progress ?? 0} % (this is ${u.current}); checked ${when}.`;
    if (u.available && u.stage === "ready") return `viberoom ${u.latest} is downloaded and ready: Restart to update (this is ${u.current}); checked ${when}.`;
    if (u.available) return `viberoom ${u.latest} is available (this is ${u.current}); checked ${when}.`;
    if (u.error) return `Could not check for a newer version (${u.error}); checked ${when}.`;
    return `This is viberoom ${u.current}, the latest; checked ${when}.`;
  }

  const channelsKeep = { newRoot: "", newDeep: true, rename: false };

  function channelsState(c) {
    const tg = c.telegram;
    const paired = (c.pairings || []).filter((p) => !p.unpairedAt);
    if (!tg || !tg.tokenSet) return { kind: "unset", mark: { label: "Not set up", tone: "outline" }, line: "Make a bot for this computer and pair it; about ten minutes.", action: { label: "Set up Telegram…", act: "ch-setup" } };
    if (!tg.enabled) return { kind: "off", mark: { label: "Off", tone: "muted" }, line: "Switched off: the phone gets nothing until the channel is on again. The key and the paired accounts are kept.", action: { label: "Switch on", act: "ch-on" } };
    switch (tg.state) {
      case "degraded": return { kind: "problem", mark: { label: "Not listening", tone: "error" }, line: "Another computer is listening to this bot. Give this one a bot of its own.", action: { label: "Set up Telegram…", act: "ch-setup" } };
      case "contested": return { kind: "problem", mark: { label: "Two computers", tone: "error" }, line: "Another computer answers on this bot too: the phone gets every reply twice. Give this one a bot of its own.", action: { label: "Set up Telegram…", act: "ch-setup" } };
      case "checking": return { kind: "setting", mark: { label: "Checking…", tone: "waiting", dot: true }, line: "Another program answered for this bot; checking whether it lets go (a restart does within seconds).", action: null };
      case "paused": return { kind: paired.length ? "connected" : "setting", mark: { label: "Paused", tone: "waiting" }, line: "The conversation store is not answering; the channel resumes by itself.", action: null };
      case "connected":
      case "listening":
        if (paired.length) return { kind: "connected", mark: tg.state === "listening" ? { label: "Listening", tone: "ready", dot: true } : { label: "Connected", tone: "ready" }, line: "", action: null };
        return { kind: "setting", mark: { label: "Half done", tone: "waiting" }, line: "The key is in. Pair a phone to finish.", action: { label: "Continue setup…", act: "ch-continue" } };
      default:
        if (tg.detail) return { kind: "problem", mark: { label: "Not listening", tone: "error" }, line: `Not listening: ${tg.detail}.`, action: { label: "Replace the key…", act: "ch-replace-key" } };
        return { kind: "setting", mark: { label: "Starting…", tone: "waiting", dot: true }, line: "Connecting to Telegram…", action: null };
    }
  }

  function channelsSectionHtml() {
    const c = state.channels || { telegram: null, pairings: [], bindings: [] };
    const tg = c.telegram;
    const st = channelsState(c);
    const active = (c.pairings || []).filter((p) => !p.unpairedAt);
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const when = (ts) => { const d = new Date(ts); return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === new Date().getFullYear() ? "" : ` ${d.getFullYear()}`}`; };
    const machine = c.machine || "this computer";
    const title = tg && tg.tokenSet ? tg.name || tg.wantedName || `viberoom on ${machine}` : "Telegram";
    const head = `<div class="ch-head">${ic("send", "ch-mark")}<div class="ch-title">${esc(title)}${tg && tg.account ? `<small>@${esc(tg.account)}</small>` : ""}</div>${UI.html("badge", { label: st.mark.label, tone: st.mark.tone, dot: !!st.mark.dot })}</div>`;
    const line = st.line ? `<p class="ch-line">${esc(st.line)}</p>` : "";
    const facts = st.kind === "connected" ? `<ul class="ch-facts">
        <li>${ic("link")}<span>Room messages pass through Telegram.</span></li>
        <li>${ic("lock")}<span>Permission cards: ${c.phoneApprovals ? "can be answered from the phone." : "answered on this computer."}</span></li>
      </ul>` : "";
    const groups = st.kind === "connected" ? `<div class="ch-group"><div class="ch-group-title">Paired account${active.length === 1 ? "" : "s"}</div>
        ${active.map((p) => `<div class="ch-row">${ic("user")}<span class="grow"><b>${esc(p.name || p.senderId)}</b> — every device signed in to it <span class="hint">· paired ${esc(when(p.pairedAt))}</span></span>${UI.html("button", { label: "Unpair", kind: "danger-quiet", size: "xs", data: { unpair: p.senderId } })}</div>`).join("")}
        <div class="ch-acts">${UI.html("button", { label: "Pair another phone…", kind: "secondary", size: "sm", act: "ch-pair" })}</div>
      </div>
      <div class="ch-group"><div class="ch-group-title">This bot</div>
        <div class="ch-acts">${UI.html("button", { label: channelsKeep.rename ? "Keep the name" : "Rename…", kind: "secondary", size: "sm", act: "ch-rename" })}${UI.html("button", { label: "Replace the key…", kind: "secondary", size: "sm", act: "ch-replace-key" })}</div>
      </div>` : "";
    const acts = [];
    if (st.action) acts.push(UI.html("button", { label: st.action.label, kind: "primary", size: "sm", act: st.action.act }));
    if (st.kind === "problem" || st.kind === "setting") acts.push(UI.html("button", { label: "Switch off", kind: "secondary", size: "xs", act: "ch-off", title: "The key and the paired accounts are kept" }));
    acts.push(UI.html("button", { label: st.kind === "unset" ? "See the guide first" : "Open the guide", kind: "link", size: "xs", act: "ch-guide", title: "The steps, with pictures, inside viberoom" }));
    const rename = st.kind === "connected" && channelsKeep.rename
      ? UI.html("setting", {
        label: "Name shown on the phone",
        for: "sp-tg-name",
        hint: "One bot is one computer: a name that tells your computers apart. Anyone who opens the bot sees it. Saved when you leave the field; the bot reconnects with it.",
        control: UI.raw(`<input type="text" class="input" id="sp-tg-name" maxlength="64" spellcheck="false" value="${esc((tg && tg.wantedName) || "")}" placeholder="${esc(`viberoom on ${machine}`)}">`),
      })
      : "";
    const geek = st.kind === "unset"
      ? `<div class="ch-geek">${geekTip("Once it is on, the messages of any room you open on the phone travel through Telegram's servers. The bot's key is kept on this computer only and never shown again; a lost or leaked key is replaced with /revoke at BotFather, then the new one here. Every room is reachable from the phone unless switched off in the room's own settings.")}</div>`
      : "";
    const rows = (c.fileRoots || []).map((r) => `<div class="roots-row" data-root><input type="text" class="input roots-path" value="${esc(r.path)}" spellcheck="false" aria-label="Folder"><label class="check-row"><input type="checkbox" class="roots-deep" ${r.subfolders ? "checked" : ""}> and its subfolders</label>${UI.html("button", { label: "Remove", size: "xs", kind: "secondary", act: "roots-remove" })}</div>`).join("");
    const settings = st.kind === "connected" ? [
      rename,
      UI.html("setting", {
        label: "Folders the phone may be sent files from",
        stacked: true,
        geek: "Files named in a message, or asked for by name from the phone, get a Send button when they are inside one of these folders (with or without its subfolders), the room's own files or its working folder. What vibemates may read or write is their own matter and does not change here. Keep the list short: with its subfolders, a folder is the whole tree under it.",
        control: UI.raw(`<div class="roots-list" id="sp-tg-roots">${rows}<div class="roots-row"><input type="text" class="input" id="sp-tg-roots-new" value="${esc(channelsKeep.newRoot)}" placeholder="a folder" spellcheck="false" aria-label="A folder to add">${UI.html("button", { label: "Browse", icon: "folder", kind: "secondary", size: "sm", id: "sp-tg-roots-browse", title: "Choose a folder", hook: "browse-btn" })}${UI.html("button", { label: "Add", size: "sm", act: "roots-add" })}</div><div class="roots-row roots-depth"><label class="check-row"><input type="checkbox" id="sp-tg-roots-new-deep"${channelsKeep.newDeep ? " checked" : ""}> and its subfolders</label><span class="hint">For example ${esc(c.folderExample || "your Downloads folder")}; Browse finds it. The phone gets a Send button for files in these folders; vibemates get no access from this, and no file leaves this computer without your press.</span></div></div>`),
      }),
      UI.html("setting", {
        label: "Answer permission questions from the phone",
        for: "sp-tg-approvals",
        kind: "switch",
        checked: !!c.phoneApprovals,
        hint: `When a vibemate needs your permission — to edit a file, to run a command — the question reaches your phone too, so you do not walk to the computer to press Yes. Whoever holds the paired phone can allow that one action.${c.phoneApprovals ? "" : " Off: the phone only says the question is waiting on this computer."}`,
        geek: "Only for actions inside the room's folders; the choice for the whole session stays on this computer.",
      }),
      UI.html("setting", { label: "Channel on", for: "sp-tg-enabled", kind: "switch", checked: !!(tg && tg.enabled), hint: "Off keeps the key and the paired accounts; the phone gets nothing until it is on again." }),
    ].join("") : "";
    return `<div class="ch-card" data-state="${st.kind}">${head}${line}${facts}${acts.length ? `<div class="ch-acts">${acts.join("")}</div>` : ""}${groups}${geek}</div>${settings}`;
  }

  const KEY_GEEK = "This field is write-only. The value goes from it straight into this computer's vault — sealed with Windows DPAPI, macOS Keychain or the Linux Secret Service — and the settings file keeps only a vault:… reference. It never comes back to this screen, never enters a room, a prompt, the record or a vibemate's context; they learn only that a key is set. As a second net, every line of the hub's log is scrubbed of the stored values and of key shapes.";

  function noPeekHtml(kind = "row", label = "No vibemate sees this field: it has turned its back and covers its eyes") {
    return `<span class="no-peek scene-art is-${kind}" role="img" aria-label="${esc(label)}">${window.Icons.scene("no-peek")}</span>`;
  }

  const SEARCH_FORMS = {
    question: "Query decomposition (a short question per topic of your message)",
    words: "Your words by topic (your message cut by topic, as you wrote it)",
    fact: "HyDE (hypothetical document: the facts an answer would need, imagined, then searched for)",
  };
  const VOICE_LANGUAGES = [["", "By its sound"], ...["bg", "en", "de", "fr", "es", "it", "pt", "nl", "pl", "uk", "ru", "el", "ro", "sr", "tr"].map((code) => [code, new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code])];
  function voiceFieldHtml(f, data) {
    const row = (props) => UI.html("setting", props);
    return f.kind === "secret"
      ? row({ label: f.label, hint: f.hint || "", lead: UI.raw(noPeekHtml()), geek: KEY_GEEK, data, control: UI.raw(`<input type="password" class="input" data-voice-field="${esc(f.key)}" data-voice-kind="secret" aria-label="${esc(f.label)}" autocomplete="off" spellcheck="false" placeholder="${f.set ? "•••••• (set; paste to replace)" : esc(f.placeholder || "")}">`) })
      : row({ label: f.label, hint: f.hint || "", data, control: UI.raw(`<input type="text" class="input" data-voice-field="${esc(f.key)}" data-voice-kind="text" aria-label="${esc(f.label)}" spellcheck="false" value="${esc(f.value || "")}" placeholder="${esc(f.placeholder || "")}">`) });
  }
  function consentTitle(feature, recipient, reader) {
    if (feature === "reading" && reader === "system") return "The replies are read aloud by this computer's own voices";
    const what = feature === "voice" ? "Your voice goes to" : feature === "reading" ? "The replies you have read aloud go to" : "What the rooms remember goes to";
    return `${what} ${recipient}`;
  }
  const voiceRecipient = (provider) => (provider.id === "compatible" ? "your own server" : provider.label);
  function consentGateHtml({ feature, reader, icon, recipient, given, lapsed, words, view }) {
    const title = consentTitle(feature, recipient, reader);
    if (given) {
      const missing = view && !view.ready && view.reason ? `Not on yet: ${view.reason}.` : "";
      const said = title.charAt(0).toLowerCase() + title.slice(1);
      return UI.html("consent-gate", { state: "given", title: `${missing ? "You agreed" : "On"}: ${said}`, missing, withdraw: { act: "consent-withdraw", data: { feature } } });
    }
    return UI.html("consent-gate", { state: lapsed ? "lapsed" : "ask", icon, title, words, answers: [{ label: lapsed ? "I agree" : "I agree, turn it on", kind: "primary", act: "consent-agree", data: { feature, reader: reader || "", words } }] });
  }
  let consentOpened = null;
  function consentLockHtml(body, { locked, feature, note = "Agree above to set it up" }) {
    return UI.html("consent-lock", { locked, note, body, opened: !locked && consentOpened === feature });
  }
  function waitingOn(view, piece) {
    return view && !view.ready && view.missing === piece ? { attention: "" } : undefined;
  }
  function bindFeatureConsent(section) {
    section.addEventListener("click", async (e) => {
      const button = e.target.closest('[data-act="consent-agree"], [data-act="consent-withdraw"]');
      if (!button) return;
      e.preventDefault();
      const { feature, reader, words } = button.dataset;
      const withdraw = button.dataset.act === "consent-withdraw";
      button.disabled = true;
      try {
        const res = await post("/api/consent", withdraw ? { feature, withdraw: true } : { feature, words, ...(reader ? { reader } : {}) });
        state.voice = res.voice;
        state.memoryProvider = res.memoryProvider;
        consentOpened = withdraw ? null : feature;
        featuresChanged();
      } catch (error) {
        showError(error);
        void refreshFeatureViews();
      } finally {
        consentOpened = null;
        button.disabled = false;
      }
    });
  }
  function readingSectionHtml() {
    const v = state.voice;
    if (!v) return '<p class="hint">The voice\'s settings come with the room; reload the window if they do not.</p>';
    const r = v.reading || { reader: "off", voice: "", auto: "off", ready: false };
    const chosen = (v.providers || []).find((p) => p.id === v.provider) || null;
    const row = (props) => UI.html("setting", props);
    const readers = [["off", "Nobody"], ["system", "This computer's voices"], ["provider", chosen ? chosen.label : "The provider above"]];
    const options = readers.map(([id, label]) => `<option value="${id}"${r.reader === id ? " selected" : ""}${id === "provider" && !chosen ? " disabled" : ""}>${esc(label)}</option>`).join("");
    const hint = r.reader === "system" ? "Free, and the words stay on this computer: the voices its system has."
      : r.reader === "provider" ? `The provider of the card above reads, with its address and key: ${chosen ? chosen.label : "choose one there first"}.`
      : "This computer's voices are free and keep the words here; the provider above usually sounds more natural.";
    const voices = VIBEROOM_READER.localVoices(window.speechSynthesis);
    const rows = [
      row({ label: "Who reads", for: "sp-read-reader", hint, control: UI.raw(`<select class="select" id="sp-read-reader" data-drawn-for="${esc(r.reader)}" data-provider="${esc(chosen ? chosen.id : "off")}">${options}</select>`) }),
    ];
    if (r.reader === "system") {
      const lang = String(v.language || navigator.language || "").slice(0, 2).toLowerCase();
      const spoken = !lang || voices.some((voice) => String(voice.lang).toLowerCase().startsWith(lang));
      const hint = !voices.length ? "This computer offers the window no voice of its own: add one in the system's language settings, or let the provider read."
        : !spoken ? `None of this computer's voices speaks ${new Intl.DisplayNames(["en"], { type: "language" }).of(lang) || lang}: add one in the system's language settings, or let the provider read.`
        : "The voices of this computer's system; the system's language settings add more.";
      rows.push(row({ label: "Voice", for: "sp-read-voice", hint, control: UI.raw(selectHtml("sp-read-voice", [["", "The first in your language"], ...voices.map((voice) => [voice.name, `${voice.name} · ${voice.lang}`])], r.voice || "")) }));
    }
    const after = [];
    if (r.reader === "provider" && chosen) after.push(...chosen.fields.filter((f) => f.use === "reading").map((f) => voiceFieldHtml(f, waitingOn(r, f.key))));
    if (r.reader !== "off") {
      after.push(row({ label: "Read new replies", for: "sp-read-auto", hint: "In the room open in this window, while the window is on the screen, each after the one before; never while the microphone listens.", control: UI.raw(selectHtml("sp-read-auto", [["off", "Only when I press the speaker"], ["to-me", "The replies to me"], ["every", "Every reply"]], r.auto || "off")) }));
      if (r.ready) after.push(row({ label: "Hear it", hint: "Reads the last reply of the room open in this window, or a sentence when it has none.", control: UI.raw(UI.html("button", { label: "Read aloud", icon: "speaker", kind: "secondary", size: "sm", act: "read-try" })) }));
    }
    if (r.reader === "provider" && chosen) {
      rows.push(consentGateHtml({ feature: "reading", reader: "provider", icon: "speaker", recipient: voiceRecipient(chosen), given: !!chosen.readingConsent, lapsed: !!chosen.readingConsentLapsed, words: chosen.readingConsentText, view: r }));
      rows.push(consentLockHtml(after.join(""), { locked: !chosen.readingConsent, feature: "reading" }));
    } else rows.push(...after);
    return rows.join("");
  }
  function voiceSectionHtml() {
    const v = state.voice;
    if (!v) return '<p class="hint">The voice\'s settings come with the room; reload the window if they do not.</p>';
    const chosen = (v.providers || []).find((p) => p.id === v.provider) || null;
    const row = (props) => UI.html("setting", props);
    const options = [`<option value="off"${!chosen ? " selected" : ""}>Off</option>`]
      .concat((v.providers || []).map((p) => `<option value="${esc(p.id)}"${v.provider === p.id ? " selected" : ""}>${esc(p.label)}</option>`)).join("");
    const rest = chosen ? `${chosen.fields.filter((f) => f.use !== "reading").map((f) => voiceFieldHtml(f, waitingOn(v, f.key))).join("")}
        ${row({ label: "The language you speak", for: "sp-voice-language", hint: "Named, it helps the model; by its sound, the model hears it itself.", control: UI.raw(selectHtml("sp-voice-language", VOICE_LANGUAGES, v.language || "")) })}` : "";
    const gate = chosen ? consentGateHtml({ feature: "voice", icon: "mic", recipient: voiceRecipient(chosen), given: !!chosen.consent, lapsed: !!chosen.consentLapsed, words: chosen.consentText, view: v }) : "";
    return `<div class="page-hero">
        <b class="page-hero-title">Say it instead of typing it</b>
        <div class="hero-notes">
          <div class="hero-note is-what"><div class="hero-note-head">${ic("mic")}The microphone in the message field</div><p>Press it, speak, and press it again: your words land where the caret is, and you read them over before you send them. Press Send while it records, and it goes as a voice message. Escape lets a recording go.</p><p>Your vibemates get plain text, as when you type.</p></div>
          <div class="hero-note is-how"><div class="hero-note-head">${ic("lock")}Where your voice goes</div><p>A recording goes to the provider chosen below, which turns it into words: dictated, the words go into your field; sent as a voice message, the sound stays in the room with its words, as a message does.</p><p>A vibemate may ask for the words of a sound in the room too. A server on this computer keeps your voice here. In any room, <code>/set-up-voice</code> has a vibemate walk you through it.</p></div>
        </div>
      </div>
      ${row({ label: "Provider", for: "sp-voice-provider", hint: chosen ? chosen.blurb : "Who turns your voice into words: OpenAI, the most exact; Groq, with a free plan; or a server of your own.", control: UI.raw(`<select class="select" id="sp-voice-provider" data-drawn-for="${esc(chosen ? chosen.id : "off")}">${options}</select>`) })}
      ${gate}
      ${chosen ? consentLockHtml(rest, { locked: !chosen.consent, feature: "voice" }) : ""}`;
  }

  function bindVoiceControls() {
    const section = $("#sp-voice");
    if (!section) return;
    bindFeatureConsent(section);
    for (const type of ["input", "change"]) section.addEventListener(type, (e) => e.stopPropagation());
    bindSave(section, async () => {
      const q = (sel) => section.querySelector(sel);
      const patch = { provider: q("#sp-voice-provider").value };
      if (patch.provider === q("#sp-voice-provider").dataset.drawnFor) {
        const settings = {};
        let any = false;
        section.querySelectorAll("[data-voice-field]").forEach((input) => {
          const value = input.value.trim();
          if (input.dataset.voiceKind === "secret" && !value) return;
          settings[input.dataset.voiceField] = value;
          any = true;
        });
        if (any) patch.settings = settings;
        if (q("#sp-voice-language")) patch.language = q("#sp-voice-language").value;
      }
      const res = await post("/api/voice", patch);
      state.voice = res.view;
      featuresChanged();
    });
  }

  function bindReadingControls() {
    const section = $("#sp-voice-reading");
    if (!section) return;
    bindFeatureConsent(section);
    for (const type of ["input", "change"]) section.addEventListener(type, (e) => e.stopPropagation());
    bindSave(section, async () => {
      const q = (sel) => section.querySelector(sel);
      const select = q("#sp-read-reader");
      const reading = { reader: select.value };
      const patch = { reading };
      if (select.value === select.dataset.drawnFor) {
        if (q("#sp-read-voice")) reading.voice = q("#sp-read-voice").value;
        if (q("#sp-read-auto")) reading.auto = q("#sp-read-auto").value;
        if (select.dataset.provider === (state.voice?.provider || "off")) {
          const settings = {};
          let any = false;
          section.querySelectorAll("[data-voice-field]").forEach((input) => {
            const value = input.value.trim();
            if (input.dataset.voiceKind === "secret" && !value) return;
            settings[input.dataset.voiceField] = value;
            any = true;
          });
          if (any) patch.settings = settings;
        }
      }
      const res = await post("/api/voice", patch);
      state.voice = res.view;
      featuresChanged();
    });
    const tryIt = section.querySelector('[data-act="read-try"]');
    if (tryIt) tryIt.addEventListener("click", () => {
      const last = [...(currentRoom()?.messages || [])].reverse().find((m) => m.kind === "chat" && m.from !== "human" && !m.streaming && !m.bodyMissing && VIBEROOM_READER.speakable(m.text));
      readAloud(last || { id: "settings-sample", text: "This is how your vibemates sound when their replies are read aloud." });
    });
  }

  function memorySectionHtml() {
    const m = state.memoryProvider;
    if (!m) return '<p class="hint" id="sp-mem-loading">Loading…</p>';
    const v = m.view, st = m.status || {};
    const chosen = (v.providers || []).find((p) => p.id === v.provider) || null;
    const behind = (st.rooms || []).reduce((sum, r) => sum + (r.behind || 0), 0);
    const spent = st.usage && chosen ? ` This month: ${st.usage.credits}${st.usage.cap ? ` of ${st.usage.cap}` : ""} ${chosen.costUnit}.` : "";
    const status = (st.paused
      ? `Paused: ${st.paused.reason} The queue waits; nothing is lost.`
      : !chosen ? "Off. Nothing leaves this computer."
      : !chosen.consent ? "Waiting for your consent below before anything is sent."
      : `On. ${st.pendingOps ? `${st.pendingOps} queued operation${st.pendingOps === 1 ? "" : "s"}, ` : ""}${behind ? `${behind} message${behind === 1 ? "" : "s"} not yet distilled.` : "caught up."}`) + spent;
    const row = (props) => UI.html("setting", props);
    const options = [`<option value="off"${!chosen ? " selected" : ""}>Off</option>`]
      .concat((v.providers || []).map((p) => `<option value="${esc(p.id)}"${v.provider === p.id ? " selected" : ""}>${esc(p.label)}</option>`)).join("");
    const fieldHtml = (f) => {
      if (f.kind === "secret") return row({ label: f.label, hint: f.hint || "", lead: UI.raw(noPeekHtml()), geek: KEY_GEEK, data: waitingOn(v, f.key), control: UI.raw(`<input type="password" class="input" data-mem-field="${esc(f.key)}" data-mem-kind="secret" aria-label="${esc(f.label)}" autocomplete="off" spellcheck="false" placeholder="${f.set ? "•••••• (set; paste to replace)" : esc(f.placeholder || "")}">`) });
      if (f.kind === "number") return row({ label: f.label, for: `sp-mem-${f.key}`, hint: f.hint || "", control: UI.raw(UI.html("number-field", { id: `sp-mem-${f.key}`, value: String(f.value ?? 0), min: f.min ?? 0, max: f.max ?? 1000000000, ...(f.step !== undefined ? { step: f.step } : {}), data: { memField: f.key, memKind: "number" } })) });
      return row({ label: f.label, hint: f.hint || "", control: UI.raw(`<input type="text" class="input" data-mem-field="${esc(f.key)}" data-mem-kind="text" aria-label="${esc(f.label)}" spellcheck="false" value="${esc(String(f.value ?? ""))}" placeholder="${esc(f.placeholder || "")}">`) });
    };
    const providerRows = chosen ? chosen.fields.map(fieldHtml).join("") : "";
    const llm = v.filter.mode === "llm";
    const rest = `${providerRows}
      ${row({ label: "The sieve", for: "sp-mem-filter", geek: "What of the conversation reaches the provider. The model mode reads every message — the agents' reports included — and forwards a condensed episode of the salient ones, in the room's language; it needs the endpoint below. Everything sends each message whole (long ones cut at a line boundary): the fullest graph, the highest spend, watched by the monthly ceiling. Human-only stays within free plans but the graph misses the system's own story. The model mode also writes the questions each turn's search asks; without a model, the message is cut at its sentences.", control: UI.raw(`<select class="select" id="sp-mem-filter"><option value="llm"${llm ? " selected" : ""}>A small model keeps what matters (recommended)</option><option value="off"${v.filter.mode === "off" ? " selected" : ""}>Everything, mechanically capped (default)</option><option value="heuristic"${v.filter.mode === "heuristic" ? " selected" : ""}>Only the human's messages, whole</option></select>`) })}
      ${row({ label: "Sieve endpoint", for: "sp-mem-f-url", hidden: !llm, data: { memLlm: true, ...waitingOn(v, "sieve") }, hint: "Any OpenAI-compatible chat-completions endpoint: OpenAI, a local Ollama (http://localhost:11434/v1), Groq, OpenRouter…", control: UI.raw(`<input type="text" class="input" id="sp-mem-f-url" spellcheck="false" value="${esc(v.filter.baseUrl || "")}" placeholder="https://api.openai.com/v1">`) })}
      ${row({ label: "Sieve model", for: "sp-mem-f-model", hidden: !llm, data: { memLlm: true, ...waitingOn(v, "sieve") }, control: UI.raw(`<input type="text" class="input" id="sp-mem-f-model" spellcheck="false" value="${esc(v.filter.model || "")}" placeholder="a small, cheap model">`) })}
      ${row({ label: "Sieve API key", for: "sp-mem-f-key", hidden: !llm, data: { memLlm: true }, lead: UI.raw(noPeekHtml()), geek: KEY_GEEK, control: UI.raw(`<input type="password" class="input" id="sp-mem-f-key" autocomplete="off" spellcheck="false" placeholder="${v.filter.keySet ? "•••••• (set; paste to replace)" : "the endpoint's key; empty for a local one"}">`) })}
      ${row({ label: "Search form", for: "sp-mem-f-form", hidden: !llm, data: { memLlm: true }, hint: "What the sieve's model writes to search the memory for your message.", geek: "Each form was judged blind on 46 messages. Per message, query decomposition found 5.8 useful facts against 9.0 unrelated, your words by topic 4.6 against 9.3, HyDE 5.5 against 11.5, its extra noise mostly from other rooms; so query decomposition is the default. Only the model writes these: without it, the message is cut at its sentences.", control: UI.raw(selectHtml("sp-mem-f-form", Object.entries(SEARCH_FORMS), v.filter.form || "question")) })}
      ${row({ label: "Most characters of recalled facts in a turn", for: "sp-mem-block", hint: "The facts found for a turn go into each vibemate's prompt, the strongest first, until they reach this many characters. The default, 4 000, is about twenty facts.", geek: "How a turn's block is made. Before a vibemate answers your message, the sieve's model reads it and writes up to three short searches, one per topic, in the search form above. Each asks this room's graph, and the other rooms' when the room searches them in each turn's memory block (Search the other rooms, in its settings). The provider scores every fact from 0 to 1 against its search and leaves out those under its relevance threshold (0.01 by default, with the provider's settings above); the rest go in, the strongest first, until this size. Beyond about 4 000 characters mostly weaker facts come in. The Prompt view shows each turn's searches and facts.", control: UI.raw(UI.html("number-field", { id: "sp-mem-block", value: String(v.blockChars ?? 4000), min: 1000, max: 8000, step: 500 })) })}`;
    return `<div class="page-hero">
        <div class="mem-scene scene-art" role="img" aria-label="A vibemate at its desk, writing down what the room said">${window.Icons.scene("memory-scribe")}</div>
        <b class="page-hero-title">What is long-term memory</b>
        <div class="hero-notes">
          <div class="hero-note is-what"><div class="hero-note-head">${ic("journal")}Rooms that remember</div><p>Rooms that opt in feed one long-term memory: what was said becomes facts your vibemates can recall in later conversations, each with the span it held true.</p><p>Each room has its own switch: "This room remembers", in the room's settings.</p></div>
          <div class="hero-note is-how"><div class="hero-note-head">${ic("bot")}Set it up together</div><p>It is a rather geeky setup: a graph provider, a sieve, two API keys. <b>You do not have to do it alone</b> — in any room, write <code>/set-up-long-term-memory</code> and a vibemate walks you through it step by step. Keys go on write-only cards it never sees.</p><p>Feeling geeky yourself? Everything is below.</p></div>
        </div>
      </div>
      ${row({ label: "Provider", for: "sp-mem-provider", hint: chosen ? chosen.blurb : "The master switch of this page: choose a provider to unlock the rest.", status, statusId: "sp-mem-status", geek: "Every provider hides behind the same contract; switching later keeps the rooms' switches and the local bookkeeping. What each one can and cannot do (forget one message, keep fact validity spans) is declared, not assumed.", control: UI.raw(`<select class="select" id="sp-mem-provider">${options}</select>`) })}
      ${chosen ? consentGateHtml({ feature: "memory", icon: "graph", recipient: chosen.label, given: !!chosen.consent, lapsed: !!chosen.consentLapsed, words: chosen.consentText, view: v }) : ""}
      ${consentLockHtml(rest, { locked: !chosen || !chosen.consent, feature: "memory", note: chosen ? "Agree above to set it up" : "Choose a provider above to set it up" })}`;
  }

  async function refreshFeatureViews() {
    try {
      const [voice, memory] = await Promise.all([get("/api/voice"), get("/api/memory-provider")]);
      state.voice = voice.view;
      state.memoryProvider = memory;
      featuresChanged();
    } catch {
    }
  }
  let memoryProviderLoad = null;
  function loadMemoryProvider() {
    if (state.memoryProvider || memoryProviderLoad) return;
    memoryProviderLoad = get("/api/memory-provider").then((m) => {
      state.memoryProvider = m;
      featuresChanged();
    }).catch(() => {}).finally(() => { memoryProviderLoad = null; });
  }
  function featuresChanged({ page = true } = {}) {
    voiceControl.redraw();
    markSettingsRail();
    if (page && state.view === "settings") renderSettingsPage();
  }

  function bindMemoryControls() {
    const section = $("#sp-memory");
    if (!section) return;
    bindFeatureConsent(section);
    for (const type of ["input", "change"]) section.addEventListener(type, (e) => { if (!e.target.closest?.("[data-own-save]")) e.stopPropagation(); });
    if (!state.memoryProvider) {
      loadMemoryProvider();
      return;
    }
    bindSave(section, async () => {
      const q = (sel) => section.querySelector(sel);
      const patch = {
        provider: q("#sp-mem-provider").value,
        filterMode: q("#sp-mem-filter").value,
      };
      const settings = {};
      let any = false;
      section.querySelectorAll("[data-mem-field]").forEach((input) => {
        const key = input.dataset.memField, kind = input.dataset.memKind;
        if (kind === "secret") { if (input.value.trim()) { settings[key] = input.value.trim(); any = true; } }
        else if (kind === "number") { settings[key] = Number(input.value); any = true; }
        else { settings[key] = input.value.trim(); any = true; }
      });
      if (any && patch.provider !== "off") patch.settings = settings;
      if (q("#sp-mem-f-url")) patch.filterBaseUrl = q("#sp-mem-f-url").value.trim();
      if (q("#sp-mem-f-model")) patch.filterModel = q("#sp-mem-f-model").value.trim();
      if (q("#sp-mem-f-form")) patch.filterForm = q("#sp-mem-f-form").value;
      if (q("#sp-mem-f-key") && q("#sp-mem-f-key").value.trim()) patch.filterApiKey = q("#sp-mem-f-key").value.trim();
      if (q("#sp-mem-block")) patch.blockChars = Number(q("#sp-mem-block").value);
      const res = await post("/api/memory-provider", patch);
      state.memoryProvider = { view: res.view, status: res.status };
      featuresChanged();
      if (res.verified && !res.verified.ok) showError(new Error(res.verified.reason || "The provider's key could not be verified."));
    });
    const filterSel = section.querySelector("#sp-mem-filter");
    if (filterSel) filterSel.addEventListener("change", () => { for (const r of section.querySelectorAll("[data-mem-llm]")) r.hidden = filterSel.value !== "llm"; });
  }

  function dropPairLink(cancelAtHub) {
    const link = state.pairLink;
    state.pairLink = null;
    if (pairLinkTimer) { clearTimeout(pairLinkTimer); pairLinkTimer = null; }
    if (cancelAtHub && link && !link.copied && link.expiresAt > Date.now()) post("/api/channels/pair-link/cancel", {}).catch(() => {});
  }
  let pairLinkTimer = null;

  function bindChannelControls() {
    const section = $("#sp-channels");
    if (!section) return;
    for (const type of ["input", "change"]) section.addEventListener(type, (e) => e.stopPropagation());
    const tg = (state.channels && state.channels.telegram) || null;
    bindSave(section, async () => {
      const q = (sel) => section.querySelector(sel);
      const patch = {};
      if (q("#sp-tg-enabled") && q("#sp-tg-enabled").checked !== !!(tg && tg.enabled)) patch.enabled = q("#sp-tg-enabled").checked;
      if (q("#sp-tg-name") && q("#sp-tg-name").value.trim() !== ((tg && tg.wantedName) || "")) patch.name = q("#sp-tg-name").value.trim();
      if (q("#sp-tg-approvals")) patch.phoneApprovals = q("#sp-tg-approvals").checked;
      if (q("#sp-tg-roots")) patch.fileRoots = [...section.querySelectorAll("#sp-tg-roots [data-root]")].map((row) => ({ path: row.querySelector(".roots-path").value.trim(), subfolders: row.querySelector(".roots-deep").checked })).filter((r) => r.path);
      const res = await post("/api/channels/telegram", patch);
      state.channels = res.channels || state.channels;
      if (state.view === "settings") renderSettingsPage();
    });
    const rootsList = section.querySelector("#sp-tg-roots");
    const newRoot = section.querySelector("#sp-tg-roots-new");
    const newDeep = section.querySelector("#sp-tg-roots-new-deep");
    if (newRoot) for (const type of ["input", "change"]) newRoot.addEventListener(type, (e) => { channelsKeep.newRoot = newRoot.value; e.stopPropagation(); });
    if (newDeep) for (const type of ["input", "change"]) newDeep.addEventListener(type, (e) => { channelsKeep.newDeep = newDeep.checked; e.stopPropagation(); });
    const addRoot = (dir) => {
      const path = (dir || "").trim();
      if (!path || !rootsList) return;
      if ([...rootsList.querySelectorAll("[data-root] .roots-path")].some((input) => input.value.trim().toLowerCase() === path.toLowerCase())) { newRoot.value = ""; channelsKeep.newRoot = ""; return; }
      const row = document.createElement("div");
      row.className = "roots-row";
      row.dataset.root = "";
      row.innerHTML = `<input type="text" class="roots-path" spellcheck="false" aria-label="Folder"><label class="check-row"><input type="checkbox" class="roots-deep"> and its subfolders</label>${UI.html("button", { label: "Remove", size: "xs", kind: "secondary", act: "roots-remove" })}`;
      row.querySelector(".roots-path").value = path;
      row.querySelector(".roots-deep").checked = !newDeep || newDeep.checked;
      rootsList.insertBefore(row, newRoot.parentElement);
      newRoot.value = "";
      channelsKeep.newRoot = "";
      channelsKeep.newDeep = true;
      rootsList.dispatchEvent(new Event("change", { bubbles: true }));
    };
    if (newRoot) newRoot.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); addRoot(newRoot.value); }
    });
    const browse = section.querySelector("#sp-tg-roots-browse");
    if (browse) browse.addEventListener("click", () => openFolderPicker(newRoot.value.trim() || "", (dir) => addRoot(dir)));
    const setEnabled = async (enabled) => {
      try {
        const res = await post("/api/channels/telegram", { enabled });
        state.channels = res.channels || state.channels;
        if (state.view === "settings") renderSettingsPage();
      } catch (error) { showError(error); }
    };
    section.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn || !section.contains(btn)) return;
      e.preventDefault();
      switch (btn.dataset.act) {
        case "ch-setup": return openSetupWizard();
        case "ch-continue": return openSetupWizard("next");
        case "ch-pair": return openSetupWizard("pair");
        case "ch-guide": openGuide(); return;
        case "ch-on": return setEnabled(true);
        case "ch-off": return setEnabled(false);
        case "ch-replace-key":
          try { await post("/api/secrets", { purpose: "telegram-token" }); } catch (error) { showError(error); }
          return;
        case "ch-rename": {
          channelsKeep.rename = !channelsKeep.rename;
          if (state.view === "settings") renderSettingsPage();
          const name = $("#sp-tg-name");
          if (name) name.focus();
          return;
        }
        case "roots-add": return addRoot(newRoot.value);
        case "roots-remove":
          btn.closest("[data-root]").remove();
          rootsList.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        default:
      }
    });
    section.querySelectorAll("[data-unpair]").forEach((btn) => {
      btn.onclick = async () => {
        const senderId = btn.dataset.unpair;
        const choice = await choiceDialog("From now on that Telegram account is a stranger to the bot, on every device signed in to it: it can neither write to the rooms nor read their replies. What it already asked for keeps running unless you stop it too.", { title: "Unpair this account?", okLabel: "Unpair", altLabel: "Unpair and stop its turns" });
        if (choice === "cancel") return;
        try {
          const res = await post("/api/channels/unpair", { senderId, stopTurns: choice === "alt" });
          state.channels = res.channels || state.channels;
          if (state.view === "settings") renderSettingsPage();
        } catch (error) { showError(error); }
      };
    });
  }

  function bindDiagnosticLogControls() {
    const section = $("#sp-transcripts"), label = section.querySelector("#sp-log-size");
    const check = section.querySelector("#sp-log-check"), clear = section.querySelector("#sp-log-clear");
    const page = section.closest('[data-ui="settings-category"]');
    const copy = section.querySelector("#sp-connection-copy");
    copy.onclick = async () => {
      if (busy) return;
      setBusy(true);
      try {
        const report = await get("/api/diagnostic-requests");
        if (!section.isConnected) return;
        const text = JSON.stringify(report, null, 2);
        try { await navigator.clipboard.writeText(text); }
        catch {
          if (!section.isConnected) return;
          const closed = choiceDialog("Automatic copying is unavailable. Select and copy the details below.", {
            title: "Tool connection details", okLabel: "Close", hideCancel: true,
            extraHtml: `<textarea class="textarea" id="diagnostic-copy-text" rows="10" readonly spellcheck="false" aria-label="Tool connection details">${esc(text)}</textarea>`,
          });
          const field = $("#diagnostic-copy-text");
          field?.focus(); field?.select();
          await closed;
          return;
        }
        copy.querySelector(".label").textContent = "Copied";
      } catch (error) { if (section.isConnected) showError(error); }
      finally { if (section.isConnected) setBusy(false); }
    };
    let known = false, busy = false;
    const describe = stats => {
      const size = stats.bytes >= 1024 * 1024 ? `${(stats.bytes / (1024 * 1024)).toFixed(1)} MB`
        : stats.bytes >= 1024 ? `${(stats.bytes / 1024).toFixed(1)} KB` : `${stats.bytes} B`;
      return `${stats.files} file${stats.files === 1 ? "" : "s"} · ${size}`;
    };
    const show = stats => {
      label.textContent = `Saved diagnostic details: ${describe(stats)}.` +
        (stats.skipped || stats.unavailable ? " Some locations could not be checked or were left alone." : "");
    };
    const setBusy = value => { busy = value; check.disabled = value; clear.disabled = value || !known; copy.disabled = value; };
    const refresh = async () => {
      if (busy || !section.isConnected) return;
      setBusy(true);
      try { const stats = await get("/api/diagnostic-logs"); if (section.isConnected) { known = true; show(stats); } }
      catch { if (section.isConnected) label.textContent = "Could not check saved diagnostic details. Try again."; }
      finally { if (section.isConnected) setBusy(false); }
    };
    check.onclick = refresh;
    page.addEventListener(SETTINGS_PAGE_SHOWN, () => { if (!known) void refresh(); });
    if (!page.hidden) void refresh();
    clear.onclick = async () => {
      if (busy || !known) return;
      setBusy(true);
      try {
        const accepted = await confirmDialog("This clears saved and buffered diagnostic details from all rooms. Conversations and shared files stay saved. Recording can create new details afterwards.",
          { title: "Clear diagnostic details?", okLabel: "Clear details" });
        if (!accepted || !section.isConnected) return;
        label.textContent = "Clearing diagnostic details…";
        const result = await post("/api/diagnostic-logs/clear", { confirm: true });
        if (!section.isConnected) return;
        const partial = result.failedFiles || result.skipped || result.unavailable || result.remaining.skipped || result.remaining.unavailable;
        label.textContent = `Cleared ${result.removedFiles} file${result.removedFiles === 1 ? "" : "s"}. Remaining: ${describe(result.remaining)}.` +
          (partial ? " Some details could not be cleared or were left alone." : " New details may appear if recording is on.");
      } catch (error) {
        if (section.isConnected) { label.textContent = "Could not clear all diagnostic details. Check the size and try again."; showError(error); }
      } finally { if (section.isConnected) setBusy(false); }
    };
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
    const builtIn = !!editing && editing.author === "viberoom";
    const editor = ed
      ? `<div class="skill-editor">
          ${settingsCard("sk-editor", editing ? `Edit /${ed.name}` : "New skill", [
            settingRow({ label: "Name", for: "sk-name", hint: "It is also the /command.", control: UI.raw(`<input type="text" class="input" id="sk-name" maxlength="32" value="${esc(ed.name || "")}"${ed.name ? " disabled" : ""} placeholder="letters, digits, _ or -">`) }),
            settingRow({ label: "Description", for: "sk-desc", hint: "What it does and when to use it; this is what triggers it.", stacked: true, control: UI.raw(`<textarea class="textarea" id="sk-desc" rows="2" maxlength="300">${esc(ed.description || "")}</textarea>`) }),
            settingRow({ label: "Argument hint", for: "sk-hint", hint: "Optional; the / menu shows it after the name.", control: UI.raw(`<input type="text" class="input" id="sk-hint" maxlength="80" value="${esc(ed.argumentHint || "")}" placeholder="e.g. [PR number]">`) }),
            settingRow({ label: "Instructions", for: "sk-body", hint: UI.raw("<code>$ARGUMENTS</code> is what follows /name."), stacked: true, control: UI.raw(`<textarea class="textarea" id="sk-body" rows="12" maxlength="20000">${esc(ed.body || "")}</textarea>`) }),
            settingRow({ label: "Human can invoke it with /name", for: "sk-user", kind: "switch", checked: ed.userInvocable !== false }),
            settingRow({ label: "Vibemates may load it themselves", for: "sk-agent", kind: "switch", checked: ed.agentInvocable !== false }),
          ].join(""))}
          <p class="error" id="sk-error" hidden></p>
          ${builtIn ? `<p class="field-note">${ic("lock")} Built-in skill: it comes with viberoom, the room keeps it up to date, and it is read-only. Copy the text into a new skill to make your own version.</p>` : ""}
          <div class="row-btns">${editing && !builtIn ? UI.html("button", { label: "Delete", kind: "danger", size: "sm", id: "sk-delete" }) : ""}<span class="saved" id="sk-saved"></span>${UI.html("button", { label: builtIn ? "Close" : "Cancel", kind: "ghost", size: "sm", id: "sk-cancel" })}${builtIn ? "" : UI.html("button", { label: "Save skill", kind: "primary", size: "sm", id: "sk-save" })}</div>
        </div>`
      : "";
    const about = ed
      ? ""
      : `<p class="hint sk-about">${geekTip(`A skill is a folder <code>skills/&lt;name&gt;/SKILL.md</code> in the room's data folder: a description (what triggers it) and the instructions. Attach skills to vibemates in their panels; invoke one with <code>/name</code> in the composer. Vibemates with the room's tools can create skills too (they load <code>skill-writer</code> first).`)}</p>`;
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
      if (builtIn) $(".skill-editor").querySelectorAll("input, textarea").forEach((el) => (el.disabled = true));
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


  const CONNECTION_GROUPS = [["everyday", "For everyday life"], ["work", "For work"], ["developers", "For developers"], ["creative", "For creative work"], ["business", "For business"]];
  function connectionMark(c, size) {
    return UI.html("logo-tile", c.mark ? { icon: c.mark.url, brand: c.mark.hex, title: c.name, size } : { letter: c.name[0], title: c.name, size });
  }
  function connectionState(c) {
    if (c.state === "connected") return { label: "connected", tone: "ready" };
    if (c.state === "signing-in") return { label: c.command ? "starting…" : "signing in…", tone: "thinking" };
    if (c.state === "reconnect") return { label: "sign in again", tone: "attention" };
    if (c.state === "changed") return { label: "tools changed", tone: "attention" };
    return null;
  }
  function connectionsHeroHtml() {
    return `<div class="page-hero cn-hero">
        <div class="cn-scene scene-art" role="img" aria-label="A vibemate plugs viberoom into a board of systems, takes in what they hold, and asks before it writes">${window.Icons.scene("connect-plug")}</div>
        <b class="page-hero-title">What are connections</b>
        <div class="hero-notes">
          <div class="hero-note is-what"><div class="hero-note-head">${ic("plug")}Your tools, in every room</div><p>Connect Jira, Notion, Linear and the others once, and your vibemates can look things up there in any room: an issue, a page, a task.</p><p>A room you would rather keep out has its own switch, under each connection.</p></div>
          <div class="hero-note is-how"><div class="hero-note-head">${ic("hand")}You stay in charge</div><p>You sign in at the system itself, in your browser; no vibemate ever sees your password or the access. Reading runs at once. <b>Before anything is written, you see the exact request and say yes</b>, here or on your phone.</p><p>Or just ask a vibemate: "connect Notion". The card comes to you.</p></div>
        </div>
      </div>`;
  }

  function connectionRoomsSummary(c, rooms) {
    const off = rooms.filter((room) => (c.offInRooms || []).includes(room.id)).length;
    const all = rooms.length === 1 ? "the one room" : `all ${rooms.length} rooms`;
    if (!off) return `On in ${all}`;
    if (off === rooms.length) return `Off in ${all}`;
    return `On in ${rooms.length - off} of ${rooms.length} rooms, off in ${off}`;
  }

  function renderConnectionsPage() {
    const all = state.connections || [];
    const joined = all.filter((c) => c.state !== "not-connected");
    const rooms = roomsByName();
    const btn = (label, act, id, kind = "secondary") => UI.html("button", { label, kind, size: "sm", data: { cnAct: act, cnId: id } });
    const lead = (c) => UI.raw(connectionMark(c));
    const badge = (c) => { const s = connectionState(c); return s ? UI.html("badge", { label: s.label, tone: s.tone, dot: c.state === "signing-in" }) : ""; };
    const toolsLine = (c) => {
      const tools = c.tools || [];
      const reads = tools.filter((t) => t.rule === "read").length;
      if (c.group === "own") return `${tools.length} tool${tools.length === 1 ? "" : "s"}, and every one asks you first`;
      return `${tools.length} tool${tools.length === 1 ? "" : "s"}: ${reads} read at once, ${tools.length - reads} write and ask you first`;
    };
    const about = (c) => c.group !== "own" ? c.blurb : c.command ? `Your own, on this computer: ${c.command}` : `Your own server at ${c.url}`;
    const leave = (c) => ((c.env || []).length ? btn("Keys…", "keys", c.id, "ghost") : "") + (c.group === "own" ? btn("Remove", "remove", c.id, "ghost") : btn("Disconnect", "disconnect", c.id, "ghost"));
    const tile = (c) => {
      const s_ = connectionState(c);
      const sub = c.state === "signing-in" ? (c.command ? "starting…" : "signing in…") : `${(c.tools || []).length} tool${(c.tools || []).length === 1 ? "" : "s"}${c.group === "own" ? (c.command ? " · on this computer" : " · your own") : ""}`;
      return `<button type="button" class="cn-tile" data-cn-act="open" data-cn-id="${esc(c.id)}">${connectionMark(c)}<span class="cn-tile-words"><b>${esc(c.name)}</b><span>${esc(sub)}</span></span>${s_ ? `<span class="cn-tile-state" data-tone="${s_.tone}">${esc(s_.label)}</span>` : ""}</button>`;
    };
    const groupWords = (c) => c.group === "own" ? "Your own" : (CONNECTION_GROUPS.find(([g]) => g === c.group) || [null, c.group])[1];
    const detail = (c) => {
      const controls = c.state === "signing-in" ? btn("Cancel", "cancel", c.id, "ghost")
        : c.state === "reconnect" ? btn("Sign in again", "connect", c.id, "primary") + leave(c)
        : leave(c);
      const head = `<div class="cn-detail-head">${connectionMark(c, "lg")}<div class="cn-detail-words"><h2>${esc(c.name)}</h2><div class="hint">${esc(about(c))}</div></div><div class="cn-detail-acts">${badge(c)}${controls}</div></div>`;
      const cards_ = [];
      cards_.push(settingsCard(`cn-status-${c.id}`, "", settingRow({
        label: c.state === "reconnect" ? "Sign in again" : c.state === "signing-in" ? (c.command ? "Starting" : "Signing in") : "Connected",
        hint: c.state === "reconnect" ? `${c.name} no longer accepts viberoom's access. Nothing runs until you sign in again.`
          : c.state === "signing-in" ? (c.command ? "Starting it on this computer." : "Finish the sign-in in your browser.")
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
        const list = roomListFold(connectionRoomsSummary(c, rooms), "Turn it off for a room, or on again", `data-cn-id="${esc(c.id)}"`,
          rooms.map((room) => roomValueRow(room, `cn-room-${c.id}-${room.id}`, UI.html("switch", { id: `cn-room-${c.id}-${room.id}`, checked: !(c.offInRooms || []).includes(room.id) }))).join(""));
        cards_.push(settingsCard(`cn-rooms-card-${c.id}`, "", settingRow({ label: "Rooms", id: `cn-rooms-${c.id}`, hint: "The rooms whose vibemates may use it.", ...list })));
      }
      const info = [
        settingRow({ label: c.command ? "Command" : "Address", hint: UI.raw(`<code>${esc(c.command || c.address || "")}</code>`) }),
        ...(c.command && (c.env || []).length ? [settingRow({ label: "Keys", hint: `${(c.env || []).join(", ")}, in this computer's vault.`, control: UI.raw(btn("Change…", "keys", c.id)) })] : []),
        settingRow({ label: "Kind", hint: c.command ? "A program on this computer (MCP over stdio)" : c.group === "own" ? "A remote MCP server you added" : `${groupWords(c)}, from viberoom's catalogue` }),
        settingRow({ label: "Access", hint: c.access === "sign-in" ? "Your sign-in, made in your browser; the access is in this computer's vault" : c.access === "keys" ? "The keys you typed, in this computer's vault" : "None needed: it answers without a sign-in" }),
      ];
      cards_.push(settingsCard(`cn-info-${c.id}`, "Information", info.join("")));
      return `<div class="cn-detail">${head}<div class="cn-cards">${cards_.join("")}</div></div>`;
    };
    const ownRows = all.filter((c) => c.group === "own" && c.state === "not-connected").map((c) => settingRow({
      label: c.name, lead: lead(c), hint: c.command || c.url, control: UI.raw(btn("Connect", "connect", c.id, "primary") + btn("Remove", "remove", c.id, "ghost")),
    }));
    const addKind = state.cnAddKind === "local" ? "local" : "remote";
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
          <p class="hint">viberoom has not looked at a server you add, so add only one you trust. Every one of its tools asks you before it runs, reading too. If it asks for a sign-in, that opens in your browser.</p>`}
          <div class="cn-add-acts">${btn("Add and connect", "add", "", "primary")}</div>
        </div>`),
    }));
    const catalogue = settingsCard("cn-group-own", "Your own", ownRows.join("")) + CONNECTION_GROUPS.map(([group, title]) => {
      const rows = all.filter((c) => c.group === group && c.state === "not-connected").map((c) => settingRow({
        label: c.name, lead: lead(c), hint: c.blurb, control: UI.raw(btn("Connect", "connect", c.id, "primary")),
      }));
      return rows.length ? settingsCard(`cn-group-${group}`, title, rows.join("")) : "";
    }).join("");
    const cards = (html) => `<div class="cn-cards">${html}</div>`;
    const open = [...els.pageInner.querySelectorAll('[data-ui="setting"][id]')].filter((row) => row.querySelector(":scope > .fold:not([hidden])")).map((row) => row.id);
    const typed = [...els.pageInner.querySelectorAll(".cn-add input[id]")].map((input) => [input.id, input.value]);
    const shown = state.cnDetail && joined.find((c) => c.id === state.cnDetail);
    if (!shown) state.cnDetail = null;
    els.pageInner.innerHTML = shown ? `
      <div class="page-head cn-back-head">${UI.html("button", { label: "Connections", icon: "back", kind: "ghost", data: { cnAct: "back" } })}</div>
      ${detail(shown)}` : `
      <div class="page-head"><div><h1>Connections</h1></div></div>
      ${connectionsHeroHtml()}
      ${joined.length ? `<h2 class="cn-head">Connected</h2><div class="cn-tiles">${joined.map(tile).join("")}</div>` : ""}
      ${catalogue ? `<h2 class="cn-head">${joined.length ? "More systems" : "Connect a system"}</h2>${cards(catalogue)}` : ""}
      <p class="hint cn-about">${geekTip("viberoom signs in at the system with OAuth in your browser; the access lives in this computer's vault and no vibemate ever sees it. A server of your own on this computer is a program viberoom starts (MCP over stdio), with the keys you typed from the vault; it stops when unused. The vibemates reach every system through the room's own tools (tool_search, tool_call), so every call is one the room can see and stop.")}</p>`;
    for (const id of open) {
      const row = document.getElementById(id);
      const fold = row?.querySelector(":scope > .fold");
      if (!fold) continue;
      fold.hidden = false;
      row.querySelector(':scope [data-act="setting-fold"]')?.setAttribute("aria-expanded", "true");
    }
    for (const [id, value] of typed) { const input = document.getElementById(id); if (input) input.value = value; }
    if (els.pageInner.dataset.cnBound) return;
    els.pageInner.dataset.cnBound = "1";
    els.pageInner.addEventListener("click", async (e) => {
      if (state.view !== "connections") return;
      const kind = e.target.closest("[data-cn-kind]");
      if (kind) {
        e.preventDefault();
        const name = $("#cn-add-name")?.value || "";
        state.cnAddKind = kind.dataset.cnKind;
        renderConnectionsPage();
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
        state.cnDetail = act === "open" ? id : null;
        if (act === "open") state.cnLast = id;
        renderConnectionsPage();
        els.pageView.scrollTop = 0;
        if (e.detail === 0) els.pageInner.querySelector(act === "open" ? '[data-cn-act="back"]' : `[data-cn-act="open"][data-cn-id="${CSS.escape(state.cnLast || "")}"]`)?.focus();
        return;
      }
      if (act === "disconnect" && !(await confirmDialog("viberoom asks the system to revoke its access and forgets it on this computer. The vibemates lose these tools in every room.", { title: "Disconnect?", okLabel: "Disconnect", danger: true }))) return;
      if (act === "remove" && !(await confirmDialog("viberoom disconnects it, asking it to revoke any access it gave, and forgets its address. The vibemates lose its tools in every room.", { title: "Remove this server?", okLabel: "Remove", danger: true }))) return;
      try {
        const res = act !== "add" ? await post(`/api/connections/${encodeURIComponent(id)}/${act}`, {})
          : state.cnAddKind === "local"
            ? await post("/api/connections/own", { name: $("#cn-add-name").value, command: $("#cn-add-command").value, env: $("#cn-add-env").value })
            : await post("/api/connections/own", { name: $("#cn-add-name").value, url: $("#cn-add-url").value });
        if (res.connections) { state.connections = res.connections; renderConnectionsPage(); }
        if ((act === "disconnect" || act === "remove") && res.revoked === false) toast("Disconnected here. The system did not confirm the revocation; you can remove viberoom's access in its own settings.", "info");
      } catch (error) { showError(error); }
    });
    els.pageInner.addEventListener("change", async (e) => {
      if (state.view !== "connections") return;
      const list = e.target.closest(".room-values[data-cn-id]");
      const roomId = e.target.closest(".room-value")?.dataset.room;
      if (!list || !roomId || e.target.type !== "checkbox") return;
      try {
        const res = await post(`/api/connections/${encodeURIComponent(list.dataset.cnId)}/room`, { room: roomId, on: e.target.checked });
        state.connections = res.connections || state.connections;
        const c = state.connections.find((one) => one.id === list.dataset.cnId);
        const opener = list.closest('[data-ui="setting"]')?.querySelector(".room-values-open .label");
        if (c && opener) opener.textContent = connectionRoomsSummary(c, roomsByName());
      } catch (error) { showError(error); renderConnectionsPage(); }
    });
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
    if (p.skillChannel === "tool") return "Loads skills through the load_skill tool (the room's MCP server; no permission prompts).";
    if (p.skillChannel === "marker") return "Loads skills with the [skill:name] marker in a hidden turn (this vibemate did not take the room's MCP server).";
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
      const caret = textarea.selectionStart ?? textarea.value.length;
      textarea.setRangeText(`/${s.name} `, m.start, caret, "end");
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
  const vendorChoicesAsked = new Map();
  async function fillVendorChoices(vendor) {
    const asked = vendorChoicesAsked.get(vendor);
    if (asked && Date.now() - asked < 5000) return;
    vendorChoicesAsked.set(vendor, Date.now());
    let info;
    try { info = await get(`/api/recipes/${encodeURIComponent(vendor)}/options`); }
    catch { vendorChoicesAsked.delete(vendor); return; }
    const categories = { model: "model", effort: "thought_level", mode: "mode" };
    for (const [key, category] of Object.entries(categories)) {
      const list = document.getElementById(`sp-list-${vendor}-${key}`);
      if (!list) continue;
      const option = info.configOptions.find((o) => o.category === category && o.type === "select");
      const values = option ? flattenOptions(option.options)
        : key === "mode" && info.modes?.availableModes ? info.modes.availableModes.map((m) => ({ value: m.id, name: m.name })) : [];
      list.replaceChildren(...values.map((v) => { const o = document.createElement("option"); o.value = v.value; if (v.name && v.name !== v.value) o.label = v.name; return o; }));
    }
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
      els.invStatus.textContent = parts.length ? `Options from ${who} (${parts.join(", ")})` : `${who} has no additional settings available here.${info.modelAtLaunch ? " Choose a model from the list or enter its name before joining." : ""}${info.modeAtLaunch ? " Changing the mode restarts the session." : ""}`;
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
        ? `Found at ${recipe.installedAt || "bundled"}, but ${recipe.vendor} is not logged in${recipe.loginChecked ? ` (${recipe.vendor} reports: ${recipe.loginChecked.detail})` : ""}.${recipe.loginCommand && recipe.loginHow !== "card" ? ` Run \`${recipe.loginCommand}\` in a terminal, then press "Check again".` : ""}`
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
        post("/api/recipes/check", { force: true, rescan: true }, { deadline: 3 * 60000 }).catch(showError).finally(() => { recheck.disabled = false; });
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
    return recipe.loginState === "ok" ? recipe.loginChecked?.how === "acp" ? "ready to connect" : `logged in${own}` : recipe.loginState === "configured" ? `sign-in configured${own}` : recipe.loginState === "missing" ? `not logged in${own}` : "login not known";
  }
  function loginDialogProps(recipe, purpose) {
    const known = flowOf(recipe, purpose);
    const flow = known && (known.state === "running" || (known.endedAt || 0) >= loginDialog.openedAt) ? known : null;
    const running = !!flow && flow.state === "running";
    const checkedAfter = !!flow && !!recipe.loginChecked && recipe.loginChecked.at >= (flow.endedAt || 0) && !recipe.loginChecking;
    const base = { vendor: recipe.vendor, icon: recipe.icon || "", purpose, flowId: flow ? flow.id : undefined, data: { recipe: recipe.id } };
    let confirmed = false;
    let props;
    if (purpose === "install") {
      const kind = recipe.installHow === "url" ? "url" : recipe.installHow === "terminal" ? "terminal" : "command";
      const idleScene = kind === "terminal" ? "terminal" : kind === "url" ? "browser" : "package";
      const geek = `${esc(recipe.installNote || "")}${recipe.installCommand ? ` It runs <code>${esc(recipe.installCommand)}</code>${kind === "terminal" ? " in a terminal window" : " hidden, the way you would in a terminal"}.` : ""} viberoom downloads nothing itself: it is the vendor's own installer.`;
      if (!recipe.unavailableReason && !running && (!flow || flow.state === "done")) {
        confirmed = checkedAfter && recipe.loginState === "ok";
        const words = confirmed ? `${recipe.vendor} is installed and ready to join. You can summon it now.`
          : recipe.loginChecking ? `${recipe.vendor} is installed. Checking its sign-in…`
          : recipe.loginState === "missing" ? `${recipe.vendor} is installed. Log in to use it.`
          : recipe.loginState === "configured" ? `${recipe.vendor} is installed and has sign-in details configured. You can summon it; the vendor will confirm access.`
          : `${recipe.vendor} is installed. Its sign-in could not be confirmed. You can check again or open its sign-in.`;
        props = { ...base, kind, state: "done", scene: "done", words, status: recipe.installedAt || undefined, lines: flow ? flow.lines : undefined };
      } else if (running) {
        props = { ...base, kind, state: "running", scene: idleScene, words: flow.detail, lines: flow.lines, geek };
      } else if (flow && flow.state === "failed") {
        props = { ...base, kind, state: "failed", scene: "failed", words: flow.detail, lines: flow.lines, geek, terminal: kind === "command" };
      } else {
        const words = kind === "url" ? `${recipe.vendor} is installed from its website. Follow the steps there, come back, and press Check again.` : kind === "terminal" ? `A terminal window opens with ${recipe.vendor}'s installer. Finish there, then press I'm done.` : `${recipe.vendor} is fetched from npm; the tile turns live when it is done.`;
        props = { ...base, kind, state: "idle", scene: idleScene, words, status: "not installed on this machine", url: recipe.installUrl, geek };
      }
      return { props: { ...props, confirmed, checking: !!recipe.loginChecking }, confirmed };
    }
    const kind = recipe.loginHow === "terminal" ? "terminal" : "command";
    const geek = `${esc(recipe.loginHint || "")}${recipe.loginTerminalCommand ? ` In a terminal it is <code>${esc(recipe.loginTerminalCommand)}</code>.` : ""} ${esc(recipe.vendor)} handles sign-in. This dialog displays its output and forwards any answers you enter here.`;
    const terminal = kind !== "terminal" && !!recipe.loginTerminalCommand;
    const said = loginStatusWords(recipe);
    if (recipe.loginState === "ok" && flow && !running && checkedAfter) {
      confirmed = true;
      props = { ...base, kind, state: "done", scene: "done", words: `${recipe.vendor} is ready to join the room.`, status: said, lines: flow.lines };
    } else if (running) {
      const scene = kind === "terminal" ? "terminal" : flow.wantsInput ? "question" : flow.code ? "code" : "browser";
      props = { ...base, kind, state: "running", scene, words: flow.detail, url: flow.url, code: flow.code, wantsInput: !!flow.wantsInput, lines: flow.lines, geek };
    } else if (flow && flow.state === "done" && !checkedAfter && recipe.loginChecking) {
      props = { ...base, kind, state: "done", scene: "done", words: `The sign-in command finished. Checking ${recipe.vendor}…`, lines: flow.lines };
    } else if (flow && flow.state === "done" && recipe.loginState === "missing") {
      props = { ...base, kind, state: "failed", scene: "failed", words: `The sign-in command finished, but ${recipe.vendor} reports: ${said || "not logged in"}.`, lines: flow.lines, geek, terminal };
    } else if (flow && flow.state === "done") {
      props = { ...base, kind, state: "done", scene: "done", words: recipe.loginState === "configured"
        ? `${recipe.vendor} has sign-in details configured. Access is confirmed when the vendor uses them.`
        : `The sign-in command finished, but ${recipe.vendor}'s access could not be confirmed. Check again or reopen sign-in.`, status: said, lines: flow.lines };
    } else if (flow && flow.state === "failed") {
      props = { ...base, kind, state: "failed", scene: "failed", words: flow.detail, lines: flow.lines, geek, terminal };
    } else {
      const scene = recipe.loginScene || "browser";
      const words = scene === "terminal" ? `A terminal window opens with ${recipe.vendor}'s own sign-in. Complete its menu and exit the vendor's screen; viberoom then checks the result.` : scene === "code" ? `${recipe.vendor} shows a page and a code. Open the page, type the code, and it signs you in.` : `${recipe.vendor} opens your browser. Sign in there and come back; viberoom waits.`;
      props = { ...base, kind, state: "idle", scene, words: flow && flow.state === "cancelled" ? `Cancelled. ${words}` : words, status: said, geek };
    }
    return { props: { ...props, confirmed, checking: !!recipe.loginChecking }, confirmed };
  }

  const SETUP_STEPS = ["what", "bot", "key", "name", "pair", "done"];
  const SETUP_STOPS = [["bot", "Bot"], ["key", "Key"], ["name", "Name"], ["pair", "Phone"]];
  const setup = { open: false, step: 0, botfatherQr: "", linkAsked: false, linkFailed: false, linkTimer: null, wantCode: false };
  const NEWBOT = "/newbot";
  const BOTFATHER_URL = "https://t.me/BotFather";
  const GUIDE_PATH = "/guide.html";

  function openGuide() {
    if (document.getElementById("guide-view")) return;
    const view = document.createElement("div");
    view.id = "guide-view";
    view.className = "guide-view";
    view.innerHTML = `<div class="gv-bar">${UI.html("button", { label: "Back", icon: "back", kind: "secondary", size: "sm", act: "guide-close", title: "Back to viberoom (Esc)" })}</div><iframe class="gv-frame" src="${GUIDE_PATH}" title="The guide"></iframe>`;
    const close = () => { view.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    view.querySelector('[data-act="guide-close"]').addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(view);
  }

  async function loadBotfatherQr() {
    if (setup.botfatherQr) return;
    try {
      const res = await get(`/api/qr?text=${encodeURIComponent(BOTFATHER_URL)}`);
      setup.botfatherQr = res.svg || "";
      renderSetupWizard();
    } catch {
    }
  }

  function setupFacts() {
    const c = state.channels || {};
    const tg = c.telegram || null;
    const card = [...secretCards.values()].find((r) => r.state === "open" && r.askedBy.kind === "window") || null;
    const paired = (c.pairings || []).filter((p) => !p.unpairedAt).map((p) => p.name || p.senderId);
    return { tg, machine: c.machine || "this computer", card, paired, link: state.pairLink, now: Date.now(), botfatherQr: setup.botfatherQr, linkFailed: setup.linkFailed, guide: true };
  }

  function setupKeyStatus(tg) {
    if (!tg || !tg.enabled || !tg.tokenSet) return { text: "", done: false };
    switch (tg.state) {
      case "listening": return { text: `Connected as @${tg.account || "?"}`, done: true };
      case "contested": return { text: "Another computer answers on this bot too: the phone gets every reply twice. Give this one a bot of its own.", done: true, another: true };
      case "connected": return { text: "Checking the line to the phone…", done: false };
      case "checking": return { text: "Another program answered for this bot; checking whether it lets go…", done: false };
      case "degraded": return { text: "Another computer is listening to this bot. Give this one a bot of its own.", done: false, another: true };
      case "paused": return { text: `Connected as @${tg.account || "?"}; the conversation store is not answering, it resumes by itself.`, done: true };
      default: return tg.detail ? { text: `Not listening: ${tg.detail}.`, done: false, bad: true } : { text: "Starting…", done: false };
    }
  }

  function setupStopsHtml(step) {
    const name = SETUP_STEPS[step];
    const at = SETUP_STOPS.findIndex(([s]) => s === name);
    const allDone = name === "done";
    return `<ol class="su-steps" aria-label="Steps">${SETUP_STOPS.map(([s, label], i) => `<li class="${allDone || (at >= 0 && i < at) ? "done" : at === i ? "on" : ""}">${label}</li>`).join("")}</ol>`;
  }
  const scene = (name) => `<div class="su-stage" aria-hidden="true">${window.Icons.scene(name)}</div>`;
  const pairLinkWords = (url) => String(url || "").replace(/(start=)(.{4}).+$/, "$1$2…");

  function setupStepHtml(step, facts) {
    const { tg, machine, card, paired, link, now, botfatherQr, linkFailed, guide } = facts;
    const key = setupKeyStatus(tg);
    const stops = setupStopsHtml(step);
    const last = step === SETUP_STEPS.length - 1;
    const nav = (nextLabel, nextOn = true, extra = "") => `<div class="actions">${extra}${UI.html("button", { label: "Close", kind: "ghost", act: "su-close" })}${step > 0 ? UI.html("button", { label: "Back", kind: "ghost", act: "su-back" }) : ""}${UI.html("button", { label: nextLabel, kind: "primary", act: last ? "su-close" : "su-next", disabled: !nextOn })}</div>`;
    const note = (icon, text) => `<p class="su-note">${ic(icon)}<span>${text}</span></p>`;
    const sign = (text) => `<p class="su-sign ok"><span class="su-check">${ic("check")}</span><span>${text}</span></p>`;
    const waiting = (text) => `<p class="su-sign"><span class="su-dot"></span><span>${text}</span></p>`;
    const bad = (text, id) => `<p class="su-sign bad"${id ? ` id="${id}"` : ""}><b>${text}</b></p>`;
    const botfather = UI.html("button", { label: "Open BotFather", kind: "primary", size: "sm", act: "su-open-botfather", title: "Opens Telegram on this computer, or the web page" });
    switch (SETUP_STEPS[step]) {
      case "what":
        return `${stops}<div class="su-stage wide" aria-hidden="true"><div>${window.Icons.scene("bot-mini")}<div class="su-cap">a bot</div></div><div class="su-arrow">→</div><div>${window.Icons.scene("key-mini")}<div class="su-cap">its key</div></div><div class="su-arrow">→</div><div>${window.Icons.scene("phone-mini")}<div class="su-cap">your phone</div></div></div>
      <h3>Set up Telegram</h3>
      <p class="lead">Three things: a bot, its key, your phone. About ten minutes.</p>
      ${note("link", "Once it is on, the messages of any room you open on the phone travel through Telegram.")}${nav("Start")}`;
      case "bot":
        return `${stops}${scene("bot")}
      <h3>Make the bot</h3>
      <p class="lead">In Telegram, send <code>${NEWBOT}</code> to BotFather. It asks for a name, then a username ending in <i>bot</i>.</p>
      <div class="su-paths">
        <div class="su-path"><b>On the phone</b>${botfatherQr ? `<div class="su-qr" title="Scan with the phone's camera: BotFather opens there">${botfatherQr}</div><span class="hint">Scan: BotFather opens there.</span>` : `<span class="hint">Open ${esc(BOTFATHER_URL)} there.</span>`}<span class="hint">Made the bot on the phone? The same chat is in Telegram on this computer — copy the key there.</span></div>
        <div class="su-path"><b>On this computer</b>${botfather}${UI.html("button", { label: `Copy ${NEWBOT}`, kind: "secondary", size: "xs", act: "su-copy-newbot" })}</div>
      </div>
      ${note("info", "Username taken? BotFather asks again — pick another one ending in <i>bot</i>.")}
      <p class="field-note">You make the bot yourself, so the key never passes through anyone else's server.</p>${nav("Next")}`;
      case "key": {
        const refusal = card && card.refusal ? bad(esc(card.refusal), "su-refusal") : "";
        let status = "";
        if (key.another) status = `${note("alert", esc(key.text))}<div class="su-row">${botfather}</div>`;
        else if (key.done) status = `${sign(esc(key.text))}<p class="field-note">Another bot? ${UI.html("button", { label: "Replace the key", kind: "secondary", size: "xs", act: "su-replace-key" })}</p>`;
        else if (key.bad) status = bad(esc(key.text));
        else if (key.text) status = waiting(esc(key.text));
        const field = key.done ? "" : `<div class="su-field">${noPeekHtml()}<input type="password" id="su-key" autocomplete="off" spellcheck="false" placeholder="paste here" aria-label="The key">${UI.html("button", { label: "Connect", kind: key.another ? "secondary" : "primary", size: "sm", act: "su-connect" })}</div>${refusal}`;
        return `${stops}${scene("key")}
      <h3>The key</h3>
      <p class="lead">BotFather answers with a long line: numbers, a colon, a secret. Paste the whole message here — I will take the key out of it.</p>
      ${field}${status}
      <div class="su-geek">${geekTip("Who sees the key: nobody in the chat. It is not shown to the vibemates and does not enter the conversation, the record or the model's context; viberoom keeps it on this computer and uses it to talk to Telegram. Replace it any time with Replace the key…, and /revoke in BotFather makes the old one useless.")}</div>${nav("Next", key.done)}`;
      }
      case "name":
        return `${stops}${scene("name")}
      <h3>The name</h3>
      <p class="lead">The name your phone shows for this bot. One bot is one computer.</p>
      <div class="su-field"><input type="text" id="su-name" maxlength="64" spellcheck="false" value="${esc((tg && (tg.wantedName || tg.name)) || "")}" placeholder="${esc(`viberoom on ${machine}`)}" aria-label="The name">${UI.html("button", { label: "Apply", kind: tg && tg.name ? "secondary" : "primary", size: "sm", act: "su-apply-name" })}</div>
      ${note("eye", "Anyone who opens the bot sees this name.")}
      ${tg && tg.name ? sign(`On the phone the bot is called “${esc(tg.name)}”${key.done ? "" : "; reconnecting…"}`) : ""}${nav("Next", key.done)}`;
      case "pair": {
        const live = !!(link && link.expiresAt > now);
        const expired = !!(link && link.expiresAt <= now);
        const done = paired.length ? `${sign(`Paired: ${esc(paired.join(", "))}`)}<p class="su-sign"><span>Not you? Unpair in Settings → Channels.</span></p>` : "";
        let body;
        if (!key.done) body = note("alert", "The bot has to be connected first (the previous steps).");
        else if (live) body = `<div class="su-pair"><div class="su-qr big" title="Scan with the phone's camera">${link.svg || ""}</div><div class="su-words"><p>Or open the link on the phone, within 10 minutes (until ${esc(time(link.expiresAt))}):</p><p><a href="${esc(link.url)}" target="_blank" rel="noopener">${esc(pairLinkWords(link.url))}</a></p><p>${UI.html("button", { label: link.copied ? "Copied" : "Copy link", kind: "secondary", size: "xs", act: "su-copy-link" })}</p></div></div>
      ${note("user", "What pairs is a Telegram account: every device signed in to it can write to your rooms.")}
      ${note("alert", "Anyone who opens this code pairs — do not show it on a shared screen.")}
      <p class="field-note">${link.copied ? "Copied: the link stays good until it runs out, even if you close this." : "Close this and the link is withdrawn, unless you copied it."}</p>`;
        else if (expired) body = `${bad("The code has run out.")}<div class="su-row">${UI.html("button", { label: "New code", kind: "primary", size: "sm", act: "su-make-link" })}</div>`;
        else if (linkFailed) body = `${bad("The code could not be made.")}<div class="su-row">${UI.html("button", { label: "Try again", kind: "primary", size: "sm", act: "su-make-link" })}</div>`;
        else if (paired.length) body = `<div class="su-row">${UI.html("button", { label: "Pair another phone…", kind: "secondary", size: "sm", act: "su-make-link" })}</div>`;
        else body = waiting("Making the code…");
        return `${stops}${scene("phone")}
      <h3>Pair your phone</h3>
      <p class="lead">Scan this with your phone's camera, then press Start in Telegram.</p>
      ${paired.length && !live ? done + body : body + done}${nav("Next", paired.length > 0)}`;
      }
      default:
        return `${stops}${scene("rooms")}
      <h3>Done</h3>
      <p class="lead">Send <code>/rooms</code> to the bot, open a room, write a line.</p>
      ${nav("Done", true, guide ? UI.html("button", { label: "Open the guide", kind: "secondary", act: "su-open-guide" }) : "")}`;
    }
  }

  function firstUndoneStep(facts) {
    if (!facts.tg || !facts.tg.tokenSet) return "bot";
    if (!setupKeyStatus(facts.tg).done) return "key";
    if (!facts.paired.length) return "pair";
    return "done";
  }

  function openSetupWizard(at) {
    setup.open = true;
    setup.wantCode = at === "pair";
    const step = at === "next" ? firstUndoneStep(setupFacts()) : at || SETUP_STEPS[0];
    setup.step = Math.max(0, SETUP_STEPS.indexOf(step));
    bindSetupWizard();
    renderSetupWizard();
    openDialog(els.setupDialog);
    loadBotfatherQr();
  }

  function closeSetupWizard() {
    if (!setup.open) return;
    setup.open = false;
    setup.wantCode = false;
    if (setup.linkTimer) { clearTimeout(setup.linkTimer); setup.linkTimer = null; }
    const card = [...secretCards.values()].find((r) => r.state === "open" && r.askedBy.kind === "window");
    if (card) post(`/api/secrets/${card.id}/close`, {}).catch(() => {});
    dropPairLink(true);
    closeDialog(els.setupDialog);
    if (state.view === "settings") renderSettingsPage();
  }

  async function makePairLink() {
    if (setup.linkAsked) return;
    setup.linkAsked = true;
    setup.linkFailed = false;
    try {
      const res = await post("/api/channels/pair-link", {});
      state.pairLink = { url: res.url, expiresAt: res.expiresAt, svg: res.svg || "", copied: false };
    } catch (error) {
      setup.linkFailed = true;
      showError(error);
    } finally {
      setup.linkAsked = false;
    }
    renderSetupWizard();
  }

  function renderSetupWizard() {
    if (!setup.open || !els.suBody) return;
    const body = els.suBody;
    const facts = setupFacts();
    const typed = {};
    for (const id of ["su-key", "su-name"]) {
      const input = body.querySelector(`#${id}`);
      if (input) typed[id] = { value: input.value, focused: document.activeElement === input };
    }
    body.innerHTML = setupStepHtml(setup.step, facts);
    for (const [id, t] of Object.entries(typed)) {
      const input = body.querySelector(`#${id}`);
      if (!input) continue;
      if (t.value) input.value = t.value;
      if (t.focused) input.focus();
    }
    const first = body.querySelector("#su-key, #su-name");
    if (first && !Object.keys(typed).length) first.focus();
    if (setup.linkTimer) { clearTimeout(setup.linkTimer); setup.linkTimer = null; }
    if (SETUP_STEPS[setup.step] === "pair") {
      if (setupKeyStatus(facts.tg).done && !facts.link && !facts.linkFailed && (setup.wantCode || !facts.paired.length)) makePairLink();
      if (facts.link && facts.link.expiresAt > facts.now) setup.linkTimer = setTimeout(() => { setup.linkTimer = null; renderSetupWizard(); }, facts.link.expiresAt - facts.now + 50);
    }
  }

  function bindSetupWizard() {
    const body = els.suBody;
    if (!body || body.dataset.bound) return;
    body.dataset.bound = "1";
    const act = async (what) => {
      const facts = setupFacts();
      if (what === "su-close") return closeSetupWizard();
      if (what === "su-back") { setup.step = Math.max(0, setup.step - 1); return renderSetupWizard(); }
      if (what === "su-next") { setup.step = Math.min(SETUP_STEPS.length - 1, setup.step + 1); return renderSetupWizard(); }
      if (what === "su-open-botfather") { try { await post("/api/open", { target: BOTFATHER_URL }); } catch (error) { showError(error); } return; }
      if (what === "su-open-guide") { closeSetupWizard(); openGuide(); return; }
      if (what === "su-copy-newbot") { try { await navigator.clipboard.writeText(NEWBOT); toast(`${NEWBOT} copied.`, "ok"); } catch (error) { showError(error); } return; }
      if (what === "su-copy-link") {
        if (!state.pairLink) return;
        try { await navigator.clipboard.writeText(state.pairLink.url); state.pairLink.copied = true; toast("Link copied.", "ok"); renderSetupWizard(); } catch (error) { showError(error); }
        return;
      }
      if (what === "su-replace-key") {
        try { await post("/api/secrets", { purpose: "telegram-token" }); } catch (error) { showError(error); }
        return;
      }
      if (what === "su-connect") {
        const value = (body.querySelector("#su-key") || {}).value || "";
        if (!value.trim()) return;
        try {
          const card = facts.card || (await post("/api/secrets", { purpose: "telegram-token" })).request;
          await post(`/api/secrets/${card.id}`, { value: value.trim() });
        } catch (error) {
          const note = body.querySelector("#su-refusal");
          if (note) note.querySelector("b").textContent = error.message || String(error);
          else renderSetupWizard();
        }
        return;
      }
      if (what === "su-apply-name") {
        const name = ((body.querySelector("#su-name") || {}).value || "").trim();
        try {
          const res = await post("/api/channels/telegram", { name });
          state.channels = res.channels || state.channels;
          renderSetupWizard();
        } catch (error) { showError(error); }
        return;
      }
      if (what === "su-make-link") { setup.wantCode = true; return makePairLink(); }
    };
    body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      e.preventDefault();
      act(btn.dataset.act);
    });
    body.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      if (e.target.id === "su-key") { e.preventDefault(); act("su-connect"); }
      if (e.target.id === "su-name") { e.preventDefault(); act("su-apply-name"); }
    });
    els.setupDialog.addEventListener("cancel", (e) => { e.preventDefault(); closeSetupWizard(); });
  }

  const secretCards = new Map();
  const secretCopied = new Set();
  function openSecretCard() {
    return [...secretCards.values()].find((r) => r.state === "open") || null;
  }
  function loadSecretCards(cards) {
    secretCards.clear();
    for (const card of cards || []) secretCards.set(card.id, card);
    renderSecretDialog();
  }
  function renderSecretDialog() {
    const dialog = els.secretDialog;
    if (!dialog) return;
    const card = openSecretCard();
    if (card && setup.open && card.askedBy.kind === "window") {
      if (dialog.open) closeDialog(dialog);
      renderSetupWizard();
      return;
    }
    if (!card) {
      if (setup.open) renderSetupWizard();
      if (dialog.open) {
        closeDialog(dialog);
        const settled = [...secretCards.values()].filter((r) => r.state !== "open").sort((a, b) => b.askedAt - a.askedAt)[0];
        if (settled && settled.state === "done") toast(settled.purpose === "telegram-pair" ? `Phone ${settled.outcome}.` : settled.purpose === "telegram-token" ? `Telegram bot ${settled.outcome}.` : settled.purpose === "connection" ? `${settled.connection?.name}: ${settled.outcome}.` : settled.purpose === "consent" ? `${settled.outcome.charAt(0).toUpperCase()}${settled.outcome.slice(1)}.` : `Saved: ${settled.outcome}.`, "success");
      }
      return;
    }
    const body = els.sdBody;
    if (card.purpose === "telegram-pair") {
      const link = card.link || {};
      const copied = secretCopied.has(card.id);
      const who = card.askedBy.kind === "vibemate" ? `<b>${esc(card.askedBy.name)}</b> asks you to pair your phone.` : "Pair your phone.";
      body.innerHTML = `
      <h3>Pair your phone</h3>
      <p class="lead">${who} Scan the QR code with the phone's camera, or open the link on the phone. Telegram opens the bot; the account that opens the link and presses Start is paired, on every device signed in to it.</p>
      <div class="field-note pair-offer">
        ${link.svg ? `<div class="pair-qr" title="Scan with the phone's camera">${link.svg}</div>` : ""}
        <div class="pair-words">
          <p>Good for ten minutes${link.expiresAt ? ` (until ${esc(time(link.expiresAt))})` : ""}: <a href="${esc(link.url || "#")}" target="_blank" rel="noopener">${esc(pairLinkWords(link.url || ""))}</a></p>
          <p>${copied ? "Copied: the link stays good until it runs out, even if you close this card." : "Closing this card withdraws the link, unless you copy it first."} ${UI.html("button", { label: copied ? "Copied" : "Copy link", size: "sm", act: "secret-copy" })}</p>
        </div>
      </div>
      <div class="actions">${UI.html("button", { label: "Close", kind: "ghost", act: "secret-close" })}</div>`;
      dialog.dataset.card = card.id;
      bindSecretDialog();
      if (!dialog.open) openDialog(dialog);
      return;
    }
    if (card.purpose === "consent") {
      const c = card.consent || {};
      const CONSENT_HEADS = { memory: ["Turn on the long-term memory", "graph"], voice: ["Turn on the voice", "mic"], reading: ["Read the replies aloud", "speaker"] };
      const [title, icon] = CONSENT_HEADS[c.feature] || ["Turn it on", "lock"];
      const who = card.askedBy.kind === "vibemate" ? `<b>${esc(card.askedBy.name)}</b> asks you to turn it on. Only your press does; a vibemate cannot.` : "Read what it means first.";
      body.innerHTML = `
      <h3><span class="h-ico">${ic(icon)}</span>${title}</h3>
      <p class="lead">${who}</p>
      ${UI.html("consent-gate", { state: c.changed ? "lapsed" : "ask", icon, title: consentTitle(c.feature, c.recipient || "the provider", c.reader), words: c.words || "", answers: [{ label: "Not now", kind: "ghost", act: "secret-close" }, { label: c.changed ? "I agree" : "I agree, turn it on", kind: "primary", act: "secret-consent" }] })}
      <p class="field-note" id="sd-error" ${card.refusal && !c.changed ? "" : "hidden"}><b>${esc(card.refusal || "")}</b></p>`;
      dialog.dataset.card = card.id;
      bindSecretDialog();
      if (!dialog.open) openDialog(dialog);
      return;
    }
    if (card.purpose === "connection") {
      const c = card.connection || {};
      const who = card.askedBy.kind === "vibemate"
        ? `<b>${esc(card.askedBy.name)}</b> asks you to ${c.add ? "add" : "connect"} <b>${esc(c.name || "")}</b> (${esc(c.blurb || "")}).`
        : `Connect <b>${esc(c.name || "")}</b>.`;
      const own = c.command
        ? `<p class="field-note">It runs on this computer with your rights, as <code class="cn-command">${esc(c.command)}</code>. Add it only if you trust where it comes from. Every one of its tools asks you before it runs, reading too.</p>`
        : c.url ? `<p class="field-note">Its address: <code>${esc(c.url)}</code>. viberoom has not looked at this server, so add it only if you trust who runs it. Every one of its tools asks you before it runs, reading too.</p>` : "";
      const keys = (c.env || []).map((name) => `<label>${esc(name)}<input type="password" class="sd-env" data-env="${esc(name)}" autocomplete="off" spellcheck="false" placeholder="${(c.envSaved || []).includes(name) ? "saved; type to replace it" : "its value"}"></label>`).join("");
      body.innerHTML = `
      <h3>${UI.html("logo-tile", c.mark ? { icon: c.mark.url, brand: c.mark.hex } : { letter: (c.name || "?")[0] })}${c.add ? "Add" : "Connect"} ${esc(c.name || "")}</h3>
      <div class="sd-blind">${noPeekHtml("card", "The vibemate has turned its back: it never sees the access")}<p>${who}</p></div>
      ${own}
      ${c.signingIn ? "" : keys}
      <p class="lead">${c.signingIn ? (c.command ? "Starting it on this computer. This card closes by itself when it is done." : "Finish the sign-in in your browser, if it asks for one. This card closes by itself when it is done.") : c.command
        ? `${c.add ? "Add and connect puts" : "Connect starts"} ${esc(c.name || "it")} ${c.add ? "in Connections under Your own and starts it" : "on this computer"}.${(c.env || []).length ? " The keys go into this computer's vault and to the program when it starts; no vibemate ever sees them." : ""} It stops when unused for a while and starts again when a vibemate needs it. You can turn it off for a room, or remove it, in Connections.`
        : c.add
        ? `Add and connect puts ${esc(c.name || "it")} in Connections under Your own and connects it. If it asks for a sign-in, that opens in your browser; the access goes into this computer's vault, and no vibemate ever sees it. You can turn it off for a room, or remove it, in Connections.`
        : `Connect opens ${esc(c.name || "the system")}'s sign-in in your browser. You approve there what viberoom may do; the access goes into this computer's vault, and no vibemate ever sees it. It works in every room; you can turn it off for a room in Connections. Writing always asks you first, with the exact request.`}</p>
      <p class="field-note" id="sd-error" ${card.refusal ? "" : "hidden"}><b>${esc(card.refusal || "")}</b></p>
      <div class="actions">${UI.html("button", { label: "Not now", kind: "ghost", act: "secret-close" })}${c.signingIn ? "" : UI.html("button", { label: card.refusal ? "Try again" : c.add ? "Add and connect" : "Connect", kind: "primary", act: "secret-sign-in" })}</div>`;
      dialog.dataset.card = card.id;
      bindSecretDialog();
      if (!dialog.open) openDialog(dialog);
      return;
    }
    const prior = body.querySelector("#sd-value");
    const typed = prior && dialog.dataset.card === card.id ? prior.value : "";
    const voiceTo = (state.voice?.providers || []).find((p) => p.id === card.prefill?.provider)?.label || card.prefill?.provider || "the provider";
    const own = card.prefill?.provider === "compatible";
    const KEY_CARDS = {
      "telegram-token": { title: "Telegram bot key", asks: "for the key of your Telegram bot", lead: "Paste the key BotFather gave you: digits, a colon, then letters. It goes straight into viberoom's settings and the bot is started.", placeholder: "123456789:AbCdEf…", action: "Connect" },
      "memory-zep-key": { title: "Zep API key", asks: "for the key of your Zep project", lead: "Paste the project key from the Zep dashboard. It goes straight into this computer's vault; Zep Cloud becomes the memory provider, and the key is proven live before this card closes.", placeholder: "z_…", action: "Save" },
      "memory-sieve-key": { title: "Sieve API key", asks: "for the key of the memory sieve's endpoint", lead: "Paste the key of the sieve's endpoint. It goes straight into this computer's vault, and the sieve switches to its small model.", placeholder: "sk-…", action: "Save" },
      "voice-key": {
        title: `${voiceTo}: the key`, asks: `for the key of ${voiceTo}, to make your voice into words`,
        lead: own
          ? `Paste the server's key, or leave the field empty if it asks for none. ${voiceTo} becomes the voice's provider; nothing is sent until you turn the voice on.`
          : `Paste the key. It goes straight into this computer's vault; ${voiceTo} becomes the voice's provider, and the key is proven before this card closes. Nothing is sent until you turn the voice on.`,
        placeholder: card.prefill?.provider === "groq" ? "gsk_…" : own ? "empty for a server on this computer" : "sk-…", action: "Save",
        close: own ? "Not now" : undefined,
      },
    };
    const spec = KEY_CARDS[card.purpose] || KEY_CARDS["telegram-token"];
    const saved = card.purpose === "memory-sieve-key" || card.purpose === "voice-key"
      ? [card.prefill?.baseUrl && `endpoint <code>${esc(card.prefill.baseUrl)}</code>`, card.prefill?.model && `model <code>${esc(card.prefill.model)}</code>`, card.prefill?.language && `the language ${esc(new Intl.DisplayNames(["en"], { type: "language" }).of(card.prefill.language) || card.prefill.language)}`].filter(Boolean)
      : [];
    const prefill = saved.length ? `<p class="field-note">Saved together with the key: ${saved.join(", ")}.</p>` : "";
    const asker = card.askedBy.kind === "vibemate"
      ? `<b>${esc(card.askedBy.name)}</b> asks you ${spec.asks} — and is not looking: nothing pasted here is ever shown to a vibemate.`
      : `The setup asks you ${spec.asks}. Nothing pasted here is ever shown to a vibemate.`;
    body.innerHTML = `
      <h3><span class="h-ico">${ic("lock")}</span>${spec.title}</h3>
      <div class="sd-blind">${noPeekHtml("card", "The vibemate has turned its back and covers its eyes: it never sees this card")}<p>${asker}</p></div>
      <p class="lead">${spec.lead}</p>
      ${prefill}
      <label>Key<input type="password" id="sd-value" autocomplete="off" spellcheck="false" placeholder="${esc(spec.placeholder)}"></label>
      <p class="field-note" id="sd-error" ${card.refusal ? "" : "hidden"}><b>${esc(card.refusal || "")}</b></p>
      <div class="su-geek">${geekTip(KEY_GEEK)}</div>
      <div class="actions">${UI.html("button", { label: spec.close || "Close without a key", kind: "ghost", act: "secret-close" })}${UI.html("button", { label: spec.action, kind: "primary", act: "secret-connect" })}</div>`;
    dialog.dataset.card = card.id;
    const input = body.querySelector("#sd-value");
    input.value = typed;
    bindSecretDialog();
    if (!dialog.open) openDialog(dialog);
    input.focus();
  }
  function bindSecretDialog() {
    const body = els.sdBody;
    if (body.dataset.bound) return;
    body.dataset.bound = "1";
    const act = async (what) => {
      const card = openSecretCard();
      if (!card) return;
      if (what === "secret-close") {
        try { await post(`/api/secrets/${card.id}/close`, { copied: secretCopied.has(card.id) }); } catch (error) { showError(error); }
        return;
      }
      if (what === "secret-sign-in") {
        const env = Object.fromEntries([...body.querySelectorAll(".sd-env")].map((input) => [input.dataset.env, input.value]));
        try { await post(`/api/secrets/${card.id}/connect`, { env }); } catch (error) { showError(error); }
        return;
      }
      if (what === "secret-copy") {
        if (!card.link) return;
        try { await navigator.clipboard.writeText(card.link.url); secretCopied.add(card.id); toast("Link copied.", "ok"); renderSecretDialog(); } catch (error) { showError(error); }
        return;
      }
      if (what === "secret-consent") {
        try { await post(`/api/secrets/${card.id}/consent`, {}); } catch { }
        return;
      }
      const value = body.querySelector("#sd-value").value.trim();
      if (!value && !(card.purpose === "voice-key" && card.prefill?.provider === "compatible")) return;
      try { await post(`/api/secrets/${card.id}`, { value }); }
      catch (error) {
        const note = body.querySelector("#sd-error");
        if (note) { note.hidden = false; note.querySelector("b").textContent = error.message || String(error); }
      }
    };
    body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      e.preventDefault();
      act(btn.dataset.act);
    });
    body.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.id === "sd-value") { e.preventDefault(); act("secret-connect"); }
    });
    els.secretDialog.addEventListener("cancel", (e) => { e.preventDefault(); act("secret-close"); });
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
        else if (act === "start-login" || (act === "retry-login" && purpose === "login")) { btn.disabled = true; loginDialog.purpose = "login"; await startLoginFlow(recipeId, false); }
        else if (act === "start-install" || (act === "retry-login" && purpose === "install")) { btn.disabled = true; await startInstallFlow(recipeId, false); }
        else if (act === "terminal-login") { btn.disabled = true; await (purpose === "install" ? startInstallFlow(recipeId, true) : startLoginFlow(recipeId, true)); }
        else if (act === "rescan" || (act === "recheck-login" && purpose === "install")) { btn.disabled = true; await post("/api/recipes/check", { id: recipeId, rescan: true }, { deadline: 3 * 60000 }); }
        else if (act === "recheck-login") { btn.disabled = true; await post("/api/recipes/check", { id: recipeId, force: true }, { deadline: 3 * 60000 }); }
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
          : UI.html("button", { label: "Fresh start", kind, size: "xs", act: "trouble-respawn", icon: "bolt", title: "A fresh session with its notes and the last messages; the history stays" });
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
    if (r.loginState === "ok") return { state: "ok", text: r.loginChecked?.how === "acp" ? "ready" : "logged in" };
    if (r.loginState === "configured") return { state: "unknown", text: "sign-in set up" };
    return { state: "unknown", text: "installed" };
  }
  function loginTitle(r) {
    const said = r.loginChecked ? ` ${r.vendor} reports: ${r.loginChecked.detail}` : "";
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
        return `<div class="agent-cell">${tile}${under}${agentUpdates.tileAction(r)}</div>`;
      })
      .join("") + agentUpdates.bulkAction();
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
    delete els.invAvatar.dataset.picked;
    els.invAvatarPicker.appendChild(window.Avatars.pickerElement("", (face) => { els.invAvatar.value = face; els.invAvatar.dataset.picked = "1"; }, els.invAvatar));
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
        avatar: els.invAvatar.dataset.picked || els.invAvatar.value.trim() ? els.invAvatar.value.trim() : null,
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
    const room = currentRoom();
    const own = room && room.settings ? room.settings.reconnectMode : "inherit";
    const chosen = own === "load" || own === "replay" ? own : (state.settings || {}).reconnectMode;
    const mode = chosen === "load" ? "load" : "replay";
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
    const offline = offlineAgents(room, !!only).filter((p) => !only || p.id === only.id);
    if (!offline.length) return;
    if (!only) reconnectPrompted.add(room.id);
    els.rcError.hidden = true;
    els.rcReplay.value = room.settings.replayAfterRestart ?? 10;
    els.rcForm.querySelector(`input[name="rc-mode"][value="${renderReconnectDefault()}"]`).checked = true;
    els.rcIntro.textContent = only
      ? `${only.name} is offline in "${room.name}" (its session ended with the previous room run). Choose how it comes back:`
      : `${offline.length} vibemate${offline.length > 1 ? "s are" : " is"} offline in "${room.name}" (their sessions ended with the previous room run). Choose how they come back:`;
    els.rcTable.dataset.ids = offline.map((p) => p.id).join(",");
    els.rcTable.dataset.only = only?.id || "";
    els.rcTable.innerHTML = "";
    renderReconnectRows(room);
    openDialog(els.rcDialog);
  }
  function reconnectListed(room) {
    return (els.rcTable.dataset.ids || "").split(",").filter(Boolean).map((id) => findById(room, id)).filter(p => p && (!p.muted || p.id === els.rcTable.dataset.only));
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
    els.rcSubmit.title = canGo ? "" : listed.some(reconnectStuck) ? "Log in first; the room brings them back by itself" : "";
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
      const participant = findById(room, row.id);
      if (!participant || participant.muted && row.id !== els.rcTable.dataset.only) continue;
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
    if (room.startingWithHub) return;
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
      tpl.items = (await get("/api/templates")).templates || [];
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
          <span class="tpl-emoji">${window.Avatars.faceUrl(t.emoji) ? `<img class="room-pic" src="${window.Avatars.faceUrl(t.emoji)}" alt="">` : esc(t.emoji || "🧩")}</span>
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
      stpEls.preview.querySelectorAll("[data-stp-remove]").forEach((b) => b.addEventListener("click", () => b.closest(".stp-vm").remove()));
    } catch (error) {
      stpEls.error.textContent = error.message;
      stpEls.error.hidden = false;
    }
  }
  function renderTemplateForm(t) {
    const st = t.settings || {};
    const lang = st.language && st.language.mode === "fixed" ? st.language.language : "";
    const text = (id, value, props = "") => UI.raw(`<input type="text" class="input" id="${id}" value="${esc(value)}"${props}>`);
    const toggle = (label, id, on) => settingRow({ label, for: id, kind: "switch", checked: !!on });
    const pick = (label, id, value, options) => settingRow({ label, for: id, control: UI.raw(selectHtml(id, options, String(value))) });
    const number = (label, id, props) => settingRow({ label, for: id, control: numberHtml({ id, ...props }) });
    const cards = [
      settingsCard("stp-general", "General", [
        settingRow({ label: "Emoji", for: "stp-emoji", control: text("stp-emoji", t.emoji || "", ' maxlength="40" placeholder="none"') }),
        settingRow({ label: "Topic", for: "stp-topic", control: text("stp-topic", st.topic || "", ' maxlength="2000" placeholder="what the room is about"') }),
        settingRow({ label: "Folder", for: "stp-dir", stacked: true, control: UI.raw(`<span class="dir-row"><input type="text" class="input" id="stp-dir" maxlength="1000" value="${esc(t.dir || "")}" spellcheck="false">${UI.html("button", { label: "Browse", icon: "folder", kind: "ghost", hook: "browse-btn", title: "Choose a folder", data: { stpBrowse: true } })}</span>`) }),
        pick("About you", "stp-about", st.humanDescriptionMode || "inherit", [["inherit", "Program-wide description"], ["append", "Program-wide + this room's"], ["override", "Only this room's"], ["none", "Nothing about me"]]),
      ].join("")),
      settingsCard("stp-rules-card", "Rules", [
        settingRow({ label: "Room rules", for: "stp-rules", stacked: true, hint: "One rule per line.", control: UI.raw(`<textarea class="textarea" id="stp-rules" rows="5" placeholder="one rule per line">${esc(st.customRules || "")}</textarea>`) }),
        settingRow({ label: "Language", for: "stp-lang", control: text("stp-lang", lang, ' placeholder="follow the human (default), or e.g. English"') }),
        number("Max sentences per reply", "stp-maxlen", { value: String(st.maxSentences ?? ""), min: 1, max: 100, placeholder: "no limit" }),
        pick("Vibemates' own tools (files, shell, web)", "stp-tools", st.tools || "on-request", [["on-request", "Only when someone explicitly asks"], ["never", "Never (chat only)"]]),
      ].join("")),
      settingsCard("stp-conversation", "Conversation", [
        pick("Who may speak", "stp-turns", st.turnTaking || "parallel", [["one-at-a-time", "One vibemate at a time"], ["parallel", "All addressed vibemates at once"]]),
        number("Reply delay, seconds", "stp-delay", { value: String(st.replyDelay ?? 4), min: 0, max: 120, step: 0.5 }),
        toggle("Vibemates wake each other", "stp-wake", st.agentsWakeEachOther !== false),
        toggle("Wait while you are typing", "stp-wait", st.waitWhileHumanTypes !== false),
        number("Hop limit", "stp-hops", { value: String(st.hopLimit ?? 100), min: 0, max: 10000 }),
        toggle("Tell vibemates what they missed while working", "stp-missed-notice", st.missedMessagesNotice),
        toggle("Share this room's history with the other rooms", "stp-share-history", st.sharesHistory !== false),
        pick("Search the other rooms", "stp-reads-others", st.readsOtherRooms || "on-search", READS_OTHER_ROOMS),
        toggle("Reachable from messengers", "stp-reachable", st.reachableFromMessengers !== false),
      ].join("")),
      settingsCard("stp-start", "Start", [
        toggle("Start this room with viberoom", "stp-start-with-hub", st.startWithHub === true),
        pick("…and they come back", "stp-reconnect", st.reconnectMode || "inherit", [["inherit", "As Welcome back is set"], ["load", "Continuing their saved sessions"], ["replay", "Fresh, with the last messages replayed"]]),
        toggle("Wake vibemates after a restart", "stp-wake-restart", st.wakeAfterRestart === true),
        settingRow({ label: "Message after restart", for: "stp-restart-message", stacked: true, control: UI.raw(`<textarea class="textarea" id="stp-restart-message" rows="3" maxlength="8000">${esc(st.restartMessage || "")}</textarea>`) }),
        number("Replay last N chat messages after a reconnect", "stp-replay", { value: String(st.replayAfterRestart ?? 10), min: 0, max: 200 }),
      ].join("")),
      settingsCard("stp-briefs", "Briefs", [
        number("Full brief every N vibemate turns", "stp-brief-turns", { value: String(st.fullBriefEveryTurns ?? 8), min: 1, max: 10000 }),
        number("…or every N new context tokens", "stp-brief-tokens", { value: String(st.fullBriefEveryTokens ?? 20000), min: 1000, max: 10000000, step: 1000 }),
        toggle("Repeat core rules in every header", "stp-header-rules", st.headerRules !== false),
        toggle("Show vendor and model to other vibemates", "stp-vendor", st.showVendorInRoster),
        toggle("Ask vibemates for notes automatically", "stp-auto-notes", st.autoNotes !== false),
        number("Missed messages a vibemate reads at most on its next turn", "stp-backlog", { value: String(st.backlogCap ?? 50), min: 1, max: 1000 }),
        number("Most characters in a vibio or in the room rules", "stp-text-limit", { value: String(st.briefTextLimit ?? 8000), min: 500, max: 32000, step: 500 }),
        pick("When a reply breaks a mechanical rule", "stp-referee", st.refereeAction || "next-header", [["next-header", "Post it; remind the agent in its next header"], ["retry-hidden", "Hold it; ask for a corrected version in a hidden turn"]]),
      ].join("")),
    ];
    const agentOptions = [["", "none yet: cast when the room opens"], ...state.recipes.map((r) => [r.id, r.vendor + (r.unavailableReason ? " (not installed here)" : "")])];
    const vms = (t.vibemates || []).map((v, i) => {
      const id = (k) => `stp-vm-${i}-${k}`;
      const vmText = (label, k, value, props = "") => settingRow({ label, for: id(k), control: UI.raw(`<input type="text" class="input" id="${id(k)}" data-k="${k}" value="${esc(value || "")}"${props}>`) });
      return `<div class="stp-vm" data-i="${i}">${settingsCard(id("card"), v.name, [
        settingRow({ label: `Leave ${v.name} out of the template`, lead: UI.raw(avatar({ name: v.name, avatar: v.avatar, color: FALLBACK_COLOR() }, 36, {})), control: UI.raw(UI.html("button", { label: "Leave out", icon: "close", kind: "ghost", size: "sm", data: { stpRemove: true } })) }),
        vmText("Vibename", "name", v.name, ' maxlength="40" required'),
        vmText("Vibersona", "tagline", v.tagline, ' maxlength="80"'),
        settingRow({ label: "Vibio", for: id("role"), stacked: true, control: UI.raw(`<textarea class="textarea" id="${id("role")}" data-k="role" rows="3" maxlength="4000">${esc(v.role || "")}</textarea>`) }),
        vmText("Vibeface", "avatar", v.avatar, ' maxlength="40" placeholder="initials"'),
        settingRow({ label: "Coding agent", for: id("agentType"), control: UI.raw(`<select class="select" id="${id("agentType")}" data-k="agentType">${agentOptions.map(([value, label]) => `<option value="${esc(value)}"${(v.agentType || "") === value ? " selected" : ""}>${esc(label)}</option>`).join("")}</select>`) }),
        vmText("Model", "model", v.model, ' placeholder="the agent\'s default"'),
        vmText("Effort", "effort", v.effort, ' placeholder="default"'),
        vmText("Mode", "mode", v.mode, ' placeholder="default"'),
        settingRow({ label: "Reply delay override, seconds", for: id("replyDelay"), control: numberHtml({ id: id("replyDelay"), value: String(v.replyDelay ?? ""), min: 0, max: 120, step: 0.5, placeholder: "the room's", data: { k: "replyDelay" } }) }),
        vmText("Skills", "skills", (v.skills || []).join(", "), ' placeholder="comma-separated"'),
      ].join(""))}</div>`;
    }).join("");
    return `${cards.join("")}${vms || '<p class="hint">No vibemates in this room: the template has none.</p>'}`;
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
      sharesHistory: $("#stp-share-history").checked,
      readsOtherRooms: $("#stp-reads-others").value,
      reachableFromMessengers: $("#stp-reachable").checked,
      startWithHub: $("#stp-start-with-hub").checked,
      wakeAfterRestart: $("#stp-wake-restart").checked,
      restartMessage: $("#stp-restart-message").value,
      reconnectMode: $("#stp-reconnect").value,
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
      autoNotes: $("#stp-auto-notes").checked,
      missedMessagesNotice: $("#stp-missed-notice").checked,
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
    const d = Object.assign({}, state.roomDefaults || {}, (state.settings || {}).roomDefaults || {});
    els.roomOptions.innerHTML = settingsCard("room-options-card", "", [
      settingRow({ label: "Share this room's history with the other rooms", for: "room-share-history", kind: "switch", checked: d.sharesHistory !== false, hint: SHARES_HISTORY_HINT }),
      settingRow({ label: "Search the other rooms", for: "room-reads-others", hint: READS_OTHER_ROOMS_HINT, control: UI.raw(selectHtml("room-reads-others", READS_OTHER_ROOMS, d.readsOtherRooms || "on-search")) }),
      settingRow({ label: "Reachable from messengers", for: "room-reachable", kind: "switch", checked: true, hint: "A phone paired to viberoom can open this room, write to it and read its replies. You can change this later in the room's settings." }),
    ].join(""));
    openDialog(els.roomDialog);
    els.roomName.focus();
  }
  async function submitRoom(event) {
    event.preventDefault();
    try {
      const res = await post("/api/rooms", { name: els.roomName.value, dir: els.roomDir.value.trim() || null, settings: { sharesHistory: $("#room-share-history").checked, readsOtherRooms: $("#room-reads-others").value, reachableFromMessengers: $("#room-reachable").checked } });
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
    els.pfAvatarPicker.appendChild(window.Avatars.pickerElement(s.humanAvatar || "", (emoji) => (els.pfAvatar.value = emoji), els.pfAvatar));
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
      renderMessages("every view rendered");
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
  let lookRetried = "";
  function verifyLookPainted(look) {
    requestAnimationFrame(() => {
      const want = String(TOKENS.looks[look]?.palette?.primary || "").toLowerCase();
      const got = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim().toLowerCase();
      if (!want || got === want) { lookRetried = ""; return; }
      if (lookRetried === look) {
        console.warn(`look ${look}: the window paints ${got}, the look says ${want}; the stylesheet did not arrive`);
        return;
      }
      lookRetried = look;
      const link = $("#looks-custom");
      if (!link) return;
      link.addEventListener("load", () => applyAppearance(), { once: true });
      refreshLooksCss();
    });
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
  const UI_SCALE_CAP = 1.35;
  let appliedScheme = null;
  function applyAppearance() {
    const a = (state.settings || {}).appearance || {};
    const root = document.documentElement;
    delete root.dataset.tried;
    const scale = (a.chatFontSize || 14.5) / 14.5;
    root.style.setProperty("--chat-fs", String(scale));
    root.style.setProperty("--fs-scale", String(Math.min(scale, UI_SCALE_CAP)));
    const zoom = UI_ZOOM_BASE * ((a.scale || 100) / 100);
    root.style.setProperty("--ui-scale", String(zoom));
    if (Layout.scale !== zoom) Layout = VIBEROOM_LAYOUT.create(zoom);
    const look = TOKENS.looks[a.look] ? a.look : TOKENS.current.id;
    if (look === TOKENS.current.id) delete root.dataset.look;
    else root.dataset.look = look;
    root.classList.toggle("more-on-click", (state.settings || {}).showMoreOnClick !== false);
    if (TOKENS.looks[look].custom) verifyLookPainted(look);
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
    lifeRadiusCache = null;
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
    const previousRooms = state.rooms;
    const previousSettings = state.settings;
    const previousReader = previousRooms.get(state.currentRoomId)?.history && state.view === "room" && !stuck ? readerAnchor() : null;
    state.settings = snapshot.settings;
    showAttention();
    state.automationPending = snapshot.automationPending || {};
    state.looks = snapshot.looks || [];
    registerLooks(state.looks);
    applyAppearance();
    state.update = snapshot.update || null;
    renderUpdatePop();
    state.restart = snapshot.restart || null;
    renderRestartPop();
    state.version = snapshot.version || null;
    noteHubRun();
    state.skills = snapshot.skills || [];
    state.recipes = snapshot.recipes || [];
    agentUpdates.setView(snapshot.agentUpdates || null);
    for (const flow of snapshot.logins || []) agentUpdates.setFlow(flow);
    state.logins = new Map((snapshot.logins || []).filter((f) => !f.purpose || f.purpose === "login").map((f) => [f.recipeId, f]));
    state.installs = new Map((snapshot.logins || []).filter((f) => f.purpose === "install").map((f) => [f.recipeId, f]));
    state.roomDefaults = snapshot.roomDefaults || null;
    state.channels = snapshot.channels || null;
    state.connections = snapshot.connections || [];
    state.voice = snapshot.voice || null;
    state.memoryProvider = snapshot.memoryProvider || state.memoryProvider;
    state.autostart = snapshot.autostart || null;
    state.dataFolder = snapshot.dataFolder || null;
    featuresChanged({ page: false });
    state.rooms = new Map((snapshot.rooms || []).map((r) => [r.id, r]));
    for (const room of state.rooms.values()) {
      room.participantOrder = new Map((room.participants || []).map(p => [p.id, room.history?.streamSequence ?? -1]));
      const previous = previousRooms.get(room.id);
      const before = previous && (previous.settings?.foldAfter ?? previousSettings?.foldAfter ?? FOLD_SHOWN);
      const after = room.settings?.foldAfter ?? state.settings?.foldAfter ?? FOLD_SHOWN;
      if (previous && before !== after) {
        foldAnchor.delete(room.id);
        if (listRoomId === room.id) listRoomId = null;
      }
      if (previous && room.history?.version) {
        const retained = HistoryWindow.retainUnchanged(previous, room);
        if (!retained) {
          const anchor = foldAnchor.get(room.id);
          const first = (anchor?.id && previous.messages.find(m => m.id === anchor.id)) || previous.messages[0];
          const from = first && cursorOf(first);
          if (before === after && remoteHidden(room) && (anchor?.all || (from && room.history.oldest && HistoryWindow.compareCursor(from, room.history.oldest) < 0))) {
            room.restoreFrom = { all: !!anchor?.all, from, reader: room.id === state.currentRoomId ? previousReader : null };
          } else if (listRoomId === room.id) listRoomId = null;
        }
      }
    }
    state.openRooms = [...(snapshot.openRooms || [])];
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
    if (params.get("setup") === "telegram") {
      const step = params.get("step");
      history.replaceState(null, "", location.pathname);
      openSettings("channels");
      requestAnimationFrame(() => openSetupWizard(step && SETUP_STEPS.includes(step) ? step : "next"));
      renderDetails();
      maybeOfferProfile();
      return;
    }
    setView(openRoom && state.currentRoomId && (wanted || state.view === "room") ? "room" : state.view === "room" ? "rooms" : state.view);
    renderDetails();
    maybeOfferProfile();
    if (!els.pfDialog.open) maybeOfferReconnect();
    const held = recall(HELD_LIVE);
    if (held) {
      forget(HELD_LIVE);
      try {
        reportHeldTurns(JSON.parse(held));
      } catch {
      }
    }
  }

  function onRoomEvent(roomId, event) {
    const room = state.rooms.get(roomId);
    if (!room) return;
    if (room.history?.bodyProtocol) {
      const affected = event.type === "message.delivery" ? (event.updates || []).map(update => update.id)
        : [event.message?.id || event.messageId || event.id].filter(Boolean);
      const changes = room.bodyChanges ||= new Map();
      for (const id of affected) changes.set(id, event.streamSequence || 0);
      if (room.history.indexed) for (const id of affected) (room.dirtyHeights ||= new Set()).add(id);
    }
    const delta = ["chunk", "thought", "toolcall", "plan"].includes(event.type);
    if ((delta || event.type === "message" || event.type === "message.delivery") && event.streamSequence !== undefined && event.streamSequence <= (room.history?.streamSequence ?? -1)) return;
    if (room.historyEvents && delta) room.historyEvents.push(event);
    if (event.history) {
      if (room.history?.epoch && room.history.epoch !== event.history.epoch) return;
      if (room.history?.revision > event.history.revision && event.type !== "participant") return;
      if (!room.history || event.history.streamSequence >= (room.history.streamSequence ?? -1)) room.history = { ...room.history, ...event.history };
      const m = event.type === "message" && event.message;
      if (m && m.seq > 0 && m.kind === "chat") {
        const latest = (room.history.latest ||= {});
        if (!latest[m.from] || m.seq >= latest[m.from].seq) latest[m.from] = { seq: m.seq, usage: m.usage };
      }
    }
    if (room.history && event.streamSequence !== undefined) room.history.streamSequence = Math.max(room.history.streamSequence ?? -1, event.streamSequence);
    const current = roomId === state.currentRoomId;
    const showing = current && state.view === "room";
    switch (event.type) {
      case "participant": {
        const order = room.participantOrder ||= new Map();
        if (event.streamSequence !== undefined) {
          if (event.streamSequence < (order.get(event.participant.id) ?? -1)) return;
          order.set(event.participant.id, event.streamSequence);
        }
        const before = showing ? visibilityFingerprint(room) : "";
        const i = room.participants.findIndex((p) => p.id === event.participant.id);
        const previous = i >= 0 ? room.participants[i] : null;
        const channelChanged = i >= 0 && room.participants[i].skillChannel !== event.participant.skillChannel;
        if (i >= 0) room.participants[i] = event.participant;
        else room.participants.push(event.participant);
        if (showing && previous && previous.name !== event.participant.name) refreshNowNames(room, event.participant);
        if (showing) {
          if (visibilityFingerprint(room) !== before) {
            renderMessagesSoon(`what ${event.participant.name} has seen moved`);
          }
          else refreshSeen(room);
          if (channelChanged) refreshStartingLines(room);
          renderSideRoom();
          renderChatHead();
          if (els.rcDialog.open) refreshReconnectDialog(room);
          if (state.detailsOpen && state.selection.kind === "participant" && state.selection.id === event.participant.id) {
            if (!editingInDetails()) renderDetails();
            else {
              refreshDetailsHeader(event.participant);
              const config = p => JSON.stringify([p?.mode, p?.configOptions, p?.pendingSettings, p?.status === "starting", !!p?.installOutdated, p?.status === "thinking" && !!p?.installOutdated]);
              if (config(previous) !== config(event.participant)) {
                const panel = $("#pp-config");
                if (panel) renderConfig(panel, event.participant, ["offline", "left"].includes(event.participant.status));
              }
            }
          }
        }
        renderOverviewSoon();
        return;
      }
      case "participant.removed":
        if (event.streamSequence !== undefined) (room.participantOrder ||= new Map()).set(event.id, event.streamSequence);
        room.participants = room.participants.filter((p) => p.id !== event.id);
        if (state.selection.kind === "participant" && state.selection.id === event.id) closeDetails();
        if (showing) {
          renderMessages("a vibemate left");
          renderSideRoom();
          renderChatHead();
        }
        renderOverviewSoon();
        return;
      case "message":
        upsertMessage(roomId, event.message);
        trimBodyCache(room);
        return;
      case "message.delivery": {
        const known = new Map(HistoryWindow.knownMessages(room).map(m => [m.id, m]));
        for (const update of event.updates || []) {
          const m = known.get(update.id);
          if (!m || (m.bodyDelivery?.version ?? 0) > update.delivery.version) continue;
          m.bodyDelivery = update.delivery;
          if (!showing) continue;
          const el = els.messages.querySelector(`.msg[data-id="${CSS.escape(m.id)}"]`);
          if (el) { fillSeen(el, room, m); renderWaiting(el, room, m); }
        }
        return;
      }
      case "message.removed":
        removeMessage(roomId, event.id);
        forgetGoneEditors(room);
        return;
      case "record.replaced":
        previewCache.clear();
        room.historyGeneration = (room.historyGeneration || 0) + 1;
        void refreshHeld(roomId);
        return;
      case "messages.truncated":
        room.historyGeneration = (room.historyGeneration || 0) + 1;
        room.messages = room.messages.filter((m) => m.seq <= event.fromSeq);
        forgetGoneEditors(room);
        if (foldAnchor.get(roomId)?.id && !room.messages.some(m => m.id === foldAnchor.get(roomId).id)) foldAnchor.delete(roomId);
        room.pinnedOlder = (room.pinnedOlder || []).filter(m => m.seq <= event.fromSeq);
        room.permissions = (room.permissions || []).filter((p) => room.messages.some((m) => m.from === p.participantId && m.streaming));
        if (room.history?.version) {
          if (showing) for (const el of els.messages.querySelectorAll(".msg[data-seq]")) if (Number(el.dataset.seq) > event.fromSeq) el.remove();
          void refreshHeld(roomId);
          return;
        }
        if (showing) renderMessages("the history was rewritten");
        return;
      case "chunk":
        patchMessage(roomId, event.id, (m) => (m.text += event.text), "text");
        return;
      case "thought":
        patchMessage(roomId, event.id, (m) => (m.thought = (m.thought || "") + event.text), "thought");
        return;
      case "toolcall":
        patchMessage(roomId, event.id, (m) => {
          m.toolCalls = m.toolCalls || [];
          const i = m.toolCalls.findIndex((c) => c.toolCallId === event.toolCall.toolCallId);
          if (i >= 0) m.toolCalls[i] = event.toolCall;
          else m.toolCalls.push(event.toolCall);
        }, "tools", event.toolCall.toolCallId);
        return;
      case "plan":
        patchMessage(roomId, event.id, (m) => (m.plan = event.entries), "plan");
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
      case "new-room":
        room.newRooms = [...(room.newRooms || []), event.proposal];
        if (showing) renderNewRoom(room, event.proposal);
        else toast(`${esc(event.proposal.participantName)} proposes a new room from "${room.name}".`, "warn");
        return;
      case "new-room.resolved": {
        const asked = (room.newRooms || []).find((x) => x.key === event.key);
        if (asked) { asked.status = event.status; asked.roomId = event.roomId; }
        if (showing && asked) renderNewRoom(room, asked);
        return;
      }
      case "recovery":
        applyRecoveryAnswer(room.id, event.recovery);
        return;
      case "proposal.resolved": {
        const p = (room.proposals || []).find((x) => x.key === event.key);
        if (p) p.skipped = event.skipped;
        if (showing) resolveProposalCard(room, event.key, event.status);
        else if (p) p.status = event.status;
        return;
      }
      case "room": {
        const foldBefore = room.settings ? room.settings.foldAfter : null;
        const panelBefore = roomPanelState(room);
        room.hopLimit = event.hopLimit;
        room.hops = event.hops;
        room.settings = event.settings;
        if ((event.settings ? event.settings.foldAfter : null) !== foldBefore) foldSettingChanged(room.id);
        room.customRulesText = event.customRulesText != null ? event.customRulesText : room.customRulesText;
        room.focused = event.focused;
        room.startingWithHub = event.startingWithHub === true;
        room.name = event.name;
        if (event.dir) room.dir = event.dir;
        if (showing) {
          renderSideRoom();
          renderChatHead();
          if (state.detailsOpen && state.selection.kind === "room" && roomPanelState(room) !== panelBefore) {
            if (!editingInDetails()) renderDetails();
            else refreshRoomHeader(room);
          }
        }
        renderOverviewSoon();
        return;
      }
      case "notice":
        if (current) toast(event.text, event.level);
        return;
      default:
        return;
    }
  }

  const HUB_EVENTS = {
    autostart: m => {
      state.autostart = m.autostart;
      if (state.view === "settings" && !editingInDetails()) renderSettingsPage();
    },
    automations: m => { state.automationPending = m.pending || {}; renderAutomationBadge(); void window.ViberoomAutomations.refresh(); },
    snapshot: (m) => {
      loadSnapshot(m.snapshot);
      loadSecretCards(m.snapshot.secrets);
    },
    "room.event": (m) => onRoomEvent(m.roomId, m.event),
    restart: (m) => {
      if (state.restart) state.restart.pending = m.restart || null;
      else state.restart = { can: true, pending: m.restart || null };
      renderRestartPop();
      if (state.view === "settings") renderSettingsPage();
    },
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
      if (m.flow.purpose === "update") { agentUpdates.setFlow(m.flow); return; }
      (m.flow.purpose === "install" ? state.installs : state.logins).set(m.flow.recipeId, m.flow);
      renderLoginHosts();
      if (document.querySelector("#invite-dialog")?.open) renderInviteTiles();
    },
    secret: (m) => {
      secretCards.set(m.request.id, m.request);
      renderSecretDialog();
      const r = m.request;
      if (r.state !== "open" && (r.purpose === "consent" || r.purpose === "voice-key" || r.purpose === "memory-zep-key" || r.purpose === "memory-sieve-key")) void refreshFeatureViews();
    },
    "room.created": (m) => {
      state.rooms.set(m.room.id, m.room);
      renderOverviewSoon();
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
      }
      renderOverviewSoon();
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
      const foldBefore = state.settings ? state.settings.foldAfter : null;
      state.settings = m.settings;
      showAttention();
      if ((m.settings ? m.settings.foldAfter : null) !== foldBefore) foldSettingChanged(null);
      applyAppearance();
      if (devBuild()) for (const el of els.messages.querySelectorAll(".msg.agent")) placeDevPrompt(el);
      rerenderDiagrams();
      renderRail();
      if (state.view === "settings" && !editingInDetails()) renderSettingsPage();
      if (state.view === "me" && !editingInDetails()) renderMePage();
      if (state.view === "room") renderSideRoom();
    },
    update: (m) => {
      state.update = m.update;
      renderUpdatePop();
      if (state.view === "settings" && !editingInDetails()) renderSettingsPage();
    },
    "agent.updates": (m) => agentUpdates.setView(m.updates),
    connections: (m) => {
      state.connections = m.connections || [];
      if (state.view === "connections") renderConnectionsPage();
      else if (state.view === "home") renderHome();
    },
    channels: (m) => {
      state.channels = m.channels || null;
      if (state.pairLink && !(m.channels && m.channels.pairLinkUntil)) dropPairLink(false);
      if (state.view === "settings" && !editingInDetails()) renderSettingsPage();
      if (setup.open) renderSetupWizard();
    },
    reset: () => (location.href = "/"),
  };
  const HELD_LIVE = "heldLive";
  function heldTurnsNow() {
    const rooms = new Map();
    const note = (roomId, id, how) => {
      if (!roomId || !id) return;
      const room = state.rooms.get(roomId);
      const entry = rooms.get(roomId) || { roomId, lastStreamSequence: (room && room.history && room.history.streamSequence) ?? -1, ids: new Map() };
      entry.ids.set(id, { ...(entry.ids.get(id) || {}), ...how });
      rooms.set(roomId, entry);
    };
    for (const [roomId, room] of state.rooms) {
      for (const m of room.messages || []) if (m.streaming && m.from !== "human") note(roomId, m.id, { model: true });
    }
    for (const stop of document.querySelectorAll('.live-tail [data-act="stop"]')) {
      const bubble = stop.closest(".msg");
      if (bubble && bubble.dataset.id) note(state.currentRoomId, bubble.dataset.id, { onScreen: true });
    }
    return [...rooms.values()].map((room) => ({ roomId: room.roomId, lastStreamSequence: room.lastStreamSequence, ids: [...room.ids].map(([id, how]) => ({ id, ...how })) }));
  }
  function rememberHeldTurns() {
    if (!stream) return void forget(HELD_LIVE);
    const rooms = heldTurnsNow();
    if (rooms.length) remember(HELD_LIVE, JSON.stringify({ at: Date.now(), rooms }));
    else forget(HELD_LIVE);
  }
  function reportHeldTurns(record) {
    for (const room of record.rooms || []) {
      const fresh = state.rooms.get(room.roomId);
      if (!fresh) continue;
      for (const held of room.ids || []) {
        const message = (fresh.messages || []).find((m) => m.id === held.id);
        if (!message || message.streaming) continue;
        void post("/api/window/finding", {
          roomId: room.roomId,
          messageId: held.id,
          heldSince: record.at,
          lastStreamSequence: room.lastStreamSequence,
          heldBy: held.model ? (held.onScreen ? "both" : "record") : "screen",
          afterReload: true,
        }).catch(() => {});
      }
    }
  }
  let stream = null;
  let releaseTimer = null;
  let retryTimer = null;
  let retryDelay = 1000;
  let keyless = false;
  const keylessAnswer = (answer) => !!answer && answer.keyed === false;
  async function askKey() {
    let answer = null;
    try {
      answer = await (await fetch("/api/version", { signal: AbortSignal.timeout(4000) })).json();
    } catch {
      return;
    }
    if (keyless || !keylessAnswer(answer)) return;
    keyless = true;
    clearTimeout(retryTimer);
    if (stream) { const ws = stream; stream = null; ws.close(); }
    els.noKey.hidden = false;
    document.body.classList.add("keyless");
  }
  function connect() {
    if (keyless) return;
    if (stream) return;
    clearTimeout(retryTimer);
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    stream = ws;
    ws.onopen = () => {
      if (stream !== ws) return;
      retryDelay = 1000;
      downSince = 0;
      els.conn.classList.add("ok");
      renderGonePop();
    };
    ws.onmessage = (e) => {
      if (stream !== ws) return;
      const m = JSON.parse(e.data);
      const handle = HUB_EVENTS[m.type];
      if (!handle) return;
      const started = performance.now();
      handle(m);
      noteBurst(m.type, performance.now() - started);
    };
    ws.onerror = () => { if (stream === ws) els.conn.classList.remove("ok"); };
    ws.onclose = () => {
      if (stream !== ws) return;
      els.conn.classList.remove("ok");
      stream = null;
      if (!downSince) downSince = Date.now();
      renderGonePop();
      void askKey();
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 10000);
    };
  }
  function releaseStream() {
    if (!stream) return;
    const ws = stream;
    stream = null;
    ws.close();
    downSince = 0;
    renderGonePop();
    els.conn.classList.remove("ok");
    els.conn.title = "Paused while this tab is in the background; resumes when you come back";
  }
  const connLabel = $("#conn-label");
  const COMING_BACK_MS = 3000;
  const NOBODY_THERE_MS = 15000;
  let downSince = 0;
  let goneTimer = 0;
  function renderGonePop() {
    clearTimeout(goneTimer);
    const old = $("#gone-pop");
    const down = downSince ? Date.now() - downSince : 0;
    if (!downSince || down < COMING_BACK_MS) {
      if (old) old.remove();
      if (downSince) goneTimer = setTimeout(renderGonePop, COMING_BACK_MS - down);
      if (connLabel) connLabel.textContent = downSince ? "reconnecting…" : "connected";
      return;
    }
    const gone = down >= NOBODY_THERE_MS;
    if (connLabel) connLabel.textContent = gone ? "not running" : "reconnecting…";
    const folder = state.dataFolder && state.dataFolder.known && state.dataFolder.path;
    const where = folder ? ` What happened is written down in <code>${esc(folder)}${folder.includes("\\") ? "\\" : "/"}hub.log</code>.` : "";
    const words = gone
      ? `<b>viberoom is not answering.</b> Everything in your rooms is kept on this computer and is safe — what has stopped is the program that serves them. Start viberoom again, and this window comes back on its own.${where}`
      : "<b>Reconnecting to viberoom.</b> The room comes back by itself in a few seconds.";
    const acts = gone
      ? `<div class="up-acts">${UI.html("button", { label: "Check again", kind: "secondary", size: "sm", hook: "gp-retry" })}</div>`
      : "";
    const pop = old || document.createElement("div");
    if (!old) {
      pop.id = "gone-pop";
      pop.className = "update-pop restart-pop";
      $("#rail-pops").appendChild(pop);
    }
    pop.innerHTML = `<div class="up-main"><div class="up-text">${words}</div>${acts}</div>`;
    const retry = pop.querySelector(".gp-retry");
    if (retry) retry.addEventListener("click", () => { retryDelay = 1000; resyncStream(); });
    if (!gone) goneTimer = setTimeout(renderGonePop, Math.max(500, NOBODY_THERE_MS - down));
  }

  function resyncStream() {
    releaseStream();
    els.conn.title = "Connection to the room";
    connect();
  }
  document.addEventListener("visibilitychange", () => {
    clearTimeout(releaseTimer);
    if (document.hidden) releaseTimer = setTimeout(releaseStream, 15000);
    else {
      els.conn.title = "Connection to the room";
      connect();
    }
  });


  let composerMin = Number(recall("composerH")) || 0;
  const composerCeiling = () => Math.max(120, els.app.clientHeight - 260);
  function autosizeSoon() {
    autosize();
  }
  let composerBounds = "";
  function autosize() {
    const min = Math.max(36, composerMin);
    const max = Math.min(composerCeiling(), Math.max(180, min));
    if (composerBounds === `${min}/${max}`) return;
    composerBounds = `${min}/${max}`;
    els.input.style.minHeight = `${min}px`;
    els.input.style.maxHeight = `${max}px`;
  }

  let composerShiftQueued = false;
  function watchComposerShift() {
    const list = els.messages;
    if (!list || composerShiftQueued) return;
    const before = { top: list.scrollTop, view: list.clientHeight };
    composerShiftQueued = true;
    requestAnimationFrame(() => {
      composerShiftQueued = false;
      const moved = Math.round(list.scrollTop - before.top);
      if (!moved) return;
      const grew = Math.round(list.clientHeight - before.view);
      const room = Math.round(list.scrollHeight - list.clientHeight);
      noteFinding(`the field changed height: the list ${grew >= 0 ? "grew" : "shrank"} by ${Math.abs(grew)} px and the reader moved ${moved} px (${Math.round(before.top)} → ${Math.round(list.scrollTop)} of ${room}${before.top >= room - grew - 2 ? ", from the very bottom" : ""})`);
    });
  }
  window.addEventListener("resize", autosize);
  autosize();
  {
    const grip = $("#composer-grip");
    let drag = null;
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      drag = { y: Layout.length(e.clientY), h: els.input.offsetHeight };
      grip.setPointerCapture(e.pointerId);
      els.composer.classList.add("resizing");
      e.preventDefault();
    });
    grip.addEventListener("pointermove", (e) => {
      if (!drag) return;
      composerMin = Math.round(Math.min(composerCeiling(), Math.max(36, drag.h + drag.y - Layout.length(e.clientY))));
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

  const TIMED_KINDS = {
    audio: { noun: "sound", icon: "mic", max: 4, types: ["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/flac"], player: () => new Audio() },
    video: { noun: "video", icon: "video", max: 2, types: ["video/mp4", "video/webm", "video/ogg", "video/quicktime"], player: () => document.createElement("video") },
  };
  const timedDraft = Object.fromEntries(Object.keys(TIMED_KINDS).map((kind) => [kind, { pending: [], detached: [], seq: 0 }]));
  const timedMarker = (kind, n) => `[${kind} ${n}]`;
  const soundType = (type) => String(type || "").split(";")[0].trim().toLowerCase();
  const timedKindOf = (type) => Object.keys(TIMED_KINDS).find((kind) => TIMED_KINDS[kind].types.includes(soundType(type))) || null;
  const timedCount = () => Object.values(timedDraft).reduce((n, draft) => n + draft.pending.length, 0);
  const soundLength = (seconds) => (seconds ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}` : "");
  function addTimed(kind, item) {
    const spec = TIMED_KINDS[kind], draft = timedDraft[kind];
    if (draft.pending.length >= spec.max) return void showError(new Error(`up to ${spec.max} ${spec.noun}s per message`));
    item.n = ++draft.seq;
    draft.pending.push(item);
    renderShotsTray();
    insertMarker(timedMarker(kind, item.n));
    return true;
  }

  const LARGE_FILE_BYTES = 100 * 1024 * 1024;
  const sizeWords = (bytes) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`);
  async function mayCopy(file) {
    if (file.size <= LARGE_FILE_BYTES) return true;
    return confirmDialog(`${file.name || "This file"} is ${sizeWords(file.size)}. It will be copied into this room's folder, and the room keeps it there.`, { title: "A large file", okLabel: `Copy ${sizeWords(file.size)} into the room` });
  }
  function sendToRoom(item, blob, as) {
    const room = currentRoom();
    item.progress = 0;
    item.upload = uploadFile(room.id, blob, { as, name: item.name, type: item.mimeType }, (percent) => { item.progress = percent; renderShotsTray(); })
      .then((stored) => { item.stored = stored; renderShotsTray(); return stored; }, (error) => { item.failed = error.message || String(error); renderShotsTray(); throw error; });
    item.upload.catch(() => {});
  }
  async function addTimedFiles(kind, files) {
    if (!currentRoom()) return;
    const spec = TIMED_KINDS[kind];
    for (const file of files) {
      if (!(await mayCopy(file))) continue;
      const url = URL.createObjectURL(file);
      const probe = spec.player();
      const done = (seconds) => {
        const item = { name: file.name || spec.noun, mimeType: soundType(file.type), url, ...(Number.isFinite(seconds) && seconds > 0 ? { seconds: Math.round(seconds * 10) / 10 } : {}) };
        if (addTimed(kind, item)) sendToRoom(item, file, kind);
      };
      probe.addEventListener("loadedmetadata", () => done(probe.duration), { once: true });
      probe.addEventListener("error", () => done(NaN), { once: true });
      probe.preload = "metadata";
      probe.src = url;
    }
  }

  const composerClear = $("#composer-clear");
  function updateComposerClear() {
    composerClear.hidden = !(composer.value.trim() || pendingShots.length || timedCount() || pendingQuotes.length);
  }
  function composerChanged() {
    updateComposerClear();
    autosize();
    watchComposerShift();
  }
  composerClear.addEventListener("click", () => {
    composer.value = "";
    composer.focus();
  });
  function renderShotsTray() {
    updateComposerClear();
    els.shotsTray.hidden = !pendingShots.length && !timedCount();
    els.shotsTray.innerHTML = pendingShots
      .map((shot, i) => `<span class="shot-chip">${uploadMark(shot)}<img src="${esc(shot.url)}" alt=""><span class="shot-n">${shot.n}</span><button type="button" class="shot-drop" data-i="${i}" title="Remove ${esc(shot.name)}">×</button></span>`)
      .concat(Object.entries(timedDraft).flatMap(([kind, draft]) => draft.pending.map((item, i) => `<span class="shot-chip sound-chip">${uploadMark(item)}${ic(TIMED_KINDS[kind].icon)}<span class="sound-len">${esc(soundLength(item.seconds) || item.name)}</span><span class="shot-n">${item.n}</span><button type="button" class="shot-drop" data-timed="${kind}" data-i="${i}" title="Remove ${esc(item.name)}">×</button></span>`)))
      .join("");
  }
  function uploadMark(item) {
    if (item.failed) return `<span class="up-mark failed" data-hint="${esc(item.failed)}">!</span>`;
    if (item.stored) return "";
    return `<span class="up-mark" style="--done:${item.progress || 0}%" data-hint="Sending to the room: ${item.progress || 0} %"></span>`;
  }

  function clearShots(keep = []) {
    for (const draft of Object.values(timedDraft)) {
      for (const item of [...draft.pending, ...draft.detached]) if (item.url && !keep.includes(item)) URL.revokeObjectURL(item.url);
      draft.pending = [];
      draft.detached = [];
      draft.seq = 0;
    }
    for (const shot of [...pendingShots, ...detachedShots]) if (shot.url && !keep.includes(shot)) URL.revokeObjectURL(shot.url);
    pendingShots = [];
    detachedShots = [];
    shotSeq = 0;
    renderShotsTray();
  }

  let detachedShots = [];
  let detachedQuotes = [];
  function reconcileAttachments(text) {
    const named = new Set(Composer.markersIn(text).map((m) => `${m.kind} ${m.n}`));
    const split = (live, waiting, kind) => {
      const all = [...live, ...waiting].sort((a, b) => a.n - b.n);
      return [all.filter((x) => named.has(`${kind} ${x.n}`)), all.filter((x) => !named.has(`${kind} ${x.n}`))];
    };
    const [shots, shotsAway] = split(pendingShots, detachedShots, "img");
    const [quotes, quotesAway] = split(pendingQuotes, detachedQuotes, "quote");
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    let shotsMoved = !same(shots, pendingShots);
    for (const [kind, draft] of Object.entries(timedDraft)) {
      const [live, away] = split(draft.pending, draft.detached, kind);
      if (!same(live, draft.pending)) shotsMoved = true;
      draft.pending = live;
      draft.detached = away;
    }
    const quotesMoved = !same(quotes, pendingQuotes);
    pendingShots = shots; detachedShots = shotsAway;
    pendingQuotes = quotes; detachedQuotes = quotesAway;
    if (shotsMoved) renderShotsTray();
    if (quotesMoved) renderQuotesTray();
  }
  function composerToken(kind, n) {
    if (kind === "img") {
      const shot = pendingShots.find((x) => x.n === n);
      return shot ? { icon: ic("image"), title: `Picture ${n}${shot.name ? `: ${shot.name}` : ""}` } : null;
    }
    if (TIMED_KINDS[kind]) {
      const item = timedDraft[kind].pending.find((x) => x.n === n);
      const noun = TIMED_KINDS[kind].noun;
      return item ? { icon: ic(TIMED_KINDS[kind].icon), title: `${noun[0].toUpperCase()}${noun.slice(1)} ${n}: ${item.name}${item.seconds ? `, ${soundLength(item.seconds)}` : ""}` } : null;
    }
    const quote = pendingQuotes.find((x) => x.n === n);
    return quote ? { icon: ic("quote"), title: `Quote ${n}: ${quote.fromName} — ${quote.text.replace(/\s+/g, " ").slice(0, CHIP_CHARS)}${quote.text.length > CHIP_CHARS ? "…" : ""}` } : null;
  }
  function composerMention(name) {
    const room = currentRoom();
    if (!room) return null;
    if (name.toLowerCase() === "all") return { color: "" };
    const p = findByName(room, name);
    return p && p.kind === "agent" ? { color: colourOf(p) } : null;
  }

  function insertMarker(text) {
    const value = composer.value;
    const start = composer.selectionStart ?? value.length;
    const end = composer.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const tail = /^\s/.test(after) ? "" : " ";
    const marker = `${lead}${text}${tail}`;
    const caret = start + marker.length + (tail ? 0 : 1);
    composer.setRangeText(marker, start, end, "end");
    composer.setSelectionRange(caret, caret);
  }

  function removeMarker(marker) {
    const pattern = new RegExp(` ?${marker.replace(/[[\]]/g, "\\$&")}`, "gi");
    const value = composer.value;
    const caret = composer.selectionStart ?? value.length;
    const removedBefore = (value.slice(0, caret).match(pattern) || []).join("").length;
    const next = value.replace(pattern, "");
    if (next === value) return;
    composer.value = next;
    const at = Math.max(0, caret - removedBefore);
    composer.setSelectionRange(at, at);
  }

  async function addShotFiles(files) {
    const room = currentRoom();
    if (!room) return;
    for (const file of files) {
      if (!SHOT_TYPES.includes(file.type)) {
        showError(new Error(`${file.name || "that image"} is a ${file.type || "kind"} the room cannot show (png, jpeg, webp and gif only)`));
        continue;
      }
      if (pendingShots.length >= SHOTS_MAX) return void showError(new Error(`up to ${SHOTS_MAX} images per message`));
      if (!(await mayCopy(file))) continue;
      const shot = { n: ++shotSeq, name: file.name || "", mimeType: file.type, url: URL.createObjectURL(file) };
      pendingShots.push(shot);
      renderShotsTray();
      insertMarker(shotMarker(shot.n));
      sendToRoom(shot, file, "images");
    }
  }

  function imageFilesFrom(transfer) {
    if (!transfer) return [];
    return Array.from(transfer.files || []).filter((f) => f && f.type && f.type.startsWith("image/"));
  }
  function filesFrom(transfer) {
    return transfer ? Array.from(transfer.files || []).filter(Boolean) : [];
  }

  const attachBtn = $("#attach-btn");
  const attachInput = $("#attach-input");
  let uploads = 0;
  function addFiles(files) {
    const pictures = files.filter((f) => f.type && f.type.startsWith("image/"));
    const timed = files.filter((f) => !pictures.includes(f) && timedKindOf(f.type));
    const documents = files.filter((f) => !pictures.includes(f) && !timed.includes(f));
    if (pictures.length) addShotFiles(pictures);
    for (const kind of Object.keys(TIMED_KINDS)) {
      const ofKind = timed.filter((f) => timedKindOf(f.type) === kind);
      if (ofKind.length) addTimedFiles(kind, ofKind);
    }
    if (documents.length) attachDocuments(documents);
  }
  function insertLine(text) {
    const value = composer.value;
    const start = composer.selectionStart ?? value.length;
    const end = composer.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const lead = before && !/\n$/.test(before) ? "\n" : "";
    const tail = after && !/^\n/.test(after) ? "\n" : "";
    composer.setRangeText(`${lead}${text}${tail}`, start, end, "end");
  }
  async function attachDocuments(files) {
    const room = currentRoom();
    if (!room) return;
    for (const file of files) {
      if (!(await mayCopy(file))) continue;
      uploads += 1;
      els.composer.classList.add("uploading");
      try {
        const r = await uploadFile(room.id, file, { as: "document", name: file.name || "", type: file.type });
        insertLine(r.line);
      } catch (error) {
        showError(error);
      } finally {
        uploads -= 1;
        if (!uploads) els.composer.classList.remove("uploading");
        composer.focus();
      }
    }
  }
  attachBtn.addEventListener("click", () => attachInput.click());
  attachInput.addEventListener("change", () => {
    addFiles(Array.from(attachInput.files || []));
    attachInput.value = "";
  });

  els.shotsTray.addEventListener("click", (e) => {
    const drop = e.target.closest(".shot-drop");
    if (!drop) return;
    if (drop.dataset.timed) {
      const item = timedDraft[drop.dataset.timed]?.pending[Number(drop.dataset.i)];
      if (item) removeMarker(timedMarker(drop.dataset.timed, item.n));
      return;
    }
    const shot = pendingShots[Number(drop.dataset.i)];
    if (shot) removeMarker(shotMarker(shot.n));
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
    detachedQuotes = [];
    quoteSeq = 0;
    renderQuotesTray();
  }

  function addQuote(m, text) {
    if (!m || m.kind !== "chat" || m.pending) return void showError(new Error("only a message the room has can be quoted"));
    if (pendingQuotes.length >= QUOTES_MAX) return void showError(new Error(`up to ${QUOTES_MAX} quotes per message`));
    const fragment = String(text || "").trim() || String(m.text || "").trim();
    if (!fragment) return void showError(new Error("there is no text to quote in that message"));
    const n = ++quoteSeq;
    pendingQuotes.push({ n, id: m.id, seq: m.seq, from: m.from, fromName: m.fromName, ts: m.ts, text: fragment });
    renderQuotesTray();
    insertMarker(quoteMarker(n));
    composer.focus();
  }

  els.quotesTray.addEventListener("click", (e) => {
    const drop = e.target.closest(".qc-drop");
    if (!drop) return;
    const quote = pendingQuotes[Number(drop.dataset.i)];
    if (quote) removeMarker(quoteMarker(quote.n));
  });

  function messageOfNode(node) {
    const el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    const msg = el && el.closest && el.closest(".msg[data-id]");
    const room = currentRoom();
    if (!msg || !room) return null;
    const m = HistoryWindow.knownMessages(room).find((x) => x.id === msg.dataset.id);
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
    return { m, text, rect: Layout.rect(range) };
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
    quotePop.style.left = `${Math.min(Layout.length(window.innerWidth) - 96, Math.max(8, found.rect.left + found.rect.width / 2 - 40))}px`;
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
  function quoteTheSelection() {
    const found = quotePopFor;
    quotePop.hidden = true;
    quotePopFor = null;
    window.getSelection().removeAllRanges();
    if (found) addQuote(found.m, found.text);
  }
  quotePop.addEventListener("click", quoteTheSelection);

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
      .map((node) => ({ m: HistoryWindow.knownMessages(room).find((x) => x.seq === Number(node.dataset.viberoomSeq)), text: node.textContent }))
      .filter((q) => q.m);
  }

  function pasteIntoComposer(e) {
    const files = filesFrom(e.clipboardData);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
      return;
    }
    const quotes = pastedQuotes(e.clipboardData);
    if (!quotes.length) return;
    e.preventDefault();
    for (const q of quotes) addQuote(q.m, q.text);
  }
  for (const target of [els.composer, els.messages]) {
    target.addEventListener("dragover", (e) => {
      if (!imageFilesFrom(e.dataTransfer).length && !(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"))) return;
      e.preventDefault();
      els.composer.classList.add("drop-target");
    });
    target.addEventListener("dragleave", () => els.composer.classList.remove("drop-target"));
    target.addEventListener("drop", (e) => {
      const files = filesFrom(e.dataTransfer);
      els.composer.classList.remove("drop-target");
      if (!files.length) return;
      e.preventDefault();
      addFiles(files);
      composer.focus();
    });
  }
  let typingSentAt = 0;
  els.input.addEventListener("input", () => {
    lastTypedAt = Date.now();
    if (!currentRoom() || !composer.value.trim()) return;
    const now = Date.now();
    if (now - typingSentAt < 2000) return;
    typingSentAt = now;
    post(roomApi("/typing"), {}).catch(() => undefined);
  });
  els.roster.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]");
    const room = currentRoom();
    if (!li || !room) return;
    const p = findById(room, li.dataset.id);
    if (!p) return;
    if (p.kind === "agent") quietGlance(li);
    const fix = e.target.closest('[data-act^="trouble-"]');
    if (fix) {
      troubleAction(room, p, fix.dataset.act.slice("trouble-".length), fix).catch(showError);
      return;
    }
    const action = e.target.closest('[data-ui="row-button"]');
    if (action) {
      const act = action.dataset.act;
      if (act === "panel") return openDetails({ kind: "participant", id: p.id });
      if (act === "last-reply") return void goToLastReply(room, p);
      if (act === "wake") return openReconnectDialog(room, p);
      return;
    }
    if (e.target.closest("button")) return;
    if (p.kind === "human") setView("me");
    else if (p.status === "unstaffed") openStaffDialog(p);
    else void goToLastReply(room, p);
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
    composer.disabled = waiting.length > 0;
    composer.placeholder = waiting.length ? `Summon ${waiting.map((p) => p.name).join(" and ")} to start the conversation` : "Message the room… @Name or /skill";
    els.composer.classList.toggle("gated", waiting.length > 0);
  }


  function quietMinutes(p, now) {
    return Math.max(0, Math.floor((now - p.quiet.since) / 60000));
  }
  function wedgeWords(p, now) {
    const q = p.quiet;
    const minutes = quietMinutes(p, now);
    const head = `Nothing new from ${p.name} for ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    const detail = q.stopping === "forcing" ? "It is not yielding; its process is being replaced; it comes back by itself."
      : q.stopping === "asked" ? "Stopping…"
      : q.nudge === "asking" ? "Asking it for something that changes nothing…"
      : q.nudge === "answered" ? "It still answers — what is stuck is the request to the provider. Stop should work."
      : q.nudge === "silent" ? "It does not answer. Stop replaces its process and keeps its session; Fresh start replaces it too and begins a new one."
      : q.processAlive ? "Its process is running, so it has not crashed — what is silent is the answer."
      : "Its process is gone; only a fresh start can bring it back.";
    return { minutes, head, detail };
  }
  function canNudge(p) {
    return (p.configOptions || []).some((o) => o.currentValue !== undefined && o.currentValue !== null)
      || !!(p.mode && (p.modes || []).some((m) => m.id === p.mode));
  }
  function wedgeButtons(p) {
    const q = p.quiet;
    const askable = canNudge(p);
    return [
      { act: "nudge", label: "Nudge", kind: "plain", disabled: q.nudge === "asking" || !askable,
        title: askable ? "Ask it for something that changes nothing: whether it answers says which of the other two is the right one" : `${p.name} offers no setting to ask about` },
      { act: "stop", label: "Stop", kind: "warn", disabled: !!q.stopping, title: "Cut this reply short" },
      { act: "reconnect", label: "Fresh start", kind: "danger", disabled: false, title: "A fresh session: its memory of this turn is gone, the room's history is not" },
    ];
  }
  function wedgeCardHtml(p, now) {
    const words = wedgeWords(p, now);
    return `<div class="wedge" data-id="${esc(p.id)}" data-turn="${esc(p.quiet.turnId)}">
      ${avatar(p, 32, { vendor: true })}
      <div class="wedge-body"><b>${esc(words.head)}</b> <span>${esc(words.detail)}</span></div>
      <div class="wedge-acts">${wedgeButtons(p)
        .map((b) => UI.html("button", { label: b.label, size: "xs", kind: b.kind, act: `wedge-${b.act}`, title: b.title, disabled: b.disabled }))
        .join("")}</div>
    </div>`;
  }
  function wedgedOnes(room) {
    return room ? room.participants.filter((p) => p.kind === "agent" && p.quiet && !p.muted) : [];
  }
  const wedgeBanner = $("#wedge-banner");
  const wedgeDrawn = new Map();
  let wedgeTick = null;
  function renderWedgeBanner(room) {
    const ones = wedgedOnes(room);
    const now = Date.now();
    wedgeBanner.hidden = ones.length === 0;
    const have = new Map([...wedgeBanner.children].map((el) => [el.dataset.id, el]));
    for (const p of ones) {
      const html = wedgeCardHtml(p, now);
      const el = have.get(p.id);
      if (!el) wedgeBanner.insertAdjacentHTML("beforeend", html);
      else if (wedgeDrawn.get(p.id) !== html) el.outerHTML = html;
      wedgeDrawn.set(p.id, html);
      have.delete(p.id);
    }
    for (const [id, el] of have) {
      el.remove();
      wedgeDrawn.delete(id);
    }
    if (ones.length && !wedgeTick) wedgeTick = setInterval(refreshWedgeTexts, 30000);
    if (!ones.length && wedgeTick) {
      clearInterval(wedgeTick);
      wedgeTick = null;
    }
  }
  function refreshWedgeTexts() {
    const room = currentRoom();
    const now = Date.now();
    for (const el of document.querySelectorAll(".wedge")) {
      const p = room && findById(room, el.dataset.id);
      if (!p || !p.quiet) continue;
      const words = wedgeWords(p, now);
      el.querySelector(".wedge-body").innerHTML = `<b>${esc(words.head)}</b> <span>${esc(words.detail)}</span>`;
      wedgeDrawn.delete(p.id);
    }
  }
  document.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-act^="wedge-"]');
    const card = btn && btn.closest(".wedge");
    if (!card) return;
    const room = currentRoom();
    const p = room && findById(room, card.dataset.id);
    if (!p) return;
    if (!p.quiet || p.quiet.turnId !== card.dataset.turn) return void toast("That turn is over.", "info");
    const act = btn.dataset.act.slice("wedge-".length);
    const turnId = p.quiet.turnId;
    btn.disabled = true;
    const done = () => { if (p.quiet) btn.disabled = false; };
    if (act === "nudge") post(roomApi(`/participants/${encodeURIComponent(p.id)}/nudge`), { by: "the window" }).catch(showError).finally(done);
    else if (act === "stop") post(roomApi(`/participants/${encodeURIComponent(p.id)}/cancel`), { turnId }).catch(showError).finally(done);
    else {
      const n = room.settings?.replayAfterRestart ?? 10;
      confirmDialog(`${p.name} comes back in a fresh session with ${p.notes ? "its own notes and " : ""}the last ${n} messages of this room. Its memory of this turn is gone; the room's history is not.`,
        { title: `A fresh start for ${p.name}?`, okLabel: "Fresh start", danger: true })
        .then((ok) => ok && post(roomApi(`/participants/${encodeURIComponent(p.id)}/respawn`), { memory: true, replay: n }))
        .catch(showError)
        .finally(done);
    }
  });
  els.roster.addEventListener("dblclick", (e) => {
    if (e.target.closest("button, [data-ui=\"row-button\"]")) return;
    const li = e.target.closest("li[data-id]");
    const p = li && findById(currentRoom(), li.dataset.id);
    if (p && p.kind === "agent") insertMention(p.name);
  });
  async function goToLastReply(room, p) {
    const draft = room.messages.find((m) => m.from === p.id && m.streaming);
    const rows = els.messages.querySelectorAll(".msg[data-id]");
    if (draft && rows.length && rows[rows.length - 1].dataset.id === draft.id) return void scrollToBottom("a working vibemate's last line was asked for", { byHand: true });
    if (draft && await jumpToId(draft.id, "end")) return;
    const latest = room.history?.latest?.[p.id];
    if (latest && await revealSeq(latest.seq)) return;
    if (jumpToMessage([...els.messages.querySelectorAll(`.msg.agent[data-from="${cssEscape(p.id)}"]`)].pop())) return;
    const spoke = latest || room.messages.some((m) => m.from === p.id && m.kind === "chat");
    toast(spoke ? `${p.name}'s last reply could not be reached` : `${p.name} has not replied in this room yet`);
  }
  function optimisticOrder(room) {
    return room.messages.reduce((last, m) => Math.max(last, m.displayOrder ?? m.seq ?? 0), 0) + 1;
  }
  els.composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (voiceControl.listening) return void voiceControl.send();
    const text = composer.value.trim();
    const room = currentRoom();
    if ((!text && !pendingShots.length && !timedCount() && !pendingQuotes.length) || !room) return;
    void askToKnock();
    const shots = pendingShots;
    const sounds = timedDraft.audio.pending;
    const clips = timedDraft.video.pending;
    const quotes = pendingQuotes;
    composer.reset("");
    clearShots([...shots, ...sounds, ...clips]);
    clearQuotes();
    typingSentAt = 0;
    const local = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, seq: 0, displayOrder: optimisticOrder(room), from: "human", fromName: (state.settings || {}).humanName || "You", to: [], toNames: [], text, ts: Date.now(), kind: "chat", pending: true };
    if (shots.length) local.images = shots.map((shot) => ({ file: "", name: shot.name, mimeType: shot.mimeType, bytes: 0, n: shot.n, url: shot.url }));
    if (sounds.length) local.audio = sounds.map((sound) => ({ file: "", name: sound.name, mimeType: sound.mimeType, bytes: 0, n: sound.n, url: sound.url, ...(sound.seconds ? { seconds: sound.seconds } : {}), hearing: true }));
    if (clips.length) local.video = clips.map((clip) => ({ file: "", name: clip.name, mimeType: clip.mimeType, bytes: 0, n: clip.n, url: clip.url, ...(clip.seconds ? { seconds: clip.seconds } : {}) }));
    if (quotes.length) local.quotes = quotes.map((q) => ({ ...q }));
    const localId = local.id;
    upsertMessage(room.id, local);
    try {
      await Promise.all([...shots, ...sounds, ...clips].map((item) => item.upload));
      const named = (list) => list.map((x) => ({ file: x.stored.file, name: x.name, mimeType: x.mimeType, n: x.n, ...(x.seconds ? { seconds: x.seconds } : {}) }));
      const r = await post(roomApi("/send"), { text, images: named(shots), audio: named(sounds), video: named(clips), quotes: quotes.map((q) => ({ n: q.n, id: q.id, seq: q.seq, text: q.text })) }, sounds.length ? { deadline: 180000 } : undefined);
      if (r.command) removeMessage(room.id, localId);
      else adoptLocalMessage(room.id, localId, r.id);
      if (shots.length || sounds.length || clips.length) setTimeout(() => { for (const item of [...shots, ...sounds, ...clips]) if (item.url) URL.revokeObjectURL(item.url); }, 60000);
    } catch (error) {
      removeMessage(room.id, localId);
      showError(error);
      pendingShots = shots;
      timedDraft.audio.pending = sounds;
      timedDraft.video.pending = clips;
      pendingQuotes = quotes;
      composer.reset(text);
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
    edited(m);
    if (room.history?.indexed) itemLists.delete(room);
    for (const chosen of [state.expanded, state.watched]) if (chosen.delete(localId)) chosen.add(realId);
    if (room.bodyUses?.has(localId)) { room.bodyUses.set(realId, room.bodyUses.get(localId)); room.bodyUses.delete(localId); }
    if (measuredRoom === roomId && measuredRows.has(localId)) { measuredRows.set(realId, measuredRows.get(localId)); measuredRows.delete(localId); }
    if (settledReader?.roomId === roomId && settledReader.anchor?.id === localId) settledReader.anchor.id = realId;
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
    chip.style.color = colourOf(p);
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
      const caret = textarea.selectionStart ?? textarea.value.length;
      textarea.setRangeText(`@${p.name} `, m.start, caret, "end");
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
  attachMentions(composer, els.mentionMenu, { onChange: autosizeSoon });
  attachSlashMenu(composer, els.mentionMenu);
  els.input.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      els.composer.requestSubmit();
    }
  });


  els.detailsResizer.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const startX = Layout.length(event.clientX);
    const startW = Layout.rect(els.details).width;
    els.app.classList.add("resizing");
    const toward = panelSide() === "left" ? -1 : 1;
    const move = (e) => applyDetailsWidth(startW + toward * (startX - Layout.length(e.clientX)), false);
    const up = (e) => {
      els.app.classList.remove("resizing");
      applyDetailsWidth(startW + toward * (startX - Layout.length(e.clientX)), true);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
  els.detailsResizer.addEventListener("dblclick", () => {
    const key = detailsKey();
    remember(`${DETAILS_WIDTH_KEY}.${key}`, "");
    fitDetailsWidth();
  });


  els.rail.querySelectorAll(".rail-item[data-nav]").forEach((b) => {
    b.addEventListener("click", () => {
      const nav = b.dataset.nav;
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
  const sidePane = $(".side");
  const BUBBLE_CAP = 1400;
  const mainPane = $(".main");
  function bubblesKeepTheirWidth() {
    if (!mainPane) return false;
    const now = mainPane.clientWidth;
    const other = now + (els.app.classList.contains("side-collapsed") ? -220 : 220);
    return Math.min(now, other) - 84 >= BUBBLE_CAP;
  }
  function setSideOpen(open) {
    const glide = bubblesKeepTheirWidth();
    els.app.classList.toggle("glide", glide);
    els.app.classList.toggle("side-collapsed", !open);
    if (glide) {
      clearTimeout(setSideOpen.timer);
      setSideOpen.timer = setTimeout(() => els.app.classList.remove("glide"), 400);
    } else if (sidePane) {
      sidePane.classList.remove("arrive");
      void sidePane.offsetWidth;
      sidePane.classList.add("arrive");
      sidePane.addEventListener("animationend", () => sidePane.classList.remove("arrive"), { once: true });
    }
    remember("sideOpen", open ? "1" : "0");
    els.sideToggle.title = open ? "Fold this column" : "Unfold this column";
    els.sideToggle.innerHTML = ic(open ? "collapse" : "expand");
  }
  els.sideToggle.addEventListener("click", () => setSideOpen(els.app.classList.contains("side-collapsed")));
  let lastScrollTop = 0;
  let lastMovedAt = 0;
  let lastUserScrollAt = 0;
  for (const type of ["wheel", "touchmove", "keydown", "mousedown"]) {
    els.messages.addEventListener(type, () => (lastUserScrollAt = Date.now()), { passive: true });
  }
  const WHEEL_GESTURE_GAP_MS = 300;
  const wheelGesture = { lastAt: 0, beganAtEnd: false };
  function restedAtEnd(now) {
    return atEnd() && els.messages.scrollTop === lastScrollTop && now - lastMovedAt > WHEEL_GESTURE_GAP_MS;
  }
  function wheelPastEnd(e) {
    const now = Date.now();
    if (now - wheelGesture.lastAt > WHEEL_GESTURE_GAP_MS) wheelGesture.beganAtEnd = restedAtEnd(now);
    wheelGesture.lastAt = now;
    if (e.deltaY > 0 && wheelGesture.beganAtEnd && !stuck && atEnd() && !humanHoldsText()) scrollToBottom("the wheel pushed past the end", { byHand: true });
  }
  els.messages.addEventListener("wheel", wheelPastEnd, { passive: true });
  const WHEEL_NOTCH_PX = 100;
  const WHEEL_STEP_DEFAULT = 20;
  const WHEEL_STEP_MS = 150;
  const GLIDE_TAU_MS = 240;
  const GLIDE_MIN_SPEED = 0.02;
  const GLIDE_NOTCH_MIN_PX = 40;
  const GLIDE_STREAM_GAP_MS = 25;
  const GLIDE_RATCHET_GAP_MS = 40;
  const GLIDE_RATCHET_MIN_PX = 8;
  const glide = { speed: 0, target: -1, from: 0, since: 0, at: 0, expectedTop: -1, raf: 0, gesture: { lastAt: 0, takes: false, stream: false, prevAbs: 0 } };
  const wheelTrace = [];
  globalThis.VIBEROOM_WHEEL = wheelTrace;
  const GLIDE_LATE_FRAME_MS = 24;
  function traceWheel(entry) {
    if (!devBuild()) return;
    wheelTrace.push({ at: performance.now(), ...entry });
    if (wheelTrace.length > 600) wheelTrace.splice(0, wheelTrace.length - 400);
  }
  function glideStop(why) {
    if (why && (glide.raf || glide.speed || glide.target >= 0)) traceWheel({ kind: "stop", why });
    glide.speed = 0;
    glide.target = -1;
    glide.expectedTop = -1;
    if (glide.raf) cancelAnimationFrame(glide.raf);
    glide.raf = 0;
  }
  function wheelFollowsShift() {
    if (glide.expectedTop < 0) return;
    const shift = els.messages.scrollTop - glide.expectedTop;
    if (Math.abs(shift) <= 1) return;
    if (glide.target >= 0) { glide.from += shift; glide.target += shift; }
    traceWheel({ kind: "shift", px: Math.round(shift) });
  }
  function wheelSettings() {
    const s = state.settings || {};
    return { percent: Number.isFinite(s.wheelStepPercent) ? s.wheelStepPercent : WHEEL_STEP_DEFAULT, glides: s.wheelInertia === true };
  }
  function wheelDistance(e, height, percent) {
    if (e.deltaMode === 2) return e.deltaY * height * 0.8;
    const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / WHEEL_NOTCH_PX;
    return notches * (percent / 100) * height;
  }
  function glideFrame(now) {
    glide.raf = 0;
    const el = els.messages;
    wheelFollowsShift();
    const late = now - glide.at;
    const dt = Math.min(64, Math.max(0, late));
    glide.at = now;
    const step = glide.speed * dt;
    glide.speed *= Math.exp(-dt / GLIDE_TAU_MS);
    const limit = el.scrollHeight - el.clientHeight;
    const top = Math.max(0, Math.min(limit, el.scrollTop + step));
    el.scrollTop = top;
    glide.expectedTop = el.scrollTop;
    if (late > GLIDE_LATE_FRAME_MS) traceWheel({ kind: "frame", late: Math.round(late), step: Math.round(step) });
    if ((top <= 0 && glide.speed < 0) || (top >= limit && glide.speed > 0)) return glideStop("an edge");
    if (Math.abs(glide.speed) < GLIDE_MIN_SPEED) return glideStop("came to rest");
    glide.raf = requestAnimationFrame(glideFrame);
  }
  function stepFrame(now) {
    glide.raf = 0;
    const el = els.messages;
    wheelFollowsShift();
    const late = now - glide.at;
    glide.at = now;
    const limit = el.scrollHeight - el.clientHeight;
    const target = Math.max(0, Math.min(limit, glide.target));
    const done = Math.min(1, Math.max(0, now - glide.since) / WHEEL_STEP_MS);
    const before = el.scrollTop;
    el.scrollTop = done >= 1 ? target : glide.from + (target - glide.from) * (1 - (1 - done) ** 3);
    glide.expectedTop = el.scrollTop;
    if (late > GLIDE_LATE_FRAME_MS) traceWheel({ kind: "frame", late: Math.round(late), step: Math.round(el.scrollTop - before) });
    if (done >= 1) return glideStop(target <= 0 || target >= limit ? "an edge" : "arrived");
    glide.raf = requestAnimationFrame(stepFrame);
  }
  function innerScrollTakes(e) {
    for (let node = e.target; node && node !== els.messages; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight && /^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowY)
        && (e.deltaY < 0 ? node.scrollTop > 0 : node.scrollTop < node.scrollHeight - node.clientHeight - 1)) return true;
    }
    return false;
  }
  els.messages.addEventListener("wheel", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || !e.deltaY) return;
    const now = performance.now();
    const gesture = glide.gesture;
    const gap = e.timeStamp - gesture.lastAt;
    const fresh = gap > WHEEL_GESTURE_GAP_MS;
    gesture.lastAt = e.timeStamp;
    let upgraded = false;
    if (fresh) {
      gesture.takes = e.deltaMode !== 0 || Math.abs(e.deltaY) >= GLIDE_NOTCH_MIN_PX;
      gesture.stream = false;
    } else if (!gesture.takes && !gesture.stream) {
      if (gap < GLIDE_STREAM_GAP_MS) gesture.stream = true;
      else if (gap >= GLIDE_RATCHET_GAP_MS && Math.abs(e.deltaY) >= GLIDE_RATCHET_MIN_PX
        && Math.abs(Math.abs(e.deltaY) - gesture.prevAbs) < 2) gesture.takes = upgraded = true;
    }
    gesture.prevAbs = Math.abs(e.deltaY);
    const heard = { kind: "wheel", dy: Math.round(e.deltaY * 10) / 10, mode: e.deltaMode, gap: fresh ? null : Math.round(gap), waited: Math.round(now - e.timeStamp), ...(fresh ? { busy: busyLabel() } : {}) };
    if (!gesture.takes) {
      traceWheel({ ...heard, took: gesture.stream ? "native: a stream" : "native" });
      return glideStop("a wheel event the wheel does not take");
    }
    if (innerScrollTakes(e)) {
      traceWheel({ ...heard, took: "native: a box inside scrolls" });
      return glideStop("a box inside takes the wheel");
    }
    const el = els.messages;
    const { percent, glides } = wheelSettings();
    const distance = wheelDistance(e, el.clientHeight, percent);
    if (distance > 0 ? el.scrollTop >= el.scrollHeight - el.clientHeight - 1 : el.scrollTop <= 0) {
      traceWheel({ ...heard, took: "native: at the edge" });
      return glideStop("a push at the edge");
    }
    e.preventDefault();
    if (distance < 0 && stuck) leaveTheEnd();
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (glides && !still) {
      const brake = Math.sign(distance) !== Math.sign(glide.speed) && glide.speed !== 0;
      traceWheel({ ...heard, took: brake ? "glide: a brake" : upgraded ? "glide: the ratchet's second notch" : "glide" });
      if (glide.target >= 0) glideStop();
      if (Math.sign(distance) !== Math.sign(glide.speed)) glide.speed = 0;
      if (!glide.raf) {
        glide.at = now;
        glide.expectedTop = -1;
        glide.raf = requestAnimationFrame(glideFrame);
      }
      glide.speed += distance / GLIDE_TAU_MS;
      return;
    }
    traceWheel({ ...heard, took: still ? "step: at once (reduced motion)" : upgraded ? "step: the ratchet's second notch" : "step" });
    if (glide.speed) glideStop();
    const limit = el.scrollHeight - el.clientHeight;
    glide.target = Math.max(0, Math.min(limit, (glide.target >= 0 ? glide.target : el.scrollTop) + distance));
    if (still) {
      el.scrollTop = glide.target;
      glide.target = -1;
      return;
    }
    glide.from = el.scrollTop;
    glide.since = now;
    if (!glide.raf) {
      glide.at = now;
      glide.expectedTop = -1;
      glide.raf = requestAnimationFrame(stepFrame);
    }
  }, { passive: false });
  for (const type of ["pointerdown", "keydown", "touchstart"]) els.messages.addEventListener(type, (e) => glideStop(`a ${e.type}`), { passive: true });
  els.messages.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target.closest && e.target.closest("button, a, input, textarea, select, summary, [role=button]"))) return;
    textPress = e.target.nodeType === 3 ? e.target.parentElement : e.target;
    heldTextElement = textPart(textPress);
  });
  const releasePress = () => {
    if (!textPress) return;
    textPress = null;
    if (state.view === "room" && !humanHoldsText()) {
      rememberReleasedText();
      renderMessagesSoon("the text press was released");
      resumeAfterText();
    }
  };
  for (const type of ["pointerup", "pointercancel"]) document.addEventListener(type, releasePress, { passive: true });
  window.addEventListener("blur", releasePress);
  els.messages.addEventListener("scroll", () => {
    if (state.view !== "room") return;
    if (els.messages.scrollTop !== lastScrollTop) lastMovedAt = Date.now();
    if (rowPrices.stamp !== pricesStamp()) { repriceSoon(); return; }
    const top = els.messages.scrollTop;
    const byHand = Date.now() - lastUserScrollAt < 700;
    const stillAtEnd = els.messages.scrollHeight - top - els.messages.clientHeight <= 1;
    noteArrival(byHand);
    if (byHand && calm.reserve > 0) calmRelease();
    if (byHand) {
      if (top < lastScrollTop) {
        stuck = false;
        readingAway = true;
      } else if (top > lastScrollTop && !humanHoldsText() && deliberateReturn()) {
        stuck = true;
        readingAway = false;
      }
    } else if (!calm.held && top < lastScrollTop && !stillAtEnd) {
      stuck = false;
      readingAway = true;
    }
    if (stuck) calm.held = false;
    lastScrollTop = top;
    rememberReader();
    followWindowSoon();
    els.jumpLatest.hidden = stuck;
    updateTimelineView();
    updateWorkingNow();
    if (stuck) clearNotes();
    else pruneDoneNotes();
    foldSettleSoon();
  });
  els.jumpLatest.addEventListener("click", () => scrollToBottom("Latest was pressed", { byHand: true }));
  document.addEventListener("mousedown", (e) => {
    if (!state.detailsOpen) return;
    if (e.target.closest("#details, #side, .rail, .chat-actions, dialog, .mention-menu, .lightbox, .tl-pop, #pins-panel")) return;
    closeDetails();
  });
  setSideOpen(recall("sideOpen") !== "0");
  $("#rail-logo").addEventListener("click", () => setView("home"));
  $("#rail-new-room").addEventListener("click", openRoomDialog);
  new MutationObserver(renderGonePop).observe(els.conn, { attributes: true, attributeFilter: ["class"] });
  if (recall("railOpen") === "1") els.app.classList.add("rail-open");
  els.backToRooms.addEventListener("click", () => {
    setView("rooms");
    remember("view", "rooms");
  });
  els.roomSearch.addEventListener("input", () => {
    state.roomSearch = els.roomSearch.value.trim();
    renderSideRooms();
  });
  let searchTimer = 0;
  els.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, 120);
  });
  let storeSearchTimer = 0;
  let allConversationSelection = null;
  const conversationSelection = $("#conversation-selection");
  function clearConversationSelection() {
    allConversationSelection = null;
    conversationSelection.hidden = true;
  }
  async function copyWholeConversation() {
    const selected = allConversationSelection;
    if (!selected || selected.busy) return;
    selected.busy = true;
    const button = conversationSelection.querySelector('[data-act="copy"]');
    button.disabled = true; button.textContent = "Copying…";
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(selected.roomId)}/export?format=md&version=${encodeURIComponent(selected.version)}`, { signal: deadline(30000) });
      if (!response.ok) {
        const detail = await response.json();
        throw new Error(detail.code === "history_changed" ? "The conversation changed. Select it again to copy the current record." : detail.error || "The conversation could not be loaded.");
      }
      const text = await response.text();
      if (allConversationSelection !== selected || currentRoom()?.id !== selected.roomId) return;
      await navigator.clipboard.writeText(text);
      toast("Whole saved conversation copied as Markdown.", "ok");
    } catch (error) { if (allConversationSelection === selected) showError(error); }
    finally { selected.busy = false; button.disabled = false; button.textContent = "Copy"; }
  }
  conversationSelection.querySelector('[data-act="copy"]').addEventListener("click", () => void copyWholeConversation());
  conversationSelection.querySelector('[data-act="clear"]').addEventListener("click", clearConversationSelection);
  document.addEventListener("pointerdown", event => {
    if (allConversationSelection && !conversationSelection.contains(event.target)) clearConversationSelection();
  });
  document.addEventListener("focusin", event => {
    if (allConversationSelection && !conversationSelection.contains(event.target) && !els.messages.contains(event.target)) clearConversationSelection();
  });
  function shortcutLetter(event) {
    if (/^[a-z]$/i.test(event.key || "")) return event.key.toLowerCase();
    const place = /^Key([A-Z])$/.exec(event.code || "");
    return place ? place[1].toLowerCase() : "";
  }
  function isShortcut(event, letter) {
    return Boolean(event.ctrlKey || event.metaKey) && !event.altKey && shortcutLetter(event) === letter;
  }
  function findFieldOnScreen() {
    if (els.fileDialog.open) return els.fvTools.hidden ? null : els.fvSearch;
    if (document.querySelector("dialog[open]")) return null;
    if (state.view === "room") return els.search;
    if (state.view === "home" || state.view === "rooms") return els.roomSearch;
    return null;
  }
  function openFindOnScreen(event) {
    if (!isShortcut(event, "f")) return;
    const field = findFieldOnScreen();
    if (!field) return;
    event.preventDefault();
    if (field === els.search) clearConversationSelection();
    field.focus();
    field.select();
  }
  document.addEventListener("keydown", openFindOnScreen);
  document.addEventListener("keydown", event => {
    if (state.view !== "room" || document.querySelector("dialog[open]")) return;
    if (event.key === "Escape" && allConversationSelection) {
      clearConversationSelection(); event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
    if (isShortcut(event, "a")) {
      const room = currentRoom();
      if (!room) return;
      event.preventDefault(); window.getSelection()?.removeAllRanges();
      allConversationSelection = { roomId: room.id, version: room.history?.version || "", busy: false };
      conversationSelection.hidden = false;
      els.messages.focus({ preventScroll: true });
    } else if (isShortcut(event, "c") && allConversationSelection) {
      event.preventDefault(); void copyWholeConversation();
    }
  });
  const searchPanel = $("#search-panel");
  const storeSearch = { scope: recall("searchScope") || "all", sort: "rank", seq: 0 };
  els.search.addEventListener("input", () => {
    clearTimeout(storeSearchTimer);
    const q = els.search.value.trim();
    if (q.length < 2) {
      storeSearch.seq++;
      searchPanel.hidden = true;
      return;
    }
    storeSearchTimer = setTimeout(() => searchStore(q), 300);
  });
  els.search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { storeSearch.seq++; searchPanel.hidden = true; }
    if (e.key === "Enter" && els.search.value.trim().length >= 2) {
      clearTimeout(storeSearchTimer);
      searchStore(els.search.value.trim());
    }
  });
  async function searchStore(q) {
    if (q.length < 2) { storeSearch.seq++; searchPanel.hidden = true; return; }
    const room = currentRoom();
    if (!room) return;
    const mine = ++storeSearch.seq;
    const params = new URLSearchParams({ q, rooms: storeSearch.scope === "room" ? room.id : "all", sort: storeSearch.sort, limit: "40" });
    let data;
    try {
      data = await get(`/api/search?${params}`);
    } catch (error) {
      data = { hits: [], unavailable: error.message };
    }
    if (mine !== storeSearch.seq) return;
    renderSearchPanel(q, data);
  }
  function renderSearchPanel(q, data) {
    const room = currentRoom();
    const rooms = new Set(data.hits.map((h) => h.roomId));
    const toggle = (key, value, label) => `<button type="button" class="search-toggle${storeSearch[key] === value ? " on" : ""}" data-key="${key}" data-value="${value}">${label}</button>`;
    const head = `<div class="search-head"><span>${data.unavailable ? esc(data.unavailable) : `${data.hits.length} hit${data.hits.length === 1 ? "" : "s"} in ${rooms.size} room${rooms.size === 1 ? "" : "s"}${data.usedTrigram ? " · by substring" : ""}${data.stale && data.stale.length ? ` · store out of sync: ${esc(data.stale.join(", "))}` : ""}`}</span><span class="spacer"></span>${toggle("scope", "room", "This room")}${toggle("scope", "all", "All rooms")}${toggle("sort", "rank", "Best")}${toggle("sort", "newest", "Newest")}</div>`;
    const rows = data.hits.map((h) => {
      const p = room ? findById(room, h.from) : null;
      const snippet = esc(h.snippet).replace(/\[([^\]]{1,80})\]/g, "<mark>$1</mark>");
      return `<div class="tl-row search-row" data-room="${esc(h.roomId)}" data-seq="${h.seq}"><span class="search-meta"><span class="search-room">${esc(h.roomName)}</span><b style="${p ? `color:${esc(p.color)}` : ""}">${esc(h.fromName)}</b>${h.fromNow ? `<span class="now-name">Now: ${esc(h.fromNow)}</span>` : ""}<span>${esc(fullTime(h.ts))}</span><span>#${h.seq}</span>${h.deleted ? "<span>· removed</span>" : ""}</span><span class="search-snippet">${snippet}</span></div>`;
    });
    searchPanel.innerHTML = head + searchNamesHtml(data.names || []) + (rows.length ? rows.join("") : data.unavailable ? "" : `<div class="search-empty">Nothing matches "${esc(q)}". Words are ANDed: try fewer, a phrase in quotes, or word*.</div>`);
    searchPanel.hidden = false;
  }
  function searchNamesHtml(names) {
    const seen = new Set();
    const lines = [];
    for (const n of names) {
      for (const other of n.others) {
        const key = `${n.term.toLowerCase()}\u0000${other.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const who = n.now && n.now.toLowerCase() !== n.term.toLowerCase() ? `${esc(n.term)} is called ${esc(n.now)} now` : `${esc(n.term)} was called ${esc(other)} before`;
        const label = n.now && n.now.toLowerCase() !== n.term.toLowerCase() && n.now === other ? `Search ${esc(other)}` : `Search ${esc(other)} too`;
        lines.push(`<div class="search-name">${ic("info")}<span>${who}: older messages may name them so.</span><button type="button" class="linklike search-name-swap" data-term="${esc(n.term)}" data-other="${esc(other)}">${label}</button></div>`);
      }
    }
    return lines.join("");
  }
  searchPanel.addEventListener("click", (e) => {
    const swap = e.target.closest(".search-name-swap");
    if (swap) {
      const words = els.search.value.trim().split(/\s+/);
      els.search.value = words.map((w) => (w.replace(/^@/, "").replace(/\*$/, "").toLowerCase() === swap.dataset.term.toLowerCase() ? swap.dataset.other : w)).join(" ");
      searchStore(els.search.value.trim());
      return;
    }
    const toggleBtn = e.target.closest(".search-toggle");
    if (toggleBtn) {
      storeSearch[toggleBtn.dataset.key] = toggleBtn.dataset.value;
      if (toggleBtn.dataset.key === "scope") remember("searchScope", toggleBtn.dataset.value);
      searchStore(els.search.value.trim());
      return;
    }
    const row = e.target.closest(".search-row");
    if (!row) return;
    const roomId = row.dataset.room;
    const seq = row.dataset.seq;
    storeSearch.seq++;
    searchPanel.hidden = true;
    const jump = () => revealSeq(Number(seq));
    els.search.value = "";
    applySearch();
    if (roomId === state.currentRoomId) return void jump();
    selectRoom(roomId);
    requestAnimationFrame(() => requestAnimationFrame(jump));
  });
  document.addEventListener("click", (e) => {
    if (!searchPanel.hidden && !e.target.closest("#search-panel, .chat-actions .search")) searchPanel.hidden = true;
  });
  function applySearch() {
    const wasFiltered = !!state.search;
    state.search = "";
    const room = currentRoom();
    if (!room) return;
    els.messages.classList.remove("searching");
    for (const el of els.messages.querySelectorAll(".hidden-by-search")) el.classList.remove("hidden-by-search");
    if (wasFiltered) renderMessagesSoon("the local search filter was cleared");
  }
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
    composer.setRangeText(text, composer.selectionStart, composer.selectionEnd, "end");
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
          composer.focus();
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
        const directory = link.dataset.openKind === "directory";
        if (!directory && IMAGE_RE.test(target) && !/^(https?:|mailto:)/i.test(target) && /[\\/]/.test(target)) {
          openLightbox(imageUrl(target), target.split(/[\\/]/).pop());
          return;
        }
        if (!directory && readableInRoom(target)) {
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
  els.chatInfoBtn.addEventListener("click", () => openDetails({ kind: "room" }));
  $("#automations-btn").addEventListener("click", () => {
    const room = currentRoom();
    if (room) void window.ViberoomAutomations.open(room.id, id => currentRoom()?.id === room.id ? jumpToId(id).catch(showError) : false, confirmDialog);
  });

  async function openCarry(room) {
    await window.ViberoomCarry.open(room, { openRoom: (id) => selectRoom(id) });
  }

  els.carryBtn.addEventListener("click", () => {
    const room = currentRoom();
    if (room) void openCarry(room);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.detailsOpen && !document.querySelector("dialog[open]") && !editingInDetails()) closeDetails();
  });
  window.addEventListener("beforeunload", () => remember("view", state.view));

  const TICK_H = 5;
  const MINE_SLOT_H = 2;
  const PIN_GLYPH_H = 10.5;
  const VIEW_MIN_H = 6;
  const DENSITY = 25;
  function createTimeline(root, pick, opts) {
    const tickH = opts.slotH || TICK_H;
    const t = { el: root, ticks: root.querySelector(".tl-ticks"), view: root.querySelector(".tl-view"), pop: root.querySelector(".tl-pop"), items: [] };
    const placeDrawn = new WeakMap();
    function mapOf(room, items) {
      return `${room.id}|${items.length}|${items[0]?.name}|${items[items.length - 1]?.name}`;
    }
    function sameMap(room) {
      const items = room && state.view === "room" && !state.search ? listItems(room) : null;
      return !!items && !!t.map && t.map === mapOf(room, items) && !!listAccount && listAccount.items.length === items.length;
    }
    function render(force) {
      const room = currentRoom();
      if (!force && sameMap(room)) {
        if (t.el.hidden) return;
        if (t.pos && els.messages.scrollHeight > els.messages.clientHeight + 1) { place(); return; }
      }
      const nodes = room && state.view === "room" ? pick(room) : [];
      const items = room && state.view === "room" && !state.search ? listItems(room) : null;
      t.map = items && listAccount && listAccount.items.length === items.length ? mapOf(room, items) : null;
      t.items = nodes;
      t.slots = null;
      t.el.hidden = nodes.length === 0;
      t.pop.hidden = true;
      aim(null);
      if (!nodes.length) return;
      const total = els.messages.scrollHeight || 1;
      const h = Math.max(0, t.ticks.clientHeight - tickH);
      const fits = els.messages.scrollHeight <= els.messages.clientHeight + 1;
      const stripTop = fits ? Layout.rect(t.ticks).top : 0;
      const tops = fits
        ? nodes.map((row) => { const node = drawnRow(row.id); return node ? Layout.rect(node).top - stripTop : 0; })
        : nodes.map((row) => row.top);
      t.pos = fits ? null : tops;
      if (!fits && globalThis.VIBEROOM_TIMELINE) {
        t.heights = null;
        drawSlots(nodes, tops, total);
        settleLater();
        return;
      }
      t.heights = fits ? null : nodes.map((row) => row.height);
      const frag = document.createDocumentFragment();
      nodes.forEach((el, i) => {
        const tick = document.createElement("div");
        const pinned = el.pinned;
        tick.className = `tl-tick${pinned ? " pinned i i-pin-long" : ""}`;
        tick.dataset.i = i;
        if (opts.colorOf) tick.style.setProperty("--tick", opts.colorOf(room, el));
        tick.style.top = `${Math.round(fits ? Math.max(0, Math.min(h, tops[i] + (pinned ? 0 : 6))) : (tops[i] / total) * h)}px`;

        if (pinned) {
          const glyph = document.createElement("span");
          glyph.className = "tl-pin-glyph";
          glyph.title = "Pinned · go to it";
          tick.appendChild(glyph);
        }
        frag.appendChild(tick);
      });
      t.ticks.replaceChildren(frag);
      t.inView = null;
      updateView();
      if (fits) settleLater();
    }
    function settleLater() {
      if (t.following) return;
      t.following = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        render();
        t.following = false;
      }));
    }
    function firstBy(nodes, authors, slot, who) {
      for (let i = slot.first; i >= 0 && i < slot.first + slot.count && i < nodes.length; i++) {
        if (authors[i] === who) return i;
      }
      return slot.first;
    }
    function drawSlots(nodes, tops, total) {
      const { slotsOf, pinGroups, INK_FLOOR } = globalThis.VIBEROOM_TIMELINE;
      const height = t.ticks.clientHeight;
      const places = Math.max(1, Math.floor(height / tickH));
      const authors = opts.colorOf ? nodes.map((row) => row.m.from || "") : nodes.map(() => "me");
      const slots = slotsOf({ pos: tops, authors, total, slots: places });
      t.slots = slots;
      t.total = total;
      const held = [];
      for (let at = 0; at < slots.length; at++) {
        const slot = slots[at];
        let count = 0;
        for (let i = slot.first; i >= 0 && i < slot.first + slot.count && i < nodes.length; i++) {
          if (nodes[i].pinned) count++;
        }
        if (count) held.push({ at, count });
      }
      const drawnPins = new Map(pinGroups(held, tickH, PIN_GLYPH_H).map((group) => [group.at, group.count]));
      KeyedList.patch(t.ticks, slots, {
        key: "at",
        id: (_slot, at) => at,
        make: () => Object.assign(document.createElement("div"), { className: "tl-slot" }),
        fill: (el, slot, at) => {
          const held = slot.count ? nodes[firstBy(nodes, authors, slot, slot.author)] : null;
          const colour = opts.colorOf && held ? opts.colorOf(currentRoom(), held) : "";
          const mix = `${Math.round((INK_FLOOR + (1 - INK_FLOOR) * slot.strength) * DENSITY)}%`;
          const before = slot.separator ? 1 : 0;
          const after = slots[at + 1] && slots[at + 1].separator ? 1 : 0;
          const pins = drawnPins.get(at) || 0;
          const drawn = `${slot.count}|${colour}|${mix}|${before}|${after}|${pins}`;
          if (placeDrawn.get(el) === drawn) return;
          placeDrawn.set(el, drawn);
          el.hidden = !slot.count;
          if (!slot.count) return;
          if (colour) el.style.setProperty("--tick", colour);
          el.style.setProperty("--mix", mix);
          el.style.top = `${at * tickH + before}px`;
          el.style.height = `${tickH - before - after}px`;
          if (pins) {
            el.classList.add("pinned", "i", "i-pin-long");
            const glyph = el.querySelector(".tl-pin-glyph") || el.appendChild(document.createElement("span"));
            glyph.className = "tl-pin-glyph";
            glyph.title = pins === 1 ? "Pinned · go to it" : `${pins} pinned · go to them`;
            if (pins > 1) glyph.dataset.many = String(pins);
            else delete glyph.dataset.many;
          } else {
            el.classList.remove("pinned", "i", "i-pin-long");
            el.querySelector(".tl-pin-glyph")?.remove();
          }
        },
      });
      t.inView = null;
      updateView();
    }
    function rescale() {
      if (t.el.hidden || !t.pos) return;
      render();
    }
    function place() {
      const account = listAccount, room = currentRoom();
      if (!account || !room) return;
      const items = listItems(room);
      for (const row of t.items) if (items[row.at]?.m) row.m = items[row.at].m;
      const total = els.messages.scrollHeight || 1;
      t.pos = t.items.map((row) => ListIndex.topOf(account, row.at));
      if (t.slots) {
        drawSlots(t.items, t.pos, total);
        return;
      }
      t.heights = t.items.map((row) => ListIndex.heightAt(account, row.at));
      const h = Math.max(0, t.ticks.clientHeight - TICK_H);
      const ticks = t.ticks.children;
      for (let i = 0; i < ticks.length && i < t.pos.length; i++) ticks[i].style.top = `${Math.round((t.pos[i] / total) * h)}px`;
      updateView();
    }
    function updateView() {
      if (t.el.hidden) return;
      const m = els.messages;
      const total = m.scrollHeight || 1;
      const h = t.ticks.clientHeight;
      const top = m.scrollTop;
      const bottom = top + m.clientHeight;
      t.view.style.top = `${(top / total) * h}px`;
      t.view.style.height = `${Math.max(VIEW_MIN_H, (m.clientHeight / total) * h)}px`;
      if (t.slots) {
        const seen = t.inView || [];
        const next = t.slots.map((slot) => slot.count > 0 && slot.to > top && slot.from < bottom);
        const drawn = t.ticks.children;
        for (let k = 0; k < drawn.length; k++) {
          const at = Number(drawn[k].dataset.at);
          if (seen[at] === next[at]) continue;
          drawn[k].classList.toggle("in-view", next[at]);
        }
        t.inView = next;
        return;
      }
      const seen = t.inView || [];
      const next = t.items.map((el, i) => (t.pos ? t.pos[i] + t.heights[i] > top && t.pos[i] < bottom : true));
      next.forEach((on, i) => {
        if (seen[i] === on) return;
        const tick = t.ticks.children[i];
        if (tick) tick.classList.toggle("in-view", on);
      });
      t.inView = next;
    }
    function rowHtml(k, cls) {
      const el = t.items[k];
      const av = opts.avatarOf ? `<span class="tl-av">${opts.avatarOf(currentRoom(), el)}</span>` : "";
      const pinned = el.pinned;
      return `<div class="tl-row ${cls}${pinned ? " pinned" : ""}" data-i="${k}">${av}<span class="tl-text">${esc(timelineText(el))}</span>${pinned ? `<span class="tl-pin" title="Pinned">${ic("pin")}</span>` : ""}</div>`;
    }
    let shownAt = -1;
    function showPop(i, keepPlace, overSlot) {
      shownAt = i;
      const rows = [[i - 2, "faded far"], [i - 1, "faded"], [i, "current"], [i + 1, "faded"], [i + 2, "faded far"]].filter(([k]) => t.items[k]);
      t.pop.innerHTML = rows.map(([k, c]) => rowHtml(k, c)).join("");
      t.pop.hidden = false;
      t.ticks.querySelectorAll(".active").forEach((x) => x.classList.remove("active"));
      const tick = (t.slots ? slotAt(i) : t.ticks.children[i]) || overSlot;
      markMessage(i);
      aim(t.items[i]);
      if (tick) tick.classList.add("active");
      if (keepPlace) return;
      const current = t.pop.querySelector(".tl-row.current");
      let top = (tick ? tick.offsetTop : 0) - (current ? current.offsetTop + current.offsetHeight / 2 : 20) + tickH / 2;
      top = Math.max(0, Math.min(top, t.el.clientHeight - t.pop.offsetHeight));
      t.pop.style.top = `${top}px`;
    }
    function hidePop() {
      shownAt = -1;
      t.pop.hidden = true;
      t.ticks.querySelectorAll(".active").forEach((x) => x.classList.remove("active"));
      if (t.mark) t.mark.hidden = true;
      aim(null);
    }
    function aim(row) {
      const node = row ? drawnRow(row.id) : null;
      if (t.aimed === node) return;
      if (t.aimed) t.aimed.classList.remove("aimed");
      t.aimed = node || null;
      if (t.aimed) t.aimed.classList.add("aimed");
    }
    function markMessage(i) {
      if (!t.slots || !t.pos || !t.total) {
        if (t.mark) t.mark.hidden = true;
        return;
      }
      if (!t.mark) {
        t.mark = document.createElement("div");
        t.mark.className = "tl-at";
        t.el.appendChild(t.mark);
      }
      const height = t.ticks.clientHeight;
      const at = Math.max(0, Math.min(height - 2, ((t.pos[i] ?? 0) / t.total) * height));
      t.mark.style.top = `${Math.round(at)}px`;
      const el = t.items[i];
      if (opts.colorOf && el) t.mark.style.setProperty("--at", opts.colorOf(currentRoom(), el));
      t.mark.hidden = false;
    }
    function slotAt(i) {
      if (!t.slots) return null;
      for (let at = 0; at < t.slots.length; at++) {
        const slot = t.slots[at];
        if (slot.count && i >= slot.first && i < slot.first + slot.count) return t.ticks.querySelector(`.tl-slot[data-at="${at}"]`);
      }
      return null;
    }
    function itemUnder(el, clientY) {
      const { itemAt } = globalThis.VIBEROOM_TIMELINE;
      const box = Layout.rect(el);
      const within = box.height ? (clientY - box.top) / box.height : 0.5;
      return itemAt(t.pos || [], t.slots[Number(el.dataset.at)], within);
    }
    let openTimer = 0;
    let lastPoint = null;
    function pointed(e) {
      const slot = t.slots && e.target.closest(".tl-slot");
      if (slot) { const i = itemUnder(slot, Layout.length(e.clientY)); return i >= 0 ? { i, slot } : null; }
      const tick = e.target.closest(".tl-tick");
      return tick ? { i: Number(tick.dataset.i), slot: null } : null;
    }
    function headingForCard(from, to) {
      const card = Layout.rect(t.pop), strip = Layout.rect(t.ticks);
      const side = card.left + card.width / 2 >= strip.left + strip.width / 2 ? 1 : -1;
      const across = (to.x - from.x) * side;
      return across > 0 && across >= Math.abs(to.y - from.y);
    }
    t.ticks.addEventListener("mousemove", (e) => {
      const point = { x: Layout.length(e.clientX), y: Layout.length(e.clientY) };
      const from = lastPoint;
      lastPoint = point;
      const at = pointed(e);
      if (!at) return;
      clearTimeout(openTimer);
      if (t.pop.hidden) {
        openTimer = setTimeout(() => showPop(at.i, false, at.slot), hoverDelayMs(true));
        return;
      }
      if (from && headingForCard(from, point)) return;
      if (at.i !== shownAt) showPop(at.i, false, at.slot);
    });
    t.ticks.addEventListener("mouseleave", () => { clearTimeout(openTimer); lastPoint = null; });
    let hideTimer = 0;
    t.el.addEventListener("mouseleave", () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hidePop, 600);
    });
    t.el.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    t.ticks.addEventListener("click", (e) => {
      clearTimeout(openTimer);
      const slot = t.slots && e.target.closest(".tl-slot");
      if (slot) {
        const i = itemUnder(slot, Layout.length(e.clientY));
        if (i >= 0) void jumpToId(t.items[i].id);
        return;
      }
      const tick = e.target.closest(".tl-tick");
      if (tick) void jumpToId(t.items[Number(tick.dataset.i)]?.id);
    });
    t.pop.addEventListener("click", (e) => {
      const row = e.target.closest(".tl-row");
      if (row) void jumpToId(t.items[Number(row.dataset.i)]?.id);
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
        if (next !== current) showPop(next, true, t.slots ? t.ticks.querySelector(".tl-slot.active") : null);
      },
      { passive: false },
    );
    function follow() {
      if (t.el.hidden) return;
      if (t.pos) rescale();
      else render();
    }
    const mapped = () => (t.el.hidden || !!t.pos) && sameMap(currentRoom());
    return { render, rescale, updateView, follow, mapped };
  }
  function timelineText(row) {
    return String(row.m.text || "").trim().replace(/\s+/g, " ").slice(0, 240);
  }
  const doneNotes = [];
  const NOTE_TTL_MS = 4000;
  function bubbleInView(id) {
    const head = els.messages.querySelector(`.msg[data-id="${id}"] .head`);
    if (!head) return false;
    const box = Layout.rect(els.messages);
    const r = Layout.rect(head);
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
    return fmtDuration(ms);
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
    void jumpToId(id);
  });
  async function jumpToId(id, align = "center") {
    if (!id) return false;
    const initial = currentRoom();
    if (initial?.history?.indexed && initial.messages.find(m => m.id === id)?.bodyMissing) {
      if (!await loadBodies(initial, [id], true)) {
        toast("This message could not be loaded. Try again when the connection is back.", "warn");
        return false;
      }
      if (currentRoom() !== initial) return false;
    }
    if (jumpToMessage(els.messages.querySelector(`.msg[data-id="${cssEscape(id)}"]`), null, align)) return true;
    const room = currentRoom();
    const held = room && HistoryWindow.knownMessages(room).find((m) => m.id === id);
    if (held && held.seq > 0 && await revealSeq(held.seq)) return true;
    if (room && await refreshHeld(room.id, { messageId: id, reader: { id, into: 12 } })) {
      const ready = drawnRow(id);
      if (ready) return jumpToMessage(ready, null, align);
      const at = room.messages.findIndex(m => m.id === id);
      if (at >= 0) {
        setFoldIndex(room, Math.max(0, at - FOLD_STEP));
        leaveTheEnd();
        renderMessages("a message was asked for by id", { id, into: 12 });
        return jumpToMessage(els.messages.querySelector(`.msg[data-id="${cssEscape(id)}"]`), null, align);
      }
    }
    toast("That message could not be reached; it may be older than this room holds.");
    return false;
  }

  function jumpToPassage(el, fragment) {
    if (!el || !el.isConnected) return false;
    const room = currentRoom();
    const m = messageOfNode(el);
    const text = String(fragment || "").trim();
    if (!room || !m || !text || wholeMessage(m, text)) return jumpToMessage(el);
    const words = () => el.querySelector(".bubble > .text > .words");
    let passage = Passage.find(words(), text);
    if (!passage && el.querySelector(".bubble > .text.clamped")) {
      setExpanded(el, room.id, m, true);
      passage = Passage.find(words(), text);
      if (!passage) setExpanded(el, room.id, m, false);
    }
    return jumpToMessage(el, passage);
  }
  function wholeMessage(m, text) {
    const whole = String(m.text || "").trim();
    return whole === text || (text.length >= QUOTE_TEXT_MAX && whole.startsWith(text));
  }
  const QUOTE_TEXT_MAX = 4000;
  function lightPassage(range) {
    if (!globalThis.CSS?.highlights || typeof Highlight !== "function") return false;
    CSS.highlights.set("quote-passage", new Highlight(range));
    const out = () => {
      CSS.highlights.delete("quote-passage");
      document.removeEventListener("pointerdown", out, true);
      document.removeEventListener("keydown", out, true);
    };
    document.addEventListener("pointerdown", out, true);
    document.addEventListener("keydown", out, true);
    return true;
  }

  function jumpToMessage(el, passage = null, align = "center") {
    if (!el || !el.isConnected) return false;
    glideStop("a jump to a message");
    leaveTheEnd();
    scrollToMessage(el, passage ? "center" : align, passage);
    if (passage && lightPassage(passage)) return true;
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
    return true;
  }
  const MESSAGE_EDGE = 16;
  function scrollTopFor(r, align) {
    const m = els.messages;
    const box = Layout.rect(m);
    if (align === "end") return m.scrollTop + (r.bottom - box.bottom) + MESSAGE_EDGE;
    if (r.height > box.height - 2 * MESSAGE_EDGE) return m.scrollTop + (r.top - box.top) - MESSAGE_EDGE;
    return m.scrollTop + (r.top - box.top) - (box.height - r.height) / 2;
  }
  function seenAsAsked(r, align) {
    const box = Layout.rect(els.messages);
    if (align === "end") return r.bottom <= box.bottom && r.bottom >= box.top + box.height / 2;
    if (r.height > box.height - 2 * MESSAGE_EDGE) return r.top >= box.top && r.top <= box.top + 2 * MESSAGE_EDGE;
    return inView(r);
  }
  function scrollToMessage(el, align, passage = null) {
    const target = () => Layout.rect(passage || el);
    if (seenAsAsked(target(), align)) return;
    glideStop("a message brought into view");
    leaveTheEnd();
    const m = els.messages;
    const from = m.scrollTop;
    m.scrollTop = scrollTopFor(target(), align);
    requestAnimationFrame(() => {
      const to = scrollTopFor(target(), align);
      m.scrollTop = to + (to < from ? 240 : -240);
      m.scrollTo({ top: to, behavior: "smooth" });
    });
  }
  function inView(r) {
    const box = Layout.rect(els.messages);
    const shown = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
    return shown >= Math.min(r.height, box.height) - 1;
  }
  const drawnRow = (id) => els.messages.querySelector(`.msg[data-id="${CSS.escape(id)}"]`);
  function stripRows(room, mine) {
    const items = listItems(room);
    const account = listAccount && listAccount.items.length === items.length ? listAccount : null;
    const rows = [];
    items.forEach((item, at) => {
      if (item.kind !== "msg") return;
      const m = item.m;
      if ((m.from === "human") !== mine) return;
      if (m.kind === "hidden" || !messageMatches(m)) return;
      rows.push({
        id: m.id,
        m,
        at,
        pinned: !!m.pinned,
        top: account ? ListIndex.topOf(account, at) : 0,
        height: account ? ListIndex.heightAt(account, at) : 0,
      });
    });
    return account ? rows : [];
  }
  const authorOf = (room, row) => findById(room, row.m.from);
  const timelines = [
    createTimeline($("#timeline"), (room) => stripRows(room, true), { slotH: MINE_SLOT_H }),
    createTimeline($("#timeline-left"), (room) => stripRows(room, false), {
      colorOf: (room, el) => { const p = authorOf(room, el); return p ? colourOf(p) : FALLBACK_COLOR(); },
      avatarOf: (room, el) => { const p = authorOf(room, el); return p ? avatar(p, 16, {}) : ""; },
    }),
  ];
  function renderTimeline(force) {
    const t0 = performance.now();
    for (const t of timelines) t.render(force);
    renderPins();
    noteSlow("timeline strips", performance.now() - t0);
  }
  function renderTimelineAfterList() {
    if (timelines.every((t) => t.mapped())) renderTimelineSoon(false);
    else renderTimeline();
  }
  function updateTimelineView() { for (const t of timelines) t.updateView(); }
  function rescaleTimeline() { for (const t of timelines) t.rescale(); }
  function followConversation() { for (const t of timelines) t.follow(); }
  attachScrollHints(els.pageInner);
  attachScrollHints(els.detailsInner);
  document.querySelectorAll("dialog.dialog").forEach((d) => attachScrollHints(d));
  const composerFollowers = [els.mentionMenu, els.emojiMenu];
  new ResizeObserver(() => {
    const h = `${els.composer.offsetHeight}px`;
    for (const el of composerFollowers) el.style.setProperty("--composer-h", h);
    followConversation();
    renderTimelineSoon(true);
  }).observe(els.composer);
  new ResizeObserver(() => {
    followConversation();
    renderTimelineSoon(true);
    repriceSoon();
  }).observe(els.messages);
  document.fonts.ready.then(() => renderTimeline());
  let timelineTimer = 0;
  let timelineFull = false;
  function renderTimelineSoon(full) {
    timelineFull = timelineFull || full;
    if (timelineTimer) return;
    const typing = Date.now() - lastTypedAt < TYPING_WINDOW_MS;
    timelineTimer = setTimeout(() => {
      timelineTimer = 0;
      if (Date.now() - lastTypedAt < TYPING_WINDOW_MS) renderTimelineSoon(false);
      else if (timelineFull) { timelineFull = false; renderTimeline(); }
      else rescaleTimeline();
    }, typing ? TYPING_WINDOW_MS : 300);
  }
  new MutationObserver((records) => {
    const structural = records.some((r) => r.target === els.messages || (r.target.classList && r.target.classList.contains("msgs-page")));
    renderTimelineSoon(structural);
  }).observe(els.messages, { childList: true, subtree: true });

  const workingNow = $("#working-now");
  const WAVE_PERIOD = 1600;
  const WAVE_STEP = 280;
  const WAVE_RETIME = 420;
  let waveEpoch = null;
  const bobOf = (el) => el.getAnimations().find((a) => a.animationName === "wn-bob") || null;
  function wavePlace(anim, i) {
    let target = waveEpoch + i * WAVE_STEP;
    const mine = anim.startTime;
    if (mine === null) {
      const now = document.timeline.currentTime ?? 0;
      target -= Math.ceil((target - now) / WAVE_PERIOD) * WAVE_PERIOD;
      return target;
    }
    return target + Math.round((mine - target) / WAVE_PERIOD) * WAVE_PERIOD;
  }
  function swimTo(el, i) {
    const anim = bobOf(el);
    if (!anim || waveEpoch === null) return;
    const target = wavePlace(anim, i);
    const from = anim.startTime;
    if (from === null || Math.abs(target - from) < 1) {
      anim.startTime = target;
      return;
    }
    const token = (el.waveToken = (el.waveToken || 0) + 1);
    const t0 = performance.now();
    const step = () => {
      if (el.waveToken !== token || !el.isConnected) return;
      const k = Math.min(1, (performance.now() - t0) / WAVE_RETIME);
      const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      anim.startTime = from + (target - from) * eased;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderWorkingNow() {
    const room = currentRoom();
    const working = room && state.view === "room" ? room.participants.filter((p) => p.kind === "agent" && p.status === "thinking") : [];
    const have = new Map([...workingNow.children].map((el) => [el.dataset.id, el]));
    const wanted = new Set(working.map((p) => p.id));
    for (const [id, el] of have) if (!wanted.has(id) && !el.classList.contains("leaving")) leaveWave(el);
    working.forEach((p) => {
      const title = `${p.name} is writing — click to go to the reply`;
      const face = `${p.avatar || ""}|${p.color || ""}|${p.name}`;
      const kept = have.get(p.id);
      if (kept) {
        kept.title = title;
        if (kept.classList.contains("leaving")) {
          kept.classList.remove("leaving");
          clearTimeout(kept.leaveTimer);
        }
        if (kept.dataset.face !== face) {
          kept.innerHTML = avatar(p, 22, {});
          kept.dataset.face = face;
        }
        return;
      }
      const el = document.createElement("button");
      el.type = "button";
      el.className = "wn-av joining";
      el.dataset.id = p.id;
      el.dataset.face = face;
      el.title = title;
      el.innerHTML = avatar(p, 22, {});
      workingNow.appendChild(el);
      if (waveEpoch === null) waveEpoch = document.timeline.currentTime ?? 0;
      el.addEventListener("animationend", (e) => {
        if (e.animationName === "wn-join") el.classList.remove("joining");
      });
    });
    formWave();
    updateWorkingNow();
  }
  function leaveWave(el) {
    el.classList.add("leaving");
    el.leaveTimer = setTimeout(() => {
      el.remove();
      formWave();
      updateWorkingNow();
    }, 220);
    formWave();
  }
  function formWave() {
    const staying = [...workingNow.children].filter((el) => !el.classList.contains("leaving"));
    staying.forEach((el, i) => swimTo(el, i));
  }
  function updateWorkingNow() {
    workingNow.hidden = !workingNow.firstElementChild;
  }
  workingNow.addEventListener("click", (e) => {
    const b = e.target.closest(".wn-av");
    const room = b && currentRoom();
    if (!room) return;
    const m = [...room.messages].reverse().find((x) => x.from === b.dataset.id && x.kind === "chat");
    const el = m && els.messages.querySelector(`.msg[data-id="${m.id}"]`);
    if (m?.streaming) void jumpToId(m.id);
    else scrollToBottom("the working figure was clicked", { byHand: true });
  });

  function contextWords(p) {
    const { left, tone } = lifeOf(p);
    if (tone === "fresh") return "Fresh session: nothing used yet.";
    if (tone === "unknown") return p.contextUsed ? `${fmtTokens(p.contextUsed)} tokens in use; this agent does not say how big its window is.` : "Not reported by this agent.";
    return `${fmtTokens(p.contextUsed)} of ${fmtTokens(p.contextSize)} used, ${left} % left.`;
  }
  function lastReplyUsage(room, p) {
    const last = [...room.messages].reverse().find((m) => m.from === p.id && m.usage) || (room.history?.latest?.[p.id]?.usage ? room.history.latest[p.id] : null);
    return last ? last.usage : null;
  }
  function lastReplyWords(room, p) {
    const usage = lastReplyUsage(room, p);
    return usage ? `${fmtTokens(usage.inputTokens)} in, ${fmtTokens(usage.outputTokens)} out` : "—";
  }
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
  const LIFE_RING_FACE = 44;
  const faceRadius = (size, corner, scale) => size * corner * scale;
  const LIFE_RING_GAP = 1.5;
  let lifeRadiusCache = null;
  function lifeRadius(av) {
    const key = document.documentElement.dataset.look || "";
    if (lifeRadiusCache && lifeRadiusCache.key === key) return lifeRadiusCache.value;
    const cs = getComputedStyle(av.isConnected ? av : document.documentElement);
    const scale = parseFloat(cs.getPropertyValue("--r-scale"));
    const corner = parseFloat(cs.getPropertyValue("--face-corner"));
    const tile = faceRadius(LIFE_RING_FACE, Number.isFinite(corner) ? corner : 0.32, Number.isFinite(scale) ? scale : 1);
    const value = tile < 0.5 ? 0 : tile + LIFE_RING_GAP;
    lifeRadiusCache = { key, value };
    return value;
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
    if (tone === "unknown" && !q) av.insertAdjacentHTML("beforeend", '<span class="life-q" aria-hidden="true">?</span>');
    else if (tone !== "unknown" && q) q.remove();
    const ev = recentContextEvent(p);
    av.classList.toggle("life-attn", !!ev && ev.kind !== "threshold");
    av.setAttribute("aria-label", (tone === "fresh" ? "Context: fresh, nothing used yet." : tone === "unknown" ? (p.contextUsed ? `Context: ${fmtTokens(p.contextUsed)} tokens in use; this agent does not say how big its window is.` : "Context: not reported by this agent.") : `Context ${fmtTokens(p.contextUsed)} of ${fmtTokens(p.contextSize)} used · ${left} % left.`) + (ev ? ` ${contextEventText(p, ev)}.` : "") + " Click to go to its last reply.");
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
  let quietRow = null;
  function quietGlance(li) {
    quietRow = li;
    clearTimeout(hoverTimer);
    closeLifePop();
  }
  function openLifePop(p, li) {
    closeLifePop();
    const el = document.createElement("div");
    el.className = "life-pop";
    document.body.appendChild(el);
    lifePop = { id: p.id, anchor: li, el };
    el.addEventListener("mouseenter", () => clearTimeout(hoverTimer));
    el.addEventListener("mouseleave", () => lifePop && scheduleHoverClose());
    renderLifePop();
  }
  function scheduleHoverClose() {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (lifePop && !lifePop.el.matches(":hover") && !lifePop.anchor.matches(":hover")) closeLifePop();
    }, 180);
  }
  const asksGlance = (el, li) => !!el && li.contains(el) && !el.closest("button");
  els.roster.addEventListener("mouseover", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li || li === quietRow) return;
    const room = currentRoom();
    const p = room && findById(room, li.dataset.id);
    if (!p || p.kind !== "agent" || p.status === "unstaffed") return;
    if (lifePop && lifePop.id === p.id) return void clearTimeout(hoverTimer);
    if (!asksGlance(e.target, li)) return void clearTimeout(hoverTimer);
    if (asksGlance(e.relatedTarget, li)) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => openLifePop(p, li), hoverDelayMs(true));
  });
  els.roster.addEventListener("mouseout", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li || (e.relatedTarget && li.contains(e.relatedTarget))) return;
    if (li === quietRow) quietRow = null;
    clearTimeout(hoverTimer);
    if (lifePop && lifePop.id === li.dataset.id) scheduleHoverClose();
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
    const { left, tone } = lifeOf(p);
    const usage = lastReplyUsage(room, p);
    el.innerHTML = `<div class="lp-main">
        <div class="lp-head">${avatar(p, 28, {})}<div><b>${esc(p.name)}</b><div class="lp-sub">${tone === "fresh" ? "fresh session: nothing used yet" : tone === "unknown" ? (p.contextUsed ? `context: ${fmtTokens(p.contextUsed)} tokens in use, window size not reported` : "context not reported by this agent") : `context ${fmtTokens(p.contextUsed)} of ${fmtTokens(p.contextSize)} used · <b>${left} % left</b>`}</div></div></div>
        <div class="life-bar life-${tone}"><i style="width:${left ?? 0}%"></i></div>
        ${p.contextEvent ? `<div class="lp-event${recentContextEvent(p) && p.contextEvent.kind !== "threshold" ? " fresh" : ""}">${ic("info")} ${esc(contextEventText(p, p.contextEvent))}</div>` : ""}
        <div class="kv lp-kv">
          <span>Last reply</span><span>${usage ? `<span title="tokens in">${ic("arrow-down")} ${fmtTokens(usage.inputTokens)}</span> <span title="tokens out">${ic("arrow-up")} ${fmtTokens(usage.outputTokens)}</span>` : "—"}</span>
          <span>Cost (estimate)</span><span>${fmtCost(p.cost) || "—"}</span>
          <span>Turns</span><span>${p.turns}</span>
          <span>Notes</span><span>${p.notesTurn ? "being written" : p.notes ? `written ${p.notesWrittenAt ? relTime(p.notesWrittenAt) : "earlier"}` : "none yet"}</span>
        </div>
        <div class="lp-sub lp-foot">A click goes to its last reply; the gear opens its panel.</div>
      </div>`;
    const r = Layout.rect(lifePop.anchor);
    el.style.left = `${Math.round(r.right + 12)}px`;
    el.style.top = `${Math.round(Math.max(8, Math.min(r.top - 10, Layout.length(window.innerHeight) - el.offsetHeight - 8)))}px`;
  }
  async function respawnWith(p, n) {
    const text =
      n > 0
        ? `${p.name} starts over with a new session that gets only ${p.notes ? "its own notes and " : ""}the last ${n} messages of this room. You keep the history; the rest of its memory is gone.`
        : `${p.name} forgets this whole conversation and starts over. You keep the history; it does not.`;
    const ok = await confirmDialog(text, { title: `A fresh start for ${p.name}?`, okLabel: "Fresh start", danger: true });
    if (!ok) return;
    closeLifePop();
    try {
      await post(roomApi(`/participants/${encodeURIComponent(p.id)}/respawn`), { memory: n > 0, replay: n });
    } catch (e) {
      showError(e);
    }
  }
  document.addEventListener("click", (e) => {
    if (lifePop && !e.target.closest(".life-pop")) closeLifePop();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lifePop) closeLifePop();
  });

  const pinsBtn = $("#pins-btn");
  const pinsPanel = $("#pins-panel");
  function pinnedMessages(room) {
    const held = new Set(room.messages.map((m) => m.id));
    const older = (room.pinnedOlder || []).filter((p) => !held.has(p.id));
    return [...older, ...room.messages.filter((m) => m.pinned && m.kind === "chat")].sort(HistoryWindow.compareMessages);
  }
  function renderPins() {
    const room = currentRoom();
    const pins = room && state.view === "room" ? pinnedMessages(room) : [];
    pinsBtn.hidden = pins.length === 0;
    setHtml(pinsBtn, `<span class="pad" aria-hidden="true"></span>${rig("pin-solid")}<span class="pin-count"></span>`);
    setText(pinsBtn.querySelector(".pin-count"), String(pins.length));
    pinsBtn.title = `${pins.length} pinned message${pins.length === 1 ? "" : "s"}`;
    pinsBtn.setAttribute("aria-label", pinsBtn.title);
    if (!pins.length) pinsPanel.hidden = true;
    if (pinsPanel.hidden) return;
    setHtml(pinsPanel, pins
      .map((m) => {
        const p = findById(room, m.from);
        const who = m.from === "human" ? Object.assign(meAvatarData(), { color: (p || {}).color }) : p;
        const text = String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 160) || (m.images && m.images.length ? `[${m.images.length} image${m.images.length === 1 ? "" : "s"}]` : "");
        return `<div class="tl-row pin-row${m.from === "human" ? " mine" : ""}" data-id="${esc(m.id)}"><span class="tl-av">${who ? avatar(who, 16, {}) : ""}</span><span class="tl-text">${esc(text)}</span><span class="pin-time">${time(m.ts)}</span><button type="button" class="pin-x" title="Unpin">×</button></div>`;
      })
      .join(""));
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
    void jumpToId(row.dataset.id);
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
      fetch("/api/window", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: json, keepalive, signal: deadline(10000) }).catch(() => {});
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

  window.addEventListener("pagehide", rememberHeldTurns);

  document.addEventListener("click", event => { const button = event.target.closest("[data-memory-open]"); if (button) void window.ViberoomMemory.open(currentRoom()?.id, button.dataset.memoryOpen); });
  connect();
  void askKey();
})();
