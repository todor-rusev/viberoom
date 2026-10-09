// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { appendFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import { forgetTranscriptBudgets, reserveTranscript } from "./transcript-budget.js";

let budgetEpoch = 0;
parentPort!.on("message", (request: { id: number; path: string; budgetRoot?: string; text: string; budgetEpoch: number }) => {
  try {
    if (request.budgetEpoch !== budgetEpoch) { forgetTranscriptBudgets(); budgetEpoch = request.budgetEpoch; }
    const reservation = reserveTranscript(request.path, Buffer.byteLength(request.text), request.budgetRoot);
    appendFileSync(request.path, request.text);
    reservation.commit();
    parentPort!.postMessage({ id: request.id, ok: true, pruned: reservation.pruned });
  } catch (error) {
    forgetTranscriptBudgets();
    const code = (error as NodeJS.ErrnoException)?.code;
    parentPort!.postMessage({ id: request.id, ok: false, error: typeof code === "string" ? code : "diagnostic file refused" });
  }
});
