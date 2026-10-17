// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
  const drawn = new WeakMap();
  const setHtml = (el, html) => { if (drawn.get(el) === html) return; el.innerHTML = html; drawn.set(el, html); };
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  function grid(container, { window: view = container?.ownerDocument.defaultView, signal, icon = () => "", doors = [],
    keyed = root.KeyedList, arrive = () => {}, onDoor = () => {}, onPick = () => {} } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    const doc = container.ownerDocument;
    let disposed = false;
    owner.on(container, "click", (event) => {
      const card = event.target.closest?.(".room-card");
      if (!card || !container.contains(card)) return;
      const entry = card.dataset.entry || "";
      if (entry.startsWith("door:")) onDoor(entry);
      else if (entry.startsWith("room:")) onPick(entry.slice(5));
    });
    function fill(card, place) {
      card.classList.toggle("current", !!place.current);
      const [head, topic, faces, foot] = card.children;
      setHtml(head, `<div class="rc-title">${place.mark}<h3>${esc(place.name)}</h3></div>${place.unread ? `<span class="count-pill">${place.unread}</span>` : place.thinking ? '<span class="live-dot" title="a vibemate is replying"></span>' : ""}`);
      setText(topic, place.topic);
      setHtml(faces, place.faces || `<span class="hint">${esc(place.secondary ?? "no vibemates yet")}</span>`);
      setHtml(foot, `<span>${place.summary == null ? `${plural(place.vibemates, "vibemate")} · ${plural(place.messages, "message")}` : esc(place.summary)}</span><span>${esc(place.when)}</span>`);
    }
    function update(entries = []) {
      if (disposed) return;
      keyed.patch(container, [...doors.map((door) => ({ door })), ...entries.map((place) => ({ place }))], {
        key: "entry",
        id: (item) => (item.door ? item.door.entry : `room:${item.place.id}`),
        make: (item) => {
          const card = doc.createElement("div");
          if (item.door) {
            card.className = "card cta hover room-card";
            card.innerHTML = `<div class="plus">${icon(item.door.icon)}</div><div>${item.door.title}</div><div class="hint">${item.door.hint}</div>`;
          } else {
            card.className = "card hover room-card";
            card.innerHTML = `<div class="rc-head"></div><div class="rc-topic"></div><div class="avatar-stack"></div><div class="rc-foot"></div>`;
          }
          return card;
        },
        fill: (card, item, _index, fresh) => {
          if (item.place) fill(card, item.place);
          if (fresh) arrive(card);
        },
      });
    }
    function dispose() { if (!disposed) { disposed = true; owner.dispose(); } }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ update, dispose, get signal() { return owner.signal; } });
  }

  function side(list, { window: view = list?.ownerDocument.defaultView, signal, UI, keyed = root.KeyedList, arrive = () => {},
    onRow = () => {} } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    const doc = list.ownerDocument;
    let disposed = false;
    owner.on(list, "click", (event) => {
      const li = event.target.closest?.("li");
      if (!li || !list.contains(li) || !li.dataset.entry || li.classList.contains("hint")) return;
      onRow(li.dataset.entry, { goto: !!event.target.closest(".goto-room") });
    });
    function row(entry) {
      if (entry.when !== undefined) return `${entry.mark}
        <div class="p-body">
          <div class="p-name"><span>${esc(entry.name)}</span>${entry.live ? '<span class="live-dot" title="a vibemate is replying"></span>' : ""}</div>
          <div class="p-preview">${esc(entry.preview)}</div>
        </div>
        <div class="p-right"><span>${esc(entry.when)}</span>${entry.unread ? `<span class="count-pill">${entry.unread}</span>` : ""}</div>`;
      return `${entry.mark}<div class="p-body"><div class="p-name"><span>${esc(entry.name)}</span></div><div class="p-preview">${esc(entry.preview)}</div></div>${entry.goto ? `<div class="p-actions">${UI.html("icon-button", { icon: "forward", title: "Go to the room", size: "sm", hook: "goto-room" })}</div>` : ""}`;
    }
    function update({ entries = [], empty = "" } = {}) {
      if (disposed) return;
      keyed.patch(list, entries.length ? entries : [null], {
        key: "entry",
        id: (entry) => (entry ? entry.key : "rooms:none"),
        make: (entry) => {
          const li = doc.createElement("li");
          if (!entry) { li.className = "hint"; li.style.cursor = "default"; }
          return li;
        },
        fill: (li, entry, _index, fresh) => {
          if (!entry) { setText(li, empty); return; }
          li.classList.toggle("selected", !!entry.selected);
          setHtml(li, row(entry));
          if (fresh) arrive(li);
        },
      });
    }
    function dispose() { if (!disposed) { disposed = true; owner.dispose(); } }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ update, dispose, get signal() { return owner.signal; } });
  }
  for (const make of [grid, side]) {
    Object.defineProperty(make, "disposable", { value: true });
    Object.defineProperty(make, "scoped", { value: true });
  }
  root.VIBEROOM_ROOMS = Object.freeze({ grid, side });
})(typeof window !== "undefined" ? window : globalThis);
