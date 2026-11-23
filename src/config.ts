import process from "node:process";

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? "./data/payments.db",
  databaseEngine: (process.env.DB_ENGINE ?? "sqlite").toLowerCase(),
  databaseUrl: process.env.DATABASE_URL ?? "",
  mockPayment: (process.env.MOCK_PAYMENT ?? "true").toLowerCase() === "true",
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
  adminAuthEnabled: (process.env.ADMIN_AUTH_ENABLED ?? "false").toLowerCase() === "true",
  secureCookies: (process.env.SECURE_COOKIES ?? (process.env.NODE_ENV === "production" ? "true" : "false")).toLowerCase() === "true",
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  reconciliationEnabled: (process.env.RECONCILIATION_ENABLED ?? "false").toLowerCase() === "true",
  reconciliationIntervalMinutes: Math.max(5, Number(process.env.RECONCILIATION_INTERVAL_MINUTES ?? 60)),
  settlementAutoEnabled: (process.env.SETTLEMENT_AUTO_ENABLED ?? "false").toLowerCase() === "true",
  settlementAutoIntervalMinutes: Math.max(5, Number(process.env.SETTLEMENT_AUTO_INTERVAL_MINUTES ?? 60)),
  paymentRecoveryEnabled: (process.env.PAYMENT_RECOVERY_ENABLED ?? "true").toLowerCase() === "true",
  paymentRecoveryIntervalMinutes: Math.max(1, Number(process.env.PAYMENT_RECOVERY_INTERVAL_MINUTES ?? 5)),
  refundRecoveryEnabled: (process.env.REFUND_RECOVERY_ENABLED ?? "true").toLowerCase() === "true",
  refundRecoveryIntervalMinutes: Math.max(1, Number(process.env.REFUND_RECOVERY_INTERVAL_MINUTES ?? 5)),
  channelFailureThreshold: Math.max(1, Number(process.env.CHANNEL_FAILURE_THRESHOLD ?? 3)),
  callbackRetryEnabled: (process.env.CALLBACK_RETRY_ENABLED ?? "true").toLowerCase() === "true",
  callbackRetryIntervalMinutes: Math.max(1, Number(process.env.CALLBACK_RETRY_INTERVAL_MINUTES ?? 1)),
  merchantWebhookEnabled: (process.env.MERCHANT_WEBHOOK_ENABLED ?? "true").toLowerCase() === "true",
  merchantWebhookIntervalMinutes: Math.max(1, Number(process.env.MERCHANT_WEBHOOK_INTERVAL_MINUTES ?? 1)),
  merchantApiAuthEnabled: (process.env.MERCHANT_API_AUTH_ENABLED ?? "false").toLowerCase() === "true",
  merchantSignatureRequired: (process.env.MERCHANT_SIGNATURE_REQUIRED ?? "false").toLowerCase() === "true",
  merchantSignatureWindowSeconds: Math.max(30, Number(process.env.MERCHANT_SIGNATURE_WINDOW_SECONDS ?? 300)),
  merchantIpAllowlist: (process.env.MERCHANT_IP_ALLOWLIST ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  metricsToken: process.env.METRICS_TOKEN ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY ?? ""
};


export function productionReadinessIssues(): string[] {
  if (config.nodeEnv !== "production") return [];
  const issues: string[] = [];
  if (config.mockPayment) issues.push("MOCK_PAYMENT_MUST_BE_FALSE");
  if (!config.adminAuthEnabled) issues.push("ADMIN_AUTH_ENABLED_MUST_BE_TRUE");
  if (!config.secureCookies) issues.push("SECURE_COOKIES_MUST_BE_TRUE");
  if (!/^https:\/\//i.test(config.publicBaseUrl)) issues.push("PUBLIC_BASE_URL_MUST_USE_HTTPS");
  if (config.adminPassword.length < 12 || /change-this|password|admin/i.test(config.adminPassword)) issues.push("ADMIN_PASSWORD_TOO_WEAK");
  if (config.dataEncryptionKey.length < 32) issues.push("DATA_ENCRYPTION_KEY_TOO_SHORT");
  return issues;
}
