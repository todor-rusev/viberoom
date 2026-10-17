// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function create(messages, { signal, UI, Layout, editors, roomRecordKey, currentRoom, viewOf, leaveTheEnd, resumeAfterText, readPreview, onPrepared, onError }) {
    const view = messages.ownerDocument.defaultView;
    signal?.throwIfAborted();
    const lifetime = global.VIBEROOM_APP_LIFETIME.create({ window: view });
    const domResources = global.VIBEROOM_APP_DOM_LIFETIME.create({ root: messages, lifetime });
    const bindings = new WeakMap(), pending = new Set();
    lifetime.own(() => { for (const controller of pending) controller.abort(); pending.clear(); });
    function openInlineEditor(el, room, m, options) {
      const focus = options?.focus !== false;
      const box = el.querySelector(".edit-box");
      const text = el.querySelector(".text");
      if (!box || !box.hidden) return;
      if (el.isConnected && !messages.contains(el)) return;
      const roomKey = roomRecordKey(room), stored = editors.get(m.id);
      const restored = stored && stored.roomId === room.id && (!stored.roomKey || stored.roomKey === roomKey);
      const opening = !restored;
      const held = restored ? stored : { roomId: room.id, roomKey, text: m.text, start: m.text.length, end: m.text.length };
      held.roomKey = roomKey;
      const binding = { active: true, request: 0, controller: null, listeners: [] };
      bindings.set(box, binding);
      const recordLive = () => !lifetime.disposed && viewOf() === "room" && currentRoom() && roomRecordKey(currentRoom()) === roomKey;
      const live = () => binding.active && bindings.get(box) === binding && box.isConnected && messages.contains(el) && editors.get(m.id) === held && recordLive();
      const listen = (node, type, callback) => { const release = domResources.nodeListener(node, type, callback); binding.listeners.push(release); };
      editors.set(m.id, held);
      box.innerHTML = `<textarea class="edit-area" rows="1"></textarea><div class="row-btns">${UI.html("button", { label: "Cancel", kind: "ghost", size: "sm", hook: "edit-cancel" })}${UI.html("button", { label: "Save", kind: "primary", size: "sm", hook: "edit-save" })}</div>`;
      const area = box.querySelector(".edit-area");
      area.value = held.text;
      const bubble = el.querySelector(".bubble");
      el.style.setProperty("--edit-width", `${Math.round(bubble ? Layout.rect(bubble).width : 0)}px`);
      box.hidden = false;
      text.hidden = true;
      el.classList.add("editing");
      const fit = () => {
        area.style.height = "auto";
        area.style.height = `${area.scrollHeight + area.offsetHeight - area.clientHeight}px`;
      };
      fit();
      listen(area, "input", () => { if (live()) fit(); });
      const keep = () => { if (!live()) return; held.text = area.value; held.start = area.selectionStart; held.end = area.selectionEnd; };
      for (const kind of ["input", "select", "keyup", "pointerup"]) listen(area, kind, keep);
      if (focus) {
        area.focus();
        area.setSelectionRange(held.start, held.end);
      }
      if (opening) leaveTheEnd();
      const close = () => {
        if (!live()) return;
        binding.active = false;
        binding.controller?.abort();
        for (const release of binding.listeners) release();
        binding.listeners.length = 0;
        bindings.delete(box);
        editors.delete(m.id);
        box.hidden = true;
        box.innerHTML = "";
        text.hidden = false;
        el.classList.remove("editing");
        el.style.removeProperty("--edit-width");
        resumeAfterText();
      };
      listen(box.querySelector(".edit-cancel"), "click", close);
      listen(area, "keydown", (event) => {
        if (!live()) return;
        if (event.key === "Escape") close();
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) box.querySelector(".edit-save").click();
      });
      listen(box.querySelector(".edit-save"), "click", async () => {
        if (!live()) return;
        const next = area.value.trim();
        if (!next || next === m.text) return close();
        const sequence = ++binding.request;
        binding.controller?.abort();
        const controller = binding.controller = new view.AbortController();
        pending.add(controller);
        try {
          const preview = await lifetime.wait(readPreview(room, m, { signal: controller.signal }));
          if (!live() || sequence !== binding.request || controller.signal.aborted) return;
          close();
          if (recordLive()) onPrepared(room, m, next, preview);
        } catch (error) {
          if (live() && sequence === binding.request && !controller.signal.aborted) onError(error);
        } finally { pending.delete(controller); }

      });
    }
    const dispose = () => lifetime.dispose();
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ open: lifetime.guard(openInlineEditor), dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  global.VIBEROOM_INLINE_EDITOR = Object.freeze({ create });
})(globalThis);
