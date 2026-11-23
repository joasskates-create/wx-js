import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { decryptSecret, encryptSecret } from "./secret-box.js";

export interface WechatCredentials {
  /** 微信商户号，便于在密钥中心和商户号配置中校验归属。 */
  mchid?: string;
  /** APIv2 密钥，用于 V2 Native 请求签名。 */
  apiV2Key: string;
}

const raw = process.env.PAYMENT_CREDENTIALS_JSON;
let store: Record<string, WechatCredentials> = {};
if (raw) {
  try {
    store = JSON.parse(raw) as Record<string, WechatCredentials>;
  } catch {
    throw new Error("PAYMENT_CREDENTIALS_JSON must be valid JSON");
  }
}
const filePath = `${path.resolve(config.dbPath)}.credentials.enc`;
if (config.dataEncryptionKey && fs.existsSync(filePath)) {
  try { store = { ...store, ...(JSON.parse(decryptSecret(fs.readFileSync(filePath, "utf8"))) as Record<string, WechatCredentials>) }; } catch { /* invalid file is surfaced by health/preflight */ }
}

export function getCredentials(ref: string): WechatCredentials {
  const value = store[ref];
  if (!value) throw new Error(`CREDENTIAL_NOT_FOUND:${ref}`);
  if (!value.apiV2Key) throw new Error(`CREDENTIAL_API_V2_KEY_MISSING:${ref}`);
  if (String(value.apiV2Key).length !== 32) throw new Error(`CREDENTIAL_API_V2_KEY_INVALID:${ref}`);
  return value;
}
export function listCredentialRefs(): string[] { return Object.keys(store).sort(); }
export function credentialConfigured(ref: string, mchid?: string): boolean {
  const value = store[ref];
  return Boolean(value?.apiV2Key && String(value.apiV2Key).length === 32 && (!mchid || !value.mchid || String(value.mchid) === String(mchid)));
}
export function upsertCredential(ref: string, credentials: WechatCredentials): void {
  if (!config.dataEncryptionKey) throw new Error("DATA_ENCRYPTION_KEY_REQUIRED");
  store[ref] = credentials;
  fs.writeFileSync(filePath, encryptSecret(JSON.stringify(store)), { mode: 0o600 });
}
