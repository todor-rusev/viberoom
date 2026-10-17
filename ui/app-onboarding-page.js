// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const WORDS = { title: "Get the most out of viberoom", lead: "A few steps, in any order. Each card takes you where it is done." };

  function cardHtml(c, UI) {
    const done = c.done;
    return `<article class="ob-card" data-tone="${c.tone}" data-ob-card="${c.id}"${done ? " data-done" : ""}>
        <div class="ob-art scene-art" aria-hidden="true">${c.art}</div>
        <h3>${esc(c.title)}${done ? UI.html("badge", { label: "done", tone: "ready", size: "xs" }) : ""}</h3>
        <p>${esc(c.words)}</p>
        <div class="ob-acts">
          ${UI.html("button", { label: c.action, kind: done ? "secondary" : "primary", size: "sm", data: { obGo: c.go } })}
          ${UI.html("button", { label: "Show me", kind: "link", size: "sm", data: { obAsk: c.id }, title: "The viberoom guide walks you through it in a room of its own, one step at a time; it runs on a coding agent of yours" })}
        </div>
      </article>`;
  }

  function mark(page, cards, UI) {
    for (const c of cards) {
      const el = page.querySelector(`[data-ob-card="${c.id}"]`);
      if (el && el.hasAttribute("data-done") !== c.done) el.outerHTML = cardHtml(c, UI);
    }
  }

  function render(page, cards, { UI, ship = "", play = () => {}, still = () => false, frame = (callback) => callback(), words = WORDS }) {
    page.innerHTML = `
      <div class="page-hero ob-hero">
        <span class="ob-ship" aria-hidden="true">${ship}</span>
        <b class="page-hero-title">${esc(words.title)}</b>
        <p class="hint">${esc(words.lead)}</p>
      </div>
      <div class="ob-grid">${cards.map((c) => cardHtml(c, UI)).join("")}</div>`;
    const rig = page.querySelector(".ob-ship .rig");
    if (rig && !still()) frame(() => play(rig));
  }

  function bind(page, { window: view = page.ownerDocument.defaultView, isShown = () => true, onGo = () => {}, onAsk = () => {} } = {}) {
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    owner.on(page, "click", (event) => {
      const go = event.target.closest?.("[data-ob-go]");
      if (go && isShown()) onGo(go.dataset.obGo);
      const ask = event.target.closest?.("[data-ob-ask]");
      if (ask && isShown()) onAsk(ask.dataset.obAsk);
    });
    return Object.freeze({ dispose: () => owner.dispose() });
  }
  Object.defineProperty(bind, "disposable", { value: true });
  root.VIBEROOM_ONBOARDING_PAGE = Object.freeze({ cardHtml, mark, render, bind, words: WORDS });
})(typeof window !== "undefined" ? window : globalThis);
