// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(() => {
  "use strict";

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
  const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "wbr"]);

  class Raw {
    constructor(html) {
      this.html = String(html ?? "");
    }
  }
  const raw = (html) => new Raw(html);

  class UiNode {
    constructor(tag, attrs, children) {
      this.tag = tag;
      this.attrs = attrs;
      this.children = children;
    }
    toString() {
      const attrs = Object.entries(this.attrs)
        .filter(([, value]) => value !== null && value !== undefined && value !== false)
        .map(([key, value]) => (value === true ? ` ${key}` : ` ${key}="${esc(value)}"`))
        .join("");
      if (VOID.has(this.tag)) return `<${this.tag}${attrs}>`;
      return `<${this.tag}${attrs}>${this.children.map(renderChild).join("")}</${this.tag}>`;
    }
    toElement() {
      const template = document.createElement("template");
      template.innerHTML = String(this);
      return template.content.firstElementChild;
    }
  }
  function renderChild(child) {
    if (child === null || child === undefined || child === false) return "";
    if (child instanceof UiNode) return String(child);
    if (child instanceof Raw) return child.html;
    return esc(child);
  }
  const h = (tag, attrs, ...children) => new UiNode(tag, attrs || {}, children.flat(Infinity));

  const registry = new Map();

  function define(name, spec) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`a UI type is named in lower-case words joined by dashes, not "${name}"`);
    if (registry.has(name)) throw new Error(`the UI type "${name}" is defined twice`);
    if (typeof spec.build !== "function") throw new Error(`the UI type "${name}" has no build function`);
    registry.set(name, {
      name,
      describe: spec.describe || "",
      props: spec.props || {},
      build: spec.build,
      states: spec.states && spec.states.length ? spec.states : ["rest"],
      samples: spec.samples || [],
    });
  }

  function checked(spec, props) {
    const out = {};
    for (const [key, rule] of Object.entries(spec.props)) {
      let value = props[key];
      if (value === undefined) {
        if (rule.required) throw new Error(`UI "${spec.name}": the prop "${key}" is required`);
        value = rule.default;
      }
      if (value !== undefined && rule.values && !rule.values.includes(value)) throw new Error(`UI "${spec.name}": "${key}" takes ${rule.values.join(" | ")}, not "${value}"`);
      out[key] = value;
    }
    for (const key of Object.keys(props)) if (!(key in spec.props)) throw new Error(`UI "${spec.name}" knows no prop "${key}"`);
    return out;
  }

  function build(name, props = {}) {
    const spec = registry.get(name);
    if (!spec) throw new Error(`no UI type "${name}"`);
    const node = spec.build(checked(spec, props), api);
    if (!(node instanceof UiNode)) throw new Error(`UI "${name}" must build a node (use ui.h)`);
    node.attrs = { "data-ui": name, ...node.attrs };
    return node;
  }
  const html = (name, props) => String(build(name, props));
  const el = (name, props) => build(name, props).toElement();

  function on(container, name, handler, type = "click") {
    container.addEventListener(type, (event) => {
      const target = event.target.closest(`[data-ui="${name}"]`);
      if (!target || !container.contains(target)) return;
      handler(target.dataset.act, target, event);
    });
  }

  const icon = (name, cls) => raw(globalThis.Icons.svg(name, cls));

  function setState(element, state) {
    if (!element) return;
    if (state) element.dataset.state = state;
    else delete element.dataset.state;
  }

  function dataAttrs(data) {
    const out = {};
    for (const [key, value] of Object.entries(data || {})) {
      if (value === undefined || value === null || value === false) continue;
      out[`data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = value === true ? true : String(value);
    }
    return out;
  }

  const api = { define, build, html, el, on, h, raw, esc, icon, setState, dataAttrs, types: () => [...registry.values()], type: (name) => registry.get(name) };
  globalThis.UI = api;
})();
