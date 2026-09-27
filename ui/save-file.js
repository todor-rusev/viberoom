// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";

  function way(doc = root.document) {
    if (doc.documentElement.dataset.viberoomDesktop) return "box";
    return typeof root.showSaveFilePicker === "function" ? "picker" : "browser";
  }

  function handOver(doc, href, name) {
    const a = doc.createElement("a");
    a.href = href;
    a.download = name;
    doc.body.appendChild(a);
    a.click();
    a.remove();
  }

  const readingTime = (bytes) => bytes ? 30000 + Math.ceil(bytes / 1024) : 600000;

  async function saveFile({ name, url, bytes, blob, description, type, extension }, doc = root.document) {
    if (way(doc) === "picker") {
      let handle;
      try {
        handle = await root.showSaveFilePicker({ suggestedName: name, ...(type ? { types: [{ description, accept: { [type]: [extension] } }] } : {}) });
      } catch (error) {
        if (error && error.name === "AbortError") return "cancelled";
        throw error;
      }
      const writable = await handle.createWritable();
      try {
        let body = blob && blob.stream();
        if (!body) {
          const response = await root.fetch(url, { signal: AbortSignal.timeout(readingTime(bytes)) });
          if (!response.ok || !response.body) throw new Error(`The file could not be read (${response.status}).`);
          body = response.body;
        }
        await body.pipeTo(writable);
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
      return "saved";
    }
    const href = blob ? root.URL.createObjectURL(blob) : url;
    handOver(doc, href, name);
    if (blob) root.setTimeout(() => root.URL.revokeObjectURL(href), 2000);
    return "handed";
  }

  function install({ doc = root.document, onError = () => {} } = {}) {
    doc.addEventListener("click", (event) => {
      const link = event.target && event.target.closest ? event.target.closest("a[download][href]") : null;
      if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || way(doc) !== "picker") return;
      event.preventDefault();
      const address = new URL(link.href, doc.baseURI);
      const name = link.getAttribute("download") || decodeURIComponent(address.pathname.split("/").pop() || "") || "file";
      saveFile({ name, url: address.href, bytes: Number(link.dataset.bytes) || 0 }, doc).catch(onError);
    });
  }

  root.VIBEROOM_SAVE = { saveFile, way, install };
})(typeof window !== "undefined" ? window : globalThis);
