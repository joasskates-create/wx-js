import crypto from "node:crypto";
import { config } from "../config.js";

const prefix = "enc:v1:";
function key(): Buffer | undefined {
  if (!config.dataEncryptionKey) return undefined;
  return crypto.createHash("sha256").update(config.dataEncryptionKey).digest();
}
export function encryptSecret(value: string): string {
  if (value.startsWith(prefix) || !key()) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key()!, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${prefix}${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}
export function decryptSecret(value: string): string {
  if (!value.startsWith(prefix) || !key()) return value;
  const [, version, ivText, tagText, bodyText] = value.split(":");
  if (version !== "v1" || !ivText || !tagText || !bodyText) throw new Error("INVALID_ENCRYPTED_SECRET");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key()!, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(bodyText, "base64url")), decipher.final()]).toString("utf8");
}
export function isSecretEncryptionEnabled(): boolean { return Boolean(key()); }
