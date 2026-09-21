// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function () {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const bytes = n => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GiB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MiB` : `${Math.ceil(n / 1024)} KiB`;
  const button = (action, label, primary = false) => `<button type="button" data-ui="button" data-kind="${primary ? "primary" : "ghost"}" data-carry-act="${action}">${esc(label)}</button>`;
  const option = (value, label, selected) => `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;

  async function open(initialRoom, helpers) {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog wide carry-dialog";
    dialog.innerHTML = `<div class="carry-heading"><h3>Export / Import</h3>${button("close", "Close")}</div><nav class="carry-modes" hidden>${button("export", "Export")}${button("import", "Import")}${button("removed", "Removed versions")}</nav><p class="error carry-error" role="alert" hidden></p><div class="carry-content"><p role="status">Loading rooms…</p></div>`;
    document.body.appendChild(dialog); dialog.showModal();
    const content = dialog.querySelector(".carry-content"), errorBox = dialog.querySelector(".carry-error");
    const controller = new AbortController();
    let closed = false, phase = "home", catalog, estimates = [], estimateJob, job, downloaded = false;
    let inspected, selected = [], dependencyChoices = {}, preview, fileName = "", exportSelection, exportParts = { conversation: true, settings: true, resources: true, memory: false, userMemory: false }, newLabel;
    let importUserMemory = false, userMemoryChoice;
    let removedRoom = initialRoom?.id || "", removedOffset = 0;
    const $ = query => dialog.querySelector(query);
    function error(value) { errorBox.textContent = value instanceof Error ? value.message : String(value); errorBox.hidden = false; }
    function clearError() { errorBox.hidden = true; errorBox.textContent = ""; }
    async function request(path, body, raw = false) {
      const response = await fetch(path, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(raw ? 120000 : 30000)]), ...(body === undefined ? {} : { method: "POST", headers: raw ? { "Content-Type": "application/octet-stream" } : { "Content-Type": "application/json" }, body: raw ? body : JSON.stringify(body) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `The transfer request failed (${response.status}).`);
      return result;
    }
    async function cancel(id) { if (id) await fetch(`/api/carry/${encodeURIComponent(id)}/cancel`, { method: "POST", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {}); }
    async function close() {
      if (closed) return;
      if (phase === "applying") { error("The reviewed import is being applied. Wait for its result before closing this card."); return; }
      closed = true; controller.abort(); dialog.remove();
      await Promise.all([cancel(estimateJob), downloaded ? Promise.resolve() : cancel(job)]);
    }
    dialog.addEventListener("cancel", event => { event.preventDefault(); void close(); });
    async function poll(id) {
      while (!closed) {
        const state = await request(`/api/carry/${encodeURIComponent(id)}`);
        if (state.status !== "working") return state;
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      throw new DOMException("Closed", "AbortError");
    }
    function working(text) {
      phase = "working";
      content.innerHTML = `<p role="status" class="carry-working">${esc(text)}</p><p class="hint">You can close this card to cancel preparation. Your rooms have not changed.</p>`;
    }
    function keepExportInputs() {
      if (phase !== "export") return;
      exportSelection = new Set([...dialog.querySelectorAll("[data-export-room]:checked")].map(el => el.value));
      for (const key of Object.keys(exportParts)) exportParts[key] = $(`[data-export-part="${key}"]`).checked;
      newLabel = $("[data-copy-label]").value;
    }
    function updateSizes() {
      for (const key of Object.keys(exportParts)) {
        const total = key === "userMemory" ? catalog.userMemoryBytes : key === "memory" ? catalog.rooms.filter(r => exportSelection.has(r.id)).reduce((n,r)=>n+(r.memoryBytes||0),0) : estimates.filter(r => exportSelection.has(r.id)).reduce((sum, r) => sum + (key === "conversation" ? r.conversationBytes : key === "settings" ? r.settingsBytes : r.resourceBytes), 0);
        const el = $(`[data-part-size="${key}"]`); if (el) el.textContent = estimates.length || key === "memory" || key === "userMemory" ? bytes(total) : "measuring…";
      }
    }
    function renderExport() {
      phase = "export"; clearError();
      content.innerHTML = `<form class="carry-export-form">
        <label class="carry-field">This copy of viberoom<input data-copy-label maxlength="100" required value="${esc(newLabel ?? (catalog.source.label || catalog.source.suggested))}"><span class="hint">A name you recognise, kept for later transfers. It identifies where a branch came from.</span></label>
        <fieldset><legend>Rooms</legend><div class="carry-room-list">${catalog.rooms.map(r => `<label><input type="checkbox" data-export-room value="${esc(r.id)}"${exportSelection.has(r.id) ? " checked" : ""}>${esc(r.name)}</label>`).join("") || '<p class="hint">There are no rooms here yet. Use “Bring in a copy”.</p>'}</div></fieldset>
        <fieldset class="carry-part-list"><legend>What to carry</legend>${[["conversation", "Conversation and removed versions"], ["settings", "Room rules, vibemates and their skills"], ["resources", "Attached pictures and documents"], ["memory", "Learned room memory (optional)"], ["userMemory", "Shared user preferences (optional; all rooms)"]].map(([key, label]) => `<label><input type="checkbox" data-export-part="${key}"${exportParts[key] ? " checked" : ""}><span>${label}</span><small data-part-size="${key}"></small></label>`).join("")}</fieldset>
        <p class="hint">Sizes show content before compression. The finished file's size is shown before you save it. Working-folder files remain links. Stored connection credentials and agent sessions are not included; conversation text and attached files are copied as stored.</p>
        <label class="carry-check"><input type="checkbox" data-encrypt>Protect the entire copy with a passphrase</label>
        <div data-pass-fields hidden><label class="carry-field">Passphrase<input type="password" data-passphrase autocomplete="new-password" maxlength="4096"></label><label class="carry-field">Repeat the passphrase<input type="password" data-passphrase-repeat autocomplete="new-password" maxlength="4096"></label><p class="hint">Keep the phrase separately. There is no hint or recovery. Room names are encrypted too.</p></div>
        <div class="actions">${button("prepare-export", "Prepare the copy", true)}</div>
      </form>`;
      updateSizes();
      $("[data-encrypt]").addEventListener("change", event => { $("[data-pass-fields]").hidden = !event.target.checked; });
      for (const el of dialog.querySelectorAll("[data-export-room], [data-export-part]")) el.addEventListener("change", () => { keepExportInputs(); updateSizes(); });
      $("form").addEventListener("submit", event => { event.preventDefault(); void act("prepare-export"); });
    }
    function renderHome() {
      phase = "home"; clearError();
      content.innerHTML = `<p>Move conversations, room setup and attached files between copies of viberoom.</p><div class="carry-choices"><section><h4>Export</h4><p>Choose rooms and save a portable copy. You can protect it with a passphrase.</p>${button("export", "Export a copy", true)}</section><section><h4>Import</h4><p>Open a saved copy and review what to bring in before anything changes.</p>${button("import", "Import a copy", true)}</section></div>`;
    }
    function renderImport() {
      phase = "import"; clearError();
      content.innerHTML = `<p>Choose a viberoom copy from this computer. You will choose the rooms and parts to bring in, then review any differences before anything changes.</p><input type="file" data-import-file accept=".viberoom,.jsonl,.json,application/octet-stream"><p class="hint">Encrypted copies ask for the passphrase. Older viberoom JSONL copies can also be read.</p>`;
      $("[data-import-file]").addEventListener("change", event => { const file = event.target.files?.[0]; if (file) void upload(file).catch(failed); });
    }
    function renderPassword(message) {
      phase = "password";
      content.innerHTML = `<p>${esc(fileName)} is encrypted.</p><form><label class="carry-field">Passphrase<input type="password" data-import-pass autocomplete="off" maxlength="4096" required></label><div class="actions">${button("unlock", "Open the copy", true)}</div></form>`;
      if (message) error(message); else clearError();
      $("[data-import-pass]").focus(); $("form").addEventListener("submit", event => { event.preventDefault(); void act("unlock"); });
    }
    function renderSelection() {
      phase = "selection"; clearError();
      content.innerHTML = `<p>From <strong>${esc(inspected.source.label || "an unnamed copy")}</strong>. Choose the destination and the parts for each room.</p>${!catalog.source.label ? `<label class="carry-field">Name this copy of viberoom<input data-local-copy-name maxlength="100" value="${esc(catalog.source.suggested)}"><span class="hint">Kept for later transfers, so you can recognise this branch.</span></label>` : ""}${inspected.userMemory ? `<label class="carry-check"><input type="checkbox" data-import-user-memory${importUserMemory ? " checked" : ""}>Also review the shared user preferences in this file</label><p class="hint">Optional. These preferences affect every room; you will choose which version to keep.</p>` : ""}${inspected.rooms.map((r, i) => {
        const choice = selected[i], known = catalog.rooms.find(local => local.id === choice.target);
        return `<fieldset class="carry-import-room" data-import-room="${i}"><legend><label><input type="checkbox" data-selected${choice.selected ? " checked" : ""}>${esc(r.name)}</label></legend>
          <label class="carry-field">Destination<select data-target>${option("", "A new room", !choice.target)}${catalog.rooms.map(local => option(local.id, `Merge into ${local.name}`, local.id === choice.target)).join("")}</select></label>
          <label class="carry-field" data-name-field${known ? " hidden" : ""}>Name of the new room<input data-new-name maxlength="60" value="${esc(choice.name)}"></label>
          <div class="carry-inline-parts">${["conversation", "settings", "resources", "memory"].map(part => `<label><input type="checkbox" data-import-part="${part}"${choice[part] ? " checked" : ""}${r.parts.includes(part) ? "" : " disabled"}>${part === "settings" ? "Room setup" : part === "resources" ? "Resources" : part === "memory" ? "Room memory" : "Conversation"}</label>`).join("")}</div>
          <p class="hint">${r.counts.messages} messages · ${r.counts.graves} removed · ${r.counts.files} files${r.workspaceHint ? ` · Original working folder: ${esc(r.workspaceHint)}. A new room gets its own local working folder.` : ""}</p>
        </fieldset>`;
      }).join("")}<div class="actions">${button("preview", "Review the import", true)}</div>`;
      for (const el of dialog.querySelectorAll("[data-target]")) el.addEventListener("change", () => { el.closest("fieldset").querySelector("[data-name-field]").hidden = !!el.value; });
    }
    function takeSelection() {
      importUserMemory = !!$("[data-import-user-memory]")?.checked; userMemoryChoice = undefined;
      for (const field of dialog.querySelectorAll("[data-import-room]")) {
        const choice = selected[Number(field.dataset.importRoom)];
        choice.selected = field.querySelector("[data-selected]").checked;
        choice.target = field.querySelector("[data-target]").value || null;
        choice.name = field.querySelector("[data-new-name]").value.trim();
        for (const part of ["conversation", "settings", "resources", "memory"]) choice[part] = field.querySelector(`[data-import-part="${part}"]`).checked;
        delete choice.branch; delete choice.setup; delete choice.resourcesChoice; delete choice.memoryChoice;
      }
    }
    function memoryReview(memory, field, title) {
      return `<section class="carry-review-room"><h4>${esc(title)}</h4><div class="carry-comparison"><div><b>Here</b><ul>${memory.ours.notes.map(n=>`<li>${esc(n.text)}${n.locked ? " (protected)" : ""}</li>`).join("") || "<li>No notes</li>"}</ul><p>Agent edits: ${memory.ours.enabled ? "on" : "off"}</p></div><div><b>In the file</b><ul>${memory.incoming.notes.map(n=>`<li>${esc(n.text)}${n.locked ? " (protected)" : ""}</li>`).join("") || "<li>No notes</li>"}</ul><p>Agent edits: ${memory.incoming.enabled ? "on" : "off"}</p></div></div><label class="carry-field">Memory to keep<select data-${field}>${option("", "Choose which memory to keep", !memory.choice)}${option("ours", "Keep this computer's memory", memory.choice === "ours")}${option("incoming", "Use memory from the file", memory.choice === "incoming")}</select></label><p class="hint">Replaced notes remain in memory revision history. Imported notes are marked as imported.</p></section>`;
    }
    function renderPreview() {
      phase = "preview"; clearError();
      const unresolved = !preview.ready;
      content.innerHTML = `${preview.userMemory ? memoryReview(preview.userMemory, "user-memory", "Shared user preferences - all rooms") : ""}${preview.rooms.map(r => {
        const choice = selected.find(c => c.uuid === r.uuid), target = catalog.rooms.find(c => c.id === r.targetId);
        return `<section class="carry-review-room" data-review-room="${esc(r.uuid)}"><h4>${esc(r.name)}${r.made ? " · new room" : ""}</h4>
          ${r.branch ? `<p>Two branches differ: ${r.branch.changed} changed messages, ${r.branch.localContinuation} local and ${r.branch.incomingContinuation} incoming continuation messages.</p><label class="carry-field">Conversation<select data-branch>${option("both", "Keep both branches", !choice.branch || choice.branch === "both")}${option("ours", "Keep this copy's branch", choice.branch === "ours")}${option("incoming", "Take the branch from the file", choice.branch === "incoming")}</select></label><p class="hint">Versions that leave the conversation remain available under “Removed versions”.</p><div class="actions"><a data-ui="button" data-kind="ghost" download href="/api/carry/${job}/review?room=${encodeURIComponent(r.uuid)}">Save the full comparison</a><a data-ui="button" data-kind="ghost" download href="/api/carry/${job}/review?room=${encodeURIComponent(r.uuid)}&format=records">Full records, with tools</a></div>${r.branch.examples.map(x => `<details><summary>Compare a changed message</summary><div class="carry-comparison"><div><b>Here</b><pre>${esc(x.ours)}</pre></div><div><b>In the file</b><pre>${esc(x.incoming)}</pre></div></div></details>`).join("")}` : ""}
          ${r.newSetup ? `<details><summary>Room setup: ${r.newSetup.participants.length} ${r.newSetup.participants.length === 1 ? "vibemate" : "vibemates"}</summary><pre class="carry-record-text">${esc(JSON.stringify(r.newSetup, null, 2))}</pre><p class="hint">Imported vibemates stay disconnected until you start them.</p></details>` : ""}
          ${r.memory ? memoryReview(r.memory, "room-memory", "Room memory") : ""}
          ${r.settingsDiffer ? `<label class="carry-field">Room setup<select data-setup>${option("", "Choose which setup to keep", !choice.setup)}${option("ours", "Keep this copy's room setup", choice.setup === "ours")}${option("incoming", "Use the setup from the file", choice.setup === "incoming")}</select></label><details><summary>Review ${r.settingsDiff.length} setup differences</summary>${r.settingsDiff.map(diff => `<h5>${esc(diff.field)}</h5><div class="carry-comparison"><div><b>Here</b><pre>${esc(JSON.stringify(diff.ours, null, 2))}</pre></div><div><b>In the file</b><pre>${esc(JSON.stringify(diff.incoming, null, 2))}</pre></div></div>`).join("")}</details>${target?.connected ? '<p class="hint">Disconnect this room’s agents before replacing their setup. Keeping the current setup does not require that.</p>' : ""}` : ""}
          ${unresolved ? '<p class="hint">The final counts appear after these choices are checked.</p>' : `<p>${r.counts.added} new · ${r.counts.replaced} updated · ${r.counts.removed} removed · ${r.counts.same} unchanged.</p>`}
          <p>${r.resources.write} files to bring in (${bytes(r.resources.bytes)}) · ${r.resources.already} already here.</p>
          ${r.resources.conflicts?.length ? `<label class="carry-field">${r.resources.conflicts.length} existing files have different contents<select data-resource-choice>${option("", "Choose which files to keep", !choice.resourcesChoice)}${option("ours", "Leave out the different incoming versions", choice.resourcesChoice === "ours")}${option("incoming", "Bring in the incoming versions alongside existing files", choice.resourcesChoice === "incoming")}</select></label><details><summary>Conflicting files</summary><ul>${r.resources.conflicts.map(f => `<li>${esc(f.file)} · incoming ${bytes(f.incomingBytes)}</li>`).join("")}</ul></details>` : ""}
          ${r.resources.missing.length ? `<details class="carry-missing"><summary>${r.resources.missing.length} referenced files will still be missing</summary><ul>${r.resources.missing.map(name => `<li>${esc(name)}</li>`).join("")}</ul></details>` : ""}
        </section>`;
      }).join("")}${preview.dependencies.filter(d => d.differs || d.files.length).map(d => `<section class="carry-review-room"><h4>${esc(d.kind)}: ${esc(d.id)}</h4>${d.differs ? `<label class="carry-field">Shared library definition<select data-dependency="${esc(d.key)}">${option("", "Choose which definition to keep", !dependencyChoices[d.key])}${option("ours", "Keep the one on this computer", dependencyChoices[d.key] === "ours")}${option("incoming", "Take the one from the file", dependencyChoices[d.key] === "incoming")}</select></label><p class="hint">Replacing a shared definition affects every room using it.</p>` : `<p>New definition: ${d.files.length} files will be added to the shared library.</p>`}<details data-library-key="${esc(d.key)}"><summary>Review ${d.files.length} changed files</summary><div data-library-body></div></details></section>`).join("")}
        <div class="actions">${button("back-selection", "Change rooms or parts")}${button(unresolved ? "resolve" : "apply", unresolved ? "Check these choices" : "Apply import", true)}</div>`;
      for (const details of dialog.querySelectorAll("[data-library-key]")) details.addEventListener("toggle", () => {
        const body = details.querySelector("[data-library-body]");
        if (!details.open) { body.replaceChildren(); return; }
        const dependency = preview.dependencies.find(d => d.key === details.dataset.libraryKey);
        body.innerHTML = '<label class="carry-field">File<select data-library-path>' + dependency.files.map(file => option(file.path, file.action + ': ' + file.path, false)).join('') + '</select></label>' + button('dependency-view', 'Compare this file') + '<div data-library-comparison></div>';
      });
      for (const select of dialog.querySelectorAll("[data-branch], [data-setup], [data-resource-choice], [data-dependency], [data-room-memory], [data-user-memory]")) select.addEventListener("change", () => {
        const apply = $('[data-carry-act="apply"]'); if (apply) { apply.dataset.carryAct = "resolve"; apply.textContent = "Check these choices"; }
      });
    }
    function takeResolutions() {
      const globalChoice = $("[data-user-memory]"); if (globalChoice) { if (!globalChoice.value) throw new Error("Choose which shared user memory to keep."); userMemoryChoice = globalChoice.value; }
      for (const section of dialog.querySelectorAll("[data-review-room]")) {
        const choice = selected.find(c => c.uuid === section.dataset.reviewRoom);
        const branch = section.querySelector("[data-branch]"), setup = section.querySelector("[data-setup]");
        if (branch) choice.branch = branch.value;
        const memory = section.querySelector("[data-room-memory]"); if (memory) { if (!memory.value) throw new Error("Choose which room memory to keep."); choice.memoryChoice = memory.value; }
        if (setup) { if (!setup.value) throw new Error("Choose which room setup to keep."); choice.setup = setup.value; }
        const resources = section.querySelector("[data-resource-choice]");
        if (resources) { if (!resources.value) throw new Error("Choose which conflicting files to keep."); choice.resourcesChoice = resources.value; }
      }
      for (const select of dialog.querySelectorAll("[data-dependency]")) { if (!select.value) throw new Error("Choose which shared definition to keep."); dependencyChoices[select.dataset.dependency] = select.value; }
    }
    async function checkPlan() {
      const choices = selected.filter(c => c.selected);
      if (!choices.length && !importUserMemory) throw new Error("Choose a room or shared user memory.");
      if (choices.some(c => !c.conversation && !c.settings && !c.resources && !c.memory)) throw new Error("Choose at least one part for each selected room.");
      const copyName = $("[data-local-copy-name]");
      if (copyName) catalog.source = { ...catalog.source, ...await request("/api/carry/source", { label: copyName.value }) };
      working("Checking the selected rooms and differences…");
      await request(`/api/carry/${job}/plan`, { rooms: choices, dependencies: dependencyChoices, userMemory: importUserMemory, userMemoryChoice });
      const state = await poll(job); if (state.status === "error") { renderSelection(); throw new Error(state.error); }
      preview = state.result; renderPreview();
    }
    async function inspectedState(state) {
      if (state.status === "password") { renderPassword(); return; }
      if (state.status === "error") throw new Error(state.error);
      inspected = state.result;
      selected = inspected.rooms.map(r => {
        const identities = new Set([r.uuid, ...r.aliases]);
        const match = catalog.rooms.find(local => [local.uuid, ...local.aliases].some(id => identities.has(id)));
        return { uuid: r.uuid, selected: true, target: match?.id || null, name: r.name, conversation: r.parts.includes("conversation"), settings: r.parts.includes("settings"), resources: r.parts.includes("resources"), memory: false };
      });
      renderSelection();
    }
    async function upload(file) {
      if (file.size > 1024 ** 3) throw new Error("This archive exceeds 1 GiB.");
      if (job) { await cancel(job); job = null; }
      fileName = file.name; working(`Opening ${file.name} (${bytes(file.size)})…`);
      const started = await request("/api/carry/upload", file, true); job = started.id;
      await inspectedState(await poll(job));
    }
    async function removed() {
      phase = "removed"; clearError();
      removedRoom ||= catalog.rooms[0]?.id;
      content.innerHTML = `<label class="carry-field">Room<select data-removed-room>${catalog.rooms.map(r => option(r.id, r.name, r.id === removedRoom)).join("")}</select></label><div data-removed-list role="status">Loading removed versions…</div>`;
      if (!removedRoom) { $("[data-removed-list]").textContent = "There are no rooms here yet."; return; }
      $("[data-removed-room]").addEventListener("change", event => { removedRoom = event.target.value; removedOffset = 0; void removed().catch(failed); });
      const result = await request(`/api/carry/removed?room=${encodeURIComponent(removedRoom)}&offset=${removedOffset}`);
      if (phase !== "removed") return;
      $("[data-removed-list]").innerHTML = result.items.length ? `<ul class="carry-removed-list">${result.items.map(item => `<li><button type="button" data-carry-act="removed-detail" data-key="${esc(item.key)}"><b>${esc(item.fromName || "System")}</b> · ${esc(new Date(item.ts).toLocaleString())}<span>${esc(item.text || "[no text]")}</span></button></li>`).join("")}</ul><div class="actions">${removedOffset ? button("removed-prev", "Previous") : ""}${result.more ? button("removed-next", "Next") : ""}</div>` : "No removed versions are kept for this room.";
    }
    async function act(action, target) {
      clearError();
      try {
        if (action === "close") return await close();
        if (phase === "working" || phase === "applying") return;
        if (action === "export") { keepExportInputs(); renderExport(); }
        else if (action === "import") { keepExportInputs(); renderImport(); }
        else if (action === "removed") { keepExportInputs(); await removed(); }
        else if (action === "prepare-export") {
          if (!$("form").reportValidity()) return;
          keepExportInputs();
          if ((!exportSelection.size && !exportParts.userMemory) || !Object.values(exportParts).some(Boolean)) throw new Error("Choose rooms and at least one part to carry.");
          const encrypt = $("[data-encrypt]").checked, passphrase = $("[data-passphrase]").value;
          if (encrypt && (!passphrase || passphrase !== $("[data-passphrase-repeat]").value)) throw new Error("Enter the same nonempty passphrase in both fields.");
          $("[data-passphrase]").value = $("[data-passphrase-repeat]").value = "";
          if (job && !downloaded) await cancel(job);
          downloaded = false; working("Preparing the complete copy…");
          const started = await request("/api/carry/export", { rooms: [...exportSelection], ...exportParts, sourceLabel: newLabel, ...(encrypt ? { passphrase } : {}) });
          job = started.id; const result = await poll(job);
          if (result.status === "error") { renderExport(); throw new Error(result.error); }
          phase = "download";
          content.innerHTML = `<p>Your ${encrypt ? "encrypted " : ""}copy is ready: <strong>${bytes(result.result.bytes)}</strong>.</p><p class="hint">${encrypt ? "Keep the passphrase separately; it cannot be recovered." : "This file contains the selected conversations and resources."}</p>${(result.result.warnings || []).map(w => `<details class="carry-missing"><summary>${esc(w.room)}: ${w.missing.length} files and ${w.missingSkills.length} skill definitions were already missing</summary><p>They could not be included. References remain in the copy.</p><ul>${[...w.missing, ...w.missingSkills].map(name => `<li>${esc(name)}</li>`).join("")}</ul></details>`).join("")}<div class="actions">${button("download", "Save the copy", true)}</div>`;
        } else if (action === "download") {
          const a = document.createElement("a"); a.href = `/api/carry/${job}/download`; a.download = "viberoom.viberoom"; document.body.appendChild(a); a.click(); a.remove(); downloaded = true;
        } else if (action === "unlock") {
          const passphrase = $("[data-import-pass]").value; if (!passphrase) throw new Error("Enter the passphrase.");
          $("[data-import-pass]").value = ""; working("Checking the encrypted copy…");
          await request(`/api/carry/${job}/inspect`, { passphrase });
          const state = await poll(job);
          if (state.status === "error") renderPassword(state.error); else await inspectedState(state);
        } else if (action === "preview") { takeSelection(); await checkPlan(); }
        else if (action === "resolve") { takeResolutions(); await checkPlan(); }
        else if (action === "back-selection") renderSelection();
        else if (action === "apply") {
          phase = "applying"; content.innerHTML = '<p role="status">Applying the reviewed import…</p><p class="hint">The import is now being applied. Wait for the result.</p>';
          try {
            const result = await request(`/api/carry/${job}/apply`, { previewToken: preview.previewToken });
            phase = "applied"; content.innerHTML = `<p>${result.rooms.length || result.userMemory ? `Imported ${[...result.rooms.map(r => esc(r.name)), ...(result.userMemory ? ["shared user preferences"] : [])].join(", ")}.` : "No changes were needed."}</p><p class="hint">Removed and replaced variants are available under “Removed versions”.</p>`;
            helpers?.imported?.(result);
          } catch (err) { renderPreview(); const apply = $('[data-carry-act="apply"]'); if (apply) { apply.dataset.carryAct = "resolve"; apply.textContent = "Review again"; } throw err; }
        } else if (action === "dependency-view") {
          const details = target.closest("[data-library-key]"), path = details.querySelector("[data-library-path]").value;
          const base = '/api/carry/' + job + '/dependency?key=' + encodeURIComponent(details.dataset.libraryKey) + '&path=' + encodeURIComponent(path);
          const comparison = await request(base);
          if (!details.isConnected || !details.open) return;
          details.querySelector("[data-library-comparison]").innerHTML = '<div class="carry-comparison">' + [['ours','Here'],['incoming','In the copy']].map(([side, label]) => {
            const file = comparison[side];
            return '<div><b>' + label + '</b><pre>' + esc(file ? file.text : '[not present]') + '</pre>' + (file ? (file.shortened ? '<p class="hint">Preview shortened.</p>' : '') + '<a data-ui="button" data-kind="ghost" download href="' + base + '&download=' + side + '">Save the full file (' + bytes(file.bytes) + ')</a>' : '') + '</div>';
          }).join('') + '</div>';
        } else if (action === "removed-next") { removedOffset += 50; await removed(); }
        else if (action === "removed-prev") { removedOffset = Math.max(0, removedOffset - 50); await removed(); }
        else if (action === "removed-detail") {
          const record = await request(`/api/carry/removed?room=${encodeURIComponent(removedRoom)}&key=${encodeURIComponent(target.dataset.key)}`);
          phase = "removed-detail";
          content.innerHTML = `<p><b>${esc(record.message.fromName || "System")}</b> · ${esc(new Date(record.message.ts).toLocaleString())}</p><pre class="carry-record-text">${esc(record.message.text)}</pre>${(record.message.images || []).map(image => `<img class="carry-record-image" src="/api/rooms/${encodeURIComponent(removedRoom)}/files/${encodeURIComponent(image.file)}" alt="${esc(image.name)}">`).join("")}<div class="actions">${button("removed", "Back to removed versions")}<a data-ui="button" data-kind="ghost" href="/api/carry/removed?room=${encodeURIComponent(removedRoom)}&key=${encodeURIComponent(target.dataset.key)}&download=1" download>Save the full record</a></div>`;
        }
      } catch (err) { failed(err); }
    }
    function failed(err) { if (!closed && err?.name !== "AbortError") { if (phase === "working") renderImport(); error(err); } }
    dialog.addEventListener("click", event => { const target = event.target.closest("[data-carry-act]"); if (target) void act(target.dataset.carryAct, target); });
    try {
      catalog = await request("/api/carry");
      exportSelection = new Set(initialRoom ? [initialRoom.id] : catalog.rooms.map(r => r.id));
      $(".carry-modes").hidden = false;
      renderHome();
      if (catalog.rooms.length) {
        const started = await request("/api/carry/estimate", { rooms: catalog.rooms.map(r => r.id) }); estimateJob = started.id;
        const result = await poll(estimateJob);
        if (result.status === "ready") { estimates = result.result; if (phase === "export") updateSizes(); }
        await cancel(estimateJob); estimateJob = null;
      }
    } catch (err) { failed(err); }
  }
  window.ViberoomCarry = { open };
})();
