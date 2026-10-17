// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function searchNamesHtml(names, { esc, icon: ic }) {
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
  function create(uiRoot, { signal, panel: searchPanel, field, esc, icon: ic, fullTime, authorOf, onQuery, onSetting, onPick, onHide }) {
    signal?.throwIfAborted();
    const owner = global.VIBEROOM_APP_LIFETIME.create({ window: uiRoot.ownerDocument.defaultView });
    const hits = new WeakMap();
    function hide() { searchPanel.hidden = true; onHide(); }
    function render(q, data, storeSearch) {
      const rooms = new Set(data.hits.map((h) => h.roomId));
      const toggle = (key, value, label) => `<button type="button" class="search-toggle${storeSearch[key] === value ? " on" : ""}" data-key="${key}" data-value="${value}">${label}</button>`;
      const head = `<div class="search-head"><span>${data.unavailable ? esc(data.unavailable) : `${data.hits.length} hit${data.hits.length === 1 ? "" : "s"} in ${rooms.size} room${rooms.size === 1 ? "" : "s"}${data.usedTrigram ? " · by substring" : ""}${data.stale && data.stale.length ? ` · store out of sync: ${esc(data.stale.join(", "))}` : ""}`}</span><span class="spacer"></span>${toggle("scope", "room", "This room")}${toggle("scope", "all", "All rooms")}${toggle("sort", "rank", "Best")}${toggle("sort", "newest", "Newest")}</div>`;
      const rows = data.hits.map((h) => {
        const p = authorOf(h);
        const snippet = esc(h.snippet).replace(/\[([^\]]{1,80})\]/g, "<mark>$1</mark>");
        return `<div class="tl-row search-row" data-room="${esc(h.roomId)}" data-seq="${h.seq}"><span class="search-meta"><span class="search-room">${esc(h.roomName)}</span><b style="${p ? `color:${esc(p.color)}` : ""}">${esc(h.fromName)}</b>${h.fromNow ? `<span class="now-name">Now: ${esc(h.fromNow)}</span>` : ""}<span>${esc(fullTime(h.ts))}</span><span>#${h.seq}</span>${h.deleted ? "<span>· removed</span>" : ""}</span><span class="search-snippet">${snippet}</span></div>`;
      });
      searchPanel.innerHTML = head + searchNamesHtml(data.names || [], { esc, icon: ic }) + (rows.length ? rows.join("") : data.unavailable ? "" : `<div class="search-empty">Nothing matches "${esc(q)}". Words are ANDed: try fewer, a phrase in quotes, or word*.</div>`);
      const nodes = searchPanel.querySelectorAll(".search-row");
      nodes.forEach((row, at) => hits.set(row, { ...data.hits[at] }));
      searchPanel.hidden = false;
    }
    owner.on(searchPanel, "click", e => {
      const swap = e.target.closest(".search-name-swap");
      if (swap && searchPanel.contains(swap)) {
        const words = field.value.trim().split(/\s+/);
        const next = words.map(w => w.replace(/^@/, "").replace(/\*$/, "").toLowerCase() === swap.dataset.term.toLowerCase() ? swap.dataset.other : w).join(" ");
        onQuery(next); return;
      }
      const toggle = e.target.closest(".search-toggle");
      if (toggle && searchPanel.contains(toggle)) { onSetting(toggle.dataset.key, toggle.dataset.value); return; }
      const row = e.target.closest(".search-row");
      if (!row || !searchPanel.contains(row)) return;
      const hit = hits.get(row); if (!hit) return;
      hide(); onPick(hit);
    });
    owner.on(uiRoot, "click", e => {
      const fieldBox = field.closest(".search") || field;
      if (!searchPanel.contains(e.target) && !fieldBox.contains(e.target)) hide();
    });
    owner.own(() => { searchPanel.hidden = true; searchPanel.replaceChildren(); });
    const dispose = () => owner.dispose();
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ render: owner.guard(render), hide: owner.guard(hide), dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  global.VIBEROOM_CONVERSATION_SEARCH = Object.freeze({ create, searchNamesHtml });
})(globalThis);
