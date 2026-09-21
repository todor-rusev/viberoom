// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isBuiltinSkill, SkillLibrary } from "./skills.js";
import { Logger } from "./log.js";
import { checkLookSpec } from "./looks.js";
import type { CarryDependency } from "./carry-stage.js";

export function dependencyFiles(dir: string): { path: string; hash: string; bytes: number }[] {
  if (!existsSync(dir)) return [];
  if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) throw new Error("A skill directory is a link or not a directory.");
  const found: { path: string; hash: string; bytes: number }[] = [];
  function walk(at: string, prefix: string) {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error(`The dependency file ${path} is a link. It cannot be replaced by an import.`);
      if (entry.isDirectory()) walk(join(at, entry.name), path + "/");
      else if (entry.isFile()) {
        const bytes = readFileSync(join(at, entry.name));
        found.push({ path, hash: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
      } else throw new Error(`The dependency entry ${path} is not a regular file.`);
    }
  }
  walk(dir, "");
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

export function dependencyStamp(files: ReturnType<typeof dependencyFiles>): string {
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

export async function validateDependencies(dir: string, dependencies: CarryDependency[]): Promise<void> {
  const log = new Logger("carried-skills"); log.info = log.warn = log.error = () => {};
  const skillDir = join(dir, "checked-skills"), library = new SkillLibrary(skillDir, log);
  for (const dependency of dependencies) {
    if (dependency.kind === "look") {
      if (dependency.files.length !== 1 || dependency.files[0].path !== `${dependency.id}.json`) throw new Error("The carried look has an invalid file layout.");
      const checked = await checkLookSpec(JSON.parse(Buffer.from(dependency.files[0].data, "base64").toString("utf8")));
      if (!checked.lint.ok || checked.spec.id !== dependency.id) throw new Error(`The look ${dependency.id} does not pass validation.`);
    } else {
      if (isBuiltinSkill(dependency.id)) throw new Error("Built-in skills come from the installed viberoom and cannot be replaced by an archive.");
      for (const file of dependency.files) {
        const path = join(skillDir, dependency.id, file.path);
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(path, Buffer.from(file.data, "base64"), { mode: 0o600 });
      }
      const skill = library.get(dependency.id);
      if (!skill || skill.name !== dependency.id || skill.problems.length) throw new Error(`The skill ${dependency.id} does not pass validation: ${skill?.problems.join("; ") || "its SKILL.md is missing or unreadable"}.`);
    }
  }
}
