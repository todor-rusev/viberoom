// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  const SEARCH_FORMS = {
    question: "Query decomposition (a short question per topic of your message)",
    words: "Your words by topic (your message cut by topic, as you wrote it)",
    fact: "HyDE (hypothetical document: the facts an answer would need, imagined, then searched for)",
  };
  const MEMORY_ROOM_COLUMNS = ["sp-mem-remembers", "sp-mem-input", "sp-mem-shares", "sp-mem-reads"];
  function roomsRow({ items: rooms, columns, summary }, row, { UI, esc }) {
    if (!rooms.length) return "";
    const head = columns.map(({ label }) => `<th scope="col">${esc(label)}</th>`).join("");
    const body = rooms.map((room) => `<tr class="room-value" data-room="${esc(room.id)}">
        <th scope="row"><span class="mem-room-name">${room.mark}<span class="rv-name" title="${esc(room.name)}">${esc(room.name)}</span></span></th>
        ${columns.map(({ id, label }) => `<td data-row="${id}" data-label="${esc(label)}">${room.cells[id]}</td>`).join("")}
        <td class="mem-recovery-cell" data-label="Recovery">${UI.html("button", { label: "Recover…", kind: "secondary", size: "sm", title: `Rebuild ${room.name}'s memory from eligible originals, with your budget and review`, data: { memRecover: room.id } })}</td>
      </tr>`).join("");
    return row({
      label: "Rooms", id: "sp-mem-rooms", stacked: true,
      hint: "Each room's own memory, the same settings as Memory in its settings. A room that does not remember sends nothing.",
      status: UI.raw(`<span class="rv-summary" data-rv-summary="sp-mem-remembers">${esc(summary)}</span>`),
      control: UI.raw(`<div class="mem-rooms-scroll"><table class="mem-rooms" data-own-save><colgroup>${Array.from({ length: columns.length + 2 }, () => "<col>").join("")}</colgroup><thead><tr><th scope="col">Room</th>${head}<th scope="col" aria-label="Recover"></th></tr></thead><tbody>${body}</tbody></table></div>`),
    });
  }

  function markup({ memory: m, rooms, opened }, services) {
    const { UI, esc, ic, selectHtml, keyHelp: KEY_GEEK, noPeekHtml, scene, consent } = services;
    const waitingOn = consent.waitingOn;
    const consentGateHtml = props => consent.gate(props, UI);
    const consentLockHtml = (body, props) => consent.lock(body, { ...props, opened: opened === props.feature }, UI);
    const memoryRoomsRow = row => roomsRow(rooms, row, services);
    if (!m) return '<p class="hint" id="sp-mem-loading">Loading…</p>';
    const v = m.view, st = m.status || {};
    const chosen = (v.providers || []).find((p) => p.id === v.provider) || null;
    const behind = (st.rooms || []).reduce((sum, r) => sum + (r.behind || 0), 0);
    const rate = st.rateWindow, at = (ms) => new Date(ms).toLocaleTimeString();
    const spent = (st.usage && chosen ? ` This month, by this copy's count: ${st.usage.credits}${st.usage.cap ? ` of ${st.usage.cap}` : ""} ${chosen.costUnit}.` : "")
      + (rate && chosen ? ` ${chosen.label} at ${at(rate.at)}: ${rate.status === 429 ? "requests refused for now" : "answering"}${rate.remaining !== null || rate.limit !== null ? `, ${rate.remaining ?? "?"} of ${rate.limit ?? "?"} requests left this minute` : ""}${rate.resetAt !== null ? `, the window resets at ${at(rate.resetAt)}` : ""}${rate.retryAfterMs !== null ? `, asked to wait ${Math.round(rate.retryAfterMs / 1000)} s` : ""}.` : "");
    const dashboard = chosen?.dashboard && st.usage ? ` The account's total: ${chosen.dashboard.label}, ${chosen.dashboard.url.replace(/^https?:\/\//, "")}.` : "";
    const status = (st.paused
      ? `Paused: ${st.paused.reason} The queue waits; nothing is lost.`
      : !chosen ? "Off. Nothing leaves this computer."
      : !chosen.consent ? "Waiting for your consent below before anything is sent."
      : `On. ${st.pendingOps ? `${st.pendingOps} queued operation${st.pendingOps === 1 ? "" : "s"}, ` : ""}${behind ? `${behind} message${behind === 1 ? "" : "s"} not yet distilled.` : "caught up."}`) + spent + dashboard;
    const row = (props) => UI.html("setting", props);
    const options = [`<option value="off"${!chosen ? " selected" : ""}>Off</option>`]
      .concat((v.providers || []).map((p) => `<option value="${esc(p.id)}"${v.provider === p.id ? " selected" : ""}>${esc(p.label)}</option>`)).join("");
    const fieldHtml = (f) => {
      if (f.kind === "secret") return row({ label: f.label, hint: f.hint || "", lead: UI.raw(noPeekHtml()), geek: KEY_GEEK, data: waitingOn(v, f.key), control: UI.raw(`<input type="password" class="input" data-mem-field="${esc(f.key)}" data-mem-kind="secret" aria-label="${esc(f.label)}" autocomplete="off" spellcheck="false" placeholder="${f.set ? "•••••• (set; paste to replace)" : esc(f.placeholder || "")}">`) });
      if (f.kind === "number") return row({ label: f.label, for: `sp-mem-${f.key}`, hint: f.hint || "", control: UI.raw(UI.html("number-field", { id: `sp-mem-${f.key}`, value: String(f.value ?? 0), min: f.min ?? 0, max: f.max ?? 1000000000, ...(f.step !== undefined ? { step: f.step } : {}), data: { memField: f.key, memKind: "number" } })) });
      return row({ label: f.label, hint: f.hint || "", control: UI.raw(`<input type="text" class="input" data-mem-field="${esc(f.key)}" data-mem-kind="text" aria-label="${esc(f.label)}" spellcheck="false" value="${esc(String(f.value ?? ""))}" placeholder="${esc(f.placeholder || "")}">`) });
    };
    const providerRows = chosen ? chosen.fields.map(fieldHtml).join("") : "";
    const llm = v.filter.mode === "llm";
    const rest = `${providerRows}
      ${row({ label: "The sieve", for: "sp-mem-filter", geek: "What of the conversation reaches the provider. The model mode reads every message — the agents' reports included — and forwards the salient ones, a long one as its own excerpts or whole, in the room's language; it needs the endpoint below. Everything sends each message whole: the fullest graph, the highest spend, watched by the monthly ceiling. Human-only stays within free plans but the graph misses the system's own story. The model mode also writes the questions each turn's search asks. No mode cuts a message: one too long for a single episode is held, not shortened.", control: UI.raw(`<select class="select" id="sp-mem-filter"><option value="llm"${llm ? " selected" : ""}>A small model keeps what matters (recommended)</option><option value="off"${v.filter.mode === "off" ? " selected" : ""}>Everything, whole (default)</option><option value="heuristic"${v.filter.mode === "heuristic" ? " selected" : ""}>Only the human's messages, whole</option></select>`) })}
      ${row({ label: "Sieve endpoint", for: "sp-mem-f-url", hidden: !llm, data: { memLlm: true, ...waitingOn(v, "sieve") }, hint: "Any OpenAI-compatible chat-completions endpoint: OpenAI, a local Ollama (http://localhost:11434/v1), Groq, OpenRouter…", control: UI.raw(`<input type="text" class="input" id="sp-mem-f-url" spellcheck="false" value="${esc(v.filter.baseUrl || "")}" placeholder="https://api.openai.com/v1">`) })}
      ${row({ label: "Sieve model", for: "sp-mem-f-model", hidden: !llm, data: { memLlm: true, ...waitingOn(v, "sieve") }, control: UI.raw(`<input type="text" class="input" id="sp-mem-f-model" spellcheck="false" value="${esc(v.filter.model || "")}" placeholder="a small, cheap model">`) })}
      ${row({ label: "Sieve API key", for: "sp-mem-f-key", hidden: !llm, data: { memLlm: true }, lead: UI.raw(noPeekHtml()), geek: KEY_GEEK, control: UI.raw(`<input type="password" class="input" id="sp-mem-f-key" autocomplete="off" spellcheck="false" placeholder="${v.filter.keySet ? "•••••• (set; paste to replace)" : "the endpoint's key; empty for a local one"}">`) })}
      ${row({ label: "Search form", for: "sp-mem-f-form", hidden: !llm, data: { memLlm: true }, hint: "What the sieve's model writes to search the memory for your message.", geek: "The forms were tried on the same messages, their facts judged blind: query decomposition found the most useful facts and the fewest unrelated ones, so it is the default; HyDE brought the most noise, mostly from other rooms. Only the model writes these: without it, the message is cut at its sentences.", control: UI.raw(selectHtml("sp-mem-f-form", Object.entries(SEARCH_FORMS), v.filter.form || "question")) })}
      ${row({ label: "Most characters of recalled memory in a turn", for: "sp-mem-block", hint: "The recalled facts, messages and nodes go into each vibemate's prompt up to this character budget, including their source references. The default is 4 000 characters.", geek: "How a turn's block is made. Before a vibemate answers your message, the sieve's model reads it and writes up to three short searches, one per topic, in the search form above. Each asks this room's graph, and the other rooms' when the room searches them in each turn's memory block (Search the other rooms, in its settings). Each answer keeps the provider's selected order, with facts, messages and nodes together. This room's answers have no relevance threshold; only facts from other rooms use it (0.01 by default, with the provider's settings above). With relevance scores, answers compete by their next fact; scores equal to the same hundredth tie, with this room first. Without scores, this room's answers come first. A message or node travels with the fact before it; items before this room's first fact lead the list. The budget follows that order and stops at the first item that does not fit. An oversized first item's text is explicitly shortened if its required metadata fits within the budget. The Prompt view shows each turn's searches and recalled context.", control: UI.raw(UI.html("number-field", { id: "sp-mem-block", value: String(v.blockChars ?? 4000), min: 1000, max: 8000, step: 500 })) })}`;
    return `<div class="page-hero">
        <div class="mem-scene scene-art" role="img" aria-label="A vibemate at its desk, writing down what the room said">${scene("memory-scribe")}</div>
        <b class="page-hero-title">What is long-term memory</b>
        <div class="hero-notes">
          <div class="hero-note is-what"><div class="hero-note-head">${ic("journal")}Rooms that remember</div><p>Rooms feed one long-term memory: what was said becomes facts your vibemates can recall in later conversations, each with the span it held true. A new room remembers from the start.</p><p>Each room has its own switch: "This room remembers", in the room's settings, and every room's below, under Rooms, with the rest of its memory; the rooms made before keep the choice they have.</p></div>
          <div class="hero-note is-how"><div class="hero-note-head">${ic("bot")}Set it up together</div><p>It is a rather geeky setup: a graph provider, a sieve, two API keys. <b>You do not have to do it alone</b> — in any room, write <code>/set-up-long-term-memory</code> and a vibemate walks you through it step by step. Keys go on write-only cards it never sees.</p><p>Feeling geeky yourself? Everything is below.</p></div>
        </div>
      </div>
      ${row({ label: "Provider", for: "sp-mem-provider", hint: chosen ? chosen.blurb : "The master switch of this page: choose a provider to unlock the rest.", status, statusId: "sp-mem-status", geek: "Every provider hides behind the same contract; switching later keeps the rooms' switches and the local bookkeeping. What each one can and cannot do (forget one message, keep fact validity spans) is declared, not assumed.", control: UI.raw(`<select class="select" id="sp-mem-provider" data-drawn-for="${esc(v.provider)}">${options}</select>`) })}
      ${chosen ? consentGateHtml({ feature: "memory", icon: "graph", recipient: chosen.label, given: !!chosen.consent, lapsed: !!chosen.consentLapsed, words: chosen.consentText, view: v }) : ""}
      ${chosen ? memoryRoomsRow(row) : ""}
      ${consentLockHtml(rest, { locked: !chosen || !chosen.consent, feature: "memory", note: chosen ? "Agree above to set it up" : "Choose a provider above to set it up" })}
      ${chosen ? `${row({ label: "Memory deliveries", hint: "Check pending writes and cloud deletions, including rooms closed on this computer. Credit totals include reservations for requests whose outcome is unknown.", data: { ownSave: true }, control: UI.raw(UI.html("button", { label: "Refresh deliveries", id: "sp-mem-deliveries-load", size: "sm" })) })}<div id="sp-mem-deliveries" data-own-save aria-live="polite"></div>` : ""}`;
  }

  function createRows({ UI, row: settingRow }) {
  function memoryDeliveryRowHtml(row) {
    const states = { prepared: "Waiting to send", unknown: "Delivery not confirmed", accepted: "Accepted; processing not confirmed", processed: "Processing confirmed", rejected: "The provider refused this write", conflict: "Conflicting receipts; review needed", duplicates: "Duplicate episodes; repair pending" };
    const cleanup = { pending: "Local text erased; cloud cleanup pending", not_requested: "Local copy removed; cloud memory kept", episodes_deleted: "Known episodes deleted", graph_deleted: "Cloud graph deletion confirmed" };
    const reasons = { listing_page_limit: "The check reached 100 pages (up to 10,000 episodes); it cannot authorize another write.", listing_truncated: "The provider returned an incomplete list; no retry is authorized.", not_found: "The latest complete check did not find this operation.", fact_reconciliation_unverified: "This provider cannot yet verify an uncertain explicit fact write.",
      index_building: "Reading the cloud history in parts; the next check will continue from here.",
      index_recent_incomplete: "Checking the latest cloud records in parts; the next check will continue from here.",
      index_cursor_expired: "The saved reading position expired; the check will start again.",
      indexed_episode_unverified: "A found episode could not be confirmed; no repeat write is authorized.",
      indexed_source_unverified: "The source's cloud records could not be confirmed; no repeat write is authorized." };
    const removed = row.retiredAt !== null;
    const outcome = row.retirement === "source_imported" ? `Imported history selected; cloud cleanup not requested · ${row.state === "prepared" && !row.attempts ? "previous delivery withdrawn before sending" : states[row.state] || row.state}`
      : removed ? cleanup[row.cleanup] || "Local text erased" : states[row.state] || row.state;
    const action = !removed && row.roomLoaded && row.state === "rejected" ? "retry"
      : !removed && row.roomLoaded && row.state === "unknown" && row.replays && row.kind === "episode" ? "replay"
      : !removed && row.roomLoaded && ["prepared", "unknown", "accepted", "duplicates"].includes(row.state) ? "check"
      : removed && row.roomLoaded && row.cleanup === "pending" && row.attempts ? "check" : null;
    const label = action === "retry" ? "Retry refused write" : action === "replay" ? "Authorize one more attempt…" : "Check again";
    const maintenance = ["graph_deleted", "not_requested"].includes(row.cleanup) ? null : row.maintenance;
    const cleanupStates = { processing: "Episode cleanup is waiting for processing or deletion confirmation", stalled: "Episode cleanup has been waiting for at least 30 minutes", watching: "Watching for late acceptance; complete erasure is not confirmed", failed: "Episode cleanup check incomplete", cleaned: "Episode cleanup confirmed; derived facts may still need repair" };
    const maintenanceState = maintenance?.state === "processing" && Date.now() - maintenance.since >= 30 * 60_000 ? "stalled" : maintenance?.state;
    const maintenanceHint = maintenance ? ` · ${cleanupStates[maintenanceState] || maintenanceState}${maintenance.reason ? ` (${maintenance.reason})` : ""}` : "";
    const when = (ms) => new Date(ms).toLocaleString(), watch = row.watch;
    const watchHint = !watch || watch.state === "resolved" ? ""
      : watch.state === "active" ? ` · automatic checks until ${when(watch.deadlineAt)}${watch.nextAt !== null ? ` (next: ${when(watch.nextAt)})` : ""}`
      : ` · automatic checks ended on ${when(watch.deadlineAt)}${removed && row.cleanup === "pending" ? "; a late acceptance was not observed until then" : ""}`;
    const hint = `${outcome}${maintenanceHint}${row.reason ? ` · ${reasons[row.reason] || row.reason}` : ""}${watchHint}. ${row.attempts} attempts${row.creditsPerAttempt !== null ? ` · estimated ${row.creditsPerAttempt} credits per attempt` : ""}${row.roomLoaded ? "" : " · local room not loaded"}${row.repairPending ? " · affected facts and summaries await repair" : ""}`;
    const watchGeek = watch ? `\nWatch: ${watch.state}, ${watch.checks} automatic checks since ${when(watch.startedAt)}${watch.lastCheckAt !== null ? `\nLast check: ${when(watch.lastCheckAt)} · ${watch.lastResult}` : ""}` : "";
    return settingRow({ label: `${row.roomId} · ${row.sourceId}`, hint,
      geek: `Operation: ${row.opId}\nGraph: ${row.roomUuid}\nReceipts: ${row.externalIds.join(", ") || "none"}\nPrepared: ${new Date(row.preparedAt).toLocaleString()}${watchGeek}`,
      control: action ? UI.raw(UI.html("button", { label, size: "sm", data: { deliveryAction: action, op: row.opId, attempt: row.attempts } })) : undefined });
  }

  function memoryDeletionStateText(state) {
    const states = { queued: "Episode deletion queued", processing: "Waiting for the episode to finish processing", stalled: "Episode processing stalled for at least 30 minutes", failed: "Episode deletion needs another attempt", expired: "Automatic attempts ended after 7 days; the deletion is still owed" };
    return states[state] || state;
  }

  function memoryCleanupRowHtml(row) {
    if (row.kind === "replacement") return memoryReplacementRowHtml(row);
    const imported = row.reason === "imported_source_read_only";
    const reason = row.reason && row.reason !== "episode_not_processed" ? ` · ${row.reason}` : "";
    const retry = !imported && (row.state === "failed" || row.state === "expired");
    return settingRow({ label: `Episode deletion · ${row.roomId} · ${row.sourceId}`,
      hint: imported ? "Import leaves cloud memory unchanged. A new local edit or deletion can resume this operation."
        : `${memoryDeletionStateText(row.state)}${reason}. Other operations continue.${row.retryAt && row.state !== "expired" ? ` Next check: ${new Date(row.retryAt).toLocaleString()}.` : ""}`,
      geek: `Queue operation: ${row.id}\nGraph: ${row.roomUuid || "current room graph"}\nChecks: ${row.attempts}${row.waitingSince !== null ? `\nWaiting since: ${new Date(row.waitingSince).toLocaleString()}` : ""}`,
      control: retry ? UI.raw(UI.html("button", { label: "Retry deletion", size: "sm", data: { deliveryAction: "retry-cleanup", op: row.id } })) : undefined });
  }

  function memoryReplacementRowHtml(row) {
    const when = (ms) => new Date(ms).toLocaleString(), waits = row.waitsFor;
    const imported = row.reason === "imported_source_read_only";
    const hint = imported ? "Imported history is kept locally. A new local edit or deletion can change its cloud memory."
      : row.state === "settling" ? `The new version goes a minute after the last edit, at ${when(row.retryAt)}.`
      : row.state === "suspended" ? "The new version waits: this room does not remember now."
      : row.state === "failed" ? `The new version is not sent yet${row.reason ? ` · ${row.reason}` : ""}.${row.retryAt ? ` Next attempt: ${when(row.retryAt)}.` : ""}`
      : row.state === "expired" ? "Automatic attempts ended after 7 days; the new version is still owed."
      : row.state === "waiting" && waits.kind === "deletion" ? `The new version waits for the old one's deletion: ${memoryDeletionStateText(waits.state)}${waits.reason && waits.reason !== "episode_not_processed" ? ` · ${waits.reason}` : ""}.`
      : row.state === "waiting" ? `The new version waits until the old one has certainly left the graph${waits.reason ? ` · ${waits.reason}` : ""}.${waits.checksEnded ? " Automatic checks of the old version ended." : ""}`
      : "The new version is due.";
    const button = imported ? null : row.state === "failed" || row.state === "expired" ? { label: "Retry", data: { deliveryAction: "retry-replacement", op: row.id } }
      : row.state === "waiting" && waits.kind === "deletion" && (waits.state === "failed" || waits.state === "expired") ? { label: "Retry deletion", data: { deliveryAction: "retry-cleanup", op: waits.op } }
      : row.state === "waiting" && waits.kind === "version" && waits.checksEnded ? { label: "Check again", data: { deliveryAction: "check", op: waits.opId, attempt: waits.attempt } }
      : null;
    return settingRow({ label: `Edited message · ${row.roomId} · ${row.sourceId}`, hint,
      geek: `Queue operation: ${row.id}\nGraph: ${row.roomUuid || "current room graph"}${waits ? `\nWaits for: ${waits.kind === "deletion" ? `deletion ${waits.op}` : `erased operation ${waits.opId} (${waits.state})`}` : ""}`,
      control: button ? UI.raw(UI.html("button", { label: button.label, size: "sm", data: button.data })) : undefined });
  }

  function memoryVersionRowHtml(row) {
    const reasons = { listing_incomplete: "The graph could not be read completely; nothing is sent.", older_version_leaving: "Waiting for the source's proven predecessors to leave the graph.",
      source_replaced_elsewhere: "The graph contains a version absent from this copy's carry history; sending waits for a transfer.",
      source_changed_during_check: "The source changed during the check; its current version will be checked again.",
      source_presence_unavailable: "Cloud records could not be confirmed; nothing is sent.",
      not_processed_yet: "Waiting for the matching episode to finish processing or become readable.", unknown_version: "The graph contains another version; waiting for a transfer that brings it here." };
    const exhausted = row.state === "held" && typeof row.reason === "string" && row.reason.startsWith("source_check_exhausted:");
    const hint = exhausted ? `Automatic checks ended: the graph could not be read back complete and fresh several times in a row (${row.reason.slice("source_check_exhausted:".length)}). The message is not confirmed in the long-term memory until a check passes.`
      : reasons[row.reason] || "Queued for checking against the shared graph.";
    return settingRow({ label: `Message version · ${row.roomId} · ${row.sourceId}`, hint,
      geek: `State: ${row.state}${row.retries ? `\nIncomplete reads in a row: ${row.retries}` : ""}${row.retryAt ? `\nNext check: ${new Date(row.retryAt).toLocaleString()}` : ""}`,
      control: exhausted ? UI.raw(UI.html("button", { label: "Check again", size: "sm", data: { deliveryAction: "check-version", room: row.roomId, source: row.sourceId } })) : undefined });
  }

  function memoryBindingRowHtml(row) {
    const watch = row.watch;
    return settingRow({ label: `Shared episode · ${row.roomId} · ${row.sourceId}`,
      hint: watch?.state === "active" ? `Checking for late duplicates until ${new Date(watch.deadlineAt).toLocaleString()}.`
        : "Automatic checks ended; this does not prove a late duplicate cannot appear.",
      geek: `Version: ${row.version}${watch?.lastResult ? `\nLast result: ${watch.lastResult}` : ""}`,
      control: UI.raw(UI.html("button", { label: "Check again", size: "sm", data: { deliveryAction: "check-binding", watch: row.watchId } })) });
  }

    return Object.freeze({ memoryDeliveryRowHtml, memoryDeletionStateText, memoryCleanupRowHtml,
      memoryReplacementRowHtml, memoryVersionRowHtml, memoryBindingRowHtml });
  }
  function bind(section, ports, active) {
    const { readMemory, saveMemory, onAccepted, bindConsent, openRecovery, loadMetadata, onError } = ports;
    const bindSave = (...args) => ports.bindSave(...args, { listen: active.on, canStart: () => !active.disposed });
    const showError = error => { if (!active.disposed) onError(error); };
    bindConsent(section, active.signal);
    active.on(section, "click", (e) => {
      const recover = e.target.closest?.("[data-mem-recover]");
      if (recover) openRecovery(recover.dataset.memRecover);
    });
    for (const type of ["input", "change"]) active.on(section, type, (e) => { if (!e.target.closest?.("[data-own-save]")) e.stopPropagation(); });
    if (!readMemory()) {
      loadMetadata();
      return;
    }
    bindDeliveries(section, ports, active);
    bindSave(section, async (current) => {
      const q = (sel) => section.querySelector(sel);
      const patch = {
        provider: q("#sp-mem-provider").value,
        filterMode: q("#sp-mem-filter").value,
      };
      const settings = {};
      let any = false;
      if (patch.provider === q("#sp-mem-provider").dataset.drawnFor) section.querySelectorAll("[data-mem-field]").forEach((input) => {
        const key = input.dataset.memField, kind = input.dataset.memKind;
        if (kind === "secret") { if (input.value.trim()) { settings[key] = input.value.trim(); any = true; } }
        else if (kind === "number") { settings[key] = Number(input.value); any = true; }
        else { settings[key] = input.value.trim(); any = true; }
      });
      if (any && patch.provider !== "off") patch.settings = settings;
      if (q("#sp-mem-f-url")) patch.filterBaseUrl = q("#sp-mem-f-url").value.trim();
      if (q("#sp-mem-f-model")) patch.filterModel = q("#sp-mem-f-model").value.trim();
      if (q("#sp-mem-f-form")) patch.filterForm = q("#sp-mem-f-form").value;
      if (q("#sp-mem-f-key") && q("#sp-mem-f-key").value.trim()) patch.filterApiKey = q("#sp-mem-f-key").value.trim();
      if (q("#sp-mem-block")) patch.blockChars = Number(q("#sp-mem-block").value);
      const res = await saveMemory(patch);
      onAccepted({ view: res.view, status: res.status });
      if (!current()) return false;
      if (res.verified && !res.verified.ok) showError(new Error(res.verified.reason || "The provider's key could not be verified."));
    });
    const filterSel = section.querySelector("#sp-mem-filter");
    if (filterSel) active.on(filterSel, "change", () => { for (const r of section.querySelectorAll("[data-mem-llm]")) r.hidden = filterSel.value !== "llm"; });
  }

  function bindDeliveries(section, ports, active) {
    const { readMemory, deliveries, deliveryAction, confirm: confirmDialog, onError } = ports;
    const { UI, row: settingRow } = ports.rows;
    const { memoryDeliveryRowHtml, memoryCleanupRowHtml, memoryVersionRowHtml, memoryBindingRowHtml } = createRows(ports.rows);
    const view = section.ownerDocument.defaultView;
    let serial = 0, pending = null;
    active.own(() => pending?.abort());
    const showError = error => { if (!active.disposed) onError(error); };
    const load = section.querySelector("#sp-mem-deliveries-load"), box = section.querySelector("#sp-mem-deliveries");
    if (!load || !box) return;
    const provider = readMemory().view.provider;
    let after = null, cleanupAfter = null, versionAfter = null, bindingAfter = null;
    const refresh = async (more = false, moreCleanups = false, moreVersions = false, moreBindings = false) => {
      if (active.disposed) return;
      pending?.abort();
      const controller = new view.AbortController(), stamp = ++serial;
      pending = controller;
      load.disabled = true;
      try {
        const result = await deliveries({ provider, after: more ? after : null,
          cleanupAfter: moreCleanups ? cleanupAfter : null, versionAfter: moreVersions ? versionAfter : null,
          bindingAfter: moreBindings ? bindingAfter : null }, { signal: controller.signal });
        if (active.disposed || controller.signal.aborted || stamp !== serial || !box.isConnected) return;
        const entries = result.entries.map(memoryDeliveryRowHtml).join("");
        const cleanups = result.cleanups.entries.map(memoryCleanupRowHtml).join("");
        const versions = (result.versions?.entries || []).map(memoryVersionRowHtml).join("");
        const bindings = (result.bindings?.entries || []).map(memoryBindingRowHtml).join("");
        const skipHints = { written_before_memory: "Written before remembering was enabled in this copy.",
          provider_cannot_check: "This provider cannot check imported messages; only messages written in this copy are sent.",
          imported_history: "Import keeps history local. New messages and local changes can update cloud memory." };
        const skips = (result.skippedVersions || []).map(row => settingRow({ label: `${row.roomId} · ${row.count} imported messages skipped`,
          hint: skipHints[row.reason] || "This imported message was left out of cloud memory." })).join("");
        const deletions = !more ? result.deletions.map(row => settingRow({ label: `Cloud deletion · ${row.room}`, hint: `${row.state}${row.reason ? ` · ${row.reason}` : ""}`, geek: `Graph: ${row.uuid}`, control: row.state === "failed" ? UI.raw(UI.html("button", { label: "Retry deletion", size: "sm", data: { deliveryAction: "retry-deletion", room: row.room, uuid: row.uuid } })) : undefined })).join("") : "";
        if (!moreCleanups && !moreVersions && !moreBindings) box.querySelector("[data-more-deliveries]")?.remove();
        if (!more && !moreVersions && !moreBindings) box.querySelector("[data-more-cleanups]")?.remove();
        if (moreVersions) box.querySelector("[data-more-versions]")?.remove();
        if (moreBindings) box.querySelector("[data-more-bindings]")?.remove();
        if (more || moreCleanups || moreVersions || moreBindings) box.insertAdjacentHTML("beforeend", moreCleanups ? cleanups : moreVersions ? versions : moreBindings ? bindings : entries);
        else box.innerHTML = deletions + cleanups + versions + bindings + skips + entries || '<p class="field-note">No recorded deliveries or pending deletions.</p>';
        if (!moreCleanups && !moreVersions && !moreBindings) {
          after = result.next;
          if (after) box.insertAdjacentHTML("beforeend", UI.html("button", { label: "More deliveries", size: "sm", data: { moreDeliveries: true } }));
        }
        if (!more && !moreVersions && !moreBindings) {
          cleanupAfter = result.cleanups.next;
          if (cleanupAfter) box.insertAdjacentHTML("beforeend", UI.html("button", { label: "More deletions and edits", size: "sm", data: { moreCleanups: true } }));
        }
        if ((!more && !moreCleanups && !moreBindings) || moreVersions) {
          versionAfter = result.versions?.next;
          if (versionAfter) box.insertAdjacentHTML("beforeend", UI.html("button", { label: "More imported messages", size: "sm", data: { moreVersions: true } }));
        }
        if ((!more && !moreCleanups && !moreVersions) || moreBindings) {
          bindingAfter = result.bindings?.next;
          if (bindingAfter) box.insertAdjacentHTML("beforeend", UI.html("button", { label: "More shared episodes", size: "sm", data: { moreBindings: true } }));
        }
      } catch (error) { if (stamp === serial && !controller.signal.aborted) showError(error); }
      finally { if (stamp === serial) { pending = null; if (!active.disposed) load.disabled = false; } }
    };
    active.on(load, "click", () => void refresh());
    active.on(box, "click", async event => {
      if (event.target.closest("[data-more-deliveries]")) { await refresh(true); return; }
      if (event.target.closest("[data-more-cleanups]")) { await refresh(false, true); return; }
      if (event.target.closest("[data-more-versions]")) { await refresh(false, false, true); return; }
      if (event.target.closest("[data-more-bindings]")) { await refresh(false, false, false, true); return; }
      const button = event.target.closest("[data-delivery-action]");
      if (!button) return;
      const action = button.dataset.deliveryAction;
      if (action === "replay" && !await confirmDialog("The previous request may still appear in the cloud. This permits one more paid attempt after a complete check and a ten-minute wait. A duplicate may require graph repair.", { title: "Authorize another memory attempt?", okLabel: "Authorize one attempt", danger: true })) return;
      if (active.disposed) return;
      button.disabled = true;
      try {
        await deliveryAction(action === "check-binding" ? { action, watchId: button.dataset.watch }
          : action === "check-version" ? { action, room: button.dataset.room, sourceId: button.dataset.source }
          : action === "retry-deletion" ? { action, provider, room: button.dataset.room, uuid: button.dataset.uuid }
          : action === "retry-cleanup" || action === "retry-replacement" ? { action, op: Number(button.dataset.op) }
          : { action, opId: button.dataset.op, attempt: Number(button.dataset.attempt), confirm: action === "replay" });
        if (!active.disposed) await refresh();
      } catch (error) { showError(error); if (!active.disposed) button.disabled = false; }
    });
  }

  function mount(section, ports) {
    if (!section?.ownerDocument || typeof ports?.readMemory !== "function" || typeof ports.saveMemory !== "function") throw new TypeError("A memory Settings root and domain actions are required");
    ports.signal?.throwIfAborted();
    const active = global.VIBEROOM_APP_LIFETIME.create({ window: section.ownerDocument.defaultView });
    const dispose = () => active.dispose();
    ports.signal?.addEventListener("abort", dispose, { once: true });
    active.own(() => ports.signal?.removeEventListener("abort", dispose));
    try { bind(section, ports, active); } catch (error) { dispose(); throw error; }
    return Object.freeze({ dispose });
  }
  Object.defineProperty(mount, "disposable", { value: true });
  Object.defineProperty(mount, "scoped", { value: true });
  global.VIBEROOM_MEMORY_SETTINGS = Object.freeze({ markup, roomsRow, createRows, mount,
    roomColumns: Object.freeze(MEMORY_ROOM_COLUMNS) });
})(globalThis);
