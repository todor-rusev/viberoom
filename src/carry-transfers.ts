// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID, createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { stat } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Worker } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { writeFileAtomic } from "./atomic.js";
import { CarryStage, type CarryDependency, type CarrySource, type ExportJob, type PortableRoom } from "./carry-stage.js";
import type { CarryWorkerTask, DependencyFolder } from "./carry-worker.js";
import type { CarryPlanPreview, PlannedDependency, PlannedRoom, RoomImportChoice } from "./carry-plan.js";
import type { BranchChoice } from "./carry-merge.js";
import type { Hub, StoredRoom } from "./hub.js";
import type { Logger } from "./log.js";
import type { FileChange } from "./file-transaction.js";
import { roomForExport } from "./export-room.js";
import { FOLDER_ID_FILE } from "./identity.js";
import { isBuiltinSkill } from "./skills.js";
import { checkLookSpec } from "./looks.js";
import { portableMemory, type PortableMemory } from "./shared-memory.js";
import { dependencyFiles, dependencyStamp } from "./carry-dependencies.js";
import { safeDataFile } from "./file-transaction.js";

const MAX_UPLOAD = 1024 ** 3;
const TTL = 30 * 60_000;
interface Job {
  id: string; dir: string; touched: number; kind: "estimate" | "export" | "import";
  status: "working" | "uploaded" | "password" | "ready" | "error" | "applied";
  result?: unknown; error?: string; worker?: Worker;
  snapshot?: string; previewToken?: string;
  versions?: Map<string, { version: string | null; setup: string | null; uuid: string; memoryRevision: number }>;
  fileName?: string;
  userMemoryRevision?: number;
  applying?: boolean;
  pending?: Promise<void>;
}
interface SelectedRoom { memory?: boolean; memoryChoice?: "ours" | "incoming"; uuid: string; target?: string | null; name?: string; conversation?: boolean; settings?: boolean; resources?: boolean; setup?: "ours" | "incoming"; branch?: BranchChoice; resourcesChoice?: "ours" | "incoming" }

const json = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
const setupStamp = (room: StoredRoom) => createHash("sha256").update(JSON.stringify({ name: room.name, dir: room.dir, ...roomForExport(room as unknown as Record<string, unknown>) })).digest("hex");

export class CarryTransfers {
  private readonly jobs = new Map<string, Job>();
  private readonly root: string;
  private readonly parent: string;
  private readonly lock: DatabaseSync;
  private readonly timer: NodeJS.Timeout;
  private closing = false;
  constructor(private readonly hub: Hub, private readonly product: string, private readonly log: Logger) {
    this.parent = join(hub.dataDir, "transfers");
    mkdirSync(this.parent, { recursive: true, mode: 0o700 });
    if (lstatSync(this.parent).isSymbolicLink()) throw new Error("The transfer folder must be inside the viberoom data folder.");
    for (const entry of readdirSync(this.parent, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
      const old = join(this.parent, entry.name), lockFile = join(old, "owner.sqlite");
      if (!existsSync(lockFile)) continue;
      let lock: DatabaseSync | undefined, abandoned = false;
      try { lock = new DatabaseSync(lockFile); lock.exec("begin exclusive"); abandoned = true; lock.exec("rollback"); } catch { }
      finally { lock?.close(); }
      if (abandoned && dirname(resolve(old)) === resolve(this.parent)) {
        try { rmSync(old, { recursive: true, force: true }); } catch { this.log.warn("an abandoned transfer is still held by the file system; kept for the next cleanup"); }
      }
    }
    this.root = join(this.parent, randomUUID()); mkdirSync(this.root, { mode: 0o700 });
    this.lock = new DatabaseSync(join(this.root, "owner.sqlite")); this.lock.exec("begin exclusive");
    this.timer = setInterval(() => { for (const job of this.jobs.values()) if (job.status !== "working" && !job.applying && Date.now() - job.touched > TTL) {
      try { this.remove(job.dir); this.jobs.delete(job.id); } catch { this.log.warn("an expired transfer is still held by the file system; cleanup will retry"); }
    } }, 60_000);
    this.timer.unref();
  }
  private remove(path: string): void {
    const full = resolve(path);
    if (dirname(full) !== resolve(this.root) || !/^[0-9a-f-]{36}$/.test(full.slice(dirname(full).length + 1))) throw new Error("Invalid transfer cleanup path.");
    rmSync(full, { recursive: true, force: true });
  }
  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true; clearInterval(this.timer);
    for (const job of this.jobs.values()) {
      if (job.worker) await job.worker.terminate();
      await job.pending;
      try { this.remove(job.dir); } catch { }
    }
    this.jobs.clear();
    this.lock.exec("rollback"); this.lock.close();
    if (dirname(resolve(this.root)) === resolve(this.parent)) { try { rmSync(this.root, { recursive: true, force: true }); } catch { } }
  }
  private create(kind: Job["kind"]): Job {
    if (this.closing) throw new Error("viberoom is shutting down. Try again after it starts.");
    if ([...this.jobs.values()].filter(j => j.status === "working").length >= 2 || this.jobs.size >= 8) throw new Error("Finish or close another transfer before starting this one.");
    const id = randomUUID(), dir = join(this.root, id); mkdirSync(dir, { mode: 0o700 });
    const job: Job = { id, dir, touched: Date.now(), kind, status: "working" }; this.jobs.set(id, job); return job;
  }
  private get(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new Error("This transfer expired or viberoom restarted. Open the file again.");
    job.touched = Date.now(); return job;
  }
  private async work<T>(job: Job, task: CarryWorkerTask): Promise<T> {
    if (this.closing || this.jobs.get(job.id) !== job) throw new Error("This transfer was cancelled or viberoom is shutting down.");
    return new Promise<T>((resolve, reject) => {
      const worker = new Worker(new URL("./carry-worker.js", import.meta.url), { workerData: task, resourceLimits: { maxOldGenerationSizeMb: 1024 } });
      job.worker = worker;
      let answer: { ok: boolean; result?: T; error?: string; code?: string } | undefined, failed: Error | undefined;
      worker.once("message", value => { answer = value; });
      worker.once("error", error => { failed = error; });
      worker.once("exit", code => {
        job.worker = undefined;
        if (failed) reject(failed);
        else if (code !== 0 || !answer) reject(new Error("The transfer worker stopped before it finished. Nothing was imported."));
        else if (!answer.ok) reject(Object.assign(new Error(answer.error), { code: answer.code }));
        else resolve(answer.result as T);
      });
    });
  }
  private launch(job: Job, run: () => Promise<unknown>, final: Job["status"] = "ready"): void {
    job.status = "working"; job.error = undefined;
    job.pending = run().then(result => { job.result = result; job.status = final; job.touched = Date.now(); }, error => {
      job.status = error?.code === "password" ? "password" : "error";
      job.error = error instanceof Error ? error.message : "The transfer could not be completed.";
      job.touched = Date.now();
      this.log.warn(`carry ${job.kind}: ${job.status}`);
    });
  }
  private source(): CarrySource & { suggested: string } {
    let label = "";
    try { const held = JSON.parse(readFileSync(join(this.hub.dataDir, FOLDER_ID_FILE), "utf8")); if (typeof held.label === "string") label = held.label; } catch { }
    return { uuid: this.hub.folderId, label, suggested: hostname().slice(0, 100) };
  }
  private saveSource(raw: unknown): CarrySource {
    if (raw !== undefined && typeof raw !== "string") throw new Error("The copy's name must be text.");
    const label = typeof raw === "string" ? raw.trim() : this.source().label;
    if (!label || label.length > 100) throw new Error("Name this copy of viberoom (1–100 characters).");
    const path = join(this.hub.dataDir, FOLDER_ID_FILE), held = JSON.parse(readFileSync(path, "utf8"));
    writeFileAtomic(path, JSON.stringify({ ...held, label }, null, 2) + "\n");
    this.hub.history.carry.source(this.hub.folderId, label);
    return { uuid: this.hub.folderId, label };
  }
  private portableRooms(ids: string[]): ExportJob["rooms"] {
    if (new Set(ids).size !== ids.length) throw new Error("Choose at least one room, without repeating it.");
    return ids.map(id => {
      const room = this.hub.getRoom(id), stored = room.toStored();
      const portable = roomForExport(stored as unknown as Record<string, unknown>);
      const missingSkills = [...new Set(portable.participants.flatMap(p => p.skills as string[] ?? []))].filter(name => !this.hub.skills.get(name));
      return { id, uuid: room.uuid, name: room.name, dir: room.dir, ...portable, missingSkills };
    });
  }
  private dependencies(rooms: ExportJob["rooms"]): DependencyFolder[] {
    const names = new Set(rooms.flatMap(r => r.participants.flatMap(p => p.skills as string[] ?? [])));
    const folders: DependencyFolder[] = [];
    for (const name of names) {
      if (isBuiltinSkill(name)) continue;
      const skill = this.hub.skills.get(name);
      if (skill) folders.push({ kind: "skill", id: skill.name, dir: skill.dir });
    }
    const look = this.hub.looks.get(this.hub.settings.appearance.look);
    if (look) folders.push({ kind: "look", id: look.id, dir: this.hub.looks.dir });
    return folders;
  }
  private async snapshot(job: Job): Promise<string> {
    const path = join(job.dir, `${randomUUID()}.sqlite`);
    await this.hub.history.backup(path, { recorded: false });
    const previous = job.snapshot; job.snapshot = path;
    if (previous) rmSync(previous, { force: true });
    return path;
  }

  private inspect(job: Job, passphrase?: string): void {
    if (job.kind !== "import" || !["uploaded", "password", "error"].includes(job.status)) throw new Error("This file is already being prepared or has been inspected.");
    this.launch(job, () => this.work(job, { type: "stage", input: join(job.dir, "upload"), stageDir: join(job.dir, "stage"), passphrase }));
  }

  private choices(stage: CarryStage, selected: SelectedRoom[]): RoomImportChoice[] {
    const reserved = new Set<string>();
    return selected.map(asked => {
      if (!asked || typeof asked !== "object" || typeof asked.uuid !== "string") throw new Error("Choose a room from this archive.");
      for (const key of ["conversation", "settings", "resources"] as const) if (asked[key] !== undefined && typeof asked[key] !== "boolean") throw new Error("Part choices must be on or off.");
      const carried = stage.room(asked.uuid);
      if (!carried) throw new Error("A selected room is not in this archive.");
      const identities = new Set([carried.uuid, ...carried.aliases]);
      const matches = [...this.hub.rooms.values()].filter(r => [r.uuid, ...this.hub.history.carry.aliases(r.id)].some(id => identities.has(id)));
      if (matches.length > 1) throw new Error("This archive identifies more than one local room as the same conversation. Resolve that ambiguity before importing.");
      const existing = typeof asked.target === "string" ? this.hub.getRoom(asked.target) : matches[0];
      if (matches[0] && existing?.id !== matches[0].id) throw new Error(`This conversation already belongs to ${matches[0].name}. Import into that room.`);
      const name = typeof asked.name === "string" ? asked.name.trim() : carried.name;
      if (!name || name.length > 60) throw new Error("A new room name must be 1–60 characters.");
      const id = existing?.id ?? this.hub.importedRoomAddress(name, reserved); reserved.add(id);
      const target: StoredRoom = existing?.toStored() ?? { id, uuid: carried.uuid, name, dir: join(this.hub.dataDir, "rooms", id, "workspace"), createdAt: Date.now(), settings: {}, participants: [] };
      return { uuid: carried.uuid, target, made: !existing, conversation: asked.conversation !== false, settings: asked.settings !== false, memory: asked.memory === true, ...(asked.memoryChoice === "ours" || asked.memoryChoice === "incoming" ? { memoryChoice: asked.memoryChoice } : {}), resources: asked.resources !== false, ...(asked.resourcesChoice === "ours" || asked.resourcesChoice === "incoming" ? { resourcesChoice: asked.resourcesChoice } : {}), ...(asked.setup === "ours" || asked.setup === "incoming" ? { setup: asked.setup } : {}), ...(["ours", "incoming", "both"].includes(String(asked.branch)) ? { branch: asked.branch } : {}) };
    });
  }

  private plan(job: Job, selected: SelectedRoom[], dependencies: Record<string, "ours" | "incoming">, userMemory = false, userMemoryChoice?: "ours" | "incoming"): void {
    if (job.kind !== "import" || job.status === "working" || job.applying) throw new Error("This transfer is still being prepared.");
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies) || Object.values(dependencies).some(value => value !== "ours" && value !== "incoming")) throw new Error("Choose which shared definitions to keep.");
    const stage = new CarryStage(join(job.dir, "stage"));
    let choices: RoomImportChoice[];
    try { choices = this.choices(stage, selected); } finally { stage.close(); }
    job.previewToken = undefined;
    job.userMemoryRevision = userMemory ? this.hub.history.memory.read("user").revision : undefined;
    job.versions = new Map(choices.map(c => [c.target.id, { version: this.hub.rooms.get(c.target.id)?.historyStamp().version ?? null, setup: c.made ? null : setupStamp(c.target), uuid: c.target.uuid!, memoryRevision: this.hub.history.memory.read(`room:${c.target.uuid}`).revision }]));
    this.launch(job, async () => {
      const snapshot = await this.snapshot(job);
      const result = await this.work<CarryPlanPreview>(job, { type: "plan", job: { snapshot, stageDir: join(job.dir, "stage"), dataDir: this.hub.dataDir, source: this.source(), choices, dependencyChoices: dependencies, userMemory, userMemoryChoice } });
      job.previewToken = randomUUID();
      return { ...result, previewToken: job.previewToken };
    });
  }

  private async apply(job: Job, token: unknown): Promise<unknown> {
    if (job.status !== "ready" || !job.previewToken || token !== job.previewToken || !job.versions) throw new Error("Review this import before applying it.");
    const stage = new CarryStage(join(job.dir, "stage"));
    try {
      const plan = stage.meta<{ userMemory?: PortableMemory; rooms: PlannedRoom[]; dependencies: PlannedDependency[]; directoryVersions: { path: string; hash: string }[]; fileVersions: { path: string; hash: string | null }[] }>("plan");
      if (job.userMemoryRevision !== undefined && job.userMemoryRevision !== this.hub.history.memory.read("user").revision) throw new Error("Shared user memory changed after the preview. Review the import again.");
      if (!plan) throw new Error("Choose how to handle every conflict before importing.");
      for (const [id, expected] of job.versions) if (this.hub.history.memory.read(`room:${expected.uuid}`).revision !== expected.memoryRevision) throw new Error("Room memory changed after the preview. Review the import again; nothing was imported.");
      const files: FileChange[] = [];
      for (const dependency of plan.dependencies) {
        if (dependency.kind === "skill" && isBuiltinSkill(dependency.id)) throw new Error("Built-in skills stay with the installed viberoom. They cannot be replaced by an archive.");
        if (dependency.kind === "look") {
          if (dependency.files.length !== 1 || dependency.files[0].path !== `${dependency.id}.json`) throw new Error("This look has an invalid file layout.");
          const checked = await checkLookSpec(JSON.parse(Buffer.from(dependency.files[0].data, "base64").toString("utf8")));
          if (!checked.lint.ok || checked.spec.id !== dependency.id) throw new Error("The carried look failed validation. Nothing was imported.");
        }
        if (dependency.kind === "skill" && !dependency.files.some(f => f.path === "SKILL.md")) throw new Error("The carried skill has no SKILL.md. Nothing was imported.");
        if (dependency.kind === "skill") files.push({ path: dependency.targetDir, directory: dependency.files.map(file => ({ path: file.path, data: Buffer.from(file.data, "base64") })) });
        else for (const file of dependency.files) files.push({ path: join("looks", file.path), data: Buffer.from(file.data, "base64") });
      }
      for (const [id, at] of job.versions) {
        const room = this.hub.rooms.get(id);
        if ((room?.historyStamp().version ?? null) !== at.version || (room ? setupStamp(room.toStored()) : null) !== at.setup || (room && room.uuid !== at.uuid)) throw new Error("A target room changed after the preview. Review the import again; nothing was imported.");
      }
      for (const file of plan.fileVersions) {
        const path = safeDataFile(this.hub.dataDir, file.path);
        const hash = existsSync(path) ? lstatSync(path).isDirectory() ? "#directory" : createHash("sha256").update(readFileSync(path)).digest("hex") : null;
        if (hash !== file.hash) throw new Error("A resource, skill or look changed after the preview. Review the import again; nothing was imported.");
      }
      for (const directory of plan.directoryVersions) if (dependencyStamp(dependencyFiles(safeDataFile(this.hub.dataDir, directory.path))) !== directory.hash) throw new Error("A skill's files changed after the preview. Review the import again; nothing was imported.");
      for (const room of plan.rooms) for (const resource of room.resources) files.push({ path: join("rooms", room.stored.id, "files", resource.file), data: readFileSync(join(stage.dir, "blobs", resource.blob)) });
      const knownSources = new Map(this.hub.history.carry.sources().map(source => [source.uuid, source.label]));
      const sources = [stage.meta<CarrySource>("source")!, ...stage.db.prepare("select value from meta where key like 'source:%'").all().map(row => JSON.parse(String(row.value)) as CarrySource)];
      const changedSources = sources.filter(source => knownSources.get(source.uuid) !== source.label);
      const changes = plan.rooms.filter(room => room.changed || changedSources.length).map(p => ({ stored: p.stored, setup: p.setup }));
      if (changes.length || files.length || changedSources.length || plan.userMemory) this.hub.commitRoomTransfer(changes, files, () => {
        if (plan.userMemory) this.hub.history.memory.importScope("user", plan.userMemory);
        for (const room of plan.rooms) {
          const history = this.hub.history, id = room.stored.id;
          history.carry.importRevisions(id, room.revisions);
          if (room.memory) this.hub.history.memory.importRoom(room.stored.uuid!, room.memory);
          for (const state of room.states) {
            history.upsert(id, state.message, { track: false });
            if (state.deletedAt !== null) history.markDeleted(id, [state.message.id], state.deletedAt, { track: false });
          }
          for (const head of room.heads) history.carry.acceptHead(id, head);
          for (const alternative of room.alternatives) history.carry.archive(id, alternative);
          history.carry.addAliases(id, room.aliases);
          for (const resource of room.resources) history.carry.resource(id, resource.file, resource.sha256);
        }
        for (const source of changedSources) this.hub.history.carry.source(source.uuid, source.label);
      });
      job.status = "applied"; job.previewToken = undefined;
      for (const dependency of plan.dependencies) if (dependency.kind === "skill") this.hub.skillsChanged(dependency.id);
      if (plan.dependencies.some(d => d.kind === "look")) this.hub.emit("event", { type: "looks", looks: this.hub.looks.list() });
      const result = { userMemory: !!plan.userMemory, rooms: plan.rooms.map(r => ({ id: r.stored.id, name: r.stored.name })) };
      job.result = result;
      return result;
    } finally { stage.close(); }
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith("/api/carry")) return false;
    const path = url.pathname;
    if (req.method === "GET" && path === "/api/carry") {
      json(res, 200, { source: this.source(), userMemoryBytes: Buffer.byteLength(JSON.stringify(portableMemory(this.hub.history.memory.read("user")))), rooms: [...this.hub.rooms.values()].map(r => ({ id: r.id, uuid: r.uuid, aliases: this.hub.history.carry.aliases(r.id), name: r.name, connected: r.hasConnectedAgents, memoryBytes: Buffer.byteLength(JSON.stringify(portableMemory(this.hub.history.memory.read(`room:${r.uuid}`)))) })) }); return true;
    }
    if (req.method === "GET" && path === "/api/carry/removed") {
      const room = this.hub.getRoom(url.searchParams.get("room") ?? "");
      const key = url.searchParams.get("key");
      if (key) {
        const record = this.hub.history.carry.removedRecord(room.id, key);
        if (!record) { json(res, 404, { error: "This removed version is no longer available." }); return true; }
        if (url.searchParams.get("download") === "1") res.setHeader("Content-Disposition", 'attachment; filename="removed-record.json"');
        json(res, 200, record);
      } else {
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid removed-versions page.");
        json(res, 200, this.hub.history.carry.removedPage(room.id, offset));
      }
      return true;
    }
    const route = path.match(/^\/api\/carry\/([0-9a-f-]{36})(?:\/(download|inspect|plan|apply|cancel|dependency|review))?$/);
    if (req.method === "GET" && route) {
      const job = this.get(route[1]);
      if (route[2] === "review") {
        if (job.status !== "ready") throw new Error("Wait for the comparison to finish before saving it.");
        const stage = new CarryStage(join(job.dir, "stage"));
        let file: string | undefined;
        try {
          const room = stage.meta<CarryPlanPreview>("preview")?.rooms.find(r => r.uuid === url.searchParams.get("room"));
          file = url.searchParams.get("format") === "records" ? room?.branch?.review.records : room?.branch?.review.text;
        } finally { stage.close(); }
        if (!file || !/^review-[0-9a-f]{64}\.(md|jsonl)$/.test(file)) throw new Error("This preview has no branch comparison to save.");
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="branch-comparison.${file.endsWith(".md") ? "md" : "jsonl"}"` });
        await pipeline(createReadStream(join(job.dir, "stage", file)), res);
      } else if (route[2] === "dependency") {
        const stage = new CarryStage(join(job.dir, "stage"));
        try {
          const key = url.searchParams.get("key"), path = url.searchParams.get("path") ?? "";
          const preview = stage.meta<CarryPlanPreview>("preview")?.dependencies.find(d => d.key === key);
          const dependency = stage.dependencies().find(d => `${d.kind}:${d.id}` === key);
          if (!preview?.files.some(f => f.path === path) || !dependency) throw new Error("This file is not part of the reviewed definition.");
          const file = dependency.files.find(f => f.path === path);
          const incoming = file ? Buffer.from(file.data, "base64") : null;
          const root = safeDataFile(this.hub.dataDir, preview.targetDir);
          const current = safeDataFile(root, path);
          const ours = existsSync(current) && lstatSync(current).isFile() ? readFileSync(current) : null;
          if (url.searchParams.has("download")) {
            const side = url.searchParams.get("download"), data = side === "ours" ? ours : side === "incoming" ? incoming : null;
            if (!data) throw new Error("That side does not contain this file.");
            res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${dependency.id}-${side}-${basename(path)}`)}` }); res.end(data);
          } else {
            const describe = (data: Buffer | null) => data === null ? null : { bytes: data.length, text: data.includes(0) ? "[binary file]" : data.toString("utf8").slice(0, 8000), shortened: data.length > 8000 };
            json(res, 200, { ours: describe(ours), incoming: describe(incoming) });
          }
        } finally { stage.close(); }
      } else if (route[2] === "download") {
        if (job.kind !== "export" || job.status !== "ready") throw new Error("The export is not ready to save.");
        const file = join(job.dir, "export.viberoom"), size = (await stat(file)).size;
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": size, "Cache-Control": "no-store", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(job.fileName!)}` });
        await pipeline(createReadStream(file), res);
      } else if (!route[2]) json(res, 200, { id: job.id, kind: job.kind, status: job.applying ? "working" : job.status, result: job.result, error: job.error });
      else json(res, 404, { error: "Unknown transfer action." });
      return true;
    }
    if (req.method !== "POST") { json(res, 404, { error: "Unknown transfer action." }); return true; }
    if (path === "/api/carry/upload") {
      const length = Number(req.headers["content-length"]);
      if (Number.isFinite(length) && length > MAX_UPLOAD) { json(res, 413, { error: "This archive exceeds 1 GiB." }); req.resume(); return true; }
      const job = this.create("import"); let size = 0;
      const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; callback(size > MAX_UPLOAD ? new Error("This archive exceeds 1 GiB.") : null, chunk); } });
      try {
        await pipeline(req, limit, createWriteStream(join(job.dir, "upload"), { flags: "wx", mode: 0o600 }));
        job.status = "uploaded"; this.inspect(job);
        json(res, 202, { id: job.id });
      } catch (error) { this.remove(job.dir); this.jobs.delete(job.id); throw error; }
      return true;
    }
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error("The transfer options are too large."); chunks.push(chunk); }
    let body: Record<string, unknown>;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
    catch { throw new Error("Invalid transfer options JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Transfer options must be an object.");
    if (body.passphrase !== undefined && typeof body.passphrase !== "string") throw new Error("The passphrase must be text; it was not used.");
    for (const key of ["conversation", "settings", "resources", "memory", "userMemory"]) if (body[key] !== undefined && typeof body[key] !== "boolean") throw new Error("Part choices must be on or off.");
    if (path === "/api/carry/source") { json(res, 200, this.saveSource(body.label)); return true; }
    if (path === "/api/carry/export" || path === "/api/carry/estimate") {
      if (!Array.isArray(body.rooms) || body.rooms.some(id => typeof id !== "string")) throw new Error("Choose the rooms to carry.");
      const rooms = this.portableRooms(body.rooms as string[]), estimate = path.endsWith("estimate");
      const choice = { conversation: body.conversation !== false, settings: body.settings !== false, resources: body.resources !== false, memory: body.memory === true, userMemory: body.userMemory === true };
      if (!rooms.length && !choice.userMemory) throw new Error("Choose a room or shared user memory to export.");
      if (!estimate && !Object.values(choice).some(Boolean)) throw new Error("Choose at least one part to carry.");
      const source = estimate ? this.source() : this.saveSource(body.sourceLabel);
      const passphrase = typeof body.passphrase === "string" ? body.passphrase : undefined;
      const job = this.create(estimate ? "estimate" : "export");
      job.fileName = `${passphrase !== undefined || rooms.length !== 1 ? "viberoom" : rooms[0].name.replace(/[^\p{L}\p{N}._-]+/gu, "-")}-${new Date().toISOString().slice(0, 10)}.viberoom`;
      this.launch(job, async () => {
        const snapshot = await this.snapshot(job);
        return estimate ? this.work(job, { type: "estimate", snapshot, dataDir: this.hub.dataDir, rooms }) : this.work(job, { type: "export", folders: choice.settings ? this.dependencies(rooms) : [], job: { snapshot, dataDir: this.hub.dataDir, output: join(job.dir, "export.viberoom"), product: this.product, source, choice, rooms, dependencies: [], passphrase } });
      });
      json(res, 202, { id: job.id }); return true;
    }
    if (route) {
      const job = this.get(route[1]);
      if (route[2] === "inspect") {
        this.inspect(job, typeof body.passphrase === "string" ? body.passphrase : undefined); json(res, 202, { id: job.id });
      } else if (route[2] === "plan") {
        if (!Array.isArray(body.rooms)) throw new Error("Choose rooms from this archive.");
        this.plan(job, body.rooms as SelectedRoom[], (body.dependencies ?? {}) as Record<string, "ours" | "incoming">, body.userMemory === true, body.userMemoryChoice === "ours" || body.userMemoryChoice === "incoming" ? body.userMemoryChoice : undefined); json(res, 202, { id: job.id });
      } else if (route[2] === "apply") {
        if (job.applying) throw new Error("This import is already being applied.");
        job.applying = true;
        try { json(res, 200, await this.apply(job, body.previewToken)); } finally { job.applying = false; }
      }
      else if (route[2] === "cancel") {
        if (job.applying) throw new Error("This import is already being applied; wait for its result.");
        this.jobs.delete(job.id);
        if (job.worker) await job.worker.terminate();
        await job.pending;
        this.remove(job.dir); json(res, 200, { ok: true });
      } else json(res, 404, { error: "Unknown transfer action." });
      return true;
    }
    json(res, 404, { error: "Unknown transfer action." }); return true;
  }
}
