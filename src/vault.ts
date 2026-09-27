// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.js";
import { guardSecret } from "./redact.js";

export const VAULT_FILE = "vault.json";
export const VAULT_KEY_FILE = "vault-key";

const REF_PREFIX = "vault:";

export const isVaultRef = (value: unknown): value is string => typeof value === "string" && value.startsWith(REF_PREFIX);
export const vaultRef = (name: string): string => REF_PREFIX + name;
export const vaultRefName = (ref: string): string => ref.slice(REF_PREFIX.length);

export class VaultError extends Error {}

export interface Keeper {
  id: string;
  load(dataDir: string): Buffer | null;
  store(dataDir: string, key: Buffer): void;
}

interface VaultFileShape {
  version: 1;
  keeper: string;
  box: string;
}


const run = (command: string, args: string[], input?: string): string =>
  execFileSync(command, args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true, timeout: 30_000 }).trim();

const dpapiKeeper: Keeper = {
  id: "dpapi",
  load(dataDir) {
    const path = join(dataDir, `${VAULT_KEY_FILE}.dpapi`);
    if (!existsSync(path)) return null;
    const out = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String([Console]::In.ReadToEnd()), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser))",
    ], readFileSync(path, "utf8").trim());
    return Buffer.from(out, "base64");
  },
  store(dataDir, key) {
    const wrapped = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String([Console]::In.ReadToEnd()), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser))",
    ], key.toString("base64"));
    if (!wrapped) throw new VaultError("DPAPI returned nothing for the master key");
    writeFileAtomic(join(dataDir, `${VAULT_KEY_FILE}.dpapi`), wrapped + "\n");
  },
};

const keychainKeeper: Keeper = {
  id: "keychain",
  load() {
    try {
      const out = run("security", ["find-generic-password", "-s", "viberoom-vault", "-a", "hub", "-w"]);
      return out ? Buffer.from(out, "hex") : null;
    } catch (error) {
      if (/could not be found|SecKeychainSearchCopyNext/i.test(String((error as Error).message) + String((error as { stderr?: unknown }).stderr ?? ""))) return null;
      throw error;
    }
  },
  store(_dataDir, key) {
    run("security", ["-i"], `add-generic-password -U -s viberoom-vault -a hub -w ${key.toString("hex")}\n`);
  },
};

const secretServiceKeeper: Keeper = {
  id: "secret-service",
  load() {
    try {
      const out = run("secret-tool", ["lookup", "service", "viberoom-vault"]);
      return out ? Buffer.from(out, "hex") : null;
    } catch (error) {
      if ((error as { status?: number }).status === 1 && !String((error as { stderr?: unknown }).stderr ?? "").trim()) return null;
      throw error;
    }
  },
  store(_dataDir, key) {
    run("secret-tool", ["store", "--label=viberoom vault", "service", "viberoom-vault"], key.toString("hex"));
  },
};

const fileKeeper: Keeper = {
  id: "file",
  load(dataDir) {
    const path = join(dataDir, VAULT_KEY_FILE);
    if (!existsSync(path)) return null;
    return Buffer.from(readFileSync(path, "utf8").trim(), "hex");
  },
  store(dataDir, key) {
    const path = join(dataDir, VAULT_KEY_FILE);
    writeFileAtomic(path, key.toString("hex") + "\n");
    if (process.platform !== "win32") chmodSync(path, 0o600);
  },
};

export function defaultKeepers(platform: NodeJS.Platform = process.platform): Keeper[] {
  if (platform === "win32") return [dpapiKeeper, fileKeeper];
  if (platform === "darwin") return [keychainKeeper, fileKeeper];
  return [secretServiceKeeper, fileKeeper];
}


const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function seal(key: Buffer, secrets: Map<string, string>): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(Object.fromEntries(secrets)), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

function unseal(key: Buffer, box: string): Map<string, string> {
  const raw = Buffer.from(box, "base64");
  if (raw.length < IV_LENGTH + TAG_LENGTH) throw new VaultError("the vault file is damaged: the box is too short");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_LENGTH));
  decipher.setAuthTag(raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
  let text: string;
  try {
    text = Buffer.concat([decipher.update(raw.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString("utf8");
  } catch {
    throw new VaultError("the vault could not be opened: its key does not match its contents");
  }
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const secrets = new Map<string, string>();
  for (const [name, value] of Object.entries(parsed)) if (typeof value === "string") secrets.set(name, value);
  return secrets;
}


export class Vault {
  private constructor(
    private readonly dataDir: string,
    private readonly keeper: Keeper,
    private readonly key: Buffer,
    private readonly secrets: Map<string, string>,
  ) {
    for (const value of secrets.values()) guardSecret(value);
  }

  static open(dataDir: string, options: { keepers?: Keeper[] } = {}): Vault {
    const keepers = options.keepers ?? defaultKeepers();
    const path = join(dataDir, VAULT_FILE);
    if (existsSync(path)) {
      const file = JSON.parse(readFileSync(path, "utf8")) as Partial<VaultFileShape>;
      if (typeof file.keeper !== "string" || typeof file.box !== "string") throw new VaultError("the vault file is damaged: not the shape a vault writes");
      const keeper = keepers.find((k) => k.id === file.keeper);
      if (!keeper) throw new VaultError(`the vault was sealed by "${file.keeper}", which this platform does not have`);
      const key = keeper.load(dataDir);
      if (!key) throw new VaultError(`the vault exists but its ${keeper.id} key is gone; the keys must be entered again after the vault file is removed`);
      return new Vault(dataDir, keeper, key, unseal(key, file.box));
    }
    let refusal: unknown;
    for (const keeper of keepers) {
      try {
        const key = keeper.load(dataDir) ?? freshKey(keeper, dataDir);
        const vault = new Vault(dataDir, keeper, key, new Map());
        vault.save();
        return vault;
      } catch (error) {
        refusal = error;
      }
    }
    throw new VaultError(`no keeper could seal a vault: ${(refusal as Error)?.message ?? "unknown refusal"}`);
  }

  get keeperId(): string {
    return this.keeper.id;
  }

  get(name: string): string | null {
    return this.secrets.get(name) ?? null;
  }

  resolve(value: unknown): string {
    if (!isVaultRef(value)) return typeof value === "string" ? value : "";
    return this.get(vaultRefName(value)) ?? "";
  }

  set(name: string, value: string): void {
    if (!value) {
      this.secrets.delete(name);
    } else {
      this.secrets.set(name, value);
      guardSecret(value);
    }
    this.save();
  }

  delete(name: string): void {
    if (this.secrets.delete(name)) this.save();
  }

  names(): string[] {
    return [...this.secrets.keys()];
  }

  private save(): void {
    const path = join(this.dataDir, VAULT_FILE);
    const file: VaultFileShape = { version: 1, keeper: this.keeper.id, box: seal(this.key, this.secrets) };
    writeFileAtomic(path, JSON.stringify(file, null, 2) + "\n");
    if (process.platform !== "win32") chmodSync(path, 0o600);
  }
}

function freshKey(keeper: Keeper, dataDir: string): Buffer {
  const key = randomBytes(32);
  keeper.store(dataDir, key);
  const kept = keeper.load(dataDir);
  if (!kept || !kept.equals(key)) throw new VaultError(`the ${keeper.id} keeper did not keep the key it was given`);
  return key;
}
