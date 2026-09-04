#!/usr/bin/env node
// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = new Set(process.argv.slice(2));
const isWin = process.platform === "win32";
const main = join(root, "dist", "main.js");

function run(cmd, cmdArgs, opts = {}) {
  console.log(`> ${cmd} ${cmdArgs.join(" ")}`);
  const r = isWin && cmd === "npm" ? spawnSync(`npm ${cmdArgs.join(" ")}`, { cwd: root, stdio: "inherit", shell: true, ...opts }) : spawnSync(cmd, cmdArgs, { cwd: root, stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(" ")} failed with exit code ${r.status}`);
}

run("npm", [args.has("--clean") && existsSync(join(root, "package-lock.json")) ? "ci" : "install", "--no-audit", "--no-fund"]);
run("npm", ["run", "build"]);

if (!args.has("--no-restart")) {
  const status = spawnSync(process.execPath, [main, "status"], { encoding: "utf8" });
  if (/running/.test(status.stdout || "")) {
    console.log("a hub is running: replacing it with the new build (background, no window)");
    run(process.execPath, [main, "start", "--no-open"]);
  } else console.log("no hub running; start one with: viberoom start");
}
console.log("\nviberoom is up to date.");
