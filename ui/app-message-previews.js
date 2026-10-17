// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  const VIEWABLE_RE = /\.(md|markdown|csv|tsv)$/i;
  const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif|ico|svg)$/i;
  function create(uiRoot, { window: view = uiRoot.ownerDocument.defaultView, signal, UI, esc, currentRoom = () => null, roomRecordKey = room => room?.id || null,
    requests, renderMarkdown, csvTable, codeWithGutter, highlightBlocks, renderDiagrams, viewFile, openLightbox, soundLength, toast, icon: ic, onError: showError }) {
    signal?.throwIfAborted();
    const document = uiRoot.ownerDocument, NodeFilter = view.NodeFilter, window = view, CSS = view.CSS;
    const lifetime = global.VIBEROOM_APP_LIFETIME.create({ window: view });
    const domResources = global.VIBEROOM_APP_DOM_LIFETIME.create({ root: uiRoot, lifetime });
    const net = { request: (path, options) => requests.transport.request(path, { ...options, signal: lifetime.signal }),
      read: (response, kind) => requests.transport.read(response, kind, lifetime.signal), signal: lifetime.signal };
    const get = path => requests.get(path, { signal: lifetime.signal });
    const post = (path, body) => requests.post(path, body, { signal: lifetime.signal });
    const pathReads = new WeakMap(), linkReads = new WeakMap(), cardContexts = new WeakMap(), chips = new WeakSet();
    let generation = 0;
    const recordGenerations = new Map();
    const generationOf = key => `${generation}:${recordGenerations.get(key) || 0}`;
    function capture() { const key = roomRecordKey(currentRoom()); return { key, generation: generationOf(key) }; }
    function valid(context, node) { return !lifetime.disposed && context.generation === generationOf(context.key) && context.key === roomRecordKey(currentRoom())
      && node.isConnected && uiRoot.contains(node); }
  const NOT_VIEWABLE_RE = /\.(exe|dll|so|dylib|bin|zip|gz|tgz|rar|7z|pdf|avi|mkv|wmv|ttf|otf|woff2?|class|jar|pyc|node|msi|iso|db|sqlite3?)$/i;
  const MEDIA_RE = /\.(mp4|m4v|mov|webm|ogv|mp3|m4a|wav|ogg|oga|opus|weba|flac)$/i;
  const VIDEO_RE = /\.(mp4|m4v|mov|webm|ogv)$/i;
  const LINE_RE = /:(\d+)(?:-(\d+))?$/;
  const previewCache = new Map();

  function readableInRoom(target) {
    if (!target || /^(https?:|mailto:)/i.test(target)) return false;
    const spec = splitLine(target);
    const file = spec ? spec.path : target;
    if (NOT_VIEWABLE_RE.test(file) || IMAGE_RE.test(file) || MEDIA_RE.test(file)) return false;
    return /[\\/]/.test(file);
  }
  function imageUrl(path) {
    const room = currentRoom();
    const roomPart = room && room.id ? `&room=${encodeURIComponent(room.id)}` : "";
    return `/api/image?path=${encodeURIComponent(path)}${roomPart}`;
  }
  function mediaUrl(path) {
    const room = currentRoom();
    const roomPart = room && room.id ? `&room=${encodeURIComponent(room.id)}` : "";
    return `/api/media?path=${encodeURIComponent(path)}${roomPart}`;
  }
  function splitLine(target) {
    const m = LINE_RE.exec(target || "");
    if (!m) return null;
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : 0;
    return { path: target.slice(0, m.index), from, to: to && to >= from ? to : 0 };
  }

  const PREVIEW_CONTEXT = 3;
  const PREVIEW_PLAIN_LINES = 40;
  const fileName = (path) => String(path).split(/[\\/]/).pop();

  const PREVIEW_ROWS = 20;
  const isDoc = (spec, data, error) => !error && !spec.from && !!data && (data.kind === "markdown" || data.kind === "csv");
  function docPreview(data, room = currentRoom()) {
    if (data.kind === "csv") {
      const rows = data.rows || [];
      const shown = rows.slice(0, PREVIEW_ROWS + 1);
      const more = Math.max(0, rows.length - shown.length);
      return `<div class="file-view csv doc-preview">${csvTable(shown)}${more ? `<p class="csv-count">${more} more row${more === 1 ? "" : "s"} · "open" shows them all</p>` : ""}</div>`;
    }
    const fences = (data.text.match(/^```/gm) || []).length;
    const text = fences % 2 ? `${data.text}\n\`\`\`` : data.text;
    return `<div class="file-view markdown doc-preview">${renderMarkdown(room, text)}</div>`;
  }
  function docRange(data) {
    if (data.kind === "csv") {
      const rows = Math.max(0, (data.rows || []).length - 1);
      return `${rows} row${rows === 1 ? "" : "s"}`;
    }
    const lines = data.lines || 0;
    return data.to && lines > data.to ? `first ${data.to} of ${lines} lines` : `${lines} line${lines === 1 ? "" : "s"}`;
  }

  function previewCard(key, spec, data, error, context = capture()) {
    const doc = isDoc(spec, data, error);
    const range = doc ? docRange(data) : data && data.from ? (data.to > data.from ? `lines ${data.from}–${data.to}` : `line ${data.from}`) : "";
    const el = UI.el("file-card", {
      name: fileName(spec.path),
      lines: range,
      kind: doc ? "doc" : "code",
      body: error ? undefined : doc ? docPreview(data, currentRoom()) : codeWithGutter(data.text, data.language, data.from || 1),
      error: error || undefined,
      data: { key },
    });
    const body = el.querySelector(".body");
    cardContexts.set(el, context);
    const active = () => valid(context, el);
    if (!error && !doc && spec.from) {
      const marked = body.querySelectorAll(".gutter span")[spec.from - (data.from || 1)];
      if (marked) marked.classList.add("line-mark");
    }
    domResources.nodeListener(el.querySelector('[data-act="open-file"]'), "click", () => { if (active()) viewFile(spec.path, spec.from || 0).catch(error => { if (active()) showError(error); }); });
    if (!error) highlightBlocks(body);
    if (doc && data.kind === "markdown") renderDiagrams(body);
    return el;
  }

  async function fetchPreview(key, spec, from, to) {
    lifetime.signal.throwIfAborted();
    const context = capture();
    key = JSON.stringify([context.key, context.generation, key]);
    if (previewCache.has(key)) return previewCache.get(key);
    const promise = get(`/api/file?path=${encodeURIComponent(spec.path)}&from=${from}&to=${to}`)
      .then((r) => ({ ok: true, data: r }))
      .catch((e) => ({ ok: false, error: e && e.message ? e.message : String(e) }));
    previewCache.set(key, promise);
    return promise;
  }

  const INLINE_TAGS = new Set(["CODE", "EM", "STRONG", "B", "I", "U", "S", "SPAN", "SMALL", "MARK", "SUB", "SUP", "A", "DEL", "INS", "ABBR", "Q"]);
  function placeFragmentCard(textEl, link, card) {
    let anchor = link;
    while (anchor.parentElement && anchor.parentElement !== textEl && INLINE_TAGS.has(anchor.parentElement.tagName)) anchor = anchor.parentElement;
    const table = anchor.closest("table");
    if (table && textEl.contains(table) && table !== textEl) anchor = table;
    if (anchor.parentElement) anchor.after(card);
    else textEl.appendChild(card);
  }

  function imageCard(key, path, context = capture()) {
    const el = UI.el("file-card", { name: fileName(path), kind: "image", openTitle: "Open it big", body: String(UI.h("img", { alt: fileName(path), loading: "lazy", src: imageUrl(path) })), data: { key } });
    const body = el.querySelector(".body");
    cardContexts.set(el, context);
    const active = () => valid(context, el);
    const img = body.querySelector("img");
    domResources.nodeListener(img, "error", async () => {
      if (!active()) return;
      let why = "";
      try {
        const res = await net.request(img.src, { deadlineMs: 10000 });
        const text = await net.read(res, "text");
        try {
          why = JSON.parse(text).error || "";
        } catch {
          why = res.status === 404 ? "this room does not serve pictures yet; restart it with the new build" : `the room answered ${res.status}`;
        }
      } catch {
        why = "the room did not answer";
      }
      if (active()) body.innerHTML = `<div class="note">${esc(fileName(path))} could not be shown here${why ? `: ${esc(why)}` : ""}.</div>`;
    });
    domResources.nodeListener(img, "load", () => {
      if (!active()) return;
      el.querySelector(".lines").textContent = `${img.naturalWidth}×${img.naturalHeight}`;
    });
    const big = () => { if (active()) openLightbox(img.src, fileName(path)); };
    domResources.nodeListener(el.querySelector('[data-act="open-file"]'), "click", big);
    domResources.nodeListener(img, "click", big);
    return el;
  }

  function mediaCard(key, path, context = capture()) {
    const video = VIDEO_RE.test(path);
    const player = video
      ? UI.h("video", { controls: true, preload: "metadata", playsinline: true, src: mediaUrl(path) })
      : UI.h("audio", { controls: true, preload: "metadata", src: mediaUrl(path) });
    const el = UI.el("file-card", { name: fileName(path), kind: "media", openTitle: "Open it with this computer's player", body: String(player), data: { key } });
    const body = el.querySelector(".body");
    cardContexts.set(el, context);
    const active = () => valid(context, el);
    const media = body.querySelector("video, audio");
    domResources.nodeListener(media, "error", async () => {
      if (!active()) return;
      let why = "";
      try {
        const res = await net.request(media.src, { deadlineMs: 10000, headers: { range: "bytes=0-0" } });
        if (res.ok) why = "this player cannot play how it is encoded; open it with this computer's player";
        else {
          const text = await net.read(res, "text");
          try { why = JSON.parse(text).error || ""; } catch { why = res.status === 404 ? "this room does not play files yet; restart it with the new build" : `the room answered ${res.status}`; }
        }
      } catch {
        why = "the room did not answer";
      }
      if (active()) body.innerHTML = `<div class="note">${esc(fileName(path))} could not be played here${why ? `: ${esc(why)}` : ""}.</div>`;
    });
    domResources.nodeListener(media, "loadedmetadata", () => {
      if (!active()) return;
      const length = Number.isFinite(media.duration) ? soundLength(media.duration) : "";
      const size = video && media.videoWidth ? `${media.videoWidth}×${media.videoHeight}` : "";
      el.querySelector(".lines").textContent = [length, size].filter(Boolean).join(" · ");
    });
    domResources.nodeListener(el.querySelector('[data-act="open-file"]'), "click", async () => {
      if (!active()) return;
      try {
        const r = await post("/api/open", { target: path });
        if (active() && r.action !== "open-url") toast(r.message, "info");
      } catch (error) {
        if (active()) showError(error);
      }
    });
    return el;
  }

  function renderPreviews(textEl, m, canPaint = () => true) {
    if (!textEl || m.streaming || lifetime.disposed) return;
    const context = capture();
    if (textEl.isConnected && !uiRoot.contains(textEl)) return;
    for (const card of textEl.querySelectorAll('[data-ui="file-card"]')) { const previous = cardContexts.get(card); if (previous && (previous.key !== context.key || previous.generation !== context.generation)) card.remove(); }
    for (const link of textEl.querySelectorAll(".open-link[data-open]")) { const previous = linkReads.get(link); if (previous && (previous.key !== context.key || previous.generation !== context.generation || previous.target !== link.dataset.open)) { delete link.dataset.previewed; const chip = link.nextElementSibling; if (chip && chips.has(chip)) chip.remove(); } }
    const current = currentRoom();
    if (current?.filesDir && m.resourceRefs?.length) for (const link of textEl.querySelectorAll(".open-link[data-open]")) {
      const original = link.dataset.resourceSource || link.dataset.open;
      const spec = splitLine(original);
      const source = spec?.path || original;
      const ref = m.resourceRefs.find(r => r.source === source);
      if (ref) {
        link.dataset.resourceSource = original;
        link.dataset.open = `${current.filesDir.replace(/[\\/]$/, "")}/${ref.file}${spec ? `:${spec.from}${spec.to ? `-${spec.to}` : ""}` : ""}`;
        link.title = "Open the copy carried with this room";
      }
    }
    return previewLinks(textEl, canPaint);
  }
  function previewLinks(textEl, canPaint) {
    const context = capture();
    for (const link of textEl.querySelectorAll(".open-link[data-open]:not([data-previewed])")) {
      const target = link.dataset.open;
      const active = () => valid(context, textEl) && textEl.contains(link) && link.dataset.open === target && canPaint();
      if (/^(https?:|mailto:)/i.test(target) || NOT_VIEWABLE_RE.test(target)) continue;
      const spec = splitLine(target);
      linkReads.set(link, { ...context, target });
      link.dataset.previewed = "1";
      if (MEDIA_RE.test(target) && /[\\/]/.test(target)) {
        const key = `media|${target}`;
        if (textEl.querySelector(`[data-ui="file-card"][data-key="${cssEscape(key)}"]`)) continue;
        placeFragmentCard(textEl, link, mediaCard(key, target));
      } else if (IMAGE_RE.test(target) && /[\\/]/.test(target)) {
        const key = `img|${target}`;
        if (textEl.querySelector(`[data-ui="file-card"][data-key="${cssEscape(key)}"]`)) continue;
        placeFragmentCard(textEl, link, imageCard(key, target));
      } else if (spec && /[\\/]/.test(spec.path)) {
        const from = Math.max(1, spec.from - PREVIEW_CONTEXT);
        const to = (spec.to || spec.from) + PREVIEW_CONTEXT;
        const key = `${spec.path}|${from}|${to}`;
        if (textEl.querySelector(`[data-ui="file-card"][data-key="${cssEscape(key)}"]`)) continue;
        const place = (result) => {
          if (!active() || textEl.querySelector(`[data-ui="file-card"][data-key="${cssEscape(key)}"]`)) return;
          placeFragmentCard(textEl, link, previewCard(key, spec, result.data, result.ok ? null : result.error));
        };
        fetchPreview(key, spec, from, to).then(place);
      } else if (readableInRoom(target)) {
        const room = currentRoom();
        resolveInRoom(room ? room.id : "", target).then((found) => {
          if (!active() || !found || found.kind !== "file" || !link.isConnected || link.nextElementSibling?.dataset.act === "preview") return;
          const chip = UI.el("icon-button", { icon: "eye", title: `Preview: show the first ${PREVIEW_PLAIN_LINES} lines here`, kind: "inline", size: "xs", act: "preview" });
          chips.add(chip);
          const key = `${target}|1|${PREVIEW_PLAIN_LINES}`;
          const shown = () => textEl.querySelector(`[data-ui="file-card"][data-key="${cssEscape(key)}"]`);
          const label = () => {
            const open = !!shown();
            chip.innerHTML = open ? ic("close") : ic("eye");
            chip.title = open ? "Close the preview" : `Preview: show the first ${PREVIEW_PLAIN_LINES} lines here`;
            chip.setAttribute("aria-label", open ? "Close the preview" : "Preview");
            UI.setState(chip, open ? "on" : null);
          };
          domResources.nodeListener(chip, "click", async () => {
            if (!active()) return;
            const card = shown();
            if (card) {
              card.remove();
              label();
              return;
            }
            chip.disabled = true;
            const result = await fetchPreview(key, { path: target, from: 0, to: 0 }, 1, PREVIEW_PLAIN_LINES);
            if (!active()) return;
            chip.disabled = false;
            if (!shown()) placeFragmentCard(textEl, link, previewCard(key, { path: target, from: 0, to: 0 }, result.data, result.ok ? null : result.error));
            label();
          });
          link.after(chip);
        });
      }
    }
  }
  const cssEscape = (value) => (window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&"));

  const RELATIVE_RE = /(?<![\p{L}\p{N}./\\:~_-])((?:\.{1,2}[\\/])?[\p{L}\p{N}_.-]+(?:[\\/][\p{L}\p{N}_.-]+)+\.[\p{L}\p{N}]{1,10})(:\d+(?:-\d+)?)?(?![\p{L}\p{N}/\\_-])/gu;
  const resolved = new Map();
  function resolveInRoom(roomId, path) {
    lifetime.signal.throwIfAborted();
    const room = currentRoom();
    const record = room?.id === roomId ? roomRecordKey(room) : roomId;
    const key = JSON.stringify([record, generationOf(record), path]);
    if (!resolved.has(key)) {
      resolved.set(
        key,
        get(`/api/resolve?room=${encodeURIComponent(roomId)}&path=${encodeURIComponent(path)}`)
          .then((r) => (r.path ? { path: r.path, kind: r.kind || "file" } : null))
          .catch(() => null),
      );
    }
    return resolved.get(key);
  }
  function textNodesOf(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement && node.parentElement.closest('a, pre, .quote, [data-ui="file-card"], [data-ui="tool-call"], .mermaid-block, .csv-block')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  }
  function linkRelativePaths(textEl, m, canPaint = () => true) {
    const room = currentRoom();
    if (!textEl || m.streaming || !room || !room.dir || lifetime.disposed) return;
    return resolveRelativePaths(textEl, room.id, canPaint);
  }
  async function resolveRelativePaths(textEl, roomId, canPaint) {
    const context = capture();
    if (textEl.isConnected && !uiRoot.contains(textEl)) return;
    pathReads.set(textEl, context);
    const originals = new Map();
    const nodes = textNodesOf(textEl);
    const found = new Map();
    for (const node of nodes) {
      originals.set(node, node.nodeValue);
      for (const match of String(node.nodeValue).matchAll(RELATIVE_RE)) {
        if (NOT_VIEWABLE_RE.test(match[1])) continue;
        const hits = found.get(match[1]) || [];
        hits.push({ node, index: match.index, length: match[0].length, line: match[2] || "" });
        found.set(match[1], hits);
      }
    }
    if (!found.size) return;
    const paths = await Promise.all([...found.keys()].map((token) => resolveInRoom(roomId, token)));
    if (!valid(context, textEl) || pathReads.get(textEl) !== context || !canPaint()) return;
    const resolved = new Map();
    [...found.keys()].forEach((token, i) => {
      const full = paths[i] && paths[i].path;
      if (full) resolved.set(token, full);
    });
    if (!resolved.size) return;
    const byNode = new Map();
    for (const [token, hits] of found) {
      if (!resolved.has(token)) continue;
      for (const hit of hits) byNode.set(hit.node, [...(byNode.get(hit.node) || []), { ...hit, token }]);
    }
    let linked = false;
    for (const [node, hits] of byNode) {
      if (!node.isConnected || !textEl.contains(node) || node.nodeValue !== originals.get(node)) continue;
      for (const hit of hits.sort((a, b) => b.index - a.index)) {
        const full = resolved.get(hit.token);
        const after = node.splitText(hit.index);
        after.nodeValue = after.nodeValue.slice(hit.length);
        const link = document.createElement("a");
        link.className = "open-link";
        link.href = "#";
        link.dataset.open = `${full}${hit.line}`;
        link.title = `${full} (relative to the room's folder)`;
        link.textContent = `${hit.token}${hit.line}`;
        node.parentNode.insertBefore(link, after);
        linked = true;
      }
    }
    if (linked && canPaint()) previewLinks(textEl, canPaint);
  }

    function clear(record) {
      if (record === undefined) { generation++; recordGenerations.clear(); previewCache.clear(); resolved.clear(); }
      else {
        recordGenerations.set(record, (recordGenerations.get(record) || 0) + 1);
        for (const cache of [previewCache, resolved]) for (const key of cache.keys()) if (JSON.parse(key)[0] === record) cache.delete(key);
      }
    }
    lifetime.own(() => {
      clear();
      for (const node of uiRoot.querySelectorAll('[data-ui="file-card"], [data-act="preview"], .open-link[data-previewed]')) {
        if (cardContexts.has(node) || chips.has(node)) node.remove();
        else if (linkReads.has(node)) delete node.dataset.previewed;
      }
    });
    function dispose() { lifetime.dispose(); }
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ readableInRoom, imageUrl, mediaUrl, splitLine, docPreview, docRange, previewCard, fetchPreview, placeFragmentCard, imageCard, mediaCard, renderPreviews, resolveInRoom, textNodesOf, linkRelativePaths, clear, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  Object.defineProperty(create, "textTargets", { value: true });
  global.VIBEROOM_MESSAGE_PREVIEWS = Object.freeze({ create, VIEWABLE_RE, IMAGE_RE });
})(globalThis);
