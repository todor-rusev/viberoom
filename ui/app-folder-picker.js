// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  function markup() { return `    <div class="file-head">
      <h3><span class="h-ico" data-icon="folder"></span>Choose a folder</h3>
      <div class="fp-bar">
        <input id="fp-path" type="text" spellcheck="false" placeholder="Type a path and press Enter, or pick one below">
        <button type="button" data-ui="button" data-kind="ghost" id="fp-home" title="Your home folder"><span data-icon="user"></span>Home</button>
        <button type="button" data-ui="button" data-kind="ghost" id="fp-new" title="New folder inside the selected one"><span data-icon="plus"></span>New folder</button>
      </div>
      <div class="fp-recent" id="fp-recent"></div>
    </div>
    <div class="fp-body">
      <ul class="tree" id="fp-tree"></ul>
    </div>
    <p class="error" id="fp-error" hidden></p>
    <div class="actions">
      <span class="fp-selected" id="fp-selected"></span>
      <button type="button" data-ui="button" data-kind="ghost" data-folder-close>Cancel</button>
      <button type="button" data-ui="button" data-kind="primary" id="fp-choose">Choose this folder</button>
    </div>
`; }
  const sepOf = (p) => (p.includes("\\") || /^[A-Za-z]:/.test(p) ? "\\" : "/");
  const sameFolder = (a, b) => a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
  const isUnder = (child, parent) => {
    const c = child.replace(/[\\/]+$/, "").toLowerCase();
    const p = parent.replace(/[\\/]+$/, "").toLowerCase();
    return c === p || c.startsWith(p + sepOf(parent)) || (parent.endsWith(sepOf(parent)) && c.startsWith(p + sepOf(parent)));
  };
  function create(dialog, { window: view = dialog?.ownerDocument.defaultView, signal, UI, icon: ic, readDirs, makeDir, recentDirs, openDialog, closeDialog } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    const domResources = root.VIBEROOM_APP_DOM_LIFETIME.create({ root: dialog, lifetime: owner });
    const document = dialog.ownerDocument, $ = selector => dialog.querySelector(selector);
    let disposed = false, visit = 0;
    dialog.innerHTML = markup();
    dialog.querySelectorAll("[data-icon]").forEach(node => { node.innerHTML = ic(node.dataset.icon); });
    const fp = { onChoose: null, selected: "", roots: [], home: "" };
    const fpEls = { dialog, path: $("#fp-path"), tree: $("#fp-tree"), recent: $("#fp-recent"), error: $("#fp-error"), selected: $("#fp-selected"), choose: $("#fp-choose"), home: $("#fp-home"), newBtn: $("#fp-new") };
    const active = entered => !disposed && !signal?.aborted && entered === visit && dialog.open && !dialog.classList.contains("closing");
    function fpFail(error) {
      fpEls.error.textContent = error.message || String(error);
      fpEls.error.hidden = false;
    }
    function fpNode(entry) {
      const li = document.createElement("li");
      li.dataset.path = entry.path;
      li.innerHTML = `<div class="tn${entry.hidden ? " hidden-dir" : ""}"><button type="button" class="tn-tw" title="Expand">${ic("forward")}</button><span class="tn-ico">📁</span><span class="tn-name">${esc(entry.name)}</span></div><ul hidden></ul>`;
      return li;
    }
    function fpSelect(path, li) {
      fp.selected = path;
      fpEls.tree.querySelectorAll(".tn.selected").forEach((el) => el.classList.remove("selected"));
      if (li) li.querySelector(":scope > .tn").classList.add("selected");
      fpEls.path.value = path;
      fpEls.selected.textContent = path;
      fpEls.error.hidden = true;
    }
    async function fpLoad(li, entered) {
      const ul = li.querySelector(":scope > ul");
      if (li.dataset.loaded) return ul;
      const data = await readDirs(li.dataset.path);
      if (!active(entered)) return ul;
      ul.innerHTML = "";
      for (const d of data.dirs) ul.appendChild(fpNode(d));
      if (!data.dirs.length) ul.innerHTML = `<li class="tn-more">no sub-folders</li>`;
      li.dataset.loaded = "1";
      li.querySelector(":scope > .tn").classList.toggle("leaf", !data.dirs.length);
      return ul;
    }
    async function fpExpand(li, open, entered = visit) {
      const tn = li.querySelector(":scope > .tn");
      const ul = li.querySelector(":scope > ul");
      const want = open === undefined ? ul.hidden : open;
      if (!want) {
        ul.hidden = true;
        tn.classList.remove("open");
        return;
      }
      tn.classList.add("open");
      try {
        await fpLoad(li, entered);
        if (active(entered)) ul.hidden = false;
      } catch (e) {
        if (!active(entered)) return;
        tn.classList.remove("open");
        fpFail(e);
      }
    }
    async function fpReveal(path, entered = visit) {
      const target = path.replace(/[\\/]+$/, "") || path;
      let level = fpEls.tree;
      let found = null;
      for (let guard = 0; guard < 64; guard++) {
        const li = [...level.children].find((el) => el.dataset && el.dataset.path && isUnder(target, el.dataset.path));
        if (!li) break;
        found = li;
        if (sameFolder(li.dataset.path, target)) break;
        await fpExpand(li, true, entered);
        if (!active(entered)) return false;
        level = li.querySelector(":scope > ul");
      }
      if (found && sameFolder(found.dataset.path, target)) {
        fpSelect(found.dataset.path, found);
        found.scrollIntoView({ block: "center" });
        return true;
      }
      return false;
    }
    async function fpGoTo(typed, entered = visit) {
      const p = typed.trim();
      if (!p) return;
      try {
        const data = await readDirs(p);
        if (!active(entered)) return;
        if (!(await fpReveal(data.path, entered)) && active(entered)) fpSelect(data.path, null);
      } catch (e) {
        if (active(entered)) fpFail(e);
      }
    }
    function fpRecent() {
      const dirs = [];
      for (const dir of recentDirs()) if (dir && !dirs.some((d) => sameFolder(d, dir))) dirs.push(dir);
      fpEls.recent.innerHTML = "";
      for (const d of dirs.slice(0, 6)) {
        const b = UI.el("choice", { label: d.split(/[\\/]/).filter(Boolean).slice(-1)[0] || d, title: d });
        domResources.nodeListener(b, "click", () => fpGoTo(d));
        fpEls.recent.appendChild(b);
      }
    }
    async function open(initial, onChoose) {
      if (disposed) return;
      const entered = ++visit;
      fp.onChoose = onChoose;
      fpEls.error.hidden = true;
      fpEls.tree.innerHTML = `<li class="tn-more">loading…</li>`;
      fpSelect("", null);
      openDialog(dialog);
      try {
        const data = await readDirs();
        if (!active(entered)) return;
        fp.roots = data.roots;
        fp.home = data.home;
        fpEls.tree.innerHTML = "";
        for (const r of data.roots) fpEls.tree.appendChild(fpNode(r));
        fpRecent();
        const start = (initial || "").trim() || data.home;
        await fpGoTo(start, entered);
        if (active(entered)) fpEls.path.focus();
      } catch (e) {
        if (active(entered)) fpFail(e);
      }
    }
    owner.on(fpEls.tree, "click", (e) => {
      const li = e.target.closest("li[data-path]");
      if (!li) return;
      if (e.target.closest(".tn-tw")) return void fpExpand(li);
      fpSelect(li.dataset.path, li);
    });
    owner.on(fpEls.tree, "dblclick", (e) => {
      const li = e.target.closest("li[data-path]");
      if (li && !e.target.closest(".tn-tw")) fpExpand(li);
    });
    owner.on(fpEls.path, "keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        fpGoTo(fpEls.path.value);
      }
    });
    owner.on(fpEls.home, "click", () => fpGoTo(fp.home));
    owner.on(fpEls.newBtn, "click", async () => {
      const entered = visit;
      const li = fpEls.tree.querySelector(".tn.selected")?.closest("li[data-path]");
      if (!li) return fpFail(new Error("select the folder to create it in first"));
      await fpExpand(li, true, entered);
      if (!active(entered)) return;
      const ul = li.querySelector(":scope > ul");
      if (ul.querySelector(".tn-new")) return;
      const row = document.createElement("li");
      row.className = "tn-new";
      row.innerHTML = `<span class="tn-ico">📁</span><input type="text" placeholder="folder name" maxlength="120">`;
      ul.prepend(row);
      const input = row.querySelector("input");
      input.focus();
      const done = async () => {
        const name = input.value.trim();
        row.remove();
        if (!name || disposed) return;
        try {
          const r = await makeDir(li.dataset.path, name);
          if (!active(entered)) return;
          delete li.dataset.loaded;
          await fpExpand(li, true, entered);
          if (active(entered)) await fpReveal(r.path, entered);
        } catch (err) {
          if (active(entered)) fpFail(err);
        }
      };
      domResources.nodeListener(input, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          done();
        } else if (e.key === "Escape") {
          e.preventDefault();
          row.remove();
        }
      });
      domResources.nodeListener(input, "blur", () => owner.timeout(() => row.isConnected && done(), 120));
    });
    owner.on(fpEls.choose, "click", () => {
      const chosen = fp.selected || fpEls.path.value.trim();
      if (!chosen) return fpFail(new Error("pick a folder first"));
      const onChosen = fp.onChoose;
      closeDialog(dialog);
      if (onChosen) onChosen(chosen);
    });
    owner.on($("[data-folder-close]"), "click", () => closeDialog(dialog));
    owner.on(dialog, "close", () => { if (!dialog.open) ++visit; });
    function dispose() { if (disposed) return; disposed = true; ++visit; owner.dispose(); if (dialog.open) closeDialog(dialog); }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ open, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_FOLDER_PICKER = Object.freeze({ markup, create });
})(typeof window !== "undefined" ? window : globalThis);
