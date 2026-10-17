// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function create({ marked = null, esc, UI, icon: ic, table: csvTable, findByName, colourOf, prismLanguageOf, time, holdsSelection }) {
    const OPEN_RE = /<code>([^<]+)<\/code>|(?:https?:\/\/|mailto:)[^\s<>"'`]+|(?<![\w:\/.])((?:(?:[A-Za-z]:[\\/]|~[\\/])[^\s<>"'`*?|&:]|\/[^\s<>"'`*?|&:\/])[^<>"'`*?|&:\n]*?\.[A-Za-z0-9]{1,8}(?::\d+(?:-\d+)?)?(?=$|[\s,;:!?)\]<»]|\.(?:\s|$))|(?:[A-Za-z]:[\\/]|~[\\/])[^\s<>"'`*?|&]+|\/(?:[\w.@-]+\/)+[\w.@-][^\s<>"'`*?|&]*)/g;
    const CODE_PATH_RE = /^(?:[A-Za-z]:[\\/]|~[\\/]|\/)[^<>"'`*?|&\n]+$/;
    const MESSAGE_REF_RE = /(?<![\p{L}\p{N}_&#\/\\])#([1-9]\d{0,8})(?![\p{L}\p{N}_])/gu;
    const IMG_GLYPH = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="5.6" cy="6.4" r="1.4" fill="currentColor"/><path d="M2.6 12.2l3.4-3.4 2.6 2.6 2.2-2.2 3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const md = marked ? new marked.Marked({ gfm: true, breaks: true }) : null;
    if (md) {
      md.use({
        extensions: [
          {
            name: "loneTilde",
            level: "inline",
            start(src) {
              return src.indexOf("~");
            },
            tokenizer(src) {
              return /^~(?!~)/.test(src) ? { type: "loneTilde", raw: "~", text: "~" } : undefined;
            },
            renderer() {
              return "~";
            },
          },
          {
            name: "windowsPath",
            level: "inline",
            start(src) {
              return src.search(/(?:[A-Za-z]:\\|~\\)/);
            },
            tokenizer(src) {
              if (!/^(?:[A-Za-z]:\\|~\\)/.test(src)) return;
              const match = new RegExp(OPEN_RE.source).exec(src);
              if (match && match.index === 0) return { type: "windowsPath", raw: match[0], text: match[0] };
            },
            renderer(token) {
              return esc(token.text);
            },
          },
        ],
        renderer: {
          html(token) {
            return esc(token.text != null ? token.text : token.raw || "");
          },
          code(token) {
            const lang = token.lang || "";
            if (/^\s*(csv|tsv)\b/i.test(lang)) return csvBlock(String(token.text || ""));
            const code = esc(String(token.text || "")).trim();
            if (/^\s*mermaid\b/i.test(lang)) return mermaidBlock(code);
            const id = prismLanguageOf(String(lang).trim().split(/\s+/)[0]);
            return id ? `<pre><code data-lang="${esc(id)}">${code}</code></pre>` : `<pre>${code}</pre>`;
          },
          link(token) {
            const inner = this.parser.parseInline(token.tokens || []);
            const href = String(token.href || "");
            if (!/^(https?:|mailto:)/i.test(href)) return inner;
            return `<a class="open-link" data-open="${esc(href)}" href="#" title="Open in your browser">${inner}</a>`;
          },
          image(token) {
            return esc(token.text || token.href || "");
          },
        },
      });
    }

    function openLink(target, isUrl) {
      return `<a class="open-link" data-open="${target}" href="#" title="${isUrl ? "Open in your browser" : "Open with the default app"}">${target}</a>`;
    }

    function linkify(html) {
      return html.replace(OPEN_RE, (m, code) => {
        if (code !== undefined) return CODE_PATH_RE.test(code.trim()) ? `<code>${openLink(code.trim(), false)}</code>` : `<code>${linkify(code)}</code>`;
        const trail = (m.match(/[.,;:!?)\]]+$/) || [""])[0];
        const target = m.slice(0, m.length - trail.length);
        const isUrl = /^(https?:|mailto:)/i.test(target);
        return openLink(target, isUrl) + trail;
      });
    }

    function parseCsv(text) {
      const first = text.split(/\r?\n/, 1)[0] || "";
      let delimiter = ",";
      let best = -1;
      for (const d of [",", ";", "\t"]) {
        const n = first.split(d).length - 1;
        if (n > best) {
          delimiter = d;
          best = n;
        }
      }
      const rows = [];
      let row = [];
      let field = "";
      let quoted = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
          if (c === '"') {
            if (text[i + 1] === '"') {
              field += '"';
              i++;
            } else quoted = false;
          } else field += c;
          continue;
        }
        if (c === '"' && field === "") quoted = true;
        else if (c === delimiter) {
          row.push(field);
          field = "";
        } else if (c === "\n" || c === "\r") {
          if (c === "\r" && text[i + 1] === "\n") i++;
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
        } else field += c;
      }
      if (field !== "" || row.length) {
        row.push(field);
        rows.push(row);
      }
      while (rows.length && rows[rows.length - 1].every((f) => f === "")) rows.pop();
      return rows;
    }

    function csvBlock(raw) {
      const rows = parseCsv(raw.trim());
      const code = esc(raw.trim());
      if (rows.length < 2) return `<pre>${code}</pre>`;
      return `<div class="csv-block"><div class="mm-out">${csvTable(rows)}</div><pre class="mm-code" hidden>${code}</pre><div class="mm-bar"><button type="button" class="mm-src">source</button></div></div>`;
    }

    function mermaidBlock(code) {
      return `<div class="mermaid-block" data-src="${code}"><div class="mm-out"><pre>${code}</pre></div><pre class="mm-code" hidden>${code}</pre><div class="mm-bar"><button type="button" class="mm-src">source</button><button type="button" class="mm-expand" title="See it big (zoom and drag)">${ic("maximize")}</button></div></div>`;
    }

    function mentions(room, html, addressed = []) {
      return html.replace(/(?<![\w.\/:])@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu, (m, name) => {
        if (name.toLowerCase() === "all") return `<span class="mention all">@${esc(name)}</span>`;
        const lower = name.toLowerCase();
        const meant = addressed.length ? room.participants.find((x) => addressed.includes(x.id) && [x.name, ...(x.formerNames || [])].some((n) => n.toLowerCase() === lower)) : null;
        const p = meant || findByName(room, name);
        return p ? `<span class="mention" style="--who:${colourOf(p)}">@${esc(name)}</span>` : m;
      });
    }

    function decorate(room, html, addressed) {
      let inside = 0;
      let out = "";
      for (const part of html.split(/(<[^>]*>)/)) {
        if (!part) continue;
        if (part[0] === "<") {
          const m = /^<(\/?)(pre|a)\b/i.exec(part);
          if (m) inside += m[1] ? -1 : 1;
          out += part;
        } else out += inside > 0 ? part : mentions(room, linkify(part), addressed);
      }
      return out;
    }

    function renderStreamingWords(room, words, text, addressed) {
      if (holdsSelection(words)) return;
      let head = words.querySelector(":scope > .words-head");
      let tail = words.querySelector(":scope > .words-tail");
      if (!head || !tail || !text.startsWith(words.streamHeadText || "")) {
        words.innerHTML = '<div class="words-head"></div><div class="words-tail"></div>';
        head = words.firstElementChild;
        tail = words.lastElementChild;
        words.streamHeadText = "";
        words.streamFences = 0;
      }
      let done = words.streamHeadText.length;
      const cut = text.lastIndexOf("\n\n");
      if (cut > done) {
        const part = text.slice(done, cut + 2);
        const fences = (part.match(/```/g) || []).length;
        if ((words.streamFences + fences) % 2 === 0) {
          head.insertAdjacentHTML("beforeend", renderText(room, part, null, null, addressed));
          words.streamHeadText = text.slice(0, cut + 2);
          words.streamFences += fences;
          done = cut + 2;
        }
      }
      tail.innerHTML = renderText(room, text.slice(done), null, null, addressed);
    }

    function renderMarkdown(room, text, addressed) {
      return md ? decorate(room, md.parse(String(text == null ? "" : text)), addressed) : renderTextLight(room, text, addressed);
    }

    function renderText(room, text, images, quotes, addressed, audio, video, numbers) {
      let html = messageRefs(renderMarkdown(room, text, addressed), numbers);
      if (images && images.length) html = imageRefs(html, images);
      if (audio && audio.length) html = soundRefs(html, audio);
      if (video && video.length) html = videoRefs(html, video);
      if (quotes && quotes.length) html = quoteRefs(html, quotes);
      return html;
    }

    function soundRefs(html, audio) {
      const numbers = new Set(audio.map((sound, i) => sound.n || i + 1));
      return html.replace(/\[audio (\d+)\]/gi, (whole, n) =>
        numbers.has(Number(n)) ? `<button type="button" class="audio-ref" data-n="${n}" data-hint="Play sound ${n}">${ic("mic")}<span>${n}</span></button>` : whole,
      );
    }

    function videoRefs(html, video) {
      const numbers = new Set(video.map((clip, i) => clip.n || i + 1));
      return html.replace(/\[video (\d+)\]/gi, (whole, n) =>
        numbers.has(Number(n)) ? `<button type="button" class="audio-ref video-ref" data-n="${n}" data-hint="Play video ${n}">${ic("video")}<span>${n}</span></button>` : whole,
      );
    }

    function messageRefs(html, numbers) {
      let inside = 0;
      let out = "";
      const refer = (whole, n) => {
        if (!numbers || !Object.hasOwn(numbers.here, n)) return UI.html("message-ref", { seq: Number(n) });
        const here = numbers.here[n];
        return here === null ? whole : UI.html("message-ref", { seq: here, written: Number(n), copy: numbers.copy });
      };
      for (const part of html.split(/(<[^>]*>)/)) {
        if (!part) continue;
        if (part[0] === "<") {
          const tag = /^<(\/?)(a|code|pre)\b/i.exec(part);
          if (tag) inside = Math.max(0, inside + (tag[1] ? -1 : 1));
          out += part;
        } else out += inside > 0 ? part : part.replace(MESSAGE_REF_RE, refer);
      }
      return out;
    }

    function quoteRefs(html, quotes) {
      const byN = new Map(quotes.map((q, i) => [q.n || i + 1, q]));
      const placed = new Set();
      const out = html.replace(/\[quote (\d+)\]/gi, (whole, n) => {
        const q = byN.get(Number(n));
        if (!q || placed.has(q)) return whole;
        placed.add(q);
        return quoteCard(q);
      });
      const orphans = quotes.filter((q) => !placed.has(q));
      return orphans.length ? out + orphans.map(quoteCard).join("") : out;
    }

    function quoteCard(q) {
      const numbered = Number(q.seq) > 0;
      const when = `${numbered ? `#${esc(String(q.seq))}` : ""}${q.ts ? `${numbered ? " · " : ""}${esc(time(q.ts))}` : ""}`;
      const goto = UI.html("button", { label: "Go to", icon: "go-to-message", kind: "link", hook: "q-goto", title: "Go to the quoted words, in the message they come from" });
      const head = `${ic("quote")}<b>${esc(q.fromName || "")}</b><span class="q-when">${when}</span>${goto}`;
      const ref = `${numbered ? ` data-seq="${esc(String(q.seq))}"` : ""}${q.id ? ` data-quoted-id="${esc(String(q.id))}"` : ""}`;
      return `<span class="quote"${ref}><span class="q-head">${head}</span><span class="q-text">${esc(q.text || "")}</span></span>`;
    }

    function imageRefs(html, images) {
      const numbers = new Set(images.map((image, i) => image.n || i + 1));
      return html.replace(/\[img (\d+)\]/gi, (whole, n) =>
        numbers.has(Number(n)) ? `<button type="button" class="img-ref" data-n="${n}" title="Image ${n}">${IMG_GLYPH}<span>${n}</span></button>` : whole,
      );
    }

    function renderTextLight(room, text, addressed) {
      let html = esc(text);
      const blocks = [];
      html = html.replace(/```([^\n]*)\n([\s\S]*?)```/g, (m, lang, code) => {
        blocks.push(/^\s*mermaid\b/i.test(lang) ? mermaidBlock(code.trim()) : `<pre>${code}</pre>`);
        return `\u0000${blocks.length - 1}\u0000`;
      });
      html = linkify(html);
      html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
      html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
      html = mentions(room, html, addressed);
      html = html.replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[Number(i)]);
      return html;
    }
    return Object.freeze({ openLink, linkify, parseCsv, csvBlock, mermaidBlock, mentions, decorate, renderStreamingWords, renderMarkdown, renderText, soundRefs, videoRefs, messageRefs, quoteRefs, quoteCard, imageRefs, renderTextLight });
  }
  global.VIBEROOM_MESSAGE_RENDERER = Object.freeze({ create });
})(globalThis);
