// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash } from "node:crypto";

export interface InstructionContents {
  brief: string;
  roomRules: string;
  vibio: string;
}

export type InstructionRevisions = Record<keyof InstructionContents, string>;

export function instructionRevision(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

export function instructionBlock(tag: "room-rules" | "vibio", body: string): string {
  return `<${tag} revision="${instructionRevision(body)}">\n${body}\n</${tag}>`;
}

export function planInstructionDelivery(current: InstructionContents, previous: InstructionRevisions | undefined, forceFull: boolean, forceBrief = false) {
  const revisions: InstructionRevisions = {
    brief: instructionRevision(current.brief),
    roomRules: instructionRevision(current.roomRules),
    vibio: instructionRevision(current.vibio),
  };
  const full = forceFull || !previous;
  return {
    full,
    revisions,
    brief: full || forceBrief || revisions.brief !== previous?.brief,
    roomRules: full || revisions.roomRules !== previous?.roomRules,
    vibio: full || revisions.vibio !== previous?.vibio,
  };
}
