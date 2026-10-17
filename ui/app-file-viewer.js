// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function markup() { return `    <div class="file-head">
      <h3><span class="h-ico" data-icon="link"></span><span id="fv-title">File</span></h3>
      <p class="lead" id="fv-path"></p>
      <!-- reading a text file (U101): find a word, jump to a line, let long lines wrap -->
      <div class="fv-tools" id="fv-tools" hidden>
        <label class="search fv-find"><span class="search-icon" data-icon="search"></span><input id="fv-search" type="search" placeholder="Find in this file…" autocomplete="off"></label>
        <span class="fv-hits" id="fv-hits"></span>
        <label class="fv-goto">line <span data-ui="number-field" class="fv-num"><input class="input" id="fv-line" type="number" min="1" step="1" placeholder="1"><span class="steps" aria-hidden="true"><button type="button" data-act="up" tabindex="-1" title="More"></button><button type="button" data-act="down" tabindex="-1" title="Less"></button></span></span></label>
        <label class="fv-wrap"><input id="fv-wrap" type="checkbox"> wrap</label>
        <span class="fv-count" id="fv-count"></span>
      </div>
    </div>
    <div id="fv-body" class="file-view"></div>
    <div class="actions">
      <button type="button" id="fv-open" data-ui="button" data-kind="ghost">Open in editor</button>
      <button type="button" data-ui="button" data-kind="primary" data-file-close>Close</button>
    </div>
`; }
  function create(dialog, { window: view = dialog?.ownerDocument.defaultView, signal, icon: ic, readFile, csvTable, renderMarkdown, codeWithGutter,
    highlightBlocks, renderDiagrams, rowHeight, openInEditor, toast, onError, openDialog, closeDialog } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    const document = dialog.ownerDocument, $ = selector => dialog.querySelector(selector);
    let disposed = false, visit = 0;
    const active = entered => !disposed && !signal?.aborted && entered === visit && !dialog.classList.contains("closing");
    dialog.innerHTML = markup();
    dialog.querySelectorAll("[data-icon]").forEach(node => { node.innerHTML = ic(node.dataset.icon); });
    const els = { title: $("#fv-title"), path: $("#fv-path"), body: $("#fv-body"), open: $("#fv-open"), tools: $("#fv-tools"), search: $("#fv-search"),
      hits: $("#fv-hits"), line: $("#fv-line"), wrap: $("#fv-wrap"), goto: $(".fv-goto"), wrapBox: $(".fv-wrap"), count: $("#fv-count") };
    let fileView = null;
    async function open(path, line) {
      if (disposed) return;
      const entered = ++visit;
      try {
        if (dialog.classList.contains("closing")) openDialog(dialog);
        const at = Number(line) || 0;
        const r = await readFile(path, at > 1 ? { from: Math.max(1, at - 40), to: at + 200 } : null);
        if (!active(entered)) return;
        fileView = { path: r.path, kind: r.kind, language: r.language || null, from: r.from || 1, lines: r.lines || 0, more: !!r.more };
        els.title.textContent = r.path.split(/[\\/]/).pop();
        els.path.textContent = r.path;
        els.body.className = `file-view ${r.kind}`;
        const source = r.kind === "text";
        els.tools.hidden = false;
        els.goto.hidden = !source;
        els.wrapBox.hidden = !source;
        els.body.innerHTML =
          r.kind === "csv" ? csvTable(r.rows) : r.kind === "markdown" ? renderMarkdown(r.text) : codeWithGutter(r.text, r.language, r.from || 1);
        els.open.dataset.path = r.path;
        els.body.scrollTop = 0;
        els.search.value = "";
        els.hits.textContent = "";
        els.line.value = at > 1 ? String(at) : "";
        if (source) {
          els.count.textContent = `${r.lines}${r.more ? "+" : ""} lines${r.language ? ` · ${r.language}` : ""}${r.more ? " · shown in windows" : ""}`;
          els.body.classList.toggle("wrap", els.wrap.checked);
        } else if (r.kind === "csv") {
          const rows = Math.max(0, (r.rows || []).length - 1);
          els.count.textContent = `${rows} row${rows === 1 ? "" : "s"}`;
        } else {
          els.count.textContent = `${r.lines || 0} line${r.lines === 1 ? "" : "s"} · Markdown`;
        }
        openDialog(dialog);
        if (r.kind === "markdown") renderDiagrams(els.body);
        if (r.kind === "text") {
          await highlightBlocks(els.body);
          if (!active(entered)) return;
          if (at > 1) markLine(at);
        }
      } catch (error) { if (active(entered)) onError(error); }
    }
    function markLine(line) {
      const first = fileView ? fileView.from : 1;
      const index = line - first;
      const rows = els.body.querySelectorAll(".gutter span");
      const row = rows[index];
      if (!row) return;
      els.body.querySelectorAll(".line-mark").forEach((el) => el.classList.remove("line-mark"));
      row.classList.add("line-mark");
      const body = els.body.querySelector(".code-body");
      if (body) {
        const lineHeight = rowHeight(row) || 18;
        els.body.scrollTop = Math.max(0, index * lineHeight - els.body.clientHeight / 2);
      }
    }
    function findInFile(query) {
      const code = els.body.querySelector(".code-body code") || els.body;
      if (!code.firstChild) return;
      els.body.querySelectorAll(".find-hit").forEach((el) => el.replaceWith(document.createTextNode(el.textContent)));
      code.normalize();
      if (!query) {
        els.hits.textContent = "";
        return;
      }
      const needle = query.toLowerCase();
      let hits = 0;
      const walker = document.createTreeWalker(code, view.NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => (node.parentElement && node.parentElement.closest("svg") ? view.NodeFilter.FILTER_REJECT : view.NodeFilter.FILTER_ACCEPT),
      });
      const texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      for (const node of texts) {
        const value = node.nodeValue;
        const lower = value.toLowerCase();
        if (!lower.includes(needle)) continue;
        const frag = document.createDocumentFragment();
        let at = 0;
        for (;;) {
          const i = lower.indexOf(needle, at);
          if (i < 0) break;
          frag.appendChild(document.createTextNode(value.slice(at, i)));
          const mark = document.createElement("mark");
          mark.className = "find-hit";
          mark.textContent = value.slice(i, i + query.length);
          frag.appendChild(mark);
          at = i + query.length;
          hits++;
        }
        frag.appendChild(document.createTextNode(value.slice(at)));
        node.replaceWith(frag);
      }
      els.hits.textContent = hits ? `${hits} hit${hits === 1 ? "" : "s"}` : "nothing found";
      const first = els.body.querySelector(".find-hit");
      if (first) first.scrollIntoView({ block: "center" });
    }
    owner.on(els.search, "input", () => findInFile(els.search.value.trim()));
    owner.on(els.wrap, "change", () => els.body.classList.toggle("wrap", els.wrap.checked));
    owner.on(els.line, "change", async () => {
      const line = Number(els.line.value);
      if (!fileView || !line) return;
      if (line < fileView.from || !els.body.querySelectorAll(".gutter span")[line - fileView.from]) await open(fileView.path, line);
      else markLine(line);
    });
    owner.on(els.open, "click", async () => {
      if (!dialog.open) return;
      const entered = visit;
      try {
        const marked = els.body.querySelector(".gutter span.line-mark");
        const line = marked ? Number(marked.textContent) : fileView ? fileView.from : 1;
        const r = await openInEditor(`${els.open.dataset.path}:${line || 1}`);
        if (active(entered) && dialog.open) toast(r.message, "info");
      } catch (err) {
        if (active(entered) && dialog.open) onError(err);
      }
    });
    owner.on($("[data-file-close]"), "click", () => closeDialog(dialog));
    owner.on(dialog, "close", () => { ++visit; });
    const isOpen = () => dialog.open;
    const findField = () => (els.tools.hidden ? null : els.search);
    function dispose() { if (disposed) return; disposed = true; ++visit; owner.dispose(); if (dialog.open) closeDialog(dialog); }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ open, isOpen, findField, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_FILE_VIEWER = Object.freeze({ markup, create });
})(typeof window !== "undefined" ? window : globalThis);
