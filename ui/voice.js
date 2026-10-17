// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const MAX_MS = 10 * 60 * 1000;
  const BARS = 40;
  const BAR_MS = 70;
  const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  const SILENCE_RMS = 0.003;
  const SILENCE_MOMENTS = 4;
  const MEASURE_GAP_MS = 500;
  const SILENCE = "The microphone recorded only silence, so nothing was sent. Check that the right microphone is chosen and not muted, and that the system lets this browser use it.";

  function actionsHtml(UI) {
    return UI.html("button", { label: "Cancel", kind: "ghost", size: "sm", title: "Let the recording go (Esc)", data: { vp: "cancel" } })
      + UI.html("button", { label: "Stop", icon: "stop", kind: "secondary", size: "sm", title: "Stop, and the words go into the field", data: { vp: "stop" } })
      + UI.html("button", { label: "Send as voice", icon: "send", kind: "primary", size: "sm", title: "Send the recording itself as a voice message", data: { vp: "send" } });
  }

  function base64(blob, signal) {
    return new Promise((resolve, reject) => {
      const reader = new root.FileReader();
      const cancelled = () => new root.DOMException("Recording was released", "AbortError");
      const cleanup = () => { signal?.removeEventListener("abort", abort); reader.onload = reader.onerror = reader.onabort = null; };
      const abort = () => { cleanup(); reader.abort(); reject(cancelled()); };
      if (signal?.aborted) return reject(cancelled());
      reader.onload = () => { cleanup(); resolve(String(reader.result).split(",")[1] || ""); };
      reader.onerror = () => { cleanup(); reject(reader.error); };
      reader.onabort = () => { cleanup(); reject(cancelled()); };
      signal?.addEventListener("abort", abort, { once: true });
      reader.readAsDataURL(blob);
    });
  }

  function refusal(error) {
    const name = error && error.name;
    if (name === "NotAllowedError" || name === "SecurityError") return "viberoom may not use the microphone: allow it in the browser's site settings, or in the system's privacy settings.";
    if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found.";
    if (name === "NotReadableError") return "The microphone is busy in another program, or the system would not open it.";
    return `The microphone could not be opened: ${(error && error.message) || error}`;
  }

  function attach({ button, readiness, openSettings, transcribe, insert, sendRecording, say, onListen = () => {}, panel = null, UI = null, doc = root.document, root: eventRoot = doc, media = root.navigator && root.navigator.mediaDevices, Recorder = root.MediaRecorder, Listener = root.AudioContext, now = () => Date.now() }) {
    let disposed = false, generation = 0;
    const lifetime = new root.AbortController();
    const bindings = [], recordingBindings = [];
    const on = (target, type, fn, capture = false, into = bindings) => {
      target.addEventListener(type, fn, capture);
      into.push(() => target.removeEventListener(type, fn, capture));
    };
    const unbindRecording = () => { for (const remove of recordingBindings.splice(0)) remove(); };
    const time = button.querySelector(".mic-time");
    const part = (selector) => (panel ? panel.querySelector(selector) : null);
    const actions = part(".vp-acts");
    if (actions && UI) actions.innerHTML = actionsHtml(UI);
    const words = part(".vp-words"), wave = part(".vp-wave"), panelTime = part(".vp-time");
    if (wave) wave.innerHTML = "<i></i>".repeat(BARS);
    const bars = wave ? Array.from(wave.children) : [];
    bars.forEach((bar, i) => bar.style.setProperty("--i", String(i)));
    let levels = [], listener = null, frame = 0, lastBar = 0;
    let loudest = 0, measured = 0, firstMeasureAt = 0, lastMeasureAt = 0, gapped = false;
    let state = "idle";
    let stream = null, recorder = null, chunks = [], startedAt = 0, tick = 0, limit = 0, dropped = false, sending = false, goingAsMessage = false;

    function draw() {
      if (disposed) return;
      const listening = state === "asking" || state === "recording";
      button.dataset.state = listening ? "recording" : state;
      button.setAttribute("aria-pressed", String(listening));
      button.setAttribute("aria-label", listening ? "Stop, and write it down" : "Say it");
      const ready = readiness();
      button.dataset.hint = listening ? `Stop, and your words go into the field${sendRecording ? "; Send sends it as a voice message" : ""} (Esc lets it go)`
        : state === "busy" ? "Writing down what you said…"
        : ready.ready ? "Say it: press, speak, press again"
        : `Say it. ${ready.reason}`;
      if (!ready.ready && ready.almost) button.dataset.attention = "";
      else delete button.dataset.attention;
      if (time) time.hidden = state !== "recording";
      drawPanel();
    }
    function drawPanel() {
      if (!panel) return;
      const on = state !== "idle";
      panel.hidden = !on;
      panel.dataset.state = state;
      button.closest("form")?.classList.toggle("voice-on", on);
      if (!on) return;
      if (words) words.textContent = state === "asking" ? "Opening the microphone…"
        : state === "recording" ? "Listening. Speak now"
        : goingAsMessage ? "Sending your voice message…" : "Writing down what you said…";
      const send = part('[data-vp="send"]');
      if (send) send.hidden = !sendRecording;
      for (const b of panel.querySelectorAll("[data-vp]")) b.disabled = state === "busy";
      if (state === "busy") showWave(summary(levels));
    }
    function showWave(heights) {
      bars.forEach((bar, i) => bar.style.setProperty("--level", String(heights[i] ?? 0)));
    }
    function summary(all) {
      if (!all.length) return [];
      return Array.from({ length: BARS }, (_, i) => {
        const from = Math.floor((i * all.length) / BARS), to = Math.max(from + 1, Math.floor(((i + 1) * all.length) / BARS));
        return Math.max(...all.slice(from, to));
      });
    }
    function listen(opened) {
      levels = [];
      loudest = 0;
      measured = 0;
      firstMeasureAt = lastMeasureAt = 0;
      gapped = false;
      if (!Listener) return;
      try {
        listener = new Listener();
        if (listener.state === "suspended") void listener.resume?.().catch(() => {});
        const analyser = listener.createAnalyser();
        analyser.fftSize = 1024;
        listener.createMediaStreamSource(opened).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const step = (at) => {
          if (disposed || state !== "recording") return;
          frame = root.requestAnimationFrame(step);
          if (at - lastBar < BAR_MS) return;
          lastBar = at;
          if (listener.state !== "running") { gapped = true; return; }
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const v of samples) sum += v * v;
          const rms = Math.sqrt(sum / samples.length);
          const t = now();
          if (measured && t - lastMeasureAt > MEASURE_GAP_MS) gapped = true;
          if (!measured) firstMeasureAt = t;
          lastMeasureAt = t;
          loudest = Math.max(loudest, rms);
          measured++;
          const level = Math.min(1, Math.sqrt(rms) * 1.6);
          levels.push(level);
          const recent = levels.slice(-BARS);
          showWave(Array(BARS - recent.length).fill(0).concat(recent));
        };
        frame = root.requestAnimationFrame(step);
      } catch {
        listener = null;
      }
    }
    function clock() {
      if (disposed) return;
      const s = Math.max(0, Math.floor((now() - startedAt) / 1000));
      const reading = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (time) time.textContent = reading;
      if (panelTime) panelTime.textContent = reading;
    }
    function release() {
      unbindRecording();
      clearInterval(tick);
      clearTimeout(limit);
      if (frame) root.cancelAnimationFrame(frame);
      frame = 0;
      if (listener) void listener.close().catch(() => {});
      listener = null;
      if (stream) for (const track of stream.getTracks()) track.stop();
      stream = null;
      recorder = null;
    }

    async function start() {
      if (disposed) return;
      const request = ++generation;
      if (!media || !media.getUserMedia || !Recorder) return void say("This window cannot record sound.");
      onListen();
      state = "asking";
      draw();
      let opened;
      try {
        opened = await media.getUserMedia({ audio: true });
      } catch (error) {
        if (disposed || request !== generation) return;
        state = "idle";
        draw();
        return void say(refusal(error));
      }
      if (disposed || request !== generation || state !== "asking") {
        for (const track of opened.getTracks()) track.stop();
        return;
      }
      stream = opened;
      const type = TYPES.find((t) => typeof Recorder.isTypeSupported !== "function" || Recorder.isTypeSupported(t)) || "";
      recorder = new Recorder(stream, type ? { mimeType: type } : undefined);
      chunks = [];
      dropped = false;
      on(recorder, "dataavailable", (e) => { if (e.data && e.data.size) chunks.push(e.data); }, false, recordingBindings);
      on(recorder, "stop", () => { void finish(); }, false, recordingBindings);
      recorder.start();
      listen(stream);
      startedAt = now();
      state = "recording";
      draw();
      clock();
      tick = setInterval(clock, 250);
      limit = setTimeout(stop, MAX_MS);
    }
    function stop() {
      if (disposed) return;
      if (state === "recording" && recorder && recorder.state !== "inactive") recorder.stop();
    }
    function cancel() {
      if (disposed) return;
      if (state === "asking") {
        generation++;
        state = "idle";
        draw();
      } else if (state === "recording") {
        dropped = true;
        stop();
      }
    }
    function send() {
      if (disposed) return;
      if (state === "asking") return cancel();
      if (state !== "recording" || !sendRecording) return;
      sending = true;
      stop();
    }
    async function finish() {
      if (disposed) return;
      const request = generation;
      const seconds = Math.round((now() - startedAt) / 100) / 10;
      const type = (recorder && recorder.mimeType) || (chunks[0] && chunks[0].type) || TYPES[1];
      const blob = new root.Blob(chunks, { type });
      chunks = [];
      release();
      const asMessage = sending;
      sending = false;
      goingAsMessage = asMessage;
      if (dropped || !blob.size) {
        state = "idle";
        return void draw();
      }
      const end = now();
      const covered = measured >= SILENCE_MOMENTS && !gapped && firstMeasureAt - startedAt <= MEASURE_GAP_MS && end - lastMeasureAt <= MEASURE_GAP_MS;
      if (covered && loudest < SILENCE_RMS) {
        state = "idle";
        draw();
        return void say(SILENCE);
      }
      if (asMessage) {
        state = "busy";
        draw();
        try {
          sendRecording({ mimeType: type, seconds, blob });
        } catch (error) {
          say((error && error.message) || String(error));
        } finally {
          state = "idle";
          draw();
        }
        return;
      }
      state = "busy";
      draw();
      try {
        const audio = await base64(blob, lifetime.signal);
        if (disposed || request !== generation) return;
        const text = await transcribe({ audio, mimeType: type, seconds }, { signal: lifetime.signal });
        if (disposed || request !== generation) return;
        if (text) insert(text);
        else say("Nothing was heard in that recording.");
      } catch (error) {
        if (!disposed && request === generation) say((error && error.message) || String(error));
      } finally {
        if (!disposed && request === generation) { state = "idle"; draw(); }
      }
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      lifetime.abort();
      for (const remove of bindings.splice(0)) remove();
      unbindRecording();
      const active = recorder;
      if (active && active.state !== "inactive") { try { active.stop(); } catch { } }
      release();
      chunks = [];
      levels = [];
      state = "idle";
      button.dataset.state = "idle";
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", "Say it");
      if (time) time.hidden = true;
      if (panel) { panel.hidden = true; panel.dataset.state = "idle"; }
      button.closest("form")?.classList.remove("voice-on");
    }

    if (panel) on(panel, "click", (e) => {
      const act = e.target.closest("[data-vp]")?.dataset.vp;
      if (act === "cancel") cancel();
      else if (act === "stop") stop();
      else if (act === "send") send();
    });
    on(button, "click", () => {
      if (state === "busy") return;
      if (state === "asking") return cancel();
      if (state === "recording") return stop();
      if (!readiness().ready) return void openSettings();
      void start();
    });
    on(doc, "keydown", (e) => {
      if (eventRoot !== doc && !eventRoot.contains(e.target)) return;
      if (e.key !== "Escape" || (state !== "asking" && state !== "recording")) return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }, true);
    draw();
    return { redraw: draw, cancel, send, dispose, get state() { return state; }, get listening() { return state === "asking" || state === "recording"; } };
  }

  Object.defineProperty(attach, "disposable", { value: true });
  root.VIBEROOM_VOICE = Object.freeze({ attach, MAX_MS, TYPES });
})(globalThis);
