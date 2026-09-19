// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomBytes } from "node:crypto";
import type { Platform } from "./types.js";

export const PAIR_LINK_TTL_MS = 10 * 60_000;

export interface PairLink {
  platform: Platform;
  token: string;
  issuedAt: number;
  expiresAt: number;
}

export type Redeem = { outcome: "paired"; link: PairLink } | { outcome: "expired" } | { outcome: "unknown" };

export class PairingDesk {
  private readonly links = new Map<Platform, PairLink>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  issue(platform: Platform): PairLink {
    const link: PairLink = { platform, token: randomBytes(24).toString("base64url"), issuedAt: this.now(), expiresAt: this.now() + PAIR_LINK_TTL_MS };
    this.links.set(platform, link);
    return link;
  }

  pending(platform: Platform): PairLink | null {
    const link = this.links.get(platform);
    return link && link.expiresAt > this.now() ? link : null;
  }

  redeem(platform: Platform, token: string): Redeem {
    const link = this.links.get(platform);
    if (!link || link.token !== token) return { outcome: "unknown" };
    this.links.delete(platform);
    if (link.expiresAt <= this.now()) return { outcome: "expired" };
    return { outcome: "paired", link };
  }

  cancel(platform: Platform): void {
    this.links.delete(platform);
  }
}

export function telegramPairUrl(botAccount: string, token: string): string {
  return `https://t.me/${botAccount}?start=${token}`;
}
