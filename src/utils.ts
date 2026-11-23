import crypto from "node:crypto";

export function nowIso(): string {
  return new Date().toISOString();
}

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export function newTradeNo(channelId: string): string {
  const safeChannel = channelId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "channel";
  return `W${safeChannel}${Date.now()}${crypto.randomInt(1000, 9999)}`.slice(0, 32);
}
