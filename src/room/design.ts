// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { join } from "node:path";
import type { LookCheck } from "../looks.js";
import { AGENT_SETTINGS, describeSettings, type RoomSettings } from "../persona.js";
import { applyVibemateChanges, diffSettings, lintRoomDesign, ruleLines, type RoomChangeSet, type RoomDesign, type RoomDesignContext, type SettingChange, type VibemateChange } from "../room-design.js";
import type { LookChangeSet, Participant, SkillsBridge } from "../room.js";
import { templateId, type TemplateVibemate } from "../templates.js";
import type { ProposalPlan, RoomProposal, RoomProposals } from "./proposals.js";

export interface DesignTarget {
  id: string;
  readonly settings: Readonly<RoomSettings>;
  readonly readOnly: boolean;
  describeForVisitor(sharesHistory: boolean): Record<string, unknown>;
  proposalShape(): { context: RoomDesignContext; vibemates: TemplateVibemate[] };
}

export interface RoomDesignPorts {
  id(): string;
  dir(): string;
  settings(): Readonly<RoomSettings>;
  rulesText(): string;
  skills(): SkillsBridge | undefined;
  agent(participantId: string): Participant;
  shape(): { dir: string; settings: Partial<RoomSettings>; vibemates: TemplateVibemate[] };
  findByName(name: string): Participant | undefined;
  otherRoom(selector: string | undefined): DesignTarget | null;
  brief(participant: Participant): string;
  skillsForDesign(participantId: string): RoomDesignContext["skills"];
  cards(): RoomProposals;
  postSystem(text: string): void;
  log(text: string): void;
}

export class RoomDesignTools {
  private disposed = false;

  constructor(private readonly ports: RoomDesignPorts) {}

  dispose(): void {
    this.disposed = true;
  }

  private refuseWhenEnded(refused: "not saved" | "not proposed"): void {
    if (this.disposed) throw new Error(`${refused}: the room has shut down`);
  }

  private tell(line: string, logLine: string): void {
    if (this.disposed) return;
    this.ports.postSystem(line);
    if (this.disposed) return;
    this.ports.log(logLine);
  }

  private get settings(): Readonly<RoomSettings> { return this.ports.settings(); }
  private get skills(): SkillsBridge | undefined { return this.ports.skills(); }
  private get id(): string { return this.ports.id(); }
  private get dir(): string { return this.ports.dir(); }

  describeRoomForAgent(participantId: string, selector?: string): Record<string, unknown> {
    const participant = this.ports.agent(participantId);
    const other = this.otherRoom(selector);
    if (other) return other.describeForVisitor(this.skills!.rooms!.sharesWith(this.id, other.id));
    const shape = this.ports.shape();
    const skills = this.skills ? this.skills.library.list().filter((s) => !s.problems.length && !s.draft).map((s) => ({ name: s.name, description: s.description })) : [];
    const templates = this.skills ? this.skills.templates.list().map((t) => ({ id: t.id, name: t.name, builtin: !!t.builtin })) : [];
    return {
      room: { name: this.settings.name, topic: this.settings.topic, emoji: this.settings.emoji, dir: this.dir },
      human: this.settings.humanName,
      you: participant.name,
      settings: describeSettings({ ...this.settings, customRules: this.ports.rulesText() }),
      rules: ruleLines(this.ports.rulesText()),
      vibemates: shape.vibemates.map((v) => {
        const role = v.role ?? "";
        const own = v.name === participant.name;
        return {
          name: v.name,
          tagline: v.tagline ?? "",
          ...(own ? { role } : { rolePrivate: true, roleLength: role.length }),
          avatar: v.avatar ?? "",
          skills: v.skills ?? [],
          agentType: v.agentType,
        };
      }),
      skills,
      templates,
      otherRooms: this.skills?.rooms ? this.skills.rooms.list(this.id).filter((room) => room.id !== this.id) : [],
      yourBrief: this.ports.brief(participant),
      howTo: "Settings are proposed by key with the values above; rules are one per line in customRules; a vibemate is { name, tagline, role, avatar, skills }. Another vibemate's role is private: you learn only that it has one and how long it is, and you may still propose a new one, which the human reads in full on the card. Check a design with lint_room_design, then create_template (a file for the human to pick) or propose_room_changes (a card the human applies).",
    };
  }

  private otherRoom(selector: string | undefined): DesignTarget | null {
    return this.ports.otherRoom(selector);
  }

  describeForVisitor(sharesHistory: boolean): Record<string, unknown> {
    const rows = describeSettings({ ...this.settings, customRules: this.ports.rulesText() });
    return {
      room: { id: this.id, name: this.settings.name, emoji: this.settings.emoji },
      human: this.settings.humanName,
      settings: sharesHistory ? rows : rows.map(({ value, ...row }) => (row.kind === "text" ? { ...row, valueHidden: `${String(value ?? "").length} characters; this room does not share its history with yours` } : { ...row, value })),
      howTo: "Propose settings here with propose_room_changes and room set to this room's id: the card stands in your room, and Apply changes this one. Its vibemates are proposed from inside it.",
    };
  }

  proposalShape(): { context: RoomDesignContext; vibemates: TemplateVibemate[] } {
    return { context: this.designContext("room"), vibemates: this.ports.shape().vibemates };
  }

  lintDesignForAgent(participantId: string, kind: "template" | "room", design: RoomDesign): { ok: boolean; errors: string[]; warnings: string[]; preview?: string } {
    this.ports.agent(participantId);
    const result = lintRoomDesign(design, { ...this.designContext(kind), skills: this.ports.skillsForDesign(participantId) });
    return { ok: !result.errors.length, errors: result.errors.map((e) => e.message), warnings: result.warnings.map((w) => w.message), preview: result.preview };
  }

  private designContext(kind: "template" | "room"): RoomDesignContext {
    return {
      kind,
      humanName: this.settings.humanName,
      roomName: this.settings.name,
      base: kind === "room" ? { ...this.settings, customRules: this.ports.rulesText() } : undefined,
      briefTextLimit: this.settings.briefTextLimit,
      knownSkills: this.skills ? this.skills.library.list().map((s) => s.name) : undefined,
    };
  }

  createTemplateForAgent(participantId: string, design: RoomDesign, replace: boolean): { ok: true; message: string; id: string; path: string; warnings: string[] } {
    this.refuseWhenEnded("not saved");
    const participant = this.ports.agent(participantId);
    if (!this.skills) throw new Error("templates are not available in this room");
    const result = lintRoomDesign(design, this.designContext("template"));
    if (result.errors.length) throw new Error(`not saved: ${result.errors.map((e) => e.message).join("; ")}`);
    const settings = result.settings!;
    const rest: Partial<RoomSettings> = {};
    for (const key of Object.keys(design.settings ?? {}) as (keyof RoomSettings)[]) if (AGENT_SETTINGS.includes(key)) (rest as Record<string, unknown>)[key] = settings[key];
    const draft = {
      name: String(design.name).trim(),
      description: String(design.description ?? "").trim(),
      emoji: settings.emoji || undefined,
      settings: rest,
      vibemates: (design.vibemates ?? []).map((v) => {
        const out: TemplateVibemate = { name: v.name.trim() };
        if (v.tagline?.trim()) out.tagline = v.tagline.trim();
        if (v.role?.trim()) out.role = v.role.trim();
        if (v.avatar?.trim()) out.avatar = v.avatar.trim();
        if (v.skills?.length) out.skills = v.skills.map((s) => s.trim()).filter(Boolean);
        if (typeof v.replyDelay === "number") out.replyDelay = v.replyDelay;
        return out;
      }),
    };
    const library = this.skills.templates;
    const wanted = templateId(draft.name);
    const existing = library.list().find((t) => t.id === wanted);
    let saved;
    if (existing && replace) {
      if (existing.builtin) throw new Error(`"${existing.name}" is a template viberoom ships and cannot be replaced; pick another name`);
      saved = library.overwrite(wanted, draft);
    } else saved = library.save(draft);
    this.skills.templatesChanged();
    const warnings = result.warnings.map((w) => w.message);
    this.tell(`${participant.name} ${existing && replace ? "updated" : "created"} the room template "${saved.name}" (${saved.vibemates.map((v) => v.name).join(", ") || "no vibemates"}); it is in the picker under New room.`,
      `templates: ${participant.name} ${existing && replace ? "updated" : "created"} "${saved.name}" (${saved.id})`);
    return {
      ok: true,
      message: `Template "${saved.name}" saved as ${saved.id}${existing && !replace ? ` (the name was taken, so the id got a number; pass replace: true to update your own template instead)` : ""}. The human creates a room from it under New room; nothing in this room changed.${warnings.length ? ` Warnings: ${warnings.join("; ")}` : ""}`,
      id: saved.id,
      path: join(library.dir, saved.id, "template.json"),
      warnings,
    };
  }

  proposeRoomChanges(participantId: string, why: string, changes: RoomChangeSet, roomSelector?: string): { ok: true; message: string; key: string; warnings: string[] } {
    this.refuseWhenEnded("not proposed");
    const participant = this.ports.agent(participantId);
    const target = this.otherRoom(roomSelector);
    if (target) return this.proposeSettingsFor(target, participant, why, changes);
    const shape = this.ports.shape();
    const current = shape.vibemates;
    const vibes = applyVibemateChanges(current, changes.vibemates);
    if (vibes.errors.length) throw new Error(`not proposed: ${vibes.errors.join("; ")}`);
    const touched = vibes.ops.flatMap((op) => [op.name, ...(op.fields ?? []).filter((f) => f.field === "name").map((f) => f.to)]);
    const result = lintRoomDesign({ settings: changes.settings, vibemates: vibes.next }, { ...this.designContext("room"), changedVibemates: touched });
    if (result.errors.length) throw new Error(`not proposed: ${result.errors.map((e) => e.message).join("; ")}`);
    const base = this.designContext("room").base!;
    const settingChanges = diffSettings(base, result.settings!);
    if (!settingChanges.length && !vibes.ops.length) throw new Error("not proposed: the change set leaves the room as it is");
    const touchesOwn = vibes.ops.some((op) => op.name.toLowerCase() === participant.name.toLowerCase()) || settingChanges.some((c) => c.key === "customRules");
    const ids: Record<string, string> = {};
    for (const op of vibes.ops) {
      const target = op.op === "add" ? undefined : this.ports.findByName(op.name);
      if (target) ids[op.name] = target.id;
    }
    return this.holdProposal(participant, why, undefined, settingChanges, vibes.ops, result.warnings.map((w) => w.message), touchesOwn,
      { settings: settingChanges, vibemates: vibes.next, ops: vibes.ops, ids });
  }

  private proposeSettingsFor(target: DesignTarget, participant: Participant, why: string, changes: RoomChangeSet): { ok: true; message: string; key: string; warnings: string[] } {
    const asked = changes.vibemates;
    if (asked && (asked.add?.length || asked.update?.length || asked.remove?.length)) {
      throw new Error(`not proposed: a proposal for another room changes its settings only; the vibemates of ${target.settings.name} are proposed from inside it`);
    }
    if (target.readOnly) throw new Error(`not proposed: ${target.settings.name} waits for ${this.settings.humanName} to release its record, and changes nothing until then`);
    const { context, vibemates } = target.proposalShape();
    const result = lintRoomDesign({ settings: changes.settings, vibemates }, { ...context, changedVibemates: [] });
    if (result.errors.length) throw new Error(`not proposed: ${result.errors.map((e) => e.message).join("; ")}`);
    const settingChanges = diffSettings(context.base!, result.settings!);
    if (!settingChanges.length) throw new Error(`not proposed: the change set leaves ${target.settings.name} as it is`);
    return this.holdProposal(participant, why, { id: target.id, name: target.settings.name }, settingChanges, [], result.warnings.map((w) => w.message), false,
      { settings: settingChanges, vibemates: [], ops: [], ids: {}, roomId: target.id });
  }

  private holdProposal(participant: Participant, why: string, room: RoomProposal["room"], settingChanges: SettingChange[], ops: VibemateChange[], warnings: string[], touchesOwn: boolean, plan: ProposalPlan): { ok: true; message: string; key: string; warnings: string[] } {
    const what = [...settingChanges.map((c) => c.key), ...ops.map((o) => `${o.op} ${o.name}`)].join(", ");
    const where = room ? `the room ${room.name}` : "the room";
    const proposal = this.ports.cards().hold(participant,
      { why: String(why ?? "").trim().slice(0, 600), ...(room ? { room } : {}), settings: settingChanges, vibemates: ops, warnings, touchesOwn }, plan,
      `${participant.name} proposes changes to ${where} (${what}); apply or reject them on the card.`,
      (key) => `proposal ${key} from ${participant.name}${room ? ` for ${room.name} (${room.id})` : ""}: ${what}`);
    if (!proposal) throw new Error("not proposed: the room has shut down");
    return {
      ok: true,
      message: `Proposal sent to ${this.settings.humanName} as a card in the room${room ? ` you are in, for the room ${room.name}` : ""} (${what}). Nothing changes until they apply it; you will see a room line with the outcome.${proposal.warnings.length ? ` Warnings shown on the card: ${proposal.warnings.join("; ")}` : ""}`,
      key: proposal.key,
      warnings: proposal.warnings,
    };
  }

  async describeLooksForAgent(participantId: string): Promise<Record<string, unknown>> {
    const participant = this.ports.agent(participantId);
    if (!this.skills?.looks || !this.skills.appearance) throw new Error("looks are not available in this room");
    const described = await this.skills.looks.describe();
    return { you: participant.name, human: this.settings.humanName, appearance: this.skills.appearance.current(), ...described };
  }

  async lintLookForAgent(participantId: string, raw: unknown): Promise<{ ok: boolean; id?: string; errors: { key: string; message: string }[]; warnings: { key: string; message: string }[]; report: string[] }> {
    this.ports.agent(participantId);
    if (!this.skills?.looks) throw new Error("looks are not available in this room");
    try {
      const checked = await this.skills.looks.check(raw);
      return { ok: checked.lint.ok, id: checked.spec.id, errors: checked.lint.errors.map((e) => ({ key: e.key, message: e.message })), warnings: checked.lint.warnings.map((w) => ({ key: w.key, message: w.message })), report: checked.lint.report };
    } catch (error) {
      return { ok: false, errors: [{ key: "spec", message: error instanceof Error ? error.message : String(error) }], warnings: [], report: [] };
    }
  }

  async createLookForAgent(participantId: string, raw: unknown, replace: boolean): Promise<{ ok: true; message: string; id: string; warnings: string[] }> {
    this.refuseWhenEnded("not saved");
    const participant = this.ports.agent(participantId);
    if (!this.skills?.looks) throw new Error("looks are not available in this room");
    let saved: LookCheck;
    try {
      saved = await this.skills.looks.save(raw, { author: participant.name, replace });
    } catch (error) {
      throw new Error(`not saved: ${error instanceof Error ? error.message : String(error)}`);
    }
    const warnings = saved.lint.warnings.map((w) => w.message);
    this.tell(`${participant.name} saved the look "${saved.spec.label}" (Settings → Appearance).`, `${participant.name} saved look ${saved.spec.id}`);
    return {
      ok: true,
      message: `Saved the look "${saved.spec.label}" (id ${saved.spec.id}) among ${this.settings.humanName}'s own looks: it is in Settings → Appearance now, after the looks viberoom ships. Nothing is worn until ${this.settings.humanName} picks it; propose_look_changes with look "${saved.spec.id}" offers it as a card.${warnings.length ? ` Warnings: ${warnings.join("; ")}` : ""}`,
      id: saved.spec.id,
      warnings,
    };
  }

  async proposeLookChanges(participantId: string, why: string, changes: LookChangeSet): Promise<{ ok: true; message: string; key: string; warnings: string[] }> {
    this.refuseWhenEnded("not proposed");
    const participant = this.ports.agent(participantId);
    if (!this.skills?.appearance || !this.skills.looks) throw new Error("looks are not available in this room");
    const current = this.skills.appearance.current();
    const patch: Record<string, unknown> = {};
    const rows: SettingChange[] = [];
    if (changes.look !== undefined) {
      const lookId = String(changes.look).trim();
      const known = await this.skills.appearance.ownAdjustments(lookId);
      this.refuseWhenEnded("not proposed");
      if (!known) throw new Error(`not proposed: no look "${lookId}" (the looks viberoom ships, or one of ${this.settings.humanName}'s own by its id)`);
      patch.look = lookId;
      if (lookId !== current.look) rows.push({ key: "look", from: current.look, to: lookId });
    }
    if (changes.adjust !== undefined) {
      if (!changes.adjust || typeof changes.adjust !== "object" || Array.isArray(changes.adjust)) throw new Error("not proposed: adjust is an object of adjustable keys and values");
      const lookId = String(changes.look ?? current.look);
      const own = await this.skills.appearance.ownAdjustments(lookId);
      this.refuseWhenEnded("not proposed");
      if (!own) throw new Error(`not proposed: no look "${lookId}" to fine-tune`);
      const merged = { ...(current.custom?.[lookId] ?? {}), ...(changes.adjust as Record<string, unknown>) };
      patch.custom = { [lookId]: merged };
      const previewed = this.skills.appearance.preview({ custom: { [lookId]: merged } });
      for (const key of Object.keys(changes.adjust)) {
        const from = current.custom?.[lookId]?.[key as keyof typeof current.custom[string]] ?? own.values[key] ?? "";
        const to = previewed.custom[lookId]?.[key as keyof typeof previewed.custom[string]] ?? "";
        if (String(from).toLowerCase() !== String(to).toLowerCase()) rows.push({ key: `${key} (${own.label})`, from, to });
      }
    }
    for (const key of ["chatFontSize", "scale", "font", "mono"] as const) {
      if (changes[key] === undefined) continue;
      patch[key] = changes[key];
      const previewed = this.skills.appearance.preview({ [key]: changes[key] });
      if (String(previewed[key]) !== String(current[key])) rows.push({ key: key === "chatFontSize" ? "text size" : key === "scale" ? "scale, %" : key === "font" ? "font" : "code font", from: current[key], to: previewed[key] });
    }
    this.skills.appearance.preview(patch);
    if (!rows.length) throw new Error("not proposed: the change leaves the window as it is");
    const what = rows.map((c) => c.key).join(", ");
    const proposal = this.ports.cards().hold(participant,
      { why: String(why ?? "").trim().slice(0, 600), settings: [], vibemates: [], appearance: rows, warnings: [], touchesOwn: false },
      { settings: [], vibemates: [], ops: [], ids: {}, appearance: patch },
      `${participant.name} proposes a change to how the window looks (${what}); apply or reject it on the card.`,
      (key) => `look proposal ${key} from ${participant.name}: ${what}`);
    if (!proposal) throw new Error("not proposed: the room has shut down");
    return {
      ok: true,
      message: `Proposal sent to ${this.settings.humanName} as a card in the room (${what}). It changes the whole window, not this room alone; nothing changes until they apply it, and you will see a room line with the outcome.`,
      key: proposal.key,
      warnings: [],
    };
  }
}
