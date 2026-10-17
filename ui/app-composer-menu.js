// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const ALL = Object.freeze({ id: "all", name: "All", kind: "all", tagline: "every vibemate in the room" });
  function create(field, menu, { window: view = menu?.ownerDocument.defaultView, signal, readRoom, readSkills,
    roomKey = room => room && JSON.stringify([room.scope, room.id, room.uuid, room.createdAt]), skillHolders, avatar, icon,
    onChange, includeHuman = false } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    const document = menu.ownerDocument;
    let opened = null, rows = null, index = 0, generation = 0, blurTimer = 0;
    const clearBlur = () => { owner.clearTimeout(blurTimer); blurTimer = 0; };
    function clear() {
      clearBlur(); ++generation; rows?.dispose(); rows = null;
      if (opened) menu.hidden = true;
      opened = null;
    }
    function close() { if (!owner.disposed) clear(); }
    function context() {
      const value = field.value, caret = field.selectionStart ?? value.length, before = value.slice(0, caret);
      const mention = before.match(/(^|\s)@([\p{L}\p{N}_-]*)$/u);
      const slash = before.match(/^((?:@[\p{L}\p{N}_-]+\s+)*)\/([A-Za-z0-9_-]*)$/u);
      const match = mention || slash;
      return match && { kind: mention ? "mention" : "skill", start: caret - match[2].length - 1, prefix: match[2], value, caret };
    }
    const eligibleSkill = skill => skill.userInvocable !== false && !(skill.problems || []).length && !skill.draft;
    function render() {
      if (owner.disposed) return;
      clearBlur(); ++generation;
      const ctx = context(), room = readRoom();
      if (!ctx || !room) return clear();
      const q = ctx.prefix.toLowerCase();
      const candidates = ctx.kind === "mention"
        ? room.participants.filter(p => (includeHuman || p.id !== "human") && p.name.toLowerCase().startsWith(q))
        : (readSkills() || []).filter(s => eligibleSkill(s) && s.name.toLowerCase().startsWith(q));
      if (ctx.kind === "mention" && !includeHuman && room.participants.filter(p => p.kind === "agent" && p.status !== "left").length > 1 && "all".startsWith(q)) candidates.unshift(ALL);
      if (!candidates.length) return clear();
      const items = candidates.map(item => ({ ...item }));
      if (index >= items.length) index = 0;
      rows?.dispose(); rows = root.VIBEROOM_APP_LIFETIME.create({ window: view });
      const entered = generation;
      opened = { ...ctx, room: roomKey(room), items, generation: entered };
      menu.innerHTML = "";
      items.forEach((item, i) => {
        const b = document.createElement("button"); b.type = "button"; b.className = i === index ? "active" : "";
        if (ctx.kind === "mention") {
          b.innerHTML = `${item.kind === "all" ? `<span class="mm-all">${icon("rooms")}</span>` : avatar(item, 24, { vendor: true })}<span>${esc(item.name)}</span><span class="mm-sub">${esc(item.kind === "human" ? "you" : item.tagline || item.agentVendor || "")}${item.status === "offline" ? " · offline" : ""}</span>`;
        } else {
          const holders = skillHolders(room, item.name);
          b.innerHTML = `<span class="mm-skill">/${esc(item.name)}</span><span class="mm-sub">${esc(item.argumentHint || item.description)}<br>${holders.length ? `${holders.map(p => esc(p.name)).join(", ")} ${holders.length === 1 ? "has" : "have"} it` : "nobody in this room has it"}</span>`;
        }
        rows.on(b, "mousedown", event => { event.preventDefault(); if (opened?.generation === entered) pick(i); });
        menu.appendChild(b);
      });
      menu.hidden = false;
    }
    function pick(i) {
      if (owner.disposed) return;
      const shown = opened, item = shown?.items[i], room = readRoom(), ctx = context();
      if (!item || !room || roomKey(room) !== shown.room || !ctx || ctx.value !== shown.value || ctx.caret !== shown.caret) return close();
      const exists = shown.kind === "mention"
        ? item.kind === "all" || room.participants.some(p => p.id === item.id && p.name === item.name)
        : (readSkills() || []).some(s => s.name === item.name && eligibleSkill(s));
      if (!exists) return close();
      field.setRangeText(`${shown.kind === "mention" ? "@" : "/"}${item.name} `, shown.start, shown.caret, "end");
      close(); field.focus(); onChange?.();
    }
    owner.on(field, "input", () => { index = 0; render(); onChange?.(); });
    owner.on(field, "blur", () => {
      clearBlur(); const entered = generation;
      blurTimer = owner.timeout(() => { if (generation === entered) close(); }, 150);
    });
    owner.on(field, "keydown", event => {
      if (!opened) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); index = (index + (event.key === "ArrowDown" ? 1 : opened.items.length - 1)) % opened.items.length; render();
      } else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); pick(index); }
      else if (event.key === "Escape") { event.preventDefault(); close(); }
    });
    function dispose() { if (owner.disposed) return; clear(); owner.dispose(); }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ render, close, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_COMPOSER_MENU = Object.freeze({ create });
})(globalThis);
