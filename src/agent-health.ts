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

export type TroubleKind = "login" | "not-installed" | "timeout" | "crash" | "unknown";

export interface Trouble {
  kind: TroubleKind;
  what: string;
  advice: string;
}

const LOGIN_WORDS = /\b(not logged in|log ?in required|login required|please log ?in|unauthori[sz]ed|authentication (failed|required|error)|invalid api key|api key (is )?(missing|not set|invalid)|no credentials|credentials not found|401|403|oauth|token (expired|invalid))\b/i;
const MISSING_WORDS = /\b(enoent|not found|no such file|is not recognized|command not found|spawn\w* (failed|error))\b/i;
const TIMEOUT_WORDS = /\b(timed out|timeout|took too long|did not answer|no response)\b/i;

export function classifyStartFailure(input: { error: string; stderr?: string[]; vendor: string; loginCommand?: string; installHint?: string; loginState?: LoginState }): Trouble {
  const text = [input.error, ...(input.stderr ?? [])].join("\n");
  const login = input.loginCommand ? `run \`${input.loginCommand}\` in a terminal, then try again` : `log in to ${input.vendor} in a terminal, then try again`;
  if (LOGIN_WORDS.test(text) || input.loginState === "missing") {
    return {
      kind: "login",
      what: `${input.vendor} is installed here but the hub could not get past its login.`,
      advice: `${login}. The hub never asks for credentials itself: it uses the login the vendor's own CLI keeps on this machine.`,
    };
  }
  if (MISSING_WORDS.test(text)) {
    return {
      kind: "not-installed",
      what: `The ${input.vendor} program could not be started: this machine could not find or run it.`,
      advice: input.installHint ? `Install or repair it: ${input.installHint}. Then run \`viberoom doctor\`, which lists what was found.` : "Reinstall it, then run `viberoom doctor`, which lists what was found.",
    };
  }
  if (TIMEOUT_WORDS.test(text)) {
    return {
      kind: "timeout",
      what: `${input.vendor} started but did not answer the hub in time.`,
      advice: `Start it yourself once in a terminal (\`${input.loginCommand ?? input.vendor.toLowerCase()}\`): a first run that asks something — a login, a trust prompt, an update — blocks the protocol until it is answered.`,
    };
  }
  if (/\bexited\b|\bexit code\b|\bsignal\b|\bclosed\b/i.test(text)) {
    return {
      kind: "crash",
      what: `${input.vendor} started and then stopped before the hub could talk to it.`,
      advice: `Run it once in a terminal to see what it prints; \`viberoom logs\` has the hub's side, with the agent's own last lines.`,
    };
  }
  return {
    kind: "unknown",
    what: `${input.vendor} could not be started.`,
    advice: `Run it once in a terminal to see what it says; \`viberoom logs\` has the hub's side, with the agent's own last lines.`,
  };
}
