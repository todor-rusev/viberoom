// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function roomListFold(summary, title, attrs, rowsHtml, UI) {
    return {
      status: UI.raw(UI.html("button", { label: summary, kind: "link", act: "setting-fold", hook: "room-values-open", title })),
      fold: UI.raw(`<div class="room-values" ${attrs}>${rowsHtml}</div>`),
    };
  }

  function roomValueRow(room, id, control, { esc, roomMark }) {
    return `<div class="room-value" data-room="${esc(room.id)}">${roomMark(room, "sm")}<label class="rv-name" for="${esc(id)}" title="${esc(room.name)}">${esc(room.name)}</label>${control}</div>`;
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
    { id: "system", label: "System", glyph: "power", tone: "slate", about: "Installed agents, sleep while vibemates work, and installation controls provided by this application.", groups: ["sp-update", "sp-autostart", "sp-sleep", "sp-folder", "sp-restart"] },
    { id: "room-defaults", label: "Defaults for new rooms", glyph: "sliders", geek: true, about: "Where every new room starts; each room can change them in its own settings.", groups: ["sp-defaults-for-new-rooms"] },
    { id: "shared-memory", label: "Shared memory", glyph: "journal", geek: true, about: "What the rooms have learned about you: preferences, protected notes and their history.", groups: ["sp-shared-memory"] },
    { id: "skills", label: "Skills from vibemates", glyph: "skills", geek: true, about: "Whether a skill a vibemate writes is used at once or waits for you.", groups: ["sp-skills-from-vibemates"] },
    { id: "presets", label: "Presets per vibemate", glyph: "dial", geek: true, about: "The model, effort and mode a vibemate starts with when you summon one.", groups: ["sp-presets-per-vibemate"] },
    { id: "troubleshooting", label: "Troubleshooting", glyph: "pulse", geek: true, about: "Details to save when a vibemate fails or gets stuck, and the room they take on disk.", groups: ["sp-transcripts"] },
    { id: "development", label: "Development", glyph: "tool", geek: true, dev: true, about: "For the people who build viberoom: how this window draws and scrolls, and what the vibemates are sent.", groups: ["sp-slow", "sp-wheel", "sp-dev-prompts", "sp-dev-memory"] },
  ];
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
    "sp-remembers": { key: "remembers", kind: "switch" },
    "sp-mem-remembers": { key: "remembers", kind: "switch", column: "Remembers" },
    "sp-mem-input": { key: "memoryInput", kind: "select", column: "Input", options: [["excerpts", "Economical"], ["whole", "Most accurate"]] },
    "sp-mem-shares": { key: "sharesHistory", kind: "switch", column: "Shares its history" },
    "sp-mem-reads": { key: "readsOtherRooms", kind: "select", column: "Searches the others", options: [["off", "No"], ["on-search", "When searching"], ["every-turn", "Every turn"]] },
  };
  function almostOn(view) {
    return !!view && !view.ready && !!view.missing && view.missing !== "provider" && view.missing !== "reader";
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
  function roomValueOf(spec, control) {
    if (spec.kind === "switch") return control.checked;
    if (spec.kind === "select") return control.value;
    return Number(control.value);
  }
  function placeBar(nav, frame) {
    const bar = nav && nav.querySelector(":scope > .bar");
    const on = nav && nav.querySelector('button[data-state="on"]');
    if (!bar || !on) return;
    bar.style.transform = nav.dataset.layout === "row"
      ? `translateX(${on.offsetLeft + (on.offsetWidth - bar.offsetWidth) / 2}px)`
      : `translateY(${on.offsetTop + (on.offsetHeight - bar.offsetHeight) / 2}px)`;
    if (!nav.dataset.bar) frame(() => (nav.dataset.bar = "live"));
  }
  function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  freeze(SETTINGS_CATEGORIES); freeze(ROOM_VALUE_ROWS);
  function categories({ folder, voice, memory, installation, development = false } = {}) {
    const controls = installation || { updates: true, autostart: true, restart: true };
    const system = [controls.updates && "application updates", "agent updates", controls.autostart && "starting with the computer",
      "sleep while vibemates work", controls.restart && "a clean restart"].filter(Boolean);
    const systemWords = system.length === 2 ? system.join(" and ") : `${system.slice(0, -1).join(", ")}, and ${system.at(-1)}`;
    const systemAbout = systemWords[0].toUpperCase() + systemWords.slice(1) + ".";
    const attention = {
      system: folder?.known && folder.others?.length ? "This folder is not private" : null,
      voice: almostOn(voice) ? `The voice is not on yet: ${voice.reason}` : almostOn(voice?.reading) ? `Reading aloud is not on yet: ${voice.reading.reason}` : null,
      memory: almostOn(memory) ? `The long-term memory is not on yet: ${memory.reason}` : null,
    };
    return SETTINGS_CATEGORIES.filter(value => !value.dev || development).map(value => {
      const category = value.id === "system" ? { ...value, about: systemAbout } : value;
      return attention[value.id] ? { ...category, attention: attention[value.id] } : category;
    });
  }
  function control(rowId, room, label, { UI, selectHtml }) {
    const spec = ROOM_VALUE_ROWS[rowId], value = room.settings?.[spec.key], id = `rv-${rowId}-${room.id}`;
    if (spec.kind === "switch") return UI.html("switch", { id, checked: !!value, label });
    if (spec.kind === "select") return selectHtml(id, spec.options, value, label);
    return UI.html("number-field", { id, value: String(value ?? ""), min: spec.min, max: spec.max, step: spec.step });
  }
  function fold(rowId, rooms, { UI, esc, selectHtml }) {
    const spec = ROOM_VALUE_ROWS[rowId];
    if (!spec || !rooms.length) return {};
    return {
      status: UI.raw(UI.html("button", { label: roomValuesSummary(spec, rooms), kind: "link", act: "setting-fold", hook: "room-values-open", title: "Every room's own value; set any of them here" })),
      fold: UI.raw(`<div class="room-values" data-own-save data-row="${rowId}">${rooms.map(room => {
        const id = `rv-${rowId}-${room.id}`;
        return `<div class="room-value" data-room="${esc(room.id)}">${room.mark || ""}<label class="rv-name" for="${esc(id)}" title="${esc(room.name)}">${esc(room.name)}</label>${control(rowId, room, undefined, { UI, selectHtml })}</div>`;
      }).join("")}</div>`),
    };
  }
  function create(host, { signal, markup, mountParts, UI, pageShown, remember, motion, rooms, saveRoom, markSaved, onError }) {
    if (!host?.ownerDocument || typeof markup !== "function" || typeof mountParts !== "function") throw new TypeError("A Settings host and render operations are required");
    signal?.throwIfAborted();
    const document = host.ownerDocument, window = document.defaultView;
    const owner = global.VIBEROOM_APP_LIFETIME.create({ window });
    let renderOwner = null, root = null;
    const current = () => !owner.disposed && root?.isConnected;
    const find = id => root?.querySelector(`#${window.CSS.escape(id)}`);
    function refreshValue(key, roomId, kept) {
      if (!current()) return;
      const values = rooms();
      for (const [rowId, spec] of Object.entries(ROOM_VALUE_ROWS)) {
        if (spec.key !== key) continue;
        const input = find(`rv-${rowId}-${roomId}`);
        if (input && input !== document.activeElement) { if (spec.kind === "switch") input.checked = !!kept; else input.value = String(kept); }
        const opener = root.querySelector(`.room-values[data-row="${rowId}"]`)?.closest('[data-ui="setting"]')?.querySelector(".room-values-open .label");
        for (const line of [opener, ...root.querySelectorAll(`[data-rv-summary="${rowId}"]`)]) if (line) line.textContent = roomValuesSummary(spec, values);
      }
    }
    function refreshRoom(room) {
      if (!current() || !rooms().some(value => value.id === room.id && value.identity === room.identity)) return;
      for (const key of new Set(Object.values(ROOM_VALUE_ROWS).map(spec => spec.key))) if (room.settings?.[key] !== undefined) refreshValue(key, room.id, room.settings[key]);
    }
    function show(id, { focus = false, arrive = true } = {}) {
      if (!current()) return false;
      const nav = root.querySelector('[data-ui="settings-nav"]'), page = find(`sp-cat-${id}`);
      if (!nav || !page || !page.matches('[data-ui="settings-category"]')) return false;
      remember(id);
      for (const button of nav.querySelectorAll("button[data-category]")) {
        const selected = button.dataset.category === id; UI.setState(button, selected ? "on" : null);
        if (selected) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
        button.tabIndex = selected ? 0 : -1; if (selected && focus) button.focus();
      }
      const shown = !page.hidden;
      for (const value of root.querySelectorAll('[data-ui="settings-category"]')) value.hidden = value !== page;
      placeBar(nav, renderOwner.frame);
      if (shown) return true;
      root.querySelector(".settings-pages").scrollTop = 0;
      page.dispatchEvent(new window.CustomEvent(pageShown));
      if (!arrive) return true;
      page.dataset.arrive = "";
      const glyph = page.querySelector(":scope > .head .rig"), scope = renderOwner;
      if (glyph && !motion.reduced()) motion.play(glyph);
      scope.wait(Promise.allSettled(page.getAnimations({ subtree: true }).map(animation => animation.finished)))
        .then(scope.guard(() => delete page.dataset.arrive), error => { if (!scope.disposed) onError(error); });
      return true;
    }
    function render() {
      if (owner.disposed) return;
      const html = markup(), columns = [".settings-side", ".settings-pages"];
      const scroll = columns.map(selector => host.querySelector(selector)?.scrollTop || 0);
      renderOwner?.dispose(); host.innerHTML = html;
      root = host.querySelector(".settings-page");
      if (!root) throw new TypeError("Settings markup must contain its screen root");
      const scope = renderOwner = global.VIBEROOM_APP_LIFETIME.create({ window });
      const unparent = owner.own(() => scope.dispose()); scope.own(unparent);
      columns.forEach((selector, i) => { const column = root.querySelector(selector); if (column) column.scrollTop = scroll[i]; });
      const nav = root.querySelector('[data-ui="settings-nav"]'); placeBar(nav, scope.frame);
      scope.on(root, "click", event => { const button = event.target.closest('[data-ui="settings-nav"] button[data-category]'); if (button && root.contains(button)) show(button.dataset.category); });
      scope.on(root, "keydown", event => {
        const button = event.target.closest('[data-ui="settings-nav"] button[data-category]');
        if (!button || !root.contains(button) || event.altKey || event.ctrlKey || event.metaKey) return;
        const menu = button.closest('[data-ui="settings-nav"]'), all = [...menu.querySelectorAll("button[data-category]")], at = all.indexOf(button);
        const [next, back] = menu.dataset.layout === "row" ? ["ArrowRight", "ArrowLeft"] : ["ArrowDown", "ArrowUp"];
        const index = { [next]: at + 1, [back]: at - 1, Home: 0, End: all.length - 1 }[event.key];
        if (index === undefined) return;
        event.preventDefault(); show(all[(index + all.length) % all.length].dataset.category, { focus: true });
      });
      const identities = new Map(rooms().map(room => [room.id, room.identity]));
      scope.on(root, "change", async event => {
        const cell = event.target.closest?.("[data-own-save][data-row], [data-own-save] [data-row]");
        if (!cell || !event.target.id) return;
        const spec = ROOM_VALUE_ROWS[cell.dataset.row], roomId = event.target.closest("[data-room]")?.dataset.room;
        const identity = identities.get(roomId);
        if (!spec || !identity || !rooms().some(room => room.id === roomId && room.identity === identity)) return;
        const input = event.target, inputId = input.id, requested = roomValueOf(spec, input);
        try {
          const answer = await saveRoom(roomId, identity, { [spec.key]: requested });
          if (!current() || !answer || !rooms().some(room => room.id === roomId && room.identity === identity)) return;
          const kept = answer.settings?.[spec.key];
          if (kept !== undefined) {
            refreshValue(spec.key, roomId, kept);
            if (input.isConnected && root.contains(input) && roomValueOf(spec, input) === requested) {
              if (spec.kind === "switch") input.checked = !!kept; else input.value = String(kept);
            }
          }
          markSaved(inputId);
        } catch (error) { if (current() && rooms().some(room => room.id === roomId && room.identity === identity)) onError(error); }
      });
      try { mountParts(root, scope); } catch (error) { scope.dispose(); throw error; }
    }
    function dispose() { if (owner.disposed) return; owner.dispose(); signal?.removeEventListener("abort", dispose); }
    signal?.addEventListener("abort", dispose, { once: true });
    return Object.freeze({ render, show, refreshValue, refreshRoom, dispose, get disposed() { return owner.disposed; } });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  global.VIBEROOM_SETTINGS_SCREEN = Object.freeze({ roomListFold, roomValueRow, create, categories, baseCategories: SETTINGS_CATEGORIES,
    roomRows: ROOM_VALUE_ROWS, almostOn, words: roomValueWords, summary: roomValuesSummary, control, fold, placeBar });

})(globalThis);
