// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function create(uiRoot, { window: view = uiRoot.ownerDocument.defaultView, signal, tokens: TOKENS, currentRoom,
    roomRecordKey = () => null, isRecordLive = () => true, renderText, pictureData, diagramPng, shotUrl, toast, onError: showError }) {
    signal?.throwIfAborted();
    const document = uiRoot.ownerDocument, window = view, navigator = view.navigator, getComputedStyle = node => view.getComputedStyle(node);
    const lifetime = global.VIBEROOM_APP_LIFETIME.create({ window: view });


    const PORTABLE_STYLE = {
    pre: `font-family:Consolas,Menlo,'Courier New',monospace;font-size:90%;background:${TOKENS.portable.codeBg};border:1px solid ${TOKENS.portable.codeEdge};border-radius:6px;padding:8px 10px;white-space:pre-wrap`,
    code: `font-family:Consolas,Menlo,'Courier New',monospace;font-size:90%;background:${TOKENS.portable.codeBg};border-radius:4px;padding:1px 4px`,
    blockquote: `margin:6px 0;padding:2px 0 2px 10px;border-left:3px solid ${TOKENS.portable.rule};color:${TOKENS.portable.quoteInk}`,
    table: "border-collapse:collapse;margin:6px 0",
    th: `border:1px solid ${TOKENS.portable.rule};padding:4px 8px;background:${TOKENS.portable.codeBg};text-align:left`,
    td: `border:1px solid ${TOKENS.portable.rule};padding:4px 8px`,
    img: "max-width:100%;height:auto",
  };

    function copyClone(el, m) {
    const collapsed = m && el.querySelector(".text.clamped");
    let clone;
    if (collapsed) {
      clone = document.createElement("div");
      clone.innerHTML = renderText(currentRoom(), m.text, m.images, m.quotes, m.to, m.audio, m.video, m.numbersHere);
    } else clone = (el.querySelector(".text > .words") || el.querySelector(".text")).cloneNode(true);
    for (const node of clone.querySelectorAll('[data-ui="file-card"], [data-ui="icon-button"], .live-tail, .mermaid-block svg, .mm-bar')) node.remove();
    clone.classList.remove("clamped");
    return clone;
  }

    function copyableHtml(el, m) {
    const clone = copyClone(el, m);
    for (const link of clone.querySelectorAll('a.open-link, .img-ref, .audio-ref, [data-ui="message-ref"]')) link.replaceWith(document.createTextNode(link.textContent));
    return clone.innerHTML.trim();
  }

    async function portableHtml(el, m) {
    m = { ...m, images: (m.images || []).map(image => ({ ...image })) };
    const room = currentRoom(), record = roomRecordKey(room);
    const check = () => { lifetime.signal.throwIfAborted(); if (record && !isRecordLive(record)) throw new Error("The room record changed before copying finished."); };
    check();
    const holder = copyClone(el, m);
    const codeColours = new Map();
    const liveCode = [...el.querySelectorAll(".text pre > code")], copyCode = [...holder.querySelectorAll("pre > code")];
    if (liveCode.length === copyCode.length) {
      copyCode.forEach((code, i) => {
        const block = getComputedStyle(liveCode[i].parentElement);
        codeColours.set(code.parentElement, `;background:${block.backgroundColor};color:${block.color};border-color:${block.backgroundColor}`);
        const liveWords = liveCode[i].querySelectorAll(".token"), copyWords = code.querySelectorAll(".token");
        if (liveWords.length === copyWords.length) copyWords.forEach((word, j) => codeColours.set(word, `color:${getComputedStyle(liveWords[j]).color}`));
      });
    }
    for (const block of holder.querySelectorAll(".mermaid-block")) {
      const src = block.getAttribute("data-src") || "";
      try {
        const png = await lifetime.wait(diagramPng(src, lifetime.signal));
        check();
        const img = document.createElement("img");
        img.src = png.src;
        img.width = png.width;
        img.alt = "Diagram";
        block.replaceWith(img);
      } catch (error) {
        check();
        const pre = document.createElement("pre");
        pre.textContent = src;
        block.replaceWith(pre);
      }
    }
    for (const node of holder.querySelectorAll("[hidden], .mm-code, .q-goto")) node.remove();
    for (const ref of holder.querySelectorAll(".img-ref")) ref.replaceWith(document.createTextNode(`[image ${ref.dataset.n || ref.textContent.trim()}]`));
    for (const ref of holder.querySelectorAll(".audio-ref")) ref.replaceWith(document.createTextNode(`[${ref.classList.contains("video-ref") ? "video" : "sound"} ${ref.dataset.n || ref.textContent.trim()}]`));
    for (const ref of holder.querySelectorAll('[data-ui="message-ref"]')) ref.replaceWith(document.createTextNode(ref.textContent));
    for (const link of holder.querySelectorAll("a.open-link")) {
      const target = link.dataset.open || "";
      if (/^https?:\/\//i.test(target)) {
        const a = document.createElement("a");
        a.href = target;
        a.textContent = link.textContent;
        link.replaceWith(a);
      } else link.replaceWith(document.createTextNode(link.textContent));
    }
    for (const quote of holder.querySelectorAll(".quote")) {
      const block = document.createElement("blockquote");
      const head = document.createElement("b");
      head.textContent = (quote.querySelector(".q-head") || quote).textContent.trim();
      block.append(head, document.createElement("br"), (quote.querySelector(".q-text") || quote).textContent);
      quote.replaceWith(block);
    }
    for (const [i, image] of (m.images || []).entries()) {
      check();
      const figure = document.createElement("p"), n = image.n || i + 1;
      try {
        const img = document.createElement("img");
        img.src = image.url && image.url.startsWith("data:") ? image.url : await lifetime.wait(pictureData(shotUrl(room.id, image), lifetime.signal));
        check();
        img.alt = image.name || `Image ${n}`;
        figure.append(img, document.createElement("br"), `Image ${n}${image.name ? `: ${image.name}` : ""}`);
      } catch (error) {
        check();
        figure.textContent = `[Image ${n}${image.name ? `: ${image.name}` : ""} could not be copied]`;
      }
      holder.appendChild(figure);
    }
    for (const [tag, style] of Object.entries(PORTABLE_STYLE)) {
      for (const node of holder.querySelectorAll(tag)) if (!(tag === "code" && node.closest("pre"))) node.setAttribute("style", style);
    }
    for (const [node, colours] of codeColours) if (node.isConnected || holder.contains(node)) node.setAttribute("style", `${node.getAttribute("style") || ""}${colours}`.replace(/^;/, ""));
    for (const node of holder.querySelectorAll("*")) {
      for (const attr of [...node.attributes]) if (attr.name === "class" || attr.name.startsWith("data-") || ["role", "tabindex", "title"].includes(attr.name)) node.removeAttribute(attr.name);
    }
    return holder.innerHTML.trim();
  }

    async function copyMessage(el, m) {
    if (lifetime.disposed || (el.isConnected && !uiRoot.contains(el))) return;
    const text = String(m.text || "");
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const html = portableHtml(el, m).then((h) => {
          if (lifetime.disposed) throw lifetime.signal.reason;
          return new window.Blob([h], { type: "text/html" });
        });
        html.catch(() => {});
        await lifetime.wait(navigator.clipboard.write([new window.ClipboardItem({ "text/html": html, "text/plain": new window.Blob([text], { type: "text/plain" }) })]));
      } else await lifetime.wait(navigator.clipboard.writeText(text));
      if (lifetime.disposed) return;
      toast((m.images || []).length || el.querySelector(".mermaid-block") ? "Copied with its formatting, pictures and diagrams; the tool calls stayed here." : "Copied with its formatting; the tool calls stayed here.");
    } catch (error) {
      if (!lifetime.disposed) showError(error);
    }
  }
    function dispose() { lifetime.dispose(); }
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ copyClone, copyableHtml, portableHtml, copyMessage, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  global.VIBEROOM_MESSAGE_COPY = Object.freeze({ create });
})(globalThis);
