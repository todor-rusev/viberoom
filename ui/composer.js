// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";

  const MARKER_RE = /\[(img|quote) (\d+)\]/gi;
  const MENTION_RE = /(?<![\w.\/:])@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;
  const TOKEN_CLASS = "cmp-token";
  const MENTION_CLASS = "cmp-mention";
  const END_CLASS = "cmp-end";
  const HISTORY_MAX = 300;
  const COALESCE_MS = 1000;
  const TYPING = new Set(["insertText", "insertCompositionText", "deleteContentBackward", "deleteContentForward"]);

  function markersIn(text) {
    return [...String(text).matchAll(MARKER_RE)].map((m) => ({ kind: m[1].toLowerCase(), n: Number(m[2]), marker: m[0], start: m.index, end: m.index + m[0].length }));
  }

  function segments(text, hooks = {}) {
    const found = [];
    for (const m of markersIn(text)) {
      const token = hooks.resolveToken ? hooks.resolveToken(m.kind, m.n) : null;
      if (token) found.push({ type: "token", start: m.start, end: m.end, text: m.marker, kind: m.kind, n: m.n, token });
    }
    for (const m of String(text).matchAll(MENTION_RE)) {
      const start = m.index, end = start + m[0].length;
      if (found.some((f) => start < f.end && end > f.start)) continue;
      const who = hooks.resolveMention ? hooks.resolveMention(m[1]) : null;
      if (who) found.push({ type: "mention", start, end, text: m[0], name: m[1], who });
    }
    found.sort((a, b) => a.start - b.start);
    const out = [];
    let at = 0;
    for (const f of found) {
      if (f.start > at) out.push({ type: "text", text: text.slice(at, f.start) });
      out.push(f);
      at = f.end;
    }
    if (at < text.length) out.push({ type: "text", text: text.slice(at) });
    return out;
  }

  function renderNodes(doc, text, hooks) {
    const frag = doc.createDocumentFragment();
    for (const s of segments(text, hooks)) {
      if (s.type === "text") frag.appendChild(doc.createTextNode(s.text));
      else if (s.type === "mention") {
        const span = doc.createElement("span");
        span.className = MENTION_CLASS;
        if (s.who.color) span.style.setProperty("--mention", s.who.color);
        span.textContent = s.text;
        frag.appendChild(span);
      } else {
        const span = doc.createElement("span");
        span.className = TOKEN_CLASS;
        span.setAttribute("contenteditable", "false");
        span.dataset.kind = s.kind;
        span.dataset.n = String(s.n);
        span.dataset.marker = s.text;
        span.setAttribute("role", "img");
        span.setAttribute("aria-label", `${s.kind === "img" ? "picture" : "quote"} ${s.n}`);
        if (s.token.title) span.title = s.token.title;
        span.innerHTML = `${s.token.icon || ""}<span class="cmp-n">${s.n}</span>`;
        frag.appendChild(span);
      }
    }
    if (text.endsWith("\n")) {
      const br = doc.createElement("br");
      br.className = END_CLASS;
      frag.appendChild(br);
    }
    return frag;
  }

  const isBlock = (node) => node.nodeType === 1 && /^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE)$/.test(node.nodeName);

  function readText(node) {
    let out = "";
    let afterBlock = false;
    const emit = (text) => {
      if (!text) return;
      if (afterBlock && out && !out.endsWith("\n")) out += "\n";
      afterBlock = false;
      out += text;
    };
    const walk = (parent) => {
      for (const n of parent.childNodes) {
        if (n.nodeType === 3) emit(n.nodeValue.replace(/\u00a0/g, " ").replace(/\u200b/g, ""));
        else if (n.nodeType !== 1) continue;
        else if (n.dataset && n.dataset.marker) emit(n.dataset.marker);
        else if (n.nodeName === "BR") {
          if (n.classList.contains(END_CLASS)) continue;
          if (isBlock(parent) && n === parent.lastChild && parent.childNodes.length > 1) continue;
          afterBlock = false;
          out += "\n";
        } else if (isBlock(n)) {
          if (out && !out.endsWith("\n")) out += "\n";
          afterBlock = false;
          walk(n);
          afterBlock = true;
        } else walk(n);
      }
    };
    walk(node);
    return out;
  }

  function offsetOf(el, container, offset) {
    if (!el.contains(container)) return null;
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    try {
      range.setEnd(container, offset);
    } catch {
      return null;
    }
    const token = (container.nodeType === 1 ? container : container.parentNode).closest?.(`.${TOKEN_CLASS}`);
    if (token && el.contains(token)) range.setEndAfter(token);
    return readText(range.cloneContents()).length;
  }

  function pointAt(el, offset) {
    let left = Math.max(0, offset);
    const nodes = [...el.childNodes];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.nodeType === 1 && n.classList.contains(END_CLASS)) return { node: el, offset: i };
      const holder = n.nodeType === 3 ? n : n.classList.contains(MENTION_CLASS) ? n.firstChild : null;
      const length = n.nodeType === 3 ? n.nodeValue.length : n.dataset.marker ? n.dataset.marker.length : readText(n).length;
      if (holder && left <= length) return { node: holder, offset: left };
      if (!holder && left === 0) return { node: el, offset: i };
      if (!holder && left < length) return { node: el, offset: i + 1 };
      left -= length;
    }
    return { node: el, offset: nodes.length };
  }

  const instances = new WeakMap();

  class Composer {
    constructor(el, hooks = {}) {
      this.el = el;
      this.hooks = hooks;
      this.doc = el.ownerDocument;
      el.setAttribute("contenteditable", "true");
      el.setAttribute("role", "textbox");
      el.setAttribute("aria-multiline", "true");
      if (!el.hasAttribute("spellcheck")) el.setAttribute("spellcheck", "true");
      this.text = readText(el);
      this.saved = { start: this.text.length, end: this.text.length };
      this.history = [{ text: this.text, start: this.text.length, end: this.text.length }];
      this.at = 0;
      this.last = { type: "", time: 0 };
      this.composing = false;
      this.dispatching = false;
      this.draw();
      this.listen();
    }

    get value() { return this.composing ? readText(this.el) : this.text; }
    set value(text) {
      const t = String(text ?? "");
      this.commit(t, t.length, t.length, "set");
    }
    get selectionStart() { return this.selection().start; }
    get selectionEnd() { return this.selection().end; }
    setSelectionRange(start, end = start) {
      const len = this.text.length;
      const s = Math.max(0, Math.min(len, Number(start) || 0));
      const e = Math.max(s, Math.min(len, Number(end) || 0));
      this.saved = { start: s, end: e };
      if (this.focused()) this.place();
    }
    setRangeText(text, start, end, mode = "preserve") {
      const sel = this.selection();
      const s = Math.max(0, Math.min(this.text.length, start ?? sel.start));
      const e = Math.max(s, Math.min(this.text.length, end ?? sel.end));
      const t = String(text ?? "");
      const next = this.text.slice(0, s) + t + this.text.slice(e);
      let caret;
      if (mode === "end") caret = { start: s + t.length, end: s + t.length };
      else if (mode === "select") caret = { start: s, end: s + t.length };
      else if (mode === "start") caret = { start: s, end: s };
      else {
        const shift = (p) => (p <= s ? p : p >= e ? p + t.length - (e - s) : s + t.length);
        caret = { start: shift(sel.start), end: shift(sel.end) };
      }
      this.commit(next, caret.start, caret.end, "set");
    }
    focus(options) {
      if (this.disabled) return;
      this.el.focus(options || { preventScroll: true });
      this.place();
    }
    blur() { this.el.blur(); }
    get disabled() { return this.el.getAttribute("aria-disabled") === "true"; }
    set disabled(on) {
      this.el.setAttribute("contenteditable", on ? "false" : "true");
      this.el.setAttribute("aria-disabled", on ? "true" : "false");
      this.el.classList.toggle("is-disabled", !!on);
    }
    get placeholder() { return this.el.dataset.placeholder || ""; }
    set placeholder(text) {
      this.el.dataset.placeholder = String(text ?? "");
      this.el.setAttribute("aria-placeholder", String(text ?? ""));
    }
    addEventListener(...args) { this.el.addEventListener(...args); }
    removeEventListener(...args) { this.el.removeEventListener(...args); }

    reset(text = "") {
      const t = String(text);
      this.commit(t, t.length, t.length, null);
      this.history = [{ text: t, start: t.length, end: t.length }];
      this.at = 0;
      this.last = { type: "", time: 0 };
    }
    refresh() {
      if (this.composing || !/[@[]/.test(this.text)) return;
      const sel = this.selection();
      this.draw();
      this.saved = sel;
      if (this.focused()) this.place();
    }
    undo() { this.travel(-1); }
    redo() { this.travel(1); }
    markers() { return markersIn(this.text); }

    commit(text, start, end, type, typed = false) {
      const previous = this.text;
      this.text = text;
      if (text !== previous && this.hooks.onText) this.hooks.onText(text, previous);
      const redrawn = this.draw();
      this.saved = { start: Math.min(start, text.length), end: Math.min(end, text.length) };
      if (this.focused() && (redrawn || !typed)) this.place();
      if (type && text !== previous) this.record(type);
      if (text !== previous && this.hooks.onChange) this.hooks.onChange();
    }
    record(type) {
      const now = Date.now();
      const entry = { text: this.text, start: this.saved.start, end: this.saved.end };
      const merge = TYPING.has(type) && type === this.last.type && now - this.last.time < COALESCE_MS && this.at > 0;
      const endsWord = type === "insertText" && /\s/.test(this.text.charAt(entry.start - 1));
      this.history.length = this.at + 1;
      if (merge) this.history[this.at] = entry;
      else {
        this.history.push(entry);
        if (this.history.length > HISTORY_MAX) this.history.shift();
        this.at = this.history.length - 1;
      }
      this.last = { type: endsWord ? "" : type, time: now };
    }
    travel(step) {
      const to = this.at + step;
      if (to < 0 || to >= this.history.length) return;
      this.at = to;
      this.last = { type: "", time: 0 };
      const e = this.history[to];
      this.commit(e.text, e.start, e.end, null);
      this.announce(step < 0 ? "historyUndo" : "historyRedo");
    }
    edit(text, start, end, type) {
      const s = this.selection();
      const from = start ?? s.start, to = end ?? s.end;
      const next = this.text.slice(0, from) + text + this.text.slice(to);
      this.commit(next, from + text.length, from + text.length, type);
      this.announce(type);
    }
    announce(inputType) {
      this.dispatching = true;
      try {
        const Ev = this.doc.defaultView.InputEvent || this.doc.defaultView.Event;
        this.el.dispatchEvent(new Ev("input", { bubbles: true, inputType }));
      } finally {
        this.dispatching = false;
      }
    }

    draw() {
      const want = this.doc.createElement("div");
      want.appendChild(renderNodes(this.doc, this.text, this.hooks));
      const changed = want.innerHTML !== this.el.innerHTML;
      if (changed) {
        const kept = new Map([...this.el.querySelectorAll(`.${TOKEN_CLASS}`)].map((n) => [n.dataset.marker, n]));
        const nodes = [...want.childNodes].map((n) => {
          const old = n.nodeType === 1 && n.dataset.marker ? kept.get(n.dataset.marker) : null;
          if (old && old.isEqualNode(n)) {
            kept.delete(n.dataset.marker);
            return old;
          }
          return n;
        });
        const top = this.el.scrollTop;
        this.el.replaceChildren(...nodes);
        this.el.scrollTop = top;
      }
      this.el.classList.toggle("is-empty", this.text === "");
      return changed;
    }
    focused() {
      return this.doc.activeElement === this.el;
    }
    selection() {
      const sel = this.doc.getSelection ? this.doc.getSelection() : null;
      if (sel && sel.rangeCount && this.focused()) {
        const r = sel.getRangeAt(0);
        const start = offsetOf(this.el, r.startContainer, r.startOffset);
        const end = offsetOf(this.el, r.endContainer, r.endOffset);
        if (start !== null && end !== null) return { start: Math.min(start, end), end: Math.max(start, end) };
      }
      return { ...this.saved };
    }
    place() {
      const sel = this.doc.getSelection ? this.doc.getSelection() : null;
      if (!sel) return;
      const a = pointAt(this.el, this.saved.start);
      const b = pointAt(this.el, this.saved.end);
      const r = this.doc.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    sync(type) {
      const text = readText(this.el);
      const sel = this.selection();
      if (text === this.text) {
        this.saved = sel;
        return;
      }
      this.commit(text, sel.start, sel.end, type || "insertText", true);
    }

    listen() {
      const el = this.el;
      el.addEventListener("beforeinput", (e) => {
        const t = e.inputType || "";
        if (t === "historyUndo" || t === "historyRedo") {
          e.preventDefault();
          this.travel(t === "historyUndo" ? -1 : 1);
        } else if (t === "insertParagraph" || t === "insertLineBreak") {
          e.preventDefault();
          this.edit("\n", undefined, undefined, "insertLineBreak");
        } else if (t.startsWith("format")) e.preventDefault();
        else if (t === "insertFromDrop" || t === "insertFromPaste") e.preventDefault();
      });
      el.addEventListener("input", (e) => {
        if (this.dispatching) return;
        if (this.composing || e.isComposing) return;
        this.sync(e.inputType);
      });
      el.addEventListener("compositionstart", () => { this.composing = true; });
      el.addEventListener("compositionend", () => {
        this.composing = false;
        this.sync("insertCompositionText");
      });
      el.addEventListener("keydown", (e) => this.key(e));
      el.addEventListener("paste", (e) => {
        if (this.hooks.onPaste) this.hooks.onPaste(e);
        if (e.defaultPrevented) return;
        e.preventDefault();
        const data = e.clipboardData || this.doc.defaultView.clipboardData;
        const text = data ? String(data.getData("text/plain") || "").replace(/\r\n?/g, "\n") : "";
        if (text) this.edit(text, undefined, undefined, "insertFromPaste");
      });
      for (const kind of ["copy", "cut"]) {
        el.addEventListener(kind, (e) => {
          const s = this.selection();
          if (s.start === s.end || !e.clipboardData) return;
          e.preventDefault();
          e.clipboardData.setData("text/plain", this.text.slice(s.start, s.end));
          if (kind === "cut") this.edit("", s.start, s.end, "deleteByCut");
        });
      }
      el.addEventListener("dragstart", (e) => e.preventDefault());
      el.addEventListener("drop", (e) => {
        const dt = e.dataTransfer;
        if (!dt || (dt.files && dt.files.length) || [...(dt.types || [])].includes("Files")) return;
        const text = String(dt.getData("text/plain") || "").replace(/\r\n?/g, "\n");
        e.preventDefault();
        if (!text) return;
        const at = this.dropOffset(e);
        this.focus();
        this.edit(text, at, at, "insertFromDrop");
      });
      this.doc.addEventListener("selectionchange", () => {
        if (!this.focused() || this.composing) return;
        this.saved = this.selection();
      });
    }
    dropOffset(e) {
      const doc = this.doc;
      let node = null, offset = 0;
      if (doc.caretPositionFromPoint) {
        const p = doc.caretPositionFromPoint(e.clientX, e.clientY);
        if (p) { node = p.offsetNode; offset = p.offset; }
      } else if (doc.caretRangeFromPoint) {
        const r = doc.caretRangeFromPoint(e.clientX, e.clientY);
        if (r) { node = r.startContainer; offset = r.startOffset; }
      }
      const at = node ? offsetOf(this.el, node, offset) : null;
      return at === null ? this.selection().end : at;
    }
    key(e) {
      if (e.defaultPrevented || this.composing || e.isComposing) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = (e.key || "").toLowerCase();
      if (mod && !e.altKey && k === "z") {
        e.preventDefault();
        this.travel(e.shiftKey ? 1 : -1);
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && k === "y") {
        e.preventDefault();
        this.travel(1);
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && (k === "b" || k === "i" || k === "u")) {
        e.preventDefault();
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && !mod && !e.altKey) {
        const s = this.selection();
        if (s.start !== s.end) return;
        const token = this.tokenAt(s.start, e.key === "Backspace" ? -1 : 1);
        if (!token) return;
        e.preventDefault();
        this.edit("", token.start, token.end, e.key === "Backspace" ? "deleteContentBackward" : "deleteContentForward");
        this.last = { type: "", time: 0 };
      }
    }
    tokenAt(at, side) {
      return segments(this.text, this.hooks).find((s) => s.type === "token" && (side < 0 ? s.end === at : s.start === at)) || null;
    }
  }

  const api = {
    attach(el, hooks) {
      if (instances.has(el)) return instances.get(el);
      const c = new Composer(el, hooks);
      instances.set(el, c);
      return c;
    },
    of: (el) => instances.get(el) || null,
    markersIn,
    segments,
    readText,
    offsetOf,
    pointAt,
    MENTION_RE,
  };
  root.Composer = api;
})(typeof window !== "undefined" ? window : globalThis);
