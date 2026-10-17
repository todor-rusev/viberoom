// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function promptSections(text) {
    const out = [];
    const open = /^<([a-z][a-z-]*)\b[^>]*>/gm;
    let at = 0;
    for (let m = open.exec(text); m; m = open.exec(text)) {
      const close = text.indexOf(`</${m[1]}>`, m.index);
      if (close < 0) continue;
      const gap = text.slice(at, m.index);
      if (gap.trim()) out.push({ name: "", text: gap.replace(/^\n+|\n+$/g, "") });
      const end = close + m[1].length + 3;
      out.push({ name: m[1], text: text.slice(m.index, end) });
      at = end;
      open.lastIndex = end;
    }
    const rest = text.slice(at);
    if (rest.trim()) out.push({ name: "", text: rest.replace(/^\n+|\n+$/g, "") });
    return out;
  }

  function devMemoryIngestionHtml(record, { esc }) {
    if (!record.runs?.length) return '<p class="hint">No ingestion recording for this message. It may still be waiting, memory may be off, or the recording was disabled, expired or removed with a source. Opening this view does not replay it.</p>';
    const labels = { "batch.input": "Messages before the sieve", "screen.dropped": "Screen: not sent", "version.check": "Another copy wrote it: checked against the graph first", "sieve.mapping": "Message IDs in this model call", "sieve.request": "Exact sieve request body", "sieve.response": "Raw sieve response", "sieve.error": "Sieve transport failure", "sieve.invalid": "Sieve answer could not be used", "filter.verdict": "Decision used by the code", "excerpts.checked": "Excerpts checked against the message", "excerpts.whole": "Excerpts could not stand for it: the whole message", "provider.episode": "Episode passed to the adapter", "provider.request": "Exact provider SDK arguments", "provider.accepted": "Accepted by the provider", "provider.error": "Provider error", "provider.failed": "No acceptance receipt", "batch.finished": "Batch finished", "batch.failed": "Batch failed", "diagnostic.omitted": "Diagnostic recording limit reached" };
    return record.runs.map((run) => {
      const sources = run.sources.map(s => `#${s.seq} (${s.role})`).join(", ");
      const events = run.events.filter(e => !e.sourceId || e.sourceId === record.messageId);
      const parts = events.map(e => `<details class="dp-part"><summary><code>${esc(labels[e.kind] || (e.kind === "provider.bookkeeping-failed" ? "Accepted; local bookkeeping failed" : e.kind))}</code><span class="dp-size">${esc(new Date(e.at).toLocaleTimeString())}</span></summary><pre>${esc(JSON.stringify(e.data, null, 2))}</pre></details>`).join("");
      return `<section><p class="hint">${esc(run.provider)} · ${esc(new Date(run.startedAt).toLocaleString())} · ${esc(run.id)}${run.recording ? '<br>Recording in memory; saved when the batch and its responses finish.' : ''}<br>Batch sources: ${esc(sources)}</p>${parts}</section>`;
    }).join("");
  }

  function devMemorySearchHtml(m, { esc }) {
    const sent = m.sent ? "" : " · the block had not changed, so it did not go again";
    const part = (words, body) => `<details class="dp-part"><summary><code>memory search · #${esc(String(m.seq))}</code><span class="dp-size">${esc(words)}</span></summary>${body}</details>`;
    if (m.pending) return part(`its search had not returned when this turn began${sent}`, '<p class="hint">No facts were given: the block said so and pointed the vibemate at search_history.</p>');
    const count = m.questions.length ? `${m.questions.length} question${m.questions.length === 1 ? "" : "s"}` : "no question";
    const why = m.fallback === "no model" ? "the sieve has no model"
      : m.fallback && m.fallback !== "slow" ? `the sieve's model ${m.fallback}`
      : "the sieve's model did not answer in time";
    const late = !m.late ? "" : m.late.questions ? `; it answered after ${m.late.ms} ms, too late` : `; it ended after ${m.late.ms} ms without questions (${m.late.failure})`;
    const unanswered = m.how !== "model" || m.unanswered === undefined ? ""
      : m.unanswered === "slow" ? `the sieve's model did not answer in ${m.modelMs} ms`
      : m.unanswered.startsWith("unavailable: ") ? `not waited for: the sieve's model was not answering (${m.unanswered.slice("unavailable: ".length)})`
      : `the sieve's model ${m.unanswered}`;
    const how = unanswered ? `${unanswered}${late}`
      : m.how === "model" ? `written by the sieve's model in ${m.modelMs} ms`
      : m.how === "split" ? `cut from the message, not rephrased: ${why}${late}`
      : "the whole message";
    const behind = m.newest ? ` · its facts not given: the search for #${m.newest}, the newest, had not returned when this turn began` : "";
    const list = m.questions.length
      ? `<ol class="dp-questions">${m.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>`
      : unanswered ? '<p class="hint">Nothing was searched: the block told the vibemate so and pointed it at search_history.</p>'
      : '<p class="hint">Nothing to look up in the memory: no search, no block.</p>';
    const lateList = m.late && m.late.questions && m.late.questions.length
      ? `<p class="hint">What the sieve's model wrote, ${esc(String(m.late.ms))} ms after it was asked:</p><ol class="dp-questions">${m.late.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>`
      : "";
    return part(`${count}, ${how}${sent}${behind}`, `${list}${lateList}`);
  }

  function devPromptHtml(p, { UI, esc }) {
    const parts = [];
    for (const block of p.blocks || []) {
      if (block.type === "text") parts.push(...promptSections(block.text));
      else parts.push({ name: "", text: block.type === "image" ? `[a picture: ${block.mimeType}, ${Math.round(block.bytes / 1024)} KB]` : `[a ${block.type} block]` });
    }
    const chars = (p.blocks || []).reduce((n, b) => n + (b.type === "text" ? b.text.length : 0), 0);
    const kind = p.correction ? " · a hidden correction" : p.hidden ? " · a hidden turn" : "";
    const head = `Sent to ${esc(p.vibemate)} at ${esc(new Date(p.at).toLocaleTimeString())}${kind} · ${parts.length} part${parts.length === 1 ? "" : "s"} · ${chars.toLocaleString()} characters`;
    const part = (s) => `<details class="dp-part"><summary><code>${esc(s.name ? `<${s.name}>` : "text")}</code><span class="dp-size">${s.text.length.toLocaleString()} characters</span></summary><pre>${esc(s.text)}</pre></details>`;
    return `<div class="dp-head"><span>${head}</span>${UI.html("button", { label: "Copy it all", kind: "ghost", size: "xs", hook: "dev-prompt-copy", title: "The prompt as it went, every block in its order" })}</div>${p.memory ? devMemorySearchHtml(p.memory, { esc }) : ""}${parts.map(part).join("")}`;
  }
  function create(messages, { UI, esc, enabled, targetOf, current, read, bindCopy }) {
    if (!messages?.ownerDocument || typeof read !== "function") throw new TypeError("A message root and recorded reads are required");
    const document = messages.ownerDocument, window = document.defaultView;
    const owner = global.VIBEROOM_APP_LIFETIME.create({ window });
    const requests = new Map(), targets = new WeakMap(), made = new WeakSet();
    const live = (panel, target, kind) => !owner.disposed && messages.contains(panel) && panel.isConnected && enabled(kind) && current(target);
    function cancelRead(panel) {
      const request = requests.get(panel);
      if (!request) return;
      requests.delete(panel); request.controller.abort();
    }
    function releasePanel(panel) { if (panel) { cancelRead(panel); panel.remove(); } }
    owner.own(() => { for (const panel of [...requests.keys()]) cancelRead(panel); });
    owner.own(() => {
      for (const node of messages.querySelectorAll('.dev-prompt-open, .dev-memory-open, .dev-prompt')) if (made.has(node)) releasePanel(node);
    });
    owner.observer(window.MutationObserver, () => {
      for (const panel of requests.keys()) if (!messages.contains(panel) || !panel.isConnected) cancelRead(panel);
    }).observe(messages, { childList: true, subtree: true });
    async function activate(open) {
      if (owner.disposed || !messages.contains(open)) return;
      const kind = open.matches(".dev-memory-open, .dev-memory-refresh") ? "memory" : open.matches(".dev-prompt-open") ? "prompt" : null;
      if (!kind || !enabled(kind)) return;
      const msg = open.closest(".msg[data-id]");
      if (!msg || !messages.contains(msg)) return;
      const saved = targets.get(msg);
      const target = saved ? { ...saved, messageId: msg.dataset.id } : targetOf(msg);
      if (!target || !current(target)) return;
      let panel = msg.querySelector(kind === "memory" ? ".dev-memory" : ".bubble .dev-prompt:not(.dev-memory)");
      if (panel && kind === "memory" && open.matches(".dev-memory-open")) { releasePanel(panel); return; }
      if (panel && kind === "prompt") { panel.hidden = !panel.hidden; return; }
      if (!panel) {
        panel = document.createElement("div");
        panel.className = kind === "memory" ? "dev-prompt dev-memory" : "dev-prompt";
        open.after(panel);
        made.add(panel);
      }
      cancelRead(panel);
      const request = { controller: new window.AbortController() };
      requests.set(panel, request);
      panel.innerHTML = kind === "memory" ? '<p class="hint">Reading the recorded memory exchange…</p>' : '<p class="hint">Reading what was sent…</p>';
      try {
        const record = await read(kind, target, { signal: request.controller.signal });
        if (request.controller.signal.aborted || requests.get(panel) !== request || !live(panel, target, kind)) return;
        if (kind === "memory") {
          panel.innerHTML = `<div class="dp-head"><span>Recorded ingestion · transport credentials are omitted or redacted</span>${UI.html("button", { label: "Refresh", kind: "ghost", size: "xs", hook: "dev-memory-refresh" })}${UI.html("button", { label: "Copy it all", kind: "ghost", size: "xs", hook: "dev-memory-copy" })}</div>${devMemoryIngestionHtml(record, { esc })}`;
          bindCopy(panel.querySelector(".dev-memory-copy"), () => JSON.stringify(record, null, 2), "");
        } else {
          panel.innerHTML = devPromptHtml(record, { UI, esc });
          const all = (record.blocks || []).map(b => b.type === "text" ? b.text : `[a ${b.type} block]`).join("\n");
          bindCopy(panel.querySelector(".dev-prompt-copy"), () => all, "");
        }
      } catch (error) {
        if (!request.controller.signal.aborted && requests.get(panel) === request && live(panel, target, kind)) panel.innerHTML = `<p class="hint">${esc(error.message || String(error))}</p>`;
      } finally { if (requests.get(panel) === request) requests.delete(panel); }
    }
    owner.on(messages, "click", e => {
      const open = e.target.closest?.(".dev-memory-open, .dev-memory-refresh, .dev-prompt-open");
      if (open) void activate(open);
    });
    function placeDevMemoryIngestion(el) {
      if (owner.disposed) return;
      if (!targets.has(el)) { const target = targetOf(el); if (target) targets.set(el, target); }
      const line = el.querySelector(".bubble .tools-line");
      if (!line) return;
      const button = line.querySelector(":scope > .dev-memory-open");
      if (enabled("memory")) {
        if (!button) {
          line.insertAdjacentHTML("beforeend", UI.html("button", { label: "Memory", icon: "code", kind: "ghost", size: "xs", hook: "dev-memory-open", title: "The recorded sieve exchange and the episode sent to memory" }));
          made.add(line.querySelector(':scope > .dev-memory-open'));
        }
      } else {
        button?.remove();
        releasePanel(line.querySelector(".dev-memory"));
      }
    }

    function placeDevPrompt(el) {
      if (owner.disposed) return;
      if (!targets.has(el)) { const target = targetOf(el); if (target) targets.set(el, target); }
      const wanted = enabled("prompt") && el.classList.contains("agent");
      const line = el.querySelector(".bubble .tools-line");
      const button = line?.querySelector(":scope > .dev-prompt-open");
      if (wanted && line) {
        const leading = !!el.querySelector(".bubble .live-tail");
        if (!button) {
          line.insertAdjacentHTML(leading ? "afterbegin" : "beforeend", UI.html("button", { label: "Prompt", icon: "code", kind: "ghost", size: "xs", hook: "dev-prompt-open", title: "What viberoom sent this vibemate for this turn, exactly as it went" }));
          made.add(line.querySelector(':scope > .dev-prompt-open'));
        }
        else if (leading && button !== line.firstElementChild) line.prepend(button);
        else if (!leading && button === line.firstElementChild) line.append(button);
        const panel = line?.querySelector(":scope > .dev-prompt:not(.dev-memory)");
        if (button && panel && button.nextElementSibling !== panel) button.after(panel);
      } else if (!wanted && button) {
        button.remove();
        releasePanel(el.querySelector(".bubble .dev-prompt:not(.dev-memory)"));
      }
    }
    function dispose() { owner.dispose(); }
    return Object.freeze({ placePrompt: placeDevPrompt, placeMemory: placeDevMemoryIngestion, activate, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });

  global.VIBEROOM_MESSAGE_DEVTOOLS = Object.freeze({ create, promptSections, promptHtml: devPromptHtml, memorySearchHtml: devMemorySearchHtml, memoryHtml: devMemoryIngestionHtml });
})(globalThis);
