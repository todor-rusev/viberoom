// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  function badges(sk, UI) {
    const out = [];
    if (sk.userInvocable === false) out.push(UI.html("badge", { label: "vibemate only" }));
    if (sk.agentInvocable === false) out.push(UI.html("badge", { label: "human only" }));
    if (sk.author && sk.author !== "human") out.push(UI.html("badge", { label: sk.author === "viberoom" ? "built-in" : `by ${sk.author.replace(/^agent:/, "").replace(/@.*$/, "")} (agent)`, tone: "outline" }));
    if (sk.draft) out.push(UI.html("badge", { label: "draft: awaiting your approval", tone: "waiting" }));
    else if (sk.reviewed === false) out.push(UI.html("badge", { label: "unreviewed", tone: "thinking" }));
    if ((sk.problems || []).length) out.push(UI.html("badge", { label: sk.problems.join("; "), tone: "error" }));
    if ((sk.warnings || []).length) out.push(UI.html("badge", { label: `${sk.warnings.length} warning${sk.warnings.length > 1 ? "s" : ""}`, tone: "thinking", title: sk.warnings.join("; ") }));
    return out.join(" ");
  }

  function markup({ skills = [], room = null, holdersOf = () => [], editor: ed = null }, { UI, icon, settingsCard, settingRow, geekTip }) {
    const editing = ed ? skills.find((sk) => sk.name === ed.name) : null;
    const shown = room ? skills.filter((sk) => holdersOf(sk.name).length) : skills;
    const item = (sk) => `<li>
        <div class="sk-main">
          <div class="sk-head"><b>/${esc(sk.name)}</b>${sk.argumentHint ? ` <span class="hint">${esc(sk.argumentHint)}</span>` : ""}${badges(sk, UI)}</div>
          <div class="hint">${esc(sk.description)}</div>
          ${room ? `<div class="hint sk-holders">${icon("user")}${esc(holdersOf(sk.name).map((p) => p.name).join(", "))}</div>` : ""}
        </div>
        <span class="skill-actions">${sk.draft ? UI.html("button", { label: "Approve", kind: "primary", size: "sm", data: { approveSkill: sk.name } }) : ""}${UI.html("icon-button", { icon: "pencil", title: "Edit this skill", kind: "ghost", size: "sm", data: { editSkill: sk.name } })}</span>
      </li>`;
    const list = shown.length
      ? `<ul class="skill-list">${shown.map(item).join("")}</ul>`
      : `<p class="hint">${room ? "No vibemate in this room has a skill attached yet. Attach one in a vibemate's panel (for geeks)." : "No skills yet. Create one, or let a vibemate write one."}</p>`;
    const builtIn = !!editing && editing.author === "viberoom";
    const editor = ed
      ? `<div class="skill-editor">
          ${settingsCard("sk-editor", editing ? `Edit /${ed.name}` : "New skill", [
            settingRow({ label: "Name", for: "sk-name", hint: "It is also the /command.", control: UI.raw(`<input type="text" class="input" id="sk-name" maxlength="32" value="${esc(ed.name || "")}"${ed.name ? " disabled" : ""} placeholder="letters, digits, _ or -">`) }),
            settingRow({ label: "Description", for: "sk-desc", hint: "What it does and when to use it; this is what triggers it.", stacked: true, control: UI.raw(`<textarea class="textarea" id="sk-desc" rows="2" maxlength="300">${esc(ed.description || "")}</textarea>`) }),
            settingRow({ label: "Argument hint", for: "sk-hint", hint: "Optional; the / menu shows it after the name.", control: UI.raw(`<input type="text" class="input" id="sk-hint" maxlength="80" value="${esc(ed.argumentHint || "")}" placeholder="e.g. [PR number]">`) }),
            settingRow({ label: "Instructions", for: "sk-body", hint: UI.raw("<code>$ARGUMENTS</code> is what follows /name."), stacked: true, control: UI.raw(`<textarea class="textarea" id="sk-body" rows="12" maxlength="20000">${esc(ed.body || "")}</textarea>`) }),
            settingRow({ label: "Human can invoke it with /name", for: "sk-user", kind: "switch", checked: ed.userInvocable !== false }),
            settingRow({ label: "Vibemates may load it themselves", for: "sk-agent", kind: "switch", checked: ed.agentInvocable !== false }),
          ].join(""))}
          <p class="error" id="sk-error" hidden></p>
          ${builtIn ? `<p class="field-note">${icon("lock")} Built-in skill: it comes with viberoom, the room keeps it up to date, and it is read-only. Copy the text into a new skill to make your own version.</p>` : ""}
          <div class="row-btns">${editing && !builtIn ? UI.html("button", { label: "Delete", kind: "danger", size: "sm", id: "sk-delete" }) : ""}<span class="saved" id="sk-saved"></span>${UI.html("button", { label: builtIn ? "Close" : "Cancel", kind: "ghost", size: "sm", id: "sk-cancel" })}${builtIn ? "" : UI.html("button", { label: "Save skill", kind: "primary", size: "sm", id: "sk-save" })}</div>
        </div>`
      : "";
    const about = ed
      ? ""
      : `<p class="hint sk-about">${geekTip(`A skill is a folder <code>skills/&lt;name&gt;/SKILL.md</code> in the room's data folder: a description (what triggers it) and the instructions. Attach skills to vibemates in their panels; invoke one with <code>/name</code> in the composer. Vibemates with the room's tools can create skills too (they load <code>skill-writer</code> first).`)}</p>`;
    return `
      <div class="page-head"><div><h1>${room ? `Skills in ${esc(room.name)}` : "Skills"}</h1><div class="hint">${room ? `${shown.length} of ${skills.length} in the library are attached to a vibemate here` : `${skills.length} skill${skills.length === 1 ? "" : "s"} in the library`}</div></div><div class="row-btns">${room ? UI.html("button", { label: "All skills", icon: "skills", kind: "ghost", id: "sk-all" }) : ""}${UI.html("button", { label: "Reload", icon: "refresh", kind: "ghost", id: "sk-reload", title: "Re-read the skills folder" })}${UI.html("button", { label: "New skill", icon: "plus", kind: "primary", size: "cta", id: "sk-new" })}</div></div>
      <div class="${ed ? "page-cols" : ""}"><div>${list}${about}</div>${editor}</div>`;
  }

  function render(page, inputs, ports) {
    const { screen } = inputs, { listen: on, requests, toast, showError, confirm, onAll, setEditor, setSkills } = ports;
    const ed = inputs.editor;
    const skills = inputs.skills || [];
    const editing = ed ? skills.find((sk) => sk.name === ed.name) : null;
    const builtIn = !!editing && editing.author === "viberoom";
    page.innerHTML = markup(inputs, ports);
    const $ = (selector) => page.querySelector(selector);
    const all = $("#sk-all");
    if (all) on(all, "click", () => onAll());
    on($("#sk-new"), "click", () => {
      screen.intent("editor");
      setEditor({ name: "", description: "", argumentHint: "", body: "", userInvocable: true, agentInvocable: true });
      const n = $("#sk-name");
      if (n) n.focus();
    });
    on($("#sk-reload"), "click", async () => {
      const intent = screen.intent("reload");
      try {
        const result = await requests.list({ signal: intent.signal });
        if (!intent.isCurrent()) return;
        setSkills(result.skills || []);
      } catch (e) {
        if (intent.isCurrent()) showError(e);
      }
    });
    page.querySelectorAll("[data-approve-skill]").forEach((btn) => on(btn, "click", () => requests.approve(btn.dataset.approveSkill).catch((error) => { if (screen.isCurrent()) showError(error); })));
    page.querySelectorAll("[data-edit-skill]").forEach((btn) => {
      on(btn, "click", async () => {
        const intent = screen.intent("editor"), name = btn.dataset.editSkill;
        try {
          const result = await requests.get(name, { signal: intent.signal });
          if (!intent.isCurrent()) return;
          setEditor(result.skill);
        } catch (e) {
          if (intent.isCurrent()) showError(e);
        }
      });
    });
    if (!ed) return;
    const skError = (text) => {
      const e = $("#sk-error");
      e.textContent = text;
      e.hidden = !text;
    };
    on($("#sk-cancel"), "click", () => {
      screen.intent("editor");
      setEditor(null);
    });
    const saveBtn = $("#sk-save");
    if (saveBtn) on(saveBtn, "click", async () => {
      const intent = screen.intent("editor");
      try {
        await requests.save({ name: $("#sk-name").value.trim(), description: $("#sk-desc").value, argumentHint: $("#sk-hint").value, body: $("#sk-body").value, userInvocable: $("#sk-user").checked, agentInvocable: $("#sk-agent").checked });
        if (!intent.isCurrent()) return;
        setEditor(null);
        toast("Skill saved.", "info");
      } catch (e) {
        if (intent.isCurrent()) skError(e.message);
      }
    });
    if (builtIn) $(".skill-editor").querySelectorAll("input, textarea").forEach((el) => (el.disabled = true));
    const del = $("#sk-delete");
    if (del) {
      on(del, "click", async () => {
        const intent = screen.intent("editor"), name = ed.name;
        if (!(await confirm("Its folder is removed; vibemates that had it lose it.", { title: `Delete /${ed.name}?`, okLabel: "Delete", danger: true }))) return;
        if (!intent.isCurrent()) return;
        try {
          await requests.remove(name);
          if (!intent.isCurrent()) return;
          setEditor(null);
        } catch (e) {
          if (intent.isCurrent()) skError(e.message);
        }
      });
    }
  }
  root.VIBEROOM_SKILLS_PAGE = Object.freeze({ markup, render, badges });
})(typeof window !== "undefined" ? window : globalThis);
