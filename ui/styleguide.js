// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(() => {
  Icons.install();
  const esc = UI.esc;
  const types = document.getElementById("types");
  for (const type of UI.types()) {
    const box = document.createElement("section");
    box.className = "type";
    box.dataset.type = type.name;
    const cols = `120px repeat(${type.states.length}, minmax(80px, max-content))`;
    const cells = [`<div class="head"></div>`, ...type.states.map((s) => `<div class="head">${esc(s)}</div>`)];
    for (const sample of type.samples) {
      cells.push(`<div class="label">${esc(sample.label)}</div>`);
      for (const state of type.states) {
        const node = UI.build(type.name, sample.props);
        if (state !== "rest") node.attrs["data-state"] = state;
        if (state === "disabled" && "disabled" in type.props) node.attrs.disabled = true;
        cells.push(`<div class="cell">${node}</div>`);
      }
    }
    const props = Object.entries(type.props).map(([name, rule]) => `<tr><td><code>${esc(name)}</code></td><td>${esc(rule.type)}${rule.values ? `: ${rule.values.map(esc).join(" | ")}` : ""}</td><td>${rule.required ? "required" : rule.default === undefined ? "optional" : `default <code>${esc(JSON.stringify(rule.default))}</code>`}</td><td class="note">${esc(rule.note || "")}</td></tr>`).join("");
    box.innerHTML = `<h3><code>${esc(type.name)}</code></h3><p class="about">${esc(type.describe)}</p><div class="grid" style="grid-template-columns:${cols}">${cells.join("")}</div><table class="props"><tr><th>prop</th><th>type</th><th></th><th></th></tr>${props}</table>`;
    types.appendChild(box);
  }
  const stats = document.createElement("p");
  stats.className = "stats";
  stats.textContent = `${UI.types().length} type${UI.types().length === 1 ? "" : "s"} · ${UI.types().reduce((n, t) => n + t.samples.length * t.states.length, 0)} cells`;
  types.appendChild(stats);

  const looks = VIBEROOM_TOKENS.looks;
  const palette = document.getElementById("palette");
  const drawPalette = (look) => {
    palette.innerHTML = "";
    for (const [name, hex] of Object.entries(look.palette)) {
      const sw = document.createElement("div");
      sw.className = "sw";
      sw.style.background = hex;
      sw.innerHTML = `<span>${esc(name)}</span>`;
      sw.title = hex;
      palette.appendChild(sw);
    }
  };
  const picker = document.getElementById("looks");
  const pick = (id) => {
    if (id === VIBEROOM_TOKENS.current.id) delete document.documentElement.dataset.look;
    else document.documentElement.dataset.look = id;
    for (const c of picker.querySelectorAll('[data-ui="look-card"]')) { UI.setState(c, c.dataset.look === id ? "on" : null); c.setAttribute("aria-pressed", c.dataset.look === id ? "true" : "false"); }
    drawPalette(looks[id]);
  };
  picker.innerHTML = Object.values(looks).map((l) => UI.html("look-card", { look: l, on: l.id === VIBEROOM_TOKENS.current.id, data: { look: l.id } })).join("");
  picker.addEventListener("click", (e) => { const c = e.target.closest('[data-ui="look-card"]'); if (c) pick(c.dataset.look); });
  drawPalette(VIBEROOM_TOKENS.current);
})();
