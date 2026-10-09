// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { Worker } from "node:worker_threads";
import { dirname, resolve, sep } from "node:path";

export const TRANSCRIPT_QUEUE_LIMITS = { bytes: 4 * 1024 * 1024, records: 4096, batchBytes: 128 * 1024 };
export interface TranscriptLine { text: string; records: number; omitted: number }
export interface TranscriptWriteResult { ok: boolean; pruned?: number; error?: string }
export interface TranscriptTarget {
  path: string;
  budgetRoot?: string;
  prepare(lines: TranscriptLine[]): { text: string; missed: number };
  settled(lines: TranscriptLine[], missed: number, result: TranscriptWriteResult): void;
}
interface Batch { target: TranscriptTarget; lines: TranscriptLine[]; bytes: number; records: number }
interface Barrier { run(): void; cancel(error: Error): void }
type Task = Batch | Barrier;
const key = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
const within = (path: string, root: string) => key(path) === key(root) || key(path).startsWith(key(root) + sep);

export class TranscriptWriter {
  private readonly queue: Task[] = [];
  private worker: Worker | null = null;
  private current: (Batch & { id: number; missed: number }) | null = null;
  private scheduled: NodeJS.Immediate | null = null;
  private serial = 0;
  private budgetEpoch = 0;
  private bytes = 0;
  private records = 0;
  private retryAt = 0;
  private readonly closed = new Set<string>();

  constructor(private readonly workerUrl = new URL("./transcript-writer-worker.js", import.meta.url)) {}

  get pending() { return { bytes: this.bytes, records: this.records }; }

  resume(root: string): void { this.closed.delete(key(root)); }
  isStopped(root: string): boolean { return this.closed.has(key(root)); }

  enqueue(target: TranscriptTarget, line: TranscriptLine): boolean {
    const bytes = Buffer.byteLength(line.text);
    if ([...this.closed].some(root => within(target.path, root)) || Date.now() < this.retryAt
      || this.bytes + bytes > TRANSCRIPT_QUEUE_LIMITS.bytes || this.records + line.records > TRANSCRIPT_QUEUE_LIMITS.records) return false;
    const tail = this.queue.at(-1);
    if (tail && "target" in tail && tail.target === target && tail.bytes + bytes <= TRANSCRIPT_QUEUE_LIMITS.batchBytes) {
      tail.lines.push(line); tail.bytes += bytes; tail.records += line.records;
    } else this.queue.push({ target, lines: [line], bytes, records: line.records });
    this.bytes += bytes; this.records += line.records;
    this.schedule();
    return true;
  }

  barrier<T>(work: () => T, waitMs?: number): Promise<T> {
    if (this.queue.filter(task => !("target" in task)).length >= 64) return Promise.reject(new Error("diagnostic writer has too many pending barriers"));
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const task = {
        run: () => { clearTimeout(timer); try { resolve(work()); } catch (error) { reject(error); } },
        cancel: (error: Error) => { clearTimeout(timer); reject(error); },
      };
      this.queue.push(task);
      if (waitMs !== undefined) timer = setTimeout(() => {
        const at = this.queue.indexOf(task);
        if (at < 0) return;
        this.queue.splice(at, 1);
        task.cancel(new Error("Diagnostic files are still being written; clearing did not run. Try again."));
      }, waitMs);
      this.schedule();
    });
  }

  flush(): Promise<void> { return this.barrier(() => {}); }

  forgetDirectory(directory: string): void {
    this.budgetEpoch++;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const task = this.queue[i];
      if ("target" in task && key(dirname(task.target.path)) === key(directory)) {
        this.queue.splice(i, 1); this.bytes -= task.bytes; this.records -= task.records;
      }
    }
  }

  async stop(root: string, waitMs: number): Promise<{ timedOut: boolean; abandonedRecords: number }> {
    this.closed.add(key(root));
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      this.flush().then(() => false, () => true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), Math.max(0, waitMs)); }),
    ]);
    clearTimeout(timer);
    if (!timedOut) return { timedOut: false, abandonedRecords: 0 };
    let abandonedRecords = 0;
    const reason = { ok: false, error: "diagnostic shutdown deadline reached" };
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const task = this.queue[i];
      if ("target" in task && within(task.target.path, root)) {
        this.queue.splice(i, 1); this.bytes -= task.bytes; this.records -= task.records;
        abandonedRecords += task.records; task.target.settled(task.lines, 0, reason);
      }
    }
    if (this.current && within(this.current.target.path, root)) {
      const worker = this.worker;
      this.worker = null;
      if (worker) {
        worker.removeAllListeners();
        worker.on("error", () => {});
        worker.unref();
        void worker.terminate().catch(() => {});
      }
      for (let i = this.queue.length - 1; i >= 0; i--) {
        const task = this.queue[i];
        if (!("target" in task)) {
          this.queue.splice(i, 1);
          task.cancel(new Error("Diagnostic recording is stopping; clearing did not run."));
        }
      }
      abandonedRecords += this.current.records;
      this.complete(reason);
    }
    this.schedule();
    return { timedOut: true, abandonedRecords };
  }

  private schedule(): void {
    if (this.current || this.scheduled) return;
    this.scheduled = setImmediate(() => { this.scheduled = null; this.pump(); });
  }

  private pump(): void {
    if (this.current) return;
    while (this.queue.length) {
      const task = this.queue.shift()!;
      if (!("target" in task)) { task.run(); continue; }
      const prepared = task.target.prepare(task.lines);
      this.current = { ...task, id: ++this.serial, missed: prepared.missed };
      try {
        if (!this.worker) this.startWorker();
        this.worker!.ref();
        this.worker!.postMessage({ id: this.current.id, path: task.target.path, budgetRoot: task.target.budgetRoot, text: prepared.text, budgetEpoch: this.budgetEpoch });
      } catch {
        this.failed("diagnostic worker could not start");
      }
      return;
    }
    this.worker?.unref();
  }

  private startWorker(): void {
    const worker = this.worker = new Worker(this.workerUrl, { execArgv: [] });
    worker.on("message", (result: TranscriptWriteResult & { id: number }) => {
      if (worker !== this.worker || result.id !== this.current?.id) return;
      this.complete(result);
    });
    worker.on("error", () => { if (worker === this.worker) this.failed("diagnostic worker failed"); });
    worker.on("exit", () => { if (worker === this.worker) this.failed("diagnostic worker stopped"); });
  }

  private complete(result: TranscriptWriteResult): void {
    const current = this.current;
    this.current = null;
    if (current) {
      this.bytes -= current.bytes; this.records -= current.records;
      current.target.settled(current.lines, current.missed, result);
    }
    this.schedule();
  }

  private failed(reason: string): void {
    this.worker = null;
    this.retryAt = Date.now() + 5000;
    this.complete({ ok: false, error: reason });
    for (const task of this.queue.splice(0)) {
      if ("target" in task) {
        this.bytes -= task.bytes; this.records -= task.records;
        task.target.settled(task.lines, 0, { ok: false, error: reason });
      } else task.run();
    }
  }
}

export const transcriptWriter = new TranscriptWriter();
export const flushTranscripts = (): Promise<void> => transcriptWriter.flush();
