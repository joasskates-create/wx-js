import crypto from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function createTotpSecret(): string {
  return [...crypto.randomBytes(20)].map((value) => alphabet[value % alphabet.length]).join("");
}
function decodeBase32(value: string): Buffer {
  const bits = value.toUpperCase().replace(/[^A-Z2-7]/g, "").split("").map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0")).join("");
  const bytes: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function verifyTotp(secret: string, code: string, timestamp = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const key = decodeBase32(secret); const counter = Math.floor(timestamp / 1000 / 30);
  for (const offset of [-1, 0, 1]) {
    const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(counter + offset));
    const digest = crypto.createHmac("sha1", key).update(buffer).digest(); const index = digest[digest.length - 1] & 15;
    const value = ((digest[index] & 127) << 24) | ((digest[index + 1] & 255) << 16) | ((digest[index + 2] & 255) << 8) | (digest[index + 3] & 255);
    if (String(value % 1_000_000).padStart(6, "0") === code) return true;
  }
  return false;
}
export function totpUri(secret: string, username: string): string { return `otpauth://totp/WeChatPay:${encodeURIComponent(username)}?secret=${secret}&issuer=WeChatPay`; }
