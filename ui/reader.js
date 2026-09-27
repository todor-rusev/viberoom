// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const LOCAL_PIECE = 400;
  const PROVIDER_PIECE = 1500;
  const FIRST_PIECE = 240;

  const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
  const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
  const OWN_LINE = /^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\|)/;

  function sayable(raw) {
    const line = /^\s*\|.*\|\s*$/.test(raw) ? raw.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()).filter(Boolean).join(", ") : raw;
    return line
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s*(>\s?)+/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[(?:img|quote|audio)\s+\d+\]/gi, "")
      .replace(/<?https?:\/\/([^\s/>)]+)(?:[^\s>)]*[^\s>).,;:!?])?>?/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(^|[^\p{L}\p{N}_*])[*_]([^*_\n]+)[*_](?=[^\p{L}\p{N}_*]|$)/gu, "$1$2")
      .replace(/(^|[\s(])@([\p{L}\p{N}_.-]+)/gu, "$1$2")
      .replace(/(^|[\s(])#(\d+)\b/g, "$1$2")
      .replace(EMOJI, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function speakable(markdown) {
    const blocks = [];
    let paragraph = "";
    let fence = null;
    const end = () => { if (paragraph) blocks.push(paragraph); paragraph = ""; };
    for (const raw of String(markdown || "").split(/\r?\n/)) {
      const mark = /^\s*(`{3,}|~{3,})/.exec(raw);
      if (fence) {
        if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length) fence = null;
        continue;
      }
      if (mark) { end(); fence = mark[1]; continue; }
      if (!raw.trim()) { end(); continue; }
      if (TABLE_RULE.test(raw)) continue;
      const words = sayable(raw);
      if (OWN_LINE.test(raw)) { end(); if (words) blocks.push(words); }
      else if (words) paragraph = paragraph ? `${paragraph} ${words}` : words;
    }
    end();
    return blocks.map((block) => (/[.!?…:;,]$/.test(block) ? block : `${block}.`)).join(" ");
  }

  function pieces(text, max, first = max) {
    const segmenter = root.Intl && root.Intl.Segmenter ? new root.Intl.Segmenter(undefined, { granularity: "sentence" }) : null;
    const sentences = segmenter ? Array.from(segmenter.segment(String(text || "")), (s) => s.segment) : String(text || "").match(/[^.!?…]+[.!?…]*\s*/g) || [];
    const out = [];
    let current = "";
    const limit = () => (out.length ? max : first);
    const flush = () => { if (current.trim()) out.push(current.trim()); current = ""; };
    for (let sentence of sentences) {
      if (current && (current + sentence).trim().length > limit()) flush();
      while (sentence.trim().length > limit()) {
        const room = limit();
        const cut = Math.max(sentence.lastIndexOf(", ", room), sentence.lastIndexOf(" ", room));
        const at = cut > room / 2 ? cut + 1 : room;
        current = sentence.slice(0, at);
        flush();
        sentence = sentence.slice(at);
      }
      current += sentence;
    }
    flush();
    return out;
  }

  function localVoices(synth) {
    try {
      return synth ? synth.getVoices().filter((voice) => voice.localService) : [];
    } catch {
      return [];
    }
  }

  function pickVoice(voices, name, language) {
    const lang = String(language || "").toLowerCase();
    return (name && voices.find((voice) => voice.name === name))
      || (lang && voices.find((voice) => String(voice.lang).toLowerCase().split(/[-_]/)[0] === lang))
      || voices.find((voice) => voice.default) || voices[0] || null;
  }

  function create({ synth = root.speechSynthesis, Utterance = root.SpeechSynthesisUtterance, fetchSpeech, makeAudio = () => new root.Audio(), onChange = () => {}, urls = root.URL }) {
    let current = null;
    const waiting = [];

    function tell(key, state, error) {
      try {
        onChange(key, state, error);
      } catch {
      }
    }
    function finish(job, error) {
      if (current !== job) return;
      current = null;
      tell(job.key, "idle", error);
      const next = waiting.shift();
      if (next) begin(next);
    }
    function begin(job) {
      current = job;
      job.state = "loading";
      tell(job.key, "loading");
      if (job.how.mode === "system") sayHere(job);
      else void playProvided(job);
    }
    function started(job) {
      if (current !== job || job.state === "reading") return;
      job.state = "reading";
      tell(job.key, "reading");
    }

    function sayHere(job) {
      const voices = localVoices(synth);
      if (!synth || !Utterance || !voices.length) return finish(job, new Error("This computer has no voice the window can read with: add one in the system's language settings, or let the provider read in Settings → Voice."));
      const voice = pickVoice(voices, job.how.voice, job.how.language);
      const parts = pieces(job.text, LOCAL_PIECE);
      if (!parts.length) return finish(job);
      job.halt = () => synth.cancel();
      synth.cancel();
      parts.forEach((part, i) => {
        const utterance = new Utterance(part);
        if (voice) {
          utterance.voice = voice;
          utterance.lang = voice.lang;
        }
        utterance.onstart = () => started(job);
        if (i === parts.length - 1) utterance.onend = () => finish(job);
        utterance.onerror = (e) => {
          if (current !== job || e.error === "interrupted" || e.error === "canceled") return;
          synth.cancel();
          finish(job, new Error(`This computer's voice could not read it (${e.error}).`));
        };
        synth.speak(utterance);
      });
    }

    async function playProvided(job) {
      const parts = pieces(job.text, PROVIDER_PIECE, FIRST_PIECE);
      if (!parts.length) return finish(job);
      const audio = makeAudio();
      const controller = new AbortController();
      const made = [];
      let wake = null;
      job.halt = () => {
        controller.abort();
        audio.pause();
        if (wake) wake();
      };
      try {
        let next = fetchSpeech(parts[0], controller.signal);
        for (let i = 0; i < parts.length; i++) {
          const blob = await next;
          if (current !== job) return;
          next = i + 1 < parts.length ? fetchSpeech(parts[i + 1], controller.signal) : null;
          if (next) next.catch(() => {});
          const url = urls.createObjectURL(blob);
          made.push(url);
          audio.src = url;
          const ended = new Promise((resolve, reject) => {
            wake = resolve;
            audio.onended = () => resolve();
            audio.onerror = () => reject(new Error("The sound of the reading could not be played."));
          });
          ended.catch(() => {});
          await audio.play();
          started(job);
          await ended;
          wake = null;
          if (current !== job) return;
        }
        finish(job);
      } catch (error) {
        if (current === job) finish(job, error && typeof error.message === "string" ? error : new Error(String(error)));
      } finally {
        for (const url of made) urls.revokeObjectURL(url);
      }
    }

    function stop() {
      const job = current;
      waiting.length = 0;
      current = null;
      if (!job) return;
      if (job.halt) job.halt();
      tell(job.key, "idle");
    }
    function read(key, text, how) {
      const again = !!current && current.key === key;
      stop();
      if (!again) begin({ key, text, how });
    }
    function queue(key, text, how) {
      if ((current && current.key === key) || waiting.some((job) => job.key === key)) return;
      if (current) waiting.push({ key, text, how });
      else begin({ key, text, how });
    }
    function state(key) {
      if (current && current.key === key) return current.state;
      return waiting.some((job) => job.key === key) ? "waiting" : "idle";
    }
    return { read, queue, stop, state, get busy() { return !!current; } };
  }

  root.VIBEROOM_READER = Object.freeze({ speakable, pieces, localVoices, pickVoice, create, LOCAL_PIECE, PROVIDER_PIECE, FIRST_PIECE });
})(globalThis);
