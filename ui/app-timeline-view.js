// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";


  const TICK_H = 5;
  const PIN_GLYPH_H = 10.5;
  const VIEW_MIN_H = 6;
  const DENSITY = 25;
  function stripBand(scrollTop, clientHeight, scrollHeight, stripH) {
    const height = Math.min(stripH, Math.max(VIEW_MIN_H, (clientHeight / Math.max(1, scrollHeight)) * stripH));
    const range = Math.max(0, scrollHeight - clientHeight);
    return { top: range > 0 ? (Math.max(0, Math.min(range, scrollTop)) / range) * (stripH - height) : 0, height };
  }
  function stripScroll(bandTop, bandH, stripH, scrollHeight, clientHeight) {
    const travel = stripH - bandH, range = Math.max(0, scrollHeight - clientHeight);
    return travel > 0 ? Math.max(0, Math.min(range, (bandTop / travel) * range)) : 0;
  }
  function create(root, opts, ports) {
    if (typeof ports.patchSlots !== "function") throw new TypeError("The timeline needs a checked slot patch port");
    if (typeof ports.colorsFor !== "function") throw new TypeError("The timeline needs a batch color port");
    const document = root.ownerDocument, view = document.defaultView;
    ports.signal?.throwIfAborted();
    const lifetime = global.VIBEROOM_APP_LIFETIME.create({ window: view });
    let disposed = false;
    lifetime.own(() => { disposed = true; });
    const domResources = global.VIBEROOM_APP_DOM_LIFETIME.create({ root, lifetime });
    const { messages, app, timeline } = ports;
    const els = { messages, app };
    const STOP = Symbol("timeline read refused");
    let renderedKey = null, renderVersion = 0, actionVersion = 0, active = null;
    function owns() {
      return !disposed && !!active && active.version === actionVersion && ports.valid(active.facts)
        && !disposed && active.version === actionVersion;
    }
    function read(port, ...args) {
      if (!owns()) throw STOP;
      const result = port(...args);
      if (!owns()) throw STOP;
      return result;
    }
    const patchLive = () => !disposed && !!active && active.version === actionVersion;
    const KeyedList = { patch: (...args) => need(read(ports.patchSlots, active.facts, patchLive, ...args)) };
    const need = value => { if (value === undefined) throw STOP; return value; };
    function run(fn, args = []) {
      if (disposed) return undefined;
      const previous = active, version = ++actionVersion, facts = ports.currentFacts();
      if (version !== actionVersion || disposed) return undefined;
      if (!facts) { dragScope?.release(); return undefined; }
      active = { version, facts };
      try { if (!owns()) return undefined; return fn(...args); }
      catch (error) { if (error !== STOP) throw error; return undefined; }
      finally { active = previous; }
    }
    const guard = fn => (...args) => run(fn, args);
    const on = (target, type, fn, options) => lifetime.on(target, type, guard(fn), options);
    const setTimeout = (fn, ms) => {
      const identity = active.facts.roomIdentity, version = renderVersion;
      return lifetime.timeout(() => {
        if (!disposed && version === renderVersion && ports.holds(identity)) run(fn);
      }, ms);
    };
    const clearTimeout = lifetime.clearTimeout;
    const Layout = { rect: node => read(ports.Layout.rect, node), length: n => read(ports.Layout.length, n) };
    const esc = value => read(ports.esc, value), ic = name => read(ports.ic, name);
    const hoverDelayMs = value => read(ports.hoverDelayMs, value);
    const drawnRow = id => read(ports.drawnRow, active.facts.roomIdentity, id);
    const jumpToId = id => read(ports.jumpToId, active.facts.roomIdentity, id);
    const requestViewportWork = work => read(ports.requestViewportWork, work);
    const markUserScroll = () => read(ports.markUserScroll);
    const currentKey = () => active?.facts.roomIdentity;
    const live = () => owns() && renderedKey !== null && renderedKey === currentKey();
    const pick = () => need(read(ports.rowsFor, active.facts, !!opts.mine));
    const author = (row, avatar = false) => need(read(ports.authorFor, active.facts, row.from, avatar));
    const positions = (rows, heights = false) => need(read(ports.positionsFor, active.facts, rows, heights));
    const tickH = opts.slotH || TICK_H;
    const t = { el: root, ticks: root.querySelector(".tl-ticks"), view: root.querySelector(".tl-view"), pop: root.querySelector(".tl-pop"), items: [] };
    const placeDrawn = new WeakMap();
    function sameMap() {
      if (active.facts.search) return false;
      const map = need(read(ports.mapFor, active.facts));
      return !!t.map && map.accounted && t.map === map.key;
    }
    function prepare(force) {
      const nodes = !force && t.pos && sameMap() ? t.items : pick();
      const hidden = nodes.length === 0;
      if (t.el.hidden !== hidden) t.el.hidden = hidden;
      return { nodes, facts: active.facts };
    }
    function measure(plan, viewport) {
      if (!plan || plan.facts.roomIdentity !== active.facts.roomIdentity || !read(ports.valid, plan.facts)) {
        t.geometry = null; t.refusedPlan = true; return;
      }
      t.refusedPlan = false;
      const h = t.el.hidden ? 0 : t.ticks.clientHeight;
      const fits = viewport.total <= viewport.height + 1;
      const stripTop = fits && !t.el.hidden ? Layout.rect(t.ticks).top : 0;
      const moved = viewport.aboveDelta - (viewport.top - viewport.beforeTop);
      const numeric = fits ? null : positions(plan.nodes, !timeline);
      const tops = fits ? plan.nodes.map(row => { const node = drawnRow(row.id); return node ? Layout.rect(node).top - stripTop + moved : 0; }) : numeric.tops;
      t.geometry = { ...viewport, h, fits, facts: plan.facts, nodes: numeric?.rows || plan.nodes, tops, numeric, heights: numeric?.heights };
    }
    function releaseGeometry() { t.geometry = null; }
    function render(force) {
      if (t.refusedPlan) { t.refusedPlan = false; return; }
      if (t.geometry && !read(ports.valid, t.geometry.facts)) { t.geometry = null; return; }
      const key = currentKey();
      if (renderedKey !== key) { clearTimeout(openTimer); clearTimeout(hideTimer); hidePop(); dragScope?.release(); t.map = null; t.following = null; dragEnded = false; }
      renderedKey = key;
      const geometry = t.geometry;
      if (!force && sameMap()) {
        if (t.el.hidden) return;
        if (t.pos && (geometry ? !geometry.fits : els.messages.scrollHeight > els.messages.clientHeight + 1)) { place(); return; }
      }
      renderVersion++;
      dragEnded = false;
      clearTimeout(openTimer);
      let nodes = geometry?.nodes || pick();
      const map = active.facts.search ? null : need(read(ports.mapFor, active.facts));
      t.map = map?.accounted ? map.key : null;
      t.items = nodes;
      t.slots = null;
      if (t.el.hidden !== (nodes.length === 0)) t.el.hidden = nodes.length === 0;
      t.pop.hidden = true;
      aim(null);
      if (!nodes.length) return;
      const total = geometry?.total ?? (els.messages.scrollHeight || 1);
      const h = Math.max(0, (geometry?.h ?? t.ticks.clientHeight) - tickH);
      const fits = geometry?.fits ?? (els.messages.scrollHeight <= els.messages.clientHeight + 1);
      const stripTop = fits && !geometry ? Layout.rect(t.ticks).top : 0;
      const numeric = !fits && !geometry ? positions(nodes, !timeline) : null;
      if (numeric) { nodes = numeric.rows; t.items = nodes; }
      const tops = geometry?.tops || (fits
        ? nodes.map((row) => { const node = drawnRow(row.id); return node ? Layout.rect(node).top - stripTop : 0; })
        : numeric.tops);
      t.pos = fits ? null : tops;
      if (!fits && timeline) {
        t.heights = null;
        drawSlots(nodes, tops, total);
        settleLater();
        return;
      }
      t.heights = fits ? null : (geometry?.heights || numeric.heights);
      const frag = document.createDocumentFragment();
      nodes.forEach((el, i) => {
        const tick = document.createElement("div");
        const pinned = el.pinned;
        tick.className = `tl-tick${pinned ? " pinned i i-pin-long" : ""}`;
        tick.dataset.i = i;
        if (opts.colored) tick.style.setProperty("--tick", author(el).color);
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
      const ticket = { identity: active.facts.roomIdentity, version: renderVersion };
      t.following = ticket;
      const held = () => !disposed && t.following === ticket && ticket.version === renderVersion && ports.holds(ticket.identity) && !disposed;
      lifetime.frame(() => {
        if (!held()) { if (t.following === ticket) t.following = null; return; }
        lifetime.frame(() => {
          const current = held();
          if (t.following === ticket) t.following = null;
          if (current) run(() => requestViewportWork({ timeline: true }));
        });
      });
    }
    function firstBy(nodes, authors, slot, who) {
      for (let i = slot.first; i >= 0 && i < slot.first + slot.count && i < nodes.length; i++) {
        if (authors[i] === who) return i;
      }
      return slot.first;
    }
    function drawSlots(nodes, tops, total) {
      const { slotsOf, pinGroups, INK_FLOOR } = timeline;
      const height = t.geometry?.h ?? t.ticks.clientHeight;
      const places = Math.max(1, Math.floor(height / tickH));
      const authors = opts.colored ? nodes.map((row) => row.from || "") : nodes.map(() => "me");
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
      const winners = opts.colored ? slots.map(slot => slot.count ? nodes[firstBy(nodes, authors, slot, slot.author)] : null) : null;
      const froms = winners ? [...new Set(winners.filter(Boolean).map(row => row.from))] : [];
      const colors = froms.length ? new Map(need(read(ports.colorsFor, active.facts, froms)).map(entry => [entry.from, entry.color])) : null;
      KeyedList.patch(t.ticks, slots, {
        key: "at",
        id: (_slot, at) => at,
        make: () => Object.assign(document.createElement("div"), { className: "tl-slot" }),
        fill: (el, slot, at) => {
          const colour = winners?.[at] ? colors.get(winners[at].from) : "";
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
      const numeric = t.geometry?.numeric || positions(t.items, !t.slots);
      t.items = numeric.rows;
      const total = t.geometry?.total ?? (els.messages.scrollHeight || 1);
      t.pos = numeric.tops;
      if (t.slots) {
        drawSlots(t.items, t.pos, total);
        return;
      }
      t.heights = numeric.heights;
      const h = Math.max(0, (t.geometry?.h ?? t.ticks.clientHeight) - TICK_H);
      const ticks = t.ticks.children;
      for (let i = 0; i < ticks.length && i < t.pos.length; i++) ticks[i].style.top = `${Math.round((t.pos[i] / total) * h)}px`;
      updateView();
    }
    function readView(viewport) {
      if (t.el.hidden) return null;
      if (t.geometry) return t.geometry;
      const m = els.messages;
      return { total: viewport?.total ?? (m.scrollHeight || 1), h: t.ticks.clientHeight, top: viewport?.top ?? m.scrollTop, height: viewport?.height ?? m.clientHeight };
    }
    function updateView(view = readView()) {
      if (!view) return;
      const { total, h, top, height } = view;
      const bottom = top + height;
      const band = stripBand(top, height, total, h);
      t.view.style.top = `${band.top}px`;
      t.view.style.height = `${band.height}px`;
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
    function rowHtml(k, cls, text) {
      const el = t.items[k];
      const av = opts.colored ? `<span class="tl-av">${author(el, true).avatar}</span>` : "";
      const pinned = el.pinned;
      return `<div class="tl-row ${cls}${pinned ? " pinned" : ""}" data-i="${k}">${av}<span class="tl-text">${esc(text)}</span>${pinned ? `<span class="tl-pin" title="Pinned">${ic("pin")}</span>` : ""}</div>`;
    }
    let shownAt = -1;
    function showPop(i, keepPlace, overSlot) {
      if (!live()) return;
      shownAt = i;
      const rows = [[i - 2, "faded far"], [i - 1, "faded"], [i, "current"], [i + 1, "faded"], [i + 2, "faded far"]].filter(([k]) => t.items[k]);
      const previews = need(read(ports.previewsFor, active.facts, rows.map(([k]) => t.items[k].contentId)));
      const html = rows.map(([k, c], at) => rowHtml(k, c, previews[at].text)).join("");
      t.pop.innerHTML = html;
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
      if (opts.colored && el) t.mark.style.setProperty("--at", author(el).color);
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
      const { itemAt } = timeline;
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
    on(t.ticks, "mousemove", (e) => {
      if (!live()) return;
      if (drag?.moving) return;
      const point = { x: Layout.length(e.clientX), y: Layout.length(e.clientY) };
      const from = lastPoint;
      lastPoint = point;
      const at = pointed(e);
      if (!at) return;
      clearTimeout(openTimer);
      if (t.pop.hidden) {
        const version = renderVersion, key = renderedKey;
        openTimer = setTimeout(() => { if (version === renderVersion && key === currentKey()) showPop(at.i, false, at.slot); }, hoverDelayMs(true));
        return;
      }
      if (from && headingForCard(from, point)) return;
      if (at.i !== shownAt) showPop(at.i, false, at.slot);
    });
    on(t.ticks, "mouseleave", () => { clearTimeout(openTimer); lastPoint = null; });
    let hideTimer = 0;
    on(t.el, "mouseleave", () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hidePop, 600);
    });
    on(t.el, "mouseenter", () => clearTimeout(hideTimer));
    on(t.ticks, "click", (e) => {
      if (!live()) return;
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
    const DRAG_FROM_PX = 3;
    let drag = null, dragEnded = false, dragScope = null;
    on(t.el, "pointerdown", (e) => {
      if (!live()) return;
      if (e.button !== 0 || e.target.closest(".tl-pop")) return;
      dragScope?.release();
      const scope = dragScope = domResources.scope();
      scope.own(() => {
        t.el.classList.remove("dragging");
        els.app.classList.remove("strip-dragging");
        if (dragScope === scope) { dragScope = null; drag = null; }
      });
      e.preventDefault();
      const band = Layout.rect(t.view), y = Layout.length(e.clientY);
      drag = {
        id: e.pointerId, from: y, moving: false, roomKey: renderedKey,
        top: Layout.rect(t.ticks).top, height: t.ticks.clientHeight, bandH: t.view.offsetHeight,
        grab: e.target.closest(".tl-view") ? y - band.top : t.view.offsetHeight / 2,
      };
      for (const type of ["pointermove", "pointerup", "pointercancel"]) scope.on(document, type, guard(followDrag), true);
    });
    function followDrag(e) {
      if (drag && (!live() || drag.roomKey !== renderedKey)) { dragScope?.release(); return; }
      if (!drag || e.pointerId !== drag.id) return;
      if (e.type !== "pointermove") {
        if (drag.moving) {
          t.el.classList.remove("dragging");
          els.app.classList.remove("strip-dragging");
          dragEnded = true;
          setTimeout(() => { dragEnded = false; });
        }
        dragScope.release();
        return;
      }
      const y = Layout.length(e.clientY);
      if (!drag.moving) {
        if (Math.abs(y - drag.from) < DRAG_FROM_PX) return;
        drag.moving = true;
        t.el.classList.add("dragging");
        els.app.classList.add("strip-dragging");
        clearTimeout(openTimer);
        hidePop();
      }
      const m = els.messages;
      markUserScroll();
      m.scrollTop = stripScroll(y - drag.top - drag.grab, drag.bandH, drag.height, m.scrollHeight, m.clientHeight);
    }
    on(t.el, "click", (e) => { if (dragEnded) { e.stopPropagation(); e.preventDefault(); } }, true);
    on(t.pop, "click", (e) => {
      if (!live()) return;
      const row = e.target.closest(".tl-row");
      if (row) void jumpToId(t.items[Number(row.dataset.i)]?.id);
    });
    const WHEEL_STEP = 30;
    let wheelAcc = 0;
    on(t.pop, "wheel", (e) => {
      if (!live()) return;
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
      }, { passive: false });
    function follow() {
      if (t.el.hidden) return;
      if (t.pos) rescale();
      else render();
    }
    const mapped = () => (t.el.hidden || !!t.pos) && sameMap();
    lifetime.own(() => { t.pop.hidden = true; t.aimed?.classList.remove("aimed"); t.aimed = null; t.mark?.remove(); t.ticks.replaceChildren(); t.el.hidden = true; t.geometry = null; t.items = []; });
    const dispose = () => { disposed = true; lifetime.dispose(); };
    if (ports.signal) lifetime.on(ports.signal, "abort", dispose, { once: true });
    return Object.freeze({ render: guard(render), rescale: guard(rescale), readView: guard(readView),
      updateView: guard(updateView), follow: guard(follow), mapped: guard(mapped),
      prepare: guard(prepare), measure: guard(measure), releaseGeometry: lifetime.guard(releaseGeometry), dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  Object.defineProperty(create, "facts", { value: true });
  Object.defineProperty(create, "checkedPatch", { value: true });
  Object.defineProperty(create, "colorBatch", { value: true });
  global.VIBEROOM_TIMELINE_VIEW = Object.freeze({ create, stripBand, stripScroll });
})(globalThis);
