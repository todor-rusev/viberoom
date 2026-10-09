// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { MemoryOutbox } from "./outbox.js";
import type { MemoryProvider, MemoryRoom } from "./provider.js";

export async function eraseEpisode(outbox: MemoryOutbox, provider: MemoryProvider, room: MemoryRoom,
  id: string, signal: AbortSignal, current: () => boolean = () => true, ours = false): Promise<"deleted" | "pending" | "unseen" | "unconfirmed" | "changed"> {
  signal.throwIfAborted();
  if (!current()) return "changed";
  if (provider.captureEpisodeImpact) {
    const impact = await provider.captureEpisodeImpact(room, id, signal);
    signal.throwIfAborted();
    if (!current()) return "changed";
    if (impact.state === "pending") return "pending";
    if (impact.state === "processed") outbox.impacts.save(provider.id, room.uuid, id, impact);
    else if (!outbox.impacts.captured(provider.id, room.uuid, id)) {
      if (ours) return "unseen";
      outbox.needsGraphRepair(provider.id, room.uuid, "episode_absent_before_impact_capture");
    }
  } else outbox.needsGraphRepair(provider.id, room.uuid, "provider_without_impact_capture");
  await provider.forgetEpisode(room, id);
  signal.throwIfAborted();
  outbox.impacts.deleted(provider.id, room.uuid, id);
  const transport = provider.writes?.transport;
  if (transport?.episodePresence) {
    const presence = await transport.episodePresence(id, signal);
    signal.throwIfAborted();
    if (presence !== "absent") return current() ? "unconfirmed" : "changed";
  }
  return current() ? "deleted" : "changed";
}
