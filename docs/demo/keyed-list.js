// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  const KEY_NAME = /^[a-z][a-zA-Z0-9]*$/;

  const said = new Set();
  function sayOnce(message) {
    if (said.has(message)) return;
    said.add(message);
    console.warn(message);
  }

  function patch(list, items, spec) {
    const { key, id, make, fill } = spec || {};
    if (!KEY_NAME.test(key || "")) throw new Error(`a keyed list is drawn by the name of its key ("id", "at"), not by ${JSON.stringify(key)}`);
    const declared = list.dataset.keyedBy;
    if (declared && declared !== key) throw new Error(`this list is keyed by ${declared}, and this update speaks ${key}`);
    if (!declared) list.dataset.keyedBy = key;

    const kept = new Map();
    for (const node of [...list.children]) {
      const name = node.dataset[key];
      if (name === undefined || kept.has(name)) node.remove();
      else kept.set(name, node);
    }

    const drawn = [];
    const taken = new Set();
    items.forEach((item, index) => {
      const name = String(id(item, index));
      const twice = taken.has(name);
      if (twice) sayOnce(`keyed list: two items answer to ${key}=${name}; the second is built afresh on every draw`);
      let node = twice ? undefined : kept.get(name);
      const fresh = !node;
      if (fresh) node = make(item, index);
      if (node.dataset[key] !== name) node.dataset[key] = name;
      kept.delete(name);
      taken.add(name);
      if (fill) fill(node, item, index, fresh);
      if (list.children[index] !== node) list.insertBefore(node, list.children[index] || null);
      drawn.push(node);
    });
    for (const node of kept.values()) node.remove();
    return drawn;
  }

  function patchPaged(list, items, spec) {
    const { key, id, make, fill, pageSize, makePage, pageOf } = spec || {};
    if (!KEY_NAME.test(key || "")) throw new Error(`a keyed list is drawn by the name of its key ("id", "at"), not by ${JSON.stringify(key)}`);
    if (!(pageSize > 0)) throw new Error(`a paged list is drawn in pages of a size, not ${JSON.stringify(pageSize)}`);
    if (typeof makePage !== "function") throw new Error("a paged list is drawn with makePage, which builds a page the list does not have yet");
    const declared = list.dataset.keyedBy;
    if (declared && declared !== key) throw new Error(`this list is keyed by ${declared}, and this update speaks ${key}`);
    if (!declared) list.dataset.keyedBy = key;

    const names = items.map((item, index) => String(id(item, index)));
    const wanted = new Set(names);
    const pages = [];
    const kept = new Map();
    for (const child of [...list.children]) {
      if (child.dataset.page === undefined) { child.remove(); continue; }
      pages.push(child);
      for (const node of [...child.children]) {
        const name = node.dataset[key];
        if (name === undefined || kept.has(name) || !wanted.has(name)) node.remove();
        else kept.set(name, node);
      }
    }
    const byName = pageOf ? new Map(pages.map((p) => [p.dataset.page, p])) : null;
    const placedPages = new Set();
    let pageName;

    const drawn = [];
    const taken = new Set();
    let page = null;
    let pageAt = -1;
    let within = 0;
    items.forEach((item, index) => {
      const next = pageOf ? String(pageOf(item, index)) : "";
      if (pageOf ? next !== pageName || pageAt < 0 : within === 0) {
        pageAt++;
        within = 0;
        pageName = next;
        page = pageOf ? byName.get(next) : pages[pageAt];
        if (!page || placedPages.has(page)) {
          page = makePage();
          page.dataset.page = next;
          if (!pageOf) pages.push(page);
        }
        placedPages.add(page);
        if (list.children[pageAt] !== page) list.insertBefore(page, list.children[pageAt] || null);
      }
      const name = names[index];
      const twice = taken.has(name);
      if (twice) sayOnce(`keyed list: two items answer to ${key}=${name}; the second is built afresh on every draw`);
      let node = twice ? undefined : kept.get(name);
      const fresh = !node;
      if (fresh) node = make(item, index);
      if (node.dataset[key] !== name) node.dataset[key] = name;
      kept.delete(name);
      taken.add(name);
      if (fill) fill(node, item, index, fresh);
      if (page.children[within] !== node) page.insertBefore(node, page.children[within] || null);
      drawn.push(node);
      within = pageOf ? within + 1 : (within + 1) % pageSize;
    });
    for (const node of kept.values()) node.remove();
    if (pageOf) { for (const p of pages) if (!placedPages.has(p)) p.remove(); }
    else for (let i = pages.length - 1; i > pageAt; i--) pages[i].remove();
    return drawn;
  }

  root.KeyedList = { patch, patchPaged };
})(typeof window !== "undefined" ? window : globalThis);
