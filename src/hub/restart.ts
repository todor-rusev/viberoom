// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { Participant } from "../room.js";

export interface RestartView {
  askedBy: string;
  from: "window" | "telegram" | "discord" | "vibemate";
  waitingFor: string[];
  since: number;
  quietSince?: number;
  sessions?: "load" | "replay";
}

export interface RestartRoom {
  readonly id: string;
  readonly participants: Map<string, Participant>;
  turnProgressMark(participantId: string): string;
  hubRecord(text: string): void;
}

export interface RestartPorts {
  handOver(): ((sessions?: "load" | "replay") => void) | null;
  rooms(): Iterable<RestartRoom>;
  holds(room: RestartRoom): boolean;
  stillWaiting(text: string): Promise<unknown>;
  announce(view: RestartView | null): void;
  log(text: string): void;
}

const POLL_MS = 2_000;
const GIVE_UP_MS = 30_000;
const QUIET_MS = 5 * 60_000;

function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

interface Request extends RestartView {
  phase: "waiting" | "handing";
  poll: ReturnType<typeof setInterval> | null;
  giveUp: ReturnType<typeof setTimeout> | null;
  marks: string;
  quietSince: number;
  toldOfWait: boolean;
}

export class RestartCoordinator {
  private current: Request | null = null;
  private disposed = false;
  private said = 0;

  constructor(private readonly ports: RestartPorts) {}

  dispose(): void {
    this.disposed = true;
    if (this.current) this.release(this.current);
  }

  writingNow(): string[] {
    const names: string[] = [];
    for (const room of this.ports.rooms()) {
      for (const p of room.participants.values()) if (p.kind === "agent" && (p.status === "thinking" || p.status === "queued")) names.push(p.name);
    }
    return names;
  }

  pending(): RestartView | null {
    return this.current ? this.view(this.current) : null;
  }

  private view(req: Request): RestartView {
    const { phase: _phase, poll: _poll, giveUp: _giveUp, marks: _marks, quietSince, toldOfWait: _told, ...view } = req;
    return { ...view, waitingFor: [...view.waitingFor], ...(view.waitingFor.length ? { quietSince } : {}) };
  }

  private own(req: Request): boolean {
    return !this.disposed && this.current === req;
  }

  private writingMarks(): string {
    const marks: string[] = [];
    for (const room of this.ports.rooms()) {
      for (const p of room.participants.values()) {
        if (p.kind !== "agent" || (p.status !== "thinking" && p.status !== "queued")) continue;
        marks.push(`${room.id}:${p.id}:${p.status}:${room.turnProgressMark(p.id)}`);
      }
    }
    return marks.join("|");
  }

  private recordEverywhere(text: string, still: () => boolean): boolean {
    for (const room of [...this.ports.rooms()]) {
      if (!still()) return false;
      if (this.ports.holds(room) && still()) room.hubRecord(text);
    }
    return still();
  }

  private announce(still: () => boolean): boolean {
    if (!still()) return false;
    this.ports.announce(this.pending());
    return still();
  }

  private release(req: Request): void {
    if (req.poll) clearInterval(req.poll);
    if (req.giveUp) clearTimeout(req.giveUp);
    req.poll = req.giveUp = null;
    if (this.current === req) this.current = null;
  }

  request(input: { askedBy: string; from: RestartView["from"]; room?: string; sessions?: "load" | "replay"; when: "now" | "idle" }): RestartView {
    if (!this.ports.handOver()) throw new Error("this viberoom cannot restart itself");
    if (this.current) return this.view(this.current);
    const waiting = input.when === "idle" ? this.writingNow() : [];
    const marks = this.writingMarks();
    if (this.disposed) throw new Error("this viberoom cannot restart itself");
    if (this.current) return this.view(this.current);
    const req: Request = { askedBy: input.askedBy, from: input.from, ...(input.sessions ? { sessions: input.sessions } : {}), since: Date.now(),
      waitingFor: waiting, phase: "waiting", poll: null, giveUp: null, marks, quietSince: Date.now(), toldOfWait: false };
    this.current = req;
    this.said++;
    const accepted = this.view(req);
    const own = () => this.own(req);
    const where = input.from === "window" ? "" : input.from === "vibemate" ? (input.room ? ` from the room ${input.room}` : "")
      : ` from ${input.from === "telegram" ? "Telegram" : "Discord"}`;
    try {
      if (!this.recordEverywhere(waiting.length
        ? `${input.askedBy} asked${where} for viberoom to restart when ${nameList(waiting)} ${waiting.length > 1 ? "finish" : "finishes"}.`
        : `${input.askedBy} asked${where} for viberoom to restart now; a reply being written this moment is cut short.`, own)) return accepted;
      if (!this.announce(own)) return accepted;
      if (waiting.length) {
        req.poll = setInterval(() => this.onTimer(req, () => this.poll(req)), POLL_MS);
        req.poll.unref();
      } else this.handOver(req);
      return accepted;
    } catch (error) {
      this.release(req);
      throw error;
    }
  }

  now(by: string): void {
    const req = this.current;
    if (this.disposed || !req || !req.waitingFor.length) return;
    try {
      if (!this.recordEverywhere(`${by} chose not to wait: a reply being written this moment is cut short.`, () => this.own(req))) return;
      this.handOver(req);
    } catch (error) {
      this.release(req);
      throw error;
    }
  }

  cancel(by: string): void {
    const req = this.current;
    if (this.disposed || !req) return;
    this.release(req);
    this.outcome(`${by} called off the restart of viberoom.`);
  }

  private failed(req: Request): void {
    if (!this.own(req)) return;
    this.release(req);
    this.outcome("The restart did not happen: this viberoom is still the one running. Its log says why.");
  }

  private outcome(text: string): void {
    const mine = ++this.said;
    const latest = () => !this.disposed && this.current === null && this.said === mine;
    if (this.recordEverywhere(text, latest)) this.announce(latest);
  }

  private onTimer(req: Request, work: () => void): void {
    try { work(); }
    catch (error) {
      this.release(req);
      this.ports.log(`restart: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private poll(req: Request): void {
    if (!this.own(req) || req.phase !== "waiting") return;
    const writing = this.writingNow();
    if (!writing.length) return this.handOver(req);
    const marks = this.writingMarks();
    if (!this.own(req)) return;
    const changed = writing.join("|") !== req.waitingFor.join("|");
    if (marks !== req.marks) {
      req.marks = marks;
      req.quietSince = Date.now();
    }
    req.waitingFor = writing;
    if (changed && !this.announce(() => this.own(req))) return;
    if (!req.toldOfWait && Date.now() - req.quietSince >= QUIET_MS) {
      req.toldOfWait = true;
      const minutes = Math.round((Date.now() - req.quietSince) / 60_000);
      const words = `Nothing new from ${nameList(writing)} for ${minutes} minutes; viberoom is still waiting to restart.`;
      if (!this.recordEverywhere(words, () => this.own(req))) return;
      if (req.from !== "window") void this.ports.stillWaiting(`<b>Still waiting.</b> ${words}`).catch(() => undefined);
      this.announce(() => this.own(req));
    }
  }

  private handOver(req: Request): void {
    if (!this.own(req) || req.phase !== "waiting") return;
    req.phase = "handing";
    if (req.poll) clearInterval(req.poll);
    req.poll = null;
    req.waitingFor = [];
    req.giveUp = setTimeout(() => this.onTimer(req, () => this.failed(req)), GIVE_UP_MS);
    req.giveUp.unref();
    const own = () => this.own(req);
    if (!this.recordEverywhere("viberoom is restarting; it comes back in a few seconds.", own)) return;
    if (!this.announce(own)) return;
    const handOver = this.ports.handOver();
    if (!own()) return;
    if (!handOver) return this.failed(req);
    try { handOver(req.sessions); }
    catch (error) {
      this.ports.log(`restart hand-over failed: ${error instanceof Error ? error.message : String(error)}`);
      this.failed(req);
    }
  }

  noteBack(build: string): void {
    this.recordEverywhere(`viberoom is back (build ${build}).`, () => !this.disposed);
  }
}
