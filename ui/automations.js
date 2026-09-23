// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function () {
  "use strict";
  const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const icon = name => window.Icons.svg(name);
  const actionIcons = { new: "plus", refresh: "refresh", edit: "pencil", run: "play", delete: "trash", apply: "check", reject: "close", result: "chat", cancel: "stop", close: "close", earlier: "chevrons-down" };
  const button = (label, action, id = "", kind = "ghost") => `<button type="button" data-ui="button" data-size="sm" data-kind="${kind}" data-auto="${action}" data-id="${esc(id)}">${actionIcons[action] ? icon(actionIcons[action]) : ""}<span>${esc(label)}</span></button>`;
  const scene = name => `<div class="auto-scene scene-art" aria-hidden="true">${window.Icons.scene(name)}</div>`;
  const sectionTitle = (glyph, words, count = null, extra = "") => `<h4 class="auto-section-title">${icon(glyph)}<span>${esc(words)}</span>${count === null ? "" : `<span class="auto-count">${esc(count)}</span>`}${extra}</h4>`;
  const fields = ["name", "action", "text", "targetId", "schedule", "enabled", "catchUp", "wakeOffline", "maxMinutes"];
  const definition = job => Object.fromEntries(fields.map(key => [key, job[key]]));

  const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6], WEEKDAYS = [1, 2, 3, 4, 5];
  const clock = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
  const wallClock = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  const shortDate = new Intl.DateTimeFormat([], { day: "numeric", month: "short" });
  const longDay = new Intl.DateTimeFormat([], { weekday: "long", day: "numeric", month: "long" });
  const moment = new Intl.DateTimeFormat([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const leafMonth = new Intl.DateTimeFormat([], { month: "short" }), leafDay = new Intl.DateTimeFormat([], { day: "numeric" }), leafWeekday = new Intl.DateTimeFormat([], { weekday: "short" });
  const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  const pad = n => String(n).padStart(2, "0");
  const inputTime = at => { const date = new Date(at); return new Date(date.getTime() - date.getTimezoneOffset() * MINUTE).toISOString().slice(0, 16); };
  const firstDay = (() => {
    try { const locale = new Intl.Locale(navigator.language); return ((locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay ?? 1) % 7; }
    catch { return 1; }
  })();
  const inWeekOrder = days => [...days].sort((a, b) => (a - firstDay + 7) % 7 - (b - firstDay + 7) % 7);
  const listed = words => words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
  const city = zone => zone.split("/").pop().replace(/_/g, " ");
  function startOfDay(at) { const day = new Date(at); day.setHours(0, 0, 0, 0); return day.getTime(); }
  function dayWord(at, now) {
    const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY);
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
    if (days === -1) return "yesterday";
    return days > 1 && days < 7 ? DAYS[new Date(at).getDay()] : shortDate.format(at);
  }
  function distance(at, now) {
    const span = Math.abs(at - now), ahead = at >= now, days = Math.round(span / DAY);
    if (span < MINUTE) return ahead ? "in a moment" : "just now";
    const amount = span < HOUR ? `${Math.floor(span / MINUTE)} min` : span < DAY ? `${Math.floor(span / HOUR)} h` : `${days} day${days === 1 ? "" : "s"}`;
    return ahead ? `in ${amount}` : `${amount} ago`;
  }
  const whenWords = (at, now = Date.now()) => `${dayWord(at, now)} at ${clock.format(at)}`;
  const nextWords = (at, now = Date.now()) => `${whenWords(at, now)} · ${distance(at, now)}`;
  function nameFrom(text) {
    const line = String(text).trim().split("\n")[0].replace(/\s+/g, " ");
    if (line.length <= 48) return line;
    const cut = line.slice(0, 48), space = cut.lastIndexOf(" ");
    return `${(space > 20 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, "")}…`;
  }

  const CALENDAR = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-7](?:-[0-7])?(?:,[0-7](?:-[0-7])?)*)$/;
  function calendar(expression) {
    const match = CALENDAR.exec(String(expression ?? "").trim().replace(/\s+/g, " "));
    if (!match || Number(match[1]) > 59 || Number(match[2]) > 23) return null;
    const days = new Set();
    for (const part of match[3] === "*" ? ["0-6"] : match[3].split(",")) {
      const [from, to = from] = part.split("-").map(Number);
      if (to < from) return null;
      for (let day = from; day <= to; day++) days.add(day % 7);
    }
    const list = [...days].sort((a, b) => a - b);
    return { kind: list.length === 7 ? "daily" : String(list) === String(WEEKDAYS) ? "weekdays" : "days", hour: Number(match[2]), minute: Number(match[1]), days: list };
  }
  function cronOf(hour, minute, days) {
    const list = [...new Set(days)].sort((a, b) => a - b);
    return `${minute} ${hour} * * ${list.length === 7 ? "*" : String(list) === String(WEEKDAYS) ? "1-5" : list.join(",")}`;
  }
  function describe(schedule) {
    const elsewhere = schedule.timeZone && schedule.timeZone !== localZone() ? ` (${city(schedule.timeZone)} time)` : "";
    if (schedule.kind === "once") return `Once, on ${moment.format(schedule.at)}`;
    if (schedule.kind === "interval") {
      const hours = schedule.minutes / 60;
      return schedule.minutes === 1 ? "Every minute" : schedule.minutes === 60 ? "Every hour" : Number.isInteger(hours) ? `Every ${hours} hours` : `Every ${schedule.minutes} minutes`;
    }
    if (schedule.kind === "event") return schedule.event === "room-start" ? "Whenever viberoom starts" : `When you send your first message of the day${elsewhere}`;
    const time = calendar(schedule.expression);
    if (!time) return `On a custom schedule (${schedule.expression})${elsewhere}`;
    const days = time.kind === "daily" ? "Every day" : time.kind === "weekdays" ? "Every weekday" : `Every ${listed(inWeekOrder(time.days).map(day => DAYS[day]))}`;
    return `${days} at ${wallClock.format(Date.UTC(2020, 0, 1, time.hour, time.minute))}${elsewhere}`;
  }
  const KINDS = [["daily", "Every day", "sun"], ["weekdays", "Weekdays", "calendar"], ["days", "Some days", "calendar-days"], ["once", "Once", "pin"], ["interval", "Every few hours", "refresh"], ["event", "When something happens", "bolt"]];
  const RUNS = {
    waiting: ["Waiting", "clock", "waiting"], running: ["Running now", "play", "waiting"], completed: ["Done", "check", "done"],
    failed: ["Didn't finish", "alert", "failed"], interrupted: ["Didn't finish", "alert", "failed"],
    skipped: ["Skipped", "forward", "quiet"], cancelled: ["Cancelled", "close", "quiet"],
  };
  const runWords = run => RUNS[run.status] || [run.status, "info", "quiet"];
  const happened = run => run.queuedAt;
  function started(run) {
    if (run.source === "manual") return "You started it";
    if (run.source === "event") return run.job.schedule.event === "room-start" ? "When viberoom started" : "After your first message";
    return run.queuedAt - run.scheduledAt > MINUTE ? `On schedule · it was due ${moment.format(run.scheduledAt)}` : "On schedule";
  }
  function delivery(run) {
    if (run.messageId) return button(run.job.action === "reminder" ? "Show reminder" : "Read the reply", "result", run.messageId);
    if (run.delivery === "unconfirmed") return '<p class="error">Result delivery is unconfirmed. Review the conversation before retrying.</p>';
    if (run.delivery === "silent") return '<p class="hint">No written reply (the vibemate stayed silent).</p>';
    return "";
  }
  const IDEAS = [
    { emoji: "☀️", name: "Morning stand-up", action: "reminder", text: "Good morning! What are we working on today?", when: { kind: "weekdays", hour: 9, minute: 0 } },
    { emoji: "🧘", name: "Stretch break", action: "reminder", text: "Time for a short break: stand up, stretch and drink some water.", when: { kind: "interval", minutes: 90 } },
    { emoji: "📝", name: "End-of-day summary", action: "agent", text: "Summarize what happened in the room today in three short points, and say what is still open.", when: { kind: "daily", hour: 18, minute: 0 } },
    { emoji: "📅", name: "Weekly review", action: "agent", text: "Look back at this week: what was finished, what is still open, and what should come first next week.", when: { kind: "days", days: [5], hour: 16, minute: 0 } },
    { emoji: "👋", name: "Morning briefing", action: "agent", text: "Say good morning and list what is still open from yesterday, the most important first.", when: { kind: "event", event: "first-human-message" } },
  ];
  function ideaSchedule(when, timeZone) {
    if (when.kind === "interval") return { kind: "interval", minutes: when.minutes };
    if (when.kind === "event") return { kind: "event", event: when.event, timeZone };
    return { kind: "cron", expression: cronOf(when.hour, when.minute, when.kind === "daily" ? ALL_DAYS : when.kind === "weekdays" ? WEEKDAYS : when.days), timeZone };
  }

  let refreshOpen = null;
  async function open(roomId, jumpToMessage, confirmAction) {
    if (!roomId || refreshOpen) return;
    const dialog = document.createElement("dialog"); dialog.className = "dialog wide automations-dialog";
    dialog.setAttribute("aria-label", "Room automations");
    dialog.innerHTML = `<header class="auto-heading"><button type="button" class="auto-back" data-auto="back" aria-label="Back" hidden>${icon("back")}</button><div class="auto-titles"><span class="auto-eyebrow">A little help, right on time</span><h3 data-auto-title>Automations</h3></div>${button("Close", "close")}</header>
      <p data-auto-feedback role="status">Loading…</p><div class="auto-body" data-auto-body><div class="auto-screen" data-auto-content></div></div>`;
    document.body.appendChild(dialog); dialog.showModal();
    const body = dialog.querySelector("[data-auto-body]"), content = dialog.querySelector("[data-auto-content]");
    const controller = new AbortController();
    let state, screen = "list", editing = null, dirty = false, busy = false, confirming = false, reading = null, reloadAgain = false, rendered = "";
    let settled = false, seen = new Set(), justSaved = null, historyShown = 10;
    let previewTimer = 0, previewTurn = 0, previewKey = "";
    const previews = new Map();
    const ticking = setInterval(() => {
      for (const node of dialog.querySelectorAll("[data-auto-at]")) node.textContent = (node.dataset.autoWords === "next" ? nextWords : whenWords)(Number(node.dataset.autoAt));
    }, 30000);
    const feedback = (message, error = false) => { const node = dialog.querySelector("[data-auto-feedback]"); node.textContent = message; node.hidden = !message; node.classList.toggle("error", error); };
    const request = async (action, payload) => {
      let response, value;
      try { response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/automations${action ? "/" + action : ""}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
        ...(action ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : {}),
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
      controller.abort(); clearTimeout(previewTimer); clearInterval(ticking); refreshOpen = null; dialog.close(); dialog.remove(); return true;
    }
    dialog.addEventListener("cancel", event => { event.preventDefault(); void close().catch(error => feedback(error.message, true)); });

    const person = id => state.participants.find(p => p.id === id);
    const face = (p, size) => window.Avatars.avatarHtml({ ...p, kind: "agent" }, size, { muted: !!p.muted });
    const presence = p => p.muted ? "muted" : p.status === "idle" ? "ready" : ["thinking", "queued", "starting"].includes(p.status) ? "busy" : p.status === "error" ? "needs a look" : "offline";
    function recipient(job) {
      if (job.action === "reminder") return "Reminder";
      const p = person(job.targetId);
      return p ? `Task for ${p.name}` : "Task · its vibemate has left the room";
    }
    function mark(job) {
      const p = job.action === "agent" && person(job.targetId);
      return p ? `<span class="auto-mark is-face">${face(p, 36)}</span>` : `<span class="auto-mark" data-action="${esc(job.action)}">${icon(job.action === "reminder" ? "bell" : "user")}</span>`;
    }
    const live = (at, words) => `<span data-auto-at="${at}" data-auto-words="${words}">${esc((words === "next" ? nextWords : whenWords)(at))}</span>`;
    const leaf = (at, i = 0) => `<span class="auto-leaf" style="--i:${i}" title="${esc(moment.format(at))}"><span class="auto-leaf-top">${esc(leafMonth.format(at))}</span><b>${esc(leafDay.format(at))}</b><small>${esc(leafWeekday.format(at))}</small><small class="auto-leaf-time">${esc(clock.format(at))}</small></span>`;
    const sign = (glyph, words, tone = "") => `<span class="auto-leaf is-sign" data-tone="${tone}"><span class="auto-leaf-top">${esc(words)}</span><b>${icon(glyph)}</b></span>`;
    const eventSign = schedule => sign(schedule.event === "room-start" ? "bolt" : "chat", "Any day");
    const strip = (leafHtml, schedule, next) => `${leafHtml}<div class="auto-when-words"><p class="auto-rhythm">${esc(describe(schedule))}</p>${next ? `<p class="auto-next">${next}</p>` : ""}</div>`;
    function options(job, proposed = false) {
      const words = [job.catchUp === "once" ? "A missed time runs once, as soon as it can" : "A missed time is skipped"];
      if (job.action === "agent") words.push(`stops after ${job.maxMinutes} min`, job.wakeOffline ? "wakes the vibemate if offline" : "waits while the vibemate is offline");
      if (proposed && job.enabled === false) words.push("starts off");
      return words.join(" · ");
    }
    const summary = (job, proposed = false) => `<p class="auto-instructions">${esc(job.text)}</p><p class="hint">${esc(options(job, proposed))}</p>`;
    const arriving = key => (settled && !seen.has(key) ? " is-new" : "") + (justSaved && key === `job-${justSaved}` ? " is-saved" : "");

    function when(job) {
      if (!job.enabled) return strip(sign("pause", "Off", "off"), job.schedule, "Off. Nothing runs until you turn it on.");
      if (job.schedule.kind === "once" && job.nextAt === null) return strip(sign("check", "Done", "done"), job.schedule, "Its one time has passed.");
      if (job.schedule.kind === "event") return strip(eventSign(job.schedule), job.schedule, "No clock time: it waits for its moment.");
      if (job.nextAt) return strip(leaf(job.nextAt), job.schedule, `Next: <b>${live(job.nextAt, "next")}</b>`);
      return strip(sign("clock", "Soon"), job.schedule, "The next time is being worked out.");
    }
    function last(job) {
      const run = state.runs.find(run => run.jobId === job.id);
      if (!run) return `<p class="auto-last" data-tone="quiet">${icon("clock")}<span>Hasn't run yet</span></p>`;
      const [label, glyph, tone] = runWords(run), now = ["waiting", "running"].includes(run.status);
      return `<p class="auto-last" data-tone="${tone}">${icon(glyph)}<span>${now ? "Now" : "Last time"}: <b>${esc(label)}</b> · ${live(happened(run), "when")}</span></p>`;
    }
    function jobCard(job) {
      const key = `job-${job.id}`;
      return `<article class="auto-card${job.enabled ? "" : " is-off"}${arriving(key)}" data-auto-card="${esc(key)}">
        <div class="auto-card-heading">${mark(job)}<div class="auto-card-title"><h4>${esc(job.name)}</h4><p>${esc(recipient(job))}</p></div>
          <label class="switch auto-onoff"><span class="label">${job.enabled ? "On" : "Off"}</span><input type="checkbox" role="switch" data-auto="toggle" data-id="${esc(job.id)}" aria-label="${esc(job.name)}"${job.enabled ? " checked" : ""}></label></div>
        <div class="auto-when">${when(job)}</div>${last(job)}
        <details data-auto-details="${esc(key)}"><summary>${job.action === "reminder" ? "What it says" : "What they are asked"}</summary>${summary(job)}</details>
        <div class="auto-toolbar">${button("Run now", "run", job.id, "soft")}${button("Edit", "edit", job.id)}${button("Delete", "delete", job.id, "danger-quiet")}</div></article>`;
    }
    function proposalWhen(p) {
      const schedule = p.definition.schedule, times = previews.get(JSON.stringify(schedule));
      if (schedule.kind === "event") return strip(eventSign(schedule), schedule, "No clock time: it waits for its moment.");
      if (times?.length) return strip(leaf(times[0]), schedule, `First time: <b>${live(times[0], "next")}</b>`);
      if (times === undefined) return strip(sign("clock", "…", "waiting"), schedule, "Working out the first time…");
      return strip(sign("clock", "—"), schedule, times ? "No time comes up for this schedule." : "");
    }
    function proposalCard(p) {
      const key = `proposal-${p.id}`, by = state.participants.find(x => x.name === p.by);
      return `<article class="auto-card auto-proposal${arriving(key)}" data-auto-card="${esc(key)}">
        <div class="auto-card-heading">${by ? `<span class="auto-mark is-face">${face(by, 36)}</span>` : `<span class="auto-mark">${icon("spark")}</span>`}<div class="auto-card-title"><h4>${esc(p.definition.name)}</h4><p>${esc(p.by)} suggests it · ${esc(recipient(p.definition))}</p></div><span class="auto-status" data-tone="waiting">For you to decide</span></div>
        <p class="auto-why">${esc(p.why)}</p><div class="auto-when" data-auto-proposal="${esc(p.id)}">${proposalWhen(p)}</div>
        ${summary(p.definition, true)}${p.jobId ? '<p class="hint">It changes one of your automations.</p>' : ""}
        <div class="auto-toolbar">${button("Add it", "apply", p.id, "primary")}${button("No, thanks", "reject", p.id)}</div></article>`;
    }
    function ideas() {
      const none = !state.participants.length;
      return `<div class="auto-ideas">${IDEAS.map((idea, i) => {
        const task = idea.action === "agent";
        return `<button type="button" class="auto-idea" data-auto="idea" data-id="${i}"${task && none ? ' disabled title="Summon a vibemate into this room first"' : ""}><span class="auto-idea-emoji" aria-hidden="true">${idea.emoji}</span><span class="auto-idea-words"><small>${task ? "Task" : "Reminder"}</small><strong>${esc(idea.name)}</strong><span>${esc(describe(ideaSchedule(idea.when, state.timeZone)))}</span></span></button>`;
      }).join("")}</div>`;
    }
    function dayTitle(at) { const word = dayWord(at, Date.now()); return word === "today" ? "Today" : word === "yesterday" ? "Yesterday" : longDay.format(at); }
    function runRow(run) {
      const key = `run-${run.id}`, [label, glyph, tone] = runWords(run), stoppable = ["waiting", "running"].includes(run.status) && !run.stopping;
      return `<li class="auto-run${arriving(key)}" data-auto-card="${esc(key)}" data-tone="${tone}"><span class="auto-run-dot">${icon(glyph)}</span><div class="auto-run-body">
        <p class="auto-run-head"><time>${esc(clock.format(happened(run)))}</time><b>${esc(run.job.name)}</b><span class="auto-status" data-tone="${tone}">${run.stopping ? "Stopping…" : esc(label)}</span></p>
        <p class="auto-run-how">${esc(started(run))}${run.coalescedThrough ? ` · covers the missed times until ${esc(moment.format(run.coalescedThrough))}` : ""}</p>
        ${run.detail ? `<p class="auto-run-detail">${esc(run.detail)}</p>` : ""}<details data-auto-details="${esc(key)}"><summary>Instructions for this run</summary>${summary(run.job)}</details>
        <div class="auto-toolbar">${delivery(run)}${stoppable ? button(run.status === "waiting" ? "Cancel run" : "Stop run", "cancel", run.id) : ""}</div></div></li>`;
    }
    function history() {
      if (!state.runs.length) return `<div class="auto-empty">${icon("chat")}<p>Nothing has run yet. The first one gets a spot here.</p></div>`;
      const days = [];
      for (const run of state.runs.slice(0, historyShown)) {
        const title = dayTitle(happened(run));
        if (days.at(-1)?.title !== title) days.push({ title, runs: [] });
        days.at(-1).runs.push(run);
      }
      return `<ol class="auto-history">${days.map(day => `<li><h5 class="auto-day-title">${esc(day.title)}</h5><ol class="auto-timeline">${day.runs.map(runRow).join("")}</ol></li>`).join("")}</ol>
        ${state.runs.length > historyShown ? `<p class="auto-earlier">${button("Show earlier", "earlier")}</p>` : ""}`;
    }

    function listHtml() {
      const on = state.jobs.filter(job => job.enabled).length, off = state.jobs.length - on;
      return `<section class="auto-intro"><div class="auto-art" aria-hidden="true">${window.Icons.scene("automation")}</div><div class="auto-intro-words"><p class="auto-intro-title">Give the room a rhythm.</p><p>A gentle nudge, or a task for your vibemate. You choose what happens and when.</p><p class="auto-availability">${icon("info")} Keep the computer awake and viberoom running. This window can be closed.</p><div class="auto-intro-actions">${button("New automation", "new", "", "primary")}</div></div></section>
        ${state.proposals.length ? `${sectionTitle("spark", state.proposals.length === 1 ? "A suggestion for you" : "Suggestions for you", state.proposals.length)}<div class="auto-cards">${state.proposals.map(proposalCard).join("")}</div>` : ""}
        ${state.jobs.length ? `${sectionTitle("automation", "Your automations", `${on} on${off ? ` · ${off} off` : ""}`)}<div class="auto-cards">${state.jobs.map(jobCard).join("")}</div>`
          : `${sectionTitle("spark", "Start with an idea")}<p class="hint auto-section-hint">One click fills in the form. Nothing runs until you save it.</p>${ideas()}`}
        ${sectionTitle("clock", "What happened", state.runs.length, button("Refresh", "refresh"))}<p class="hint auto-section-hint">Reminders post a note without waking a vibemate. For tasks, read the reply to check the result.</p>${history()}
        <details class="auto-ground-rules" data-auto-details="ground-rules"><summary>${icon("info")} How scheduled work behaves</summary><p>One task runs at a time in a room. Waiting work respects Hush, mute and existing permissions. A run that was cut off needs a look before you run it again by hand.</p></details>`;
    }
    function kindsHtml() {
      const none = !state.participants.length;
      return `<div class="auto-doors">
        <button type="button" class="auto-door" data-auto="kind" data-id="reminder">${scene("auto-reminder")}<strong>A reminder</strong><span>A note appears in the room at the right time. No vibemate is woken.</span></button>
        <button type="button" class="auto-door" data-auto="kind" data-id="agent"${none ? " disabled" : ""}>${scene("auto-task")}<strong>A task for a vibemate</strong><span>${none ? "There is no vibemate in this room yet. Summon one first." : "A vibemate does the work and replies in the room."}</span></button>
      </div>${sectionTitle("spark", "Or start from an idea")}${ideas()}`;
    }
    function formOf(schedule) {
      const soon = new Date(Date.now() + 2 * HOUR); soon.setMinutes(0, 0, 0);
      const shape = { kind: "daily", hour: 9, minute: 0, days: [], at: soon.getTime(), every: 1, unit: 60, event: "first-human-message", expression: "", timeZone: schedule?.timeZone || state.timeZone, cron: false };
      if (!schedule) return shape;
      if (schedule.kind === "once") return { ...shape, kind: "once", at: schedule.at };
      if (schedule.kind === "interval") return { ...shape, kind: "interval", ...(schedule.minutes % 60 === 0 ? { every: schedule.minutes / 60, unit: 60 } : { every: schedule.minutes, unit: 1 }) };
      if (schedule.kind === "event") return { ...shape, kind: "event", event: schedule.event };
      const time = calendar(schedule.expression);
      return time ? { ...shape, ...time, expression: schedule.expression } : { ...shape, cron: true, expression: schedule.expression };
    }
    function formHtml() {
      const e = editing, f = formOf(e.schedule), people = state.participants;
      const tile = (name, value, checked, inner, cls) => `<label class="choice ${cls}"><input type="radio" name="${name}" value="${esc(value)}"${checked ? " checked" : ""}>${inner}</label>`;
      const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : [state.timeZone, "UTC"];
      return `<form class="auto-form" data-auto-form novalidate>
        <div class="auto-action" role="radiogroup" aria-label="What kind of automation">${tile("action", "reminder", e.action !== "agent", `${icon("bell")}<span>A reminder</span>`, "auto-action-pick")}${tile("action", "agent", e.action === "agent", `${icon("user")}<span>A task for a vibemate</span>`, "auto-action-pick")}</div>
        <section class="auto-part" data-agent-only><h4 class="auto-part-title">Who does it?</h4>
          ${people.length ? `<div class="auto-people" role="radiogroup" aria-label="Vibemate">${people.map(p => tile("targetId", p.id, e.targetId === p.id, `${face(p, 40)}<span class="auto-tile-words"><strong>${esc(p.name)}</strong><small>${esc(presence(p))}</small></span><span class="auto-tick">${icon("check")}</span>`, "auto-person")).join("")}</div>`
            : '<p class="auto-note">There is no vibemate in this room yet. Summon one first, or make this a reminder.</p>'}</section>
        <section class="auto-part"><h4 class="auto-part-title"><span data-agent-only>What should they do?</span><span data-reminder-only>What should it say?</span></h4>
          <textarea name="text" rows="4" maxlength="8000" required aria-label="The words">${esc(e.text)}</textarea>
          <label class="auto-field">Name <small>optional</small><input name="name" maxlength="100" value="${esc(e.name)}"></label></section>
        <section class="auto-part"><h4 class="auto-part-title">When?</h4>
          <div class="auto-kinds" role="radiogroup" aria-label="When" data-when-tiles>${KINDS.map(([value, label, glyph]) => tile("kind", value, f.kind === value, `${icon(glyph)}<span>${label}</span>`, "auto-kind")).join("")}</div>
          <div class="auto-days" role="group" aria-label="On these days" data-when="days">${inWeekOrder(ALL_DAYS).map(day => `<label class="choice auto-day"><input type="checkbox" name="day" value="${day}"${f.kind === "days" && f.days.includes(day) ? " checked" : ""}><span>${DAYS[day].slice(0, 3)}</span></label>`).join("")}</div>
          <label class="auto-field" data-when="daily weekdays days">At<input type="time" name="time" value="${pad(f.hour)}:${pad(f.minute)}"></label>
          <label class="auto-field" data-when="once">On<input type="datetime-local" name="at" value="${inputTime(f.at)}"><span class="hint">In this computer's time zone.</span></label>
          <div class="auto-field auto-inline" data-when="interval"><span>Every</span><input type="number" name="every" min="1" max="525600" step="1" value="${f.every}" aria-label="How often"><select name="unit" aria-label="Minutes or hours"><option value="1"${f.unit === 1 ? " selected" : ""}>minutes</option><option value="60"${f.unit === 60 ? " selected" : ""}>hours</option></select></div>
          <div class="auto-events" role="radiogroup" aria-label="Which moment" data-when="event">${tile("event", "first-human-message", f.event !== "room-start", `${icon("chat")}<span class="auto-tile-words"><strong>Your first message of the day</strong><small>Once a day, when you first write in this room.</small></span>`, "auto-event")}${tile("event", "room-start", f.event === "room-start", `${icon("bolt")}<span class="auto-tile-words"><strong>When viberoom starts</strong><small>Each time viberoom starts on this computer.</small></span>`, "auto-event")}</div>
          <label class="auto-field" data-when="cron">Cron expression<input name="expression" maxlength="120" value="${esc(f.expression)}" placeholder="0 9 * * 1-5" spellcheck="false" autocomplete="off"><span class="hint">Minute · hour · day of month · month · weekday, in the time zone under More options.</span></label>
          <div class="auto-preview" data-auto-preview aria-live="polite"><p class="auto-sentence" data-auto-sentence></p><div class="auto-leaves" data-auto-leaves></div></div></section>
        <details class="auto-more" data-auto-details="more"${f.cron || f.timeZone !== localZone() ? " open" : ""}><summary>More options</summary><div class="auto-more-body">
          <label class="auto-field">Time zone<input name="timeZone" maxlength="100" list="automation-zones" value="${esc(f.timeZone)}"><datalist id="automation-zones">${zones.map(zone => `<option value="${esc(zone)}">`).join("")}</datalist><span class="hint">Times of day follow this zone, summer time included.</span></label>
          <div class="auto-field"><span class="auto-caption">If a time is missed, for example while the computer sleeps</span><div class="auto-pair">
            <label class="choice"><input type="radio" name="catchUp" value="once"${e.catchUp !== "skip" ? " checked" : ""}><span class="auto-tile-words"><strong>Do it once, as soon as it can</strong><small>Several missed times count as one.</small></span></label>
            <label class="choice"><input type="radio" name="catchUp" value="skip"${e.catchUp === "skip" ? " checked" : ""}><span class="auto-tile-words"><strong>Skip it</strong><small>More than a minute late waits for the next time.</small></span></label></div></div>
          <div class="auto-field auto-inline" data-agent-only><span>Stop the task after</span><input type="number" name="maxMinutes" min="1" max="1440" step="1" value="${esc(e.maxMinutes)}" aria-label="Minutes before the task is stopped"><span>minutes</span></div>
          <label class="switch" data-agent-only><span class="label">Wake the vibemate if they are offline<span class="hint">It uses this room's session, workspace and permissions. Muted or stopped vibemates wait for you. Scheduled work can use paid model calls.</span></span><input type="checkbox" name="wakeOffline"${e.wakeOffline ? " checked" : ""}></label>
          <label class="switch"><span class="label">Write the time as cron<span class="hint">For people who know five-field cron.</span></span><input type="checkbox" name="cron"${f.cron ? " checked" : ""}></label>
        </div></details>
        <footer class="auto-form-actions">${button("Cancel", "back")}<button type="submit" data-ui="button" data-kind="primary">${icon("check")}<span>${e.id ? "Save changes" : "Save automation"}</span></button></footer></form>`;
    }
    function screenTo(next, title) {
      screen = next; settled = false; seen = new Set();
      dialog.dataset.screen = next;
      dialog.querySelector("[data-auto-title]").textContent = title;
      dialog.querySelector(".auto-back").hidden = next === "list";
      content.classList.remove("is-settled");
      body.scrollTop = 0;
    }
    async function showList() { screenTo("list", "Automations"); editing = null; dirty = false; rendered = ""; await refresh(); }
    function showKinds() {
      screenTo("kinds", "New automation"); editing = null; dirty = false;
      content.innerHTML = kindsHtml(); feedback("");
      content.querySelector(".auto-door:not(:disabled)")?.focus();
    }
    function edit(job, draft = {}) {
      editing = job ? { ...definition(job), id: job.id, revision: job.revision }
        : { id: null, revision: null, name: "", action: "reminder", text: "", targetId: state.participants.length === 1 ? state.participants[0].id : null, schedule: null, enabled: true, catchUp: "once", wakeOffline: false, maxMinutes: 30, ...draft };
      screenTo("edit", job ? "Edit automation" : "New automation");
      content.innerHTML = formHtml();
      dirty = false; previewKey = ""; reveal(); feedback(""); void preview();
      const f = form(), who = editing.action === "agent" && !editing.targetId ? f.querySelector('[name="targetId"]') : null;
      (who ?? f.elements.text).focus();
    }
    const ideaDraft = idea => ({ name: idea.name, action: idea.action, text: idea.text, schedule: ideaSchedule(idea.when, state.timeZone) });
    async function back() {
      if (screen === "edit") {
        if (dirty && !await discard()) return;
        dirty = false;
        if (!editing?.id) { showKinds(); return; }
      }
      await showList(); feedback("");
    }

    function render() {
      if (screen !== "list") return;
      const fingerprint = JSON.stringify([state.available, state.error, state.jobs, state.runs, state.proposals, state.participants, historyShown]);
      if (rendered === fingerprint) return;
      rendered = fingerprint;
      const expanded = [...content.querySelectorAll("details[open][data-auto-details]")].map(node => node.dataset.autoDetails);
      const oldScroll = body.scrollTop, edge = body.getBoundingClientRect().top;
      const anchor = [...content.querySelectorAll("[data-auto-card]")].find(node => node.getBoundingClientRect().bottom > edge + 30);
      const anchorKey = anchor?.dataset.autoCard, anchorTop = anchor?.getBoundingClientRect().top;
      const focused = content.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = focused?.dataset.auto, focusId = focused?.dataset.id;
      if (!state.available) { content.textContent = state.error || "Automations are unavailable."; return; }
      content.classList.toggle("is-settled", settled);
      content.innerHTML = listHtml();
      const cards = [...content.querySelectorAll("[data-auto-card]")];
      for (const node of content.querySelectorAll("[data-auto-details]")) node.open = expanded.includes(node.dataset.autoDetails);
      const replacement = anchorKey && cards.find(node => node.dataset.autoCard === anchorKey);
      body.scrollTop = oldScroll + (replacement ? replacement.getBoundingClientRect().top - anchorTop : 0);
      if (focusKey) [...content.querySelectorAll("[data-auto]")].find(node => node.dataset.auto === focusKey && node.dataset.id === focusId)?.focus({ preventScroll: true });
      const saved = cards.find(node => node.dataset.autoCard === `job-${justSaved}`);
      saved?.scrollIntoView?.({ block: "nearest" });
      if (!dialog.contains(document.activeElement)) (saved?.querySelector('[data-auto="edit"]') ?? content.querySelector('[data-auto="new"]'))?.focus({ preventScroll: true });
      justSaved = null; seen = new Set(cards.map(node => node.dataset.autoCard)); settled = true;
      void proposalTimes();
      if (state.error) feedback(state.error, true);
    }
    async function proposalTimes() {
      for (const p of state.proposals) {
        const schedule = p.definition.schedule, key = JSON.stringify(schedule);
        if (schedule.kind === "event" || previews.has(key)) continue;
        previews.set(key, undefined);
        try { previews.set(key, (await request("preview", { schedule })).times); }
        catch { if (controller.signal.aborted) return; previews.set(key, null); }
        const node = [...content.querySelectorAll("[data-auto-proposal]")].find(node => node.dataset.autoProposal === p.id);
        if (node) node.innerHTML = proposalWhen(p);
      }
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

    const form = () => content.querySelector("[data-auto-form]");
    function reveal() {
      const f = form(); if (!f) return;
      const v = f.elements, agent = v.action.value === "agent", cron = v.cron.checked, kind = cron ? "cron" : v.kind.value;
      for (const node of f.querySelectorAll("[data-agent-only]")) node.hidden = !agent;
      for (const node of f.querySelectorAll("[data-reminder-only]")) node.hidden = agent;
      f.querySelector("[data-when-tiles]").hidden = cron;
      for (const node of f.querySelectorAll("[data-when]")) node.hidden = !node.dataset.when.split(" ").includes(kind);
      v.text.placeholder = agent ? "For example: check the open pull requests and say which are ready." : "For example: Good morning! What are we working on today?";
      v.name.placeholder = nameFrom(v.text.value) || (agent ? "Evening summary" : "Morning stand-up");
    }
    function scheduleFromForm(simple = false) {
      const f = form(), v = f.elements, zone = v.timeZone.value.trim() || state.timeZone;
      const kind = !simple && v.cron.checked ? "cron" : v.kind.value;
      if (kind === "cron") return { kind, expression: v.expression.value, timeZone: zone };
      if (kind === "once") {
        const date = new Date(v.at.value);
        if (!Number.isFinite(date.getTime())) throw new Error("Choose a date and a time.");
        if (inputTime(date) !== v.at.value) throw new Error("This time does not exist here because the clock changes. Choose another time.");
        if (date.getTime() <= Date.now()) throw new Error("Choose a time in the future.");
        return { kind, at: date.getTime() };
      }
      if (kind === "interval") {
        const minutes = Number(v.every.value) * Number(v.unit.value);
        if (!Number.isSafeInteger(minutes) || minutes < 1) throw new Error("Choose how often, in whole minutes or hours.");
        return { kind, minutes };
      }
      if (kind === "event") return { kind, event: v.event.value, timeZone: zone };
      const [hour, minute] = v.time.value.split(":").map(Number);
      if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error("Choose a time of day.");
      const days = kind === "daily" ? ALL_DAYS : kind === "weekdays" ? WEEKDAYS : [...f.querySelectorAll('[name="day"]:checked')].map(node => Number(node.value));
      if (!days.length) throw new Error("Choose at least one day.");
      return { kind: "cron", expression: cronOf(hour, minute, days), timeZone: zone };
    }
    function switchCron(on) {
      const f = form(), v = f.elements;
      if (on) {
        let simple = null;
        try { simple = scheduleFromForm(true); } catch { }
        v.expression.value = simple?.kind === "cron" ? simple.expression : v.expression.value || "0 9 * * *";
        return;
      }
      const time = calendar(v.expression.value);
      if (!time) return;
      f.querySelector(`[name="kind"][value="${time.kind}"]`).checked = true;
      v.time.value = `${pad(time.hour)}:${pad(time.minute)}`;
      for (const node of f.querySelectorAll('[name="day"]')) node.checked = time.kind === "days" && time.days.includes(Number(node.value));
    }
    function take() {
      const f = form(), v = f.elements, agent = v.action.value === "agent", text = v.text.value.trim();
      const targetId = agent ? f.querySelector('[name="targetId"]:checked')?.value : null;
      if (agent && !targetId) {
        f.querySelector('[name="targetId"]')?.focus();
        throw new Error(state.participants.length ? "Choose who should do it." : "There is no vibemate in this room yet. Make it a reminder, or summon a vibemate first.");
      }
      if (!text) { v.text.focus(); throw new Error(agent ? "Write what the vibemate should do." : "Write what the reminder should say."); }
      return { name: v.name.value.trim() || nameFrom(text), action: agent ? "agent" : "reminder", text, targetId, schedule: scheduleFromForm(), enabled: editing.enabled,
        catchUp: f.querySelector('[name="catchUp"]:checked')?.value ?? "once", wakeOffline: agent && v.wakeOffline.checked, maxMinutes: agent ? Number(v.maxMinutes.value) : editing.maxMinutes };
    }
    const previewSoon = () => { clearTimeout(previewTimer); previewTimer = setTimeout(() => void preview(), 250); };
    async function preview() {
      const f = form(); if (!f) return;
      const box = f.querySelector("[data-auto-preview]"), words = box.querySelector("[data-auto-sentence]"), shelf = box.querySelector("[data-auto-leaves]");
      const agent = f.elements.action.value === "agent", who = person(f.querySelector('[name="targetId"]:checked')?.value)?.name;
      let schedule;
      try { schedule = scheduleFromForm(); }
      catch (error) { previewKey = ""; previewTurn++; box.dataset.state = "invalid"; words.textContent = error.message; shelf.innerHTML = ""; return; }
      words.textContent = `${describe(schedule)}, ${agent ? `${who || "the vibemate you choose"} gets this task and replies in the room` : "a reminder appears in the room"}.`;
      const key = JSON.stringify(schedule);
      if (key === previewKey) return;
      previewKey = key;
      const turn = ++previewTurn;
      if (schedule.kind === "event") { box.dataset.state = "ok"; shelf.innerHTML = eventSign(schedule); return; }
      box.dataset.state = "loading";
      try {
        const result = await request("preview", { schedule });
        if (turn !== previewTurn || !f.isConnected) return;
        box.dataset.state = "ok";
        shelf.innerHTML = result.times.length ? result.times.map((at, i) => leaf(at, i)).join("") : '<p class="hint">No time comes up for this schedule.</p>';
      } catch (error) {
        if (turn !== previewTurn || !f.isConnected || controller.signal.aborted) return;
        previewKey = ""; box.dataset.state = "invalid"; words.textContent = error.message; shelf.innerHTML = "";
      }
    }
    function savedWords(job, verb) {
      if (!job?.schedule) return `${verb}.`;
      if (!job.enabled) return `${verb}. It stays off until you turn it on.`;
      if (job.nextAt) return `${verb}. Next time: ${whenWords(job.nextAt)}, ${distance(job.nextAt, Date.now())}.`;
      return job.schedule.kind === "event" ? `${verb}. It waits for its moment.` : `${verb}.`;
    }
    async function mutate(action, payload) {
      const held = [...dialog.querySelectorAll("button, input, textarea, select")].filter(control => !control.disabled);
      busy = true; dialog.setAttribute("aria-busy", "true");
      for (const control of held) control.disabled = true;
      try { return await request(action, payload); }
      finally { busy = false; dialog.removeAttribute("aria-busy"); for (const control of held) control.disabled = false; }
    }
    function changed(event) {
      if (screen !== "edit") return;
      if (event.type === "change" && event.target.name === "cron") switchCron(event.target.checked);
      dirty = true; reveal(); previewSoon();
    }
    dialog.addEventListener("input", changed);
    dialog.addEventListener("change", changed);
    dialog.addEventListener("submit", async event => {
      event.preventDefault(); if (busy || confirming) return;
      try {
        const saved = await mutate("save", { definition: take(), ...(editing.id ? { id: editing.id, revision: editing.revision } : {}) });
        justSaved = saved?.id ?? null;
        await showList(); feedback(savedWords(saved, "Saved"));
      } catch (error) { feedback(error.message, true); }
    });
    dialog.addEventListener("click", async event => {
      const control = event.target.closest("[data-auto]"); if (!control) return;
      if (busy || confirming) { if (control.type === "checkbox") event.preventDefault(); return; }
      const action = control.dataset.auto, id = control.dataset.id;
      try {
        if (action === "close") return await close();
        if (action === "back") return await back();
        if (action === "new") return showKinds();
        if (action === "kind") return edit(null, { action: id });
        if (action === "idea") return edit(null, ideaDraft(IDEAS[Number(id)]));
        if (action === "edit") return edit(state.jobs.find(job => job.id === id));
        if (action === "refresh") { rendered = ""; await refresh(); return; }
        if (action === "earlier") { historyShown += 20; render(); return; }
        if (action === "result") { if (await close()) await jumpToMessage?.(id); return; }
        if (action === "toggle") {
          const job = state.jobs.find(job => job.id === id);
          try { await mutate("save", { id, revision: job.revision, definition: { ...definition(job), enabled: !job.enabled } }); }
          catch (error) { control.checked = job.enabled; throw error; }
        }
        else if (action === "apply") {
          const job = await mutate("resolve", { id, apply: true });
          justSaved = job?.id ?? null; await refresh(); feedback(savedWords(job, "Added")); return;
        }
        else if (action === "reject") await mutate("resolve", { id, apply: false });
        else if (action === "delete") {
          const job = state.jobs.find(job => job.id === id), revision = job.revision;
          if (!await ask("Its history stays here. If a task is already running, use Stop run to stop it separately.", { title: `Delete “${job.name}”?`, okLabel: "Delete automation", primary: "cancel", danger: true })) return;
          await mutate("delete", { id, revision });
        }
        else if (action === "run") {
          const job = state.jobs.find(job => job.id === id), revision = job.revision;
          if (!await ask(`Run this ${job.action === "reminder" ? "reminder" : "task"} once now. Its schedule stays as it is.`, { title: `Give “${job.name}” a go?`, okLabel: "Run now", extraHtml: `<div class="auto-confirm-preview">${mark(job)}<div><strong>${esc(recipient(job))}</strong><p>${esc(job.text)}</p></div></div>` })) return;
          await mutate("run", { id, revision });
          await refresh(); feedback("It runs now. The result comes into the room, and into the history below."); return;
        }
        else if (action === "cancel") await mutate("cancel", { id });
        await refresh(); feedback("");
      } catch (error) { feedback(error.message, true); }
    });
    await refresh(); if (!state?.error) feedback("");
  }
  window.ViberoomAutomations = { open, refresh: () => refreshOpen?.(), describe };
})();
