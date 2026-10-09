import type { Hub } from "../src/hub.js";
import type { ResidentDeployment, ResidentPreparation } from "../src/memory/private-trial-types.js";
export type { ResidentDeployment, ResidentPreparation } from "../src/memory/private-trial-types.js";
export function createResidentPreparation(hub: Hub, deployment: ResidentDeployment): ResidentPreparation;
