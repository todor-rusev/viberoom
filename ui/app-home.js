// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const HUSH = Symbol("hush");
  const FEATURES = [
    { tone: "lav", emoji: "🏠", title: "Rooms", text: "A room is a folder and a topic. Every vibemate in it works in that folder, and the history stays with the room." },
    { tone: "mint", emoji: "🤖", title: "Vibemates", text: "Summon any installed coding agent, give it a Vibename, a Vibersona and a Vibeface. Several in one room is the point.", strip: "vendors" },
    { tone: "warm", emoji: "💬", title: "Talk to all, or to one", text: "Write to the room and everyone answers in turn; @Name one of them and the others just listen. They read each other's replies." },
    { tone: "warm", emoji: "🧠", title: "Memory", text: "A room forgets nothing. Every word stays with it, and the vibemates can look back through everything — absolutely everything — even from before they joined or after a restart. What other rooms may see is your choice." },
    { tone: "sky", emoji: "🔌", title: "Connections", text: "Connect Jira, Notion, Linear and the others once, and the vibemates can look things up there in every room. You sign in at the system itself; before anything is written, you see the request and say yes.", strip: "systems" },
    { tone: "peach", emoji: "🧩", title: "Skills", text: "Reusable instructions in your library. Attach them to vibemates, invoke one with /name, or let a vibemate write its own." },
    { tone: "lav", emoji: "📱", title: "From your phone", text: "Pair Telegram and the rooms come with you: read what the vibemates wrote, answer them, stop a reply — from the phone in your pocket. Your own bot, paired once under Settings → Channels." },
    { tone: "rose", face: HUSH, title: "Hush", text: "Too much at once? One click stops every running reply. The vibemates stay quiet until you write again." },
    { tone: "sky", emoji: "📊", title: "Links and diagrams", text: "Links and file paths open on your machine with one click. A ```mermaid block in a reply turns into a diagram." },
    { tone: "orchid", emoji: "🎨", title: "Looks", text: "VibeClassic and its dark twin, Plain (black ink on white, or white on black), Terminal, Clay, Eye Comfort (the look the research on tired eyes asks for) or 3D clayful (soft clay objects, with weight): pick one with the button above or under Settings → Appearance, and fine-tune its paper, bubbles, ink and corners." },
  ];
  const STEPS = [
    { n: 1, title: "Open a room", text: "Give it a name and a folder. The folder is where the vibemates read and write." },
    { n: 2, title: "Summon a vibemate", text: "Pick Claude, Codex, Gemini, Cursor, OpenCode or Copilot; name it, give it a face." },
    { n: 3, title: "Say hello", text: "Enter sends. @Name addresses one vibemate, /skill invokes a skill. Watch them talk." },
  ];
  const WORDS = {
    eyebrow: "viberoom",
    lead: "One chat, many coding agents. Summon your vibemates into a room, talk to all of them at once, and let them talk to each other.",
    open: "Open room", jump: "Jump back in", first: "Your first room", all: "All rooms",
    emptyName: "No rooms yet", emptySub: "Open one, summon a vibemate, say hello.",
  };

  function markup({ UI, icon, hushFace = "", words = WORDS, features = FEATURES, steps = STEPS }) {
    return `
      <div class="home-inner">
        <section class="hero">
          <div class="hero-text">
            <div class="hero-eyebrow">${esc(words.eyebrow)}</div>
            <h1></h1>
            <p>${esc(words.lead)}</p>
            <div class="hero-actions">
              <span class="hero-lead-wrap">${UI.html("button", { label: "Onboarding", icon: "ship", size: "cta", id: "home-onboarding", hook: "hero-cta hero-lead", title: "Set viberoom up and get the most out of it" })}<svg class="hero-nudge" viewBox="0 0 120 36" aria-hidden="true"><path class="drawn-line" pathLength="1" d="M114 31C96 31 82 30 72 27C60 23 55 15 61 10.5C67 6 75 11 72 18.5C69.5 25 60 30 47 30C32 30 21 20 20 5"/><path class="drawn-head" d="M15.5 10L20 4L24.5 10"/></svg></span>
              ${UI.html("button", { label: words.open, icon: "rooms", size: "cta", id: "home-open-room", hook: "hero-cta" })}
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
          <div class="home-head"><h2></h2><button class="linklike" id="home-all-rooms" hidden>${esc(words.all)} ${icon("forward")}</button></div>
          <div class="home-rooms"></div>
        </section>
        <section class="home-section">
          <div class="home-head"><h2>What you can do here</h2></div>
          <div class="feature-grid">
            ${features.map((f) => `<div class="feature ${f.tone}"><div class="f-emoji">${f.face === HUSH ? hushFace : f.face || f.emoji}</div><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p>${f.strip ? `<div class="home-vendors" data-strip="${f.strip}"></div>` : ""}</div>`).join("")}
          </div>
        </section>
        <section class="home-section">
          <div class="home-head"><h2>Three steps to your first conversation</h2></div>
          <div class="steps">
            ${steps.map((st) => `<div class="step"><div class="step-n">${st.n}</div><div><h3>${esc(st.title)}</h3><p>${esc(st.text)}</p></div></div>`).join("")}
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
  }

  function create(container, { window: view = container?.ownerDocument.defaultView, signal, UI, icon = () => "", hushFace = "",
    words = WORDS, features = FEATURES, steps = STEPS, keyed = root.KeyedList, onOnboarding = () => {}, onOpen = () => {},
    onLook = () => {}, onAll = () => {}, onPick = () => {} } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    const doc = container.ownerDocument;
    let disposed = false;
    container.innerHTML = markup({ UI, icon, hushFace, words, features, steps });
    const find = (selector) => container.querySelector(selector);
    const places = find(".home-rooms"), all = find("#home-all-rooms");
    const parts = { greeting: find(".hero h1"), placesTitle: places.previousElementSibling.querySelector("h2"),
      vendors: find('.home-vendors[data-strip="vendors"]'), systems: find('.home-vendors[data-strip="systems"]') };
    owner.on(find("#home-open-room"), "click", () => onOpen());
    owner.on(find("#home-change-look"), "click", () => onLook());
    owner.on(find("#home-onboarding"), "click", () => onOnboarding());
    owner.on(all, "click", () => onAll());
    owner.on(places, "click", (event) => {
      const tile = event.target.closest?.("button.home-room");
      if (tile && places.contains(tile) && tile.dataset.entry?.startsWith("room:")) onPick(tile.dataset.entry.slice(5));
    });
    const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
    const drawn = new WeakMap();
    const setHtml = (el, html) => { if (!el || drawn.get(el) === html) return; el.innerHTML = html; drawn.set(el, html); };

    function update({ greeting = "", places: entries = [], vendors = "", systems = "" } = {}) {
      if (disposed) return;
      setText(parts.greeting, greeting);
      setText(parts.placesTitle, entries.length ? words.jump : words.first);
      if (all.hidden !== !entries.length) all.hidden = !entries.length;
      keyed.patch(places, entries.length ? entries : [null], {
        key: "entry",
        id: (place) => (place ? `room:${place.id}` : "rooms:none"),
        make: (place) => {
          if (!place) {
            const empty = doc.createElement("div");
            empty.className = "home-room empty-room";
            empty.innerHTML = `${UI.html("room-mark", { icon: "plus" })}<span class="hr-body"><span class="hr-name">${esc(words.emptyName)}</span><span class="hr-sub">${esc(words.emptySub)}</span></span>`;
            return empty;
          }
          const tile = doc.createElement("button");
          tile.className = "home-room";
          return tile;
        },
        fill: (tile, place) => {
          if (!place) return;
          setHtml(tile, `${place.mark}<span class="hr-body"><span class="hr-name">${esc(place.name)}</span><span class="hr-sub">${esc(place.sub)}</span></span>${place.unread ? `<span class="count-pill">${place.unread}</span>` : `<span class="hr-time">${esc(place.when)}</span>`}`);
        },
      });
      setHtml(parts.vendors, vendors);
      setHtml(parts.systems, systems);
    }
    function dispose() {
      if (disposed) return;
      disposed = true; owner.dispose();
    }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ update, dispose, get signal() { return owner.signal; } });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_HOME = Object.freeze({ markup, create, words: WORDS, features: FEATURES, steps: STEPS });
})(typeof window !== "undefined" ? window : globalThis);
