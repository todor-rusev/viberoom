// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function create(uiRoot, { signal, messages, Layout, icon: ic, esc, selection: bubbleSelection, onQuote: addQuote, currentKey, currentRoom }) {
    const document = uiRoot.ownerDocument, window = document.defaultView;
    signal?.throwIfAborted();
    const lifetime = global.VIBEROOM_APP_LIFETIME.create({ window }), els = { messages };
    const quotePop = document.createElement("button");
    quotePop.type = "button";
    quotePop.className = "quote-pop";
    quotePop.hidden = true;
    quotePop.innerHTML = `${ic("quote")}Quote`;
    uiRoot.appendChild(quotePop);
    let quotePopFor = null;
    function placeQuotePop() {
      const found = bubbleSelection();
      if (!found) {
        quotePop.hidden = true;
        quotePopFor = null;
        return;
      }
      quotePopFor = found;
      quotePop.hidden = false;
      const top = Math.max(8, found.rect.top - 36);
      quotePop.style.top = `${top}px`;
      quotePop.style.left = `${Math.min(Layout.length(window.innerWidth) - 96, Math.max(8, found.rect.left + found.rect.width / 2 - 40))}px`;
    }
    function schedule() { const key = currentKey(); lifetime.timeout(() => { if (key && key === currentKey()) placeQuotePop(); else { quotePop.hidden = true; quotePopFor = null; } }, 0); }
    lifetime.on(els.messages, "mouseup", schedule);
    lifetime.on(els.messages, "keyup", (e) => {
      if (e.shiftKey || e.key === "Shift") schedule();
    });
    lifetime.on(document, "selectionchange", () => {
      if (!quotePop.hidden && !bubbleSelection()) {
        quotePop.hidden = true;
        quotePopFor = null;
      }
    });
    lifetime.on(quotePop, "mousedown", (e) => e.preventDefault());
    function quoteTheSelection() {
      const found = bubbleSelection();
      quotePop.hidden = true;
      quotePopFor = null;
      if (!found) return;
      window.getSelection().removeAllRanges();
      addQuote(found.m, found.text);
    }
    lifetime.on(quotePop, "click", () => { if (currentKey()) quoteTheSelection(); else { quotePop.hidden = true; quotePopFor = null; } });
  
    lifetime.on(els.messages, "copy", (e) => {
      const found = currentKey() && bubbleSelection();
      if (!found || !e.clipboardData) return;
      e.clipboardData.setData("text/plain", found.text);
      e.clipboardData.setData(
        "text/html",
        `<blockquote data-viberoom-seq="${found.m.seq}" data-viberoom-room="${esc(currentRoom().id)}" data-viberoom-from="${esc(found.m.fromName)}" cite="viberoom">${esc(found.text)}</blockquote>`,
      );
      e.preventDefault();
    });
  
  
    lifetime.own(() => { quotePop.remove(); quotePopFor = null; });
    const dispose = () => lifetime.dispose();
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ quote: lifetime.guard(() => { if (currentKey()) quoteTheSelection(); }),
      place: lifetime.guard(() => { if (currentKey()) placeQuotePop(); }), dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  global.VIBEROOM_QUOTE_SELECTION = Object.freeze({ create });
})(globalThis);
