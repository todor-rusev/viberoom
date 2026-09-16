// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export type LoginState = "ok" | "missing" | "unknown";

export interface LoginProbe {
  env: string[];
  files: string[];
  command: string;
  fileless?: NodeJS.Platform[];
}

export interface LoginEvidence {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  exists: (relativePath: string) => boolean;
}

export function loginState(probe: LoginProbe | undefined, evidence: LoginEvidence): LoginState {
  if (!probe) return "unknown";
  if (probe.env.some((name) => (evidence.env[name] ?? "").trim().length > 0)) return "ok";
  if (probe.files.some((file) => evidence.exists(file))) return "ok";
  if (probe.fileless?.includes(evidence.platform)) return "unknown";
  return probe.files.length ? "missing" : "unknown";
}

export type TroubleKind = "login" | "not-installed" | "timeout" | "crash" | "limit" | "network" | "unknown";
export type TroubleAction = "login" | "retry" | "respawn";

export interface Trouble {
  kind: TroubleKind;
  what: string;
  advice: string;
  stage?: "start" | "turn";
  actions?: TroubleAction[];
  streak?: number;
}

const LIMIT_CODES = /(usage[_-]?limit|rate[_-]?limit|quota|over[_-]?(capacity|loaded)|overloaded|insufficient[_-]?(quota|credit)|too[_-]?many[_-]?requests|retry_after_\d+|\b429\b|\b529\b)/i;
const LOGIN_CODES = /(auth\w*[_-]?(error|required|failed)|unauthenticated|unauthori[sz]ed|permission[_-]?(error|denied)|invalid[_-]?(api[_-]?key|token|credentials?)|token[_-]?expired|\b401\b|\b403\b)/i;
const NETWORK_CODES = /(econn\w+|etimedout|enotfound|eai_again|network[_-]?error|service[_-]?unavailable|bad[_-]?gateway|gateway[_-]?timeout|\b50[234]\b)/i;

const LOGIN_WORDS = /\b(not logged in|log ?in required|login required|please log ?in|unauthori[sz]ed|authentication (failed|required|error)|invalid api key|api key (is )?(missing|not set|invalid)|no credentials|credentials not found|no (llm )?provider (configured|available)|401|403|oauth|token (expired|invalid))\b/i;
const MISSING_WORDS = /\b(enoent|not found|no such file|is not recognized|command not found|spawn\w* (failed|error))\b/i;
const TIMEOUT_WORDS = /\b(timed out|timeout|took too long|did not answer|no response)\b/i;

const LIMIT_WORDS = /\b(rate[ _-]?limit(ed|s)?|too many requests|429|overloaded|over capacity|at capacity|quota( exceeded)?|(usage|spend|monthly|credit) limit|limit (reached|exceeded)|usagelimitexceeded|(out of|insufficient) credits|resource[_ ]exhausted|529|try again (later|in \d|at \d))\b/i;
const NETWORK_WORDS = /\b(econnreset|econnrefused|etimedout|enotfound|eai_again|network (error|is unreachable|unreachable)|fetch failed|socket hang up|connection (reset|refused|closed|lost|error)|bad gateway|service unavailable|gateway timeout|502|503|504)\b/i;
const EXPIRED_WORDS = /\b(token (has )?expired|expired token|session expired|re-?authenticat\w*|please (log ?in|sign ?in)|sign ?in required|not authenticated|credentials? (invalid|expired|missing|revoked)|oauth (error|token))\b/i;

export function classifyTurnFailure(input: { error: string; code?: string; vendor: string; alive: boolean; loginCommand?: string; loginFromHere?: boolean }): Trouble {
  const text = input.error;
  const code = input.code ?? "";
  const v = input.vendor;
  const stage = "turn" as const;
  if (LOGIN_CODES.test(code) || LOGIN_WORDS.test(text) || EXPIRED_WORDS.test(text)) {
    return {
      stage, kind: "login",
      what: `${v} refused the last turn: its login is missing or has expired.`,
      advice: input.loginFromHere
        ? `Log in again with the button here; the turn is retried on its own once ${v} says it is logged in.`
        : `Run \`${input.loginCommand || `${v.toLowerCase()} login`}\` in a terminal, then press Retry.`,
      actions: input.alive ? ["login", "retry"] : ["login", "respawn"],
    };
  }
  if (LIMIT_CODES.test(code) || LIMIT_WORDS.test(text)) {
    return { stage, kind: "limit", what: `${v} is over its limit or overloaded right now.`, advice: "Give it a minute, then press Retry: the messages it missed are sent again.", actions: input.alive ? ["retry"] : ["respawn"] };
  }
  if (NETWORK_CODES.test(code) || NETWORK_WORDS.test(text)) {
    return { stage, kind: "network", what: `${v} could not reach its service.`, advice: "Check the connection, then press Retry: the messages it missed are sent again.", actions: input.alive ? ["retry"] : ["respawn"] };
  }
  if (!input.alive) {
    return { stage, kind: "crash", what: `${v}'s program stopped in the middle of the turn.`, advice: "Respawn it: a fresh session with its notes and the last messages; the history stays.", actions: ["respawn"] };
  }
  return { stage, kind: "unknown", what: `${v} could not finish the turn: ${text.replace(/\s+/g, " ").slice(0, 160)}`, advice: "Press Retry to send it the messages again; if it fails the same way, respawn it.", actions: ["retry", "respawn"] };
}

export function classifyStartFailure(input: { error: string; stderr?: string[]; vendor: string; loginCommand?: string; installHint?: string; loginState?: LoginState; loginFromHere?: boolean }): Trouble {
  const text = [input.error, ...(input.stderr ?? [])].join("\n");
  const stage = "start" as const;
  const login = input.loginCommand ? `run \`${input.loginCommand}\` in a terminal, then try again` : `log in to ${input.vendor} in a terminal, then try again`;
  if (LOGIN_WORDS.test(text) || input.loginState === "missing") {
    return {
      stage, kind: "login",
      what: `${input.vendor} is installed here but the room could not get past its login.`,
      advice: input.loginFromHere
        ? `Press "Log in to ${input.vendor}" below: ${input.vendor} signs you in, and the room starts it again by itself. The room never asks for credentials: it uses the login the vendor's own CLI keeps on this machine.`
        : `${login}. The room never asks for credentials itself: it uses the login the vendor's own CLI keeps on this machine.`,
      actions: ["login", "respawn"],
    };
  }
  if (MISSING_WORDS.test(text)) {
    return {
      stage, kind: "not-installed",
      what: `The ${input.vendor} program could not be started: this machine could not find or run it.`,
      advice: input.installHint ? `Install or repair it: ${input.installHint}. Then run \`viberoom doctor\`, which lists what was found.` : "Reinstall it, then run `viberoom doctor`, which lists what was found.",
    };
  }
  if (TIMEOUT_WORDS.test(text)) {
    return {
      stage, kind: "timeout", actions: ["respawn"],
      what: `${input.vendor} started but did not answer the room in time.`,
      advice: `Start it yourself once in a terminal (\`${input.loginCommand ?? input.vendor.toLowerCase()}\`): a first run that asks something — a login, a trust prompt, an update — blocks the protocol until it is answered.`,
    };
  }
  if (/\bexited\b|\bexit code\b|\bsignal\b|\bclosed\b/i.test(text)) {
    return {
      stage, kind: "crash", actions: ["respawn"],
      what: `${input.vendor} started and then stopped before the room could talk to it.`,
      advice: `Run it once in a terminal to see what it prints; \`viberoom logs\` has the room's side, with the agent's own last lines.`,
    };
  }
  return {
    stage, kind: "unknown", actions: ["respawn"],
    what: `${input.vendor} could not be started.`,
    advice: `Run it once in a terminal to see what it says; \`viberoom logs\` has the room's side, with the agent's own last lines.`,
  };
}
