import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { decryptSecret, encryptSecret } from "./secret-box.js";

type AppCredentialStore = Record<string, { appSecret: string }>;

const filePath = `${path.resolve(config.dbPath)}.app-credentials.enc`;
let store: AppCredentialStore = {};

if (fs.existsSync(filePath)) {
  try { store = JSON.parse(decryptSecret(fs.readFileSync(filePath, "utf8"))) as AppCredentialStore; } catch { /* readiness checks report the missing/invalid secret */ }
}

function persist(): void {
  if (!config.dataEncryptionKey) throw new Error("DATA_ENCRYPTION_KEY_REQUIRED");
  fs.writeFileSync(filePath, encryptSecret(JSON.stringify(store)), { mode: 0o600 });
}

export function appSecretConfigured(appId: string): boolean {
  return Boolean(store[appId]?.appSecret);
}

export function getAppSecret(appId: string): string {
  const value = store[appId]?.appSecret;
  if (!value) throw new Error(`APP_SECRET_NOT_CONFIGURED:${appId}`);
  return value;
}

export function upsertAppSecret(appId: string, appSecret: string | undefined): void {
  if (appSecret) store[appId] = { appSecret };
  else delete store[appId];
  persist();
}
