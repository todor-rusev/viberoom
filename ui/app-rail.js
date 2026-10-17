// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const attr = (name, value) => value == null || value === "" ? "" : ` ${name}="${esc(value)}"`;

  function itemMarkup(item, glyph) {
    if (item.rule) return `<span class="rail-hr"></span>`;
    if (item.list) {
      return `<div class="rail-list-wrap"${attr("id", `${item.list}-wrap`)} hidden><span class="rail-hr"></span>`
        + `<div class="rail-list"${attr("id", item.list)}${attr("aria-label", item.label)}></div><span class="rail-hr"></span></div>`;
    }
    const cls = ["rail-item", item.cls].filter(Boolean).join(" ");
    return `<button type="button" class="${esc(cls)}"${attr("id", item.id)}${attr("data-nav", item.nav)}${attr("data-rail-act", item.act)}`
      + `${attr("title", item.title ?? item.label)}><span class="ico"${attr("data-rig", item.glyph)}>${glyph(item.glyph)}</span>`
      + `<span class="label">${esc(item.label)}</span></button>`;
  }

  function markup({ brand, items = [], glyph = () => "" } = {}) {
    const head = brand?.src ? `<div class="rail-head"><button type="button" class="rail-logo" id="rail-logo"${attr("title", brand.title)}>`
      + `<img class="mark"${attr("src", brand.src)} alt=""><span class="word">${esc(brand.word)}</span></button></div>` : "";
    return head + `<div class="rail-items">${items.map(item => itemMarkup(item, glyph)).join("")}`
      + `<button type="button" class="rail-item rail-more" data-rail-more hidden title="More" aria-haspopup="menu" aria-expanded="false">`
      + `<span class="ico" data-rig="more">${glyph("more")}</span><span class="label">More</span></button></div>`
      + `<div class="menu rail-more-menu" role="menu" aria-label="More" hidden></div>`
      + `<div class="rail-foot"><div class="rail-pops" id="rail-pops"></div>`
      + `<button type="button" class="rail-item me" data-nav="me" title="Your vibe" id="rail-me"><span class="ico" id="rail-me-avatar"></span><span class="label" id="rail-me-label">You</span></button>`
      + `<div class="rail-status"><span class="conn" id="conn" title="Connection to the room"></span><span class="label conn-label" id="conn-label">connected</span></div>`
      + `<button type="button" class="rail-toggle" id="rail-toggle" title="Expand the menu"><span data-rig="expand">${glyph("expand")}</span></button></div>`;
  }

  function create(nav, { window: view = nav?.ownerDocument.defaultView, signal, glyph = () => "", brand, items = [],
    onNavigate = () => {}, onAct = () => {}, onPick = () => {}, onBrand = () => {}, onToggle = () => {}, fits } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    const doc = nav.ownerDocument;
    let disposed = false, open = false, viewName = null, me = { avatar: "", label: "" };
    nav.innerHTML = markup({ brand, items, glyph });
    const find = selector => nav.querySelector(selector);
    const itemsBox = find(".rail-items"), more = find("[data-rail-more]"), menu = find(".rail-more-menu");
    const menuStyle = view.getComputedStyle(menu);
    const menuMaxHeight = Number.parseFloat(menuStyle.maxHeight), menuMinWidth = Number.parseFloat(menuStyle.minWidth) || 0;
    const toggle = find("#rail-toggle");
    const measure = fits || (() => itemsBox.scrollHeight <= itemsBox.clientHeight + 0.5);

    const drawn = new WeakMap();
    function setHtml(el, html) { if (drawn.get(el) === html) return; el.innerHTML = html; drawn.set(el, html); }
    function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

    const lists = new Map([...nav.querySelectorAll(".rail-list")].map(box => [box.id, { box, buttons: new Map(), active: null }]));
    function renderList(id, entries = []) {
      const list = lists.get(id);
      if (!list) return;
      const { box, buttons } = list;
      box.parentElement.hidden = !entries.length;
      const itemClass = items.find(item => item.list === id)?.item || "rail-entry";
      const seen = new Set();
      let anchor = null;
      for (const entry of entries) {
        seen.add(entry.id);
        let b = buttons.get(entry.id);
        if (!b) {
          b = doc.createElement("button");
          b.type = "button";
          b.className = `rail-item ${itemClass}`;
          b.dataset.entry = entry.id;
          if (itemClass === "rail-room") b.dataset.room = entry.id;
          b.innerHTML = `<span class="ico"></span><span class="label"></span><span class="rail-count" hidden></span>`;
          buttons.set(entry.id, b);
        }
        if (!b.isConnected || b.previousElementSibling !== anchor) box.insertBefore(b, anchor ? anchor.nextSibling : box.firstChild);
        anchor = b;
        const ico = b.querySelector(".ico");
        if (ico.dataset.mark !== entry.mark) { ico.innerHTML = entry.mark || ""; ico.dataset.mark = entry.mark || ""; }
        setText(b.querySelector(".label"), entry.name || "");
        b.title = entry.title || entry.name || "";
        b.classList.toggle("active", !!entry.active);
        if (entry.active) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
        const unread = entry.unread || 0, count = b.querySelector(".rail-count");
        let live = b.querySelector(".rail-live");
        if (entry.thinking && !unread) {
          if (!live) {
            live = doc.createElement("span"); live.className = "live-dot rail-live";
            live.title = "Activity is in progress"; live.setAttribute("role", "img");
            live.setAttribute("aria-label", live.title); b.appendChild(live);
          }
        } else live?.remove();
        const text = unread ? (unread > 99 ? "99+" : String(unread)) : "";
        if (count.textContent !== text) {
          count.textContent = text;
          count.hidden = !unread;
          if (unread) { count.classList.remove("bump"); void count.offsetWidth; count.classList.add("bump"); }
        }
      }
      for (const [key, b] of buttons) if (!seen.has(key)) { b.remove(); buttons.delete(key); }
      const active = entries.find(entry => entry.active)?.id ?? null;
      if (active !== list.active) { list.active = active; reveal(list); }
    }

    function reveal({ buttons, active }) {
      if (active) buttons.get(active)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
    function revealHidden() {
      for (const list of lists.values()) {
        const b = list.active && list.buttons.get(list.active);
        if (!b) continue;
        const shown = list.box.getBoundingClientRect(), at = b.getBoundingClientRect();
        if (at.top < shown.top - 0.5 || at.bottom > shown.bottom + 0.5) reveal(list);
      }
    }

    const laid = () => [...itemsBox.children].filter(el => el.matches(".rail-item") && el !== more);
    function hideLonelyRules() {
      let seenButton = false;
      const children = [...itemsBox.children];
      children.forEach((el, index) => {
        if (!el.matches(".rail-hr")) { if (el.matches(".rail-item:not([hidden]):not(.rail-more)")) seenButton = true; return; }
        const next = children.slice(index + 1).find(n => !n.hidden && !n.matches(".rail-hr, .rail-more"));
        el.hidden = !seenButton || !next;
      });
    }
    function layout() {
      if (disposed) return;
      for (const el of laid()) { delete el.dataset.railFolded; el.hidden = false; }
      more.hidden = true;
      hideLonelyRules();
      if (measure()) { closeMenu(); return; }
      more.hidden = false;
      for (const el of laid().reverse()) {
        el.hidden = true; el.dataset.railFolded = "";
        hideLonelyRules();
        if (measure()) break;
      }
      if (!folded().length) more.hidden = true;
      if (!menu.hidden) fillMenu();
    }
    const folded = () => laid().filter(el => "railFolded" in el.dataset);

    function placeMenu() {
      const box = nav.getBoundingClientRect(), button = more.getBoundingClientRect();
      const ratio = nav.offsetHeight ? box.height / nav.offsetHeight : 1, scale = ratio > 0 ? ratio : 1;
      const margin = 8, top = Math.max(0, box.top) + margin, bottom = Math.min(view.innerHeight, box.bottom) - margin;
      const height = Math.max(0, bottom - top) / scale, width = Math.max(0, view.innerWidth - 2 * margin) / scale;
      menu.style.maxHeight = `${Math.min(Number.isFinite(menuMaxHeight) ? menuMaxHeight : height, height)}px`;
      menu.style.maxWidth = `${width}px`;
      menu.style.minWidth = `${Math.min(menuMinWidth, width)}px`;
      const size = menu.getBoundingClientRect();
      const y = Math.max(top, Math.min(button.top, bottom - size.height));
      const x = Math.max(margin, Math.min(box.right + 6 * scale, view.innerWidth - margin - size.width));
      menu.style.top = `${(y - box.top) / scale}px`;
      menu.style.left = `${(x - box.left) / scale}px`;
    }
    function fillMenu() {
      setHtml(menu, folded().map((el, index) => `<button type="button" role="menuitem" data-fold="${index}"${attr("title", el.title)}>`
        + `<span class="ico">${el.querySelector(".ico")?.innerHTML || ""}</span><span class="label">${esc(el.querySelector(".label")?.textContent)}</span></button>`).join(""));
      if (!menu.hidden) placeMenu();
    }
    function openMenu() { fillMenu(); menu.hidden = false; placeMenu(); more.setAttribute("aria-expanded", "true"); menu.querySelector("button")?.focus(); }
    function closeMenu() { if (menu.hidden) return; menu.hidden = true; more.setAttribute("aria-expanded", "false"); }

    function activate(el) {
      if (el.dataset.nav) onNavigate(el.dataset.nav);
      else if (el.dataset.railAct) onAct(el.dataset.railAct);
    }
    owner.on(nav, "click", event => {
      const target = event.target.closest?.("button");
      if (!target || !nav.contains(target)) return;
      if (target === more) { menu.hidden ? openMenu() : closeMenu(); return; }
      if (target.closest(".rail-more-menu")) {
        const el = folded()[Number(target.dataset.fold)];
        closeMenu();
        if (el) activate(el);
        return;
      }
      if (target.id === "rail-logo") return onBrand();
      if (target === toggle) return onToggle(!open);
      const list = target.closest(".rail-list");
      if (list && target.dataset.entry) return onPick(list.id, target.dataset.entry);
      activate(target);
    });
    owner.on(nav, "animationend", event => event.target.classList?.remove("bump"));
    owner.on(doc, "pointerdown", event => { if (!menu.hidden && !menu.contains(event.target) && event.target !== more && !more.contains(event.target)) closeMenu(); }, true);
    owner.on(doc, "keydown", event => { if (event.key === "Escape" && !menu.hidden) { closeMenu(); more.focus(); } });
    if (view.ResizeObserver) {
      const observer = new view.ResizeObserver(() => { layout(); revealHidden(); });
      observer.observe(nav);
      owner.own(() => observer.disconnect());
    }

    function update(change = {}) {
      if (disposed) return;
      if ("view" in change) viewName = change.view;
      if ("open" in change) open = !!change.open;
      if (change.me) me = { ...me, ...change.me };
      for (const b of nav.querySelectorAll(".rail-item[data-nav]")) b.classList.toggle("active", b.dataset.nav === viewName);
      for (const [id, entries] of Object.entries(change.lists || {})) renderList(id, entries);
      if (change.me) { setHtml(find("#rail-me-avatar"), me.avatar || ""); setText(find("#rail-me-label"), me.label || "You"); }
      nav.toggleAttribute("data-open", open);
      toggle.title = open ? "Collapse the menu" : "Expand the menu";
      setHtml(toggle, `<span data-rig="${open ? "collapse" : "expand"}">${glyph(open ? "collapse" : "expand")}</span>`);
      layout();
    }
    const navButton = name => [...nav.querySelectorAll(".rail-item[data-nav]")].find(b => b.dataset.nav === name) || null;
    function dispose() {
      if (disposed) return;
      disposed = true; owner.dispose();
    }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    layout();
    return Object.freeze({ update, layout, navButton, dispose, get signal() { return owner.signal; } });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_RAIL = Object.freeze({ markup, create });
})(typeof window !== "undefined" ? window : globalThis);
