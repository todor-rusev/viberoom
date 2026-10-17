// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

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
  const bodyHtml = (words) => `<b>${esc(words.head)}</b> <span>${esc(words.detail)}</span>`;
  function wedgeCardHtml(p, now, { UI, avatar }) {
    return `<div class="wedge" data-id="${esc(p.id)}" data-turn="${esc(p.quiet.turnId)}">
      ${avatar(p, 32, { vendor: true })}
      <div class="wedge-body">${bodyHtml(wedgeWords(p, now))}</div>
      <div class="wedge-acts">${wedgeButtons(p)
        .map((b) => UI.html("button", { label: b.label, size: "xs", kind: b.kind, act: `wedge-${b.act}`, title: b.title, disabled: b.disabled }))
        .join("")}</div>
    </div>`;
  }

  function create(banner, { window: view = banner.ownerDocument.defaultView, signal, scope = banner.ownerDocument, UI, avatar,
    find = () => null, act = async () => {}, over = () => {}, now = () => Date.now() } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    const drawn = new Map();
    let tick = 0;
    function render(ones) {
      if (owner.disposed) return;
      const at = now();
      banner.hidden = ones.length === 0;
      const have = new Map([...banner.children].map((el) => [el.dataset.id, el]));
      for (const p of ones) {
        const html = wedgeCardHtml(p, at, { UI, avatar });
        const el = have.get(p.id);
        if (!el) banner.insertAdjacentHTML("beforeend", html);
        else if (drawn.get(p.id) !== html) el.outerHTML = html;
        drawn.set(p.id, html);
        have.delete(p.id);
      }
      for (const [id, el] of have) {
        el.remove();
        drawn.delete(id);
      }
      if (ones.length && !tick) tick = owner.interval(refresh, 30000);
      if (!ones.length && tick) {
        owner.clearInterval(tick);
        tick = 0;
      }
    }
    function refresh() {
      if (owner.disposed) return;
      const at = now();
      for (const el of scope.querySelectorAll(".wedge")) {
        const p = find(el.dataset.id);
        if (!p || !p.quiet) continue;
        el.querySelector(".wedge-body").innerHTML = bodyHtml(wedgeWords(p, at));
        drawn.delete(p.id);
      }
    }
    owner.on(scope, "click", (e) => {
      const btn = e.target.closest?.('[data-act^="wedge-"]');
      const card = btn && btn.closest(".wedge");
      if (!card) return;
      const p = find(card.dataset.id);
      if (!p) return;
      if (!p.quiet || p.quiet.turnId !== card.dataset.turn) return void over();
      const turnId = p.quiet.turnId;
      btn.disabled = true;
      Promise.resolve(act(btn.dataset.act.slice("wedge-".length), p, turnId)).finally(() => { if (p.quiet) btn.disabled = false; });
    });
    owner.own(() => drawn.clear());
    const dispose = () => owner.dispose();
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ render, refresh, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_WEDGE_CARD = Object.freeze({ create, quietMinutes, words: wedgeWords, canNudge, buttons: wedgeButtons, html: wedgeCardHtml });
})(globalThis);
