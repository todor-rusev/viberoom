// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const MAX_MS = 10 * 60 * 1000;
  const BARS = 40;
  const BAR_MS = 70;
  const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

  function base64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new root.FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(reader.error);
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

  function attach({ button, readiness, openSettings, transcribe, insert, sendRecording, say, onListen = () => {}, panel = null, doc = root.document, media = root.navigator && root.navigator.mediaDevices, Recorder = root.MediaRecorder, Listener = root.AudioContext, now = () => Date.now() }) {
    const time = button.querySelector(".mic-time");
    const part = (selector) => (panel ? panel.querySelector(selector) : null);
    const words = part(".vp-words"), wave = part(".vp-wave"), panelTime = part(".vp-time");
    if (wave) wave.innerHTML = "<i></i>".repeat(BARS);
    const bars = wave ? Array.from(wave.children) : [];
    bars.forEach((bar, i) => bar.style.setProperty("--i", String(i)));
    let levels = [], listener = null, frame = 0, lastBar = 0;
    let state = "idle";
    let stream = null, recorder = null, chunks = [], startedAt = 0, tick = 0, limit = 0, dropped = false, sending = false, goingAsMessage = false;

    function draw() {
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
      if (!Listener || !bars.length) return;
      try {
        listener = new Listener();
        const analyser = listener.createAnalyser();
        analyser.fftSize = 1024;
        listener.createMediaStreamSource(opened).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const step = (at) => {
          frame = root.requestAnimationFrame(step);
          if (at - lastBar < BAR_MS) return;
          lastBar = at;
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const v of samples) sum += v * v;
          const level = Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length)) * 1.6);
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
      const s = Math.max(0, Math.floor((now() - startedAt) / 1000));
      const reading = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (time) time.textContent = reading;
      if (panelTime) panelTime.textContent = reading;
    }
    function release() {
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
      if (!media || !media.getUserMedia || !Recorder) return void say("This window cannot record sound.");
      onListen();
      state = "asking";
      draw();
      let opened;
      try {
        opened = await media.getUserMedia({ audio: true });
      } catch (error) {
        state = "idle";
        draw();
        return void say(refusal(error));
      }
      if (state !== "asking") {
        for (const track of opened.getTracks()) track.stop();
        return;
      }
      stream = opened;
      const type = TYPES.find((t) => typeof Recorder.isTypeSupported !== "function" || Recorder.isTypeSupported(t)) || "";
      recorder = new Recorder(stream, type ? { mimeType: type } : undefined);
      chunks = [];
      dropped = false;
      recorder.addEventListener("dataavailable", (e) => { if (e.data && e.data.size) chunks.push(e.data); });
      recorder.addEventListener("stop", () => { void finish(); });
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
      if (state === "recording" && recorder && recorder.state !== "inactive") recorder.stop();
    }
    function cancel() {
      if (state === "asking") {
        state = "idle";
        draw();
      } else if (state === "recording") {
        dropped = true;
        stop();
      }
    }
    function send() {
      if (state === "asking") return cancel();
      if (state !== "recording" || !sendRecording) return;
      sending = true;
      stop();
    }
    async function finish() {
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
        const text = await transcribe({ audio: await base64(blob), mimeType: type, seconds });
        if (text) insert(text);
        else say("Nothing was heard in that recording.");
      } catch (error) {
        say((error && error.message) || String(error));
      } finally {
        state = "idle";
        draw();
      }
    }

    if (panel) panel.addEventListener("click", (e) => {
      const act = e.target.closest("[data-vp]")?.dataset.vp;
      if (act === "cancel") cancel();
      else if (act === "stop") stop();
      else if (act === "send") send();
    });
    button.addEventListener("click", () => {
      if (state === "busy") return;
      if (state === "asking") return cancel();
      if (state === "recording") return stop();
      if (!readiness().ready) return void openSettings();
      void start();
    });
    doc.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || (state !== "asking" && state !== "recording")) return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }, true);
    draw();
    return { redraw: draw, cancel, send, get state() { return state; }, get listening() { return state === "asking" || state === "recording"; } };
  }

  root.VIBEROOM_VOICE = Object.freeze({ attach, MAX_MS, TYPES });
})(globalThis);
