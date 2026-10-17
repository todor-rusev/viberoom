// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const RULE_MENTION_RE = /(?<![\w.\/:])@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;
  function mentionChip(p, editor, { avatar, colourOf }) {
    const document = editor.ownerDocument;
    const chip = document.createElement("span");
    chip.className = "mention-chip";
    chip.contentEditable = "false";
    chip.dataset.name = p.name;
    chip.style.color = colourOf(p);
    chip.innerHTML = `${avatar(p, 16, { vendor: false })}<span class="chip-name">@${esc(p.name)}</span>`;
    return chip;
  }
  function toNodes(editor, text, room, ports) {
    const document = editor.ownerDocument, { findByName } = ports;
    editor.innerHTML = "";
    let last = 0;
    for (const m of text.matchAll(RULE_MENTION_RE)) {
      const p = findByName(room, m[1]);
      if (!p) continue;
      editor.appendChild(document.createTextNode(text.slice(last, m.index)));
      editor.appendChild(mentionChip(p, editor, ports));
      last = m.index + m[0].length;
    }
    editor.appendChild(document.createTextNode(text.slice(last)));
  }
  function plainText(editor) {
    const Node = editor.ownerDocument.defaultView.Node;
    let out = "";
    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue;
        else if (n.nodeName === "BR") out += "\n";
        else if (n.classList && n.classList.contains("mention-chip")) out += `@${n.dataset.name}`;
        else if (n.nodeName === "DIV" || n.nodeName === "P") {
          if (out && !out.endsWith("\n")) out += "\n";
          walk(n);
          if (!out.endsWith("\n")) out += "\n";
        } else walk(n);
      }
    };
    walk(editor);
    return out.replace(/\n+$/, "");
  }
  function create(editor, menuEl, { window: view = editor?.ownerDocument.defaultView, signal, readRoom,
    findByName, avatar, colourOf } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    const document = editor.ownerDocument, window = view, Node = view.Node, currentRoom = readRoom;
    const look = { findByName, avatar, colourOf };
    const roomKey = room => JSON.stringify([room.scope, room.id, room.uuid, room.createdAt]);
    let rows = null, generation = 0, blurTimer = 0;
    const m = { open: false, items: [], index: 0, node: null, start: -1 };
    function caret() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
      const r = sel.getRangeAt(0);
      if (r.startContainer.nodeType !== Node.TEXT_NODE || !editor.contains(r.startContainer)) return null;
      return { node: r.startContainer, offset: r.startOffset };
    }
    function placeCaret(node, offset) {
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(node, offset);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    function context() {
      const c = caret();
      if (!c) return null;
      const before = c.node.nodeValue.slice(0, c.offset);
      const match = before.match(/(^|\s)@([\p{L}\p{N}_-]*)$/u);
      if (!match) return null;
      return { node: c.node, start: c.offset - match[2].length - 1, end: c.offset, prefix: match[2] };
    }
    function clear() {
      owner.clearTimeout(blurTimer); blurTimer = 0;
      rows?.dispose(); rows = null; ++generation;
      if (m.open) menuEl.hidden = true;
      m.open = false;
    }
    function close() { if (!owner.disposed) clear(); }
    function render() {
      if (owner.disposed) return;
      owner.clearTimeout(blurTimer); blurTimer = 0; ++generation;
      const ctx = context();
      const room = currentRoom();
      if (!ctx || !room) return close();
      const q = ctx.prefix.toLowerCase();
      const items = room.participants.filter((p) => p.name.toLowerCase().startsWith(q)).map(p => ({ ...p }));
      if (!items.length) return close();
      m.open = true;
      m.items = items;
      m.node = ctx.node;
      m.start = ctx.start;
      m.end = ctx.end;
      m.text = ctx.node.nodeValue;
      m.room = roomKey(room);
      if (m.index >= items.length) m.index = 0;
      rows?.dispose(); rows = root.VIBEROOM_APP_LIFETIME.create({ window: view });
      const entered = generation;
      menuEl.innerHTML = "";
      items.forEach((p, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = i === m.index ? "active" : "";
        b.innerHTML = `${avatar(p, 24, { vendor: true })}<span>${esc(p.name)}</span><span class="mm-sub">${esc(p.kind === "human" ? "you" : p.tagline || p.agentVendor || "")}${p.status === "offline" ? " · offline" : ""}</span>`;
        rows.on(b, "mousedown", (e) => {
          e.preventDefault();
          if (entered === generation) pick(i);
        });
        menuEl.appendChild(b);
      });
      menuEl.hidden = false;
    }
    function chipify(node, start, end, p) {
      const after = document.createTextNode(" " + node.nodeValue.slice(end));
      node.nodeValue = node.nodeValue.slice(0, start);
      const chip = mentionChip(p, editor, look);
      node.after(chip, after);
      return after;
    }
    function pick(i) {
      if (owner.disposed) return;
      const p = m.items[i], room = currentRoom(), at = caret();
      if (!p || !room || roomKey(room) !== m.room || findByName(room, p.name)?.id !== p.id || !editor.contains(m.node)
        || m.node.nodeValue !== m.text || at?.node !== m.node || at.offset !== m.end) return close();
      const after = chipify(m.node, m.start, m.end, p);
      close();
      editor.focus();
      placeCaret(after, 1);
    }
    function chipifyComplete() {
      const room = currentRoom();
      if (!room) return;
      const c = caret();
      for (const node of [...editor.childNodes, ...[...editor.querySelectorAll("div, p")].flatMap((b) => [...b.childNodes])]) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        for (const match of [...node.nodeValue.matchAll(RULE_MENTION_RE)].reverse()) {
          const end = match.index + match[0].length;
          if (!/\s/.test(node.nodeValue[end] || "")) continue;
          const p = findByName(room, match[1]);
          if (!p) continue;
          const caretHere = c && c.node === node ? c.offset : -1;
          const after = chipify(node, match.index, end + 1, p);
          if (caretHere >= end + 1) placeCaret(after, caretHere - end);
          break;
        }
      }
    }
    owner.on(editor, "input", () => {
      m.index = 0;
      chipifyComplete();
      render();
    });
    owner.on(editor, "paste", (e) => {
      e.preventDefault();
      document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text/plain"));
    });
    owner.on(editor, "blur", () => {
      owner.clearTimeout(blurTimer); const entered = generation;
      blurTimer = owner.timeout(() => { if (generation === entered) close(); }, 150);
    });
    owner.on(editor, "keydown", (event) => {
      if (!m.open) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        m.index = (m.index + (event.key === "ArrowDown" ? 1 : m.items.length - 1)) % m.items.length;
        render();
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(m.index);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
    function dispose() { if (owner.disposed) return; clear(); owner.dispose(); }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ render, close, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_RULES_EDITOR = Object.freeze({ toNodes, text: plainText, create });
})(globalThis);
