// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function bind(el, { listen, current, showsMore, more, unfold, edit, read, quote, copy, pin, enter, walk }) {
    const withNow = action => () => { const now = current(); if (now) return action(now); };
    listen(el.querySelector('[data-act="more"]'), "click", withNow(more));
    listen(el.querySelector(".bubble"), "click", (e) => { if (showsMore(e)) withNow(unfold)(); });
    const editBtn = el.querySelector('[data-act="edit"]');
    if (editBtn) listen(editBtn, "click", withNow(edit));
    const readBtn = el.querySelector('.msg-head [data-act="read"]');
    if (readBtn) listen(readBtn, "click", withNow(read));
    listen(el.querySelector('[data-act="quote"]'), "click", withNow(quote));
    listen(el.querySelector('[data-act="copy"]'), "click", withNow(copy));
    listen(el.querySelector('[data-act="pin"]'), "click", async () => { const now = current(); if (now && !now.pending) await pin(now); });
    listen(el, "pointerenter", () => { if (current()) enter(); });
    for (const [act, back] of [["up", true], ["down", false]]) listen(el.querySelector(`.msg-head [data-act="${act}"]`), "click", () => { if (current()) return walk(act, back); });
  }
  root.VIBEROOM_MESSAGE_ACTIONS = Object.freeze({ bind });
})(typeof window !== "undefined" ? window : globalThis);
