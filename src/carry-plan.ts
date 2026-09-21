// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { HistoryStore } from "./history-store.js";
import { canonicalResourceName, CarryStage, type CarryDependency, type CarryResource, type CarrySource, type PortableRoom } from "./carry-stage.js";
import { mergeCarried, type BranchChoice, type CarryBranch, type CarryState, type MergeInput } from "./carry-merge.js";
import { carryHash, type CarryAlternative, type CarryHead, type CarryRevision } from "./carry-history.js";
import type { StoredRoom } from "./hub.js";
import type { ChatMessage } from "./room.js";
import { dependencyFiles, dependencyStamp } from "./carry-dependencies.js";
import { safeDataFile } from "./file-transaction.js";
import { SkillLibrary } from "./skills.js";
import { Logger } from "./log.js";
import { writeCarryReview } from "./carry-review.js";

export interface RoomImportChoice {
  uuid: string;
  target: StoredRoom;
  made: boolean;
  conversation: boolean; settings: boolean; resources: boolean;
  setup?: "ours" | "incoming";
  branch?: BranchChoice;
  resourcesChoice?: "ours" | "incoming";
}
export interface RoomCarryPreview {
  uuid: string; targetId: string; name: string; incomingName: string; made: boolean;
  branch: (Omit<CarryBranch, "members"> & { review: { text: string; records: string } }) | null;
  settingsDiffer: boolean;
  settingsDiff: { field: string; ours: unknown; incoming: unknown }[];
  newSetup?: { settings: Record<string, unknown>; participants: Record<string, unknown>[] };
  setup: "ours" | "incoming" | null;
  counts: { added: number; replaced: number; removed: number; same: number; alternatives: number };
  resources: { write: number; already: number; missing: string[]; bytes: number; conflicts: { file: string; oursHash: string; incomingHash: string; incomingBytes: number }[] };
  workspaceHint?: string;
}
export interface PlannedRoom {
  stored: StoredRoom; setup: boolean; aliases: string[]; states: CarryState[]; revisions: CarryRevision[];
  alternatives: CarryAlternative[]; resources: CarryResource[]; heads: CarryHead[]; changed: boolean;
}
export interface PlannedDependency extends CarryDependency { targetDir: string }
export interface CarryPlanJob {
  snapshot: string; stageDir: string; dataDir: string; source: CarrySource;
  choices: RoomImportChoice[];
  dependencyChoices: Record<string, "ours" | "incoming">;
}
export interface CarryPlanPreview {
  rooms: RoomCarryPreview[];
  dependencies: { key: string; kind: string; id: string; targetDir: string; differs: boolean; choice: "ours" | "incoming" | null; files: { path: string; action: "add" | "replace" | "remove"; oursBytes: number | null; incomingBytes: number | null }[] }[];
  ready: boolean;
}

function localInput(store: HistoryStore, id: string, source: string): MergeInput {
  const all = [...store.all(id).map(message => ({ message, deletedAt: null as number | null })), ...store.deleted(id).map(g => ({ message: g.message, deletedAt: g.deletedAt }))];
  const states = store.transaction(() => all.map(state => ({ ...state, head: store.carry.ensure(id, state.message, state.deletedAt) })));
  return { states, revisions: store.carry.revisions(id), alternatives: store.carry.alternatives(id), source };
}

function localResourcePointers(original: ChatMessage): ChatMessage {
  const message = { ...original };
  if (message.images) message.images = message.images.map(image => image.sha256 ? { ...image, file: canonicalResourceName(image.file, image.sha256) } : image);
  if (message.resourceRefs) message.resourceRefs = message.resourceRefs.map(ref => ref.sha256 ? { ...ref, file: canonicalResourceName(ref.file, ref.sha256) } : ref);
  return message;
}

function localize(states: CarryState[], before: CarryState[]): CarryState[] {
  const ids = new Map(before.map(s => [s.message.id, s.message.seq]));
  const beforeById = new Map(before.map(s => [s.message.id, s]));
  const order = [...before].sort((a, b) => (a.message.displayOrder ?? a.message.seq) - (b.message.displayOrder ?? b.message.seq) || a.message.id.localeCompare(b.message.id));
  const sameOrder = states.length === order.length && states.every((s, i) => s.message.id === order[i].message.id);
  let next = 0;
  for (const seq of ids.values()) next = Math.max(next, seq);
  for (const s of states) if (!ids.has(s.message.id)) ids.set(s.message.id, ++next);
  return states.map((s, i) => {
    const message = { ...localResourcePointers(s.message), seq: ids.get(s.message.id)!, displayOrder: sameOrder ? beforeById.get(s.message.id)!.message.displayOrder : i + 1 };
    if (message.quotes) message.quotes = message.quotes.map(q => q.id && ids.has(q.id) && ids.get(q.id) !== q.seq ? { ...q, originSeq: q.originSeq ?? q.seq, seq: ids.get(q.id)! } : q);
    if (carryHash(message, s.deletedAt) !== s.head.hash) throw new Error("Localizing this archive would change the quoted content.");
    return { ...s, message };
  });
}

function setupDiff(local: StoredRoom, room: PortableRoom) {
  const fields = { name: room.name, ...room.settings, participants: room.participants ?? [] };
  const here = { name: local.name, ...local.settings, participants: local.participants } as Record<string, unknown>;
  const portableFields = ["id", "name", "agentType", "tagline", "role", "avatar", "color", "colorSlot", "launch", "muted", "createdByVibemate", "replyDelay", "skills"];
  here.participants = local.participants.map(p => Object.fromEntries(portableFields.filter(k => (p as unknown as Record<string, unknown>)[k] !== undefined).map(k => [k, (p as unknown as Record<string, unknown>)[k]])));
  return Object.entries(fields).filter(([field, value]) => JSON.stringify(here[field]) !== JSON.stringify(value)).map(([field, value]) => ({ field, ours: here[field] ?? null, incoming: value }));
}

export function prepareCarryPlan(job: CarryPlanJob): CarryPlanPreview {
  const store = new HistoryStore(job.snapshot), stage = new CarryStage(job.stageDir);
  try {
    if (!stage.meta("ready")) throw new Error("This archive has not passed validation.");
    const preview: CarryPlanPreview = { rooms: [], dependencies: [], ready: true };
    const plans: PlannedRoom[] = [];
    const fileVersions = new Map<string, string | null>();
    const directoryVersions: { path: string; hash: string }[] = [];
    const removeFiles: string[] = [];
    const rememberFile = (path: string): string | null => {
      const full = safeDataFile(job.dataDir, path);
      const hash = existsSync(full) ? lstatSync(full).isDirectory() ? "#directory" : createHash("sha256").update(readFileSync(full)).digest("hex") : null;
      fileVersions.set(path, hash); return hash;
    };
    if (!job.choices.length) throw new Error("Choose at least one room to bring in.");
    if (new Set(job.choices.map(c => c.uuid)).size !== job.choices.length || new Set(job.choices.map(c => c.target.id)).size !== job.choices.length) throw new Error("Choose each source and destination room only once in this import.");
    for (const choice of job.choices) {
      const room = stage.room(choice.uuid);
      if (!room) throw new Error("The selected room is not in this archive.");
      const priorHeads = new Map(store.carry.heads(choice.target.id).map(head => [head.id, head]));
      const priorRevisions = new Set(store.carry.revisions(choice.target.id).map(r => r.revision));
      const here = localInput(store, choice.target.id, job.source.uuid);
      const incoming = choice.conversation && room.parts.includes("conversation") ? stage.input(room.uuid) : { states: [], revisions: [], alternatives: [], source: stage.meta<CarrySource>("source")!.uuid };
      const merged = mergeCarried(here, incoming, choice.branch);
      let branch: RoomCarryPreview["branch"] = null;
      if (merged.branch) {
        const { members: _members, ...summary } = merged.branch;
        branch = { ...summary, review: writeCarryReview(stage.dir, room.name, merged.branch, here, incoming) };
      }
      const differences = choice.settings && room.parts.includes("settings") && !choice.made ? setupDiff(choice.target, room) : [];
      const useSetup = choice.settings && room.parts.includes("settings") && (choice.made || choice.setup === "incoming");
      if (merged.branch && !choice.branch || differences.length && !choice.setup) preview.ready = false;
      const resources = choice.resources && room.parts.includes("resources") ? stage.values<CarryResource>("resources", room.uuid) : [];
      const localized = localize(merged.states, here.states);
      const alternatives = merged.alternatives.map(a => ({ ...a, message: localResourcePointers(a.message) }));
      const displayStates = localized.length ? localized : localize([...here.states, ...incoming.states.filter(s => !here.states.some(h => h.message.id === s.message.id))], here.states);
      const refs = new Set([...displayStates, ...alternatives].flatMap(s => [...(s.message.images?.map(i => i.file) ?? []), ...(s.message.resourceRefs?.map(r => r.file) ?? [])]));
      const filesDir = join(job.dataDir, "rooms", choice.target.id, "files");
      const resourceConflicts: RoomCarryPreview["resources"]["conflicts"] = [];
      const writesByName = new Map<string, CarryResource>();
      let already = 0;
      for (const r of resources) {
        const file = canonicalResourceName(r.file, r.sha256);
        const destinationHash = rememberFile(join("rooms", choice.target.id, "files", file));
        if (destinationHash === r.sha256) { already++; continue; }
        const hash = rememberFile(join("rooms", choice.target.id, "files", r.file));
        if (hash && hash !== r.sha256) {
          resourceConflicts.push({ file: r.file, oursHash: hash, incomingHash: r.sha256, incomingBytes: r.bytes });
          if (choice.resourcesChoice !== "incoming") continue;
        }
        if (destinationHash) throw new Error(`The local file ${file} does not match its content-addressed name. Keep it separately or repair it before bringing in this resource.`);
        writesByName.set(file, { ...r, file });
      }
      const writes = [...writesByName.values()], available = new Set(writes.map(r => r.file));
      if (resourceConflicts.length && !choice.resourcesChoice) preview.ready = false;
      const replaceSetup = choice.made || useSetup && differences.length > 0;
      const stored: StoredRoom = useSetup && replaceSetup ? { ...choice.target, name: room.name, settings: room.settings ?? {}, participants: (room.participants ?? []) as unknown as StoredRoom["participants"] } : choice.target;
      if (choice.made) stored.name = choice.target.name;
      preview.rooms.push({ uuid: room.uuid, targetId: stored.id, name: stored.name, incomingName: room.name, made: choice.made, branch,
        settingsDiffer: differences.length > 0, settingsDiff: differences, setup: choice.settings && room.parts.includes("settings") ? choice.made ? "incoming" : choice.setup ?? null : null,
        ...(choice.made && useSetup ? { newSetup: { settings: room.settings ?? {}, participants: room.participants ?? [] } } : {}),
        counts: merged.counts, resources: { write: writes.length, already, conflicts: resourceConflicts, bytes: writes.reduce((n, r) => n + r.bytes, 0), missing: [...refs].filter(file => !available.has(file) && !existsSync(join(filesDir, file))) }, workspaceHint: room.workspaceHint,
      });
      const beforeById = new Map(here.states.map(s => [s.message.id, s]));
      const states = localized.filter(s => { const previous = beforeById.get(s.message.id); return !previous || previous.deletedAt !== s.deletedAt || JSON.stringify(previous.message) !== JSON.stringify(s.message); });
      const heads = localized.filter(s => priorHeads.get(s.message.id)?.revision !== s.head.revision).map(s => s.head);
      const revisions = merged.revisions.filter(r => !priorRevisions.has(r.revision));
      const knownAlternatives = new Map(here.alternatives.map(a => [a.revision, JSON.stringify(a)]));
      const changedAlternatives = alternatives.filter(a => knownAlternatives.get(a.revision) !== JSON.stringify(a));
      const knownAliases = new Set(store.carry.aliases(stored.id));
      const aliases = [...new Set([room.uuid, ...room.aliases])].filter(uuid => uuid !== stored.uuid && !knownAliases.has(uuid));
      plans.push({ stored, setup: replaceSetup, aliases, states, heads, revisions, alternatives: changedAlternatives, resources: writes,
        changed: !!(replaceSetup || states.length || heads.length || revisions.length || changedAlternatives.length || aliases.length || writes.length) });
    }
    const takeDependencies: PlannedDependency[] = [];
    const relevant = new Set(plans.filter((_, i) => job.choices[i].settings).flatMap(p => p.stored.participants.flatMap(person => person.skills ?? [])).map(name => name.toLowerCase()));
    const skillLibrary = new SkillLibrary(join(job.dataDir, "skills"), new Logger("carry-plan-skills"));
    if (job.choices.some(c => c.settings)) for (const dependency of stage.dependencies()) {
      if (dependency.kind === "skill" && !relevant.has(dependency.id.toLowerCase())) continue;
      const key = `${dependency.kind}:${dependency.id}`;
      const existingSkill = dependency.kind === "skill" ? skillLibrary.get(dependency.id) : undefined;
      const relativeDir = dependency.kind === "skill" ? existingSkill ? relative(job.dataDir, existingSkill.dir) : join("skills", dependency.id) : "looks";
      const dir = safeDataFile(job.dataDir, relativeDir);
      const localFiles = dependency.kind === "skill" ? dependencyFiles(dir) : dependency.files.filter(f => existsSync(join(dir, f.path))).map(f => ({ path: f.path, hash: rememberFile(join(relativeDir, f.path))!, bytes: readFileSync(join(dir, f.path)).length }));
      const byName = new Map(localFiles.map(f => [f.path, f]));
      const extra = localFiles.filter(f => !dependency.files.some(incoming => incoming.path === f.path));
      const differs = extra.length > 0 || dependency.files.some(file => byName.has(file.path) && byName.get(file.path)!.hash !== file.sha256);
      const selected = differs ? job.dependencyChoices[key] ?? null : "incoming";
      if (!selected) preview.ready = false;
      if (selected === "incoming") {
        if (extra.length || dependency.files.some(file => byName.get(file.path)?.hash !== file.sha256)) takeDependencies.push({ ...dependency, targetDir: relativeDir });
        for (const file of dependency.files) rememberFile(join(relativeDir, file.path));
        if (dependency.kind === "skill") directoryVersions.push({ path: relativeDir, hash: dependencyStamp(localFiles) });
        for (const file of extra) { removeFiles.push(join(relativeDir, file.path)); rememberFile(join(relativeDir, file.path)); }
      }
      const changed: CarryPlanPreview["dependencies"][number]["files"] = [];
      for (const file of dependency.files) if (byName.get(file.path)?.hash !== file.sha256) changed.push({ path: file.path, action: byName.has(file.path) ? "replace" : "add", oursBytes: byName.get(file.path)?.bytes ?? null, incomingBytes: file.bytes });
      for (const file of extra) changed.push({ path: file.path, action: "remove", oursBytes: file.bytes, incomingBytes: null });
      preview.dependencies.push({ key, kind: dependency.kind, id: dependency.id, targetDir: relativeDir, differs, choice: selected, files: changed });
    }
    stage.setMeta("plan", preview.ready ? { rooms: plans, dependencies: takeDependencies, removeFiles, directoryVersions, fileVersions: [...fileVersions].map(([path, hash]) => ({ path, hash })) } : null);
    stage.setMeta("preview", preview);
    return preview;
  } finally { store.close(); stage.close(); }
}
