// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const WARM_MS = 600;
  const GAP = 8;
  const EDGE = 8;

  function install({ doc = root.document, layout, delayMs, inMenu = (owner) => !!owner.closest(".rail") }) {
    const hint = doc.createElement("div");
    hint.id = "vr-hint";
    hint.dataset.ui = "hint";
    hint.setAttribute("role", "tooltip");
    const popover = typeof hint.showPopover === "function";
    if (popover) hint.setAttribute("popover", "manual");
    else hint.hidden = true;
    doc.body.appendChild(hint);
    let open = false;
    const raise = () => { if (open) return; open = true; if (popover) hint.showPopover(); else hint.hidden = false; };
    const lower = () => { if (!open) return; open = false; if (popover) hint.hidePopover(); else hint.hidden = true; };
    const state = { owner: null, pending: null, timer: 0, hiddenAt: 0, describes: false };

    function take(owner) {
      const title = owner.getAttribute("title");
      if (title === null || owner === hint) return;
      owner.removeAttribute("title");
      if (title.trim()) owner.dataset.hint = title;
      else delete owner.dataset.hint;
      const named = owner.hasAttribute("aria-labelledby") || (owner.hasAttribute("aria-label") && owner.dataset.hintNamed !== "1");
      if (title.trim() && !named && !String(owner.textContent || "").trim()) {
        owner.setAttribute("aria-label", title);
        owner.dataset.hintNamed = "1";
      }
      if (owner === state.owner && owner.dataset.hint) hint.textContent = owner.dataset.hint;
    }
    function ownerOf(target) {
      const owner = target && target.closest ? target.closest("[title], [data-hint]") : null;
      if (!owner || owner === hint || hint.contains(owner)) return null;
      take(owner);
      return owner.dataset.hint ? owner : null;
    }
    const takeAll = (root_) => { if (root_.nodeType === 1) { if (root_.hasAttribute("title")) take(root_); for (const el of root_.querySelectorAll("[title]")) take(el); } };
    const View = doc.defaultView;
    if (View && typeof View.MutationObserver === "function") {
      new View.MutationObserver((changes) => {
        for (const change of changes) {
          if (change.type === "attributes") { if (change.target.hasAttribute("title")) take(change.target); }
          else for (const node of change.addedNodes) takeAll(node);
        }
      }).observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
    }
    takeAll(doc.body);
    function visibleWords(owner) {
      const view = doc.defaultView;
      const drawn = (el) => {
        for (let at = el; at && at !== owner.parentElement; at = at.parentElement) {
          const style = view.getComputedStyle(at);
          const opacity = style.opacity === "" ? 1 : Number(style.opacity);
          if (style.display === "none" || style.visibility === "hidden" || opacity < 0.05) return false;
          if (at.getBoundingClientRect().width < 1) return false;
        }
        return true;
      };
      const words = [];
      const walker = doc.createTreeWalker(owner, 4);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeValue.trim() && drawn(node.parentElement)) words.push(node.nodeValue);
      }
      return words.join(" ").replace(/\s+/g, " ").trim();
    }
    function show(owner) {
      if (!owner.isConnected || !owner.dataset.hint) return hide();
      const words = owner.dataset.hint;
      if (visibleWords(owner) === words.replace(/\s+/g, " ").trim()) return hide();
      state.owner = owner;
      hint.textContent = words;
      const menu = inMenu(owner);
      hint.dataset.side = menu ? "right" : "below";
      hint.dataset.size = menu ? "menu" : "compact";
      raise();
      place();
      const name = (owner.getAttribute("aria-label") || String(owner.textContent || "")).replace(/s+/g, " ").trim();
      state.describes = name !== words.replace(/s+/g, " ").trim();
      if (state.describes) owner.setAttribute("aria-describedby", [owner.getAttribute("aria-describedby"), hint.id].filter(Boolean).join(" "));
    }
    function place() {
      const owner = state.owner;
      if (!owner || !owner.isConnected) return hide();
      const r = layout.rect(owner);
      const width = layout.length(root.innerWidth), height = layout.length(root.innerHeight);
      const w = hint.offsetWidth, h = hint.offsetHeight;
      let left, top;
      if (hint.dataset.side === "right") {
        left = r.right + GAP;
        top = r.top + (r.height - h) / 2;
      } else {
        left = r.left + (r.width - w) / 2;
        const below = r.bottom + GAP + h <= height - EDGE;
        hint.dataset.side = below ? "below" : "above";
        top = below ? r.bottom + GAP : r.top - GAP - h;
      }
      hint.style.left = `${Math.round(Math.max(EDGE, Math.min(left, width - w - EDGE)))}px`;
      hint.style.top = `${Math.round(Math.max(EDGE, Math.min(top, height - h - EDGE)))}px`;
    }
    function hide() {
      clearTimeout(state.timer);
      state.timer = 0;
      state.pending = null;
      if (state.owner) {
        if (state.describes) {
          const rest = (state.owner.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== hint.id).join(" ");
          if (rest) state.owner.setAttribute("aria-describedby", rest);
          else state.owner.removeAttribute("aria-describedby");
        }
        state.owner = null;
        state.hiddenAt = Date.now();
      }
      lower();
    }
    function soon(owner) {
      const warm = Date.now() - state.hiddenAt < WARM_MS || !!state.owner;
      hide();
      if (warm) return show(owner);
      state.pending = owner;
      state.timer = setTimeout(() => { state.pending = null; state.timer = 0; show(owner); }, delayMs());
    }

    doc.addEventListener("pointerover", (e) => {
      if (e.pointerType === "touch" || e.buttons) return;
      const owner = ownerOf(e.target);
      if (!owner || owner === state.owner || owner === state.pending) return;
      soon(owner);
    }, true);
    doc.addEventListener("pointerout", (e) => {
      const current = state.owner || state.pending;
      if (current && !(e.relatedTarget && current.contains(e.relatedTarget))) hide();
    }, true);
    doc.addEventListener("focusin", (e) => {
      const owner = ownerOf(e.target);
      let keyboard = false;
      try { keyboard = e.target.matches(":focus-visible"); } catch { }
      if (owner && keyboard) soon(owner);
    });
    doc.addEventListener("focusout", () => hide());
    for (const type of ["pointerdown", "wheel", "keydown"]) doc.addEventListener(type, () => { if (state.owner || state.timer) hide(); }, true);
    doc.addEventListener("scroll", () => { if (state.owner) hide(); }, true);
    root.addEventListener("blur", hide);
    root.addEventListener("resize", hide);
    return { hide, element: hint };
  }

  root.VIBEROOM_HINTS = Object.freeze({ install });
})(globalThis);
