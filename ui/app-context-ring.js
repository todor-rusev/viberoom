// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function lifeOf(p) {
    if (!p.contextSize) return (p.turns || 0) === 0 && !p.contextUsed ? { left: 100, tone: "fresh" } : { left: null, tone: "unknown" };
    const left = Math.max(0, Math.min(100, 100 - Math.round((100 * (p.contextUsed || 0)) / p.contextSize)));
    return { left, tone: left <= 20 ? "hot" : left <= 50 ? "warm" : "ok" };
  }
  function pathFor(r) {
    const s = 2.5, e = 49.5, mid = 26;
    r = Math.max(0, Math.min(23.5, r));
    const n = (v) => String(Math.round(v * 10) / 10);
    if (r < 0.5) return `M${mid} ${s}H${e}V${e}H${s}V${s}H${mid}`;
    const a = (x, y) => `A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y)}`;
    return `M${mid} ${s}H${n(e - r)}${a(e, s + r)}V${n(e - r)}${a(e - r, e)}H${n(s + r)}${a(s, e - r)}V${n(s + r)}${a(s + r, s)}H${mid}`;
  }
  const FACE = 44;
  const faceRadius = (size, corner, scale) => size * corner * scale;
  const GAP = 1.5;
  const RING = `<svg class="life" viewBox="0 0 52 52" aria-hidden="true"><path class="life-track" pathLength="100"/><path class="life-arc" pathLength="100"/></svg>`;
  const EVENT_FRESH_MS = 15 * 60 * 1000;

  function create({ window: view = root, fmtTokens = String, now = () => Date.now() } = {}) {
    const document = view.document;
    function words(p) {
      const { left, tone } = lifeOf(p);
      if (tone === "fresh") return "Fresh session: nothing used yet.";
      if (tone === "unknown") return p.contextUsed ? `${fmtTokens(p.contextUsed)} tokens in use; this agent does not say how big its window is.` : "Not reported by this agent.";
      return `${fmtTokens(p.contextUsed)} of ${fmtTokens(p.contextSize)} used, ${left} % left.`;
    }
    function recentEvent(p) {
      const ev = p.contextEvent;
      return ev && now() - ev.at < EVENT_FRESH_MS ? ev : null;
    }
    function eventText(p, ev) {
      const when = new Date(ev.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (ev.kind === "compacted") return `Compacted its context at ${when} (now ${fmtTokens(ev.used)})`;
      if (ev.kind === "full") return `Ran out of context at ${when}; respawned with memory`;
      return `Over 80 % since ${when}; leaves notes with its replies`;
    }
    let radiusCache = null;
    function radius(av) {
      const key = document.documentElement.dataset.look || "";
      if (radiusCache && radiusCache.key === key) return radiusCache.value;
      const cs = view.getComputedStyle(av.isConnected ? av : document.documentElement);
      const scale = parseFloat(cs.getPropertyValue("--r-scale"));
      const corner = parseFloat(cs.getPropertyValue("--face-corner"));
      const tile = faceRadius(FACE, Number.isFinite(corner) ? corner : 0.32, Number.isFinite(scale) ? scale : 1);
      const value = tile < 0.5 ? 0 : tile + GAP;
      radiusCache = { key, value };
      return value;
    }
    function setPath(ring, av) {
      const d = pathFor(radius(av));
      if (ring.dataset.d === d) return;
      ring.querySelectorAll("path").forEach((path) => path.setAttribute("d", d));
      ring.dataset.d = d;
    }
    function reshape(rings) {
      radiusCache = null;
      for (const ring of rings) setPath(ring, ring.parentElement);
    }
    function patch(li, p) {
      const av = li.querySelector(".avatar");
      if (!av) return;
      let ring = av.querySelector(".life");
      if (!ring) {
        av.insertAdjacentHTML("afterbegin", RING);
        ring = av.querySelector(".life");
        av.classList.add("has-life");
      }
      setPath(ring, av);
      const { left, tone } = lifeOf(p);
      const cls = `life life-${tone}`;
      if (ring.getAttribute("class") !== cls) ring.setAttribute("class", cls);
      ring.querySelector(".life-arc").style.strokeDasharray = left === null ? "0 100" : `${left} 100`;
      const q = av.querySelector(".life-q");
      if (tone === "unknown" && !q) av.insertAdjacentHTML("beforeend", '<span class="life-q" aria-hidden="true">?</span>');
      else if (tone !== "unknown" && q) q.remove();
      const ev = recentEvent(p);
      av.classList.toggle("life-attn", !!ev && ev.kind !== "threshold");
      av.setAttribute("aria-label", (tone === "fresh" ? "Context: fresh, nothing used yet." : tone === "unknown" ? (p.contextUsed ? `Context: ${fmtTokens(p.contextUsed)} tokens in use; this agent does not say how big its window is.` : "Context: not reported by this agent.") : `Context ${fmtTokens(p.contextUsed)} of ${fmtTokens(p.contextSize)} used · ${left} % left.`) + (ev ? ` ${eventText(p, ev)}.` : "") + " Click to go to its last reply.");
    }
    return Object.freeze({ lifeOf, words, recentEvent, eventText, patch, reshape });
  }
  root.VIBEROOM_CONTEXT_RING = Object.freeze({ create, lifeOf, pathFor });
})(globalThis);
