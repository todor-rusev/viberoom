// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function () {
  "use strict";
  const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const icon = name => window.Icons.svg(name);
  const actionIcons = { new: "plus", refresh: "refresh", edit: "pencil", toggle: "pause", run: "play", delete: "trash", apply: "check", reject: "close", preview: "clock", "proposal-preview": "clock", result: "chat", cancel: "stop", back: "back", close: "close" };
  const button = (label, action, id = "", kind = "ghost") => `<button type="button" data-ui="button" data-size="sm" data-kind="${kind}" data-auto="${action}" data-id="${esc(id)}">${actionIcons[action] ? icon(action === "toggle" && label === "Enable" ? "play" : actionIcons[action]) : ""}<span>${esc(label)}</span></button>`;
  const art = () => `<div class="auto-art" aria-hidden="true">${window.Icons.scene("automation")}</div>`;
  const fields = ["name", "action", "text", "targetId", "schedule", "enabled", "catchUp", "wakeOffline", "maxMinutes"];
  const definition = job => Object.fromEntries(fields.map(key => [key, job[key]]));
  function describe(schedule) {
    if (schedule.kind === "once") return `Once · ${new Date(schedule.at).toLocaleString()}`;
    if (schedule.kind === "interval") return `Every ${schedule.minutes} minute${schedule.minutes === 1 ? "" : "s"}`;
    if (schedule.kind === "cron") {
      const parts = /^(\d+) (\d+) \* \* (\*|1-5|[0-6])$/.exec(schedule.expression);
      if (!parts) return `${schedule.expression} · ${schedule.timeZone}`;
      const day = parts[3] === "*" ? "Daily" : parts[3] === "1-5" ? "Weekdays" : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(parts[3])];
      return `${day} at ${parts[2].padStart(2, "0")}:${parts[1].padStart(2, "0")} · ${schedule.timeZone}`;
    }
    return schedule.event === "room-start" ? "When viberoom starts" : `First human message of the day · ${schedule.timeZone}`;
  }
  const time = at => at == null ? "—" : new Date(at).toLocaleString();
  function delivery(run) {
    if (run.messageId) return button(run.job.action === "reminder" ? "Show reminder" : "Read result", "result", run.messageId);
    if (run.delivery === "unconfirmed") return '<p class="error">Result delivery is unconfirmed. Review the conversation before retrying.</p>';
    if (run.delivery === "silent") return '<p class="hint">No written reply (the vibemate stayed silent).</p>';
    return "";
  }
  let refreshOpen = null;
  async function open(roomId, jumpToMessage, confirmAction) {
    if (!roomId || refreshOpen) return;
    const dialog = document.createElement("dialog"); dialog.className = "dialog wide automations-dialog";
    dialog.setAttribute("aria-label", "Room automations");
    dialog.innerHTML = `<header class="auto-heading"><div><span class="auto-eyebrow">A little help, right on time</span><h3>Automations</h3></div>${button("Close", "close")}</header>
      <div class="auto-intro">${art()}<div><p class="auto-intro-title">Give the room a rhythm.</p><p>A gentle nudge, or a task for your vibemate. You choose what happens and when.</p><p class="auto-availability">${icon("info")} Keep the computer awake and viberoom running. This window can be closed.</p></div></div>
      <p data-auto-feedback role="status">Loading…</p><div data-auto-content></div>`;
    document.body.appendChild(dialog); dialog.showModal();
    const controller = new AbortController();
    let state, editing = null, dirty = false, busy = false, confirming = false, reading = null, reloadAgain = false, rendered = "";
    const feedback = (message, error = false) => { const node = dialog.querySelector("[data-auto-feedback]"); node.textContent = message; node.hidden = !message; node.classList.toggle("error", error); };
    const request = async (action, body) => {
      let response, value;
      try { response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/automations${action ? "/" + action : ""}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
        ...(action ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      }); value = await response.json(); }
      catch (error) { if (action && action !== "preview") throw new Error("No confirmation was received. The change may have been applied. Refresh and review the saved tasks and history before trying again."); throw error; }
      if (!response.ok) throw new Error(value.error || "The automation request could not be confirmed."); return value;
    };
    async function ask(text, options) {
      if (confirming) return false;
      const opener = document.activeElement, action = opener?.dataset.auto, id = opener?.dataset.id;
      confirming = true;
      try { return await confirmAction(text, options); }
      finally {
        confirming = false;
        const restored = opener?.isConnected ? opener : [...dialog.querySelectorAll("[data-auto]")].find(node => node.dataset.auto === action && node.dataset.id === id);
        restored?.focus({ preventScroll: true });
      }
    }
    const discard = () => ask("Your saved automation stays as it is. The edits in this form will be discarded.", { title: "Leave these edits behind?", okLabel: "Discard edits", cancelLabel: "Keep editing", primary: "cancel" });
    async function close() {
      if (busy || confirming || dirty && !await discard()) return false;
      controller.abort(); refreshOpen = null; dialog.close(); dialog.remove(); return true;
    }
    dialog.addEventListener("cancel", event => { event.preventDefault(); void close().catch(error => feedback(error.message, true)); });
    function recipient(job) { return job.action === "reminder" ? "Reminder · no agent" : state.participants.find(p => p.id === job.targetId)?.name || "Recipient no longer in room"; }
    function summary(job) {
      return `<p>${esc(recipient(job))} · ${esc(describe(job.schedule))}</p><p class="auto-instructions">${esc(job.text)}</p><p class="hint">${job.enabled ? "Enabled" : "Disabled"} · Missed times: ${job.catchUp === "once" ? "run once" : "skip"}${job.action === "agent" ? ` · Limit: ${job.maxMinutes} min · Wake offline: ${job.wakeOffline ? "yes" : "no"}` : ""}</p>`;
    }
    function render() {
      if (editing) return;
      const content = dialog.querySelector("[data-auto-content]");
      const fingerprint = JSON.stringify([state.available, state.error, state.jobs, state.runs, state.proposals, state.participants]);
      if (rendered === fingerprint) return;
      rendered = fingerprint;
      const expanded = [...content.querySelectorAll("details[open][data-auto-details]")].map(node => node.dataset.autoDetails);
      const oldScroll = dialog.scrollTop, edge = dialog.getBoundingClientRect().top;
      const anchor = [...content.querySelectorAll("[data-auto-card]")].find(node => node.getBoundingClientRect().bottom > edge + 30);
      const anchorKey = anchor?.dataset.autoCard, anchorTop = anchor?.getBoundingClientRect().top;
      const focused = content.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = focused?.dataset.auto, focusId = focused?.dataset.id;
      if (!state.available) { content.textContent = state.error || "Automations are unavailable."; return; }
      content.innerHTML = `<div class="auto-toolbar auto-main-actions">${button("New automation", "new", "", "primary")}<span class="auto-totals">${state.jobs.filter(job => job.enabled).length} enabled · ${state.jobs.filter(job => !job.enabled).length} paused</span>${button("Refresh", "refresh")}</div>
        <section data-auto-proposals>${state.proposals.length ? `<h4 class="auto-section-title">${icon("spark")} A suggestion for you <span>${state.proposals.length}</span></h4>` : ""}${state.proposals.map(p => `<article class="auto-card auto-proposal" data-auto-card="proposal-${esc(p.id)}"><div class="auto-card-heading"><span class="auto-mark">${icon("spark")}</span><h4>${esc(p.definition.name)}</h4><span class="auto-status" data-tone="waiting">For review</span></div><p>${esc(p.by)}: ${esc(p.why)}</p>${summary(p.definition)}${p.jobId ? `<p class="hint">Replaces revision ${p.expectedRevision} of an existing automation.</p>` : ""}<div class="auto-toolbar">${button("Apply", "apply", p.id, "primary")}${button("Preview times", "proposal-preview", p.id)}${button("Reject", "reject", p.id)}</div></article>`).join("")}</section>
        <h4 class="auto-section-title">${icon("automation")} Your automations <span>${state.jobs.length}</span></h4>${state.jobs.length ? `<div class="auto-jobs">${state.jobs.map(job => {
          const onceDone = job.schedule.kind === "once" && job.nextAt === null;
          return `<article class="auto-card" data-auto-card="job-${esc(job.id)}"><div class="auto-card-heading"><span class="auto-mark" data-action="${esc(job.action)}">${icon(job.action === "reminder" ? "bell" : "user")}</span><h4>${esc(job.name)}</h4><span class="auto-status" data-tone="${onceDone ? "completed" : job.enabled ? "enabled" : "paused"}">${onceDone ? "Schedule finished" : job.enabled ? "Enabled" : "Paused"}</span></div><p class="auto-recipient">${esc(recipient(job))}</p><p class="auto-schedule">${icon("clock")} ${esc(describe(job.schedule))}</p><p class="auto-next">Next <strong>${job.enabled && job.nextAt ? esc(time(job.nextAt)) : job.schedule.kind === "event" && job.enabled ? "When the event occurs" : "—"}</strong></p><details data-auto-details="job-${esc(job.id)}"><summary>Instructions and options</summary>${summary(job)}</details><div class="auto-toolbar">${button("Run now", "run", job.id, "soft")}${button("Edit", "edit", job.id)}${button(job.enabled ? "Pause" : "Enable", "toggle", job.id)}${button("Delete", "delete", job.id, "danger-quiet")}</div></article>`;
        }).join("")}</div>` : `<div class="auto-empty"><span class="auto-empty-icon">${icon("bell")}</span><div><h4>Make a little room for routine.</h4><p>Start with a reminder. Or give one vibemate a task to return to.</p></div></div>`}
        <h4 class="auto-section-title">${icon("refresh")} Run history <span>${state.runs.length}</span></h4><p class="hint auto-history-hint">Reminders post a note without waking a vibemate. For tasks, read the reply to check the result.</p>
        ${state.runs.length ? `<div class="auto-runs">${state.runs.map(run => `<article class="auto-card auto-run" data-auto-card="run-${esc(run.id)}"><div class="auto-card-heading"><span class="auto-mark">${icon(run.status === "completed" ? "check" : ["failed", "interrupted"].includes(run.status) ? "alert" : "clock")}</span><h4>${esc(run.job.name)}</h4><span class="auto-status" data-tone="${esc(run.status)}">${run.stopping ? "Stopping…" : esc(run.status)}</span></div><p class="hint">${esc(time(run.scheduledAt))} · ${esc(run.source)}${run.coalescedThrough ? ` · Combined through ${esc(time(run.coalescedThrough))}` : ""}</p><p>${esc(run.detail)}</p><details data-auto-details="run-${esc(run.id)}"><summary>Instructions for this run</summary>${summary(run.job)}</details><div class="auto-toolbar">${delivery(run)}${["waiting", "running"].includes(run.status) && !run.stopping ? button(run.status === "waiting" ? "Cancel run" : "Stop run", "cancel", run.id) : ""}</div></article>`).join("")}</div>` : `<div class="auto-empty auto-empty-small">${icon("chat")}<p>No runs yet. The first one gets a spot here.</p></div>`}
        <details class="auto-ground-rules" data-auto-details="ground-rules"><summary>${icon("info")} How scheduled work behaves</summary><p>One task runs per room. Waiting work respects Hush, mute and existing permissions. Interrupted runs need review before a manual retry.</p></details>`;
      for (const node of content.querySelectorAll("[data-auto-details]")) node.open = expanded.includes(node.dataset.autoDetails);
      const replacement = anchorKey && [...content.querySelectorAll("[data-auto-card]")].find(node => node.dataset.autoCard === anchorKey);
      dialog.scrollTop = oldScroll + (replacement ? replacement.getBoundingClientRect().top - anchorTop : 0);
      if (focusKey) [...content.querySelectorAll("[data-auto]")].find(node => node.dataset.auto === focusKey && node.dataset.id === focusId)?.focus({ preventScroll: true });
      if (state.error) feedback(state.error, true);
    }
    async function refresh() {
      if (reading) { reloadAgain = true; return reading; }
      reading = (async () => {
        do {
          reloadAgain = false;
          state = await request();
          if (controller.signal.aborted) return;
          render();
        } while (reloadAgain && !controller.signal.aborted);
      })();
      try { await reading; } catch (error) { if (!controller.signal.aborted) feedback(error.message, true); }
      finally { reading = null; }
    }
    refreshOpen = refresh;
    function edit(job) {
      rendered = "";
      editing = job || { id: null, revision: null };
      const schedule = job?.schedule || { kind: "cron", expression: "0 9 * * *", timeZone: state.timeZone };
      const local = new Date(schedule.kind === "once" ? schedule.at : Date.now() + 3600000);
      const localText = new Date(local.getTime() - local.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      dialog.classList.add("auto-editing");
      dialog.querySelector("[data-auto-content]").innerHTML = `<form data-auto-form><h4 class="auto-section-title">${icon(job ? "pencil" : "spark")}${job ? "Edit automation" : "A new little routine"}</h4>
        <fieldset class="auto-form-section"><legend><span>1</span> What should happen?</legend>
        <label>Name<input name="name" maxlength="100" required value="${esc(job?.name || "")}" placeholder="Daily dependency check"></label>
        <div class="auto-field-row">
        <label>Action<select name="action"><option value="reminder">Reminder · no agent</option><option value="agent"${job?.action === "agent" ? " selected" : ""}>Task for one vibemate</option></select></label>
        <label data-agent-only>Vibemate<select name="targetId"><option value="">Choose a vibemate</option>${state.participants.map(p => `<option value="${esc(p.id)}"${job?.targetId === p.id ? " selected" : ""}>${esc(p.name)} · ${esc(p.muted ? "muted" : p.status)}</option>`).join("")}</select></label>
        </div>
        <p class="hint" data-action-hint></p>
        <label>Instructions<textarea name="text" rows="5" maxlength="8000" required placeholder="What should happen, and what result should be reported?">${esc(job?.text || "")}</textarea></label>
        </fieldset><fieldset class="auto-form-section"><legend><span>2</span> When is a good time?</legend>
        <label>Trigger<select name="kind">${[["once", "Once"], ["interval", "Every N minutes"], ["daily", "Daily"], ["weekdays", "Weekdays"], ["weekly", "Weekly"], ["cron", "Advanced cron"], ["first-human-message", "First human message of the day"], ["room-start", "When viberoom starts"]].map(([key, label]) => `<option value="${key}"${(schedule.kind === "event" ? schedule.event : schedule.kind) === key ? " selected" : ""}>${label}</option>`).join("")}</select></label>
        <label data-schedule="once">Date and time · ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}<input name="at" type="datetime-local" value="${localText}"><span class="hint">Uses this browser's time zone. Preview shows the exact UTC offset.</span></label>
        <label data-schedule="interval">Interval in minutes<input name="minutes" type="number" min="1" max="525600" step="1" value="${schedule.minutes || 60}"></label>
        <label data-schedule="daily weekdays weekly">Time<input name="time" type="time" value="09:00"></label>
        <label data-schedule="weekly">Day<select name="weekday">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => `<option value="${index}">${day}</option>`).join("")}</select></label>
        <label data-schedule="cron">Five-field cron<input name="expression" maxlength="120" value="${esc(schedule.expression || "0 9 * * *")}" placeholder="0 9 * * 1-5"><span class="hint">Minute · hour · day of month · month · weekday. Calendar times follow the named zone, including daylight saving.</span></label>
        <label data-schedule="daily weekdays weekly cron first-human-message">Time zone<input name="timeZone" maxlength="100" list="automation-zones" value="${esc(schedule.timeZone || state.timeZone)}"><datalist id="automation-zones">${(Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : [state.timeZone, "UTC"]).map(zone => `<option value="${esc(zone)}">`).join("")}</datalist></label>
        <div class="auto-toolbar">${button("Preview next times", "preview")}</div><p data-auto-preview role="status"></p>
        </fieldset><fieldset class="auto-form-section"><legend><span>3</span> A few ground rules</legend>
        <label>If the scheduled time was missed<select name="catchUp"><option value="once">Run once when available · combine missed times</option><option value="skip"${job?.catchUp === "skip" ? " selected" : ""}>Skip if more than one minute late</option></select></label>
        <div data-agent-only><label>Time limit per run · minutes<input name="maxMinutes" type="number" min="1" max="1440" value="${job?.maxMinutes || 30}"></label><label class="carry-check"><input name="wakeOffline" type="checkbox"${job?.wakeOffline ? " checked" : ""}>Wake this vibemate if offline</label><p class="hint">Uses this room's existing session, workspace and permissions. Muted, stopped or unavailable vibemates wait for you. Scheduled work can use paid model calls.</p></div>
        <label class="carry-check"><input name="enabled" type="checkbox"${job?.enabled === false ? "" : " checked"}>Enabled</label>
        </fieldset><div class="auto-toolbar auto-form-actions">${button("Back", "back")}<button type="submit" data-ui="button" data-kind="primary">${icon("check")} Save automation</button></div></form>`;
      dirty = false; reveal(); feedback("");
      dialog.querySelector('[name="name"]').focus();
    }
    function reveal() {
      const form = dialog.querySelector("form"); if (!form) return;
      const kind = form.elements.kind.value, agent = form.elements.action.value === "agent";
      form.querySelector("[data-action-hint]").textContent = agent ? "The selected vibemate receives these instructions and replies in the room." : "This only posts a note in the room. To get an answer or have work done, choose Task for one vibemate.";
      for (const node of form.querySelectorAll("[data-schedule]")) node.hidden = !node.dataset.schedule.split(" ").includes(kind);
      for (const node of form.querySelectorAll("[data-agent-only]")) node.hidden = !agent;
    }
    function scheduleFromForm() {
      const form = dialog.querySelector("form"), values = form.elements, kind = values.kind.value, zone = values.timeZone.value;
      if (kind === "once") {
        const date = new Date(values.at.value);
        if (!Number.isFinite(date.getTime())) throw new Error("Choose a valid date and time.");
        const normalized = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        if (normalized !== values.at.value) throw new Error("This local time does not exist because the clock changes. Choose another time.");
        return { kind, at: date.getTime() };
      }
      if (kind === "interval") return { kind, minutes: Number(values.minutes.value) };
      if (["first-human-message", "room-start"].includes(kind)) return { kind: "event", event: kind, timeZone: zone || state.timeZone };
      if (kind === "cron") return { kind, expression: values.expression.value, timeZone: zone };
      const [hour, minute] = values.time.value.split(":").map(Number);
      if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error("Choose a time.");
      return { kind: "cron", expression: `${minute} ${hour} * * ${kind === "weekdays" ? "1-5" : kind === "weekly" ? values.weekday.value : "*"}`, timeZone: zone };
    }
    function take() {
      const v = dialog.querySelector("form").elements, agent = v.action.value === "agent";
      return { name: v.name.value, action: v.action.value, text: v.text.value, targetId: agent ? v.targetId.value : null,
        schedule: scheduleFromForm(), enabled: v.enabled.checked, catchUp: v.catchUp.value, wakeOffline: agent && v.wakeOffline.checked, maxMinutes: agent ? Number(v.maxMinutes.value) : 30 };
    }
    function previewText(result) {
      return result.times.length ? result.times.map(at => new Date(at).toLocaleString(undefined, { timeZone: result.schedule.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone, timeZoneName: "longOffset" })).join(" · ") : describe(result.schedule);
    }
    async function mutate(action, body) {
      busy = true; dialog.setAttribute("aria-busy", "true");
      for (const control of dialog.querySelectorAll("button, input, textarea, select")) control.disabled = true;
      try { return await request(action, body); }
      finally { busy = false; dialog.removeAttribute("aria-busy"); for (const control of dialog.querySelectorAll("button, input, textarea, select")) control.disabled = false; }
    }
    dialog.addEventListener("input", () => { if (editing) { dirty = true; reveal(); } });
    dialog.addEventListener("change", reveal);
    dialog.addEventListener("submit", async event => {
      event.preventDefault(); if (busy || confirming) return;
      try {
        await mutate("save", { definition: take(), ...(editing.id ? { id: editing.id, revision: editing.revision } : {}) });
        editing = null; dirty = false; dialog.classList.remove("auto-editing"); await refresh(); feedback("Automation saved. Your room has a new rhythm.");
      } catch (error) { feedback(error.message, true); }
    });
    dialog.addEventListener("click", async event => {
      const control = event.target.closest("[data-auto]"); if (!control || busy || confirming) return;
      const action = control.dataset.auto, id = control.dataset.id;
      try {
        if (action === "close") return await close();
        if (action === "new") return edit();
        if (action === "edit") return edit(state.jobs.find(job => job.id === id));
        if (action === "back") { if (dirty && !await discard()) return; editing = null; dirty = false; dialog.classList.remove("auto-editing"); await refresh(); feedback(""); return; }
        if (action === "refresh") { await refresh(); return; }
        if (action === "preview") { const result = await mutate("preview", { schedule: scheduleFromForm() }); dialog.querySelector("[data-auto-preview]").textContent = previewText(result); return; }
        if (action === "proposal-preview") { const p = state.proposals.find(p => p.id === id); feedback(previewText(await mutate("preview", { schedule: p.definition.schedule }))); return; }
        if (action === "result") { if (await close()) await jumpToMessage?.(id); return; }
        if (action === "toggle") { const job = state.jobs.find(job => job.id === id); await mutate("save", { id, revision: job.revision, definition: { ...definition(job), enabled: !job.enabled } }); }
        else if (action === "apply" || action === "reject") await mutate("resolve", { id, apply: action === "apply" });
        else if (action === "delete") {
          const job = state.jobs.find(job => job.id === id), revision = job.revision;
          if (!await ask("Its history stays here. If a task is already running, use Stop run to stop it separately.", { title: `Delete “${job.name}”?`, okLabel: "Delete automation", primary: "cancel", danger: true })) return;
          await mutate("delete", { id, revision });
        }
        else if (action === "run") {
          const job = state.jobs.find(job => job.id === id), revision = job.revision;
          if (!await ask(`Run this ${job.action === "reminder" ? "reminder" : "task"} once now. Its schedule stays as it is.`, { title: `Give “${job.name}” a go?`, okLabel: "Run now", extraHtml: `<div class="auto-confirm-preview"><span class="auto-mark">${icon(job.action === "reminder" ? "bell" : "user")}</span><div><strong>${esc(recipient(job))}</strong><p>${esc(job.text)}</p></div></div>` })) return;
          await mutate("run", { id, revision });
        }
        else if (action === "cancel") await mutate("cancel", { id });
        await refresh(); feedback("");
      } catch (error) { feedback(error.message, true); }
    });
    await refresh(); if (!state?.error) feedback("");
  }
  window.ViberoomAutomations = { open, refresh: () => refreshOpen?.(), describe };
})();
