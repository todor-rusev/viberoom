// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CarryBranch, CarryState, MergeInput } from "./carry-merge.js";

export function writeCarryReview(dir: string, name: string, branch: CarryBranch, ours: MergeInput, incoming: MergeInput): { text: string; records: string } {
  const collect = (input: MergeInput, ids: string[]) => { const wanted = new Set(ids); return input.states.filter(s => wanted.has(s.message.id)); };
  const sides = [
    { name: "This computer", rows: collect(ours, [...branch.members.changed, ...branch.members.ours]) },
    { name: "The incoming copy", rows: collect(incoming, [...branch.members.changed, ...branch.members.incoming]) },
  ];
  function write(extension: string, parts: Iterable<string>): string {
    const temporary = join(dir, `review-${randomUUID()}.tmp`), fd = openSync(temporary, "wx", 0o600), hash = createHash("sha256");
    try { for (const part of parts) { hash.update(part); writeFileSync(fd, part); } }
    catch (error) { closeSync(fd); rmSync(temporary, { force: true }); throw error; }
    closeSync(fd);
    const file = `review-${hash.digest("hex")}.${extension}`;
    if (existsSync(join(dir, file))) rmSync(temporary, { force: true });
    else renameSync(temporary, join(dir, file));
    return file;
  }
  function* text() {
    yield `# ${name.replace(/[\r\n]/g, " ")} — branch comparison\n\n`;
    yield "These are the complete changed messages and parallel continuations. Message numbers belong to their respective copies. Full records, including tool inputs and outputs, are available in the companion JSONL comparison.\n\n";
    for (const side of sides) {
      yield `## ${side.name}\n\n`;
      for (const row of side.rows) {
        const m = row.message;
        yield `### #${m.seq} · ${String(m.fromName ?? m.from).replace(/[\r\n]/g, " ")} · ${new Date(m.ts).toISOString()}${row.deletedAt !== null ? " · removed" : ""}${m.pinned ? " · pinned" : ""}\n\n`;
        yield `${m.text}\n\n`;
        for (const quote of m.quotes ?? []) yield `Quote ${quote.n} from ${quote.fromName} (#${quote.seq}):\n\n${quote.text.split("\n").map(line => `> ${line}`).join("\n")}\n\n`;
        for (const image of m.images ?? []) yield `Attachment: ${image.name} (${image.file}${image.sha256 ? `; SHA-256 ${image.sha256}` : ""})\n\n`;
        for (const ref of m.resourceRefs ?? []) yield `File reference: ${ref.source} → ${ref.file}${ref.sha256 ? `; SHA-256 ${ref.sha256}` : ""}\n\n`;
        if (m.toolCalls?.length) yield `Tool records: ${m.toolCalls.length}; see the full JSONL comparison.\n\n`;
        yield "---\n\n";
      }
    }
  }
  function* records() {
    yield JSON.stringify({ type: "comparison", room: name, branch: branch.key }) + "\n";
    for (const side of sides) for (const state of side.rows) yield JSON.stringify({ side: side.name, state }) + "\n";
  }
  return { text: write("md", text()), records: write("jsonl", records()) };
}
