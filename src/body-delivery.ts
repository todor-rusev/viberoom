// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
export interface BodyDelivery {
  version: number;
  readers: Record<string, { epoch: string; version: number }>;
}
export interface BodyEdit {
  id: string; fromVersion: number; version: number; append: boolean; complete: boolean;
}
export interface BodyRow {
  id: string; from: string; kind: string;
  bodyDelivery?: BodyDelivery;
  bodyEdit?: BodyEdit;
  images?: unknown[]; quotes?: unknown[];
}
export interface BodyRef { id: string; version?: number }

export function registerBodyReader(row: BodyRow, id: string, epoch: string): boolean {
  if (row.from !== "human" || row.kind !== "chat") return false;
  const delivery = row.bodyDelivery ?? { version: 1, readers: {} };
  if (delivery.readers[id]?.epoch === epoch) return false;
  row.bodyDelivery = { ...delivery, readers: { ...delivery.readers, [id]: { epoch, version: 0 } } };
  return true;
}

export function resetBodyDelivery(row: BodyRow): void {
  const previous = row.bodyDelivery ?? { version: 1, readers: {} };
  row.bodyDelivery = { version: previous.version + 1, readers: { ...previous.readers } };
}

export function bodyRefs(rows: BodyRow[]): BodyRef[] {
  return rows.map(row => ({ id: row.id, ...(row.from === "human" && row.kind === "chat" ? { version: row.bodyDelivery?.version ?? 1 } : {}) }));
}

export function supplyBodies(rows: BodyRow[], refs: BodyRef[], id: string, epoch: string): BodyRow[] {
  const byId = new Map(rows.map(row => [row.id, row]));
  const changed = new Set<BodyRow>();
  for (const ref of refs) {
    const source = byId.get(ref.id);
    if (!source) continue;
    const edit = source.bodyEdit;
    const row = edit ? byId.get(edit.id) : source;
    if (!row?.bodyDelivery || row.from !== "human" || row.kind !== "chat") continue;
    const delivery = row.bodyDelivery;
    const prior = delivery.readers[id]?.epoch === epoch ? delivery.readers[id].version : 0;
    const version = edit ? edit.version : ref.version;
    if (!version || version > delivery.version || prior >= version) continue;
    if (edit && (!edit.complete || (edit.append && prior !== edit.fromVersion)
      || (!edit.append && (row.images?.length || row.quotes?.length) && !prior))) continue;
    row.bodyDelivery = { ...delivery, readers: { ...delivery.readers, [id]: { epoch, version } } };
    changed.add(row);
  }
  return [...changed];
}
