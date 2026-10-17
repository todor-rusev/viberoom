// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function create(uiRoot, { signal, messages, UI, Layout, currentRoom, roomRecordKey, viewOf, hoverDelayMs, props: peekProps, listenKey }) {
    const document = uiRoot.ownerDocument, window = document.defaultView;
    signal?.throwIfAborted();
    const lifetime = global.VIBEROOM_APP_LIFETIME.create({ window });
    const els = { messages }, state = { get view() { return viewOf(); } };
    const numberOf = (target) => (target && target.closest ? target.closest('[data-ui="message-ref"]') : null);
    const setTimeout = lifetime.timeout, clearTimeout = lifetime.clearTimeout, requestAnimationFrame = lifetime.frame, cancelAnimationFrame = lifetime.cancelFrame;
    const peek = { el: null, ref: null, timer: 0, frame: 0, roomKey: null };
    function showPeek(ref, key) {
      const room = currentRoom();
      if (!room || state.view !== "room" || roomRecordKey(room) !== key || !ref.isConnected || !els.messages.contains(ref)) return hidePeek();
      hidePeek();
      const written = ref.dataset.written ? { written: Number(ref.dataset.written), copy: ref.dataset.copy } : {};
      peek.el = UI.el("message-peek", { ...peekProps(room, Number(ref.dataset.seq)), ...written, id: "message-peek", hook: "peek-float" });
      uiRoot.appendChild(peek.el);
      peek.ref = ref;
      peek.roomKey = key;
      ref.setAttribute("aria-describedby", "message-peek");
      placePeek();
    }
    function placePeek() {
      if (!peek.el) return;
      if (!peek.ref || !peek.ref.isConnected || !els.messages.contains(peek.ref) || state.view !== "room" || !currentRoom() || roomRecordKey(currentRoom()) !== peek.roomKey) return hidePeek();
      const r = Layout.rect(peek.ref);
      const list = Layout.rect(els.messages);
      if (r.bottom <= list.top || r.top >= list.bottom) return hidePeek();
      const width = Layout.length(window.innerWidth), height = Layout.length(window.innerHeight);
      const w = peek.el.offsetWidth, h = peek.el.offsetHeight;
      const below = r.bottom + 6 + h <= height - 8;
      peek.el.style.top = `${Math.round(below ? r.bottom + 6 : Math.max(8, r.top - 6 - h))}px`;
      peek.el.style.left = `${Math.round(Math.max(8, Math.min(r.left, width - w - 8)))}px`;
    }
    function hidePeek() {
      clearTimeout(peek.timer);
      cancelAnimationFrame(peek.frame);
      peek.timer = 0;
      peek.frame = 0;
      if (peek.ref) peek.ref.removeAttribute("aria-describedby");
      if (peek.el) peek.el.remove();
      peek.el = null;
      peek.ref = null;
      peek.roomKey = null;
    }
    lifetime.on(els.messages, "mouseover", (e) => {
      const ref = numberOf(e.target);
      if (!ref || ref === peek.ref) return;
      clearTimeout(peek.timer);
      const room = currentRoom(), key = room && roomRecordKey(room);
      peek.timer = setTimeout(() => showPeek(ref, key), hoverDelayMs(true));
    });
    lifetime.on(els.messages, "mouseout", (e) => {
      const ref = numberOf(e.target);
      if (ref && !ref.contains(e.relatedTarget)) hidePeek();
    });
    lifetime.on(els.messages, "scroll", () => {
      if (peek.el && !peek.frame) peek.frame = requestAnimationFrame(() => { peek.frame = 0; placePeek(); });
    }, { passive: true });
    lifetime.on(uiRoot, "pointerdown", () => { if (peek.el) hidePeek(); }, true);
    lifetime.own(listenKey(lifetime.guard((e) => { if (e.key === "Escape" && peek.el) hidePeek(); })));
    lifetime.own(hidePeek);
    const dispose = () => lifetime.dispose();
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ hide: lifetime.guard(hidePeek), dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  global.VIBEROOM_MESSAGE_REFERENCE = Object.freeze({ create });
})(globalThis);
