// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  function build(items, price, gap = 0, before = null) {
    const index = {
      items,
      gap,
      before,
      reckoned: new Array(items.length),
      seen: new Array(items.length),
      tops: null,
      total: 0,
    };
    for (let i = 0; i < items.length; i++) index.reckoned[i] = Math.max(0, price(items[i]));
    return settle(index);
  }

  const heightAt = (index, i) => (index.seen[i] === undefined ? index.reckoned[i] : index.seen[i]);

  function settle(index) {
    const tops = new Array(index.items.length + 1);
    let at = 0;
    for (let i = 0; i < index.items.length; i++) {
      if (i) at += index.gap;
      if (index.before) at += index.before(i);
      tops[i] = at;
      at += heightAt(index, i);
    }
    tops[index.items.length] = at;
    index.tops = tops;
    index.total = at;
    return index;
  }

  function measured(index, i, px) {
    if (i < 0 || i >= index.items.length || !(px > 0) || index.seen[i] === px) return false;
    index.seen[i] = px;
    index.tops = null;
    return true;
  }
  function repriceRow(index, i, px) {
    if (i < 0 || i >= index.items.length) return;
    index.reckoned[i] = Math.max(0, px);
    index.seen[i] = undefined;
    index.tops = null;
  }

  function reprice(index, price, gap = index.gap, before = index.before) {
    index.gap = gap;
    index.before = before;
    for (let i = 0; i < index.items.length; i++) index.reckoned[i] = Math.max(0, price(index.items[i]));
    index.tops = null;
    return index;
  }

  function forgetSeen(index, keeps) {
    for (let i = 0; i < index.items.length; i++) if (index.seen[i] !== undefined && !keeps(index.items[i], i)) index.seen[i] = undefined;
    index.tops = null;
    return index;
  }

  const ready = (index) => (index.tops ? index : settle(index));

  function rowAt(index, y) {
    const { tops, items } = ready(index);
    if (!items.length) return -1;
    let low = 0;
    let high = items.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (tops[middle] <= y) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  const topOf = (index, i) => ready(index).tops[Math.max(0, Math.min(i, index.items.length))];
  const total = (index) => ready(index).total;

  function rangeFor(index, top, bottom, over = 0) {
    const { items } = ready(index);
    if (!items.length) return { from: 0, to: 0 };
    const first = Math.max(0, rowAt(index, top) - over);
    let last = rowAt(index, bottom);
    last = Math.min(items.length - 1, last + over);
    return { from: first, to: last + 1 };
  }

  root.ListIndex = { build, settle, measured, repriceRow, reprice, forgetSeen, rowAt, topOf, total, rangeFor, heightAt };
})(typeof window !== "undefined" ? window : globalThis);
