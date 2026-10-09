#!/usr/bin/env node
// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "vendor", "ui");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const WANTED = [
  { package: "mermaid", from: "dist", as: "mermaid", keep: (rel) => rel === "mermaid.esm.min.mjs" || (rel.startsWith("chunks/mermaid.esm.min/") && rel.endsWith(".mjs")), licence: "LICENSE" },
];

function filesUnder(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? filesUnder(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]);
}

const lines = [];
for (const item of WANTED) {
  const dir = join(root, "node_modules", item.package);
  const from = join(dir, item.from);
  if (!existsSync(from)) throw new Error(`${item.package} is not installed (${item.from}); run npm install first`);
  const files = filesUnder(from).filter(item.keep);
  if (!files.length) throw new Error(`${item.package} ${item.from} has none of the files the window loads; its layout changed`);
  let bytes = 0;
  for (const rel of files) {
    const to = join(out, item.as, ...rel.split("/"));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(from, ...rel.split("/")), to);
    bytes += statSync(to).size;
  }
  const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  if (item.licence && existsSync(join(dir, item.licence))) copyFileSync(join(dir, item.licence), join(out, `${item.package}-${item.licence}`));
  lines.push({ package: item.package, version, folder: item.as, files: files.length, bytes });
  console.log(`vendored ${item.package} ${version} (${item.as}/, ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB)`);
}
writeFileSync(join(out, "vendored.json"), JSON.stringify({ vendoredAt: new Date().toISOString(), items: lines }, null, 2) + "\n");
