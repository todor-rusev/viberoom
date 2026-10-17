// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";

  const EMPTY_GUIDE = [
    { id: "summon", target: "#invite-btn", words: "Start here: summon your first vibemate" },
    { id: "automations", target: "#automations-btn", words: "Reminders and tasks, on time" },
    { id: "settings", target: "#chat-info-btn", words: "The room's rules and settings" },
  ];

  function drawnArrow(from, out, to, into) {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const reach = 0.55 * dist;
    const c1 = { x: from.x + out.x * reach, y: from.y + out.y * reach };
    const c2 = { x: to.x - into.x * reach, y: to.y - into.y * reach };
    const mid = { x: (from.x + 3 * c1.x + 3 * c2.x + to.x) / 8, y: (from.y + 3 * c1.y + 3 * c2.y + to.y) / 8 };
    const tx = c2.x + to.x - from.x - c1.x, ty = c2.y + to.y - from.y - c1.y, tl = Math.hypot(tx, ty) || 1;
    const course = { x: tx / tl, y: ty / tl };
    const k = Math.max(0.75, Math.min(1.2, dist / 70));
    const side = { x: course.y, y: -course.x };
    const at = ([u, v]) => ({ x: mid.x + (course.x * u + side.x * v) * k, y: mid.y + (course.y * u + side.y * v) * k });
    const way = ([u, v]) => { const x = course.x * u + side.x * v, y = course.y * u + side.y * v, l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
    const inDir = way(CURL.points[0]), outDir = way([CURL.points[5][0] - CURL.points[4][0], CURL.points[5][1] - CURL.points[4][1]]);
    const start = at([0, 0]), end = at(CURL.points[5]);
    const lead = 0.3 * dist, bend = 0.2 * dist;
    const n = (v) => v.toFixed(1);
    const pt = (p) => `${n(p.x)},${n(p.y)}`;
    const a = Math.atan2(into.y, into.x) + Math.PI;
    const wing = (turn) => `${n(to.x + Math.cos(a + turn) * 7)},${n(to.y + Math.sin(a + turn) * 7)}`;
    const [p1, p2, p3, p4, p5, p6] = CURL.points.map(at).map(pt);
    const d = `M${pt(from)} C${pt({ x: from.x + out.x * lead, y: from.y + out.y * lead })} ${pt({ x: start.x - inDir.x * bend, y: start.y - inDir.y * bend })} ${pt(start)}`
      + ` C${p1} ${p2} ${p3} C${p4} ${p5} ${p6}`
      + ` C${pt({ x: end.x + outDir.x * bend, y: end.y + outDir.y * bend })} ${pt({ x: to.x - into.x * lead, y: to.y - into.y * lead })} ${pt(to)}`;
    return { d, head: `M${wing(0.6)} L${n(to.x)},${n(to.y)} L${wing(-0.6)}` };
  }

  const CURL = { points: [[6, 5], [2, 12], [-4, 10], [-10, 8], [-6, -2], [4, -6]] };

  function quietRoom(room) {
    return !!room?.eligible;
  }

  const quietMates = (room) => room.mates;

  const quietKey = (room) => [room.id, room.name, quietMates(room), room.idsKey].join("|");

  function emptyRoomHtml(room, { esc, scene }) {
    const notes = room.notes.map((m) => `<div class="er-note">${esc(m.text)}</div>`).join("");
    const next = quietMates(room) ? "Say hello: @Name speaks to one; without @, everyone hears you." : "Summon a vibemate, then say hello. @Name speaks to one; without @, everyone hears you.";
    return `<div class="empty empty-room" data-quiet="${esc(quietKey(room))}">${notes ? `<div class="er-notes">${notes}</div>` : ""}<div class="art scene-art wb-scene sm-scene" role="img" aria-label="An empty seat, the outline of a vibemate: one is summoned into it, waves and starts to type">${scene("summon")}</div><strong>${esc(room.name)}</strong> is quiet, for now.<br>${next}</div>`;
  }
  function create(uiRoot, { signal, messages, currentFacts, Layout, esc, scene }) {
    const document = uiRoot.ownerDocument, window = document.defaultView, ResizeObserver = window.ResizeObserver;
    signal?.throwIfAborted();
    const lifetime = global.VIBEROOM_APP_LIFETIME.create({ window });
    const domResources = global.VIBEROOM_APP_DOM_LIFETIME.create({ root: uiRoot, lifetime });
    const requestAnimationFrame = lifetime.frame, cancelAnimationFrame = lifetime.cancelFrame;
    const els = { messages }, $ = selector => uiRoot.querySelector(selector);

    let emptyGuideEl = null, emptyGuideFrame = 0, emptyGuideDrawn = false, emptyGuideKey = "", guideVersion = 0;

    function hideEmptyGuide() {
      ++guideVersion;
      cancelAnimationFrame(emptyGuideFrame);
      emptyGuideFrame = 0;
      emptyGuideDrawn = false;
      emptyGuideKey = "";
      if (emptyGuideEl) emptyGuideEl.hidden = true;
    }

    function showEmptyGuide() {
      cancelAnimationFrame(emptyGuideFrame);
      const version = ++guideVersion, facts = currentFacts();
      if (!facts || !quietRoom(facts)) { if (version === guideVersion) hideEmptyGuide(); return; }
      emptyGuideFrame = requestAnimationFrame(() => {
        if (version !== guideVersion || lifetime.disposed) return;
        emptyGuideFrame = 0;
        if (holds(facts, version)) drawEmptyGuide(facts, version);
      });
    }

    function holds(facts, version, withNotes = false) {
      if (lifetime.disposed || version !== guideVersion) return false;
      const current = currentFacts();
      return !lifetime.disposed && version === guideVersion && !!current?.eligible
        && current.roomIdentity === facts.roomIdentity && quietKey(current) === quietKey(facts)
        && (!withNotes || current.notes.length === facts.notes.length
          && current.notes.every((note, i) => note.id === facts.notes[i].id && note.text === facts.notes[i].text));
    }

    function drawEmptyGuide(facts, version) {
      const active = () => holds(facts, version);
      if (!active()) return;
      const { innerWidth, innerHeight } = window;
      const block = els.messages.querySelector(".empty-room");
      if (!block) return hideEmptyGuide();
      if (!emptyGuideEl) {
        emptyGuideEl = document.createElement("div");
        emptyGuideEl.className = "empty-guide";
        emptyGuideEl.setAttribute("aria-hidden", "true");
        if (!active()) return;
        uiRoot.appendChild(emptyGuideEl);
        domResources.observe(ResizeObserver, () => { if (emptyGuideDrawn) showEmptyGuide(); }).observer.observe(els.messages);
        if (!active()) return;
      }
      const replay = !emptyGuideDrawn;
      const b = Layout.rect(block);
      if (!active()) return;
      const viewW = Layout.length(innerWidth);
      if (!active()) return;
      const viewH = Layout.length(innerHeight);
      if (!active()) return;
      const seen = (el) => { if (!el || !active()) return null; const r = Layout.rect(el); return active() && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < viewH && r.left < viewW ? r : null; };
      const key = [b, ...EMPTY_GUIDE.map((g) => seen($(g.target)))].map((r) => (r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : "-")).join("|") + `|${Math.round(viewW)}x${Math.round(viewH)}|${quietKey(facts)}`;
      if (!active()) return;
      if (emptyGuideDrawn && key === emptyGuideKey && !emptyGuideEl.hidden) return;
      emptyGuideKey = key;
      const arrows = [];
      const head = $(".chat-head"), talk = $(".chat-conversation");
      const talkRect = talk && Layout.rect(talk);
      if (!active()) return;
      const headRect = head && Layout.rect(head);
      if (!active()) return;
      const bannerOver = !!headRect && !!talkRect && talkRect.top - headRect.bottom > 2;
      const items = bannerOver ? [] : EMPTY_GUIDE.map((g) => ({ ...g, rect: seen($(g.target)) })).filter((g) => g.rect);
      const mates = quietMates(facts);
      const words = (g) => (g.id === "summon" && mates ? "Summon another vibemate" : g.words);
      const labels = [];
      for (let i = 0; i < items.length; i++) {
        if (!active()) return;
        const g = items[i], text = esc(words(g));
        if (!active()) return;
        labels.push(`<span class="eg-label" data-eg="${g.id}" style="--i:${i}">${text}</span>`);
      }
      const html = labels.join("") + '<svg class="eg-arrows"></svg>';
      if (!active()) return;
      emptyGuideEl.innerHTML = html;
      emptyGuideEl.hidden = false;
      const size = (id) => { const el = emptyGuideEl.querySelector(`[data-eg="${id}"]`); return { w: el.offsetWidth, h: el.offsetHeight }; };
      const LEFT = { x: -1, y: 0 }, RIGHT = { x: 1, y: 0 }, UP = { x: 0, y: -1 };
      const place = {};
      for (const g of items) {
        if (!active()) return;
        const t = g.rect, { w, h } = size(g.id);
        if (!active()) return;
        if (g.id === "summon") {
          const at = { x: t.right + 54, y: t.bottom + 18 };
          place.summon = { at, from: { x: at.x - 8, y: at.y + h / 2 }, out: LEFT, to: { x: t.right + 7, y: t.top + t.height / 2 }, into: LEFT };
        } else if (g.id === "settings") {
          const at = { x: Math.min(viewW - 16, t.right) - w, y: t.bottom + 58 };
          place.settings = { at, from: { x: at.x + w - 26, y: at.y - 6 }, out: UP, to: { x: t.left + t.width / 2, y: t.bottom + 5 }, into: UP };
        } else {
          const at = { x: t.left - 44 - w, y: t.bottom + 22 };
          place[g.id] = { at, from: { x: at.x + w + 8, y: at.y + h / 2 }, out: RIGHT, to: { x: t.left + t.width / 2, y: t.bottom + 5 }, into: UP };
        }
      }
      if (!active()) return;
      items.forEach((g, i) => {
        const el = emptyGuideEl.querySelector(`[data-eg="${g.id}"]`);
        const p = place[g.id];
        el.style.left = `${Math.round(p.at.x)}px`;
        el.style.top = `${Math.round(p.at.y)}px`;
        const { d, head } = drawnArrow(p.from, p.out, p.to, p.into);
        arrows.push(`<g class="eg-arrow" style="--arrow-lag:${(i * 0.35).toFixed(2)}s"><path class="eg-line drawn-line" pathLength="1" d="${d}"/><path class="eg-head drawn-head" d="${head}"/></g>`);
      });
      const svg = emptyGuideEl.querySelector(".eg-arrows");
      if (!active()) return;
      svg.setAttribute("viewBox", `0 0 ${viewW} ${viewH}`);
      svg.innerHTML = arrows.join("");
      emptyGuideEl.classList.toggle("eg-replay", replay);
      emptyGuideEl.hidden = !items.length;
      emptyGuideDrawn = true;
    }
    lifetime.own(() => { hideEmptyGuide(); emptyGuideEl?.remove(); emptyGuideEl = null; });
    const dispose = () => lifetime.dispose();
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ show: lifetime.guard(showEmptyGuide), hide: lifetime.guard(hideEmptyGuide),
      html: lifetime.guard(facts => {
        const version = guideVersion;
        if (!holds(facts, version, true)) return undefined;
        const checked = (read, value) => {
          if (!holds(facts, version, true)) return "";
          const result = read(value);
          return holds(facts, version, true) ? result : "";
        };
        const html = emptyRoomHtml(facts, { esc: value => checked(esc, value), scene: value => checked(scene, value) });
        return holds(facts, version, true) ? html : undefined;
      }), dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  Object.defineProperty(create, "facts", { value: true });
  global.VIBEROOM_EMPTY_CONVERSATION = Object.freeze({ create, quietRoom, quietKey, drawnArrow, emptyRoomHtml });
})(globalThis);
