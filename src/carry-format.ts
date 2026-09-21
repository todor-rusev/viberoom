// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, open, rm, stat } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";

export const CARRY_SCHEMA = 3;
export const CARRY_LIMITS = { header: 4096, record: 64 * 1024 * 1024, expanded: 4 * 1024 ** 3, records: 2_000_000 };
const KDF = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export interface CarryHeader {
  format: "viberoom";
  schema: 3;
  at: string;
  encoding: "gzip";
  cipher?: { name: "aes-256-gcm"; kdf: "scrypt-32768-8-1"; salt: string; nonce: string };
}
export class CarryError extends Error {}
export class CarryPasswordNeeded extends CarryError {}

function derive(passphrase: string, salt: Buffer): Promise<Buffer> {
  if (!passphrase || Buffer.byteLength(passphrase) > 4096) throw new CarryError("Enter a passphrase of 1–4096 UTF-8 bytes. Spaces are significant.");
  return new Promise((resolve, reject) => scrypt(passphrase, salt, 32, KDF, (error, key) => error ? reject(error) : resolve(key)));
}

export async function carryHeader(path: string): Promise<{ header: CarryHeader; bytes: Buffer; size: number }> {
  const fd = await open(path, "r");
  try {
    const buffer = Buffer.alloc(CARRY_LIMITS.header);
    const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
    const end = buffer.subarray(0, bytesRead).indexOf(10);
    if (end < 0) throw new CarryError("This file has no readable viberoom header.");
    const bytes = buffer.subarray(0, end + 1);
    let value: CarryHeader;
    try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new CarryError("This file has no readable viberoom header."); }
    if (value?.schema > CARRY_SCHEMA) throw new CarryError(`This file uses format ${value.schema}. Update viberoom before opening it.`);
    if (value?.format !== "viberoom" || value.schema !== CARRY_SCHEMA || value.encoding !== "gzip" || !Number.isFinite(Date.parse(value.at))) throw new CarryError("This is not a supported viberoom archive.");
    if (value.cipher && (value.cipher.name !== "aes-256-gcm" || value.cipher.kdf !== "scrypt-32768-8-1" || !/^[a-f0-9]{32}$/.test(value.cipher.salt) || !/^[a-f0-9]{24}$/.test(value.cipher.nonce))) throw new CarryError("This archive uses an unsupported encryption header.");
    return { header: value, bytes, size: (await fd.stat()).size };
  } finally { await fd.close(); }
}

export async function writeCarry(path: string, records: Iterable<unknown> | AsyncIterable<unknown>, passphrase?: string): Promise<{ bytes: number; header: CarryHeader }> {
  const header: CarryHeader = { format: "viberoom", schema: CARRY_SCHEMA, at: new Date().toISOString(), encoding: "gzip" };
  if (passphrase !== undefined) header.cipher = { name: "aes-256-gcm", kdf: "scrypt-32768-8-1", salt: randomBytes(16).toString("hex"), nonce: randomBytes(12).toString("hex") };
  const first = Buffer.from(JSON.stringify(header) + "\n");
  const hash = createHash("sha256");
  async function* lines() {
    let count = 0, size = 0;
    for await (const record of records) {
      if (!record || typeof record !== "object" || (record as { type?: string }).type === "end") throw new CarryError("An archive record is invalid.");
      const line = Buffer.from(JSON.stringify(record) + "\n");
      size += line.length;
      if (line.length > CARRY_LIMITS.record || size > CARRY_LIMITS.expanded || ++count > CARRY_LIMITS.records) throw new CarryError("This archive exceeds the supported transfer size (64 MiB per record, 4 GiB expanded). Nothing was exported.");
      hash.update(line);
      yield line;
    }
    yield Buffer.from(JSON.stringify({ type: "end", count, sha256: hash.digest("hex") }) + "\n");
  }
  let key: Buffer | undefined;
  let owned = false;
  try {
    const fd = await open(path, "wx", 0o600);
    owned = true;
    try { await fd.writeFile(first); } finally { await fd.close(); }
    if (header.cipher) {
      key = await derive(passphrase!, Buffer.from(header.cipher.salt, "hex"));
      const cipher = createCipheriv("aes-256-gcm", key, Buffer.from(header.cipher.nonce, "hex"), { authTagLength: 16 });
      cipher.setAAD(first);
      await pipeline(Readable.from(lines()), createGzip(), cipher, createWriteStream(path, { flags: "a", mode: 0o600 }));
      await appendFile(path, cipher.getAuthTag());
    } else await pipeline(Readable.from(lines()), createGzip(), createWriteStream(path, { flags: "a", mode: 0o600 }));
    return { bytes: (await stat(path)).size, header };
  } catch (error) {
    if (owned) await rm(path, { force: true });
    throw error;
  } finally { key?.fill(0); }
}

export async function readCarry(path: string, onRecord: (record: Record<string, unknown>) => void | Promise<void>, passphrase?: string): Promise<CarryHeader> {
  const { header, bytes, size } = await carryHeader(path);
  if (header.cipher && passphrase === undefined) throw new CarryPasswordNeeded("This archive is encrypted. Enter its passphrase.");
  let key: Buffer | undefined;
  const hash = createHash("sha256");
  let total = 0, count = 0, ended = false;
  let pending: Buffer = Buffer.alloc(0);
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      (async () => {
        total += chunk.length;
        if (total > CARRY_LIMITS.expanded) throw new CarryError("This archive expands beyond 4 GiB. Nothing was imported.");
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        let end: number;
        while ((end = pending.indexOf(10)) >= 0) {
          if (end > CARRY_LIMITS.record) throw new CarryError("An archive record exceeds 64 MiB.");
          const line = pending.subarray(0, end + 1);
          pending = pending.subarray(end + 1);
          if (ended) throw new CarryError("This archive has data after its final checksum.");
          let record: Record<string, unknown>;
          try { record = JSON.parse(line.toString("utf8")); } catch { throw new CarryError("An archive record is damaged."); }
          if (!record || Array.isArray(record) || typeof record !== "object") throw new CarryError("An archive record is not an object.");
          if (record.type === "end") {
            if (record.count !== count || record.sha256 !== hash.digest("hex")) throw new CarryError("This archive does not match its checksum. Ask for another copy.");
            ended = true;
          } else {
            if (++count > CARRY_LIMITS.records) throw new CarryError("This archive contains too many records.");
            hash.update(line);
            await onRecord(record);
          }
        }
        if (pending.length > CARRY_LIMITS.record) throw new CarryError("An archive record exceeds 64 MiB.");
      })().then(() => callback(), callback);
    },
  });
  try {
    if (header.cipher) {
      if (size <= bytes.length + 16) throw new CarryError("This encrypted archive was cut short.");
      key = await derive(passphrase!, Buffer.from(header.cipher.salt, "hex"));
      const fd = await open(path, "r");
      const tag = Buffer.alloc(16);
      try { await fd.read(tag, 0, 16, size - 16); } finally { await fd.close(); }
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.cipher.nonce, "hex"), { authTagLength: 16 });
      decipher.setAAD(bytes);
      decipher.setAuthTag(tag);
      const authenticated = `${path}.${randomBytes(12).toString("hex")}.verified`;
      try {
        try {
          await pipeline(createReadStream(path, { start: bytes.length, end: size - 17 }), decipher, createWriteStream(authenticated, { flags: "wx", mode: 0o600 }));
        } catch { throw new CarryError("The passphrase is incorrect, or the encrypted archive was damaged. Nothing was imported."); }
        await pipeline(createReadStream(authenticated), createGunzip(), sink);
      } finally { await rm(authenticated, { force: true }); }
    } else await pipeline(createReadStream(path, { start: bytes.length }), createGunzip(), sink);
    if (!ended || pending.length) throw new CarryError("This archive was cut short: its final checksum is missing.");
    return header;
  } finally { key?.fill(0); }
}
