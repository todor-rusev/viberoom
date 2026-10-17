// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { MENTION_PATTERN } from "../mentions.js";
import { coerceSetting, ROOM_SETTINGS_SPEC, BRIEF_AFFECTING_SETTINGS, DEFAULT_ROOM_SETTINGS, type RoomSettings } from "../persona.js";
import type { TranscriptMode } from "../log.js";

export const RULE_REF_TOKEN = /@\{p:([^}]+)\}/g;

function owned(settings: RoomSettings): Readonly<RoomSettings> {
  const freeze = <T>(value: T): T => {
    if (value && typeof value === "object") { for (const inner of Object.values(value)) freeze(inner); Object.freeze(value); }
    return value;
  };
  return freeze(structuredClone(settings));
}

export interface RoomSettingsPorts {
  findByName(name: string): { id: string } | undefined;
  nameOf(id: string): string | undefined;
  departedName(id: string): string | undefined;
}

export interface ProgramRoomSettings {
  humanName: string;
  humanDescription: string;
  bypassPermissionsByDefault: boolean;
  transcripts?: TranscriptMode;
  foldAfter?: number;
  recordPrompts?: boolean;
}

export interface RoomSettingsInit {
  name: string;
  humanName: string;
  settings?: Partial<Omit<RoomSettings, "name" | "humanName">>;
  programHumanDescription: string;
  bypassPermissionsByDefault: boolean;
  programTranscripts?: TranscriptMode;
  programFoldAfter?: number;
  recordPrompts?: boolean;
}

export interface RoomSettingsUpdate {
  settings: Readonly<RoomSettings>;
  changed: string[];
  briefChanges: string[];
  unknownNames: string[];
}

export interface ProgramSettingsChange {
  humanNameChanged: boolean;
  transcriptsChanged: boolean;
  roomEventChanged: boolean;
}

export class RoomSettingsModel {
  private own: Readonly<RoomSettings>;
  private programHumanDescription: string;
  private bypassByDefault: boolean;
  private programTranscripts: TranscriptMode;
  private programFoldAfter: number;
  private keepPrompts: boolean;

  constructor(private readonly ports: RoomSettingsPorts, init: RoomSettingsInit) {
    this.own = owned({ ...DEFAULT_ROOM_SETTINGS, ...(init.settings ?? {}), name: init.name, humanName: init.humanName });
    this.programHumanDescription = init.programHumanDescription;
    this.bypassByDefault = init.bypassPermissionsByDefault;
    this.programTranscripts = init.programTranscripts ?? "off";
    this.programFoldAfter = init.programFoldAfter ?? 1200;
    this.keepPrompts = init.recordPrompts === true;
  }

  get value(): Readonly<RoomSettings> {
    return this.own;
  }
  get bypassPermissionsByDefault(): boolean {
    return this.bypassByDefault;
  }
  get recordPrompts(): boolean {
    return this.keepPrompts;
  }
  get foldAfter(): number {
    return this.own.foldAfter ?? this.programFoldAfter;
  }
  get transcriptMode(): TranscriptMode {
    return this.own.transcripts === "inherit" ? this.programTranscripts : this.own.transcripts;
  }

  applyProgram(program: ProgramRoomSettings): ProgramSettingsChange {
    this.bypassByDefault = program.bypassPermissionsByDefault;
    const transcriptsChanged = !!program.transcripts;
    if (program.transcripts) this.programTranscripts = program.transcripts;
    if (program.foldAfter) this.programFoldAfter = program.foldAfter;
    if (program.recordPrompts !== undefined) this.keepPrompts = program.recordPrompts;
    let roomEventChanged = false;
    const humanNameChanged = program.humanName !== this.own.humanName;
    if (humanNameChanged) {
      this.own = owned({ ...this.own, humanName: program.humanName });
      roomEventChanged = true;
    }
    if (program.humanDescription !== this.programHumanDescription) {
      this.programHumanDescription = program.humanDescription;
      if (this.own.humanDescriptionMode !== "override") roomEventChanged = true;
    }
    return { humanNameChanged, transcriptsChanged, roomEventChanged };
  }

  rename(name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 60) throw new Error("room name must be 1-60 characters");
    if (trimmed === this.own.name) return false;
    this.own = owned({ ...this.own, name: trimmed });
    return true;
  }

  update(patch: Record<string, unknown>, guardRules: (text: string, limit: number) => string): RoomSettingsUpdate {
    const next: RoomSettings = { ...this.own };
    const changed: string[] = [];
    let unknown: string[] = [];
    for (const key of Object.keys(ROOM_SETTINGS_SPEC) as (keyof RoomSettings)[]) {
      if (patch[key] === undefined || ROOM_SETTINGS_SPEC[key].kind === "own-path") continue;
      let value: RoomSettings[typeof key] = coerceSetting(key, patch[key]);
      if (key === "customRules") {
        const resolved = this.resolveRules(guardRules(value as string, next.briefTextLimit));
        unknown = resolved.unknown;
        value = resolved.stored;
      }
      if (JSON.stringify(value) !== JSON.stringify(next[key])) {
        (next as unknown as Record<string, unknown>)[key] = value;
        changed.push(key);
      }
    }
    this.own = owned(next);
    return {
      settings: this.own,
      changed,
      briefChanges: changed.filter((c) => BRIEF_AFFECTING_SETTINGS.includes(c as keyof RoomSettings)),
      unknownNames: unknown.filter((n) => n !== "Name"),
    };
  }

  effective(): RoomSettings {
    const own = this.own.humanDescription.trim();
    const program = this.programHumanDescription.trim();
    let humanDescription = own;
    if (this.own.humanDescriptionMode === "inherit") humanDescription = program;
    else if (this.own.humanDescriptionMode === "append") humanDescription = [program, own].filter(Boolean).join(" ");
    else if (this.own.humanDescriptionMode === "none") humanDescription = "";
    return { ...this.own, humanDescription, customRules: this.rulesText() };
  }

  rulesText(): string {
    return this.renderRules(this.own.customRules);
  }

  private resolveRules(text: string): { stored: string; unknown: string[] } {
    const unknown: string[] = [];
    const stored = text.replace(MENTION_PATTERN, (whole, name: string) => {
      const p = this.ports.findByName(name);
      if (p) return `@{p:${p.id}}`;
      if (!unknown.includes(name)) unknown.push(name);
      return whole;
    });
    return { stored, unknown };
  }

  private renderRules(stored: string): string {
    return stored.replace(RULE_REF_TOKEN, (_whole, id: string) => {
      const name = this.ports.nameOf(id);
      if (name !== undefined) return `@${name}`;
      const gone = this.ports.departedName(id);
      return gone ? `@${gone} (no longer in the room)` : "@(a participant who left)";
    });
  }
}
