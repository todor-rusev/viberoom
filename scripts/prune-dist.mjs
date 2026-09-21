// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
if (!existsSync(dist)) process.exit(0);

const orphans = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { walk(path); continue; }
    const match = entry.name.match(/^(.*)\.(js|d\.ts|js\.map)$/);
    if (!match) continue;
    const source = join(root, "src", path.slice(dist.length + 1).slice(0, -match[0].length + match[1].length) + ".ts");
    if (!existsSync(source)) orphans.push(path);
  }
};
walk(dist);
for (const path of orphans) rmSync(path, { force: true });
if (orphans.length) console.log(`pruned ${orphans.length} built file${orphans.length === 1 ? "" : "s"} whose source is gone: ${orphans.map((p) => p.slice(dist.length + 1)).join(", ")}`);
