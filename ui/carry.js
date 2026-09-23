// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function () {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const bytes = n => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.ceil(n / 1024))} KB`;
  const count = (n, one, many = `${one}s`) => `${Number(n).toLocaleString()} ${n === 1 ? one : many}`;
  const names = list => list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  const icon = name => window.Icons?.svg?.(name) ?? "";
  const safeColor = value => /^#[0-9a-f]{3,8}$/i.test(String(value ?? "")) ? value : "var(--primary)";
  const art = (name, cls = "") => `<div class="cx-art scene-art ${cls}" aria-hidden="true">${window.Icons?.scene?.(name) ?? ""}</div>`;
  const button = (action, label, kind = "ghost", extra = "") => `<button type="button" data-ui="button" data-kind="${kind}" data-carry-act="${action}"${extra}>${label}</button>`;
  const PARTS = [
    { key: "conversation", icon: "chat", label: "Conversations", hint: "Every message, and the versions that were replaced" },
    { key: "settings", icon: "user", label: "Rules and vibemates", hint: "Room rules, vibemates, their roles and skills" },
    { key: "resources", icon: "folder", label: "Pictures and files", hint: "What was attached to messages" },
    { key: "memory", icon: "spark", label: "Room memory", hint: "What the vibemates learned in the room" },
    { key: "userMemory", icon: "smile", label: "Your preferences", hint: "What they know about you, in every room" },
  ];
  const SETTING_NAMES = { name: "Room name", topic: "Topic", emoji: "Room picture", customRules: "Room rules", language: "Language", humanDescription: "About you", turnTaking: "Who speaks when", hopLimit: "Reply chain limit", replyDelay: "Reply delay", tools: "Tools", maxSentences: "Answer length", searchOtherRooms: "Searching other rooms", reachableFromMessengers: "Messenger access", startWithHub: "Start with viberoom", reconnectMode: "How vibemates come back", restartMessage: "Message after a restart", wakeAfterRestart: "Wake after a restart" };
  const settingName = key => SETTING_NAMES[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());

  async function open(initialRoom, helpers = {}) {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog wide carry-dialog";
    dialog.innerHTML = `<header class="cx-head"><button type="button" class="cx-back" data-carry-act="home" aria-label="Back" hidden>${icon("back")}</button><h3 class="cx-title">Move rooms between computers</h3>${button("close", "Close")}</header><p class="cx-error" role="alert" hidden></p><div class="cx-body"><div class="cx-step" role="status">${art("carry-in", "is-small")}<p class="cx-lead">Getting your rooms…</p></div></div>`;
    document.body.appendChild(dialog); dialog.showModal();
    const body = dialog.querySelector(".cx-body"), errorBox = dialog.querySelector(".cx-error");
    const controller = new AbortController();
    let closed = false, phase = "home", catalog, estimates = [], estimateJob, job, downloaded = false, exported;
    let exportSelection, exportParts = { conversation: true, settings: true, resources: true, memory: true, userMemory: true }, newLabel;
    let inspected, fileName = "", selected = [], dependencyChoices = {}, preview, importUserMemory = false, userMemoryChoice, planning = null, replanTimer = null;
    let removedRoom = initialRoom?.id || "", removedOffset = 0;
    const openDetails = new Set();
    const $ = query => dialog.querySelector(query);

    function error(value) { errorBox.textContent = value instanceof Error ? value.message : String(value); errorBox.hidden = false; }
    function clearError() { errorBox.hidden = true; errorBox.textContent = ""; }
    async function request(path, payload, raw = false) {
      const response = await fetch(path, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(raw ? 120000 : 30000)]), ...(payload === undefined ? {} : { method: "POST", headers: raw ? { "Content-Type": "application/octet-stream" } : { "Content-Type": "application/json" }, body: raw ? payload : JSON.stringify(payload) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `The transfer request failed (${response.status}).`);
      return result;
    }
    async function cancel(id) { if (id) await fetch(`/api/carry/${encodeURIComponent(id)}/cancel`, { method: "POST", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {}); }
    async function close() {
      if (closed) return;
      if (phase === "applying") { error("The rooms are being brought in. Wait for it to finish before closing."); return; }
      closed = true; controller.abort(); clearTimeout(replanTimer); dialog.remove();
      await Promise.all([cancel(estimateJob), downloaded ? Promise.resolve() : cancel(job)]);
    }
    dialog.addEventListener("cancel", event => { event.preventDefault(); void close(); });
    async function poll(id, onProgress) {
      while (!closed) {
        const state = await request(`/api/carry/${encodeURIComponent(id)}`);
        if (state.status !== "working") return state;
        onProgress?.(state);
        await new Promise(resolve => setTimeout(resolve, 350));
      }
      throw new DOMException("Closed", "AbortError");
    }

    function show(next, title, html) {
      phase = next;
      $(".cx-title").textContent = title;
      $(".cx-back").hidden = next === "home" || next === "applying" || next === "done";
      body.innerHTML = `<div class="cx-step" data-phase="${next}">${html}</div>`;
      body.scrollTop = 0;
    }
    function working(text, scene = "carry-in") {
      show("working", $(".cx-title").textContent, `<div class="cx-working">${art(scene, "is-busy")}<p class="cx-lead" role="status">${esc(text)}</p><div class="cx-bar" aria-hidden="true"></div><p class="cx-hint">You can close this window to stop. Nothing has changed yet.</p></div>`);
    }

    function renderHome() {
      clearError();
      show("home", "Move rooms between computers", `<div class="cx-doors">
        <button type="button" class="cx-door" data-carry-act="export">${art("carry-out")}<strong>Take rooms with you</strong><span>Save rooms in one file to open on another computer.</span></button>
        <button type="button" class="cx-door" data-carry-act="import">${art("carry-in")}<strong>Bring rooms in</strong><span>Open a file from another computer. You see everything before anything changes.</span></button>
      </div><p class="cx-foot"><button type="button" class="cx-link" data-carry-act="removed">${icon("clock")} Earlier versions of messages</button></p>`);
    }

    function estimateOf(id) { return estimates.find(e => e.id === id); }
    function partSize(key) {
      if (key === "userMemory") return catalog.userMemoryBytes;
      if (key === "memory") return catalog.rooms.filter(r => exportSelection.has(r.id)).reduce((n, r) => n + (r.memoryBytes || 0), 0);
      return estimates.filter(r => exportSelection.has(r.id)).reduce((sum, r) => sum + (key === "conversation" ? r.conversationBytes : key === "settings" ? r.settingsBytes : r.resourceBytes), 0);
    }
    function keepExportInputs() {
      if (phase !== "export") return;
      exportSelection = new Set([...dialog.querySelectorAll("[data-export-room]:checked")].map(el => el.value));
      for (const part of PARTS) exportParts[part.key] = $(`[data-export-part="${part.key}"]`).checked;
      newLabel = $("[data-copy-label]").value;
    }
    function updateExportTotals() {
      for (const part of PARTS) { const el = $(`[data-part-size="${part.key}"]`); if (el) el.textContent = estimates.length || part.key === "memory" || part.key === "userMemory" ? bytes(partSize(part.key)) : "…"; }
      const total = PARTS.filter(p => exportParts[p.key]).reduce((n, p) => n + partSize(p.key), 0);
      const summary = $("[data-export-total]"); if (summary) summary.textContent = exportSelection.size ? `${count(exportSelection.size, "room")} · about ${bytes(total)} before packing` : "Choose at least one room";
      const go = $('[data-carry-act="prepare-export"]'); if (go) go.disabled = !exportSelection.size && !exportParts.userMemory;
    }
    function renderExport() {
      clearError();
      const label = newLabel ?? (catalog.source.label || catalog.source.suggested);
      show("export", "Take rooms with you", `<form class="cx-form" data-export-form>
        <section class="cx-section"><div class="cx-section-head"><h4>Which rooms?</h4><span class="cx-mini">${button("rooms-all", "All")}${button("rooms-none", "None")}</span></div>
          <div class="cx-tiles cx-room-tiles">${catalog.rooms.map(r => { const e = estimateOf(r.id); return `<label class="choice cx-tile cx-room-tile"><input type="checkbox" data-export-room value="${esc(r.id)}"${exportSelection.has(r.id) ? " checked" : ""}><span class="cx-emoji">${esc(r.emoji || "💬")}</span><span class="cx-tile-text"><strong>${esc(r.name)}</strong><small>${e ? `${count(e.messages ?? 0, "message")} · ${bytes(e.conversationBytes + e.settingsBytes + e.resourceBytes)}` : "measuring…"}</small></span><span class="cx-tick">${icon("check")}</span></label>`; }).join("") || '<p class="cx-hint">There are no rooms here yet.</p>'}</div></section>
        <section class="cx-section"><h4>What goes in</h4>
          <div class="cx-chips">${PARTS.map(p => `<label class="choice cx-chip" title="${esc(p.hint)}"><input type="checkbox" data-export-part="${p.key}"${exportParts[p.key] ? " checked" : ""}><span class="cx-chip-icon">${icon(p.icon)}</span><span>${esc(p.label)}</span><small data-part-size="${p.key}"></small></label>`).join("")}</div>
          <p class="cx-hint">${icon("lock")} Sign-ins and running sessions never leave this computer.</p></section>
        <section class="cx-section cx-lock"><label class="switch cx-switch"><input type="checkbox" data-encrypt><span class="cx-switch-ui" aria-hidden="true"></span><span><strong>Lock the file with a password</strong><small>Anyone with the file needs the password to open it.</small></span></label>
          <div class="cx-pass" data-pass-fields hidden><label class="cx-field">Password<input type="password" data-passphrase autocomplete="new-password" maxlength="4096"></label><label class="cx-field">The same password again<input type="password" data-passphrase-repeat autocomplete="new-password" maxlength="4096"></label><p class="cx-hint">Keep it somewhere safe: there is no way to recover it. Room names are locked too.</p></div></section>
        <details class="cx-more"><summary>This computer is called <b data-label-view>${esc(label)}</b></summary><label class="cx-field">Name<input data-copy-label maxlength="100" required value="${esc(label)}"></label><p class="cx-hint">The other computer shows this name, so you always know where something came from.</p></details>
        <footer class="cx-actions"><span class="cx-total" data-export-total></span>${button("prepare-export", "Create the file", "primary")}</footer>
      </form>`);
      updateExportTotals();
      $("[data-encrypt]").addEventListener("change", event => { $("[data-pass-fields]").hidden = !event.target.checked; if (event.target.checked) $("[data-passphrase]").focus(); });
      $("[data-copy-label]").addEventListener("input", event => { $("[data-label-view]").textContent = event.target.value; });
      for (const el of dialog.querySelectorAll("[data-export-room], [data-export-part]")) el.addEventListener("change", () => { keepExportInputs(); updateExportTotals(); });
      $("[data-export-form]").addEventListener("submit", event => { event.preventDefault(); void act("prepare-export"); });
    }
    function renderExported(result) {
      exported = result;
      const locked = !!result.encrypted;
      show("export-ready", "Take rooms with you", `<div class="cx-center">${art("carry-out", "is-done")}
        <p class="cx-lead">Your file is ready</p>
        <div class="cx-file"><span class="cx-file-icon">${icon(locked ? "lock" : "transfer")}</span><span><strong>${esc(result.fileName || "viberoom.viberoom")}</strong><small>${bytes(result.bytes)}${locked ? " · locked with a password" : ""}</small></span></div>
        ${(result.warnings || []).map(w => `<details class="cx-note is-warn"><summary>${icon("alert")} ${esc(w.room)}: ${count(w.missing.length + w.missingSkills.length, "item was", "items were")} already missing here</summary><p class="cx-hint">They could not go in. The messages still mention them.</p><ul>${[...w.missing, ...w.missingSkills].map(name => `<li>${esc(name)}</li>`).join("")}</ul></details>`).join("")}
        <footer class="cx-actions is-center">${button("download", `${icon("save")} Save the file`, "primary")}</footer>
        <p class="cx-hint">On the other computer: Export / Import → <b>Bring rooms in</b>.${locked ? " You will need the password there." : ""}</p></div>`);
    }

    function renderDrop() {
      clearError();
      show("import", "Bring rooms in", `<div class="cx-drop" data-drop tabindex="0" role="button" aria-label="Choose a viberoom file">${art("carry-in", "is-float")}
        <strong>Drop the file here</strong><span>or <button type="button" class="cx-link" data-carry-act="choose-file">choose it on this computer</button></span>
        <input type="file" data-import-file accept=".viberoom,.jsonl,.json,application/octet-stream" hidden>
        <small>Files from viberoom end in .viberoom. Older conversation files (.jsonl) open too.</small></div>`);
      const drop = $("[data-drop]"), input = $("[data-import-file]");
      input.addEventListener("change", () => { const file = input.files?.[0]; if (file) void upload(file).catch(failed); });
      drop.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.click(); } });
      drop.addEventListener("dragover", event => { event.preventDefault(); drop.classList.add("is-over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
      drop.addEventListener("drop", event => { event.preventDefault(); drop.classList.remove("is-over"); const file = event.dataTransfer?.files?.[0]; if (file) void upload(file).catch(failed); });
    }
    function renderPassword(message) {
      show("password", "Bring rooms in", `<form class="cx-center" data-unlock>${art("key-mini")}<p class="cx-lead">${esc(fileName)} is locked</p><label class="cx-field is-narrow">Password<input type="password" data-import-pass autocomplete="off" maxlength="4096" required></label><footer class="cx-actions is-center">${button("unlock", "Open the file", "primary")}</footer></form>`);
      if (message) error(message); else clearError();
      $("[data-import-pass]").focus(); $("[data-unlock]").addEventListener("submit", event => { event.preventDefault(); void act("unlock"); });
    }
    async function upload(file) {
      if (file.size > 1024 ** 3) throw new Error("This file is larger than 1 GB.");
      if (job) { await cancel(job); job = null; }
      fileName = file.name; working(`Opening ${file.name} (${bytes(file.size)})…`);
      const started = await request("/api/carry/upload", file, true); job = started.id;
      await inspectedState(await poll(job));
    }
    async function inspectedState(state) {
      if (state.status === "password") { renderPassword(); return; }
      if (state.status === "error") throw new Error(state.error);
      inspected = state.result;
      selected = inspected.rooms.map(r => {
        const identities = new Set([r.uuid, ...r.aliases]);
        const match = catalog.rooms.find(local => [local.uuid, ...local.aliases].some(id => identities.has(id)));
        return { uuid: r.uuid, selected: true, matched: !!match, target: match?.id || null, name: r.name, conversation: r.parts.includes("conversation"), settings: r.parts.includes("settings"), resources: r.parts.includes("resources"), memory: r.parts.includes("memory"), branch: "both", setup: "ours", resourcesChoice: "incoming" };
      });
      importUserMemory = !!inspected.userMemory; userMemoryChoice = undefined; dependencyChoices = {};
      if (!catalog.source.label) catalog.source = { ...catalog.source, ...await request("/api/carry/source", { label: catalog.source.suggested || "This computer" }) };
      working("Comparing with what is here…");
      await plan();
    }

    function choicesPayload() {
      return selected.filter(c => c.selected).map(({ selected: _s, matched: _m, ...choice }) => choice);
    }
    async function plan() {
      const payload = { rooms: choicesPayload(), dependencies: dependencyChoices, userMemory: importUserMemory, ...(userMemoryChoice ? { userMemoryChoice } : {}) };
      if (!payload.rooms.length && !importUserMemory) { preview = { rooms: [], dependencies: [], ready: false }; renderSummary(); return; }
      const mine = planning = Symbol("plan");
      await request(`/api/carry/${job}/plan`, payload);
      const state = await poll(job);
      if (planning !== mine || closed) return;
      planning = null;
      if (state.status === "error") { renderSummary(); throw new Error(state.error); }
      preview = state.result;
      const undecided = preview.dependencies.filter(d => d.differs && !d.choice && !dependencyChoices[d.key]);
      if (undecided.length) { for (const d of undecided) dependencyChoices[d.key] = "ours"; return plan(); }
      renderSummary();
    }
    function replan() {
      clearTimeout(replanTimer);
      dialog.querySelector(".cx-summary")?.classList.add("is-updating");
      const go = $('[data-carry-act="apply"]'); if (go) go.disabled = true;
      replanTimer = setTimeout(() => { void plan().catch(failed); }, 250);
    }
    function sourceName() { return inspected?.source?.label || "the other computer"; }

    function story(r, choice) {
      const b = r.branch, here = b ? b.localContinuation + b.changed : 0, there = b ? b.incomingContinuation + b.changed : r.counts.added + r.counts.replaced;
      const dots = n => Math.min(6, Math.max(n ? 1 : 0, Math.round(Math.log2(n + 1) * 1.6)));
      const lane = (y, n, cls) => Array.from({ length: dots(n) }, (_, i) => `<circle class="cx-dot ${cls}" style="--i:${i}" cx="${34 + i * 13}" cy="${y}" r="3.4"/>`).join("");
      const keepHere = !b || choice !== "incoming", keepThere = !b || choice !== "ours";
      const svg = `<svg class="cx-story-art" viewBox="0 0 220 64" aria-hidden="true">
        <path class="cx-lane is-here${keepHere ? "" : " is-dropped"}${b ? "" : " is-quiet"}" d="M8 32 C18 32 18 14 30 14 H118 C142 14 146 32 170 32"/>
        <path class="cx-lane is-there${keepThere ? "" : " is-dropped"}" d="M8 32 C18 32 18 50 30 50 H118 C142 50 146 32 170 32"/>
        <path class="cx-lane is-merged" d="M170 32 H210"/><circle class="cx-node" cx="8" cy="32" r="4"/><circle class="cx-node is-end" cx="212" cy="32" r="5"/>
        ${b ? lane(14, here, `is-here${keepHere ? "" : " is-dropped"}`) : ""}${lane(50, there, `is-there${keepThere ? "" : " is-dropped"}`)}</svg>`;
      const words = !r.counts.added && !r.counts.replaced && !b ? "Nothing new in the conversation."
        : !b ? `${count(r.counts.added, "new message")} arrive${r.counts.replaced ? `, ${count(r.counts.replaced, "message")} updated` : ""}.`
        : choice === "ours" ? `Both computers went on. You keep <b>this computer's</b> ${count(here, "message")}; the other ${count(there, "message")} are set aside under Earlier versions.`
        : choice === "incoming" ? `Both computers went on. You take <b>${esc(sourceName())}'s</b> ${count(there, "message")}; this computer's ${count(here, "message")} are set aside under Earlier versions.`
        : `Both computers went on: <b>${count(here, "new message")}</b> here and <b>${count(there, "new message")}</b> on ${esc(sourceName())}. <b>Everything is kept</b>, in the order it was written.`;
      const legend = `<div class="cx-legend">${b ? `<span class="is-here">This computer</span>` : ""}<span class="is-there">${esc(sourceName())}</span></div>`;
      const options = b ? `<details class="cx-more" data-key="branch-${esc(r.uuid)}"><summary>Other ways to combine</summary><div class="cx-tiles is-stack">${[
        ["both", "Keep everything", "Recommended. Nothing is lost; each computer's messages keep their order."],
        ["ours", "Keep only this computer's", `${esc(sourceName())}'s new messages go to Earlier versions.`],
        ["incoming", `Take only ${esc(sourceName())}'s`, "This computer's new messages go to Earlier versions."],
      ].map(([value, title, text]) => `<label class="choice cx-tile cx-choice"><input type="radio" name="branch-${esc(r.uuid)}" data-branch value="${value}"${(choice || "both") === value ? " checked" : ""}><span><strong>${title}</strong><small>${text}</small></span></label>`).join("")}</div></details>` : "";
      return `<div class="cx-story">${svg}${legend}<p>${words}</p>${options}</div>`;
    }

    function setupDifference(r, choice) {
      const people = r.settingsDiff.find(d => d.field === "participants");
      const others = r.settingsDiff.filter(d => d.field !== "participants");
      const ours = new Map((people?.ours || []).map(p => [p.id, p])), theirs = new Map((people?.incoming || []).map(p => [p.id, p]));
      const badge = (text, kind = "") => `<span class="cx-badge ${kind}">${esc(text)}</span>`;
      const avatar = p => `<span class="cx-avatar" style="--c:${safeColor(p.color)}">${esc(p.avatar || (p.name || "?").slice(0, 1).toUpperCase())}</span>`;
      const changes = (a, b) => {
        const out = [];
        if ((a.role || "") !== (b.role || "")) out.push("role");
        if ((a.tagline || "") !== (b.tagline || "")) out.push("tagline");
        for (const k of ["model", "effort", "mode"]) if ((a.launch?.[k] || "") !== (b.launch?.[k] || "")) out.push(`${k}: ${b.launch?.[k] || "default"}`);
        if (JSON.stringify(a.skills || []) !== JSON.stringify(b.skills || [])) out.push("skills");
        if (!!a.muted !== !!b.muted) out.push(b.muted ? "muted there" : "unmuted there");
        if ((a.avatar || "") !== (b.avatar || "") || (a.name || "") !== (b.name || "")) out.push("name or picture");
        return out;
      };
      const vibemates = people ? [...new Set([...ours.keys(), ...theirs.keys()])].map(id => {
        const a = ours.get(id), b = theirs.get(id);
        const tags = !a ? [badge(`only on ${sourceName()}`, "is-new")] : !b ? [badge("only here", "is-gone")] : changes(a, b).map(t => badge(t));
        return tags.length ? `<li>${avatar(b || a)}<span class="cx-person"><strong>${esc((b || a).name)}</strong><span class="cx-badges">${tags.join("")}</span></span></li>` : "";
      }).join("") : "";
      const rows = others.map(d => d.field === "customRules"
        ? `<li><span class="cx-key">${icon("pencil")} Room rules</span><details class="cx-more" data-key="rules-${esc(r.uuid)}"><summary>Compare them</summary><div class="cx-compare"><div><b>Here</b><p>${esc(d.ours || "(none)")}</p></div><div><b>${esc(sourceName())}</b><p>${esc(d.incoming || "(none)")}</p></div></div></details></li>`
        : `<li><span class="cx-key">${esc(settingName(d.field))}</span><span class="cx-from">${esc(typeof d.ours === "object" ? "changed" : String(d.ours ?? "—"))}</span> ${icon("forward")} <span class="cx-to">${esc(typeof d.incoming === "object" ? "changed" : String(d.incoming ?? "—"))}</span></li>`).join("");
      const live = r.live || [];
      return `<section class="cx-decision" data-decision="setup"><h5>${icon("user")} The room's rules and vibemates differ</h5>
        <div class="cx-tiles is-pair">
          <label class="choice cx-tile cx-choice"><input type="radio" name="setup-${esc(r.uuid)}" data-setup value="ours"${choice !== "incoming" ? " checked" : ""}><span><strong>Keep this computer's</strong><small>Recommended. Nothing changes for your vibemates.</small></span></label>
          <label class="choice cx-tile cx-choice"><input type="radio" name="setup-${esc(r.uuid)}" data-setup value="incoming"${choice === "incoming" ? " checked" : ""}><span><strong>Use ${esc(sourceName())}'s</strong><small>Rules, roles and models come from the file.</small></span></label>
        </div>
        ${vibemates ? `<ul class="cx-people">${vibemates}</ul>` : ""}${rows ? `<ul class="cx-rows">${rows}</ul>` : ""}
        ${choice === "incoming" && live.length ? `<p class="cx-note">${icon("refresh")} ${esc(names(live))} ${live.length === 1 ? "restarts" : "restart"} for a moment and ${live.length === 1 ? "keeps their conversation" : "keep their conversations"}.</p>` : ""}</section>`;
    }

    function memoryDecision(memory, key, title, attribute, made = false) {
      const same = JSON.stringify(memory.ours) === JSON.stringify(memory.incoming);
      if (made || same) return !same && memory.incoming.notes.length ? `<ul class="cx-facts"><li>${icon("spark")} ${esc(title)}: ${count(memory.incoming.notes.length, "note")} come along</li></ul>` : "";
      const notes = list => list.notes.map(n => `<li>${esc(n.text)}${n.locked ? ` <span class="cx-badge">kept</span>` : ""}</li>`).join("") || '<li class="cx-empty">No notes</li>';
      const compare = `<div class="cx-compare is-notes"><div><b>Here</b><ul>${notes(memory.ours)}</ul></div><div><b>${esc(sourceName())}</b><ul>${notes(memory.incoming)}</ul></div></div>`;
      const tiles = [
        ...(memory.combinable ? [["both", "Combine both", "Recommended. Notes from both computers, without repeats."]] : []),
        ["ours", "Keep this computer's", `${esc(sourceName())}'s notes stay out.`],
        ["incoming", `Use ${esc(sourceName())}'s`, "The notes here are replaced; they stay in the memory history."],
      ].map(([value, t, text]) => `<label class="choice cx-tile cx-choice"><input type="radio" name="${key}" ${attribute} value="${value}"${memory.choice === value ? " checked" : ""}><span><strong>${t}</strong><small>${text}</small></span></label>`).join("");
      const chosen = { both: "notes from both computers are combined", ours: "this computer's notes stay", incoming: `${esc(sourceName())}'s notes replace these` }[memory.choice];
      if (chosen) return `<details class="cx-fact-more" data-key="${key}"><summary>${icon("spark")} ${esc(title)}: ${chosen}</summary><div class="cx-tiles is-stack">${tiles}</div>${compare}</details>`;
      return `<section class="cx-decision" data-decision="${key}"><h5>${icon("spark")} ${esc(title)} differs${memory.combinable ? "" : " and does not fit together"}</h5><div class="cx-tiles is-stack">${tiles}</div>${compare}</section>`;
    }

    function roomCard(r) {
      const choice = selected.find(c => c.uuid === r.uuid), carried = inspected.rooms.find(x => x.uuid === r.uuid);
      const target = catalog.rooms.find(c => c.id === r.targetId);
      const emoji = target?.emoji || carried?.settings?.emoji || "💬";
      const dest = r.made ? `Arrives as a new room <b>${esc(r.name)}</b>` : `Joins your room <b>${esc(target?.name || r.name)}</b>`;
      const facts = [];
      if (r.resources.write || r.resources.already) facts.push(`${icon("folder")} ${r.resources.write ? `${count(r.resources.write, "picture or file", "pictures and files")} arrive (${bytes(r.resources.bytes)})` : "All pictures and files are here already"}`);
      if (r.resources.conflicts?.length) facts.push(`${icon("copy")} ${count(r.resources.conflicts.length, "file")} with the same name but different content: both versions are kept`);
      if (r.resources.missing.length) facts.push(`${icon("alert")} ${count(r.resources.missing.length, "file")} the messages mention are on neither computer`);
      if (r.made && r.newSetup?.participants.length) facts.push(`${icon("user")} ${count(r.newSetup.participants.length, "vibemate")} come along; they start when you call them`);
      if (!r.made && r.setup === "ours" && !r.settingsDiffer) facts.push(`${icon("check")} Rules and vibemates are the same on both computers`);
      const moreOptions = `<details class="cx-more" data-key="options-${esc(r.uuid)}"><summary>Options for this room</summary>
        ${choice.matched ? "" : `<label class="cx-field">Where it goes<select data-target><option value="">A new room</option>${catalog.rooms.map(local => `<option value="${esc(local.id)}"${local.id === choice.target ? " selected" : ""}>Join ${esc(local.name)}</option>`).join("")}</select></label><label class="cx-field" data-name-field${choice.target ? " hidden" : ""}>Name of the new room<input data-new-name maxlength="60" value="${esc(choice.name)}"></label>`}
        <div class="cx-chips is-small">${PARTS.filter(p => p.key !== "userMemory").map(p => `<label class="choice cx-chip"><input type="checkbox" data-import-part="${p.key}"${choice[p.key] ? " checked" : ""}${carried?.parts.includes(p.key) ? "" : " disabled"}><span class="cx-chip-icon">${icon(p.icon)}</span><span>${esc(p.label)}</span></label>`).join("")}</div></details>`;
      const details = `<details class="cx-details" data-key="details-${esc(r.uuid)}"><summary>Details</summary><dl class="cx-counts">${[["new", r.counts.added], ["updated", r.counts.replaced], ["set aside", r.counts.removed], ["unchanged", r.counts.same]].map(([k, v]) => `<div><dt>${Number(v).toLocaleString()}</dt><dd>${k}</dd></div>`).join("")}</dl>
        ${r.branch ? `<div class="cx-actions">${`<a data-ui="button" data-kind="ghost" download href="/api/carry/${job}/review?room=${encodeURIComponent(r.uuid)}">Save the full comparison</a><a data-ui="button" data-kind="ghost" download href="/api/carry/${job}/review?room=${encodeURIComponent(r.uuid)}&format=records">Full records, with tools</a>`}</div>${r.branch.examples.map(x => `<details class="cx-more"><summary>A message edited on both computers</summary><div class="cx-compare"><div><b>Here</b><p>${esc(x.ours)}</p></div><div><b>${esc(sourceName())}</b><p>${esc(x.incoming)}</p></div></div></details>`).join("")}` : ""}
        ${r.resources.missing.length ? `<p class="cx-hint">Missing: ${r.resources.missing.map(esc).join(", ")}</p>` : ""}
        ${r.workspaceHint ? `<p class="cx-hint">On ${esc(sourceName())} the vibemates worked in ${esc(r.workspaceHint)}. Here the room keeps its own folder.</p>` : ""}</details>`;
      return `<article class="cx-room-card" data-review-room="${esc(r.uuid)}">
        <header class="cx-room-head"><span class="cx-emoji is-big">${esc(emoji)}</span><div><h4>${esc(r.name)}</h4><p>${dest}</p></div>${inspected.rooms.length > 1 ? `<label class="check-row cx-include"><input type="checkbox" data-selected checked> Bring in</label>` : ""}</header>
        ${choice.conversation ? story(r, r.branch ? choice.branch : null) : ""}
        ${facts.length ? `<ul class="cx-facts">${facts.map(f => `<li>${f}</li>`).join("")}</ul>` : ""}
        ${r.memory ? memoryDecision(r.memory, `memory-${r.uuid}`, "Room memory", "data-room-memory", r.made) : ""}
        ${r.settingsDiffer ? setupDifference(r, choice.setup) : ""}
        ${moreOptions}${details}</article>`;
    }

    function renderSummary(refreshed = false) {
      for (const d of dialog.querySelectorAll("details[data-key]")) { if (d.open) openDetails.add(d.dataset.key); else openDetails.delete(d.dataset.key); }
      const scroll = body.scrollTop;
      const skipped = inspected.rooms.filter(r => !selected.find(c => c.uuid === r.uuid)?.selected);
      const deps = preview.dependencies.filter(d => d.differs || d.files.length);
      show("summary", "Bring rooms in", `<div class="cx-summary">
        <p class="cx-source">${icon("transfer")} From <b>${esc(sourceName())}</b>${inspected.encrypted ? ` · ${icon("lock")} opened with its password` : ""}</p>
        ${refreshed ? `<p class="cx-note is-info">${icon("info")} Something changed here while you were looking. This is the updated summary; check it and bring it in again.</p>` : ""}
        ${preview.rooms.map(roomCard).join("")}
        ${skipped.map(r => `<article class="cx-room-card is-skipped" data-skipped-room="${esc(r.uuid)}"><header class="cx-room-head"><span class="cx-emoji is-big">💬</span><div><h4>${esc(r.name)}</h4><p>Not brought in this time</p></div><label class="check-row cx-include"><input type="checkbox" data-selected> Bring in</label></header></article>`).join("")}
        ${preview.userMemory ? `<article class="cx-room-card"><header class="cx-room-head"><span class="cx-emoji is-big">${icon("smile")}</span><div><h4>Your preferences</h4><p>What the vibemates know about you, in every room</p></div><label class="check-row cx-include"><input type="checkbox" data-user-memory-on${importUserMemory ? " checked" : ""}> Bring in</label></header>${memoryDecision(preview.userMemory, "user-memory", "Your preferences", "data-user-memory") || `<ul class="cx-facts"><li>${icon("check")} The same on both computers</li></ul>`}</article>`
          : inspected.userMemory ? `<article class="cx-room-card is-skipped"><header class="cx-room-head"><span class="cx-emoji is-big">${icon("smile")}</span><div><h4>Your preferences</h4><p>Not brought in this time</p></div><label class="check-row cx-include"><input type="checkbox" data-user-memory-on> Bring in</label></header></article>` : ""}
        ${deps.map(d => `<section class="cx-decision" data-dependency-card="${esc(d.key)}"><h5>${icon(d.kind === "look" ? "eye" : "skills")} ${d.differs ? `The ${esc(d.kind)} “${esc(d.id)}” is different on the two computers` : `The ${esc(d.kind)} “${esc(d.id)}” comes along`}</h5>
          ${d.differs ? `<div class="cx-tiles is-pair"><label class="choice cx-tile cx-choice"><input type="radio" name="dep-${esc(d.key)}" data-dependency="${esc(d.key)}" value="ours"${dependencyChoices[d.key] !== "incoming" ? " checked" : ""}><span><strong>Keep this computer's</strong><small>Recommended.</small></span></label><label class="choice cx-tile cx-choice"><input type="radio" name="dep-${esc(d.key)}" data-dependency="${esc(d.key)}" value="incoming"${dependencyChoices[d.key] === "incoming" ? " checked" : ""}><span><strong>Use ${esc(sourceName())}'s</strong><small>Every room that uses it gets this one.</small></span></label></div>` : `<p class="cx-hint">It is new here: ${count(d.files.length, "file")} join the shared library.</p>`}
          <details class="cx-more" data-library-key="${esc(d.key)}" data-key="lib-${esc(d.key)}"><summary>See what changes</summary><ul class="cx-files">${d.files.map(f => `<li><span class="cx-badge ${f.action === "add" ? "is-new" : f.action === "remove" ? "is-gone" : ""}">${esc(f.action === "add" ? "new" : f.action === "remove" ? "goes away" : "changes")}</span><button type="button" class="cx-link" data-carry-act="dependency-view" data-path="${esc(f.path)}">${esc(f.path)}</button></li>`).join("")}</ul><div data-library-comparison></div></details></section>`).join("")}
        <footer class="cx-actions is-sticky"><span class="cx-total">${preview.ready ? `${icon("check")} Ready` : planning ? "Updating…" : `${icon("info")} Choose one of the options above`}</span>${button("apply", "Bring it in", "primary", preview.ready ? "" : " disabled")}</footer></div>`);
      for (const d of dialog.querySelectorAll("details[data-key]")) if (openDetails.has(d.dataset.key)) d.open = true;
      body.scrollTop = scroll;
      wireSummary();
    }

    function wireSummary() {
      const onChange = (selector, update) => { for (const el of dialog.querySelectorAll(selector)) el.addEventListener("change", () => { update(el); replan(); }); };
      const choiceOf = el => { const card = el.closest("[data-review-room], [data-skipped-room]"); const id = card.dataset.reviewRoom || card.dataset.skippedRoom; return selected.find(c => c.uuid === id); };
      onChange("[data-branch]", el => { choiceOf(el).branch = el.value; });
      onChange("[data-setup]", el => { choiceOf(el).setup = el.value; });
      onChange("[data-room-memory]", el => { choiceOf(el).memoryChoice = el.value; });
      onChange("[data-user-memory]", el => { userMemoryChoice = el.value; });
      onChange("[data-user-memory-on]", el => { importUserMemory = el.checked; });
      onChange("[data-dependency]", el => { dependencyChoices[el.dataset.dependency] = el.value; });
      onChange("[data-selected]", el => { choiceOf(el).selected = el.checked; });
      onChange("[data-import-part]", el => { choiceOf(el)[el.dataset.importPart] = el.checked; });
      onChange("[data-target]", el => { const c = choiceOf(el); c.target = el.value || null; });
      onChange("[data-new-name]", el => { choiceOf(el).name = el.value.trim() || choiceOf(el).name; });
    }

    function renderApplying(progress) {
      const waiting = /^Waiting for /.test(progress || "");
      if (phase !== "applying") show("applying", "Bring rooms in", `<div class="cx-working">${art("carry-in", "is-busy")}<p class="cx-lead" data-progress role="status"></p><div class="cx-bar" aria-hidden="true"></div><p class="cx-hint" data-wait-hint hidden>They finish their reply first, so nothing is cut off. ${button("hurry", "Don't wait")}</p></div>`);
      $("[data-progress]").textContent = progress ? `${progress}…` : "Bringing your rooms in…";
      $("[data-wait-hint]").hidden = !waiting;
    }
    function renderDone(result) {
      const lines = result.rooms.map(r => `<li><b>${esc(r.name)}</b>: ${r.messages || r.files ? [r.messages ? count(r.messages, "message") : "", r.files ? count(r.files, "picture or file", "pictures and files") : ""].filter(Boolean).join(" and ") + " arrived" : "already up to date"}</li>`);
      if (result.userMemory) lines.push("<li><b>Your preferences</b> are updated</li>");
      const first = result.rooms[0];
      show("done", "Bring rooms in", `<div class="cx-center cx-done">${art("done", "is-done")}<p class="cx-lead">All in!</p><ul class="cx-facts is-center">${lines.join("") || "<li>Everything was already here.</li>"}</ul>
        <footer class="cx-actions is-center">${first && helpers.openRoom ? button("open-room", `Open ${esc(first.name)}`, "primary", ` data-room="${esc(first.id)}"`) : ""}${button("close", "Close", first && helpers.openRoom ? "ghost" : "primary")}</footer>
        <p class="cx-hint">Anything set aside is kept under Earlier versions of messages.</p></div>`);
    }

    async function removed() {
      clearError();
      removedRoom ||= catalog.rooms[0]?.id;
      show("removed", "Earlier versions of messages", `<p class="cx-hint">Messages that were replaced or set aside when rooms were combined. Nothing here is lost.</p><label class="cx-field">Room<select data-removed-room>${catalog.rooms.map(r => `<option value="${esc(r.id)}"${r.id === removedRoom ? " selected" : ""}>${esc(r.name)}</option>`).join("")}</select></label><div data-removed-list role="status">Loading…</div>`);
      if (!removedRoom) { $("[data-removed-list]").textContent = "There are no rooms here yet."; return; }
      $("[data-removed-room]").addEventListener("change", event => { removedRoom = event.target.value; removedOffset = 0; void removed().catch(failed); });
      const result = await request(`/api/carry/removed?room=${encodeURIComponent(removedRoom)}&offset=${removedOffset}`);
      if (phase !== "removed") return;
      $("[data-removed-list]").innerHTML = result.items.length ? `<ul class="cx-versions">${result.items.map(item => `<li><button type="button" data-carry-act="removed-detail" data-key="${esc(item.key)}"><span class="cx-version-head"><b>${esc(item.fromName || "System")}</b><small>${esc(new Date(item.ts).toLocaleString())}</small></span><span class="cx-version-text">${esc(item.text || "[no text]")}</span></button></li>`).join("")}</ul><footer class="cx-actions">${removedOffset ? button("removed-prev", "Newer") : ""}${result.more ? button("removed-next", "Older") : ""}</footer>` : `<div class="cx-center">${art("done", "is-small")}<p class="cx-hint">Nothing was set aside in this room.</p></div>`;
    }

    async function act(action, target) {
      clearError();
      try {
        if (action === "close") return await close();
        if (phase === "working" || phase === "applying") { if (action === "hurry" && job) await request(`/api/carry/${job}/hurry`, {}); return; }
        if (action === "home") { keepExportInputs(); renderHome(); }
        else if (action === "export") renderExport();
        else if (action === "import") renderDrop();
        else if (action === "removed") await removed();
        else if (action === "rooms-all" || action === "rooms-none") { for (const el of dialog.querySelectorAll("[data-export-room]")) el.checked = action === "rooms-all"; keepExportInputs(); updateExportTotals(); }
        else if (action === "choose-file") $("[data-import-file]").click();
        else if (action === "prepare-export") {
          if (!$("[data-export-form]").reportValidity()) return;
          keepExportInputs();
          if ((!exportSelection.size && !exportParts.userMemory) || !Object.values(exportParts).some(Boolean)) throw new Error("Choose a room and at least one thing to take.");
          const encrypt = $("[data-encrypt]").checked, passphrase = $("[data-passphrase]").value;
          if (encrypt && (!passphrase || passphrase !== $("[data-passphrase-repeat]").value)) throw new Error("Type the same password in both fields.");
          $("[data-passphrase]").value = $("[data-passphrase-repeat]").value = "";
          if (job && !downloaded) await cancel(job);
          downloaded = false; working("Packing your rooms…", "carry-out");
          const started = await request("/api/carry/export", { rooms: [...exportSelection], ...exportParts, sourceLabel: newLabel, ...(encrypt ? { passphrase } : {}) });
          job = started.id; const state = await poll(job);
          if (state.status === "error") { renderExport(); throw new Error(state.error); }
          catalog.source = { ...catalog.source, label: newLabel };
          const one = exportSelection.size === 1 ? catalog.rooms.find(r => exportSelection.has(r.id)) : null;
          const stem = !encrypt && one ? one.name.replace(/[^\p{L}\p{N}._-]+/gu, "-") : "viberoom";
          renderExported({ ...state.result, encrypted: encrypt, fileName: `${stem}-${new Date().toISOString().slice(0, 10)}.viberoom` });
        } else if (action === "download") {
          const a = document.createElement("a"); a.href = `/api/carry/${job}/download`; a.download = "viberoom.viberoom"; document.body.appendChild(a); a.click(); a.remove(); downloaded = true;
          target.innerHTML = `${icon("check")} Saved — save again`;
        } else if (action === "unlock") {
          const passphrase = $("[data-import-pass]").value; if (!passphrase) throw new Error("Type the password.");
          $("[data-import-pass]").value = ""; working("Unlocking the file…");
          await request(`/api/carry/${job}/inspect`, { passphrase });
          const state = await poll(job);
          if (state.status === "error") renderPassword(state.error); else await inspectedState(state);
        } else if (action === "apply") {
          if (!preview?.ready) return;
          renderApplying();
          await request(`/api/carry/${job}/apply`, { previewToken: preview.previewToken });
          const state = await poll(job, s => renderApplying(s.progress));
          if (state.status === "applied") { renderDone(state.result); helpers.imported?.(state.result); }
          else if (state.status === "ready") { preview = state.result; renderSummary(!!preview.refreshed); }
          else { phase = "summary"; await plan(); throw new Error(state.error || "The import did not finish."); }
        } else if (action === "open-room") { const id = target.dataset.room; await close(); helpers.openRoom?.(id); }
        else if (action === "dependency-view") {
          const details = target.closest("[data-library-key]"), path = target.dataset.path;
          const base = `/api/carry/${job}/dependency?key=${encodeURIComponent(details.dataset.libraryKey)}&path=${encodeURIComponent(path)}`;
          const comparison = await request(base);
          if (!details.isConnected) return;
          details.querySelector("[data-library-comparison]").innerHTML = `<div class="cx-compare">${[["ours", "Here"], ["incoming", sourceName()]].map(([side, label]) => { const file = comparison[side]; return `<div><b>${esc(label)}</b><pre>${esc(file ? file.text : "(not there)")}</pre>${file ? `${file.shortened ? '<p class="cx-hint">Shortened.</p>' : ""}<a data-ui="button" data-kind="ghost" download href="${base}&download=${side}">Save the whole file (${bytes(file.bytes)})</a>` : ""}</div>`; }).join("")}</div>`;
        } else if (action === "removed-next") { removedOffset += 50; await removed(); }
        else if (action === "removed-prev") { removedOffset = Math.max(0, removedOffset - 50); await removed(); }
        else if (action === "removed-detail") {
          const record = await request(`/api/carry/removed?room=${encodeURIComponent(removedRoom)}&key=${encodeURIComponent(target.dataset.key)}`);
          show("removed-detail", "Earlier versions of messages", `<p class="cx-version-head"><b>${esc(record.message.fromName || "System")}</b><small>${esc(new Date(record.message.ts).toLocaleString())}</small></p><pre class="cx-record">${esc(record.message.text)}</pre>${(record.message.images || []).map(image => `<img class="cx-record-image" src="/api/rooms/${encodeURIComponent(removedRoom)}/files/${encodeURIComponent(image.file)}" alt="${esc(image.name)}">`).join("")}<footer class="cx-actions">${button("removed", "Back to the list")}<a data-ui="button" data-kind="ghost" href="/api/carry/removed?room=${encodeURIComponent(removedRoom)}&key=${encodeURIComponent(target.dataset.key)}&download=1" download>Save the whole record</a></footer>`);
        }
      } catch (err) { failed(err); }
    }
    function failed(err) {
      if (closed || err?.name === "AbortError") return;
      if (phase === "working") { if (inspected && preview) renderSummary(); else if (fileName) renderDrop(); else renderHome(); }
      error(err);
    }
    dialog.addEventListener("click", event => { const target = event.target.closest("[data-carry-act]"); if (target && !target.disabled) void act(target.dataset.carryAct, target); });
    dialog.addEventListener("change", event => { if (event.target.matches("[data-target]")) { const field = event.target.closest("details")?.querySelector("[data-name-field]"); if (field) field.hidden = !!event.target.value; } });

    try {
      catalog = await request("/api/carry");
      exportSelection = new Set(initialRoom ? [initialRoom.id] : catalog.rooms.map(r => r.id));
      renderHome();
      if (catalog.rooms.length) {
        const started = await request("/api/carry/estimate", { rooms: catalog.rooms.map(r => r.id) }); estimateJob = started.id;
        const result = await poll(estimateJob);
        if (result.status === "ready") { estimates = result.result; if (phase === "export") { keepExportInputs(); renderExport(); } }
        await cancel(estimateJob); estimateJob = null;
      }
    } catch (err) { failed(err); }
  }
  window.ViberoomCarry = { open };
})();
