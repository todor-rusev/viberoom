// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";

  const SPACE = /\s/;
  const UNREAD = "style, script, title, desc, [hidden], .mm-code, .q-goto";

  function letters(text) {
    let out = "";
    for (const ch of String(text || "")) if (!SPACE.test(ch)) out += ch;
    return out;
  }

  function find(holder, fragment) {
    const want = letters(fragment);
    if (!holder || !want) return null;
    const doc = holder.ownerDocument;
    const walker = doc.createTreeWalker(holder, 4);
    const nodes = [];
    let text = "";
    const where = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement && node.parentElement.closest(UNREAD)) continue;
      const value = node.nodeValue;
      for (let i = 0; i < value.length; i++) {
        if (SPACE.test(value[i])) continue;
        text += value[i];
        where.push(nodes.length, i);
      }
      nodes.push(node);
    }
    const at = text.indexOf(want);
    if (at < 0) return null;
    const last = at + want.length - 1;
    const range = doc.createRange();
    range.setStart(nodes[where[2 * at]], where[2 * at + 1]);
    range.setEnd(nodes[where[2 * last]], where[2 * last + 1] + 1);
    return range;
  }

  root.Passage = { find, letters };
})(typeof window !== "undefined" ? window : globalThis);
