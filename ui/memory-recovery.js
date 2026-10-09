// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function () {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const details = (label, value) => `<details><summary>${esc(label)}</summary><pre>${esc(JSON.stringify(value, null, 2))}</pre></details>`;
  const button = (action, label, disabled = false) => `<button data-ui="button" data-kind="secondary" data-recovery-action="${action}"${disabled ? " disabled" : ""}>${esc(label)}</button>`;
  const PAGE = 20;
  const criteria = { assertion: "Claim matches the originals", validity_start_end_expiry: "Start, end and expiry match the evidence; unknown dates stay unknown",
    supporting_originals: "Originals support the claim", attributes: "Additional properties are supported", entity_identity: "The person or thing is identified correctly",
    summary: "The summary follows from the originals", labels_and_attributes: "Categories and properties are supported",
    support_not_proved_by_incident_edges: "Related facts alone do not prove the summary", coverage_and_omissions: "Relevant knowledge is covered, including omissions",
    contradictions_and_temporal_changes: "Contradictions and changes over time are represented", explicit_no_knowledge_if_applicable: "Any lack of extracted knowledge is explained",
    all_captured_impacts: "All recorded affected knowledge was checked", unknown_or_unscoped_impacts: "Effects with unknown origin were checked",
    excluded_source_residue: "Excluded originals leave no unsupported knowledge", no_old_new_uuid_equivalence: "Compare the meaning of old and new knowledge, not their identifiers" };
  const stateLabel = value => ({ prepared: "Awaiting budget approval", approved: "Budget approved", building: "Building", paused: "Paused",
    inputs_processed: "Ready for knowledge review", cancelled: "Cancelled" })[value] || value;
  async function open(roomId, ports = {}) {
    const dialog = document.createElement("dialog"); dialog.className = "dialog wide recovery-dialog";
    document.body.appendChild(dialog);
    let state = null, busy = false, stale = false, notice = "", itemPage = 0, sourcePage = 0;
    const decisions = new Map(), controller = new AbortController();
    const ask = ports.confirm || (text => window.confirm(text));
    const url = `/api/rooms/${encodeURIComponent(roomId)}/memory-recovery`;
    const request = async (body, after = "") => {
      const response = await fetch(url + (after ? `?after=${encodeURIComponent(after)}` : ""), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]),
        ...(body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || "Recovery action failed."); return value;
    };
    const dirty = () => decisions.size > 0 && state?.kind === "review";
    const close = async () => {
      if (dirty() && !await ask("Discard these unsaved review decisions?")) return;
      controller.abort(); if (ports.closeDialog) ports.closeDialog(dialog); else dialog.close(); dialog.remove();
    };
    dialog.addEventListener("cancel", event => { event.preventDefault(); void close(); });
    dialog.addEventListener("close", () => { controller.abort(); dialog.remove(); });
    const jobId = () => state?.job?.id || state?.report?.jobId || state?.receipt?.jobId || state?.preview?.jobId || state?.card?.jobId || state?.card?.preview?.jobId || state?.jobId;
    const switchId = () => state?.preparation?.id || state?.card?.switchId || state?.switch?.id || state?.switchId;
    const switchLabel = value => ({ prepared: "Prepared for activation", dispatched: "Request recorded; result unknown", waiting: "Awaiting confirmation",
      uncertain: "Write result uncertain", confirmed: "Candidate observed as active", superseded: "Another route was observed", blocked: "Publication blocked" })[value] || value;
    function sources() { return state?.sources?.sources || state?.report?.sources?.sources || []; }
    function originalName(source, index) { return `Original ${index + 1} · ${source.episode?.authorName || "Explicit fact"}${source.episode ? ` · ${new Date(source.episode.ts).toLocaleString()}` : ""}`; }
    function originals() {
      const list = sources(), start = sourcePage * PAGE;
      return `<section class="recovery-originals"><h4>Original sources (${list.length})</h4><p>Use these originals to check support, dates, contradictions and omissions.</p>${list.slice(start, start + PAGE).map((source, offset) => {
        const e = source.episode;
        return `<article class="recovery-original"><strong>${esc(originalName(source, start + offset))}</strong><pre>${esc(e ? e.text : JSON.stringify(source.fact, null, 2))}</pre>${details("Original identity", { id: source.sourceId, version: source.version })}</article>`;
      }).join("") || "<p>No eligible originals.</p>"}${pager("sources", sourcePage, list.length)}</section>`;
    }
    function sourceOptions(item, query = "", page = 0) {
      const d = decisions.get(item.id) || { sourceIds: [] }, required = new Set(item.sourceIds);
      const list = sources().map((source, index) => ({ source, index })).filter(({ source, index }) =>
        `${originalName(source, index)} ${source.episode?.text || JSON.stringify(source.fact)} ${source.sourceId}`.toLowerCase().includes(query.toLowerCase()));
      list.sort((a, b) => Number(required.has(b.source.sourceId)) - Number(required.has(a.source.sourceId)));
      const last = Math.max(0, Math.ceil(list.length / 10) - 1); page = Math.min(last, Math.max(0, page));
      return `<p><span data-selected-count>${d.sourceIds.length}</span> selected · ${item.sourceIds.length} linked originals to verify · ${list.length} matches</p>${list.slice(page * 10, page * 10 + 10).map(({ source, index }) =>
        `<label class="recovery-source-option"><input type="checkbox" data-original-id="${esc(source.sourceId)}"${d.sourceIds.includes(source.sourceId) ? " checked" : ""}><span>${esc(originalName(source, index))}${required.has(source.sourceId) ? " · linked" : ""}<small>${esc((source.episode?.text || JSON.stringify(source.fact)).slice(0, 240))}</small></span></label>`).join("") || "<p>No matching originals.</p>"}
        <div class="recovery-pages"><button data-ui="button" data-source-page="${page - 1}"${page === 0 ? " disabled" : ""}>Previous originals</button><span>${page + 1} / ${last + 1}</span><button data-ui="button" data-source-page="${page + 1}"${page >= last ? " disabled" : ""}>Next originals</button></div>`;
    }
    function pager(kind, page, total) {
      const pages = Math.max(1, Math.ceil(total / PAGE));
      return `<div class="recovery-pages">${button(`${kind}-previous`, "Previous", page === 0)}<span>Page ${page + 1} of ${pages}</span>${button(`${kind}-next`, "Next", page + 1 >= pages)}</div>`;
    }
    function complete() {
      const report = state?.report, sourceIds = new Set(sources().map(source => source.sourceId));
      return !!report && report.state === "review_required" && report.items.every(item => {
        const d = decisions.get(item.id);
        return d?.verdict === "accepted" && d.explanation.trim() && d.sourceIds.every(id => sourceIds.has(id))
          && new Set(d.sourceIds).size === d.sourceIds.length && item.sourceIds.every(id => d.sourceIds.includes(id)) && (item.kind !== "node" || d.sourceIds.length);
      });
    }
    function reviewItem(item) {
      const report = state.report, d = decisions.get(item.id) || { verdict: "unresolved", explanation: "", sourceIds: [] };
      const value = item.kind === "fact" ? report.knowledge.edges.find(e => `fact:${e.id}` === item.id)
        : item.kind === "node" ? report.knowledge.nodes.find(n => `node:${n.id}` === item.id)
        : item.kind === "source" ? report.sources.sources.find(s => `source:${s.sourceId}` === item.id)
        : { affected: report.repair, excludedOriginals: report.sources.excluded };
      const text = item.kind === "fact" ? value?.fact : item.kind === "node" ? `${value?.name || ""}: ${value?.summary || ""}`
        : item.kind === "source" ? "Check coverage, contradictions and missing knowledge from this original." : "Check all affected knowledge and excluded residue, including impacts with unknown origin.";
      const title = item.kind === "fact" ? "Fact" : item.kind === "node" ? "Person or thing" : item.kind === "source" ? `Original ${sources().findIndex(s => s.sourceId === value?.sourceId) + 1}` : "Affected knowledge";
      return `<article class="recovery-review-item" data-review-item="${esc(item.id)}"><h4>${esc(title)}</h4><p>${esc(text)}</p>
        ${item.kind === "fact" ? `<p>Starts: ${esc(value?.validAt ?? "Unknown")} · Ends: ${esc(value?.invalidAt ?? "Unknown")} · Expires: ${esc(value?.expiredAt ?? "Unknown")}</p>` : ""}
        <ul>${item.dimensions.map(key => `<li>${esc(criteria[key] || key.replaceAll("_", " "))}</li>`).join("")}</ul>
        ${item.kind === "source" ? `<pre>${esc(value?.episode?.text || JSON.stringify(value?.fact))}</pre>` : ""}
        ${details("Complete item contents", value)}
        <label>Decision<select data-decision="verdict"><option value="unresolved"${d.verdict === "unresolved" ? " selected" : ""}>Undecided</option><option value="accepted"${d.verdict === "accepted" ? " selected" : ""}>Accept</option><option value="rejected"${d.verdict === "rejected" ? " selected" : ""}>Reject</option></select></label>
        <details class="recovery-source-picker"><summary>Select the originals you checked</summary><label>Find an original<input data-original-query type="search" placeholder="Words, author or date"></label><div data-source-options>${sourceOptions(item)}</div></details>
        ${item.kind === "repair" ? `<label class="recovery-source-option"><input type="checkbox" data-all-originals${d.sourceIds.length === sources().length ? " checked" : ""}><span>I compared all ${sources().length} eligible originals for the affected knowledge.</span></label>` : ""}
        <label>Explain the support, dates and any omissions<textarea data-decision="explanation" maxlength="4000" rows="3">${esc(d.explanation)}</textarea></label></article>`;
    }
    function render() {
      let content = "";
      if (!state) content = "<p>Loading recovery…</p>";
      else if (state.kind === "jobs") content = `<p>Prepare a quotation from eligible originals, approve a budget, then review the rebuilt knowledge.</p>
        <label>Maximum credits for this rebuild<input data-recovery-limit type="number" min="1" step="1" placeholder="Choose a limit"></label>${button("prepare", "Prepare quotation")}
        <div class="recovery-jobs">${state.jobs.map(({ job, spent, switches, cancellable }) => `<article><strong>${esc(job.quote.roomName)}</strong> · ${esc(stateLabel(job.state))}<p>${esc(new Date(job.createdAt).toLocaleString())} · ${spent} / ${job.quote.maxCredits} credits reserved${job.reason ? ` · ${esc(job.reason.replaceAll("_", " "))}` : ""}</p>
          ${button(`job:${job.id}`, "Open quotation", job.state === "cancelled")}${job.state === "inputs_processed" ? button(`review:${job.id}`, "Review knowledge") : ""}${job.state !== "cancelled" && cancellable !== false ? button(`cancel:${job.id}`, "Cancel rebuild") : ""}
          ${(switches?.entries || []).map(sw => `<div><p>${esc(switchLabel(sw.state))} · ${esc(new Date(sw.createdAt).toLocaleString())}</p>${sw.state === "prepared" ? button(`activation:${job.id}:${sw.id}`, "Preview activation") : ""}${button(`check:${job.id}:${sw.id}`, "Check switch result")}${sw.state === "confirmed" ? button(`repair:${job.id}:${sw.id}`, "Review repair completion") : ""}${details("Switch identity", { id: sw.id, candidate: sw.wanted.graphId })}</div>`).join("")}${switches?.truncated ? "<p>Only the 50 newest plans are shown. Cancellation is unavailable while older records need review.</p>" : ""}</article>`).join("") || "<p>No rebuilds in this room.</p>"}</div>${state.next ? button(`jobs:${state.next}`, "Next rebuilds") : ""}`;
      else if (state.kind === "quote") {
        const job = state.job;
        content = `<h4>Build quotation</h4><p>${sources().length} originals · ${job.quote.items.length} inputs · ${job.quote.estimatedCredits} estimated credits</p>
          <p>Maximum for this rebuild: <strong>${job.quote.maxCredits} credits</strong>. Already reserved: ${state.spent}. Monthly use: ${state.usage.credits} / ${state.usage.cap || "Unlimited"} credits (${esc(state.usage.month)}).</p>
          <p>Approval applies to these originals and this limit. Building may use paid credits. The active memory stays in use while the candidate is reviewed.</p>
          ${button("approve-build", "Approve this budget", !!job.approval || stale)}${button("run-build", "Build / continue", !job.approval || stale || job.state === "inputs_processed")}
          ${job.state === "inputs_processed" ? button("review", "Review knowledge", stale) : ""}${details("Quotation identity", { jobId: job.id, fingerprint: job.quoteFingerprint, account: job.quote.scope.account, candidate: job.quote.graphId })}
          ${state.sources.excluded?.length ? details(`Excluded originals (${state.sources.excluded.length})`, state.sources.excluded) : ""}${originals()}`;
      } else if (state.kind === "job") content = `<h4>${esc(stateLabel(state.job.state))}</h4><p>${state.spent} credits reserved. ${esc((state.job.reason || "").replaceAll("_", " "))}</p><p>A processed input does not certify the resulting knowledge. An uncertain write is checked without automatically sending it again.</p>${button("quote", "Refresh quotation")}${state.job.state === "inputs_processed" ? button("review", "Review knowledge") : ""}`;
      else if (state.kind === "review") {
        const report = state.report;
        content = `<h4>Review recovered knowledge</h4>${report.state === "blocked" ? `<p>Review is blocked:</p><ul>${report.blockers.map(b => `<li>${esc(b.reason)} ${esc(b.externalId || b.sourceId || "")}</li>`).join("")}</ul>` :
          `<p>Every fact, node, original and repair context needs your explicit decision. A rejection or an undecided item prevents acceptance.</p><p data-review-count>${decisions.size} / ${report.items.length} items addressed.</p>
          ${report.items.slice(itemPage * PAGE, (itemPage + 1) * PAGE).map(reviewItem).join("")}${pager("items", itemPage, report.items.length)}
          ${button("accept-review", "Accept this reviewed knowledge", stale || !complete())}${state.purpose === "repair" ? "" : button("cancel", "Cancel this rebuild")}
          ${state.receipt ? "<p>A stored review matches this fresh observation. Record or discard any new decisions before continuing.</p>" + button(state.purpose === "repair" ? "repair-preview" : "switch-preview", state.purpose === "repair" ? "Preview repair completion" : "Preview switch preparation", stale || dirty()) : ""}`}${details("Review identity", { fingerprint: report.fingerprint, jobId: report.jobId })}${originals()}`;
      } else if (state.kind === "review-receipt") content = `<p>Your review is recorded for these exact contents. It does not activate the rebuilt memory or complete repair.</p>${button(state.purpose === "repair" ? "repair-preview" : "switch-preview", state.purpose === "repair" ? "Preview repair completion" : "Preview switch preparation")}`;
      else if (state.kind === "switch") content = `<h4>Prepare a switch</h4><p>The current originals and knowledge still match your review. Preparing records a local plan. Activation is a separate step.</p>
        <p>The prepared plan names this room's current memory and the exact rebuild you reviewed.</p>${details("Preparation identity", state.preview)}${button("prepare-switch", "Approve preparation", stale)}`;
      else if (state.kind === "switch-prepared") content = `<p>Switch preparation saved. The active memory has not changed.</p>${button("activation-preview", "Preview activation", stale)}${details("Prepared switch", state.preparation)}`;
      else if (state.kind === "activation") content = `<h4>Activate reviewed memory</h4><p><strong>${esc(state.card.roomName)}</strong> · Rebuild prepared ${esc(new Date(state.card.createdAt).toLocaleString())}</p><p>The originals and rebuilt knowledge still match your review. Activation changes this room's shared memory pointer to this exact candidate.</p>
        <p>Other copies will follow the shared pointer when they refresh. A later publication from another copy can change it again. The previous graph is retained.</p>
        <p>Existing repair safeguards remain in effect and may still hide facts. Outstanding forgetting is not completed by activation.</p>
        <p>This approval permits one publication attempt. A lost response is checked without sending it again.</p>${details("Activation identity", state.card)}${button("activate-switch", "Approve and activate this candidate", stale)}`;
      else if (state.kind === "switch-result") content = `<h4>${esc(switchLabel(state.switch.state))}</h4>
        <p>${["waiting", "uncertain", "dispatched"].includes(state.switch.state) ? "The recorded request needs a fresh pointer check after the settling pause. Checking never resends it." : state.switch.state === "confirmed" ? "A pointer read named this candidate. This is an observation; another copy can change the route later." : state.switch.state === "superseded" ? "The pointer check named a different route. The recorded attempt will not be resent; a delayed request may still arrive." : "This plan has not been published."}</p>
        ${state.switch.state === "confirmed" ? `<p>${state.applied ? "This copy has followed the observed candidate." : "This candidate is not applied as this copy's current route."}</p>` : ""}
        <p>${state.repairCovered ? "Repair coverage is recorded for this current generation." : "Repair completion has not been confirmed for this current generation."} The old graph and outstanding deletion promises remain.</p>${state.switch.state === "confirmed" && state.applied ? button("repair-review", "Review repair completion") : ""}${button("check-switch", "Check switch result")}${details("Recorded switch and observed route", state)}`;
      else if (state.kind === "repair") content = `<h4>Complete repair for active memory</h4><p><strong>${esc(state.card.roomName)}</strong> · Rebuild prepared ${esc(new Date(state.card.createdAt).toLocaleString())}</p>
        <p>Fresh complete reads of the originals and active rebuilt knowledge match your accepted review: ${state.card.originals} originals, ${state.card.facts} facts, ${state.card.nodes} people or things.</p>
        <p>Completing records local repair coverage for this exact account and active generation. Its checked facts and summaries can then be used without the old repair warning. A new repair or route change invalidates this coverage.</p>
        <p>The old graph, affected-artifact records and outstanding deletion promises are retained. Physical forgetting remains unfinished. This action sends no paid input, switches no pointer and deletes no graph.</p>
        ${details("Completion identity", state.card)}${button("complete-repair", "Approve and complete this repair", stale)}${button("repair-review", "Read current knowledge")}`;
      else if (state.kind === "repair-result") content = `<h4>Repair coverage recorded</h4><p>Coverage was recorded for the verified active generation. It remains valid only while its route and repair context match.</p><p>The old graph and outstanding deletion promises remain. Physical forgetting is unfinished.</p>${button("check-switch", "Check current coverage")}${button("repair-review", "Read current knowledge")}${details("Local repair receipt", state.receipt)}`;
      dialog.innerHTML = `<div class="memory-heading"><h3>Recover room memory</h3><button data-ui="button" data-kind="ghost" data-recovery-close>Close</button></div>
        <p class="recovery-feedback${stale ? " error" : ""}" role="status">${esc(busy ? "Working…" : notice)}</p><div class="recovery-content">${content}</div><div class="actions">${button("list", "Rebuilds")}${state && state.kind !== "jobs" && state.kind !== "switch-prepared" ? button("refresh", "Read fresh contents") : ""}</div>`;
      if (busy) dialog.querySelectorAll("button, input, select, textarea").forEach(control => { if (!control.hasAttribute("data-recovery-close")) control.disabled = true; });
    }
    async function act(body, after) {
      busy = true; notice = ""; render();
      try { const next = await request(body, after); if (controller.signal.aborted) return; state = next; stale = false; decisions.clear(); itemPage = sourcePage = 0; }
      catch (error) { if (!controller.signal.aborted) { notice = error.message; stale = true; } }
      finally { busy = false; if (!controller.signal.aborted) render(); }
    }
    dialog.addEventListener("input", event => {
      const article = event.target.closest("[data-review-item]"); if (!article || busy) return;
      const item = state.report.items.find(item => item.id === article.dataset.reviewItem);
      if (event.target.hasAttribute("data-original-query")) { article.querySelector("[data-source-options]").innerHTML = sourceOptions(item, event.target.value); return; }
      let sourceIds = [...decisions.get(item.id)?.sourceIds || []];
      if (event.target.hasAttribute("data-original-id")) sourceIds = event.target.checked ? [...new Set([...sourceIds, event.target.dataset.originalId])] : sourceIds.filter(id => id !== event.target.dataset.originalId);
      if (event.target.hasAttribute("data-all-originals")) sourceIds = event.target.checked ? sources().map(s => s.sourceId) : [];
      decisions.set(article.dataset.reviewItem, { id: article.dataset.reviewItem, verdict: article.querySelector('[data-decision="verdict"]').value,
        explanation: article.querySelector('[data-decision="explanation"]').value,
        sourceIds });
      const all = article.querySelector("[data-all-originals]"); if (all) all.checked = sourceIds.length === sources().length;
      article.querySelector("[data-selected-count]").textContent = sourceIds.length;
      if (event.target.hasAttribute("data-all-originals")) article.querySelectorAll("[data-original-id]").forEach(check => { check.checked = sourceIds.includes(check.dataset.originalId); });
      const save = dialog.querySelector('[data-recovery-action="accept-review"]'); if (save) save.disabled = stale || !complete();
      const preview = dialog.querySelector('[data-recovery-action="switch-preview"], [data-recovery-action="repair-preview"]'); if (preview) preview.disabled = stale || dirty();
      const count = dialog.querySelector("[data-review-count]"); if (count) count.textContent = `${decisions.size} / ${state.report.items.length} items addressed.`;
    });
    dialog.addEventListener("click", async event => {
      const target = event.target.closest("button"); if (!target || target.disabled) return;
      if (target.hasAttribute("data-recovery-close")) return close(); if (busy) return;
      if (target.hasAttribute("data-source-page")) {
        const article = target.closest("[data-review-item]"), item = state.report.items.find(item => item.id === article.dataset.reviewItem);
        article.querySelector("[data-source-options]").innerHTML = sourceOptions(item, article.querySelector("[data-original-query]").value, Number(target.dataset.sourcePage)); return;
      }
      let action = target.dataset.recoveryAction, id = jobId(); if (!action) return;
      if (/^(sources|items)-(previous|next)$/.test(action)) { const step = action.endsWith("next") ? 1 : -1; if (action.startsWith("sources")) sourcePage += step; else itemPage += step; render(); return; }
      if (action === "refresh") action = state.kind === "review" ? (state.purpose === "repair" ? "repair-review" : "review") : state.kind === "switch" ? "switch-preview" : state.kind === "activation" ? "activation-preview" : ["switch-result", "repair-result"].includes(state.kind) ? "check-switch" : state.kind === "repair" ? "repair-preview" : "quote";
      if (action === "accept-review" && state.purpose === "repair") action = "accept-repair-review";
      if (dirty() && !["accept-review", "accept-repair-review", "cancel"].includes(action) && !await ask("Discard these unsaved review decisions and read fresh contents?")) return;
      if (action === "list") return act();
      if (action.startsWith("jobs:")) return act(undefined, action.slice(5));
      if (action === "prepare") { const cap = Number(dialog.querySelector("[data-recovery-limit]").value); if (!Number.isSafeInteger(cap) || cap < 1) { notice = "Choose a positive integer credit limit."; render(); return; } return act({ action, maxCredits: cap }); }
      if (action.startsWith("job:")) { id = action.slice(4); action = "quote"; }
      if (action.startsWith("review:")) { id = action.slice(7); action = "review"; }
      if (action.startsWith("cancel:")) { id = action.slice(7); action = "cancel"; }
      const body = { action, jobId: id };
      if (action.startsWith("activation:") || action.startsWith("check:") || action.startsWith("repair:")) {
        const [kind, job, sw] = action.split(":"); body.action = kind === "activation" ? "activation-preview" : kind === "repair" ? "repair-review" : "check-switch"; body.jobId = job; body.switchId = sw;
      } else if (["activation-preview", "activate-switch", "check-switch", "repair-review", "accept-repair-review", "repair-preview", "complete-repair"].includes(action)) body.switchId = switchId();
      if (["approve-build", "accept-review", "accept-repair-review", "prepare-switch", "activate-switch", "complete-repair", "cancel"].includes(action)) {
        const message = action === "approve-build" ? `Approve up to ${state.job.quote.maxCredits} credits for these exact originals?` : ["accept-review", "accept-repair-review"].includes(action) ? "Record all these supported decisions for the displayed knowledge?" : action === "prepare-switch" ? "Approve local switch preparation for this reviewed candidate?" : action === "activate-switch" ? "Activate this exact reviewed candidate for the room and its other copies? The previous graph is retained." : action === "complete-repair" ? "Complete local repair for this exact verified active generation? The old graph and outstanding deletion promises remain; physical forgetting is unfinished." : "Cancel this rebuild? Reserved credits remain accounted for; the cloud candidate is not deleted.";
        if (!await ask(message)) return; body.confirm = true;
        if (action !== "cancel") body.fingerprint = action === "approve-build" ? state.job.quoteFingerprint : ["accept-review", "accept-repair-review"].includes(action) ? state.report.fingerprint : ["activate-switch", "complete-repair"].includes(action) ? state.card.fingerprint : state.preview.fingerprint;
        if (["accept-review", "accept-repair-review"].includes(action)) body.decisions = state.report.items.map(item => decisions.get(item.id));
      }
      return act(body);
    });
    render(); if (ports.openDialog) ports.openDialog(dialog); else dialog.showModal(); await act();
    return dialog;
  }
  window.ViberoomRecovery = { open };
})();
