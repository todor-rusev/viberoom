// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function words(text, m, ports) {
    const { paint, long, expanded, stream, render, clamp, previews, paths, schedule } = ports;
    if (!ports.current(m)) return undefined;
    let box = text.querySelector(":scope > .words");
    if (!box) {
      box = text.ownerDocument.createElement("div");
      box.className = "words";
      text.replaceChildren(box);
    }
    if (!paint) return box;
    if (!ports.begin(box) || !ports.current(m)) return box;
    if (m.streaming && m.text && !(m.images && m.images.length) && !(m.quotes && m.quotes.length)) stream(box, m);
    else {
      const html = render(long && !expanded ? clamp(m.text) : m.text, m);
      if (!ports.current(m)) return box;
      box.innerHTML = html;
    }
    if (!ports.current(m)) return box;
    if (!m.streaming) {
      previews(box, m);
      if (!ports.current(m)) return box;
      paths(box, m);
      if (!ports.current(m)) return box;
      schedule(box);
    }
    return box;
  }
  Object.defineProperty(words, "current", { value: true });
  function liveTail(el, text, m, { working, markup, calm }) {
    if (m.streaming) {
      let tail = el.liveTail;
      if (!tail) {
        tail = el.ownerDocument.createElement("span");
        tail.className = "live-tail";
        tail.innerHTML = markup();
        el.liveTail = tail;
      }
      tail.classList.toggle("no-figure", !working);
      if (tail.parentElement !== text) text.appendChild(tail);
      if (calm !== "off") text.classList.add("streamed");
    } else if (el.liveTail && el.liveTail.parentElement) el.liveTail.remove();
  }
  function fold(text, more, { long, expanded }) {
    text.classList.toggle("clamped", long && !expanded);
    text.closest(".bubble")?.classList.toggle("folded", long && !expanded);
    more.hidden = !long;
    more.textContent = expanded ? "Show less" : "Show more";
  }
  root.VIBEROOM_MESSAGE_TEXT = Object.freeze({ words, liveTail, fold });
})(typeof window !== "undefined" ? window : globalThis);
