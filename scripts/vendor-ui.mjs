#!/usr/bin/env node
// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "vendor", "ui");
mkdirSync(out, { recursive: true });

const WANTED = [
  { package: "mermaid", file: "dist/mermaid.min.js", as: "mermaid.min.js", licence: "LICENSE" },
];

const lines = [];
for (const item of WANTED) {
  const dir = join(root, "node_modules", item.package);
  const from = join(dir, item.file);
  if (!existsSync(from)) throw new Error(`${item.package} is not installed (${item.file}); run npm install first`);
  copyFileSync(from, join(out, item.as));
  const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  if (item.licence && existsSync(join(dir, item.licence))) copyFileSync(join(dir, item.licence), join(out, `${item.package}-${item.licence}`));
  lines.push({ package: item.package, version, file: item.as, bytes: statSync(join(out, item.as)).size });
  console.log(`vendored ${item.package} ${version} (${item.as}, ${(statSync(join(out, item.as)).size / 1024 / 1024).toFixed(1)} MB)`);
}
writeFileSync(join(out, "vendored.json"), JSON.stringify({ vendoredAt: new Date().toISOString(), items: lines }, null, 2) + "\n");
