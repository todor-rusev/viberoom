// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const highlightBanks = new WeakMap(), highlightKey = "viberoom-panel-search";
  function paintHighlights(document, bank) {
    const view = document.defaultView, ranges = [...bank.values()].flat();
    if (!view.CSS?.highlights || typeof view.Highlight !== "function") return;
    if (ranges.length) view.CSS.highlights.set(highlightKey, new view.Highlight(...ranges));
    else view.CSS.highlights.delete(highlightKey);
  }
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
  function create(pane, { signal, UI, layout, remember, panelSectionShown, placeBar, listenKey,
    window = pane.ownerDocument.defaultView } = {}) {
    signal?.throwIfAborted();
    const document = pane.ownerDocument, CSS = window.CSS, NodeFilter = window.NodeFilter;
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window });
    const panelQueries = new Map(), token = {};
    let panelWidthWatch = null;
    function clearHighlight() {
      const bank = highlightBanks.get(document);
      if (!bank?.has(token)) return;
      bank.delete(token); paintHighlights(document, bank);
      if (!bank.size) highlightBanks.delete(document);
    }
    function showPanelSection(id, { focus = false } = {}) {
      if (owner.disposed) return;
      const pages = pane.querySelector(".panel-sections[data-kind]");
      const nav = pane.querySelector('[data-ui="settings-nav"]');
      if (!pages || !nav || !pages.querySelector(`:scope > [data-category="${CSS.escape(id)}"]`)) return false;
      const kind = pages.dataset.kind;
      remember(`panel.${kind}.section`, id);
      if (panelQueries.get(kind)) {
        panelQueries.delete(kind);
        const search = pane.querySelector('[id="panel-search"]');
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
      if (layout().rect(nav).top < layout().rect(pane).top) nav.scrollIntoView({ block: "nearest" });
      return true;
    }

    function fitPanelTabs(nav) {
      if (owner.disposed) return;
      if (!nav || !nav.isConnected || !pane.contains(nav)) return;
      for (const state of [null, "compact", "tight"]) {
        UI.setState(nav, state);
        if (nav.scrollWidth <= nav.clientWidth + 1) break;
      }
      placeBar(nav);
    }

    function wirePanel() {
      if (owner.disposed) return;
      fitPanelTabs(pane.querySelector('[data-ui="settings-nav"]'));
      if (!panelWidthWatch && window.ResizeObserver) {
        panelWidthWatch = owner.observer(window.ResizeObserver, () => fitPanelTabs(pane.querySelector('[data-ui="settings-nav"]')));
        panelWidthWatch.observe(pane);
      }
      applyPanelSearch();
    }

    function applyPanelSearch() {
      if (owner.disposed) return;
      const pages = pane.querySelector(".panel-sections[data-kind]");
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
      clearHighlight();
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
      if (owner.disposed) return;
      if (!window.CSS?.highlights || typeof window.Highlight !== "function") return;
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
      let bank = highlightBanks.get(document);
      if (!bank) { bank = new Map(); highlightBanks.set(document, bank); }
      bank.set(token, ranges); paintHighlights(document, bank);
    }
    owner.on(pane, "input", event => {
      if (event.target !== pane.querySelector('[id="panel-search"]')) return;
      panelQueries.set(event.target.dataset.panelKind, event.target.value); applyPanelSearch();
    });
    owner.own(listenKey(owner.guard(event => {
      if (event.target !== pane.querySelector('[id="panel-search"]') || event.key !== "Escape" || !event.target.value) return;
      event.preventDefault(); event.stopPropagation(); event.target.value = "";
      panelQueries.delete(event.target.dataset.panelKind); applyPanelSearch();
    }), true));
    owner.own(() => { clearHighlight(); panelQueries.clear(); });
    const dispose = () => owner.dispose();
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ show: showPanelSection, fit: fitPanelTabs, wire: wirePanel, apply: applyPanelSearch,
      query: kind => panelQueries.get(kind) || "", dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_PANEL_NAVIGATION = Object.freeze({ create, searchWords, holdsEvery });
})(globalThis);
