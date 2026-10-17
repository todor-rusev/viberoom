// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function create(uiRoot, { window: view = uiRoot.ownerDocument.defaultView, signal, tokens: TOKENS, settings = () => ({}),
    loadMermaid, withMermaid, renderMermaid, ownerOf: diagramOwner = () => null, isCurrent = () => true, reportFailure: reportDiagramFailure = () => {},
    onError: showError = () => {}, noteSlow = () => {}, esc, icon: ic }) {
    signal?.throwIfAborted();
    const document = uiRoot.ownerDocument, performance = view.performance, getComputedStyle = node => view.getComputedStyle(node);
    const lifetime = global.VIBEROOM_APP_LIFETIME.create({ window: view }), pending = new WeakMap(), marked = new Map();
    function held(block, request) { return !lifetime.disposed && pending.get(block) === request && (block.dataset.src || "") === request.source
      && block.querySelector(".mm-out") === request.out && (!request.connected || block.isConnected) && (!block.isConnected || uiRoot.contains(block)); }
    function current(block, request) { return held(block, request) && request.owner !== undefined && isCurrent(block, request.owner) && held(block, request); }
    function capture(block) { const request = { source: block.dataset.src || "", out: block.querySelector(".mm-out"), connected: block.isConnected, owner: diagramOwner(block) }; pending.set(block, request); marked.set(block, request); return request; }
    function release(requests) { for (const [block, request] of requests) { if (marked.get(block) === request) marked.delete(block); if (pending.get(block) === request && !current(block, request)) delete block.dataset.rendered; } }
    const DIAGRAM_PRESETS = TOKENS.diagrams.presets;
    function diagramSettings(d) {
      return d || settings() || {};
    }
    function diagramPreset(d) {
      const look = TOKENS.active();
      return TOKENS.diagrams.forScheme(DIAGRAM_PRESETS[d.preset] || DIAGRAM_PRESETS.pop, look.scheme, look.elements.diagram.nodeInk);
    }
    function diagramFontPx() {
      const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--chat-fs")) || 1;
      return Math.round(13 * scale * 10) / 10;
    }
    function diagramStage(id) {
      const stage = document.createElement("div");
      stage.id = `${id}-stage`;
      stage.setAttribute("aria-hidden", "true");
      stage.style.cssText = "position:absolute;left:-10000px;top:0;visibility:hidden;zoom:calc(1 / var(--ui-scale, 1))";
      const style = getComputedStyle(uiRoot);
      stage.style.fontFamily = style.fontFamily;
      stage.style.fontSize = style.fontSize;
      for (let i = 0; i < style.length; i++) {
        const property = style.item(i);
        if (property.startsWith("--")) stage.style.setProperty(property, style.getPropertyValue(property));
      }
      document.body.appendChild(stage);
      return stage;
    }
    function mermaidThemeVariables(d) {
      d = diagramSettings(d);
      const preset = diagramPreset(d);
      const vars = Object.assign({}, preset, { fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font").trim() || "Nunito, sans-serif", fontSize: `${diagramFontPx()}px` });
      delete vars.label;
      delete vars.palette;
      if (preset.palette) preset.palette.forEach((c, i) => (vars[`pie${i + 1}`] = c.fill));
      if (d.primary) {
        vars.primaryColor = d.primary;
        delete vars.primaryBorderColor;
        delete vars.primaryTextColor;
      }
      return vars;
    }
    function diagramPalette(d) {
      d = diagramSettings(d);
      const preset = diagramPreset(d);
      return preset.palette && !d.primary ? preset.palette : null;
    }
    function mermaidCss() { return [
      ".node rect, .node .label-container, .node .basic, .cluster rect, rect.actor { rx: 12px; ry: 12px; }",
      `.node .label-container, .node .basic, .node rect, .node circle, .node ellipse, rect.actor { stroke-width: 1.8px; filter: drop-shadow(0 2px 0 ${TOKENS.active().elements.diagram.nodeShadow}); }`,
      ".edgePath .path, .flowchart-link, .messageLine0, .messageLine1, .transition, .relation { stroke-width: 2px; }",
      ".edgeLabel, .edgeLabel p { font-weight: 700; }",
      ".cluster rect { stroke-dasharray: 4 3; stroke-width: 1.5px; }",
      ".cluster-label, .cluster-label p { font-weight: 800; }",
      "foreignObject > div { display: block !important; width: max-content !important; max-width: 200px !important; white-space: normal !important; overflow-wrap: break-word; }",
    ].join(" "); }
    const DIAGRAM_WEIGHTS = ["400", "700", "800"];
    function diagramFonts(vars, text) {
      if (lifetime.disposed) return Promise.reject(lifetime.signal.reason);
      const loads = DIAGRAM_WEIGHTS.map((w) => document.fonts.load(`${w} ${vars.fontSize} ${vars.fontFamily}`, text || "A").catch(() => []));
      return new Promise((resolve, reject) => {
        let settled = false, timer = 0, release = () => {};
        const finish = (settle, value) => {
          if (settled) return;
          settled = true; lifetime.clearTimeout(timer); release(); settle(value);
        };
        release = lifetime.own(() => finish(reject, lifetime.signal.reason));
        timer = lifetime.timeout(() => finish(resolve), 3000);
        Promise.all(loads).then(value => finish(resolve, value), error => finish(reject, error));
      });
    }
    function paintDiagram(root, palette, ink = TOKENS.active().elements.diagram.nodeInk) {
      const byKey = new Map();
      const pick = (key) => {
        if (!byKey.has(key)) byKey.set(key, palette[byKey.size % palette.length]);
        return byKey.get(key);
      };
      for (const node of root.querySelectorAll("g.node")) {
        const shape = node.querySelector(":scope > .label-container, :scope > .basic, :scope > rect, :scope > polygon, :scope > circle, :scope > ellipse, :scope > path");
        if (!shape) continue;
        const c = pick(node.id || node.getAttribute("data-id") || String(byKey.size));
        shape.style.fill = c.fill;
        shape.style.stroke = c.stroke;
        node.querySelectorAll(".nodeLabel, text").forEach((t) => {
          t.style.color = ink;
          t.style.fill = ink;
        });
      }
      const actors = new Map();
      for (const rect of root.querySelectorAll("rect.actor")) {
        const name = rect.getAttribute("name") || String(actors.size);
        if (!actors.has(name)) actors.set(name, palette[actors.size % palette.length]);
        rect.style.fill = actors.get(name).fill;
        rect.style.stroke = actors.get(name).stroke;
      }
      root.querySelectorAll("text.actor, text.actor tspan").forEach((t) => (t.style.fill = ink));
    }
    async function renderDiagrams(root, d) {
      if (lifetime.disposed) return;
      const blocks = [...root.querySelectorAll(".mermaid-block:not([data-rendered])")];
      if (!blocks.length) return;
      if (root.isConnected && root !== uiRoot && !uiRoot.contains(root)) return;
      const requests = new Map(blocks.map(block => [block, capture(block)]));
      for (const b of blocks) b.dataset.rendered = "1";
      let mermaid;
      try {
        mermaid = await lifetime.wait(loadMermaid());
        if (lifetime.disposed) return;
        return await lifetime.wait(withMermaid(() => drawDiagrams(mermaid, blocks, d, requests)));
      } catch (e) {
        for (const [block, request] of requests) if (pending.get(block) === request) delete block.dataset.rendered;
        if (!lifetime.disposed) showError(e);
        return;
      } finally { release(requests); }
    }
    async function drawDiagrams(mermaid, blocks, d, requests) {
      if (lifetime.disposed) return;
      requests ||= new Map(blocks.map(block => [block, capture(block)]));
      try {
        const palette = diagramPalette(d);
        const themeVariables = mermaidThemeVariables(d);
        await diagramFonts(themeVariables, blocks.map((b) => b.dataset.src || "").join("\n"));
        if (lifetime.disposed) return;
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          securityLevel: "strict",
          themeVariables,
          themeCSS: mermaidCss(),
          htmlLabels: true,
          flowchart: { htmlLabels: true, curve: "basis", padding: 14, nodeSpacing: 44, rankSpacing: 52 },
        });
        for (const block of blocks) {
          if (lifetime.disposed) return;
          const request = requests.get(block);
          if (!current(block, request)) continue;
          const out = request.out;
          const src = request.source;
          const owner = request.owner;
          if (owner && owner.repair && owner.repair.state === "repairing") {
            showDiagramRepairing(block, owner);
            continue;
          }
          try {
            const t0 = performance.now();
            const { svg } = await renderMermaid(mermaid, src);
            if (!current(block, request)) continue;
            out.innerHTML = svg;
            if (palette) paintDiagram(out, palette);
            block.classList.add("ok");
            block.classList.remove("failed", "repairing");
            noteSlow("diagram drawn", performance.now() - t0);
          } catch (e) {
            if (!current(block, request)) continue;
            const error = String((e && e.message) || e);
            if (owner && owner.repairable !== false && !(owner.repair && owner.repair.state === "failed")) void reportDiagramFailure(block, owner, src, error, () => current(block, request));
            else showDiagramError(block, src, error);
          }
        }
      } finally {
        release(requests);
      }
    }
    function showDiagramRepairing(block, message) {
      block.classList.add("repairing");
      block.classList.remove("ok", "failed");
      block.querySelector(".mm-out").innerHTML = `<div class="mm-repairing">${ic("tool")}<span>${esc(message.fromName)} is fixing this diagram…</span></div>`;
    }
    function showDiagramError(block, src, error) {
      const [head, ...rest] = error.replace(/\s+$/, "").split("\n");
      block.classList.add("failed");
      block.classList.remove("ok", "repairing");
      block.querySelector(".mm-out").innerHTML = `<pre>${esc(src)}</pre><div class="hint error">Mermaid: ${esc(head)}</div>${rest.length ? `<pre class="mm-error">${esc(rest.join("\n"))}</pre>` : ""}`;
    }
    function rerenderDiagrams() {
      uiRoot.querySelectorAll(".mermaid-block[data-rendered]:not(.preview)").forEach((b) => {
        pending.delete(b);
        delete b.dataset.rendered;
        b.querySelector(".mm-out").innerHTML = `<pre>${esc(b.dataset.src || "")}</pre>`;
      });
      return renderDiagrams(uiRoot);
    }

    lifetime.own(() => { for (const block of marked.keys()) delete block.dataset.rendered; marked.clear(); });
    function dispose() { lifetime.dispose(); }
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ diagramSettings, diagramPreset, diagramFontPx, diagramStage, mermaidThemeVariables, diagramPalette, mermaidCss, diagramFonts, paintDiagram, renderDiagrams, drawDiagrams, showDiagramRepairing, showDiagramError, rerenderDiagrams, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  Object.defineProperty(create, "textTargets", { value: true });
  global.VIBEROOM_DIAGRAM_RENDERER = Object.freeze({ create });
})(globalThis);
