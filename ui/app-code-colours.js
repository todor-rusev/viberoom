// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  const LANGUAGE_ALIASES = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript", node: "javascript",
    py: "python", rb: "ruby", rs: "rust", golang: "go", sh: "bash", shell: "bash", zsh: "bash", console: "bash",
    ps: "powershell", ps1: "powershell", "c++": "cpp", cxx: "cpp", "c#": "csharp", cs: "csharp", yml: "yaml",
    html: "markup", xml: "markup", svg: "markup", vue: "markup", md: "markdown", dockerfile: "docker", make: "makefile",
  };
  function languageOf(word) {
    const id = String(word || "").toLowerCase();
    if (!id || id === "text" || id === "txt" || id === "plain") return null;
    return LANGUAGE_ALIASES[id] || (/^[a-z0-9-]{1,32}$/.test(id) ? id : null);
  }
  function withGutter(code, language, firstLine, esc) {
    const lines = code.split("\n"), start = firstLine || 1;
    const gutter = lines.map((_, i) => `<span>${start + i}</span>`).join("");
    return `<div class="code-view"><div class="gutter" aria-hidden="true">${gutter}</div><pre class="code-body"><code data-lang="${esc(language || "")}">${esc(code)}</code></pre></div>`;
  }
  function create(scopeRoot, { window: view = scopeRoot.ownerDocument.defaultView, signal, esc,
    loadPrism: prismScript, loadLanguage: languageScript, cacheLimit = 200 }) {
    signal?.throwIfAborted();
    const owner = global.VIBEROOM_APP_LIFETIME.create({ window: view });
    const cached = new Map(), pending = new Map();
    async function loadPrism() { owner.signal.throwIfAborted(); return owner.wait(prismScript()); }
    async function loadLanguage(id) { owner.signal.throwIfAborted(); return owner.wait(languageScript(id)); }
    async function highlight(code, language) {
      owner.signal.throwIfAborted();
      const key = `${language}::${code}`;
      if (cached.has(key)) return cached.get(key);
      const id = await loadLanguage(language);
      owner.signal.throwIfAborted();
      let html;
      try { html = id ? view.Prism.highlight(code, view.Prism.languages[id], id) : esc(code); }
      catch { html = esc(code); }
      if (cached.size >= cacheLimit) cached.delete(cached.keys().next().value);
      cached.set(key, html);
      return html;
    }
    async function blocks(root, canPaint = () => true) {
      if (owner.disposed || (root.isConnected && root !== scopeRoot && !scopeRoot.contains(root))) return;
      for (const block of root.querySelectorAll("pre code[data-lang]:not([data-coloured])")) {
        if (!canPaint() || owner.disposed) return;
        const request = { code: block.textContent, language: block.dataset.lang };
        pending.set(block, request); block.dataset.coloured = "1";
        let painted = false;
        try {
          const html = await highlight(request.code, request.language);
          if (owner.disposed || pending.get(block) !== request) return;
          if (block.textContent !== request.code || block.dataset.lang !== request.language
            || (block.isConnected && !scopeRoot.contains(block))) continue;
          if (!canPaint() || owner.disposed || pending.get(block) !== request) continue;
          block.innerHTML = html; painted = true;
        } catch (error) {
          if (!owner.disposed || error !== owner.signal.reason) throw error;
          return;
        } finally {
          if (pending.get(block) === request) {
            pending.delete(block);
            if (!painted) delete block.dataset.coloured;
          }
        }
      }
    }
    owner.own(() => {
      for (const block of pending.keys()) delete block.dataset.coloured;
      pending.clear(); cached.clear();
    });
    function dispose() { owner.dispose(); }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ loadPrism, loadLanguage, highlight, blocks, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  Object.defineProperty(create, "textTargets", { value: true });
  global.VIBEROOM_CODE_COLOURS = Object.freeze({ create, languageOf, withGutter });
})(globalThis);
