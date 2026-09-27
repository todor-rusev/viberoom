// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { BlockList, isIP } from "node:net";
import { admittedFetch } from "../net/outbound.js";

export class OutboundRefused extends Error {}

const GUARD_DEADLINE_MS = 60_000;

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) blocked.addSubnet(net, prefix, "ipv6");

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blocked.check(mapped[1], "ipv4");
    return blocked.check(address, "ipv6");
  }
  return false;
}

export function admitPublic(address: string, hostname: string): Error | undefined {
  return isPrivateAddress(address) ? new OutboundRefused(`${hostname} points at ${address}, an address of this machine or a private network`) : undefined;
}

export function checkOutbound(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new OutboundRefused(`"${raw}" is not an address`); }
  if (url.protocol !== "https:") throw new OutboundRefused(`${url.origin} is not HTTPS; a connection speaks only HTTPS`);
  if (url.username || url.password) throw new OutboundRefused(`${url.host} carries a user name or password in the address`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new OutboundRefused(`${host} is a name of this machine or its network`);
  if (isIP(host) && isPrivateAddress(host)) throw new OutboundRefused(`${host} is an address of this machine or a private network`);
  return url;
}

let admitted: typeof fetch | null = null;

export function guardedFetch(fetcher?: typeof fetch): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    checkOutbound(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const way = fetcher ?? (admitted ??= admittedFetch(admitPublic));
    try {
      return await way(input, { ...init, redirect: "manual", signal: init?.signal ?? AbortSignal.timeout(GUARD_DEADLINE_MS) });
    } catch (error) {
      const cause = (error as { cause?: unknown } | null)?.cause;
      throw cause instanceof OutboundRefused ? cause : error;
    }
  }) as typeof fetch;
}
