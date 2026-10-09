// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { parentPort, workerData } from "node:worker_threads";
import { AgentDiscovery } from "./agent-discovery.js";

if (parentPort && workerData) {
  const discovery = new AgentDiscovery();
  discovery.installInto((workerData as { prefix: string | null }).prefix ?? null);
  discovery.refresh();
  parentPort.postMessage(discovery.snapshot());
}
