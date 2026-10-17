// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  function create(box, { window: view = box.ownerDocument.defaultView, signal, avatar = () => "", inView = () => false,
    onPick = () => {}, ttl = 4000, most = 4 } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    const notes = [];
    const offered = new Set();
    function draw() {
      if (owner.disposed) return;
      box.hidden = notes.length === 0;
      box.innerHTML = notes
        .map((n) => `<button type="button" class="done-note ${n.kind}" data-id="${esc(n.id)}" title="Go to the message">${avatar(n.p, 18, {})}<span class="done-text"><b>${esc(n.text)}</b><small>${esc(n.sub)}</small></span></button>`)
        .join("");
    }
    function push(note) {
      const i = notes.findIndex((n) => n.id === note.id);
      if (i >= 0) {
        owner.clearTimeout(notes[i].timer);
        notes.splice(i, 1);
      }
      note.timer = owner.timeout(() => drop(note.id), ttl);
      notes.push(note);
      while (notes.length > most) drop(notes[0].id);
      draw();
    }
    function drop(id) {
      const i = notes.findIndex((n) => n.id === id);
      if (i < 0) return;
      owner.clearTimeout(notes[i].timer);
      notes.splice(i, 1);
      draw();
    }
    function offer(id, make) {
      const frame = owner.frame(() => {
        offered.delete(frame);
        if (inView(id)) return;
        push({ id, ...make() });
      });
      offered.add(frame);
    }
    function clear() {
      for (const frame of offered) owner.cancelFrame(frame);
      offered.clear();
      for (const n of notes) owner.clearTimeout(n.timer);
      notes.length = 0;
      draw();
    }
    function prune() {
      for (const n of [...notes]) if (inView(n.id)) drop(n.id);
    }
    function adopt(from, to) {
      const note = notes.find((n) => n.id === from);
      if (!note) return;
      note.id = to;
      draw();
    }
    owner.on(box, "click", (e) => {
      const note = e.target.closest(".done-note");
      if (!note) return;
      const id = note.dataset.id;
      drop(id);
      onPick(id);
    });
    owner.own(() => { notes.length = 0; box.replaceChildren(); box.hidden = true; });
    const dispose = () => owner.dispose();
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ offer, clear, prune, adopt, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_CORNER_NOTES = Object.freeze({ create });
})(globalThis);
