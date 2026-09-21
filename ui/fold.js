// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  const FOLD_SHOWN = 1200;
  const FOLD_STEP = 25;
  const orderOf = (m) => (m.displayOrder ?? m.seq);
  const isPinnedChat = (m) => !!m.pinned && m.kind === "chat";

  function anchorAt(messages, index) {
    const i = Math.max(0, Math.min(index, messages.length));
    if (i === 0) return { all: true };
    const m = messages.slice(i).find((x) => x.seq > 0);
    return m ? { id: m.id, order: orderOf(m) } : { all: true };
  }

  function foldIndexFor(messages, anchor, shown = FOLD_SHOWN) {
    const tail = Math.max(0, messages.length - shown);
    let index;
    if (!anchor) index = tail;
    else if (anchor.all) index = 0;
    else {
      const byId = messages.findIndex((m) => m.id === anchor.id);
      if (byId >= 0) index = byId;
      else {
        const byOrder = messages.findIndex((m) => orderOf(m) >= anchor.order);
        index = byOrder < 0 ? tail : byOrder;
      }
    }
    return index;
  }

  function anchorSurplus(messages, anchor, shown = FOLD_SHOWN) {
    if (!anchor) return 0;
    return Math.max(0, foldIndexFor(messages, null, shown) - foldIndexFor(messages, anchor, shown));
  }

  function partsOf(messages, index) {
    const hidden = Math.max(0, Math.min(index, messages.length));
    return {
      hidden,
      drawn: hidden ? messages.slice(hidden) : messages,
      above: hidden ? messages.slice(0, hidden).filter(isPinnedChat) : [],
    };
  }

  root.Fold = { FOLD_SHOWN, FOLD_STEP, orderOf, isPinnedChat, anchorAt, anchorSurplus, foldIndexFor, partsOf };
})(typeof window !== "undefined" ? window : globalThis);
