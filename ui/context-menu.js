// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";

  function keepsBrowserMenu(target, selection) {
    const el = target && target.nodeType === 1 ? target : target && target.parentElement;
    if (!el || !el.closest) return false;
    if (el.closest("input, textarea, [contenteditable]:not([contenteditable='false']), a[href], img, video")) return true;
    if (!selection || selection.isCollapsed || !String(selection).trim()) return false;
    for (let i = 0; i < selection.rangeCount; i++) if (selection.getRangeAt(i).intersectsNode(el)) return true;
    return false;
  }

  function install({ doc = root.document } = {}) {
    doc.addEventListener("contextmenu", (e) => {
      if (!keepsBrowserMenu(e.target, doc.getSelection && doc.getSelection())) e.preventDefault();
    });
  }

  root.VIBEROOM_CONTEXT_MENU = { install, keepsBrowserMenu };
})(typeof window !== "undefined" ? window : globalThis);
