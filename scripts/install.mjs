#!/usr/bin/env node
// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = new Set(process.argv.slice(2));
const dataDir = process.env.VIBEROOM_DATA_DIR ? resolve(process.env.VIBEROOM_DATA_DIR) : join(homedir(), ".viberoom");
const isWin = process.platform === "win32";

function run(cmd, cmdArgs, opts = {}) {
  console.log(`> ${cmd} ${cmdArgs.join(" ")}`);
  const r = isWin && cmd === "npm" ? spawnSync(`npm ${cmdArgs.join(" ")}`, { cwd: root, stdio: "inherit", shell: true, ...opts }) : spawnSync(cmd, cmdArgs, { cwd: root, stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(" ")} failed with exit code ${r.status}`);
}

run("npm", [args.has("--clean") && existsSync(join(root, "package-lock.json")) ? "ci" : "install", "--no-audit", "--no-fund"]);
run("npm", ["run", "build"]);

if (args.has("--global")) run("npm", ["install", "-g", ".", "--no-audit", "--no-fund"]);
else run("npm", ["link", "--no-audit", "--no-fund"]);

if (!args.has("--no-shortcuts")) {
  const { installShortcuts } = await import(pathToFileURL(join(root, "dist", "shortcuts.js")).href);
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const result = installShortcuts({ root, dataDir, node: process.execPath, version, desktop: args.has("--desktop") });
  for (const file of result.files) console.log(`wrote: ${file}`);
  for (const note of result.notes) console.log(note);
}

console.log("\nviberoom is installed. Try: viberoom   (a small menu),  viberoom start   (hidden hub + app window),  viberoom status,  viberoom stop");
