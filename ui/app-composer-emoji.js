// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const CHAT_EMOJI = ["😀", "😄", "😂", "🙂", "😉", "😍", "🤔", "😎", "🥳", "😅", "😢", "😡", "👍", "👎", "👋", "🙏", "👏", "💪", "🔥", "✨", "🎉", "❤️", "💜", "✅", "❌", "⚠️", "💡", "🚀", "🐛", "🤖", "🤫", "☕"];
  function create(uiRoot, { button, menu, signal, Avatars, listenKey, onPick, onFocus,
    window = uiRoot.ownerDocument.defaultView } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window });
    let grid = null;
    function toggle(open) {
      if (owner.disposed) return;
      if (open === undefined) open = menu.hidden;
      if (!open) { menu.hidden = true; return; }
      if (!menu.children.length) {
        grid = Avatars.searchableGrid(CHAT_EMOJI, null, owner.guard(emoji => {
          onPick(emoji);
          if (owner.disposed) return;
          toggle(false); onFocus();
        }), null, { root: uiRoot, signal: owner.signal });
        menu.appendChild(grid);
      }
      menu.hidden = false;
    }
    owner.on(button, "click", event => { event.stopPropagation(); toggle(); });
    owner.on(uiRoot, "click", event => { if (!menu.hidden && !menu.contains(event.target)) toggle(false); });
    owner.own(listenKey(owner.guard(event => { if (event.key === "Escape" && !menu.hidden) toggle(false); })));
    owner.own(() => { grid?.dispose(); grid?.remove(); grid = null; menu.hidden = true; });
    const dispose = () => owner.dispose();
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ toggle, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_COMPOSER_EMOJI = Object.freeze({ create });
})(globalThis);
