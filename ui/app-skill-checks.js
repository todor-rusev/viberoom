// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function render(container, selected, skills, { esc, UI }) {
    container.innerHTML = "";
    const chosen = new Set((selected || []).map((s) => s.toLowerCase()));
    const known = new Set();
    for (const s of skills || []) {
      if (s.author === "viberoom") continue;
      known.add(s.name.toLowerCase());
      const row = container.ownerDocument.createElement("label");
      row.className = "check-row";
      const broken = (s.problems && s.problems.length) || s.draft;
      row.innerHTML = `<input type="checkbox" value="${esc(s.name)}" ${chosen.has(s.name.toLowerCase()) ? "checked" : ""} ${broken ? "disabled" : ""}><span><b>/${esc(s.name)}</b> <span class="hint">${esc(s.description)}</span>${s.draft ? UI.html("badge", { label: "draft", tone: "waiting" }) : ""}${s.problems && s.problems.length ? UI.html("badge", { label: s.problems.join("; "), tone: "error" }) : ""}</span>`;
      container.appendChild(row);
    }
    for (const name of selected || []) {
      if (known.has(name.toLowerCase())) continue;
      const row = container.ownerDocument.createElement("label");
      row.className = "check-row";
      row.innerHTML = `<input type="checkbox" value="${esc(name)}" checked><span><b>/${esc(name)}</b> ${UI.html("badge", { label: "missing from the library", tone: "error" })}</span>`;
      container.appendChild(row);
    }
    if (!container.children.length) container.innerHTML = '<span class="hint">No skills in the library yet (Skills in the menu).</span>';
  }
  function read(container) {
    return [...container.querySelectorAll('input[type="checkbox"]:checked')].map((i) => i.value);
  }
  root.VIBEROOM_SKILL_CHECKS = Object.freeze({ render, read });
})(globalThis);
