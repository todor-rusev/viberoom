// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function () {
  "use strict";
  const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  async function open(roomId, initialScope = "user") {
    const dialog = document.createElement("dialog"); dialog.className = "dialog wide memory-dialog";
    dialog.innerHTML = '<div class="memory-heading"><h3>Shared memory</h3><button data-ui="button" data-kind="ghost" data-memory-close>Close</button></div><p role="status">Loading memory…</p>';
    document.body.appendChild(dialog); dialog.showModal();
    let state, scope = initialScope, dirty = false, busy = false, warningRequest;
    const controller = new AbortController();
    const request = async body => {
      const url = "/api/memory" + (body ? "" : roomId ? `?room=${encodeURIComponent(roomId)}` : "");
      const response = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]), ...(body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, ...(roomId ? { room: roomId } : {}) }) } : {}) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || "Memory could not be saved."); return value;
    };
    const close = () => { if (busy || dirty && !confirm("Discard the unsaved memory edits?")) return; controller.abort(); dialog.remove(); };
    dialog.addEventListener("cancel", e => { e.preventDefault(); close(); });
    function error(e) { const node = dialog.querySelector(".memory-feedback"); if (node) { node.textContent = e.message || String(e); node.hidden = false; } }
    function take() {
      return [...dialog.querySelectorAll("[data-memory-note]")].map(el => ({ ...(el.dataset.memoryNote ? { id: el.dataset.memoryNote } : {}), text: el.querySelector("textarea").value, locked: el.querySelector("input[type=checkbox]").checked }));
    }
    function row(note = { text: "", locked: true }) {
      const item = document.createElement("section"); item.className = "memory-note"; item.dataset.memoryNote = note.id || "";
      item.innerHTML = `<textarea rows="2" maxlength="480" aria-label="Memory note">${esc(note.text)}</textarea><div class="memory-note-tools"><label class="check-row"><input type="checkbox"${note.locked ? " checked" : ""}>Protect from agent edits</label><button data-ui="button" data-kind="ghost" data-memory-remove>Remove</button></div>${note.author ? `<small>Last changed by ${esc(note.author)} · ${esc(new Date(note.updatedAt).toLocaleString())} · ${esc(note.basis)}${note.sources?.length ? ` · Source: ${note.sources.map(s => `${esc(s.room)} #${s.seq}`).join(", ")}` : ""}</small>` : ""}`;
      return item;
    }
    function counts() {
      const notes = take(), total = notes.reduce((n, x) => n + [...x.text.trim()].length, 0);
      dialog.querySelector(".memory-count").textContent = `${notes.length} / ${state.limits.notes} notes · ${total} / ${state.limits.scopeChars} characters · up to ${state.limits.noteChars} per note`;
      dialog.querySelector("[data-memory-add]").disabled = notes.length >= state.limits.notes;
    }
    function render() {
      const current = state[scope]; dirty = false; warningRequest = null;
      dialog.innerHTML = `<div class="memory-heading"><h3>Shared memory</h3><button data-ui="button" data-kind="ghost" data-memory-close>Close</button></div>
        <nav class="memory-scopes" aria-label="Whose memory"><button data-ui="button" data-kind="${scope === "user" ? "primary" : "ghost"}" data-memory-scope="user">About you · all rooms</button>${roomId ? `<button data-ui="button" data-kind="${scope === "room" ? "primary" : "ghost"}" data-memory-scope="room">This room</button>` : ""}</nav>
        <p>${scope === "user" ? "Durable preferences shared with every room, independently of history-sharing settings." : "Durable conventions shared by the vibemates in this room."} Current instructions take precedence. Private agent session notes are separate.</p>
        <label class="check-row"><input type="checkbox" data-memory-enabled${current.enabled ? " checked" : ""}>Allow vibemates to maintain these notes</label><p class="hint">Turning this off stops agent edits; existing notes are still supplied. Your new and edited notes are protected by default.</p>
        <p class="memory-count hint"></p><div class="memory-notes"></div><button data-ui="button" data-kind="ghost" data-memory-add>Add a note</button>
        <p class="memory-feedback error" role="status" hidden></p><button data-ui="button" data-kind="secondary" data-memory-ack hidden>Save with these warnings</button>
        <div class="actions"><button data-ui="button" data-kind="ghost" data-memory-reload>Reload</button><button data-ui="button" data-kind="primary" data-memory-save>Save memory</button></div>
        <details class="memory-history"><summary>Previous revisions (${state.revisions[scope].length})</summary><p class="hint">The last ${state.limits.revisions} versions are kept here. Restoring changes notes, not the agent-edit switch.</p>${state.revisions[scope].map(r => `<details><summary>${esc(new Date(r.at).toLocaleString())} · ${esc(r.actor)} · ${esc(r.reason)}</summary><ul>${r.snapshot.notes.map(n => `<li>${esc(n.text)}</li>`).join("") || "<li>No notes</li>"}</ul><button data-ui="button" data-kind="ghost" data-memory-restore="${r.revision}">Restore these notes</button></details>`).join("")}</details>
        <details class="memory-history"><summary>Clear this memory</summary><p class="hint">Removes the notes and their revision history in this scope. Earlier conversation messages, backups and already-delivered prompts are not erased.</p><button data-ui="button" data-kind="danger" data-memory-clear>Clear notes and history</button></details>`;
      const container = dialog.querySelector(".memory-notes"); for (const note of current.notes) container.appendChild(row(note)); counts();
      if (state.warnings?.[scope]?.length) error(state.warnings[scope].map(w => w.message).join("\n"));
    }
    async function save(body) {
      busy = true;
      for (const control of dialog.querySelectorAll("button, input, textarea")) control.disabled = true;
      try {
        const value = await request(body);
        if (value.saved === false) { warningRequest = { ...body, acknowledge: value.acknowledge }; error(value.warnings.map(w => w.message).join("\n")); dialog.querySelector("[data-memory-ack]").hidden = false; return; }
        state = value; render(); const feedback = dialog.querySelector(".memory-feedback"); feedback.classList.remove("error"); feedback.hidden = false; feedback.textContent = "Memory saved. Vibemates receive it on their next turn.";
      } catch (e) { error(e); } finally { busy = false; for (const control of dialog.querySelectorAll("button, input, textarea")) control.disabled = false; counts(); }
    }
    dialog.addEventListener("input", event => { if (event.target.matches("textarea")) event.target.closest("[data-memory-note]").querySelector("input[type=checkbox]").checked = true; dirty = true; warningRequest = null; dialog.querySelector("[data-memory-ack]").hidden = true; counts(); });
    dialog.addEventListener("click", async event => {
      const button = event.target.closest("button"); if (!button || busy) return;
      try {
        if (button.hasAttribute("data-memory-close")) return close();
        if (button.dataset.memoryScope || button.hasAttribute("data-memory-reload")) {
          if (dirty && !confirm("Discard the unsaved memory edits and reload?")) return;
          if (button.dataset.memoryScope) scope = button.dataset.memoryScope;
          state = await request(); render(); return;
        }
        if (button.hasAttribute("data-memory-add")) { dialog.querySelector(".memory-notes").appendChild(row()); dirty = true; warningRequest = null; dialog.querySelector("[data-memory-ack]").hidden = true; counts(); return; }
        if (button.hasAttribute("data-memory-remove")) { button.closest("[data-memory-note]").remove(); dirty = true; warningRequest = null; dialog.querySelector("[data-memory-ack]").hidden = true; counts(); return; }
        if (button.hasAttribute("data-memory-save")) return save({ action: "revise", scope, revision: state[scope].revision, enabled: dialog.querySelector("[data-memory-enabled]").checked, notes: take() });
        if (button.hasAttribute("data-memory-ack") && warningRequest) return save(warningRequest);
        if (button.hasAttribute("data-memory-restore") && (!dirty || confirm("Discard unsaved edits and restore the displayed revision?"))) return save({ action: "restore", scope, revision: state[scope].revision, restoreRevision: Number(button.dataset.memoryRestore) });
        if (button.hasAttribute("data-memory-clear") && confirm("Clear all notes and retained revisions in this memory scope?")) return save({ action: "clear", scope, revision: state[scope].revision });
      } catch (e) { error(e); }
    });
    try { state = await request(); render(); } catch (e) { dialog.innerHTML = `<p class="error">${esc(e.message)}</p><button data-ui="button" data-memory-close>Close</button>`; }
  }
  window.ViberoomMemory = { open };
})();
