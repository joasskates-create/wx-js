import path from "node:path";
import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { config, productionReadinessIssues } from "./config.js";
import {
  chooseChannel, closeOrder, createAuditLog, createApp, updateApp, getWechatApp, getAppVerifyFile, getMerchantPaymentMethod, createWechatOAuthState, getWechatOAuthState, completeWechatOAuthState, consumeWechatOAuthToken, bindPublicPaymentOpenid, createChannel, createConfiguredChannel, createMerchant, createMerchantUser, createRouteRule, createSubject, db, ensureDemoChannel, findOrderByClientRequest, createClientMerchant, listClientMerchants, getClientMerchant, updateClientMerchant, adjustClientMerchantBalance, appendClientMerchantLedger, listClientMerchantLedger, setClientMerchantCodeMerchants, listClientMerchantCodeMerchants, listMerchantAgents, listMerchantGroups, createMerchantAgent, createMerchantGroup, updateClientMerchantPassword, setClientMerchantTwoFactor, searchMerchantLedger, searchMerchantPrepaidRecords, adjustMerchantBalance, transferMerchantBalanceToCredit,
  createReconciliationRun, getAdminOperationalReport, getChannel, getChannelPreflight, getDataConsistencyReport, getMonitoring, getOrder, getOverview, getRefundedAmount, getReconciliationRun, getSettlementDifference, getQrSettlementReport, importReconciliationBill, insertOrder, insertPaymentAttempt, listQrMonitoring, listQrOrders, runQrMonitorPass, assignQrCollectionCodes, insertRefund, listQrCollectionCodes, createQrCollectionCode, updateQrCollectionCode, deleteQrCollectionCode, listQrChannelSettings, updateQrChannelSetting, reserveQrCodeForOrder, isQrChannelEnabled,
  authenticateClientMerchant, authenticatePlatformMerchant, checkMerchantOrderRisk, checkClientMerchantOrderRisk, checkChannelOrderRisk, changeMerchantUserPassword, createPlatformMerchant, createSettlementStatement, enqueueMerchantWebhook, listClientMerchantChannels, setClientMerchantChannels, listMerchantChannelIds, listChannelPlatformMerchants, listMerchantBoundChannelIds, listMerchantChannels, listMerchantChannelSettings, listPlatformMerchantWechatMerchants, listPlatformMerchantSubjects, listPlatformMerchantApps, isPlatformMerchantChannelAuthorized, updateMerchantChannelSetting, listChannelMerchants, getChannelStats, getWechatMerchantStats, getMerchantSubMerchantStats, listMerchantSubMerchantOrders, getMerchantChannelStats, resolveChannelMerchant, setChannelPlatformMerchants, setMerchantChannelBindings, updateChannelMerchantBinding, getMerchantOverview, getMerchantOperationalReport, getRefund, getSettlementReport, getSettlementStatement, getPlatformMerchantDetail, getMerchantUserByUsername, getExceptionMetrics, getOrderDetail, getMerchantFinancialOverview, getMerchantQuotaPolicy, listMerchantLedgerEntries, listMerchantCreditLedger, listMerchantAlertEvents, updateMerchantQuotaPolicy, adjustMerchantCredit, getChannelRiskPolicy, updateChannelRiskPolicy, listApps, listAuditLogs, listCallbackTasks, listChannelHealth, listChannels, listMerchantOrders, listMerchantRefunds, listMerchants, listOrders, listPlatformMerchants, listRefunds, listReconciliationRuns, listRouteRules, listRouteRuleVersions, listSettlementStatements, listSubjects, listWebhookEvents, recordCallbackTask, recordChannelHealth, recordOrderExceptionAction, listOrderExceptionActions, resetChannelCircuit, restoreRouteRuleVersion, rotateClientMerchantApiKey, rotatePlatformMerchantApiKey, searchOrders, selectChannelMerchant, chooseRoutedPaymentTarget, getRouteAllocation, listPlatformMerchantWechatBindings, setPlatformMerchantWechatBindings, listChannelPlatformMerchantPolicies, setChannelPlatformMerchantPolicies, reserveRouteCapacity, releaseRouteCapacity, reassignOrderRoute, setAppStatus, setChannelStatus, setMerchantChannels, setMerchantStatus, setMerchantMonitorLock, forceEnableMerchantStatus, updateMerchantSettings, updateMerchant, deleteMerchant, cloneMerchant, setPlatformMerchantStatus, setRouteRuleStatus, updateConfiguredChannel, createRoutingChannel, updateRoutingChannel, updateMerchantRiskPolicy, updatePlatformMerchantProfile, updateMerchantUserPassword, updateOrderPayment, updateRouteRule, updateSettlementStatementStatus, updateRefundApproval, updateRefundStatus, upsertMerchantWebhook, getMerchantWebhook, listMerchantWebhookDeliveries, listAllMerchantWebhookDeliveries, requeueMerchantWebhookDelivery, claimRefundApproval, restoreRefundApproval, resolveReconciliationItem, reserveMerchantQuota, releaseMerchantQuota, getBotSettings, saveBotSettings, listBotRecipientGroups, upsertBotRecipientGroup, deleteBotRecipientGroup, listBotDeliveryLogs, listBotOperators, upsertBotOperator, deleteBotOperator, isBotOperator, bindBotMerchant, listBotBoundMerchants, addBotLedgerEntry, listBotLedgerEntries, removeLastBotLedgerEntry, clearBotLedger
  , createPublicPaymentEntry, getPublicPaymentEntryByTokenHash, getPublicPaymentEntryByOrder, getPublicPaymentEntryToken, updatePublicPaymentEntry, expirePublicPaymentEntries, listPublicPaymentEntries, upsertWechatArticleDraft, getWechatArticleDraftByOrder, recordPublicPaymentEvent, getPublicPaymentMonitoring, createWechatHandoffTicket, getWechatHandoffTicketByHash, consumeWechatHandoffTicket, createMemberBlock, getMemberBlock, listMemberBlocks, findActiveMemberBlock, revokeMemberBlock, updateChannelRouteStrategy
} from "./db.js";
import { processRefundWebhookPayload, processWebhookPayload } from "./payment/webhook-service.js";
import { credentialConfigured, listCredentialRefs, upsertCredential } from "./security/credentials.js";
import { appSecretConfigured, getAppSecret, upsertAppSecret } from "./security/app-credentials.js";
import { MockPaymentProvider } from "./payment/mock.js";
import { WechatNativeProvider } from "./payment/wechat-native.js";
import { createPublicAccountArticle } from "./wechat/public-account-client.js";
import type { JsapiOrderRequest, NativeOrderRequest } from "./types.js";
import { newTradeNo, randomId } from "./utils.js";
import { ADMIN_ROLES, adminScopeAllows, clearSessionCookie, cookieToken, createAdminUser, ensureAdminBootstrap, getAdminFromToken, listAdminUsers, loginAdmin, logoutAdmin, requireAdmin, setSessionCookie, updateAdminUser, verifyAdminOperationPassword } from "./security/admin-auth.js";
import { runChannelReconciliation, runPreviousDaySettlements, startReconciliationScheduler, startSettlementScheduler } from "./reconciliation/scheduler.js";
import { runPaymentRecoveryPass, startPaymentRecoveryScheduler } from "./workers/payment-recovery.js";
import { runRefundRecoveryPass, startRefundRecoveryScheduler } from "./workers/refund-recovery.js";
import { runCallbackRetryPass, startCallbackRetryScheduler } from "./workers/callback-retry.js";
import { startMerchantWebhookScheduler } from "./workers/merchant-webhook.js";
import { clearMerchantSessionCookie, getMerchantFromRequest, loginMerchant, loginMerchantUser, logoutMerchant, merchantCookieToken, requireMerchant, setMerchantSessionCookie, type MerchantRequest } from "./security/merchant-auth.js";
import { hashPassword, verifyPassword } from "./security/password.js";
import { rateLimit } from "./security/rate-limit.js";
import { verifyMerchantRequest } from "./security/merchant-signature.js";
import { loginClientMerchant, logoutClientMerchant, requireClientMerchantSession } from "./security/client-merchant-auth.js";
import { createTotpSecret, totpUri, verifyTotp } from "./security/totp.js";
import { BOT_COMMAND_INSTRUCTIONS, broadcastTelegram, deleteTelegramMessage, forwardTelegramMessage, getTelegramBotInfo, getTelegramChatMember, leaveTelegramChat, pinTelegramMessage, sendTelegramMessage, setTelegramWebhook, telegramWebhookUrl } from "./notifications/telegram.js";

const productionIssues = productionReadinessIssues();
if (productionIssues.length) console.error(`Production readiness blocked: ${productionIssues.join(", ")}`);
if (config.nodeEnv === "production" && productionIssues.length) throw new Error(`PRODUCTION_CONFIG_INVALID:${productionIssues.join(",")}`);
if (!config.mockPayment && listCredentialRefs().length === 0) {
  if (config.nodeEnv === "production") throw new Error("PRODUCTION_CREDENTIALS_MISSING");
  console.warn("Live payment mode is enabled but no payment credentials are configured yet.");
}
ensureDemoChannel();
ensureAdminBootstrap();

const app = express();
// The production deployment terminates TLS at nginx. Trust one proxy hop so
// request IP/protocol handling and secure cookie deployments remain correct.
app.set("trust proxy", 1);

function publicBaseUrlForRequest(req: Request): string {
  const configuredBaseUrl = config.publicBaseUrl.replace(/\/+$/, "");
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredBaseUrl)
    ? `${req.protocol}://${req.get("host")}`
    : configuredBaseUrl;
}

function isProductionCallbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
      && !/^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(url.hostname);
  } catch { return false; }
}

function sendWechatV2Ack(res: Response, success: boolean, message: string): void {
  const code = success ? "SUCCESS" : "FAIL";
  const safeMessage = String(message || (success ? "OK" : "FAIL")).replace(/]]>/g, "]]]]><![CDATA[>");
  res.status(200).type("application/xml").send(`<xml><return_code><![CDATA[${code}]]></return_code><return_msg><![CDATA[${safeMessage}]]></return_msg></xml>`);
}

function credentialRefForMchid(mchid: string): string {
  const normalized = String(mchid || "").trim().replace(/[^A-Za-z0-9_.-]+/g, "-");
  return `mch-${normalized}`;
}

function saveApiV2Credential(mchid: string, apiV2Key: string | undefined, currentRef?: string): string {
  const ref = currentRef || credentialRefForMchid(mchid);
  const normalizedKey = apiV2Key?.trim();
  if (normalizedKey && normalizedKey.length !== 32) throw new Error("API_V2_KEY_INVALID");
  if (normalizedKey) upsertCredential(ref, { mchid, apiV2Key: normalizedKey });
  return ref;
}

function isWechatMerchantControlLockError(message: string): boolean {
  const text = String(message || "").toUpperCase();
  return /WECHAT_(?:GET|POST|PUT|PATCH)_40[13]\b/.test(text)
    || /NO_PERMISSION|PERMISSION_DENIED|CERTIFICATE|SIGNATURE|API\s*V?3|MERCHANT.*(?:RISK|BANN|DISABL|CLOS)|(?:RISK|BANN|DISABL|CLOS).*MERCHANT/.test(text);
}

function monitorMerchantFromProviderError(channel: { merchantInternalId?: unknown; mchId?: unknown } | undefined, message: string): void {
  if (!channel || !isWechatMerchantControlLockError(message)) return;
  const merchantId = String(channel.merchantInternalId || "");
  if (!merchantId) return;
  const reason = `微信接口异常：${String(message).slice(0, 480)}`;
  const locked = setMerchantMonitorLock(merchantId, reason, "WECHAT_API");
  if (locked) createAuditLog({ action: "MERCHANT_MONITOR_LOCK", targetType: "merchant", targetId: merchantId, detail: { reason, source: "WECHAT_API", mchid: channel.mchId } });
}
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
const runtimeMetrics = { requests: 0, responses4xx: 0, responses5xx: 0, startedAt: new Date().toISOString() };
function requireMetrics(req: Request, res: Response, next: () => void): void {
  if (config.metricsToken) {
    const expected = Buffer.from(`Bearer ${config.metricsToken}`);
    const actual = Buffer.from(String(req.headers.authorization ?? ""));
    if (actual.length === expected.length && crypto.timingSafeEqual(actual, expected)) { next(); return; }
    res.status(401).json({ error: "METRICS_AUTH_REQUIRED" }); return;
  }
  requireAdmin(req, res, next);
}
app.use((req, res, next) => {
  if (req.path !== "/metrics" && req.path !== "/metrics/prometheus") {
    runtimeMetrics.requests += 1;
    res.on("finish", () => { if (res.statusCode >= 400 && res.statusCode < 500) runtimeMetrics.responses4xx += 1; if (res.statusCode >= 500) runtimeMetrics.responses5xx += 1; });
  }
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true, mockPayment: config.mockPayment, adminAuthEnabled: config.adminAuthEnabled, databaseEngine: config.databaseEngine, dataEncryptionConfigured: Boolean(config.dataEncryptionKey), reconciliationEnabled: config.reconciliationEnabled, reconciliationIntervalMinutes: config.reconciliationIntervalMinutes, settlementAutoEnabled: config.settlementAutoEnabled, settlementAutoIntervalMinutes: config.settlementAutoIntervalMinutes, paymentRecoveryEnabled: config.paymentRecoveryEnabled, paymentRecoveryIntervalMinutes: config.paymentRecoveryIntervalMinutes, refundRecoveryEnabled: config.refundRecoveryEnabled, refundRecoveryIntervalMinutes: config.refundRecoveryIntervalMinutes, callbackRetryEnabled: config.callbackRetryEnabled, callbackRetryIntervalMinutes: config.callbackRetryIntervalMinutes, merchantWebhookEnabled: config.merchantWebhookEnabled, merchantWebhookIntervalMinutes: config.merchantWebhookIntervalMinutes }));
app.get("/ready", (_req, res) => {
  const credentialsReady = config.mockPayment || listCredentialRefs().length > 0;
  const configIssues = productionReadinessIssues();
  const securityReady = config.nodeEnv !== "production" || configIssues.length === 0;
  const databaseReady = config.databaseEngine === "sqlite";
  const activeChannels = listChannels().filter((channel) => channel.status === "ACTIVE");
  const channelCredentialsReady = config.mockPayment || activeChannels.every((channel) => credentialConfigured(String(channel.credentialRef), String(channel.mchId)));
  const issues = [...configIssues, ...(credentialsReady ? [] : ["PAYMENT_CREDENTIALS_MISSING"]), ...(channelCredentialsReady ? [] : ["CHANNEL_PAYMENT_CREDENTIALS_INVALID"])];
  try {
    db.prepare("SELECT 1").get();
    if (issues.length || !databaseReady) return res.status(503).json({ ready: false, issues, database: databaseReady ? "ok" : "postgres_adapter_required", credentials: credentialsReady ? "configured" : "missing", encryption: securityReady ? "configured" : "missing" });
    return res.json({ ready: true, database: "ok", databaseEngine: config.databaseEngine, credentials: config.mockPayment ? "mock" : "configured", encryption: securityReady ? "configured" : "optional" });
  } catch { return res.status(503).json({ ready: false, issues: [...issues, "DATABASE_UNAVAILABLE"], database: "unavailable", databaseEngine: config.databaseEngine, credentials: credentialsReady ? "configured" : "missing", encryption: securityReady ? "configured" : "missing" }); }
});
app.get("/metrics", requireAdmin, (_req, res) => res.json({ data: { ...runtimeMetrics, uptimeSeconds: Math.floor(process.uptime()), memory: process.memoryUsage(), timestamp: new Date().toISOString() } }));
app.get("/metrics/prometheus", requireMetrics, (_req, res) => {
  const lines = [
    "# HELP wechat_pay_requests_total Total HTTP requests handled by the process.",
    "# TYPE wechat_pay_requests_total counter",
    `wechat_pay_requests_total ${runtimeMetrics.requests}`,
    "# HELP wechat_pay_responses_4xx_total Total HTTP 4xx responses.",
    "# TYPE wechat_pay_responses_4xx_total counter",
    `wechat_pay_responses_4xx_total ${runtimeMetrics.responses4xx}`,
    "# HELP wechat_pay_responses_5xx_total Total HTTP 5xx responses.",
    "# TYPE wechat_pay_responses_5xx_total counter",
    `wechat_pay_responses_5xx_total ${runtimeMetrics.responses5xx}`,
    "# HELP wechat_pay_process_uptime_seconds Process uptime in seconds.",
    "# TYPE wechat_pay_process_uptime_seconds gauge",
    `wechat_pay_process_uptime_seconds ${Math.floor(process.uptime())}`,
    "# HELP wechat_pay_process_resident_memory_bytes Resident memory in bytes.",
    "# TYPE wechat_pay_process_resident_memory_bytes gauge",
    `wechat_pay_process_resident_memory_bytes ${process.memoryUsage().rss}`
  ];
  res.type("text/plain; version=0.0.4; charset=utf-8").send(`${lines.join("\n")}\n`);
});

app.post("/webhooks/wechatpay/:channelId/:mchid", express.raw({ type: "*/*", limit: "1mb" }), (req: Request, res: Response, next: NextFunction) => {
  const channelId = String(req.params.channelId); const mchid = String(req.params.mchid);
  // Keep the legacy /:channelId/refund endpoint reachable; its two path segments
  // also match this generic merchant-specific transaction route.
  if (mchid === "refund") return next();
  if (!getChannel(channelId)) return res.status(404).json({ code: "FAIL", message: "channel not found" });
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  try { processWebhookPayload(channelId, rawBody, req.headers, true, mchid); return sendWechatV2Ack(res, true, "成功"); }
  catch (error) {
    const message = error instanceof Error ? error.message : "callback error";
    let notificationId: string | null = null;
    try { const body = JSON.parse(rawBody.toString("utf8")); notificationId = body.id ?? `mock-${body.out_trade_no ?? body.outTradeNo ?? "unknown"}-${body.trade_state ?? body.tradeState ?? "UNKNOWN"}`; } catch { /* keep null for malformed payloads */ }
    recordCallbackTask({ channelId, notificationId, payload: rawBody.toString("utf8"), error: message, callbackType: "TRANSACTION" });
    return sendWechatV2Ack(res, false, message);
  }
});

app.post("/webhooks/wechatpay/:channelId", express.raw({ type: "*/*", limit: "1mb" }), (req: Request, res: Response) => {
  const channelId = String(req.params.channelId);
  if (!getChannel(channelId)) return res.status(404).json({ code: "FAIL", message: "channel not found" });
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  try { processWebhookPayload(channelId, rawBody, req.headers); return sendWechatV2Ack(res, true, "成功"); }
  catch (error) {
    const message = error instanceof Error ? error.message : "callback error";
    let notificationId: string | null = null;
    try { const body = JSON.parse(rawBody.toString("utf8")); notificationId = body.id ?? `mock-${body.out_trade_no ?? body.outTradeNo ?? "unknown"}-${body.trade_state ?? body.tradeState ?? "UNKNOWN"}`; } catch { /* keep null for malformed payloads */ }
    recordCallbackTask({ channelId, notificationId, payload: rawBody.toString("utf8"), error: message, callbackType: "TRANSACTION" });
    return sendWechatV2Ack(res, false, message);
  }
});

app.post("/webhooks/wechatpay/:channelId/:mchid/refund", express.raw({ type: "*/*", limit: "1mb" }), (req: Request, res: Response) => {
  const channelId = String(req.params.channelId); const mchid = String(req.params.mchid);
  if (!getChannel(channelId)) return res.status(404).json({ code: "FAIL", message: "channel not found" });
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  try { processRefundWebhookPayload(channelId, rawBody, req.headers, true, mchid); return sendWechatV2Ack(res, true, "成功"); }
  catch (error) {
    const message = error instanceof Error ? error.message : "refund callback error";
    let notificationId: string | null = null;
    try { notificationId = JSON.parse(rawBody.toString("utf8")).id ?? null; } catch { /* malformed payload */ }
    recordCallbackTask({ channelId, notificationId, payload: rawBody.toString("utf8"), error: message, callbackType: "REFUND" });
    return sendWechatV2Ack(res, false, message);
  }
});

app.post("/webhooks/wechatpay/:channelId/refund", express.raw({ type: "*/*", limit: "1mb" }), (req: Request, res: Response) => {
  const channelId = String(req.params.channelId);
  if (!getChannel(channelId)) return res.status(404).json({ code: "FAIL", message: "channel not found" });
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  try { processRefundWebhookPayload(channelId, rawBody, req.headers); return sendWechatV2Ack(res, true, "成功"); }
  catch (error) {
    const message = error instanceof Error ? error.message : "refund callback error";
    let notificationId: string | null = null;
    try { notificationId = JSON.parse(rawBody.toString("utf8")).id ?? null; } catch { /* malformed payload */ }
    recordCallbackTask({ channelId, notificationId, payload: rawBody.toString("utf8"), error: message, callbackType: "REFUND" });
    return sendWechatV2Ack(res, false, message);
  }
});

app.use(express.json({ limit: "1mb", verify: (req, _res, buffer) => { (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); } }));
app.use(express.static(path.resolve("public")));

app.get("/admin", (_req, res) => res.sendFile(path.resolve("public/admin.html")));
app.get("/merchant", (_req, res) => res.sendFile(path.resolve("public/merchant.html")));
app.get("/cashier/native", (_req, res) => res.sendFile(path.resolve("public/native-cashier.html")));
app.get("/cashier/jsapi", (_req, res) => res.sendFile(path.resolve("public/jsapi-cashier.html")));

function oauthReturnUrlAllowed(appConfig: Record<string, unknown>, returnUrl: string): boolean {
  try {
    const target = new URL(returnUrl);
    const configuredDomain = String(appConfig.oauthDomain || "").trim().replace(/^https?:\/\//i, "").split("/")[0].split(":")[0].toLowerCase();
    if (!configuredDomain) return false;
    const localDevelopment = /^(localhost|127\.0\.0\.1)$/i.test(target.hostname);
    return (target.protocol === "https:" || (config.nodeEnv !== "production" && localDevelopment)) && target.hostname.toLowerCase() === configuredDomain;
  } catch { return false; }
}

async function exchangeWechatOAuthCode(appid: string, appSecret: string, code: string): Promise<string> {
  if (config.mockPayment) return `mock_openid_${crypto.createHash("sha256").update(`${appid}:${code}`).digest("hex").slice(0, 24)}`;
  const response = await fetch(`https://api.weixin.qq.com/sns/oauth2/access_token?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}&grant_type=authorization_code`);
  const body = await response.json() as { openid?: string; errcode?: number; errmsg?: string };
  if (!response.ok || !body.openid) throw new Error(`WECHAT_OAUTH_${body.errcode || response.status}:${body.errmsg || "OPENID_MISSING"}`);
  return body.openid;
}

function buildWechatAuthorizeUrl(req: Request, appConfig: Record<string, unknown>, state: string): string {
  const callback = `${publicBaseUrlForRequest(req)}/api/v1/wechat/oauth/callback`;
  return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(String(appConfig.appid))}&redirect_uri=${encodeURIComponent(callback)}&response_type=code&scope=snsapi_base&state=${encodeURIComponent(state)}#wechat_redirect`;
}

app.get("/api/v1/wechat/oauth/start", (req, res) => {
  const appId = String(req.query.appId || ""); const returnUrl = String(req.query.returnUrl || "");
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(appId) || !returnUrl) return res.status(400).json({ error: "INVALID_OAUTH_REQUEST" });
  const appConfig = getWechatApp(appId);
  if (!appConfig || appConfig.status !== "ACTIVE" || appConfig.appType !== "SERVICE_ACCOUNT") return res.status(400).json({ error: "JSAPI_SERVICE_ACCOUNT_REQUIRED" });
  if (!appSecretConfigured(appId)) return res.status(409).json({ error: "JSAPI_APP_SECRET_MISSING" });
  if (!oauthReturnUrlAllowed(appConfig, returnUrl)) return res.status(400).json({ error: "OAUTH_RETURN_URL_NOT_ALLOWED" });
  const state = createWechatOAuthState({ appId, returnUrl, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() });
  const authorizeUrl = buildWechatAuthorizeUrl(req, appConfig, state);
  return res.json({ data: { state, authorizeUrl, expiresIn: 300 } });
});

app.get("/api/v1/wechat/oauth/callback", async (req, res) => {
  const state = String(req.query.state || ""); const code = String(req.query.code || "");
  const oauthState = getWechatOAuthState(state);
  if (!oauthState || oauthState.tokenHash || oauthState.consumedAt || new Date(String(oauthState.expiresAt)).getTime() <= Date.now()) return res.status(400).send("微信授权已失效，请重新发起支付");
  if (!code) return res.status(400).send("微信授权失败：缺少 code");
  const appConfig = getWechatApp(String(oauthState.appId));
  if (!appConfig || !appSecretConfigured(String(oauthState.appId))) return res.status(409).send("公众号支付配置不完整");
  try {
    const openid = await exchangeWechatOAuthCode(String(appConfig.appid), getAppSecret(String(oauthState.appId)), code);
    const token = crypto.randomBytes(32).toString("base64url");
    const completed = completeWechatOAuthState(state, token, openid);
    if (!completed) return res.status(409).send("微信授权已被使用，请重新发起支付");
    recordPublicPaymentEvent({ entryId: String(oauthState.contextId || "") || null, eventType: "OAUTH_COMPLETED" });
    const target = new URL(String(oauthState.returnUrl)); target.searchParams.set("oauth_token", token); target.searchParams.set("oauth_state", state);
    return res.redirect(target.toString());
  } catch (error) { return res.status(502).send(`微信授权失败：${error instanceof Error ? error.message : "OAUTH_EXCHANGE_FAILED"}`); }
});

// Local mock-payment development flow. This endpoint is deliberately unavailable
// in production and only completes an OAuth state that the order flow created.
// It lets the JSAPI cashier be exercised without opening WeChat on a real device.
app.get("/api/v1/dev/wechat/oauth/mock", (req, res) => {
  if (!config.mockPayment || config.nodeEnv === "production") return res.status(404).send("Not found");
  const state = String(req.query.state || "");
  const oauthState = getWechatOAuthState(state);
  if (!oauthState || oauthState.tokenHash || oauthState.consumedAt || new Date(String(oauthState.expiresAt)).getTime() <= Date.now()) {
    return res.status(400).send("模拟微信授权已失效，请重新发起支付");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const openid = `mock_openid_${crypto.createHash("sha256").update(`${String(oauthState.appId)}:${state}`).digest("hex").slice(0, 24)}`;
  const completed = completeWechatOAuthState(state, token, openid);
  if (!completed) return res.status(409).send("模拟微信授权已被使用，请重新发起支付");
  recordPublicPaymentEvent({ entryId: String(oauthState.contextId || "") || null, eventType: "OAUTH_COMPLETED" });
  const target = new URL(String(oauthState.returnUrl));
  target.searchParams.set("oauth_token", token);
  target.searchParams.set("oauth_state", state);
  return res.redirect(target.toString());
});

function publicEntryFromRequestToken(token: string): { token: string; entry: ReturnType<typeof getPublicPaymentEntryByTokenHash>; order: ReturnType<typeof getOrder> } {
  const normalized = String(token || "");
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(normalized)) return { token: normalized, entry: undefined, order: undefined };
  const hash = crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
  const entry = getPublicPaymentEntryByTokenHash(hash);
  const order = entry ? getOrder(entry.orderId) : undefined;
  if (entry && new Date(entry.expiresAt).getTime() <= Date.now() && entry.status === "ACTIVE") updatePublicPaymentEntry(entry.id, { status: "EXPIRED" });
  return { token: normalized, entry, order };
}

// Public WeChat web-auth domain verification: serve the stored token content
// for MP_verify_*.txt filenames configured on an AppID (admin-managed).
app.get(/^\/MP_verify_[A-Za-z0-9_-]{1,96}\.txt$/, (req, res) => {
  const match = String(req.path).match(/^\/(MP_verify_[A-Za-z0-9_-]{1,96}\.txt)$/);
  const found = match ? getAppVerifyFile(match[1]) : undefined;
  if (!found) return res.status(404).type("text/plain").send("verification file not configured");
  res.status(200).type("text/plain; charset=utf-8").send(found.token);
});

app.get("/public-pay/:token", (req, res) => res.sendFile(path.resolve("public/public-pay.html")));
app.get("/api/v1/public-pay/:token", (req, res) => {
  const found = publicEntryFromRequestToken(String(req.params.token));
  if (!found.entry || !found.order) return res.status(404).json({ error: "PUBLIC_PAYMENT_ENTRY_NOT_FOUND" });
  const draft = getWechatArticleDraftByOrder(found.order.id);
  const status = found.entry.status === "ACTIVE" && new Date(found.entry.expiresAt).getTime() <= Date.now() ? "EXPIRED" : found.entry.status;
  const article = draft ? { status: draft.status, previewUrl: draft.previewUrl, fallbackToJsapi: draft.status === "FAILED" || !draft.previewUrl } : { status: "PENDING", previewUrl: null, fallbackToJsapi: false };
  return res.json({ data: { order: publicOrder(found.order), entry: { status, expiresAt: found.entry.expiresAt, payUrl: `${publicBaseUrlForRequest(req)}/public-pay/${encodeURIComponent(String(req.params.token))}`, qrDataUrl: found.entry.qrDataUrl }, article } });
});

function validWechatPreviewUrl(value: unknown): string | undefined {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return undefined;
    if (!/^mp\.weixin\.qq\.com$/i.test(url.hostname)) return undefined;
    return url.toString();
  } catch { return undefined; }
}

app.post("/api/v1/public-pay/:token/handoff", (req, res) => {
  const found = publicEntryFromRequestToken(String(req.params.token));
  if (!found.entry || !found.order) return res.status(404).json({ error: "PUBLIC_PAYMENT_ENTRY_NOT_FOUND" });
  if (found.entry.status !== "ACTIVE" || new Date(found.entry.expiresAt).getTime() <= Date.now()) return res.status(410).json({ error: "PUBLIC_PAYMENT_ENTRY_EXPIRED" });
  const previewUrl = validWechatPreviewUrl(getWechatArticleDraftByOrder(found.order.id)?.previewUrl);
  if (!previewUrl) {
    recordPublicPaymentEvent({ orderId: found.order.id, entryId: found.entry.id, eventType: "HANDOFF_TICKET_FAILED", errorCode: "PREVIEW_URL_UNAVAILABLE" });
    return res.status(409).json({ error: "PREVIEW_URL_UNAVAILABLE", message: "公众号预览链接尚未准备好" });
  }
  const rawTicket = crypto.randomBytes(32).toString("base64url");
  const ticketHash = crypto.createHash("sha256").update(rawTicket, "utf8").digest("hex");
  const expiresAt = new Date(Math.min(new Date(found.order.expireAt).getTime(), Date.now() + 2 * 60_000)).toISOString();
  const ticket = createWechatHandoffTicket({ orderId: found.order.id, entryId: found.entry.id, ticketHash, previewUrl, expiresAt });
  recordPublicPaymentEvent({ orderId: found.order.id, entryId: found.entry.id, eventType: "HANDOFF_TICKET_CREATED", detail: { handoffId: ticket.id, expiresAt } });
  return res.json({ data: { ticket: rawTicket, handoffId: ticket.id, bridgeUrl: `${publicBaseUrlForRequest(req)}/wechat-bridge/${encodeURIComponent(rawTicket)}`, previewUrl, expiresAt } });
});

app.post("/api/v1/public-pay/:token/telemetry", (req, res) => {
  const found = publicEntryFromRequestToken(String(req.params.token));
  if (!found.entry || !found.order) return res.status(404).json({ error: "PUBLIC_PAYMENT_ENTRY_NOT_FOUND" });
  const parsed = z.object({
    eventType: z.enum(["WAKE_ATTEMPTED", "WAKE_APP_SWITCHED", "WAKE_GATEWAY_FALLBACK", "PREVIEW_NAVIGATION_ATTEMPTED", "COPY_LINK_USED"]),
    durationMs: z.number().int().nonnegative().max(120_000).optional(),
    detail: z.record(z.string(), z.unknown()).optional()
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_PUBLIC_PAYMENT_TELEMETRY" });
  recordPublicPaymentEvent({ orderId: found.order.id, entryId: found.entry.id, eventType: parsed.data.eventType, durationMs: parsed.data.durationMs, detail: { ...(parsed.data.detail || {}), ip: String(req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, ""), userAgent: String(req.get("user-agent") || "").slice(0, 300) } });
  return res.status(204).end();
});

app.get("/wechat-bridge/:ticket", (req, res) => {
  const rawTicket = String(req.params.ticket || "");
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(rawTicket)) return res.status(404).send("中转链接无效");
  const ticketHash = crypto.createHash("sha256").update(rawTicket, "utf8").digest("hex");
  const startedAt = Date.now();
  const existingTicket = getWechatHandoffTicketByHash(ticketHash);
  const ticket = consumeWechatHandoffTicket(ticketHash);
  if (!ticket) {
    recordPublicPaymentEvent({ orderId: existingTicket?.orderId, entryId: existingTicket?.entryId, eventType: "HANDOFF_BRIDGE_FAILED", errorCode: "TICKET_INVALID_OR_EXPIRED", detail: { handoffId: existingTicket?.id, userAgent: String(req.get("user-agent") || "").slice(0, 300) } });
    return res.status(410).send("中转链接已失效，请返回订单页面重新打开");
  }
  const previewUrl = validWechatPreviewUrl(ticket.previewUrl);
  if (!previewUrl) {
    recordPublicPaymentEvent({ orderId: ticket.orderId, entryId: ticket.entryId, eventType: "HANDOFF_BRIDGE_FAILED", errorCode: "PREVIEW_URL_INVALID", detail: { handoffId: ticket.id } });
    return res.status(502).send("公众号预览链接无效，请返回订单页面重试");
  }
  recordPublicPaymentEvent({ orderId: ticket.orderId, entryId: ticket.entryId, eventType: "HANDOFF_BRIDGE_OPENED", durationMs: Date.now() - startedAt, detail: { handoffId: ticket.id, userAgent: String(req.get("user-agent") || "").slice(0, 300) } });
  recordPublicPaymentEvent({ orderId: ticket.orderId, entryId: ticket.entryId, eventType: "HANDOFF_PREVIEW_REDIRECTED", detail: { handoffId: ticket.id, previewHost: "mp.weixin.qq.com" } });
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  return res.redirect(302, previewUrl);
});

app.get("/api/v1/public-pay/:token/oauth/start", (req, res) => {
  const found = publicEntryFromRequestToken(String(req.params.token));
  if (!found.entry || !found.order) return res.status(404).send("支付入口不存在");
  if (found.entry.status !== "ACTIVE" || new Date(found.entry.expiresAt).getTime() <= Date.now()) return res.status(410).send("支付入口已过期");
  const capability = found.order.wechatMerchantId ? getMerchantPaymentMethod(String(found.order.wechatMerchantId), "JSAPI") : undefined;
  const appId = String(capability?.appId || (found.order as any).paymentAppId || "");
  const appConfig = getWechatApp(appId);
  if (!appConfig || !appSecretConfigured(appId)) return res.status(409).send("公众号支付配置不完整");
  const returnUrl = `${publicBaseUrlForRequest(req)}/public-pay/${encodeURIComponent(String(req.params.token))}`;
  if (!oauthReturnUrlAllowed(appConfig, returnUrl)) return res.status(400).send("OAuth 域名未配置");
  const state = createWechatOAuthState({ appId, returnUrl, contextId: found.entry.id, contextType: "PUBLIC_PAYMENT_ENTRY", expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() });
  recordPublicPaymentEvent({ orderId: found.order.id, entryId: found.entry.id, eventType: "OAUTH_STARTED" });
  const authorizeUrl = config.mockPayment && config.nodeEnv !== "production"
    ? `${publicBaseUrlForRequest(req)}/api/v1/dev/wechat/oauth/mock?state=${encodeURIComponent(state)}`
    : buildWechatAuthorizeUrl(req, appConfig, state);
  return res.redirect(authorizeUrl);
});

app.post("/api/v1/public-pay/:token/pay", async (req, res) => {
  const found = publicEntryFromRequestToken(String(req.params.token));
  if (!found.entry || !found.order) return res.status(404).json({ error: "PUBLIC_PAYMENT_ENTRY_NOT_FOUND" });
  if (found.entry.status !== "ACTIVE" || new Date(found.entry.expiresAt).getTime() <= Date.now()) return res.status(410).json({ error: "PUBLIC_PAYMENT_ENTRY_EXPIRED" });
  if (!["QR_CREATED", "CREATED", "ROUTED"].includes(String(found.order.status))) return res.status(409).json({ error: "ORDER_NOT_PAYABLE", status: found.order.status });
  const token = z.object({ oauthToken: z.string().min(20).max(256) }).safeParse(req.body?.oauthToken ? req.body : {});
  if (!token.success) return res.status(400).json({ error: "OAUTH_TOKEN_REQUIRED" });
  const capability = found.order.wechatMerchantId ? getMerchantPaymentMethod(String(found.order.wechatMerchantId), "JSAPI") : undefined;
  if (!capability || capability.status !== "ACTIVE" || capability.appStatus !== "ACTIVE") return res.status(409).json({ error: "JSAPI_NOT_ENABLED_FOR_MERCHANT" });
  const oauth = consumeWechatOAuthToken(token.data.oauthToken);
  if (!oauth || oauth.appId !== capability.appId || (oauth.contextType === "PUBLIC_PAYMENT_ENTRY" && oauth.contextId !== found.entry.id)) return res.status(401).json({ error: "INVALID_OR_EXPIRED_OAUTH_TOKEN" });
  const channel = resolveChannelMerchant(found.order.channelId, found.order.wechatMerchantId);
  if (!channel) return res.status(409).json({ error: "CHANNEL_NOT_FOUND" });
  const publicOpenidHash = crypto.createHash("sha256").update(oauth.openid, "utf8").digest("hex");
  if (!bindPublicPaymentOpenid(found.order.id, publicOpenidHash)) {
    recordPublicPaymentEvent({ orderId: found.order.id, entryId: found.entry.id, eventType: "OPENID_BIND_REJECTED" });
    return res.status(409).json({ error: "ORDER_OPENID_BOUND", message: "该订单已绑定其他微信用户" });
  }
  recordPublicPaymentEvent({ orderId: found.order.id, entryId: found.entry.id, eventType: "OPENID_BOUND" });
  const publicBlockMatch = findActiveMemberBlock({ platformMerchantId: found.order.merchantId, channelId: channel.id, keys: memberBlockKeys(requestDeviceInfo(req, { clientRequestNo: found.order.clientRequestNo, amount: Number(found.order.amount), description: found.order.description, paymentMethod: "JSAPI", collectionMode: "NATIVE", entryMode: "DIRECT", merchantId: found.order.merchantId }), publicOpenidHash) });
  if (publicBlockMatch) {
    recordMemberBlockMatch(publicBlockMatch, { platformMerchantId: found.order.merchantId, channelId: channel.id, orderId: found.order.id, phase: "PUBLIC_PAY" });
    return res.status(403).json({ error: "MEMBER_BLOCKED" });
  }
  const provider = config.mockPayment ? new MockPaymentProvider() : new WechatNativeProvider();
  const notifyUrl = `${publicBaseUrlForRequest(req)}${channel.notifyPath}/${encodeURIComponent(channel.mchId)}`;
  recordPublicPaymentEvent({ orderId: found.order.id, entryId: found.entry.id, eventType: "JSAPI_REQUESTED" });
  try {
    const result = await provider.createJsapiOrder({ appId: String(capability.appid), mchId: channel.mchId, openid: oauth.openid, description: found.order.description, outTradeNo: found.order.channelOutTradeNo, amount: Number(found.order.amount), notifyUrl, attach: found.order.platformOrderNo, credentialRef: channel.credentialRef, clientIp: String(req.ip || req.socket.remoteAddress || "127.0.0.1").replace(/^::ffff:/, "") });
    updateOrderPayment(found.order.id, { status: "PAYING" });
    insertPaymentAttempt(found.order.id, channel.id, "PUBLIC_JSAPI_SUCCESS");
    recordPublicPaymentEvent({ orderId: found.order.id, entryId: found.entry.id, eventType: "JSAPI_CREATED" });
    return res.json({ data: getOrder(found.order.id), payment: result.payParams, provider: result.provider });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PUBLIC_JSAPI_CREATE_FAILED";
    insertPaymentAttempt(found.order.id, channel.id, "PUBLIC_JSAPI_FAILED", message);
    recordPublicPaymentEvent({ orderId: found.order.id, entryId: found.entry.id, eventType: "JSAPI_FAILED", errorCode: message });
    return res.status(502).json({ error: "PUBLIC_JSAPI_CREATE_FAILED", message });
  }
});

async function handleTelegramUpdate(update: any): Promise<void> {
  const message = update?.message;
  const chatId = String(message?.chat?.id ?? "");
  const text = String(message?.text ?? "").trim();
  if (!chatId || !text) return;
  const settings = getBotSettings();
  const allowed = chatId === String(settings.adminGroupId ?? "") || listBotRecipientGroups().some((group) => group.enabled && String(group.chatId) === chatId);
  if (!allowed) return;
  const sender = message?.from ?? {}; const userId = String(sender.id ?? ""); const username = sender.username ? `@${sender.username}` : "";
  const member = userId ? await getTelegramChatMember(chatId, userId).catch(() => undefined) : undefined;
  const memberStatus = String(member?.status ?? ""); const isAdmin = ["creator", "administrator"].includes(memberStatus);
  const isOperator = isAdmin || isBotOperator(chatId, userId, sender.username);
  const boundMerchants = listBotBoundMerchants(chatId); const merchant = boundMerchants[0] as Record<string, any> | undefined;
  const [rawCommand, ...args] = text.split(/\s+/); const command = rawCommand.replace(/^\//, "");
  const monitoring = getMonitoring();
  let reply = "";
  if (command === "帮助") reply = ["可用中文命令：", ...BOT_COMMAND_INSTRUCTIONS.map((item) => `${item.command}：${item.description}`)].join("\n");
  else if (!isOperator) reply = "你不是本群管理员或操作员，机器人不会执行下发、记账和查询指令。";
  else if (command === "状态") { const o = getOverview(); const callbacks = listCallbackTasks(500); reply = `系统状态：${config.mockPayment ? "模拟支付" : "生产支付"}\n通道：${o.activeChannels}/${o.channels} 个启用\n待处理订单：${o.pendingOrders}\n回调待处理：${callbacks.filter((item) => ["PENDING", "RETRYING"].includes(String(item.status))).length}`; }
  else if (command === "今日") { const o = getOverview(); reply = `今日概况\n订单总数：${o.orders}\n成功订单：${o.successOrders}\n待处理订单：${o.pendingOrders}\n退款单：${o.refunds}`; }
  else if (command === "健康") reply = ["通道健康：", ...monitoring.map((item) => `${item.channelId}｜${item.circuitState}｜失败 ${item.consecutiveFailures} 次｜24小时成功率 ${item.successRate}%`)].join("\n");
  else if (command === "通道" || command === "查询通道") { const item = monitoring.find((row) => String(row.channelId) === String(args[0])); reply = item ? `${item.channelId}\n状态：${item.status}\n熔断：${item.circuitState}\n连续失败：${item.consecutiveFailures}\n24小时成功率：${item.successRate}%` : "未找到该通道，请检查通道编码。"; }
  else if (command === "商户号") { const item = listMerchants().find((row: any) => String(row.id) === String(args[0]) || String(row.mchid) === String(args[0])); reply = item ? `商户号：${item.mchid}\n状态：${item.status}\n风控：${item.riskEnabled ? "已启用" : "已关闭"}` : "未找到该商户号，请检查商户号。"; }
  else if (command === "订单") { const item = args[0] ? getOrder(args[0]) : undefined; reply = item ? `订单：${item.platformOrderNo}\n状态：${item.status}\n金额：${item.amount} 分\n通道：${item.channelId}` : "未找到该订单，请检查订单号。"; }
  else if (/^(群组id|群组ID|ID)$/i.test(command)) reply = `当前群组 ID：${chatId}`;
  else if (command === "设置操作员") { if (!isAdmin) reply = "只有群组管理员可以设置操作员。"; else { const target = args[0] || ""; if (!target) reply = "用法：设置操作员 @用户名"; else { const normalized = target.replace(/^@/, ""); upsertBotOperator({ chatId, userId: normalized, username: normalized }); reply = `已设置 ${target} 为操作员。`; } } }
  else if (command === "删除操作员") { if (!isAdmin) reply = "只有群组管理员可以删除操作员。"; else reply = deleteBotOperator(chatId, args[0] || "") ? "操作员已删除。" : "未找到该操作员。"; }
  else if (command === "绑定商户") { const target = args[0] || ""; const found = listPlatformMerchants().find((row: any) => String(row.id) === target || String(row.code) === target); if (!found) reply = "未找到该码商，请检查商户编码。"; else { bindBotMerchant(chatId, String(found.id)); reply = `已绑定商户：${found.name}（${found.code}）`; } }
  else if (command === "置顶" || command === "删除") { const replyTo = message.reply_to_message?.message_id; if (!replyTo) reply = `请回复目标消息后发送“${command}”。`; else { try { if (command === "置顶") await pinTelegramMessage(chatId, String(replyTo)); else await deleteTelegramMessage(chatId, String(replyTo)); reply = `${command}操作成功。`; } catch { reply = `${command}操作失败，请确认机器人有管理员权限。`; } } }
  else if (command === "机器人退群") { try { await leaveTelegramChat(chatId); return; } catch { reply = "机器人退群失败，请确认权限。"; } }
  else if (command === "计算器") { const expr = args.join(""); if (!/^[0-9+\-*/(). ]{1,80}$/.test(expr)) reply = "只支持数字和 + - * / ( ) 运算。"; else { try { const value = Function(`"use strict"; return (${expr})`)(); reply = `计算结果：${Number(value).toLocaleString("zh-CN")}`; } catch { reply = "计算式无法识别。"; } } }
  else if (/^[+-]\d+(?:\.\d+)?$/.test(command)) { const amount = Number(command); addBotLedgerEntry({ chatId, merchantId: merchant?.id, entryType: amount >= 0 ? "PAYOUT_ADD" : "PAYOUT_SUBTRACT", amount, operatorUserId: userId, operatorUsername: username }); reply = `下发账已${amount >= 0 ? "增加" : "扣减"} ${Math.abs(amount)}。`; }
  else if (/^余额[+-]\d+(?:\.\d+)?$/.test(command)) { if (!merchant) reply = "请先使用“绑定商户 <商户号>”。"; else { const amount = Number(command.slice(2)); try { const account = adjustMerchantBalance(String(merchant.id), { delta: amount, note: "BOT 群组余额调整", operator: username || userId }); reply = `商户余额已${amount >= 0 ? "增加" : "扣减"} ${Math.abs(amount)}，当前可用余额 ${Number((account as any)?.availableBalance ?? 0)}。`; } catch (error) { reply = `余额调整失败：${error instanceof Error ? error.message : String(error)}`; } } }
  else if (command === "记账") { const amount = Number(args[0]); if (!Number.isFinite(amount) || amount === 0) reply = "用法：记账 1000 备注，或记账 -1000 备注"; else { addBotLedgerEntry({ chatId, merchantId: merchant?.id, entryType: "ACCOUNTING", amount, note: args.slice(1).join(" "), operatorUserId: userId, operatorUsername: username }); reply = `已记账：${amount >= 0 ? "+" : ""}${amount}${args.length > 1 ? `（${args.slice(1).join(" ")}）` : ""}`; } }
  else if (command === "撤销记账") reply = removeLastBotLedgerEntry(chatId) ? "已撤销今日最后一笔记账。" : "今日暂无可撤销记账。";
  else if (command === "清除记账") { const count = clearBotLedger(chatId); reply = `已清除今日 ${count} 笔记账。`; }
  else if (command === "今日账单" || command === "昨日账单") { const date = command === "今日账单" ? new Date() : new Date(Date.now() - 86_400_000); const rows = listBotLedgerEntries(chatId, date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })); const total = rows.reduce((sum, row) => sum + Number(row.amount), 0); reply = `${command}\n记录：${rows.length} 笔\n合计：${total >= 0 ? "+" : ""}${total}\n${rows.slice(0, 30).map((row) => `${Number(row.amount) >= 0 ? "+" : ""}${Number(row.amount)} ${row.note || ""}`).join("\n") || "暂无记录"}`; }
  else if (command === "查询余额") { reply = merchant ? `商户：${merchant.name}\n可用余额：${Number((getMerchantFinancialOverview(String(merchant.id)) as any)?.availableBalance ?? 0)}` : "请先绑定商户。"; }
  else if (command === "今日跑量" || command === "跑量" || command === "昨日跑量") { const date = command === "昨日跑量" ? new Date(Date.now() - 86_400_000) : new Date(); const day = date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }); const end = new Date(new Date(`${day}T00:00:00+08:00`).getTime() + 86_400_000).toISOString(); const start = new Date(`${day}T00:00:00+08:00`).toISOString(); const reports = merchant ? [getMerchantOperationalReport({ merchantId: String(merchant.id), dateFrom: start, dateTo: end })] : []; reply = reports.length ? `${command}\n订单：${(reports[0] as any).totals.orderCount}\n成功：${(reports[0] as any).totals.successCount}\n成功金额：${(reports[0] as any).totals.grossAmount}` : "请先绑定商户。"; }
  else if (command === "商户结算" || command === "确认商户结算") { if (!merchant) reply = "请先绑定商户。"; else { const start = new Date(Date.now() - 86_400_000); const end = new Date(); try { const statement = command === "商户结算" ? createSettlementStatement({ merchantId: String(merchant.id), dateFrom: start.toISOString(), dateTo: end.toISOString() }) : listSettlementStatements(String(merchant.id), 1)[0]; if (command === "确认商户结算" && statement?.id) updateSettlementStatementStatus(String(statement.id), "CONFIRMED"); reply = `商户结算单：${statement?.id || "暂无"}\n金额：${Number(statement?.netAmount || 0)}\n状态：${command === "确认商户结算" ? "已确认" : statement?.status || "-"}`; } catch (error) { reply = `结算失败：${error instanceof Error ? error.message : String(error)}`; } } }
  else if (command === "通道结算" || command === "确认通道结算") { const start = new Date(Date.now() - 86_400_000); const end = new Date(); const rows = getSettlementReport({ dateFrom: start.toISOString(), dateTo: end.toISOString(), platformMerchantId: merchant?.id ? String(merchant.id) : undefined }); reply = rows.length ? `${command}\n${rows.slice(0, 20).map((row) => `${row.channelId}｜订单 ${row.orderCount}｜交易额 ${row.grossAmount}｜退款 ${row.refundAmount}｜净结算 ${row.netAmount}`).join("\n")}` : "暂无通道结算数据。确认通道结算请在后台对账页面完成付款确认。"; }
  else if (command === "代付撤单") reply = "当前系统尚未接入代付订单模型，暂不能执行代付撤单；请在代付模块接入后再启用此命令。";
  else if (command === "代付回单") reply = args[0] ? "当前系统尚未接入代付回单数据源，请在代付模块配置后再查询。" : "用法：代付回单 商户单号";
  else if (command === "zz") { const replyTo = message.reply_to_message?.message_id; if (!replyTo) reply = "请回复要转发的发单消息后发送：zz 备注"; else { try { await forwardTelegramMessage(chatId, chatId, String(replyTo)); reply = args.length ? `已转发，备注：${args.join(" ")}` : "已转发。"; } catch { reply = "转发失败，请确认机器人有读取和发送消息权限。"; } } }
  else if (command === "cmo") { const values = args.filter(Boolean); const rows = values.map((value) => getOrder(value)).filter(Boolean) as Array<Record<string, any>>; reply = rows.length ? ["单号转换结果：", ...rows.map((item) => `系统单号：${item.platformOrderNo}\n商户单号：${item.clientRequestNo || "-"}\n通道单号：${item.channelOutTradeNo || "-"}`)].join("\n\n") : "未找到订单，请提供系统单号或商户单号。"; }
  else if (command === "群发商户" || command === "群发通道") { const content = String(message.reply_to_message?.text || args.join(" ")).trim(); if (!content) reply = `用法：先发送要群发的内容，再回复该消息发送“${command}”。`; else { const scopeMerchant = command === "群发商户" ? String(merchant?.id || "") : undefined; const scopeChannel = command === "群发通道" ? String(args[0] || "") : undefined; if (command === "群发商户" && !scopeMerchant) reply = "请先绑定商户，再执行群发商户。"; else if (command === "群发通道" && !scopeChannel) reply = "用法：群发通道 通道编码（回复要发送的消息）"; else { await broadcastTelegram(content, "GROUP_BROADCAST", String(settings.adminGroupId || chatId), [], scopeChannel, scopeMerchant); reply = `已发送至${command === "群发商户" ? "绑定商户" : `通道 ${scopeChannel}`}接收群组。`; } } }
  else if (command === "设置费率") reply = "当前费率按后台码商结算费率统一维护；按通道配置多组费率前，请先在后台完成费率规则配置。";
  else if (["uj", "ub", "ua", "uw"].includes(command.toLowerCase())) reply = "USTD 市场报价源尚未配置，暂时无法返回实时价格。";
  else if (!text.startsWith("/") && getOrder(rawCommand)) { const item = getOrder(rawCommand)!; reply = `自动查单\n订单：${item.platformOrderNo}\n状态：${item.status}\n金额：${item.amount} 分\n通道：${item.channelId}\n备注：${args.join(" ") || "-"}`; }
  else reply = "未知命令，请发送“帮助”查看中文命令。";
  await sendTelegramMessage(chatId, reply, "COMMAND");
}
app.post("/webhooks/telegram", (req, res) => { void handleTelegramUpdate(req.body).catch((error) => console.error("Telegram update failed", error)); return res.json({ ok: true }); });

const adminLoginSchema = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(128) });
app.post("/api/v1/auth/login", rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  if (!config.adminAuthEnabled) return res.json({ data: { user: { id: "local", username: "local-admin", role: "SUPER_ADMIN" }, authEnabled: false } });
  const parsed = adminLoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_LOGIN" });
  const result = loginAdmin(parsed.data.username, parsed.data.password);
  if (!result) return res.status(401).json({ error: "INVALID_CREDENTIALS" });
  setSessionCookie(res, result.token);
  createAuditLog({ action: "ADMIN_LOGIN", operator: result.user.username, targetType: "admin_user", targetId: result.user.id, detail: { role: result.user.role } });
  return res.json({ data: { user: result.user, authEnabled: true } });
});
app.post("/api/v1/auth/logout", (req, res) => {
  const user = getAdminFromToken(cookieToken(req));
  if (user) createAuditLog({ action: "ADMIN_LOGOUT", operator: user.username, targetType: "admin_user", targetId: user.id });
  logoutAdmin(cookieToken(req)); clearSessionCookie(res); return res.json({ data: { ok: true } });
});
app.get("/api/v1/auth/me", (req, res) => {
  if (!config.adminAuthEnabled) return res.json({ data: { authEnabled: false, user: { id: "local", username: "local-admin", role: "SUPER_ADMIN" } } });
  const user = getAdminFromToken(cookieToken(req));
  if (!user) return res.status(401).json({ error: "ADMIN_AUTH_REQUIRED" });
  return res.json({ data: { authEnabled: true, user } });
});

const merchantLoginSchema = z.object({ username: z.string().min(2).max(64), password: z.string().min(8).max(128) });
const merchantLegacyLoginSchema = z.object({ code: z.string().min(2).max(64), apiKey: z.string().min(16).max(128) });
function requireMerchantRole(...roles: string[]) {
  return (req: MerchantRequest, res: Response, next: NextFunction): void => {
    requireMerchant(req, res, () => {
      const role = String(req.merchant?.role || "OWNER");
      if (!roles.includes(role)) { res.status(403).json({ error: "MERCHANT_PERMISSION_DENIED", role, requiredRoles: roles }); return; }
      next();
    });
  };
}
type ClientMerchantRequest = Request & { clientMerchant?: Record<string, unknown> };
function requireClientMerchant(req: ClientMerchantRequest, res: Response, next: NextFunction): void {
  const apiKey = String(req.headers["x-client-merchant-key"] ?? "");
  if (!apiKey) { requireClientMerchantSession(req, res, next); return; }
  const merchant = apiKey ? authenticateClientMerchant(apiKey) : undefined;
  if (!merchant) { res.status(401).json({ error: "CLIENT_MERCHANT_AUTH_REQUIRED" }); return; }
  const allowlist = String(merchant.loginIpAllowlist ?? "").split("|").map((item) => item.trim()).filter(Boolean);
  const requestIp = String(req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  if (allowlist.length && !allowlist.includes("*") && !allowlist.includes(requestIp)) { res.status(403).json({ error: "CLIENT_MERCHANT_IP_NOT_ALLOWED", ip: requestIp }); return; }
  req.clientMerchant = merchant;
  next();
}
app.post("/api/v1/merchant/auth/login", rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
  if (typeof req.body?.username === "string") {
    const parsed = merchantLoginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_LOGIN" });
    const result = loginMerchantUser(parsed.data.username, parsed.data.password);
    if (!result) return res.status(401).json({ error: "INVALID_MERCHANT_CREDENTIALS" });
    setMerchantSessionCookie(res, result.token);
    return res.json({ data: { merchant: result.merchant } });
  }
  const parsed = merchantLegacyLoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_LOGIN" });
  const merchant = authenticatePlatformMerchant(parsed.data.apiKey);
  if (!merchant || merchant.code !== parsed.data.code) return res.status(401).json({ error: "INVALID_MERCHANT_CREDENTIALS" });
  setMerchantSessionCookie(res, loginMerchant(String(merchant.id)));
  return res.json({ data: { merchant: { id: merchant.id, code: merchant.code, name: merchant.name, settlementRate: merchant.settlementRate, role: "OWNER" } } });
});
app.post("/api/v1/merchant/auth/logout", (req, res) => { logoutMerchant(merchantCookieToken(req)); clearMerchantSessionCookie(res); return res.json({ data: { ok: true } }); });
app.get("/api/v1/merchant/auth/me", (req, res) => { const merchant = getMerchantFromRequest(req); if (!merchant) return res.status(401).json({ error: "MERCHANT_AUTH_REQUIRED" }); return res.json({ data: { merchant } }); });
app.post("/api/v1/merchant/auth/password", requireMerchant, (req: MerchantRequest, res) => {
  const parsed = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(8).max(128) }).refine((value) => value.currentPassword !== value.newPassword, { message: "NEW_PASSWORD_MUST_DIFFER" }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_PASSWORD_CHANGE", details: parsed.error.flatten() });
  const username = String(req.merchant?.username || "");
  const user = getMerchantUserByUsername(username);
  if (!user || String(user.merchantId) !== String(req.merchant!.id) || !verifyPassword(parsed.data.currentPassword, user.passwordHash)) return res.status(401).json({ error: "CURRENT_PASSWORD_INVALID" });
  const changed = changeMerchantUserPassword(String(user.id), hashPassword(parsed.data.newPassword));
  if (!changed) return res.status(404).json({ error: "MERCHANT_USER_NOT_FOUND" });
  clearMerchantSessionCookie(res);
  return res.json({ data: { changed: true, requireLogin: true } });
});
app.get("/api/v1/merchant/overview", requireMerchant, (req: MerchantRequest, res) => res.json({ data: getMerchantOverview(String(req.merchant!.id)) }));
app.get("/api/v1/merchant/sub-merchants/stats", requireMerchant, (req: MerchantRequest, res) => res.json({ data: getMerchantSubMerchantStats(String(req.merchant!.id)) }));
app.get("/api/v1/merchant/sub-merchants/:merchantId", requireMerchant, (req: MerchantRequest, res) => {
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
  const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;
  const validDate = (value: string | undefined): boolean => value == null || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!validDate(dateFrom) || !validDate(dateTo)) return res.status(400).json({ error: "INVALID_SUB_MERCHANT_RANGE" });
  const start = dateFrom ? new Date(`${dateFrom}T00:00:00+08:00`).toISOString() : undefined;
  const end = dateTo ? new Date(`${dateTo}T00:00:00+08:00`).toISOString() : undefined;
  if (start && end && end <= start) return res.status(400).json({ error: "INVALID_SUB_MERCHANT_RANGE" });
  const result = listMerchantSubMerchantOrders(String(req.merchant!.id), String(req.params.merchantId), { page: Number(req.query.page ?? 1), pageSize: Number(req.query.pageSize ?? 50), status: typeof req.query.status === "string" ? req.query.status : undefined, query: typeof req.query.q === "string" ? req.query.q : undefined, dateFrom: start, dateTo: end });
  if (!result) return res.status(404).json({ error: "SUB_MERCHANT_NOT_FOUND" });
  return res.json({ data: result.merchant, orders: result.items, meta: { total: result.total, page: result.page, pageSize: result.pageSize, totalPages: Math.ceil(result.total / result.pageSize) } });
});
app.get("/api/v1/merchant/sub-merchants/:merchantId/export", requireMerchant, (req: MerchantRequest, res) => {
  const result = listMerchantSubMerchantOrders(String(req.merchant!.id), String(req.params.merchantId), { page: 1, pageSize: 200, status: typeof req.query.status === "string" ? req.query.status : undefined, query: typeof req.query.q === "string" ? req.query.q : undefined });
  if (!result) return res.status(404).json({ error: "SUB_MERCHANT_NOT_FOUND" });
  const csv = ["商户号,平台订单号,金额(分),通道,状态,创建时间,支付时间", ...result.items.map((row) => [result.merchant.mchId, row.platformOrderNo, row.amount, row.channelId, row.status, row.createdAt, row.paidAt].map(csvCell).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", "attachment; filename=sub-merchant-orders.csv"); return res.send(`\uFEFF${csv}`);
});
app.get("/api/v1/merchant/account", requireMerchant, (req: MerchantRequest, res) => res.json({ data: getMerchantFinancialOverview(String(req.merchant!.id)) }));
app.get("/api/v1/merchant/account/ledger", requireMerchant, (req: MerchantRequest, res) => res.json({ data: listMerchantLedgerEntries(String(req.merchant!.id), Number(req.query.limit ?? 100)) }));
app.get("/api/v1/merchant/account/credit-ledger", requireMerchant, (req: MerchantRequest, res) => res.json({ data: listMerchantCreditLedger(String(req.merchant!.id), Number(req.query.limit ?? 100)) }));
app.get("/api/v1/merchant/account/alerts", requireMerchant, (req: MerchantRequest, res) => res.json({ data: listMerchantAlertEvents(String(req.merchant!.id), Number(req.query.limit ?? 100)) }));
app.get("/api/v1/merchant/channels", requireMerchant, (req: MerchantRequest, res) => res.json({ data: listMerchantChannelSettings(String(req.merchant!.id)) }));
app.get("/api/v1/merchant/channels/stats", requireMerchant, (req: MerchantRequest, res) => res.json({ data: getMerchantChannelStats(String(req.merchant!.id)) }));
app.get("/api/v1/merchant/permissions", requireMerchant, (req: MerchantRequest, res) => {
  const role = String(req.merchant?.role || "OWNER");
  return res.json({ data: { role, resources: { subjectRead: true, appRead: true, merchantRead: true, merchantCreate: ["OWNER", "OPERATOR"].includes(role), merchantClone: ["OWNER", "OPERATOR"].includes(role), qrRead: true, qrManage: ["OWNER", "OPERATOR"].includes(role) } } });
});
app.get("/api/v1/merchant/resources/subjects", requireMerchant, (req: MerchantRequest, res) => res.json({ data: listPlatformMerchantSubjects(String(req.merchant!.id)) }));
app.get("/api/v1/merchant/resources/apps", requireMerchant, (req: MerchantRequest, res) => res.json({ data: listPlatformMerchantApps(String(req.merchant!.id)) }));
app.get("/api/v1/merchant/resources/merchants", requireMerchant, (req: MerchantRequest, res) => res.json({ data: listPlatformMerchantWechatMerchants(String(req.merchant!.id)) }));
app.get("/api/v1/merchant/resources/qr-codes", requireMerchant, (req: MerchantRequest, res) => {
  const channelIds = listMerchantChannelIds(String(req.merchant!.id)).map(String);
  const data = listQrCollectionCodes().filter((item) => item.channelId && channelIds.includes(String(item.channelId)));
  return res.json({ data });
});
app.post("/api/v1/merchant/resources/qr-codes", requireMerchantRole("OWNER", "OPERATOR"), (req: MerchantRequest, res) => {
  const parsed = z.object({ name: z.string().max(120).optional(), payload: z.string().min(3).max(20000), channelId: entityId, status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]).optional(), dailyAmountLimit: z.number().int().nonnegative().optional(), dailyOrderLimit: z.number().int().nonnegative().optional(), orderWindowSeconds: z.number().int().nonnegative().optional(), orderWindowLimit: z.number().int().nonnegative().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_QR_CODE", details: parsed.error.flatten() });
  const merchantId = String(req.merchant!.id);
  if (!listMerchantChannelIds(merchantId).map(String).includes(String(parsed.data.channelId))) return res.status(403).json({ error: "MERCHANT_CHANNEL_NOT_AUTHORIZED" });
  try { const item = createQrCollectionCode({ ...parsed.data, ownerId: merchantId }); createAuditLog({ action: "MERCHANT_QR_CODE_CREATE", operator: String(req.merchant?.code || "merchant"), targetType: "qr_code", targetId: String(item.id), detail: { channelId: parsed.data.channelId } }); return res.status(201).json({ data: item }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "QR_CODE_CREATE_FAILED" }); }
});
app.patch("/api/v1/merchant/resources/qr-codes/:id", requireMerchantRole("OWNER", "OPERATOR"), (req: MerchantRequest, res) => {
  const merchantId = String(req.merchant!.id); const channelIds = listMerchantChannelIds(merchantId).map(String);
  const current = listQrCollectionCodes().find((item) => String(item.id) === String(req.params.id) && item.channelId && channelIds.includes(String(item.channelId)));
  if (!current) return res.status(404).json({ error: "QR_CODE_NOT_FOUND" });
  const parsed = z.object({ name: z.string().max(120).optional(), status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]).optional(), dailyAmountLimit: z.number().int().nonnegative().optional(), dailyOrderLimit: z.number().int().nonnegative().optional(), orderWindowSeconds: z.number().int().nonnegative().optional(), orderWindowLimit: z.number().int().nonnegative().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_QR_CODE", details: parsed.error.flatten() });
  const item = updateQrCollectionCode(String(req.params.id), parsed.data); createAuditLog({ action: "MERCHANT_QR_CODE_UPDATE", operator: String(req.merchant?.code || "merchant"), targetType: "qr_code", targetId: String(req.params.id), detail: parsed.data }); return res.json({ data: item });
});
app.post("/api/v1/merchant/resources/merchants", requireMerchantRole("OWNER", "OPERATOR"), (req: MerchantRequest, res) => {
  const parsed = z.object({ channelId: entityId, mchid: z.string().min(6).max(64), apiV2Key: z.string().min(16).max(128), dailyAmountLimit: z.number().int().nonnegative().max(10_000_000_000).default(0), orderWindowSeconds: z.number().int().nonnegative().max(86_400).default(0), orderWindowLimit: z.number().int().nonnegative().max(1_000_000).default(0), dailyOrderLimit: z.number().int().nonnegative().max(1_000_000).default(0), dailySuccessLimit: z.number().int().nonnegative().max(1_000_000).default(0) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT", details: parsed.error.flatten() });
  const platformMerchantId = String(req.merchant!.id);
  if (!isPlatformMerchantChannelAuthorized(platformMerchantId, parsed.data.channelId)) return res.status(403).json({ error: "MERCHANT_CHANNEL_NOT_AUTHORIZED" });
  try {
    const channel = getChannel(parsed.data.channelId);
    if (!channel) return res.status(404).json({ error: "CHANNEL_NOT_FOUND" });
    const item = createMerchant({ ...parsed.data, credentialRef: saveApiV2Credential(parsed.data.mchid, parsed.data.apiV2Key), subjectId: String(channel.subjectId) });
    setMerchantChannelBindings(String(item.id), [parsed.data.channelId]);
    createAuditLog({ action: "MERCHANT_PORTAL_CREATE", operator: String(req.merchant?.code || req.merchant?.username || "merchant"), targetType: "wechat_merchant", targetId: String(item.id), detail: { mchid: parsed.data.mchid, channelId: parsed.data.channelId } });
    return res.status(201).json({ data: item });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_CREATE_FAILED" }); }
});
app.post("/api/v1/merchant/resources/merchants/:id/clone", requireMerchantRole("OWNER", "OPERATOR"), (req: MerchantRequest, res) => {
  const parsed = z.object({ channelId: entityId, mchid: z.string().min(6).max(64), apiV2Key: z.string().min(16).max(128), dailyAmountLimit: z.number().int().nonnegative().max(10_000_000_000).default(0), orderWindowSeconds: z.number().int().nonnegative().max(86_400).default(0), orderWindowLimit: z.number().int().nonnegative().max(1_000_000).default(0), dailyOrderLimit: z.number().int().nonnegative().max(1_000_000).default(0), dailySuccessLimit: z.number().int().nonnegative().max(1_000_000).default(0) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_CLONE", details: parsed.error.flatten() });
  const platformMerchantId = String(req.merchant!.id);
  const visible = listPlatformMerchantWechatMerchants(platformMerchantId).some((item) => String(item.id) === String(req.params.id));
  if (!visible) return res.status(404).json({ error: "MERCHANT_NOT_FOUND" });
  if (!isPlatformMerchantChannelAuthorized(platformMerchantId, parsed.data.channelId)) return res.status(403).json({ error: "MERCHANT_CHANNEL_NOT_AUTHORIZED" });
  try {
    const source = listMerchants().find((item) => String(item.id) === String(req.params.id));
    const channel = getChannel(parsed.data.channelId);
    if (!source || !channel) return res.status(404).json({ error: "MERCHANT_NOT_FOUND" });
    if (String(source.subjectId) !== String(channel.subjectId)) return res.status(409).json({ error: "CHANNEL_SUBJECT_MISMATCH" });
    const item = cloneMerchant(String(req.params.id), { ...parsed.data, credentialRef: saveApiV2Credential(parsed.data.mchid, parsed.data.apiV2Key) });
    setMerchantChannelBindings(String(item.id), [parsed.data.channelId]);
    createAuditLog({ action: "MERCHANT_PORTAL_CLONE", operator: String(req.merchant?.code || req.merchant?.username || "merchant"), targetType: "wechat_merchant", targetId: String(item.id), detail: { sourceMerchantId: String(req.params.id), mchid: parsed.data.mchid, channelId: parsed.data.channelId } });
    return res.status(201).json({ data: item });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_CLONE_FAILED" }); }
});
app.patch("/api/v1/merchant/channels/:channelId", requireMerchantRole("OWNER", "OPERATOR"), (req: MerchantRequest, res) => {
  const parsed = z.object({ enabled: z.boolean().optional(), routeWeight: z.number().int().min(1).max(10000).optional(), routeStrategy: z.enum(["HEALTH_WEIGHTED", "ROUND_ROBIN", "FAILOVER"]).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_CHANNEL_SETTING", details: parsed.error.flatten() });
  try { const item = updateMerchantChannelSetting(String(req.merchant!.id), String(req.params.channelId), parsed.data); createAuditLog({ action: "MERCHANT_CHANNEL_SETTING_UPDATE", operator: String(req.merchant!.code), targetType: "platform_merchant_channel", targetId: `${req.merchant!.id}:${req.params.channelId}`, detail: parsed.data }); return res.json({ data: item }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_CHANNEL_SETTING_FAILED" }); }
});
app.get("/api/v1/merchant/webhook", requireMerchant, (req: MerchantRequest, res) => { const item = getMerchantWebhook(String(req.merchant!.id)); return res.json({ data: item ? { ...item, secret: "********" } : null }); });
app.put("/api/v1/merchant/webhook", requireMerchant, (_req: MerchantRequest, res) => {
  return res.status(403).json({ error: "MERCHANT_WEBHOOK_PLATFORM_MANAGED" });
});
app.get("/api/v1/merchant/webhook/deliveries", requireMerchant, (req: MerchantRequest, res) => res.json({ data: listMerchantWebhookDeliveries(String(req.merchant!.id), Number(req.query.limit ?? 100)) }));
app.post("/api/v1/merchant/webhook/test", requireMerchant, (_req: MerchantRequest, res) => {
  return res.status(403).json({ error: "MERCHANT_WEBHOOK_PLATFORM_MANAGED" });
});
app.get("/api/v1/merchant/orders", requireMerchant, (req: MerchantRequest, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  return res.json({ data: listMerchantOrders(String(req.merchant!.id), Number(req.query.limit ?? 100), status) });
});
app.get("/api/v1/merchant/orders/search", requireMerchant, (req: MerchantRequest, res) => {
  const result = searchOrders({ merchantId: String(req.merchant!.id), page: Number(req.query.page ?? 1), pageSize: Number(req.query.pageSize ?? req.query.limit ?? 100), status: typeof req.query.status === "string" ? req.query.status : undefined, query: typeof req.query.q === "string" ? req.query.q : undefined, dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined, dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined });
  return res.json({ data: result.items, meta: { total: result.total, page: result.page, pageSize: result.pageSize, totalPages: Math.ceil(result.total / result.pageSize) }, metrics: result.metrics });
});
app.get("/api/v1/merchant/refunds", requireMerchant, (req: MerchantRequest, res) => res.json({ data: listMerchantRefunds(String(req.merchant!.id), Number(req.query.limit ?? 100)) }));
app.get("/api/v1/merchant/refunds/export", requireMerchant, (req: MerchantRequest, res) => {
  const rows = listMerchantRefunds(String(req.merchant!.id), 500);
  const csv = ["退款单,平台订单号,金额(分),原因,状态,创建时间,完成时间", ...rows.map((row) => [row.refundNo, row.platformOrderNo, row.refundAmount, row.reason, row.status, row.createdAt, row.completedAt].map(csvCell).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", "attachment; filename=merchant-refunds.csv"); return res.send(`\uFEFF${csv}`);
});
app.get("/api/v1/merchant/settlement/report", requireMerchant, (req: MerchantRequest, res) => {
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : "";
  const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || new Date(`${dateTo}T00:00:00+08:00`) <= new Date(`${dateFrom}T00:00:00+08:00`)) return res.status(400).json({ error: "INVALID_SETTLEMENT_RANGE" });
  return res.json({ data: getSettlementReport({ dateFrom: new Date(`${dateFrom}T00:00:00+08:00`).toISOString(), dateTo: new Date(`${dateTo}T00:00:00+08:00`).toISOString(), platformMerchantId: String(req.merchant!.id) }) });
});
app.get("/api/v1/merchant/report/operations", requireMerchant, (req: MerchantRequest, res) => {
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : "";
  const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) return res.status(400).json({ error: "INVALID_OPERATION_RANGE" });
  const start = new Date(`${dateFrom}T00:00:00+08:00`); const end = new Date(`${dateTo}T00:00:00+08:00`); if (end <= start) return res.status(400).json({ error: "INVALID_OPERATION_RANGE" });
  return res.json({ data: getMerchantOperationalReport({ merchantId: String(req.merchant!.id), dateFrom: start.toISOString(), dateTo: end.toISOString() }) });
});
app.get("/api/v1/merchant/report/operations/export", requireMerchant, (req: MerchantRequest, res) => {
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : ""; const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) return res.status(400).json({ error: "INVALID_OPERATION_RANGE" });
  const start = new Date(`${dateFrom}T00:00:00+08:00`); const end = new Date(`${dateTo}T00:00:00+08:00`); if (end <= start) return res.status(400).json({ error: "INVALID_OPERATION_RANGE" });
  const report = getMerchantOperationalReport({ merchantId: String(req.merchant!.id), dateFrom: start.toISOString(), dateTo: end.toISOString() }) as { daily: Array<Record<string, unknown>> };
  const csv = ["日期,订单数,成功数,失败数,未知数,交易额(分),退款额(分),成功率", ...report.daily.map((row) => [row.date, row.orderCount, row.successCount, row.failedCount, row.unknownCount, row.grossAmount, row.refundAmount, row.successRate].map(csvCell).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", "attachment; filename=merchant-operation-report.csv"); return res.send(`\uFEFF${csv}`);
});
app.get("/api/v1/merchant/settlements", requireMerchant, (req: MerchantRequest, res) => res.json({ data: listSettlementStatements(String(req.merchant!.id), Number(req.query.limit ?? 100)) }));
app.get("/api/v1/merchant/orders/export", requireMerchant, (req: MerchantRequest, res) => {
  const rows = searchOrders({ merchantId: String(req.merchant!.id), page: 1, pageSize: 500, status: typeof req.query.status === "string" ? req.query.status : undefined, query: typeof req.query.q === "string" ? req.query.q : undefined, dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined, dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined }).items;
  const csv = ["平台订单号,金额(分),通道,状态,创建时间,支付时间", ...rows.map((row) => [row.platformOrderNo, row.amount, row.channelId, row.status, row.createdAt, row.paidAt].map(csvCell).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", "attachment; filename=merchant-orders.csv"); return res.send(`\uFEFF${csv}`);
});
app.get("/api/v1/merchant/orders/:id/detail", requireMerchant, (req: MerchantRequest, res) => {
  const detail = getOrderDetail(String(req.params.id));
  if (!detail || String(detail.merchantId) !== String(req.merchant!.id)) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  return res.json({ data: detail });
});
app.get("/api/v1/merchant/orders/:id", requireMerchant, (req: MerchantRequest, res) => {
  const order = getOrder(String(req.params.id));
  if (!order || String(order.merchantId) !== String(req.merchant!.id)) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  return res.json({ data: order });
});
app.get("/api/v1/merchant/settlements/export", requireMerchant, (req: MerchantRequest, res) => {
  const rows = listSettlementStatements(String(req.merchant!.id), 500);
  const csv = ["结算单,开始日期,结束日期,交易额,退款,手续费,净结算,状态,创建时间", ...rows.map((row) => [row.id, row.dateFrom, row.dateTo, row.grossAmount, row.refundAmount, row.feeAmount, row.netAmount, row.status, row.createdAt].map(csvCell).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", "attachment; filename=merchant-settlements.csv"); return res.send(`\uFEFF${csv}`);
});
app.get("/api/v1/merchant/settlements/:id", requireMerchant, (req: MerchantRequest, res) => {
  const statement = getSettlementStatement(String(req.params.id));
  if (!statement || String(statement.merchantId) !== String(req.merchant!.id)) return res.status(404).json({ error: "SETTLEMENT_NOT_FOUND" });
  return res.json({ data: statement });
});
app.post("/api/v1/merchant/settlements/:id/confirm", requireMerchantRole("OWNER", "FINANCE"), (req: MerchantRequest, res) => {
  const statement = getSettlementStatement(String(req.params.id));
  if (!statement || String(statement.merchantId) !== String(req.merchant!.id)) return res.status(404).json({ error: "SETTLEMENT_NOT_FOUND" });
  if (statement.status !== "DRAFT") return res.status(409).json({ error: "SETTLEMENT_STATUS_INVALID" });
  return res.json({ data: updateSettlementStatementStatus(String(req.params.id), "CONFIRMED") });
});

app.get("/api/v1/client/auth/me", requireClientMerchant, (req: ClientMerchantRequest, res) => res.json({ data: { merchant: req.clientMerchant } }));
app.post("/api/v1/client/auth/login", rateLimit({ windowMs: 60_000, max: 10, key: (req) => `${req.ip}:client-login` }), (req, res) => {
  const parsed = z.object({ username: z.string().min(3).max(16), password: z.string().min(8).max(128), otp: z.string().regex(/^\d{6}$/).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_CLIENT_MERCHANT_LOGIN" });
  const result = loginClientMerchant(parsed.data.username, parsed.data.password, parsed.data.otp);
  if ("error" in result) return res.status(result.error === "CLIENT_MERCHANT_2FA_REQUIRED" ? 401 : 403).json({ error: result.error });
  res.setHeader("Set-Cookie", `client_merchant_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${8 * 60 * 60}${config.secureCookies ? "; Secure" : ""}`);
  return res.json({ data: result.merchant });
});
app.post("/api/v1/client/auth/logout", (req, res) => { logoutClientMerchant(req); res.setHeader("Set-Cookie", "client_merchant_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"); return res.json({ data: { loggedOut: true } }); });
app.get("/api/v1/client/session/me", requireClientMerchantSession, (req: ClientMerchantRequest, res) => res.json({ data: { merchant: req.clientMerchant } }));
app.post("/api/v1/client/auth/2fa/setup", requireClientMerchantSession, (req: ClientMerchantRequest, res) => { const secret = createTotpSecret(); const username = String(req.clientMerchant!.code || req.clientMerchant!.id); setClientMerchantTwoFactor(String(req.clientMerchant!.id), secret, false); return res.json({ data: { secret, otpauthUri: totpUri(secret, username), message: "请在验证成功后启用二次验证" } }); });
app.post("/api/v1/client/auth/2fa/enable", requireClientMerchantSession, (req: ClientMerchantRequest, res) => { const parsed = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "INVALID_2FA_CODE" }); const row = db.prepare("SELECT two_factor_secret AS secret FROM client_merchants WHERE id = ?").get(String(req.clientMerchant!.id)) as { secret?: string } | undefined; if (!row?.secret) return res.status(409).json({ error: "CLIENT_MERCHANT_2FA_NOT_SETUP" }); if (!verifyTotp(row.secret, parsed.data.code)) return res.status(403).json({ error: "INVALID_2FA_CODE" }); return res.json({ data: setClientMerchantTwoFactor(String(req.clientMerchant!.id), row.secret, true) }); });
app.get("/api/v1/client/overview", requireClientMerchant, (req: ClientMerchantRequest, res) => res.json({ data: getClientMerchant(String(req.clientMerchant!.id)) }));
app.get("/api/v1/client/orders", requireClientMerchant, (req: ClientMerchantRequest, res) => {
  const result = searchOrders({ clientMerchantId: String(req.clientMerchant!.id), page: Number(req.query.page ?? 1), pageSize: Number(req.query.pageSize ?? 50), status: typeof req.query.status === "string" ? req.query.status : undefined, query: typeof req.query.q === "string" ? req.query.q : undefined, dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined, dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined });
  return res.json({ data: result.items, meta: { total: result.total, page: result.page, pageSize: result.pageSize, totalPages: Math.ceil(result.total / result.pageSize) }, metrics: result.metrics });
});
app.get("/api/v1/client/orders/export", requireClientMerchant, (req: ClientMerchantRequest, res) => {
  const rows = searchOrders({ clientMerchantId: String(req.clientMerchant!.id), page: 1, pageSize: 500, status: typeof req.query.status === "string" ? req.query.status : undefined, query: typeof req.query.q === "string" ? req.query.q : undefined, dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined, dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined }).items;
  const csv = ["平台订单号,金额(分),码商,通道,状态,创建时间,支付时间", ...rows.map((row) => [row.platformOrderNo, row.amount, row.merchantName, row.channelId, row.status, row.createdAt, row.paidAt].map(csvCell).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", "attachment; filename=client-merchant-orders.csv"); return res.send(`\uFEFF${csv}`);
});
app.get("/api/v1/client/orders/:id", requireClientMerchant, (req: ClientMerchantRequest, res) => {
  const order = getOrder(String(req.params.id));
  if (!order || String(order.clientMerchantId ?? "") !== String(req.clientMerchant!.id)) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  return res.json({ data: order });
});

app.use("/api/v1/admin", requireAdmin);
app.use("/api/v1/admin", (req: Request & { adminUser?: { username?: string } }, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
    createAuditLog({ action: 'ADMIN_HTTP_MUTATION', operator: req.adminUser?.username ?? 'local-admin', targetType: 'admin_endpoint', targetId: req.path, detail: { method: req.method, statusCode: res.statusCode, durationMs: Date.now() - startedAt, query: req.query } });
  });
  next();
});
app.get("/api/v1/admin/bot/settings", (_req, res) => { const settings = getBotSettings(); const chatIds = [...new Set([String(settings.adminGroupId || ""), ...listBotRecipientGroups().map((group) => String(group.chatId))].filter(Boolean))]; return res.json({ data: { ...settings, groups: listBotRecipientGroups(), operators: chatIds.flatMap((chatId) => listBotOperators(chatId)), commands: BOT_COMMAND_INSTRUCTIONS, logs: listBotDeliveryLogs(30) } }); });
app.patch("/api/v1/admin/bot/settings", (req, res) => {
  const parsed = z.object({ enabled: z.boolean().optional(), botToken: z.string().max(256).optional(), webhookUrl: z.string().max(512).optional(), adminGroupId: z.string().max(128).optional(), reportEnabled: z.boolean().optional(), reportTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), notificationSettings: z.record(z.string(), z.boolean()).optional(), thresholds: z.object({ channelFailureCount: z.number().int().nonnegative().max(100000).optional(), callbackFailureCount: z.number().int().nonnegative().max(100000).optional(), lowBalanceAmount: z.number().int().nonnegative().max(100000000000).optional(), complaintCount: z.number().int().nonnegative().max(100000).optional() }).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_BOT_SETTINGS", details: parsed.error.flatten() });
  return res.json({ data: saveBotSettings(parsed.data) });
});
app.post("/api/v1/admin/bot/test", async (req, res) => {
  const settings = getBotSettings(); const parsed = z.object({ chatId: z.string().max(128).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_BOT_TEST" });
  const chatId = parsed.data.chatId || String(settings.adminGroupId || "");
  if (!chatId) return res.status(400).json({ error: "BOT_GROUP_REQUIRED" });
  try { await sendTelegramMessage(chatId, "BOT 测试消息已发送成功。\n当前后台已启用中文命令，请发送 /帮助 查看命令说明。", "TEST"); return res.json({ data: { sent: true, chatId } }); }
  catch (error) { return res.status(502).json({ error: "BOT_TEST_FAILED", message: error instanceof Error ? error.message : String(error) }); }
});
app.post("/api/v1/admin/bot/webhook", async (req, res) => {
  const settings = getBotSettings();
  if (!settings.configured) return res.status(409).json({ error: "BOT_NOT_CONFIGURED" });
  try { const url = telegramWebhookUrl(publicBaseUrlForRequest(req), String(settings.webhookUrl || "")); await setTelegramWebhook(url); return res.json({ data: { url } }); }
  catch (error) { return res.status(502).json({ error: "BOT_WEBHOOK_FAILED", message: error instanceof Error ? error.message : String(error) }); }
});
app.get("/api/v1/admin/bot/info", async (_req, res) => { try { return res.json({ data: await getTelegramBotInfo() }); } catch (error) { return res.status(502).json({ error: "BOT_INFO_FAILED", message: error instanceof Error ? error.message : String(error) }); } });
app.post("/api/v1/admin/bot/groups", (req, res) => { const parsed = z.object({ name: z.string().min(1).max(80), chatId: z.string().min(1).max(128), scopeType: z.enum(["PLATFORM", "CHANNEL", "MERCHANT"]).default("PLATFORM"), scopeId: z.string().max(128).optional(), enabled: z.boolean().optional() }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "INVALID_BOT_GROUP" }); try { return res.status(201).json({ data: upsertBotRecipientGroup(parsed.data) }); } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "BOT_GROUP_CREATE_FAILED" }); } });
app.patch("/api/v1/admin/bot/groups/:id", (req, res) => { const parsed = z.object({ name: z.string().min(1).max(80), chatId: z.string().min(1).max(128), scopeType: z.enum(["PLATFORM", "CHANNEL", "MERCHANT"]).default("PLATFORM"), scopeId: z.string().max(128).optional(), enabled: z.boolean().optional() }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "INVALID_BOT_GROUP" }); return res.json({ data: upsertBotRecipientGroup({ ...parsed.data, id: String(req.params.id) }) }); });
app.delete("/api/v1/admin/bot/groups/:id", (req, res) => { deleteBotRecipientGroup(String(req.params.id)); return res.json({ data: { deleted: true } }); });
app.post("/api/v1/admin/bot/operators", (req, res) => { const parsed = z.object({ chatId: z.string().min(1).max(128), userId: z.string().min(1).max(128), username: z.string().max(128).optional() }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "INVALID_BOT_OPERATOR" }); upsertBotOperator(parsed.data); return res.status(201).json({ data: listBotOperators(parsed.data.chatId) }); });
app.delete("/api/v1/admin/bot/operators", (req, res) => { const parsed = z.object({ chatId: z.string().min(1).max(128), userId: z.string().min(1).max(128) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "INVALID_BOT_OPERATOR" }); return res.json({ data: { deleted: deleteBotOperator(parsed.data.chatId, parsed.data.userId) } }); });
app.get("/api/v1/admin/readiness", (_req, res) => {
  const configIssues = productionReadinessIssues();
  const credentialsConfigured = config.mockPayment || listCredentialRefs().length > 0;
  const channels = listChannels().filter((channel) => channel.status === "ACTIVE").map((channel) => {
    const preflight = getChannelPreflight(channel.id);
    const credentialReady = config.mockPayment || credentialConfigured(String(channel.credentialRef), String(channel.mchId));
    const preflightIssues = Array.isArray(preflight?.issues) ? preflight.issues as string[] : [];
    const issues = [...preflightIssues, ...(!credentialReady ? ["PAYMENT_CREDENTIAL_INVALID"] : [])];
    return { id: channel.id, ready: Boolean(preflight?.ready) && credentialReady, issues };
  });
  const readyChannels = channels.filter((channel) => channel.ready).length;
  const issues = [...configIssues, ...(credentialsConfigured ? [] : ["PAYMENT_CREDENTIALS_MISSING"]), ...(!config.mockPayment && readyChannels === 0 ? ["NO_READY_CHANNEL"] : [])];
  return res.json({ data: {
    ready: issues.length === 0,
    mode: config.mockPayment ? "MOCK" : "API_V2_NATIVE",
    issues,
    credentials: { configured: credentialsConfigured, count: listCredentialRefs().length },
    channels: { active: channels.length, ready: readyChannels, checks: channels }
  } });
});
function adminCan(req: Request, resource: string, id: string): boolean { return adminScopeAllows((req as Request & { adminUser?: import('./security/admin-auth.js').AdminUser }).adminUser, resource, id); }
function operationPasswordValid(req: Request, password: string): boolean {
  if (!password) return false;
  if (!config.adminAuthEnabled) return true;
  const admin = (req as Request & { adminUser?: import('./security/admin-auth.js').AdminUser }).adminUser;
  return Boolean(admin && verifyAdminOperationPassword(admin.id, password));
}
function adminScopeFilter(req: Request): { clientMerchantIds?: string[]; merchantIds?: string[]; channelIds?: string[] } {
  const user = (req as Request & { adminUser?: { dataScope?: string; dataScopeIds?: string[] } }).adminUser;
  const ids = user?.dataScopeIds ?? [];
  if (user?.dataScope === 'ASSIGNED_CLIENT_MERCHANTS') {
    if (!ids.length) return { clientMerchantIds: [] };
    const marks = ids.map(() => '?').join(',');
    const channelIds = (db.prepare(`SELECT channel_id AS id FROM client_merchant_channels WHERE client_merchant_id IN (${marks}) AND status = 'ACTIVE'`).all(...ids) as Array<{ id: string }>).map((row) => String(row.id));
    const merchantIds = channelIds.length ? (db.prepare(`SELECT DISTINCT platform_merchant_id AS id FROM platform_merchant_channels WHERE channel_id IN (${channelIds.map(() => '?').join(',')})`).all(...channelIds) as Array<{ id: string }>).map((row) => String(row.id)) : [];
    return { clientMerchantIds: ids, merchantIds, channelIds };
  }
  if (user?.dataScope === 'ASSIGNED_CODE_MERCHANTS') {
    if (!ids.length) return { merchantIds: [], channelIds: [] };
    const channelIds = (db.prepare(`SELECT channel_id AS id FROM platform_merchant_channels WHERE platform_merchant_id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Array<{ id: string }>).map((row) => String(row.id));
    return { merchantIds: ids, channelIds };
  }
  if (user?.dataScope === 'ASSIGNED_CHANNELS') return { channelIds: ids };
  return {};
}

app.get("/api/v1/admin/client-merchant-agents", (_req, res) => res.json({ data: listMerchantAgents() }));
app.post("/api/v1/admin/client-merchant-agents", (req, res) => { const parsed = z.object({ name: z.string().min(1).max(80) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_AGENT" }); try { const data = createMerchantAgent(parsed.data.name); createAuditLog({ action: "MERCHANT_AGENT_CREATE", targetType: "merchant_agent", targetId: String(data.id), detail: parsed.data }); return res.status(201).json({ data }); } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_AGENT_CREATE_FAILED" }); } });
app.get("/api/v1/admin/client-merchant-groups", (_req, res) => res.json({ data: listMerchantGroups() }));
app.post("/api/v1/admin/client-merchant-groups", (req, res) => { const parsed = z.object({ name: z.string().min(1).max(80) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_GROUP" }); try { const data = createMerchantGroup(parsed.data.name); createAuditLog({ action: "MERCHANT_GROUP_CREATE", targetType: "merchant_group", targetId: String(data.id), detail: parsed.data }); return res.status(201).json({ data }); } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_GROUP_CREATE_FAILED" }); } });

app.get("/api/v1/admin/client-merchants", (req, res) => {
  const data = listClientMerchants({ query: typeof req.query.q === "string" ? req.query.q : undefined, status: typeof req.query.status === "string" ? req.query.status : undefined }).filter((item) => adminCan(req, 'client_merchant', String(item.id)));
  return res.json({ data });
});
app.post("/api/v1/admin/client-merchants", (req, res) => {
  const parsed = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{2,64}$/).optional(), code: z.string().regex(/^[a-zA-Z0-9_-]{2,64}$/).optional(), name: z.string().min(2).max(120), loginUsername: z.string().regex(/^[a-zA-Z0-9]{3,16}$/), password: z.string().min(8).max(128).optional(), agentName: z.string().max(120).optional(), groupId: z.string().max(64).default("0"), groupName: z.string().max(120).optional(), loginIpAllowlist: z.string().max(2000).default(""), withdrawIpAllowlist: z.string().max(2000).default(""), settlementRate: z.number().min(0).max(100).default(0), profitShare: z.number().min(0).max(100).default(0), withdrawalFee: z.number().min(0).max(100).default(0), balanceWarningAmount: z.number().int().min(0).max(10_000_000_000).default(0), singleOrderLimit: z.number().int().min(0).max(10_000_000_000).default(0), dailyAmountLimit: z.number().int().min(0).max(10_000_000_000).default(0) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_CLIENT_MERCHANT", details: parsed.error.flatten() });
  try { const base = String(parsed.data.loginUsername).toLowerCase(); const generated = `${base}-${Date.now().toString(36)}`.slice(0, 64); const input = { ...parsed.data, id: parsed.data.id ?? generated, code: parsed.data.code ?? generated, passwordHash: parsed.data.password ? hashPassword(parsed.data.password) : undefined }; const item = createClientMerchant(input); createAuditLog({ action: "CLIENT_MERCHANT_CREATE", targetType: "client_merchant", targetId: input.id, detail: { ...parsed.data, password: undefined } }); return res.status(201).json({ data: item }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "CLIENT_MERCHANT_CREATE_FAILED" }); }
});
app.get("/api/v1/admin/client-merchants/:id", (req, res) => {
  if (!adminCan(req, 'client_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const item = getClientMerchant(String(req.params.id)); if (!item) return res.status(404).json({ error: "CLIENT_MERCHANT_NOT_FOUND" });
  return res.json({ data: { ...item, ledger: listClientMerchantLedger(String(req.params.id), 50), codeMerchants: listClientMerchantCodeMerchants(String(req.params.id)), channels: listClientMerchantChannels(String(req.params.id)) } });
});
app.post("/api/v1/admin/client-merchants/:id/rotate-key", (req, res) => {
  if (!adminCan(req, 'client_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const item = rotateClientMerchantApiKey(String(req.params.id));
  if (!item) return res.status(404).json({ error: "CLIENT_MERCHANT_NOT_FOUND" });
  createAuditLog({ action: "CLIENT_MERCHANT_KEY_ROTATE", targetType: "client_merchant", targetId: String(req.params.id), detail: {} });
  return res.json({ data: item });
});
app.post("/api/v1/admin/client-merchants/:id/reset-password", (req, res) => {
  if (!adminCan(req, 'client_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const parsed = z.object({ password: z.string().min(8).max(128) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "INVALID_CLIENT_MERCHANT_PASSWORD" });
  if (!getClientMerchant(String(req.params.id))) return res.status(404).json({ error: "CLIENT_MERCHANT_NOT_FOUND" }); updateClientMerchantPassword(String(req.params.id), hashPassword(parsed.data.password)); createAuditLog({ action: "CLIENT_MERCHANT_PASSWORD_RESET", targetType: "client_merchant", targetId: String(req.params.id), detail: {} }); return res.json({ data: { reset: true } });
});
app.post("/api/v1/admin/client-merchants/:id/2fa/disable", (req, res) => { if (!adminCan(req, 'client_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" }); if (!getClientMerchant(String(req.params.id))) return res.status(404).json({ error: "CLIENT_MERCHANT_NOT_FOUND" }); const data = setClientMerchantTwoFactor(String(req.params.id), "", false); createAuditLog({ action: "CLIENT_MERCHANT_2FA_DISABLE", targetType: "client_merchant", targetId: String(req.params.id), detail: {} }); return res.json({ data }); });
app.patch("/api/v1/admin/client-merchants/:id", (req, res) => {
  if (!adminCan(req, 'client_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const parsed = z.object({ code: z.string().regex(/^[a-zA-Z0-9_-]{2,64}$/).optional(), name: z.string().min(2).max(120).optional(), loginUsername: z.string().regex(/^[a-zA-Z0-9]{3,16}$/).nullable().optional(), password: z.string().min(8).max(128).optional(), agentName: z.string().max(120).nullable().optional(), groupId: z.string().max(64).optional(), groupName: z.string().max(120).nullable().optional(), loginIpAllowlist: z.string().max(2000).optional(), withdrawIpAllowlist: z.string().max(2000).optional(), settlementRate: z.number().min(0).max(100).optional(), profitShare: z.number().min(0).max(100).optional(), withdrawalFee: z.number().min(0).max(100).optional(), balanceWarningAmount: z.number().int().min(0).max(10_000_000_000).optional(), singleOrderLimit: z.number().int().min(0).max(10_000_000_000).optional(), dailyAmountLimit: z.number().int().min(0).max(10_000_000_000).optional(), status: z.enum(["ACTIVE", "DISABLED", "FROZEN", "PENDING"]).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_CLIENT_MERCHANT_UPDATE", details: parsed.error.flatten() });
  try { const { password, ...merchantData } = parsed.data; const updateInput = { ...merchantData, loginUsername: merchantData.loginUsername ?? undefined, agentName: merchantData.agentName ?? undefined, groupName: merchantData.groupName ?? undefined }; const item = updateClientMerchant(String(req.params.id), updateInput); if (!item) return res.status(404).json({ error: "CLIENT_MERCHANT_NOT_FOUND" }); if (password) updateClientMerchantPassword(String(req.params.id), hashPassword(password)); createAuditLog({ action: "CLIENT_MERCHANT_UPDATE", targetType: "client_merchant", targetId: String(req.params.id), detail: { ...parsed.data, password: undefined } }); return res.json({ data: getClientMerchant(String(req.params.id)) }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "CLIENT_MERCHANT_UPDATE_FAILED" }); }
});
app.patch("/api/v1/admin/client-merchants/:id/balance", (req, res) => {
  if (!adminCan(req, 'client_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const parsed = z.object({ amount: z.number().int().positive(), action: z.enum(["ADD", "SUBTRACT"]), note: z.string().max(200).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_CLIENT_MERCHANT_BALANCE", details: parsed.error.flatten() });
  try { const item = adjustClientMerchantBalance(String(req.params.id), parsed.data.amount, parsed.data.action === "ADD" ? "ADJUST_ADD" : "ADJUST_SUBTRACT", parsed.data.note, (req as Request & { adminUser?: { username?: string } }).adminUser?.username); createAuditLog({ action: "CLIENT_MERCHANT_BALANCE_ADJUST", targetType: "client_merchant", targetId: String(req.params.id), detail: parsed.data }); return res.json({ data: item }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "CLIENT_MERCHANT_BALANCE_FAILED" }); }
});
app.post("/api/v1/admin/client-merchants/:id/ledger", (req, res) => {
  const id = String(req.params.id);
  if (!adminCan(req, 'client_merchant', id)) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const parsed = z.object({ action: z.enum(["FREEZE", "UNFREEZE", "SETTLEMENT_RESERVE", "SETTLEMENT_RELEASE", "SETTLEMENT_PAID"]), amount: z.number().int().positive(), note: z.string().max(200).optional(), idempotencyKey: z.string().min(8).max(128).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_CLIENT_MERCHANT_LEDGER", details: parsed.error.flatten() });
  const amount = parsed.data.amount;
  const deltaMap: Record<string, { availableDelta: number; pendingDelta: number; frozenDelta: number; entryType: string }> = {
    FREEZE: { availableDelta: -amount, pendingDelta: 0, frozenDelta: amount, entryType: "FREEZE" },
    UNFREEZE: { availableDelta: amount, pendingDelta: 0, frozenDelta: -amount, entryType: "UNFREEZE" },
    SETTLEMENT_RESERVE: { availableDelta: -amount, pendingDelta: amount, frozenDelta: 0, entryType: "SETTLEMENT_RESERVE" },
    SETTLEMENT_RELEASE: { availableDelta: amount, pendingDelta: -amount, frozenDelta: 0, entryType: "SETTLEMENT_RELEASE" },
    SETTLEMENT_PAID: { availableDelta: 0, pendingDelta: -amount, frozenDelta: 0, entryType: "SETTLEMENT_PAID" }
  };
  const delta = deltaMap[parsed.data.action];
  try {
    const entry = appendClientMerchantLedger({ clientMerchantId: id, amount: parsed.data.action === "SETTLEMENT_PAID" ? -amount : amount, ...delta, referenceType: "ADMIN", referenceId: id, idempotencyKey: parsed.data.idempotencyKey ?? `admin-ledger:${id}:${delta.entryType}:${Date.now()}`, note: parsed.data.note, operator: (req as Request & { adminUser?: { username?: string } }).adminUser?.username });
    createAuditLog({ action: "CLIENT_MERCHANT_LEDGER_ENTRY", targetType: "client_merchant", targetId: id, detail: { ...parsed.data, idempotencyKey: parsed.data.idempotencyKey ?? "generated" } });
    return res.status(201).json({ data: { entry, merchant: getClientMerchant(id) } });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "CLIENT_MERCHANT_LEDGER_FAILED" }); }
});
app.get("/api/v1/admin/client-merchants/:id/ledger", (req, res) => {
  if (!getClientMerchant(String(req.params.id))) return res.status(404).json({ error: "CLIENT_MERCHANT_NOT_FOUND" });
  return res.json({ data: listClientMerchantLedger(String(req.params.id), Number(req.query.limit ?? 100)) });
});
app.get("/api/v1/admin/client-merchants/:id/code-merchants", (req, res) => res.json({ data: listClientMerchantCodeMerchants(String(req.params.id)) }));
app.put("/api/v1/admin/client-merchants/:id/code-merchants", (req, res) => {
  const parsed = z.object({ platformMerchantIds: z.array(z.string().min(1)).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_CLIENT_MERCHANT_CODE_MERCHANTS", details: parsed.error.flatten() });
  try { const data = setClientMerchantCodeMerchants(String(req.params.id), parsed.data.platformMerchantIds); createAuditLog({ action: "CLIENT_MERCHANT_CODE_MERCHANTS_UPDATE", targetType: "client_merchant", targetId: String(req.params.id), detail: parsed.data }); return res.json({ data }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "CLIENT_MERCHANT_CODE_MERCHANTS_FAILED" }); }
});

const channelSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{2,64}$/),
  subjectName: z.string().min(2).max(120),
  subjectType: z.string().default("INDIVIDUAL_BUSINESS"),
  appid: z.string().min(6).max(64),
  mchid: z.string().min(6).max(64),
  credentialRef: z.string().min(1).max(128),
  notifyPath: z.string().optional(),
  routeWeight: z.number().int().min(1).max(10000).default(100)
});

const orderSchema = z.object({
  merchantId: z.string().min(1).max(64).default("demo-merchant"),
  clientMerchantId: z.string().min(1).max(64).optional(),
  clientRequestNo: z.string().min(1).max(64),
  userId: z.string().max(128).optional(),
  amount: z.number().int().positive().max(10_000_000),
  description: z.string().min(1).max(127).default("固定金额扫码订单"),
  paymentMethod: z.enum(["NATIVE", "JSAPI"]).default("NATIVE"),
  collectionMode: z.enum(["NATIVE", "QR"]).default("NATIVE"),
  entryMode: z.enum(["DIRECT", "PUBLIC_ACCOUNT_ARTICLE"]).default("DIRECT"),
  oauthToken: z.string().min(20).max(256).optional(),
  oauthReturnUrl: z.string().url().optional(),
  channelId: z.string().optional(),
  deviceType: z.enum(["ANDROID", "IOS", "WINDOWS", "MAC", "LINUX", "UNKNOWN"]).optional(),
  deviceIp: z.string().max(64).optional(),
  deviceCountry: z.string().max(32).optional(),
  deviceProvince: z.string().max(64).optional(),
  deviceCity: z.string().max(64).optional(),
  deviceNo: z.string().max(128).optional()
});

function requestDeviceInfo(req: Request, input: z.infer<typeof orderSchema>): { deviceType: string; deviceIp: string; deviceCountry: string; deviceProvince: string; deviceCity: string; deviceNo: string; userId: string } {
  const header = (name: string): string => { const value = req.headers[name]; return Array.isArray(value) ? String(value[0] || '') : String(value || ''); };
  const userAgent = header('user-agent').toLowerCase();
  const forwarded = header('x-forwarded-for').split(',')[0]?.trim();
  const deviceType = input.deviceType || (/android/.test(userAgent) ? 'ANDROID' : /iphone|ipad|ipod/.test(userAgent) ? 'IOS' : /windows/.test(userAgent) ? 'WINDOWS' : /mac os|macintosh/.test(userAgent) ? 'MAC' : /linux/.test(userAgent) ? 'LINUX' : 'UNKNOWN');
  const deviceIp = input.deviceIp || forwarded || String(req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return {
    deviceType,
    deviceIp,
    deviceCountry: input.deviceCountry || header('x-device-country') || header('x-country'),
    deviceProvince: input.deviceProvince || header('x-device-province') || header('x-province'),
    deviceCity: input.deviceCity || header('x-device-city') || header('x-city'),
    deviceNo: input.deviceNo || header('x-device-id') || header('x-device-no') || header('x-fingerprint'),
    userId: input.userId || header('x-user-id') || header('x-userid')
  };
}

function memberBlockKeys(device: ReturnType<typeof requestDeviceInfo>, paymentOpenidHash?: string): Array<{ keyType: "MEMBER_ID" | "OPENID_HASH" | "IP" | "DEVICE_ID"; value: string }> {
  return [
    device.userId ? { keyType: "MEMBER_ID" as const, value: device.userId } : undefined,
    paymentOpenidHash ? { keyType: "OPENID_HASH" as const, value: paymentOpenidHash } : undefined,
    device.deviceIp ? { keyType: "IP" as const, value: device.deviceIp } : undefined,
    device.deviceNo ? { keyType: "DEVICE_ID" as const, value: device.deviceNo } : undefined
  ].filter(Boolean) as Array<{ keyType: "MEMBER_ID" | "OPENID_HASH" | "IP" | "DEVICE_ID"; value: string }>;
}

function recordMemberBlockMatch(match: ReturnType<typeof findActiveMemberBlock>, context: Record<string, unknown>): void {
  if (!match) return;
  createAuditLog({ action: "MEMBER_BLOCK_MATCH", targetType: "member_block", targetId: String(match.block.id), detail: { keyType: match.keyType, displayValue: match.displayValue, ...context } });
}

function publicOrder(order: Record<string, any>): Record<string, unknown> {
  return {
    id: order.id,
    platformOrderNo: order.platformOrderNo,
    amount: order.amount,
    description: order.description,
    paymentMethod: order.paymentMethod || "NATIVE",
    collectionMode: order.collectionMode || "NATIVE",
    status: order.status,
    codeUrl: order.codeUrl,
    qrDataUrl: order.qrDataUrl,
    expireAt: order.expireAt,
    createdAt: order.createdAt,
    paidAt: order.paidAt
  };
}

app.get("/api/v1/channels", (_req, res) => res.json({ data: listChannels().map((channel) => ({ id: channel.id, name: channel.name, subjectName: channel.subjectName, paymentMethod: channel.paymentMethod || "NATIVE", notifyPath: channel.notifyPath, routeWeight: channel.routeWeight, status: channel.status })) }));

app.get("/api/v1/admin/overview", (_req, res) => res.json({ data: getOverview() }));
app.get("/api/v1/admin/dashboard", (req, res) => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : today;
  const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) return res.status(400).json({ error: "INVALID_DASHBOARD_RANGE" });
  const start = new Date(`${dateFrom}T00:00:00+08:00`); const end = new Date(new Date(`${dateTo}T00:00:00+08:00`).getTime() + 86_400_000);
  if (end <= start) return res.status(400).json({ error: "INVALID_DASHBOARD_RANGE" });
  return res.json({ data: getAdminOperationalReport({ dateFrom: start.toISOString(), dateTo: end.toISOString() }) });
});
app.get("/api/v1/admin/client-merchants/:id/channels", (req, res) => {
  const id = String(req.params.id); if (!getClientMerchant(id)) return res.status(404).json({ error: "CLIENT_MERCHANT_NOT_FOUND" });
  return res.json({ data: listClientMerchantChannels(id) });
});
app.put("/api/v1/admin/client-merchants/:id/channels", (req, res) => {
  const parsed = z.object({ channelIds: z.array(z.string().min(1)).max(500), routeStrategies: z.record(z.string().min(1), z.enum(["HEALTH_WEIGHTED", "ROUND_ROBIN", "FAILOVER"])).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_CLIENT_MERCHANT_CHANNELS", details: parsed.error.flatten() });
  try { const id = String(req.params.id); const data = setClientMerchantChannels(id, parsed.data.channelIds, parsed.data.routeStrategies); createAuditLog({ action: "CLIENT_MERCHANT_CHANNELS_UPDATE", targetType: "client_merchant", targetId: id, detail: parsed.data }); return res.json({ data }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "CLIENT_MERCHANT_CHANNELS_FAILED" }); }
});
app.get("/api/v1/admin/callback-config", (req, res) => {
  const configuredBaseUrl = config.publicBaseUrl.replace(/\/+$/, "");
  const baseUrl = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredBaseUrl)
    ? `${req.protocol}://${req.get("host")}`
    : configuredBaseUrl;
  return res.json({ data: {
    publicBaseUrl: baseUrl,
    mode: config.mockPayment ? "MOCK" : "API_V3",
    transactionTemplate: `${baseUrl}/webhooks/wechatpay/{channelId}/{mchid}`,
    refundTemplate: `${baseUrl}/webhooks/wechatpay/{channelId}/{mchid}/refund`
  } });
});
app.get("/api/v1/admin/channels", (req, res) => { const scope = adminScopeFilter(req); return res.json({ data: listChannels().filter((item) => !scope.channelIds || scope.channelIds.includes(String(item.id))) }); });
app.get("/api/v1/admin/qr-codes", (req, res) => {
  const query = z.object({ status: z.string().optional(), channelId: z.string().optional(), query: z.string().max(120).optional() }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "INVALID_QR_CODE_QUERY" });
  const scope = adminScopeFilter(req);
  const data = listQrCollectionCodes(query.data).filter((item) => !scope.channelIds || (item.channelId && scope.channelIds.includes(String(item.channelId))));
  return res.json({ data });
});
app.get("/api/v1/admin/qr-monitoring", (req, res) => {
  const scope = adminScopeFilter(req); const data = listQrMonitoring().filter((item) => !scope.channelIds || (item.channelId && scope.channelIds.includes(String(item.channelId))));
  return res.json({ data, summary: { total: data.length, active: data.filter((x) => x.status === "ACTIVE").length, alerts: data.filter((x) => Number(x.alert) === 1).length, orders24h: data.reduce((n, x) => n + Number(x.orderCount24h || 0), 0), amount24h: data.reduce((n, x) => n + Number(x.amount24h || 0), 0) } });
});
app.get("/api/v1/admin/qr-orders", (req, res) => {
  const scope = adminScopeFilter(req); const data = listQrOrders(Number(req.query.limit ?? 100)).filter((item) => !scope.channelIds || scope.channelIds.includes(String(item.channelId)));
  return res.json({ data });
});
app.post("/api/v1/admin/qr-orders/recovery", async (req, res) => {
  const scope = adminScopeFilter(req);
  try { return res.json({ data: await runPaymentRecoveryPass(scope.channelIds) }); }
  catch (error) { return res.status(500).json({ error: error instanceof Error ? error.message : "QR_ORDER_RECOVERY_FAILED" }); }
});
app.get("/api/v1/admin/qr-settlement", (req, res) => {
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : ""; const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) return res.status(400).json({ error: "INVALID_QR_SETTLEMENT_RANGE" });
  const start = new Date(`${dateFrom}T00:00:00+08:00`); const end = new Date(`${dateTo}T00:00:00+08:00`); if (end <= start) return res.status(400).json({ error: "INVALID_QR_SETTLEMENT_RANGE" });
  const scope = adminScopeFilter(req); const rows = getQrSettlementReport({ dateFrom: start.toISOString(), dateTo: end.toISOString(), channelId: typeof req.query.channelId === "string" ? req.query.channelId : undefined }).filter((item) => !scope.channelIds || scope.channelIds.includes(String(item.channelId)));
  return res.json({ data: rows, summary: { orderCount: rows.reduce((n, x) => n + Number(x.orderCount || 0), 0), successCount: rows.reduce((n, x) => n + Number(x.successCount || 0), 0), grossAmount: rows.reduce((n, x) => n + Number(x.grossAmount || 0), 0), refundAmount: rows.reduce((n, x) => n + Number(x.refundAmount || 0), 0), netAmount: rows.reduce((n, x) => n + Number(x.netAmount || 0), 0) } });
});
app.post("/api/v1/admin/qr-monitoring/run", (req, res) => { const scope = adminScopeFilter(req); return res.json({ data: runQrMonitorPass(scope.channelIds) }); });
app.post("/api/v1/admin/qr-codes", (req, res) => {
  const parsed = z.object({ name: z.string().max(120).optional(), payload: z.string().min(3).max(20000), ownerId: z.string().max(120).nullable().optional(), channelId: z.string().max(120).nullable().optional(), qrType: z.string().max(30).optional(), status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]).optional(), dailyAmountLimit: z.number().int().nonnegative().optional(), dailyOrderLimit: z.number().int().nonnegative().optional(), orderWindowSeconds: z.number().int().nonnegative().optional(), orderWindowLimit: z.number().int().nonnegative().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_QR_CODE", details: parsed.error.flatten() });
  if (parsed.data.channelId && !adminCan(req, "channel", parsed.data.channelId)) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  try { const data = createQrCollectionCode(parsed.data); createAuditLog({ action: "QR_CODE_CREATE", targetType: "qr_code", targetId: String(data.id), detail: { channelId: parsed.data.channelId || null } }); return res.status(201).json({ data }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "QR_CODE_CREATE_FAILED" }); }
});
app.post("/api/v1/admin/qr-codes/validate", (req, res) => {
  const parsed = z.object({ items: z.array(z.object({ name: z.string().max(120).optional(), payload: z.string().max(20000), ownerId: z.string().max(120).nullable().optional(), channelId: z.string().max(120).nullable().optional() })).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_QR_CODE_BATCH", details: parsed.error.flatten() });
  const existing = new Set(listQrCollectionCodes().map((item) => String(item.payload).trim())); const seen = new Set<string>();
  const valid: Array<Record<string, unknown>> = []; const skipped: Array<Record<string, unknown>> = [];
  parsed.data.items.forEach((item, index) => { const payload = item.payload.trim(); const reason = !payload ? "内容为空" : existing.has(payload) ? "已存在" : seen.has(payload) ? "批次内重复" : payload.length < 3 ? "内容过短" : ""; if (reason) skipped.push({ index, name: item.name || `收款码-${index + 1}`, reason }); else { seen.add(payload); valid.push({ ...item, payload }); } });
  return res.json({ data: { valid, skipped, total: parsed.data.items.length } });
});
app.post("/api/v1/admin/qr-codes/batch", (req, res) => {
  const parsed = z.object({ items: z.array(z.object({ name: z.string().max(120).optional(), payload: z.string().min(3).max(20000), ownerId: z.string().max(120).nullable().optional(), channelId: z.string().max(120).nullable().optional(), qrType: z.string().max(30).optional() })).min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_QR_CODE_BATCH", details: parsed.error.flatten() });
  const scope = adminScopeFilter(req); const scopedItems = parsed.data.items.filter((item) => !scope.channelIds || (item.channelId && scope.channelIds.includes(String(item.channelId))));
  if (scopedItems.length !== parsed.data.items.length) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const data: Array<Record<string, unknown>> = []; const skipped: string[] = [];
  for (const item of scopedItems) { try { data.push(createQrCollectionCode(item)); } catch (error) { skipped.push(error instanceof Error ? error.message : "QR_CODE_CREATE_FAILED"); } }
  createAuditLog({ action: "QR_CODE_BATCH_CREATE", targetType: "qr_code", detail: { created: data.length, skipped: skipped.length } });
  return res.status(data.length ? 201 : 409).json({ data, skipped });
});
app.post("/api/v1/admin/qr-codes/assign", (req, res) => {
  const parsed = z.object({ ids: z.array(z.string().min(1).max(120)).min(1).max(500), channelId: z.string().max(120).nullable(), ownerId: z.string().max(120).nullable().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_QR_CODE_ASSIGNMENT", details: parsed.error.flatten() });
  if (parsed.data.channelId && !adminCan(req, "channel", parsed.data.channelId)) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  try { const data = assignQrCollectionCodes(parsed.data.ids, parsed.data.channelId, parsed.data.ownerId); createAuditLog({ action: "QR_CODE_BATCH_ASSIGN", targetType: "qr_code", detail: { ids: parsed.data.ids, channelId: parsed.data.channelId } }); return res.json({ data }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "QR_CODE_ASSIGNMENT_FAILED" }); }
});
app.post("/api/v1/admin/qr-codes/batch-status", (req: Request & { adminUser?: { username?: string; id?: string } }, res) => {
  const parsed = z.object({ ids: z.array(z.string().min(1).max(120)).min(1).max(500), status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]), operationPassword: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_QR_CODE_BATCH_STATUS" });
  if (!operationPasswordValid(req, parsed.data.operationPassword || "")) return res.status(403).json({ error: "ADMIN_OPERATION_PASSWORD_REQUIRED" });
  const scope = adminScopeFilter(req); const rows = listQrCollectionCodes().filter((item) => parsed.data.ids.includes(String(item.id)));
  if (rows.length !== parsed.data.ids.length || rows.some((item) => scope.channelIds && (!item.channelId || !scope.channelIds.includes(String(item.channelId))))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  try { const data = rows.map((item) => updateQrCollectionCode(String(item.id), { status: parsed.data.status })); createAuditLog({ action: "QR_CODE_BATCH_STATUS", operator: req.adminUser?.username, targetType: "qr_code", detail: { ids: parsed.data.ids, status: parsed.data.status } }); return res.json({ data }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "QR_CODE_BATCH_STATUS_FAILED" }); }
});
app.get("/api/v1/admin/qr-codes/export", (req, res) => {
  const scope = adminScopeFilter(req); const rows = listQrCollectionCodes().filter((item) => !scope.channelIds || (item.channelId && scope.channelIds.includes(String(item.channelId))));
  const csv = ["收款码,通道,归属码商,状态,今日订单,今日金额,最近使用", ...rows.map((item) => [item.name, item.payload, item.channelId, item.ownerId, item.status, item.todayOrderCount, item.todayAmount, item.lastUsedAt].map(csvCell).join(","))].join("\n"); res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", "attachment; filename=qr-codes.csv"); return res.send(`\uFEFF${csv}`);
});
app.post("/api/v1/admin/qr-codes/:id/test", async (req: Request & { adminUser?: { username?: string } }, res) => {
  const item = listQrCollectionCodes().find((row) => String(row.id) === String(req.params.id)); if (!item) return res.status(404).json({ error: "QR_CODE_NOT_FOUND" });
  if (item.channelId && !adminCan(req, "channel", String(item.channelId))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  try { const qrDataUrl = await QRCode.toDataURL(String(item.payload), { width: 320, margin: 2 }); createAuditLog({ action: "QR_CODE_TEST", operator: req.adminUser?.username, targetType: "qr_code", targetId: String(item.id), detail: {} }); return res.json({ data: { id: item.id, name: item.name, payload: item.payload, qrDataUrl, testedAt: new Date().toISOString() } }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "QR_CODE_TEST_FAILED" }); }
});
app.patch("/api/v1/admin/qr-codes/:id", (req, res) => {
  const parsed = z.object({ name: z.string().max(120).optional(), payload: z.string().min(3).max(20000).optional(), ownerId: z.string().max(120).nullable().optional(), channelId: z.string().max(120).nullable().optional(), qrType: z.string().max(30).optional(), status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]).optional(), dailyAmountLimit: z.number().int().nonnegative().optional(), dailyOrderLimit: z.number().int().nonnegative().optional(), orderWindowSeconds: z.number().int().nonnegative().optional(), orderWindowLimit: z.number().int().nonnegative().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_QR_CODE", details: parsed.error.flatten() });
  const current = listQrCollectionCodes().find((item) => String(item.id) === String(req.params.id));
  if (!current) return res.status(404).json({ error: "QR_CODE_NOT_FOUND" });
  if ((parsed.data.channelId || current.channelId) && !adminCan(req, "channel", String(parsed.data.channelId || current.channelId))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  try { const data = updateQrCollectionCode(String(req.params.id), parsed.data); if (!data) return res.status(404).json({ error: "QR_CODE_NOT_FOUND" }); createAuditLog({ action: "QR_CODE_UPDATE", targetType: "qr_code", targetId: String(req.params.id), detail: parsed.data }); return res.json({ data }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "QR_CODE_UPDATE_FAILED" }); }
});
app.delete("/api/v1/admin/qr-codes/:id", (req, res) => { const current = listQrCollectionCodes().find((item) => String(item.id) === String(req.params.id)); if (!current) return res.status(404).json({ error: "QR_CODE_NOT_FOUND" }); if (current.channelId && !adminCan(req, "channel", String(current.channelId))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" }); if (!operationPasswordValid(req, String((req.body as { operationPassword?: string } | undefined)?.operationPassword || req.query.operationPassword || ""))) return res.status(403).json({ error: "ADMIN_OPERATION_PASSWORD_REQUIRED" }); if (!deleteQrCollectionCode(String(req.params.id))) return res.status(404).json({ error: "QR_CODE_NOT_FOUND" }); createAuditLog({ action: "QR_CODE_DELETE", targetType: "qr_code", targetId: String(req.params.id), detail: {} }); return res.json({ data: { deleted: true } }); });
app.get("/api/v1/admin/qr-channel-settings", (req, res) => { const scope = adminScopeFilter(req); return res.json({ data: listQrChannelSettings().filter((item) => !scope.channelIds || scope.channelIds.includes(String(item.channelId))) }); });
app.patch("/api/v1/admin/channels/:id/qr-config", (req, res) => {
  if (!adminCan(req, "channel", String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const parsed = z.object({ enabled: z.boolean().optional(), routeWeight: z.number().int().min(1).max(10000).optional(), dailyAmountLimit: z.number().int().nonnegative().optional(), dailyOrderLimit: z.number().int().nonnegative().optional(), orderWindowSeconds: z.number().int().nonnegative().optional(), orderWindowLimit: z.number().int().nonnegative().optional(), autoPauseEnabled: z.boolean().optional(), failureRateThreshold: z.number().int().min(0).max(100).optional(), minOrdersForCheck: z.number().int().min(1).max(1000000).optional(), timeoutMinutes: z.number().int().min(1).max(1440).optional(), alertEnabled: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_QR_CHANNEL_CONFIG", details: parsed.error.flatten() });
  try { const data = updateQrChannelSetting(String(req.params.id), parsed.data); if (!data) return res.status(404).json({ error: "CHANNEL_NOT_FOUND" }); createAuditLog({ action: "QR_CHANNEL_CONFIG_UPDATE", targetType: "channel", targetId: String(req.params.id), detail: parsed.data }); return res.json({ data }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "QR_CHANNEL_CONFIG_FAILED" }); }
});
app.get("/api/v1/admin/channels/:id/risk", (req, res) => {
  const channelId = String(req.params.id);
  if (!adminCan(req, 'channel', channelId)) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  if (!getChannel(channelId)) return res.status(404).json({ error: "CHANNEL_NOT_FOUND" });
  return res.json({ data: getChannelRiskPolicy(channelId) });
});
app.patch("/api/v1/admin/channels/:id/risk", (req, res) => {
  const channelId = String(req.params.id);
  if (!adminCan(req, 'channel', channelId)) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const parsed = z.object({
    singleIpPaymentLimit: z.number().int().nonnegative().max(1_000_000),
    consecutiveFailureLimit: z.number().int().nonnegative().max(1_000_000),
    userIdPaymentLimit: z.number().int().nonnegative().max(1_000_000),
    dailyOrderLimit: z.number().int().nonnegative().max(1_000_000),
    floatingAmountMin: z.number().int().nonnegative().max(1_000_000_000),
    floatingAmountMax: z.number().int().nonnegative().max(1_000_000_000),
    amountMin: z.number().int().nonnegative().max(1_000_000_000),
    amountMax: z.number().int().nonnegative().max(1_000_000_000),
    dailyAmountLimit: z.number().int().nonnegative().max(1_000_000_000),
    regionBlacklist: z.string().max(2000).optional()
  }).refine((value) => value.floatingAmountMax === 0 || value.floatingAmountMax >= value.floatingAmountMin, { message: "floatingAmountMax must be >= floatingAmountMin" })
    .refine((value) => value.amountMax === 0 || value.amountMax >= value.amountMin, { message: "amountMax must be >= amountMin" }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_CHANNEL_RISK_POLICY", details: parsed.error.flatten() });
  try {
    const data = updateChannelRiskPolicy(channelId, parsed.data);
    if (!data) return res.status(404).json({ error: "CHANNEL_NOT_FOUND" });
    createAuditLog({ action: "CHANNEL_RISK_POLICY_UPDATE", targetType: "channel", targetId: channelId, detail: parsed.data });
    return res.json({ data });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "CHANNEL_RISK_POLICY_UPDATE_FAILED" }); }
});
app.get("/api/v1/admin/channels/:id/preflight", (req, res) => {
  const channelId = String(req.params.id);
  const result = getChannelPreflight(channelId);
  if (!result) return res.status(404).json({ error: "CHANNEL_NOT_FOUND" });
  const channel = getChannel(channelId);
  const jsapiChecks = listChannelMerchants(channelId).map((merchant) => {
    const capability = getMerchantPaymentMethod(String(merchant.id), "JSAPI");
    const appId = String(capability?.appId || "");
    const appConfig = appId ? getWechatApp(appId) : undefined;
    const appSecretReady = Boolean(appId && appSecretConfigured(appId));
    const oauthDomainReady = Boolean(String(appConfig?.oauthDomain || "").trim());
    const jsapiPathReady = Boolean(String(appConfig?.jsapiPath || "").trim());
    return {
      merchantId: merchant.id,
      mchid: merchant.mchid,
      enabled: Boolean(capability && capability.status === "ACTIVE" && capability.appStatus === "ACTIVE"),
      appId,
      appid: capability?.appid || null,
      appSecretConfigured: appSecretReady,
      oauthDomainConfigured: oauthDomainReady,
      jsapiPathConfigured: jsapiPathReady,
      ready: Boolean(capability && capability.status === "ACTIVE" && capability.appStatus === "ACTIVE" && appSecretReady && oauthDomainReady && jsapiPathReady)
    };
  });
  if (!config.mockPayment && channel) {
    const credentialChecks = listChannelMerchants(channel.id)
      .filter((merchant) => merchant.status === "ACTIVE" && merchant.bindingStatus === "ACTIVE")
      .map((merchant) => ({ mchid: String(merchant.mchid), ready: credentialConfigured(String(merchant.credentialRef)) }));
    result.credentialsReady = credentialChecks.some((item) => item.ready);
    result.credentialChecks = credentialChecks;
    if (!result.credentialsReady) result.ready = false;
  } else result.credentialsReady = true;
  return res.json({ data: { ...result, jsapiChecks, jsapiReady: jsapiChecks.some((item) => item.ready) } });
});
app.get("/api/v1/admin/channels/:id/detail", (req, res) => {
  const channelId = String(req.params.id);
  const channel = getChannel(channelId);
  if (!channel) return res.status(404).json({ error: "CHANNEL_NOT_FOUND" });
  const health = listChannelHealth().find((item) => item.channelId === channelId) ?? null;
  const monitoring = getMonitoring().find((item) => item.channelId === channelId) ?? null;
  const preflight = getChannelPreflight(channelId);
  return res.json({ data: { channel, health, monitoring, stats: getChannelStats(channelId), boundMerchants: listChannelMerchants(channelId), preflight, platformMerchants: listChannelPlatformMerchants(channelId), routes: listRouteRules().filter((rule) => Array.isArray(rule.channelIds) && rule.channelIds.includes(channelId)) } });
});
app.put("/api/v1/admin/channels/:id/platform-merchants", (req, res) => {
  const parsed = z.object({ platformMerchantIds: z.array(entityId).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_CHANNEL_PLATFORM_MERCHANTS", details: parsed.error.flatten() });
  try { const data = setChannelPlatformMerchants(String(req.params.id), parsed.data.platformMerchantIds); createAuditLog({ action: "CHANNEL_PLATFORM_MERCHANTS", targetType: "channel", targetId: String(req.params.id), detail: { platformMerchantIds: parsed.data.platformMerchantIds } }); return res.json({ data }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "CHANNEL_PLATFORM_MERCHANTS_UPDATE_FAILED" }); }
});
app.get("/api/v1/admin/channels/:id/platform-merchants/policies", (req, res) => {
  if (!getChannel(String(req.params.id))) return res.status(404).json({ error: "CHANNEL_NOT_FOUND" });
  return res.json({ data: listChannelPlatformMerchantPolicies(String(req.params.id)) });
});
app.put("/api/v1/admin/channels/:id/platform-merchants/policies", (req, res) => {
  const parsed = z.object({ policies: z.array(z.object({ platformMerchantId: entityId, status: z.enum(["ACTIVE", "DISABLED"]).optional(), routeWeight: z.number().int().min(1).max(10000).optional(), maxConcurrency: z.number().int().nonnegative().optional(), dailyAmountLimit: z.number().int().nonnegative().optional(), dailyOrderLimit: z.number().int().nonnegative().optional() })).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_CHANNEL_PLATFORM_MERCHANT_POLICIES", details: parsed.error.flatten() });
  try { const data = setChannelPlatformMerchantPolicies(String(req.params.id), parsed.data.policies); createAuditLog({ action: "CHANNEL_PLATFORM_MERCHANT_POLICIES", targetType: "channel", targetId: String(req.params.id), detail: { count: parsed.data.policies.length } }); return res.json({ data }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "CHANNEL_PLATFORM_MERCHANT_POLICIES_FAILED" }); }
});
app.post("/api/v1/admin/routing/preview", (req, res) => {
  const parsed = z.object({ amount: z.number().int().positive().max(10_000_000), channelId: z.string().optional(), paymentMethod: z.enum(["NATIVE", "JSAPI"]).default("NATIVE"), clientMerchantId: entityId.optional(), platformMerchantId: entityId.optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_ROUTING_PREVIEW", details: parsed.error.flatten() });
  try {
    const channel = chooseRoutedPaymentTarget(parsed.data.amount, parsed.data.channelId ? [parsed.data.channelId] : undefined, parsed.data.clientMerchantId, parsed.data.platformMerchantId, undefined, parsed.data.paymentMethod);
    if (!channel) return res.status(409).json({ error: "CHANNEL_NOT_AVAILABLE" });
    const matchedRules = listRouteRules().filter((rule) => rule.status === "ACTIVE" && parsed.data.amount >= Number(rule.amountMin ?? 0) && parsed.data.amount <= Number(rule.amountMax ?? Number.MAX_SAFE_INTEGER));
    const candidateIds = parsed.data.channelId ? [parsed.data.channelId] : matchedRules.flatMap((rule) => Array.isArray(rule.channelIds) ? rule.channelIds as string[] : []);
    const candidates = listChannels().filter((item) => (!candidateIds.length || candidateIds.includes(item.id)) && item.status === "ACTIVE").map((item) => ({ id: item.id, subjectName: item.subjectName, routeWeight: item.routeWeight, ready: Boolean(getChannelPreflight(item.id)?.ready) }));
    return res.json({ data: { amount: parsed.data.amount, paymentMethod: parsed.data.paymentMethod, clientMerchantId: parsed.data.clientMerchantId, platformMerchantId: parsed.data.platformMerchantId, selectedChannelId: channel.id, selectedPlatformMerchantId: channel.platformMerchantId, selectedWechatMerchantId: channel.merchantInternalId, routeRuleId: channel.routeRuleId, routeSnapshot: channel.routeSnapshot, subjectName: channel.subjectName, appId: channel.appId, mchId: channel.mchId, routeWeight: channel.routeWeight, matchedRules: matchedRules.map((rule) => ({ id: rule.id, name: rule.name, priority: rule.priority })), candidates, preflight: getChannelPreflight(channel.id) } });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "ROUTING_PREVIEW_FAILED" }); }
});
app.get("/api/v1/admin/subjects", (_req, res) => res.json({ data: listSubjects() }));
app.get("/api/v1/admin/apps", (_req, res) => res.json({ data: listApps().map((item) => ({ ...item, appSecretConfigured: appSecretConfigured(String(item.id)) })) }));
app.get("/api/v1/admin/merchants", (_req, res) => res.json({ data: listMerchants() }));
app.get("/api/v1/admin/public-payment-entries", (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const scope = adminScopeFilter(req);
  const data = listPublicPaymentEntries({ status, limit: Number(req.query.limit ?? 100) }).filter((item) => (!scope.merchantIds || scope.merchantIds.includes(String(item.merchantId))) && (!scope.channelIds || scope.channelIds.includes(String(item.channelId))));
  return res.json({ data });
});
app.get("/api/v1/admin/orders", (req, res) => {
  const result = searchOrders({ ...adminScopeFilter(req), page: Number(req.query.page ?? 1), pageSize: Number(req.query.pageSize ?? req.query.limit ?? 50), status: typeof req.query.status === "string" ? req.query.status : undefined, query: typeof req.query.q === "string" ? req.query.q : undefined, channelId: typeof req.query.channelId === "string" ? req.query.channelId : undefined, merchantId: typeof req.query.merchantId === "string" ? req.query.merchantId : undefined, dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined, dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined, amountMin: req.query.amountMin == null ? undefined : Number(req.query.amountMin), amountMax: req.query.amountMax == null ? undefined : Number(req.query.amountMax) });
  return res.json({ data: result.items, meta: { total: result.total, page: result.page, pageSize: result.pageSize, totalPages: Math.ceil(result.total / result.pageSize) }, metrics: result.metrics });
});
app.get("/api/v1/admin/member-blocks", (req, res) => {
  const user = (req as Request & { adminUser?: { role?: string; dataScope?: string } }).adminUser;
  const data = listMemberBlocks({ query: typeof req.query.q === "string" ? req.query.q : undefined, status: typeof req.query.status === "string" ? req.query.status : undefined, limit: Number(req.query.limit ?? 200) })
    .filter((item) => {
      const scopeType = String(item.scopeType || "GLOBAL"); const scopeId = String(item.scopeId || "");
      if (scopeType === "GLOBAL") return user?.role === "SUPER_ADMIN" || user?.dataScope === "ALL";
      if (scopeType === "CHANNEL") return adminCan(req, "channel", scopeId);
      return adminCan(req, "platform_merchant", scopeId) || adminCan(req, "client_merchant", scopeId);
    });
  return res.json({ data });
});
app.get("/api/v1/admin/member-blocks/:id", (req, res) => {
  const item = getMemberBlock(String(req.params.id));
  if (!item) return res.status(404).json({ error: "MEMBER_BLOCK_NOT_FOUND" });
  const scopeType = String(item.scopeType || "GLOBAL"); const scopeId = String(item.scopeId || "");
  if ((scopeType === "GLOBAL" && !adminCan(req, "platform_merchant", scopeId)) || (scopeType === "CHANNEL" && !adminCan(req, "channel", scopeId)) || (scopeType === "PLATFORM_MERCHANT" && !adminCan(req, "platform_merchant", scopeId) && !adminCan(req, "client_merchant", scopeId))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  return res.json({ data: item });
});
app.post("/api/v1/admin/orders/:id/member-block", (req, res) => {
  const parsed = z.object({
    keyTypes: z.array(z.enum(["MEMBER_ID", "OPENID_HASH", "IP", "DEVICE_ID"])).min(1).max(4),
    scopeType: z.enum(["GLOBAL", "PLATFORM_MERCHANT", "CHANNEL"]).default("PLATFORM_MERCHANT"),
    scopeId: z.string().max(128).optional(),
    durationHours: z.number().int().min(0).max(8_760).default(0),
    reason: z.string().min(2).max(200),
    operationPassword: z.string().min(1).max(128)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MEMBER_BLOCK", details: parsed.error.flatten() });
  if (!operationPasswordValid(req, parsed.data.operationPassword)) return res.status(401).json({ error: "OPERATION_PASSWORD_INVALID" });
  const order = getOrder(String(req.params.id));
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  if (!adminCan(req, "channel", String(order.channelId)) && !adminCan(req, "platform_merchant", String(order.merchantId)) && !adminCan(req, "client_merchant", String(order.merchantId))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const scopeId = parsed.data.scopeType === "GLOBAL" ? null : parsed.data.scopeId || (parsed.data.scopeType === "CHANNEL" ? String(order.channelId) : String(order.merchantId));
  if (parsed.data.scopeType === "GLOBAL" && String((req as Request & { adminUser?: { role?: string } }).adminUser?.role || "") !== "SUPER_ADMIN") return res.status(403).json({ error: "GLOBAL_MEMBER_BLOCK_REQUIRES_SUPER_ADMIN" });
  if (parsed.data.scopeType === "CHANNEL" && !adminCan(req, "channel", String(scopeId))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  if (parsed.data.scopeType === "PLATFORM_MERCHANT" && !adminCan(req, "platform_merchant", String(scopeId)) && !adminCan(req, "client_merchant", String(scopeId))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const values: Record<string, string | null | undefined> = { MEMBER_ID: order.userId, OPENID_HASH: order.paymentOpenidHash, IP: order.deviceIp, DEVICE_ID: order.deviceNo };
  const keys = parsed.data.keyTypes.map((keyType) => ({ keyType, value: String(values[keyType] || "").trim() })).filter((item) => item.value);
  if (!keys.length || keys.length !== parsed.data.keyTypes.length) return res.status(409).json({ error: "MEMBER_BLOCK_KEY_UNAVAILABLE" });
  const existing = findActiveMemberBlock({ platformMerchantId: parsed.data.scopeType === "PLATFORM_MERCHANT" ? String(scopeId) : String(order.merchantId), channelId: parsed.data.scopeType === "CHANNEL" ? String(scopeId) : String(order.channelId), keys });
  if (existing && ((parsed.data.scopeType === "GLOBAL" && String(existing.block.scopeType) === "GLOBAL") || String(existing.block.scopeId || "") === String(scopeId || ""))) return res.status(409).json({ error: "MEMBER_ALREADY_BLOCKED", blockId: existing.block.id });
  const operator = (req as Request & { adminUser?: { username?: string } }).adminUser?.username ?? "local-admin";
  const expiresAt = parsed.data.durationHours > 0 ? new Date(Date.now() + parsed.data.durationHours * 3_600_000).toISOString() : null;
  try {
    const block = createMemberBlock({ scopeType: parsed.data.scopeType, scopeId, sourceOrderId: order.id, reason: parsed.data.reason, expiresAt, createdBy: operator, keys });
    createAuditLog({ action: "MEMBER_BLOCK_CREATE", operator, targetType: "member_block", targetId: String(block.id), detail: { orderId: order.id, platformOrderNo: order.platformOrderNo, scopeType: parsed.data.scopeType, scopeId, keyTypes: keys.map((item) => item.keyType), expiresAt, reason: parsed.data.reason } });
    return res.status(201).json({ data: block });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MEMBER_BLOCK_CREATE_FAILED" }); }
});
app.post("/api/v1/admin/member-blocks/:id/revoke", (req, res) => {
  const parsed = z.object({ reason: z.string().max(200).optional(), operationPassword: z.string().min(1).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MEMBER_BLOCK_REVOKE" });
  if (!operationPasswordValid(req, parsed.data.operationPassword)) return res.status(401).json({ error: "OPERATION_PASSWORD_INVALID" });
  const current = getMemberBlock(String(req.params.id));
  if (!current) return res.status(404).json({ error: "MEMBER_BLOCK_NOT_FOUND" });
  const scopeType = String(current.scopeType || "GLOBAL"); const scopeId = String(current.scopeId || "");
  if ((scopeType === "GLOBAL" && String((req as Request & { adminUser?: { role?: string } }).adminUser?.role || "") !== "SUPER_ADMIN") || (scopeType === "CHANNEL" && !adminCan(req, "channel", scopeId)) || (scopeType === "PLATFORM_MERCHANT" && !adminCan(req, "platform_merchant", scopeId) && !adminCan(req, "client_merchant", scopeId))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const operator = (req as Request & { adminUser?: { username?: string } }).adminUser?.username ?? "local-admin";
  const block = revokeMemberBlock(String(req.params.id), operator, parsed.data.reason || "后台解封");
  createAuditLog({ action: "MEMBER_BLOCK_REVOKE", operator, targetType: "member_block", targetId: String(req.params.id), detail: { reason: parsed.data.reason || "后台解封" } });
  return res.json({ data: block });
});
app.get("/api/v1/admin/orders/:id/detail", (req, res) => {
  const detail = getOrderDetail(String(req.params.id));
  if (!detail) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  const scope = adminScopeFilter(req); if ((scope.clientMerchantIds && !scope.clientMerchantIds.includes(String(detail.clientMerchantId || ''))) || (scope.merchantIds && !scope.merchantIds.includes(String(detail.merchantId || ''))) || (scope.channelIds && !scope.channelIds.includes(String(detail.channelId || '')))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  return res.json({ data: detail });
});
app.get("/api/v1/admin/orders/:id/exception-actions", (req, res) => {
  const order = getOrder(String(req.params.id));
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  return res.json({ data: listOrderExceptionActions(order.id) });
});
app.post("/api/v1/admin/orders/:id/callback", (req, res) => {
  const security = z.object({ operationPassword: z.string().min(1).max(128) }).safeParse(req.body);
  if (!security.success || !operationPasswordValid(req, security.data.operationPassword)) return res.status(401).json({ error: "OPERATION_PASSWORD_INVALID" });
  const order = getOrder(String(req.params.id));
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  const scope = adminScopeFilter(req);
  if ((scope.clientMerchantIds && !scope.clientMerchantIds.includes(String(order.clientMerchantId || ''))) || (scope.merchantIds && !scope.merchantIds.includes(String(order.merchantId || ''))) || (scope.channelIds && !scope.channelIds.includes(String(order.channelId || '')))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const webhook = getMerchantWebhook(String(order.merchantId));
  if (!webhook || !webhook.enabled) return res.status(409).json({ error: "MERCHANT_WEBHOOK_NOT_CONFIGURED" });
  const operator = (req as Request & { adminUser?: { username?: string } }).adminUser?.username ?? "local-admin";
  const eventId = `manual-${order.id}-${Date.now()}`;
  try {
    enqueueMerchantWebhook(String(order.merchantId), "ORDER_STATUS", eventId, { ...order, manual: true, triggeredAt: new Date().toISOString() });
    const action = recordOrderExceptionAction({ orderId: order.id, action: "RETRY_CALLBACK", operator, result: "QUEUED", note: "后台手动触发订单回调" });
    createAuditLog({ action: "ORDER_CALLBACK_RETRY", operator, targetType: "order", targetId: order.platformOrderNo, detail: { eventId, merchantId: order.merchantId } });
    return res.status(202).json({ data: getOrder(order.id), action, eventId });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "ORDER_CALLBACK_FAILED" }); }
});
app.post("/api/v1/admin/orders/:id/supplement", (req, res) => {
  const parsed = z.object({ operationPassword: z.string().min(1).max(128), transactionId: z.string().max(128).optional(), note: z.string().max(200).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_ORDER_SUPPLEMENT", details: parsed.error.flatten() });
  if (!operationPasswordValid(req, parsed.data.operationPassword)) return res.status(401).json({ error: "OPERATION_PASSWORD_INVALID" });
  const order = getOrder(String(req.params.id));
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  const scope = adminScopeFilter(req);
  if ((scope.clientMerchantIds && !scope.clientMerchantIds.includes(String(order.clientMerchantId || ''))) || (scope.merchantIds && !scope.merchantIds.includes(String(order.merchantId || ''))) || (scope.channelIds && !scope.channelIds.includes(String(order.channelId || '')))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  if (order.status === "SUCCESS") return res.status(409).json({ error: "ORDER_ALREADY_SUCCESS" });
  const transactionId = parsed.data.transactionId?.trim() || String(order.transactionId || `manual_${Date.now()}`);
  const operator = (req as Request & { adminUser?: { username?: string } }).adminUser?.username ?? "local-admin";
  try {
    updateOrderPayment(order.id, { status: "SUCCESS", transactionId });
    insertPaymentAttempt(order.id, String(order.channelId), "MANUAL_SUPPLEMENT", transactionId);
    const action = recordOrderExceptionAction({ orderId: order.id, action: "MANUAL_SUPPLEMENT", operator, result: "SUCCESS", note: parsed.data.note ?? "后台人工补单" });
    createAuditLog({ action: "ORDER_MANUAL_SUPPLEMENT", operator, targetType: "order", targetId: order.platformOrderNo, detail: { transactionId, note: parsed.data.note } });
    return res.json({ data: getOrder(order.id), action });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "ORDER_SUPPLEMENT_FAILED" }); }
});
app.post("/api/v1/admin/orders/:id/exception-action", async (req, res) => {
  const parsed = z.object({ action: z.enum(["QUERY", "CLOSE", "MARK_UNKNOWN"]), note: z.string().max(200).optional(), operationPassword: z.string().max(128).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_EXCEPTION_ACTION", details: parsed.error.flatten() });
  if (parsed.data.action !== "QUERY" && !parsed.data.operationPassword) return res.status(401).json({ error: "OPERATION_PASSWORD_REQUIRED" });
  if (parsed.data.action !== "QUERY" && !operationPasswordValid(req, parsed.data.operationPassword || "")) return res.status(401).json({ error: "OPERATION_PASSWORD_INVALID" });
  const order = getOrder(String(req.params.id));
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  const operator = (req as Request & { adminUser?: { username?: string } }).adminUser?.username ?? "local-admin";
  try {
    if (parsed.data.action === "MARK_UNKNOWN") {
      if (["SUCCESS", "CLOSED"].includes(order.status)) return res.status(409).json({ error: "ORDER_TERMINAL" });
      updateOrderPayment(order.id, { status: "UNKNOWN" });
      const action = recordOrderExceptionAction({ orderId: order.id, action: "MARK_UNKNOWN", operator, result: "SUCCESS", note: parsed.data.note ?? "人工标记为状态未知" });
      createAuditLog({ action: "ORDER_EXCEPTION_MARK_UNKNOWN", operator, targetType: "order", targetId: order.platformOrderNo, detail: { note: parsed.data.note } });
      return res.json({ data: getOrder(order.id), action });
    }
    const channel = resolveChannelMerchant(order.channelId, order.wechatMerchantId);
    if (!channel) return res.status(409).json({ error: "CHANNEL_NOT_FOUND" });
    const provider = config.mockPayment ? new MockPaymentProvider() : new WechatNativeProvider();
    if (parsed.data.action === "CLOSE") {
      if (["SUCCESS", "CLOSED"].includes(order.status)) return res.status(409).json({ error: "ORDER_TERMINAL" });
      if (!config.mockPayment) await provider.closeOrder({ mchId: channel.mchId, appId: String(channel.appId), outTradeNo: order.channelOutTradeNo, credentialRef: channel.credentialRef });
      closeOrder(order.id);
      const action = recordOrderExceptionAction({ orderId: order.id, action: "CLOSE", operator, result: "SUCCESS", note: parsed.data.note ?? "人工关单" });
      createAuditLog({ action: "ORDER_EXCEPTION_CLOSE", operator, targetType: "order", targetId: order.platformOrderNo, detail: { channelId: channel.id, note: parsed.data.note } });
      return res.json({ data: getOrder(order.id), action });
    }
    const result = await provider.queryOrder({ mchId: channel.mchId, appId: String(channel.appId), outTradeNo: order.channelOutTradeNo, credentialRef: channel.credentialRef });
    insertPaymentAttempt(order.id, channel.id, "EXCEPTION_QUERY", result.tradeState);
    if (result.tradeState === "SUCCESS") updateOrderPayment(order.id, { status: "SUCCESS", transactionId: result.transactionId });
    else if (result.tradeState === "CLOSED") updateOrderPayment(order.id, { status: "CLOSED" });
    const action = recordOrderExceptionAction({ orderId: order.id, action: "QUERY", operator, result: result.tradeState, note: parsed.data.note ?? "人工查单" });
    recordChannelHealth(channel.id, { success: true, failureThreshold: config.channelFailureThreshold });
    createAuditLog({ action: "ORDER_EXCEPTION_QUERY", operator, targetType: "order", targetId: order.platformOrderNo, detail: { channelId: channel.id, tradeState: result.tradeState } });
    return res.json({ data: getOrder(order.id), action, tradeState: result.tradeState });
  } catch (error) {
    const message = error instanceof Error ? error.message : "EXCEPTION_ACTION_FAILED";
    monitorMerchantFromProviderError(resolveChannelMerchant(order.channelId, order.wechatMerchantId), message);
    try { recordOrderExceptionAction({ orderId: order.id, action: parsed.data.action, operator, result: "FAILED", note: message }); } catch { /* preserve original failure */ }
    createAuditLog({ action: "ORDER_EXCEPTION_ACTION_FAILED", operator, targetType: "order", targetId: order.platformOrderNo, detail: { action: parsed.data.action, message } });
    return res.status(409).json({ error: message });
  }
});
app.get("/api/v1/admin/orders/:id/route", (req, res) => {
  const order = getOrder(String(req.params.id));
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  return res.json({ data: getRouteAllocation(order.id) ?? { orderId: order.id, routeRuleId: order.routeRuleId, routeSnapshot: order.routeSnapshot, status: "NOT_RESERVED" } });
});
app.get("/api/v1/admin/exceptions", (req, res) => {
  const result = searchOrders({ ...adminScopeFilter(req), page: Number(req.query.page ?? 1), pageSize: Number(req.query.pageSize ?? 50), status: typeof req.query.status === "string" ? req.query.status : undefined, query: typeof req.query.q === "string" ? req.query.q : undefined, channelId: typeof req.query.channelId === "string" ? req.query.channelId : undefined, merchantId: typeof req.query.merchantId === "string" ? req.query.merchantId : undefined, dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined, dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined, exceptionOnly: true });
  return res.json({ data: result.items, meta: { total: result.total, page: result.page, pageSize: result.pageSize, totalPages: Math.ceil(result.total / result.pageSize) }, metrics: getExceptionMetrics() });
});
app.get("/api/v1/admin/orders/export", (req, res) => {
  const result = searchOrders({ ...adminScopeFilter(req), page: 1, pageSize: 200, status: typeof req.query.status === "string" ? req.query.status : undefined, query: typeof req.query.q === "string" ? req.query.q : undefined, channelId: typeof req.query.channelId === "string" ? req.query.channelId : undefined, merchantId: typeof req.query.merchantId === "string" ? req.query.merchantId : undefined, dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined, dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined, exceptionOnly: req.query.exceptionOnly === "1" });
  const csv = ["平台订单号,码商订单号,客户请求号,金额(分),码商,主体,通道,状态,设备类型,设备IP,设备地区,设备号,微信交易号,创建时间,支付时间", ...result.items.map((row) => [row.platformOrderNo, row.channelOutTradeNo, row.clientRequestNo, row.amount, row.merchantName, row.subjectName, row.channelId, row.status, row.deviceType, row.deviceIp, [row.deviceCountry, row.deviceProvince, row.deviceCity].filter(Boolean).join(" "), row.deviceNo, row.transactionId, row.createdAt, row.paidAt].map(csvCell).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", "attachment; filename=orders.csv"); return res.send(`\uFEFF${csv}`);
});
app.get("/api/v1/admin/refunds", (req, res) => {
  const scope = adminScopeFilter(req);
  const data = listRefunds(Number(req.query.limit ?? 100), typeof req.query.approvalStatus === "string" ? req.query.approvalStatus : undefined).filter((item) =>
    (!scope.clientMerchantIds || scope.clientMerchantIds.includes(String(item.clientMerchantId ?? ""))) &&
    (!scope.merchantIds || scope.merchantIds.includes(String(item.merchantId ?? ""))) &&
    (!scope.channelIds || scope.channelIds.includes(String(item.channelId ?? ""))));
  return res.json({ data });
});
app.get("/api/v1/admin/callbacks", (req, res) => res.json({ data: listWebhookEvents(Number(req.query.limit ?? 100)) }));
app.get("/api/v1/admin/callback-tasks", (req, res) => res.json({ data: listCallbackTasks(Number(req.query.limit ?? 100)) }));
app.get("/api/v1/admin/merchant-webhook-deliveries", (req, res) => res.json({ data: listAllMerchantWebhookDeliveries(Number(req.query.limit ?? 200), typeof req.query.status === "string" ? req.query.status : undefined) }));
app.post("/api/v1/admin/merchant-webhook-deliveries/:id/retry", (req, res) => {
  const delivery = requeueMerchantWebhookDelivery(String(req.params.id));
  if (!delivery) return res.status(404).json({ error: "WEBHOOK_DELIVERY_NOT_FOUND" });
  createAuditLog({ action: "MERCHANT_WEBHOOK_REQUEUE", targetType: "merchant_webhook_delivery", targetId: String(req.params.id), detail: {} });
  return res.json({ data: delivery });
});
app.get("/api/v1/admin/routing-rules", (_req, res) => res.json({ data: listRouteRules() }));
app.get("/api/v1/admin/routing-rules/:id/versions", (req, res) => {
  if (!listRouteRules().some((item) => String(item.id) === String(req.params.id))) return res.status(404).json({ error: "ROUTE_RULE_NOT_FOUND" });
  return res.json({ data: listRouteRuleVersions(String(req.params.id), Number(req.query.limit ?? 50)) });
});
app.post("/api/v1/admin/routing-rules/:id/versions/:version/rollback", (req, res) => {
  try { return res.json({ data: restoreRouteRuleVersion(String(req.params.id), Number(req.params.version), (req as Request & { adminUser?: { username?: string } }).adminUser?.username ?? "local-admin") }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "ROUTE_RULE_ROLLBACK_FAILED" }); }
});
app.get("/api/v1/admin/monitoring", (_req, res) => res.json({ data: getMonitoring() }));
app.get("/api/v1/admin/public-payment-monitoring", (req, res) => {
  const hours = Number(req.query.hours ?? 24);
  return res.json({ data: getPublicPaymentMonitoring(Number.isFinite(hours) ? hours : 24) });
});
app.get("/api/v1/admin/data-consistency", (_req, res) => res.json({ data: getDataConsistencyReport() }));
app.get("/api/v1/admin/channel-health", (_req, res) => res.json({ data: listChannelHealth() }));
app.post("/api/v1/admin/channel-health/:id/reset", (req, res) => {
  const channelId = String(req.params.id);
  if (!getChannel(channelId)) return res.status(404).json({ error: "CHANNEL_NOT_FOUND" });
  resetChannelCircuit(channelId); createAuditLog({ action: "CHANNEL_CIRCUIT_RESET", targetType: "channel", targetId: channelId });
  return res.json({ data: listChannelHealth().find((item) => item.channelId === channelId) });
});
app.post("/api/v1/admin/payment-recovery/run", async (_req, res) => {
  try { return res.json({ data: await runPaymentRecoveryPass() }); }
  catch (error) { return res.status(500).json({ error: error instanceof Error ? error.message : "PAYMENT_RECOVERY_FAILED" }); }
});
app.post("/api/v1/admin/refund-recovery/run", async (_req, res) => {
  try { return res.json({ data: await runRefundRecoveryPass() }); }
  catch (error) { return res.status(500).json({ error: error instanceof Error ? error.message : "REFUND_RECOVERY_FAILED" }); }
});
app.post("/api/v1/admin/callback-retry/run", async (_req, res) => {
  try { return res.json({ data: await runCallbackRetryPass() }); }
  catch (error) { return res.status(500).json({ error: error instanceof Error ? error.message : "CALLBACK_RETRY_FAILED" }); }
});
app.get("/api/v1/admin/settlement/report", (req, res) => {
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : "";
  const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) return res.status(400).json({ error: "INVALID_SETTLEMENT_RANGE" });
  const start = new Date(`${dateFrom}T00:00:00+08:00`); const end = new Date(`${dateTo}T00:00:00+08:00`);
  if (end <= start) return res.status(400).json({ error: "INVALID_SETTLEMENT_RANGE" });
  return res.json({ data: getSettlementReport({ dateFrom: start.toISOString(), dateTo: end.toISOString(), channelId: typeof req.query.channelId === "string" ? req.query.channelId : undefined }) });
});
app.get("/api/v1/admin/settlements", (req, res) => res.json({ data: listSettlementStatements(typeof req.query.merchantId === "string" ? req.query.merchantId : undefined, Number(req.query.limit ?? 100)) }));
app.post("/api/v1/admin/settlements/auto-generate", async (_req, res) => {
  try { await runPreviousDaySettlements(); return res.json({ data: listSettlementStatements(undefined, 100) }); }
  catch (error) { return res.status(500).json({ error: error instanceof Error ? error.message : "SETTLEMENT_AUTO_GENERATE_FAILED" }); }
});
function csvCell(value: unknown): string { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
app.get("/api/v1/admin/settlements/export", (req, res) => {
  const rows = listSettlementStatements(typeof req.query.merchantId === "string" ? req.query.merchantId : undefined, 500);
  const csv = ["结算单,码商,开始日期,结束日期,交易额,退款,手续费,净结算,状态,创建时间", ...rows.map((row) => [row.id, row.merchantName, row.dateFrom, row.dateTo, row.grossAmount, row.refundAmount, row.feeAmount, row.netAmount, row.status, row.createdAt].map(csvCell).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", "attachment; filename=settlements.csv"); return res.send(`\uFEFF${csv}`);
});
app.post("/api/v1/admin/settlements", (req, res) => {
  const parsed = z.object({ merchantId: entityId, dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_SETTLEMENT_STATEMENT", details: parsed.error.flatten() });
  const start = new Date(`${parsed.data.dateFrom}T00:00:00+08:00`); const end = new Date(`${parsed.data.dateTo}T00:00:00+08:00`);
  if (end <= start) return res.status(400).json({ error: "INVALID_SETTLEMENT_RANGE" });
  try { const statement = createSettlementStatement({ merchantId: parsed.data.merchantId, dateFrom: start.toISOString(), dateTo: end.toISOString() }); createAuditLog({ action: "SETTLEMENT_STATEMENT_CREATE", targetType: "settlement", targetId: String(statement.id), detail: parsed.data }); return res.status(201).json({ data: statement }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "SETTLEMENT_CREATE_FAILED" }); }
});
app.get("/api/v1/admin/settlements/:id/difference", (req, res) => {
  const result = getSettlementDifference(String(req.params.id));
  if (!result) return res.status(404).json({ error: "SETTLEMENT_NOT_FOUND" });
  return res.json({ data: result });
});
app.patch("/api/v1/admin/settlements/:id/status", (req, res) => {
  const parsed = z.object({ status: z.enum(["DRAFT", "CONFIRMED", "PAID", "VOID"]), note: z.string().max(500).optional(), paymentProof: z.string().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_SETTLEMENT_STATUS" });
  try {
    const statement = updateSettlementStatementStatus(String(req.params.id), parsed.data.status, { note: parsed.data.note, paymentProof: parsed.data.paymentProof });
    if (!statement) return res.status(404).json({ error: "SETTLEMENT_NOT_FOUND" });
    createAuditLog({ action: "SETTLEMENT_STATUS", targetType: "settlement", targetId: String(req.params.id), detail: parsed.data });
    return res.json({ data: statement });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "SETTLEMENT_STATUS_FAILED" }); }
});
app.get("/api/v1/admin/audit", (req, res) => res.json({ data: listAuditLogs(Number(req.query.limit ?? 100), {
  action: typeof req.query.action === 'string' ? req.query.action : undefined,
  operator: typeof req.query.operator === 'string' ? req.query.operator : undefined,
  target: typeof req.query.target === 'string' ? req.query.target : undefined,
  dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
  dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined
}) }));
app.get("/api/v1/admin/users", (_req, res) => res.json({ data: listAdminUsers(), roles: ADMIN_ROLES }));
app.post("/api/v1/admin/users", (req, res) => {
  const parsed = z.object({ username: z.string().regex(/^[a-zA-Z0-9_.-]{2,64}$/), password: z.string().min(8).max(128), role: z.string(), dataScope: z.enum(["ALL", "ASSIGNED_CLIENT_MERCHANTS", "ASSIGNED_CODE_MERCHANTS", "ASSIGNED_CHANNELS"]).default("ALL"), dataScopeIds: z.array(z.string().min(1).max(64)).max(500).default([]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_ADMIN_USER", details: parsed.error.flatten() });
  try { const user = createAdminUser(parsed.data.username, parsed.data.password, parsed.data.role, parsed.data.dataScope, parsed.data.dataScopeIds); createAuditLog({ action: "ADMIN_USER_CREATE", targetType: "admin_user", targetId: user.id, detail: { username: user.username, role: user.role, dataScope: user.dataScope, dataScopeIds: user.dataScopeIds } }); return res.status(201).json({ data: user }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "ADMIN_USER_CREATE_FAILED" }); }
});
app.patch("/api/v1/admin/users/:id", (req, res) => {
  const parsed = z.object({ role: z.string().optional(), status: z.enum(["ACTIVE", "DISABLED"]).optional(), password: z.string().min(8).max(128).optional(), dataScope: z.enum(["ALL", "ASSIGNED_CLIENT_MERCHANTS", "ASSIGNED_CODE_MERCHANTS", "ASSIGNED_CHANNELS"]).optional(), dataScopeIds: z.array(z.string().min(1).max(64)).max(500).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_ADMIN_USER", details: parsed.error.flatten() });
  try { const user = updateAdminUser(String(req.params.id), parsed.data); if (!user) return res.status(404).json({ error: "ADMIN_USER_NOT_FOUND" }); createAuditLog({ action: "ADMIN_USER_UPDATE", targetType: "admin_user", targetId: user.id, detail: { role: user.role, status: user.status } }); return res.json({ data: user }); }
  catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "ADMIN_USER_UPDATE_FAILED" }); }
});
const entityId = z.string().regex(/^[a-zA-Z0-9_-]{2,64}$/);
app.post("/api/v1/admin/subjects", (req, res) => {
  const parsed = z.object({ id: entityId.optional(), name: z.string().min(2).max(120), subjectType: z.enum(["INDIVIDUAL_BUSINESS", "COMPANY", "OTHER"]).default("INDIVIDUAL_BUSINESS") }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_SUBJECT", details: parsed.error.flatten() });
  try { const subject = createSubject(parsed.data); createAuditLog({ action: "SUBJECT_CREATE", targetType: "subject", targetId: String(subject.id), detail: parsed.data }); return res.status(201).json({ data: subject }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "SUBJECT_CREATE_FAILED" }); }
});
app.post("/api/v1/admin/apps", (req, res) => {
  const parsed = z.object({ id: entityId.optional(), subjectId: entityId, appid: z.string().min(6).max(64), appType: z.enum(["SERVICE_ACCOUNT", "MINI_PROGRAM", "APP"]).default("SERVICE_ACCOUNT"), appSecret: z.string().min(8).max(256).optional().or(z.literal("")), oauthDomain: z.string().max(255).optional().default(""), jsapiPath: z.string().max(255).optional().default(""), verifyFile: z.string().max(128).optional().default(""), verifyToken: z.string().max(128).optional().default("") }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_APP", details: parsed.error.flatten() });
  if (parsed.data.appSecret && !config.dataEncryptionKey) return res.status(400).json({ error: "DATA_ENCRYPTION_KEY_REQUIRED_FOR_APP_SECRET" });
  try { const item = createApp(parsed.data); if (parsed.data.appSecret) upsertAppSecret(String(item.id), parsed.data.appSecret); createAuditLog({ action: "APP_CREATE", targetType: "app", targetId: String(item.id), detail: { subjectId: parsed.data.subjectId, appid: parsed.data.appid, appSecretConfigured: Boolean(parsed.data.appSecret) } }); return res.status(201).json({ data: { ...item, appSecretConfigured: appSecretConfigured(String(item.id)) } }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "APP_CREATE_FAILED" }); }
});
app.patch("/api/v1/admin/apps/:id", (req, res) => {
  const parsed = z.object({ appSecret: z.string().min(8).max(256).optional().or(z.literal("")), oauthDomain: z.string().max(255).optional(), jsapiPath: z.string().max(255).optional(), verifyFile: z.string().max(128).optional(), verifyToken: z.string().max(128).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_APP", details: parsed.error.flatten() });
  if (parsed.data.appSecret && !config.dataEncryptionKey) return res.status(400).json({ error: "DATA_ENCRYPTION_KEY_REQUIRED_FOR_APP_SECRET" });
  try {
    const current = listApps().find((item) => String(item.id) === String(req.params.id)); if (!current) return res.status(404).json({ error: "APP_NOT_FOUND" });
    const item = updateApp(String(req.params.id), { oauthDomain: parsed.data.oauthDomain ?? String(current.oauthDomain || ""), jsapiPath: parsed.data.jsapiPath ?? String(current.jsapiPath || ""), verifyFile: parsed.data.verifyFile ?? String(current.verifyFile || ""), verifyToken: parsed.data.verifyToken ?? String(current.verifyToken || "") });
    if (parsed.data.appSecret !== undefined) upsertAppSecret(String(req.params.id), parsed.data.appSecret || undefined);
    createAuditLog({ action: "APP_UPDATE", targetType: "app", targetId: String(req.params.id), detail: { appSecretConfigured: appSecretConfigured(String(req.params.id)), oauthDomain: item?.oauthDomain, jsapiPath: item?.jsapiPath } });
    return res.json({ data: { ...item, appSecretConfigured: appSecretConfigured(String(req.params.id)) } });
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "APP_UPDATE_FAILED" }); }
});
app.patch("/api/v1/admin/apps/:id/status", (req, res) => {
  const parsed = z.object({ status: z.enum(["ACTIVE", "DISABLED"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_APP_STATUS" });
  if (!listApps().some((item) => item.id === req.params.id)) return res.status(404).json({ error: "APP_NOT_FOUND" });
  setAppStatus(req.params.id, parsed.data.status); createAuditLog({ action: "APP_STATUS", targetType: "app", targetId: req.params.id, detail: parsed.data }); return res.json({ data: listApps().find((item) => item.id === req.params.id) });
});
app.post("/api/v1/admin/merchants", (req, res) => {
  const parsed = z.object({ id: entityId.optional(), subjectId: entityId.optional(), appId: entityId.optional(), nativeAppId: entityId.optional(), jsapiAppId: entityId.optional(), appIds: z.array(entityId).max(10).optional(), paymentMethods: z.array(z.enum(["NATIVE", "JSAPI"])).length(1).default(["NATIVE"]), mchid: z.string().min(6).max(64), apiV2Key: z.string().min(16).max(128), dailyAmountLimit: z.number().int().nonnegative().max(10_000_000_000).default(0) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT", details: parsed.error.flatten() });
  const selectedAppIds = [...new Set([...(parsed.data.appIds || []), parsed.data.appId, parsed.data.nativeAppId, parsed.data.jsapiAppId].filter((value): value is string => Boolean(value)))];
  if (!selectedAppIds.length) return res.status(400).json({ error: "APP_ID_REQUIRED" });
  const apps = selectedAppIds.map((id) => listApps().find((item) => String(item.id) === String(id)));
  if (apps.some((item) => !item)) return res.status(400).json({ error: "APP_NOT_FOUND" });
  const appSubjectIds = [...new Set(apps.map((item) => String(item?.subjectId || "")).filter(Boolean))];
  if (appSubjectIds.length !== 1 || (parsed.data.subjectId && String(parsed.data.subjectId) !== appSubjectIds[0])) return res.status(400).json({ error: "APP_SUBJECT_MISMATCH" });
  const subjectId = appSubjectIds[0];
  if (parsed.data.paymentMethods.includes("JSAPI")) {
    const jsapiApp = listApps().find((item) => String(item.id) === String(parsed.data.jsapiAppId || parsed.data.appId || parsed.data.appIds?.[0]));
    if (!jsapiApp || jsapiApp.appType !== "SERVICE_ACCOUNT") return res.status(400).json({ error: "JSAPI_SERVICE_ACCOUNT_REQUIRED" });
    if (!appSecretConfigured(String(jsapiApp.id))) return res.status(400).json({ error: "JSAPI_APP_SECRET_MISSING" });
    if (!String(jsapiApp.oauthDomain || "").trim() || !String(jsapiApp.jsapiPath || "").trim()) return res.status(400).json({ error: "JSAPI_DOMAIN_OR_PATH_MISSING" });
  }
  try { const item = createMerchant({ ...parsed.data, subjectId, credentialRef: saveApiV2Credential(parsed.data.mchid, parsed.data.apiV2Key) }); createAuditLog({ action: "MERCHANT_CREATE", targetType: "merchant", targetId: String(item.id), detail: { subjectId, appId: parsed.data.appId, nativeAppId: parsed.data.nativeAppId, jsapiAppId: parsed.data.jsapiAppId, paymentMethods: parsed.data.paymentMethods, mchid: parsed.data.mchid } }); return res.status(201).json({ data: item }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_CREATE_FAILED" }); }
});
app.patch("/api/v1/admin/merchants/:id/status", (req, res) => {
  const parsed = z.object({ status: z.enum(["ACTIVE", "DISABLED"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_STATUS" });
  if (!listMerchants().some((item) => item.id === req.params.id)) return res.status(404).json({ error: "MERCHANT_NOT_FOUND" });
  try {
    setMerchantStatus(req.params.id, parsed.data.status);
    createAuditLog({ action: "MERCHANT_STATUS", targetType: "merchant", targetId: req.params.id, detail: parsed.data });
    return res.json({ data: listMerchants().find((item) => item.id === req.params.id) });
  } catch (error) {
    if (error instanceof Error && error.message === "MERCHANT_MONITOR_LOCKED") return res.status(423).json({ error: "MERCHANT_MONITOR_LOCKED", message: "该商户号已被监控锁定，请由超级管理员强制开启" });
    return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_STATUS_UPDATE_FAILED" });
  }
});
app.post("/api/v1/admin/merchants/:id/force-enable", (req: Request & { adminUser?: { id?: string; username?: string; role?: string } }, res) => {
  if (req.adminUser?.role !== "SUPER_ADMIN") return res.status(403).json({ error: "ADMIN_FORCE_ENABLE_REQUIRED", message: "只有超级管理员可以强制开启监控锁定的商户号" });
  const merchantId = String(req.params.id);
  const current = listMerchants().find((item) => item.id === merchantId);
  if (!current) return res.status(404).json({ error: "MERCHANT_NOT_FOUND" });
  if (Number(current.monitorLocked || 0) !== 1) return res.status(409).json({ error: "MERCHANT_NOT_MONITOR_LOCKED", message: "该商户号当前没有监控锁定" });
  const item = forceEnableMerchantStatus(merchantId);
  createAuditLog({ action: "MERCHANT_FORCE_ENABLE", operator: req.adminUser?.username, targetType: "merchant", targetId: merchantId, detail: { previousStatus: current.status, previousMonitorLockReason: current.monitorLockReason, forcedByRole: req.adminUser?.role } });
  return res.json({ data: item });
});
app.patch("/api/v1/admin/merchants/:id/settings", (req, res) => {
  const parsed = z.object({ dailyAmountLimit: z.number().int().nonnegative().max(10_000_000_000).optional(), complaintCount: z.number().int().nonnegative().max(10_000_000).optional(), riskEnabled: z.number().int().min(0).max(1).optional(), orderWindowSeconds: z.number().int().nonnegative().max(86_400).optional(), orderWindowLimit: z.number().int().nonnegative().max(1_000_000).optional(), dailyOrderLimit: z.number().int().nonnegative().max(1_000_000).optional(), dailySuccessLimit: z.number().int().nonnegative().max(1_000_000).optional() }).refine((value) => Object.values(value).some((item) => item !== undefined), { message: "at least one setting is required" }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_SETTINGS", details: parsed.error.flatten() });
  try {
    const item = updateMerchantSettings(String(req.params.id), parsed.data);
    if (!item) return res.status(404).json({ error: "MERCHANT_NOT_FOUND" });
    createAuditLog({ action: "MERCHANT_SETTINGS_UPDATE", targetType: "merchant", targetId: String(req.params.id), detail: parsed.data });
    return res.json({ data: item });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_SETTINGS_UPDATE_FAILED" }); }
});
app.patch("/api/v1/admin/merchants/:id", (req, res) => {
  const parsed = z.object({ apiV2Key: z.string().min(16).max(128).optional(), dailyAmountLimit: z.number().int().nonnegative().max(10_000_000_000).optional() }).refine((value) => value.apiV2Key !== undefined || value.dailyAmountLimit !== undefined).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_UPDATE", details: parsed.error.flatten() });
  try {
    const current = listMerchants().find((entry) => String(entry.id) === String(req.params.id));
    const item = updateMerchant(String(req.params.id), { credentialRef: parsed.data.apiV2Key ? saveApiV2Credential(String(current?.mchid || ""), parsed.data.apiV2Key, String(current?.credentialRef || "")) : undefined, dailyAmountLimit: parsed.data.dailyAmountLimit });
    if (!item) return res.status(404).json({ error: "MERCHANT_NOT_FOUND" });
    createAuditLog({ action: "MERCHANT_UPDATE", targetType: "merchant", targetId: String(req.params.id), detail: parsed.data });
    return res.json({ data: item });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_UPDATE_FAILED" }); }
});
app.post("/api/v1/admin/merchants/:id/clone", (req, res) => {
  const parsed = z.object({ id: entityId.optional(), appId: entityId, mchid: z.string().min(6).max(64), apiV2Key: z.string().min(16).max(128), dailyAmountLimit: z.number().int().nonnegative().max(10_000_000_000).default(0) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_CLONE", details: parsed.error.flatten() });
  try {
    const item = cloneMerchant(String(req.params.id), { ...parsed.data, credentialRef: saveApiV2Credential(parsed.data.mchid, parsed.data.apiV2Key) });
    createAuditLog({ action: "MERCHANT_CLONE", targetType: "merchant", targetId: String(item.id), detail: { sourceMerchantId: String(req.params.id), appId: parsed.data.appId, mchid: parsed.data.mchid } });
    return res.status(201).json({ data: item });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_CLONE_FAILED" }); }
});
app.delete("/api/v1/admin/merchants/:id", (req, res) => {
  try {
    deleteMerchant(String(req.params.id));
    createAuditLog({ action: "MERCHANT_DELETE", targetType: "merchant", targetId: String(req.params.id), detail: {} });
    return res.json({ data: { deleted: true } });
  } catch (error) { return res.status(error instanceof Error && error.message === "MERCHANT_NOT_FOUND" ? 404 : 409).json({ error: error instanceof Error ? error.message : "MERCHANT_DELETE_FAILED" }); }
});
app.get("/api/v1/admin/merchants/:id/channels", (req, res) => {
  const merchant = listMerchants().find((item) => String(item.id) === String(req.params.id));
  if (!merchant) return res.status(404).json({ error: "MERCHANT_NOT_FOUND" });
  const boundChannelIds = new Set(listMerchantBoundChannelIds(String(req.params.id)));
  const scope = adminScopeFilter(req);
  const channels = listChannels().filter((channel) => !scope.channelIds || scope.channelIds.includes(String(channel.id))).map((channel) => ({ ...channel, bound: boundChannelIds.has(channel.id), sameSubject: channel.subjectId === merchant.subjectId }));
  return res.json({ data: channels });
});
app.put("/api/v1/admin/merchants/:id/channels", (req, res) => {
  const parsed = z.object({ channelIds: z.array(entityId).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_CHANNELS", details: parsed.error.flatten() });
  try {
    const channels = setMerchantChannelBindings(String(req.params.id), parsed.data.channelIds);
    createAuditLog({ action: "WECHAT_MERCHANT_CHANNELS", targetType: "wechat_merchant", targetId: String(req.params.id), detail: { channelIds: parsed.data.channelIds } });
    return res.json({ data: channels });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_CHANNELS_UPDATE_FAILED" }); }
});
app.get("/api/v1/admin/merchants/:id/stats", (req, res) => {
  const data = getWechatMerchantStats(String(req.params.id));
  if (!data) return res.status(404).json({ error: "MERCHANT_NOT_FOUND" });
  return res.json({ data });
});
app.post("/api/v1/admin/merchants/:id/payment-test", async (req, res) => {
  const parsed = z.object({ amount: z.number().int().positive().max(10_000_000), description: z.string().min(1).max(127).default("支付测试") }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_PAYMENT_TEST", details: parsed.error.flatten() });
  const merchantId = String(req.params.id);
  const merchant = listMerchants().find((item) => String(item.id) === merchantId);
  if (!merchant) return res.status(404).json({ error: "MERCHANT_NOT_FOUND" });
  if (String(merchant.status) !== "ACTIVE") return res.status(409).json({ error: "MERCHANT_NOT_ACTIVE", message: "商户号当前未启用" });
  const nativeMethod = getMerchantPaymentMethod(merchantId, "NATIVE");
  const jsapiMethod = getMerchantPaymentMethod(merchantId, "JSAPI");
  // A merchant created for one product follows that product's cashier. Legacy
  // records that have both methods keep Native as the safe default.
  const paymentMethod: "NATIVE" | "JSAPI" = !nativeMethod && jsapiMethod ? "JSAPI" : "NATIVE";
  const selectedMethod = paymentMethod === "JSAPI" ? jsapiMethod : nativeMethod;
  if (!selectedMethod || String(selectedMethod.status || "ACTIVE") !== "ACTIVE" || String(selectedMethod.appStatus || "ACTIVE") !== "ACTIVE") {
    return res.status(409).json({ error: paymentMethod === "JSAPI" ? "MERCHANT_JSAPI_NOT_ENABLED" : "MERCHANT_NATIVE_NOT_ENABLED", message: paymentMethod === "JSAPI" ? "该商户号未启用公众号支付" : "该商户号未启用 Native 扫码支付" });
  }
  const boundIds = listMerchantBoundChannelIds(merchantId);
  const channelId = boundIds.find((id) => {
    const candidate = getChannel(id);
    return candidate?.status === "ACTIVE" && String(candidate.paymentMethod || "NATIVE") === paymentMethod;
  });
  if (!channelId) return res.status(409).json({ error: "MERCHANT_TEST_CHANNEL_REQUIRED", message: "请先为该商户号绑定一个启用中的支付通道" });
  const channel = resolveChannelMerchant(channelId, merchantId);
  if (!channel || channel.status !== "ACTIVE" || channel.merchantStatus !== "ACTIVE") return res.status(409).json({ error: "MERCHANT_TEST_CHANNEL_UNAVAILABLE", message: "绑定的支付通道或微信商户号不可用" });
  const platformOrderNo = `T${Date.now()}${randomId("test").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)}`.slice(0, 32);
  const channelOutTradeNo = newTradeNo(channel.id);
  const clientRequestNo = `admin-test-${merchantId}-${Date.now()}-${randomId("r").slice(-6)}`.slice(0, 64);
  const expireAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const notifyUrl = `${publicBaseUrlForRequest(req)}${channel.notifyPath}/${encodeURIComponent(channel.mchId)}`;
  if (!config.mockPayment && !isProductionCallbackUrl(notifyUrl)) return res.status(503).json({ error: "PUBLIC_CALLBACK_URL_REQUIRED", message: "生产环境需要配置 HTTPS 公网回调地址" });
  if (paymentMethod === "JSAPI") {
    const jsapiAppId = String(jsapiMethod?.appId || "");
    const appConfig = getWechatApp(jsapiAppId);
    const appSecret = appSecretConfigured(jsapiAppId) ? getAppSecret(jsapiAppId) : (config.mockPayment ? "mock-app-secret" : "");
    if (!appConfig || !appSecret) return res.status(409).json({ error: "JSAPI_APP_SECRET_NOT_CONFIGURED", message: "公众号 AppID 或 AppSecret 尚未配置" });
    let order: ReturnType<typeof getOrder> | undefined;
    let routeReserved = false;
    try {
      insertOrder({ merchantId, platformOrderNo, channelId: channel.id, wechatMerchantId: channel.merchantInternalId, channelOutTradeNo, amount: parsed.data.amount, description: parsed.data.description, paymentMethod: "JSAPI", collectionMode: "NATIVE", paymentAppId: jsapiAppId, clientRequestNo, expireAt, deviceType: "UNKNOWN", deviceIp: String(req.ip || req.socket.remoteAddress || "127.0.0.1").replace(/^::ffff:/, "") });
      order = getOrder(platformOrderNo);
      if (!order) return res.status(500).json({ error: "ORDER_CREATE_FAILED" });
      reserveRouteCapacity(order.id, channel);
      routeReserved = true;
      const rawToken = crypto.randomBytes(32).toString("base64url");
      const pagePath = "/public-pay";
      const payUrl = `${publicBaseUrlForRequest(req)}/public-pay/${encodeURIComponent(rawToken)}`;
      if (!config.mockPayment && !payUrl.startsWith("https://")) throw new Error("PUBLIC_PAYMENT_URL_HTTPS_REQUIRED");
      const articleQrUrl = `${payUrl}?from_article=1`;
      let qrDataUrl = await QRCode.toDataURL(articleQrUrl, { width: 480, margin: 2 });
      const entry = createPublicPaymentEntry({ orderId: order.id, token: rawToken, tokenHash: crypto.createHash("sha256").update(rawToken, "utf8").digest("hex"), pagePath, qrDataUrl, expiresAt: expireAt });
      const articleStartedAt = Date.now();
      recordPublicPaymentEvent({ orderId: order.id, entryId: entry.id, eventType: "ARTICLE_STARTED" });
      const article = await createPublicAccountArticle({ appId: String(appConfig.appid), appSecret, title: `订单支付-${order.platformOrderNo}`, description: parsed.data.description, amountYuan: (Number(order.amount) / 100).toFixed(2), payUrl, qrDataUrl, mock: config.mockPayment });
      upsertWechatArticleDraft({ orderId: order.id, entryId: entry.id, appId: jsapiAppId, draftMediaId: article.draftMediaId, previewUrl: article.previewUrl, qrMediaUrl: article.qrMediaUrl, coverMediaId: article.coverMediaId, status: "READY", expiresAt: order.expireAt });
      recordPublicPaymentEvent({ orderId: order.id, entryId: entry.id, eventType: "ARTICLE_READY", durationMs: Date.now() - articleStartedAt });
      recordPublicPaymentEvent({ orderId: order.id, entryId: entry.id, eventType: article.previewUrl ? "PREVIEW_READY" : "PREVIEW_UNAVAILABLE" });
      if (!article.previewUrl) recordPublicPaymentEvent({ orderId: order.id, entryId: entry.id, eventType: "FALLBACK_JSAPI", errorCode: "PREVIEW_URL_UNAVAILABLE" });
      if (article.previewUrl) {
        // External QR/wake entry points DIRECTLY at the temp preview page
        // (mp.weixin.qq.com article), so scanning/打开 it opens the preview
        // article directly instead of a public-pay intermediate page.
        const previewLink = String(article.previewUrl).replace(/^http:\/\//i, "https://");
        const externalQrDataUrl = await QRCode.toDataURL(previewLink, { width: 480, margin: 2 });
        updatePublicPaymentEntry(entry.id, { qrDataUrl: externalQrDataUrl });
        qrDataUrl = externalQrDataUrl;
      }
      updateOrderPayment(order.id, { status: "QR_CREATED", qrDataUrl });
      insertPaymentAttempt(order.id, channel.id, "PUBLIC_ARTICLE_READY");
      createAuditLog({ action: "ADMIN_JSAPI_PAYMENT_TEST", targetType: "order", targetId: platformOrderNo, detail: { merchantId, channelId: channel.id, amount: parsed.data.amount, provider: config.mockPayment ? "mock" : "wechatpay" } });
      return res.status(201).json({ data: getOrder(order.id), provider: "PUBLIC_ACCOUNT_ARTICLE", paymentMethod, channel: { id: channel.id, mchId: channel.mchId, appId: String(appConfig.appid) }, entry: { payUrl, qrDataUrl, previewUrl: article.previewUrl, fallbackToJsapi: !article.previewUrl, draftMediaId: article.draftMediaId, expiresAt: order.expireAt } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PUBLIC_ARTICLE_CREATE_FAILED";
      if (order) {
        const entry = getPublicPaymentEntryByOrder(order.id);
        const rawToken = getPublicPaymentEntryToken(order.id);
        if (entry && rawToken) {
          upsertWechatArticleDraft({ orderId: order.id, entryId: entry.id, appId: jsapiAppId, status: "FAILED", wechatErrmsg: message, expiresAt: order.expireAt });
          try { updateOrderPayment(order.id, { status: "QR_CREATED", qrDataUrl: entry.qrDataUrl ?? undefined }); } catch { /* keep the order payable through JSAPI */ }
          insertPaymentAttempt(order.id, channel.id, "PUBLIC_ARTICLE_FAILED", message);
          recordPublicPaymentEvent({ orderId: order.id, entryId: entry.id, eventType: "ARTICLE_FAILED", errorCode: message });
          recordPublicPaymentEvent({ orderId: order.id, entryId: entry.id, eventType: "FALLBACK_JSAPI", errorCode: message });
          const payUrl = `${publicBaseUrlForRequest(req)}/public-pay/${encodeURIComponent(rawToken)}`;
          createAuditLog({ action: "PUBLIC_ARTICLE_FALLBACK_JSAPI", targetType: "order", targetId: order.platformOrderNo, detail: { merchantId, channelId: channel.id, reason: message } });
          return res.status(201).json({ data: getOrder(order.id), provider: "PUBLIC_ACCOUNT_ARTICLE_FALLBACK", paymentMethod, channel: { id: channel.id, mchId: channel.mchId, appId: String(appConfig.appid) }, entry: { payUrl, qrDataUrl: entry.qrDataUrl, previewUrl: null, fallbackToJsapi: true, expiresAt: order.expireAt } });
        }
        if (routeReserved) releaseRouteCapacity(order.id);
        try { updateOrderPayment(order.id, { status: "FAILED" }); } catch { /* preserve the original failure */ }
        insertPaymentAttempt(order.id, channel.id, "PUBLIC_ARTICLE_FAILED", message);
      }
      return res.status(502).json({ error: "PUBLIC_ARTICLE_CREATE_FAILED", message, order: order ? getOrder(order.id) : undefined });
    }
  }
  try {
    insertOrder({ merchantId, platformOrderNo, channelId: channel.id, wechatMerchantId: channel.merchantInternalId, channelOutTradeNo, amount: parsed.data.amount, description: parsed.data.description, paymentMethod: "NATIVE", collectionMode: "NATIVE", paymentAppId: channel.appInternalId, clientRequestNo, expireAt, deviceType: "UNKNOWN", deviceIp: String(req.ip || req.socket.remoteAddress || "127.0.0.1").replace(/^::ffff:/, "") });
    const order = getOrder(platformOrderNo);
    if (!order) return res.status(500).json({ error: "ORDER_CREATE_FAILED" });
    let routeReserved = false;
    try {
      reserveRouteCapacity(order.id, channel);
      routeReserved = true;
      const provider = config.mockPayment ? new MockPaymentProvider() : new WechatNativeProvider();
      const result = await provider.createNativeOrder({ appId: channel.appId, mchId: channel.mchId, description: parsed.data.description, outTradeNo: channelOutTradeNo, amount: parsed.data.amount, notifyUrl, attach: platformOrderNo, credentialRef: channel.credentialRef, clientIp: String(req.ip || req.socket.remoteAddress || "127.0.0.1").replace(/^::ffff:/, "") });
      const qrDataUrl = await QRCode.toDataURL(result.codeUrl, { width: 320, margin: 2 });
      updateOrderPayment(order.id, { status: "QR_CREATED", codeUrl: result.codeUrl, qrDataUrl });
      insertPaymentAttempt(order.id, channel.id, "SUCCESS");
      recordChannelHealth(channel.id, { success: true, failureThreshold: config.channelFailureThreshold });
      createAuditLog({ action: "ADMIN_NATIVE_PAYMENT_TEST", targetType: "order", targetId: platformOrderNo, detail: { merchantId, channelId: channel.id, amount: parsed.data.amount, provider: result.provider } });
      return res.status(201).json({ data: getOrder(order.id), provider: result.provider, paymentMethod, channel: { id: channel.id, mchId: channel.mchId, appId: channel.appId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PAYMENT_PROVIDER_ERROR";
      if (routeReserved) releaseRouteCapacity(order.id);
      updateOrderPayment(order.id, { status: "FAILED" });
      insertPaymentAttempt(order.id, channel.id, "FAILED", message);
      recordChannelHealth(channel.id, { success: false, error: message, failureThreshold: config.channelFailureThreshold });
      return res.status(502).json({ error: "PAYMENT_PROVIDER_ERROR", message, order: getOrder(order.id) });
    }
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "PAYMENT_TEST_FAILED" }); }
});
app.patch("/api/v1/admin/channels/:channelId/merchants/:merchantId", (req, res) => {
  const parsed = z.object({ bindingStatus: z.enum(["ACTIVE", "DISABLED"]).optional(), routeWeight: z.number().int().min(1).max(10000).optional(), minOrderAmount: z.number().int().min(1).optional(), maxOrderAmount: z.number().int().nonnegative().optional(), dailyAmountLimit: z.number().int().nonnegative().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_CHANNEL_MERCHANT_POLICY", details: parsed.error.flatten() });
  try {
    const data = updateChannelMerchantBinding(String(req.params.channelId), String(req.params.merchantId), parsed.data);
    if (!data) return res.status(404).json({ error: "CHANNEL_MERCHANT_BINDING_NOT_FOUND" });
    createAuditLog({ action: "CHANNEL_MERCHANT_POLICY_UPDATE", targetType: "channel_merchant_binding", targetId: `${req.params.channelId}:${req.params.merchantId}`, detail: parsed.data });
    return res.json({ data });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "CHANNEL_MERCHANT_POLICY_UPDATE_FAILED" }); }
});
app.get("/api/v1/admin/platform-merchants", (req, res) => { const scope = adminScopeFilter(req); return res.json({ data: listPlatformMerchants().filter((item) => !scope.merchantIds || scope.merchantIds.includes(String(item.id))) }); });
app.get("/api/v1/admin/platform-merchant-ledger", (req, res) => {
  const scope = adminScopeFilter(req);
  const result = searchMerchantLedger({
    merchantId: typeof req.query.merchantId === "string" ? req.query.merchantId : undefined,
    merchantIds: scope.merchantIds,
    entryType: typeof req.query.entryType === "string" ? req.query.entryType : undefined,
    query: typeof req.query.q === "string" ? req.query.q : typeof req.query.note === "string" ? req.query.note : undefined,
    dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined,
    dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined,
    page: Number(req.query.page ?? 1),
    pageSize: Number(req.query.pageSize ?? 50)
  });
  return res.json({ data: result.items, meta: { total: result.total, page: result.page, pageSize: result.pageSize, totalPages: Math.ceil(result.total / result.pageSize) }, metrics: result.metrics });
});
app.get("/api/v1/admin/platform-merchant-prepaid", (req, res) => {
  const scope = adminScopeFilter(req);
  const result = searchMerchantPrepaidRecords({
    merchantId: typeof req.query.merchantId === "string" ? req.query.merchantId : undefined,
    merchantIds: scope.merchantIds,
    entryType: typeof req.query.entryType === "string" ? req.query.entryType : undefined,
    dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined,
    dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined,
    page: Number(req.query.page ?? 1),
    pageSize: Number(req.query.pageSize ?? 50)
  });
  return res.json({ data: result.items, meta: { total: result.total, page: result.page, pageSize: result.pageSize, totalPages: Math.ceil(result.total / result.pageSize) }, summary: result.summary });
});
app.get("/api/v1/admin/platform-merchants/:id", (req, res) => {
  if (!adminCan(req, 'platform_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const item = getPlatformMerchantDetail(String(req.params.id));
  if (!item) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
  return res.json({ data: item });
});
app.get("/api/v1/admin/platform-merchants/:id/account", (req, res) => {
  if (!adminCan(req, 'platform_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const account = getMerchantFinancialOverview(String(req.params.id));
  if (!account) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
  return res.json({ data: account });
});
app.get("/api/v1/admin/platform-merchants/:id/account/ledger", (req, res) => {
  if (!adminCan(req, 'platform_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  if (!listPlatformMerchants().some((item) => String(item.id) === String(req.params.id))) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
  return res.json({ data: listMerchantLedgerEntries(String(req.params.id), Number(req.query.limit ?? 100)) });
});
app.get("/api/v1/admin/platform-merchants/:id/account/credit-ledger", (req, res) => {
  if (!adminCan(req, 'platform_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  if (!listPlatformMerchants().some((item) => String(item.id) === String(req.params.id))) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
  return res.json({ data: listMerchantCreditLedger(String(req.params.id), Number(req.query.limit ?? 100)) });
});
app.get("/api/v1/admin/platform-merchants/:id/account/alerts", (req, res) => {
  if (!adminCan(req, 'platform_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  if (!listPlatformMerchants().some((item) => String(item.id) === String(req.params.id))) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
  return res.json({ data: listMerchantAlertEvents(String(req.params.id), Number(req.query.limit ?? 100)) });
});
app.patch("/api/v1/admin/platform-merchants/:id/profile", (req, res) => {
  if (!adminCan(req, 'platform_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const parsed = z.object({ name: z.string().min(2).max(120), settlementRate: z.number().min(0).max(100), maxOrderAmount: z.number().int().positive().max(100_000_000), dailyAmountLimit: z.number().int().nonnegative().max(1_000_000_000), dailyOrderLimit: z.number().int().nonnegative().max(1_000_000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_PLATFORM_MERCHANT_PROFILE", details: parsed.error.flatten() });
  const item = updatePlatformMerchantProfile(String(req.params.id), parsed.data);
  if (!item) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
  createAuditLog({ action: "PLATFORM_MERCHANT_PROFILE_UPDATE", targetType: "platform_merchant", targetId: String(req.params.id), detail: parsed.data });
  return res.json({ data: item });
});
app.get("/api/v1/admin/platform-merchants/:id/channels", (req, res) => {
  if (!adminCan(req, 'platform_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  if (!listPlatformMerchants().some((item) => item.id === req.params.id)) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
  return res.json({ data: listMerchantChannelSettings(String(req.params.id)) });
});
app.patch("/api/v1/admin/platform-merchants/:id/channels/:channelId", (req, res) => {
  if (!adminCan(req, 'platform_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const parsed = z.object({ enabled: z.boolean().optional(), routeWeight: z.number().int().min(1).max(10000).optional(), routeStrategy: z.enum(["HEALTH_WEIGHTED", "ROUND_ROBIN", "FAILOVER"]).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_CHANNEL_SETTING", details: parsed.error.flatten() });
  try {
    const item = updateMerchantChannelSetting(String(req.params.id), String(req.params.channelId), parsed.data);
    createAuditLog({ action: "ADMIN_MERCHANT_CHANNEL_SETTING_UPDATE", targetType: "platform_merchant_channel", targetId: `${req.params.id}:${req.params.channelId}`, detail: parsed.data });
    return res.json({ data: item });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_CHANNEL_SETTING_FAILED" }); }
});
app.get("/api/v1/admin/platform-merchants/:id/wechat-merchants", (req, res) => {
  if (!adminCan(req, 'platform_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  if (!listPlatformMerchants().some((item) => item.id === req.params.id)) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
  return res.json({ data: listPlatformMerchantWechatBindings(String(req.params.id)) });
});
app.put("/api/v1/admin/platform-merchants/:id/wechat-merchants", (req, res) => {
  const parsed = z.object({ bindings: z.array(z.object({ wechatMerchantId: entityId, status: z.enum(["ACTIVE", "DISABLED"]).optional(), routeWeight: z.number().int().min(1).max(10000).optional(), maxConcurrency: z.number().int().nonnegative().optional(), minOrderAmount: z.number().int().positive().optional(), maxOrderAmount: z.number().int().nonnegative().optional(), dailyAmountLimit: z.number().int().nonnegative().optional(), dailyOrderLimit: z.number().int().nonnegative().optional() }).refine((item) => !item.maxOrderAmount || !item.minOrderAmount || item.maxOrderAmount >= item.minOrderAmount, { message: "maxOrderAmount must be >= minOrderAmount" })).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_PLATFORM_MERCHANT_WECHAT_BINDINGS", details: parsed.error.flatten() });
  try { const data = setPlatformMerchantWechatBindings(String(req.params.id), parsed.data.bindings); createAuditLog({ action: "PLATFORM_MERCHANT_WECHAT_BINDINGS", targetType: "platform_merchant", targetId: String(req.params.id), detail: { count: parsed.data.bindings.length } }); return res.json({ data }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "PLATFORM_MERCHANT_WECHAT_BINDINGS_FAILED" }); }
});
app.get("/api/v1/admin/platform-merchants/:id/webhook", (req, res) => {
  const item = getMerchantWebhook(String(req.params.id));
  return res.json({ data: item ? { ...item, secret: "********" } : null });
});
app.put("/api/v1/admin/platform-merchants/:id/webhook", (req, res) => {
  const parsed = z.object({ url: z.string().url().max(500), secret: z.string().min(16).max(256), enabled: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_WEBHOOK", details: parsed.error.flatten() });
  try { const item = upsertMerchantWebhook({ merchantId: String(req.params.id), ...parsed.data }); createAuditLog({ action: "MERCHANT_WEBHOOK_CONFIG", targetType: "platform_merchant", targetId: String(req.params.id), detail: { url: parsed.data.url, enabled: parsed.data.enabled !== false } }); return res.json({ data: { ...item, secret: "********" } }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_WEBHOOK_CONFIG_FAILED" }); }
});
app.post("/api/v1/admin/platform-merchants/:id/webhook/test", (req, res) => {
  const merchant = listPlatformMerchants().find((item) => String(item.id) === String(req.params.id));
  const webhook = getMerchantWebhook(String(req.params.id));
  if (!merchant) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
  if (!webhook || !webhook.enabled) return res.status(409).json({ error: "MERCHANT_WEBHOOK_NOT_CONFIGURED" });
  const eventId = `admin-test-${Date.now()}-${randomId("evt")}`;
  enqueueMerchantWebhook(String(req.params.id), "WEBHOOK_TEST", eventId, { eventId, eventType: "WEBHOOK_TEST", merchantId: req.params.id, message: "平台管理员回调测试事件", createdAt: new Date().toISOString() });
  createAuditLog({ action: "MERCHANT_WEBHOOK_TEST", targetType: "platform_merchant", targetId: String(req.params.id), detail: { eventId } });
  return res.status(202).json({ data: { eventId, status: "PENDING" } });
});
app.patch("/api/v1/admin/platform-merchants/:id/users/:userId/password", (req, res) => {
  const parsed = z.object({ password: z.string().min(8).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_PASSWORD" });
  const merchant = listPlatformMerchants().find((item) => String(item.id) === String(req.params.id));
  if (!merchant) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
  const user = updateMerchantUserPassword(String(req.params.userId), hashPassword(parsed.data.password));
  if (!user || String(user.merchantId) !== String(req.params.id)) return res.status(404).json({ error: "MERCHANT_USER_NOT_FOUND" });
  createAuditLog({ action: "MERCHANT_USER_PASSWORD_RESET", targetType: "merchant_user", targetId: String(req.params.userId), detail: { merchantId: req.params.id } });
  return res.json({ data: { id: user.id, username: user.username, status: user.status, mustChangePassword: true } });
});
app.post("/api/v1/admin/platform-merchants/:id/users", (req, res) => {
  const parsed = z.object({ username: z.string().regex(/^[a-zA-Z0-9_.-]{2,64}$/), password: z.string().min(8).max(128), role: z.enum(["OWNER", "OPERATOR", "FINANCE", "VIEWER"]).default("OWNER") }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_USER", details: parsed.error.flatten() });
  const merchant = listPlatformMerchants().find((item) => String(item.id) === String(req.params.id));
  if (!merchant) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
  if (getMerchantUserByUsername(parsed.data.username)) return res.status(409).json({ error: "MERCHANT_USERNAME_EXISTS" });
  try { const user = createMerchantUser({ merchantId: String(req.params.id), username: parsed.data.username, passwordHash: hashPassword(parsed.data.password), role: parsed.data.role }); createAuditLog({ action: "MERCHANT_USER_CREATE", targetType: "merchant_user", targetId: String(user.id), detail: { merchantId: req.params.id, username: user.username, role: user.role } }); return res.status(201).json({ data: user }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_USER_CREATE_FAILED" }); }
});
app.put("/api/v1/admin/platform-merchants/:id/channels", (req, res) => {
  const parsed = z.object({ channelIds: z.array(entityId).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_CHANNELS", details: parsed.error.flatten() });
  try { const channels = setMerchantChannels(String(req.params.id), parsed.data.channelIds); createAuditLog({ action: "PLATFORM_MERCHANT_CHANNELS", targetType: "platform_merchant", targetId: String(req.params.id), detail: { channelIds: parsed.data.channelIds } }); return res.json({ data: channels }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_CHANNELS_UPDATE_FAILED" }); }
});
app.post("/api/v1/admin/platform-merchants", (req, res) => {
  const parsed = z.object({ id: entityId.optional(), code: z.string().regex(/^[a-zA-Z0-9_-]{2,64}$/).optional(), name: z.string().min(2).max(120), username: z.string().regex(/^[a-zA-Z0-9_.-]{2,64}$/).optional(), initialPassword: z.string().min(8).max(128).optional(), settlementRate: z.number().min(0).max(100).default(0), maxOrderAmount: z.number().int().positive().max(100_000_000).default(10_000_000), dailyAmountLimit: z.number().int().nonnegative().max(1_000_000_000).default(0), dailyOrderLimit: z.number().int().nonnegative().max(1_000_000).default(0) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_PLATFORM_MERCHANT", details: parsed.error.flatten() });
  const generatedId = parsed.data.id ?? randomId("pm");
  const code = parsed.data.code ?? generatedId;
  const username = parsed.data.username;
  if (username && getMerchantUserByUsername(username)) return res.status(409).json({ error: "MERCHANT_USERNAME_EXISTS" });
  if ((username && !parsed.data.initialPassword) || (!username && parsed.data.initialPassword)) return res.status(400).json({ error: "MERCHANT_ACCOUNT_FIELDS_REQUIRED" });
  try { const item = createPlatformMerchant({ ...parsed.data, id: generatedId, code }); const user = username ? createMerchantUser({ merchantId: String(item.id), username, passwordHash: hashPassword(parsed.data.initialPassword!) }) : undefined; createAuditLog({ action: "PLATFORM_MERCHANT_CREATE", targetType: "platform_merchant", targetId: String(item.id), detail: { code, name: parsed.data.name, username: user?.username } }); return res.status(201).json({ data: { ...item, loginUsername: user?.username } }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "PLATFORM_MERCHANT_CREATE_FAILED" }); }
});
app.patch("/api/v1/admin/platform-merchants/:id/status", (req, res) => {
  const parsed = z.object({ status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "FROZEN", "DISABLED", "ARCHIVED"]), reason: z.string().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_PLATFORM_MERCHANT_STATUS" });
  if (!listPlatformMerchants().some((item) => item.id === req.params.id)) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
  setPlatformMerchantStatus(req.params.id, parsed.data.status, parsed.data.reason); createAuditLog({ action: "PLATFORM_MERCHANT_STATUS", targetType: "platform_merchant", targetId: req.params.id, detail: parsed.data }); return res.json({ data: listPlatformMerchants().find((item) => item.id === req.params.id) });
});
app.get("/api/v1/admin/platform-merchants/:id/risk", (req, res) => {
  const item = listPlatformMerchants().find((merchant) => String(merchant.id) === String(req.params.id));
  if (!item) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
  return res.json({ data: { merchantId: item.id, maxOrderAmount: item.maxOrderAmount, dailyAmountLimit: item.dailyAmountLimit, dailyOrderLimit: item.dailyOrderLimit, usage: checkMerchantOrderRisk(String(item.id), 0) } });
});
app.patch("/api/v1/admin/platform-merchants/:id/risk", (req, res) => {
  const parsed = z.object({ maxOrderAmount: z.number().int().positive().max(100_000_000), dailyAmountLimit: z.number().int().nonnegative().max(1_000_000_000), dailyOrderLimit: z.number().int().nonnegative().max(1_000_000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_RISK_POLICY", details: parsed.error.flatten() });
  const item = updateMerchantRiskPolicy(String(req.params.id), parsed.data);
  if (!item) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
  createAuditLog({ action: "PLATFORM_MERCHANT_RISK_UPDATE", targetType: "platform_merchant", targetId: String(req.params.id), detail: parsed.data });
  return res.json({ data: item });
});
app.patch("/api/v1/admin/platform-merchants/:id/quota", (req, res) => {
  const parsed = z.object({ minOrderAmount: z.number().int().positive().optional(), maxOrderAmount: z.number().int().positive().max(100_000_000).optional(), dailyAmountLimit: z.number().int().nonnegative().max(1_000_000_000).optional(), dailyOrderLimit: z.number().int().nonnegative().max(1_000_000).optional(), pendingAmountLimit: z.number().int().nonnegative().max(1_000_000_000).optional(), pendingOrderLimit: z.number().int().nonnegative().max(1_000_000).optional(), creditWarningAmount: z.number().int().nonnegative().max(1_000_000_000).optional(), warningRatio: z.number().min(0.01).max(1).optional(), criticalRatio: z.number().min(0.01).max(1).optional(), enabled: z.number().int().min(0).max(1).optional() }).refine((value) => value.warningRatio == null || value.criticalRatio == null || value.warningRatio <= value.criticalRatio, { message: "warningRatio must be <= criticalRatio" }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_QUOTA_POLICY", details: parsed.error.flatten() });
  const policy = updateMerchantQuotaPolicy(String(req.params.id), parsed.data);
  if (!policy) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
  createAuditLog({ action: "PLATFORM_MERCHANT_QUOTA_UPDATE", targetType: "platform_merchant", targetId: String(req.params.id), detail: parsed.data });
  return res.json({ data: policy });
});
app.patch("/api/v1/admin/platform-merchants/:id/credit", (req, res) => {
  if (!adminCan(req, 'platform_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const parsed = z.object({ delta: z.number().int().optional(), balance: z.number().int().nonnegative().optional(), note: z.string().max(200).optional(), operationPassword: z.string().min(1).max(128) }).refine((value) => (value.delta == null) !== (value.balance == null), { message: "delta or balance is required" }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_CREDIT", details: parsed.error.flatten() });
  if (!operationPasswordValid(req, parsed.data.operationPassword)) return res.status(401).json({ error: "OPERATION_PASSWORD_INVALID" });
  try { const account = adjustMerchantCredit(String(req.params.id), { ...parsed.data, operator: "local-admin" }); if (!account) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" }); createAuditLog({ action: "PLATFORM_MERCHANT_CREDIT_ADJUST", targetType: "platform_merchant", targetId: String(req.params.id), detail: { ...parsed.data, operationPassword: undefined } }); return res.json({ data: account }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_CREDIT_UPDATE_FAILED" }); }
});
app.patch("/api/v1/admin/platform-merchants/:id/balance", (req, res) => {
  if (!adminCan(req, 'platform_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const parsed = z.object({ delta: z.number().int().optional(), balance: z.number().int().nonnegative().optional(), note: z.string().max(200).optional(), operationPassword: z.string().min(1).max(128) }).refine((value) => (value.delta == null) !== (value.balance == null), { message: "delta or balance is required" }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_MERCHANT_BALANCE", details: parsed.error.flatten() });
  if (!operationPasswordValid(req, parsed.data.operationPassword)) return res.status(401).json({ error: "OPERATION_PASSWORD_INVALID" });
  try { const account = adjustMerchantBalance(String(req.params.id), { ...parsed.data, operator: "local-admin" }); if (!account) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" }); createAuditLog({ action: "PLATFORM_MERCHANT_BALANCE_ADJUST", targetType: "platform_merchant", targetId: String(req.params.id), detail: { ...parsed.data, operationPassword: undefined } }); return res.json({ data: account }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_BALANCE_UPDATE_FAILED" }); }
});
app.patch("/api/v1/admin/platform-merchants/:id/transfer-prepaid", (req, res) => {
  if (!adminCan(req, 'platform_merchant', String(req.params.id))) return res.status(403).json({ error: "ADMIN_DATA_SCOPE_DENIED" });
  const parsed = z.object({ amount: z.number().int().positive(), note: z.string().max(200).optional(), operationPassword: z.string().min(1).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_PREPAID_TRANSFER", details: parsed.error.flatten() });
  if (!operationPasswordValid(req, parsed.data.operationPassword)) return res.status(401).json({ error: "OPERATION_PASSWORD_INVALID" });
  try {
    const account = transferMerchantBalanceToCredit(String(req.params.id), { ...parsed.data, operator: "local-admin" });
    if (!account) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
    createAuditLog({ action: "PLATFORM_MERCHANT_TRANSFER_PREPAID", targetType: "platform_merchant", targetId: String(req.params.id), detail: { amount: parsed.data.amount, note: parsed.data.note } });
    return res.json({ data: account });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "MERCHANT_PREPAID_TRANSFER_FAILED" }); }
});
app.post("/api/v1/admin/platform-merchants/:id/rotate-key", (req, res) => {
  const item = rotatePlatformMerchantApiKey(String(req.params.id));
  if (!item) return res.status(404).json({ error: "PLATFORM_MERCHANT_NOT_FOUND" });
  createAuditLog({ action: "PLATFORM_MERCHANT_KEY_ROTATE", targetType: "platform_merchant", targetId: String(req.params.id) });
  return res.json({ data: item });
});
app.post("/api/v1/admin/channels", (req, res) => {
  const parsed = z.object({ id: entityId, name: z.string().trim().min(1).max(100).optional(), merchantIds: z.array(entityId).max(500).optional(), merchantId: entityId.optional(), paymentMethod: z.enum(["NATIVE", "JSAPI"]).default("NATIVE"), subjectId: entityId.optional(), appId: entityId.optional(), notifyPath: z.string().optional(), routeWeight: z.number().int().min(1).max(10000).default(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_ROUTING_CHANNEL", details: parsed.error.flatten() });
  try { const channel = createRoutingChannel({ id: parsed.data.id, name: parsed.data.name, merchantIds: parsed.data.merchantIds || (parsed.data.merchantId ? [parsed.data.merchantId] : []), paymentMethod: parsed.data.paymentMethod, notifyPath: parsed.data.notifyPath, routeWeight: parsed.data.routeWeight }); createAuditLog({ action: "CHANNEL_CONFIGURE", targetType: "channel", targetId: channel.id, detail: { name: channel.name, merchantIds: parsed.data.merchantIds || (parsed.data.merchantId ? [parsed.data.merchantId] : []), paymentMethod: channel.paymentMethod, routeWeight: channel.routeWeight } }); return res.status(201).json({ data: channel }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "CHANNEL_CONFIGURE_FAILED" }); }
});
app.patch("/api/v1/admin/channels/:id", (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(100).optional(), merchantIds: z.array(entityId).min(1).max(500).optional(), merchantId: entityId.optional(), paymentMethod: z.enum(["NATIVE", "JSAPI"]).optional(), subjectId: entityId.optional(), appId: entityId.optional(), notifyPath: z.string().optional(), routeWeight: z.number().int().min(1).max(10000).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_ROUTING_CHANNEL", details: parsed.error.flatten() });
  try {
    const channel = updateRoutingChannel(String(req.params.id), { name: parsed.data.name, merchantIds: parsed.data.merchantIds || (parsed.data.merchantId ? [parsed.data.merchantId] : undefined), paymentMethod: parsed.data.paymentMethod, notifyPath: parsed.data.notifyPath, routeWeight: parsed.data.routeWeight });
    if (!channel) return res.status(404).json({ error: "CHANNEL_NOT_FOUND" });
    createAuditLog({ action: "CHANNEL_UPDATE", targetType: "channel", targetId: channel.id, detail: { name: channel.name, merchantIds: parsed.data.merchantIds || (parsed.data.merchantId ? [parsed.data.merchantId] : undefined), paymentMethod: channel.paymentMethod, routeWeight: channel.routeWeight, notifyPath: channel.notifyPath } });
    return res.json({ data: channel });
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "CHANNEL_UPDATE_FAILED" }); }
});
app.get("/api/v1/admin/reconciliation/runs", (req, res) => res.json({ data: listReconciliationRuns(Number(req.query.limit ?? 50)) }));
app.get("/api/v1/admin/reconciliation/runs/:id", (req, res) => {
  const run = getReconciliationRun(String(req.params.id));
  if (!run) return res.status(404).json({ error: "RECONCILIATION_RUN_NOT_FOUND" });
  return res.json({ data: run });
});

const reconciliationBillItemSchema = z.object({
  channelId: z.string().optional(),
  outTradeNo: z.string().min(1).max(64).optional(),
  transactionId: z.string().min(1).max(64).optional(),
  amount: z.number().int().nonnegative(),
  tradeState: z.string().min(1).max(32),
  refundAmount: z.number().int().nonnegative().default(0),
  raw: z.unknown().optional()
}).refine((value) => Boolean(value.outTradeNo || value.transactionId), { message: "outTradeNo or transactionId is required" });

app.post("/api/v1/admin/reconciliation/runs/:id/bill", (req, res) => {
  const parsed = z.object({ items: z.array(reconciliationBillItemSchema).min(1).max(5000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_RECONCILIATION_BILL", details: parsed.error.flatten() });
  try {
    const run = importReconciliationBill(String(req.params.id), parsed.data.items);
    createAuditLog({ action: "RECONCILIATION_BILL_IMPORT", targetType: "reconciliation", targetId: String(req.params.id), detail: { count: parsed.data.items.length } });
    return res.json({ data: run });
  } catch (error) {
    const message = error instanceof Error ? error.message : "bill import failed";
    return res.status(message === "RECONCILIATION_RUN_NOT_FOUND" ? 404 : 400).json({ error: message });
  }
});
app.post("/api/v1/admin/reconciliation/items/:itemId/resolve", (req, res) => {
  const parsed = z.object({ status: z.enum(["RESOLVED", "IGNORED"]), note: z.string().min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_RECONCILIATION_RESOLUTION", details: parsed.error.flatten() });
  const item = resolveReconciliationItem(String(req.params.itemId), (req as Request & { adminUser?: { username?: string } }).adminUser?.username ?? "admin", parsed.data.status, parsed.data.note);
  if (!item) return res.status(404).json({ error: "RECONCILIATION_ITEM_NOT_FOUND" });
  createAuditLog({ action: "RECONCILIATION_ITEM_RESOLVE", targetType: "reconciliation_item", targetId: String(req.params.itemId), detail: parsed.data });
  return res.json({ data: item });
});

const reconciliationSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  channelId: z.string().optional()
});

app.post("/api/v1/admin/reconciliation/runs", (req, res) => {
  const parsed = reconciliationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_RECONCILIATION_RANGE", details: parsed.error.flatten() });
  const start = new Date(`${parsed.data.dateFrom}T00:00:00+08:00`);
  const end = new Date(`${parsed.data.dateTo}T00:00:00+08:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return res.status(400).json({ error: "INVALID_RECONCILIATION_RANGE" });
  if (parsed.data.channelId && !getChannel(parsed.data.channelId)) return res.status(400).json({ error: "CHANNEL_NOT_FOUND" });
  try {
    const run = createReconciliationRun({ dateFrom: start.toISOString(), dateTo: end.toISOString(), channelId: parsed.data.channelId });
    createAuditLog({ action: "RECONCILIATION_RUN", targetType: "reconciliation", targetId: String(run.id), detail: { dateFrom: parsed.data.dateFrom, dateTo: parsed.data.dateTo, channelId: parsed.data.channelId ?? null } });
    return res.status(201).json({ data: run });
  } catch (error) {
    return res.status(500).json({ error: "RECONCILIATION_FAILED", message: error instanceof Error ? error.message : "reconciliation failed" });
  }
});

app.post("/api/v1/admin/reconciliation/download", async (req, res) => {
  const parsed = z.object({ billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), channelId: z.string().min(2) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_BILL_DATE_OR_CHANNEL" });
  try {
    const run = await runChannelReconciliation(parsed.data.channelId, parsed.data.billDate);
    return res.status(201).json({ data: run });
  } catch (error) {
    const message = error instanceof Error ? error.message : "bill download failed";
    return res.status(message === "CHANNEL_NOT_FOUND" ? 404 : 502).json({ error: message });
  }
});

app.post("/api/v1/channels", requireAdmin, (req, res) => {
  const parsed = channelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_CHANNEL", details: parsed.error.flatten() });
  try {
    const channel = createChannel(parsed.data);
    createAuditLog({ action: "CHANNEL_CREATE", targetType: "channel", targetId: channel.id, detail: { subjectName: channel.subjectName, appId: channel.appId, mchId: channel.mchId } });
    return res.status(201).json({ data: channel });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "CHANNEL_CREATE_FAILED" });
  }
});

app.patch("/api/v1/channels/:id/status", requireAdmin, (req, res) => {
  const parsed = z.object({ status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_CHANNEL_STATUS" });
  const channelId = String(req.params.id);
  if (!getChannel(channelId)) return res.status(404).json({ error: "CHANNEL_NOT_FOUND" });
  setChannelStatus(channelId, parsed.data.status);
  createAuditLog({ action: "CHANNEL_STATUS", targetType: "channel", targetId: channelId, detail: { status: parsed.data.status } });
  return res.json({ data: getChannel(channelId) });
});

const routeRuleSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{2,64}$/).optional(),
  name: z.string().min(2).max(80),
  channelIds: z.array(z.string()).default([]),
  amountMin: z.number().int().nonnegative().optional(),
  amountMax: z.number().int().positive().optional(),
  priority: z.number().int().min(1).max(10000).default(100),
  weight: z.number().int().min(1).max(10000).default(100)
}).refine((value) => value.amountMin == null || value.amountMax == null || value.amountMin <= value.amountMax, { message: "amountMin must be <= amountMax" });

app.post("/api/v1/admin/routing-rules", (req, res) => {
  const parsed = routeRuleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_ROUTE_RULE", details: parsed.error.flatten() });
  const unknown = parsed.data.channelIds.filter((id) => !getChannel(id));
  if (unknown.length) return res.status(400).json({ error: "CHANNEL_NOT_FOUND", channelIds: unknown });
  try { return res.status(201).json({ data: createRouteRule({ ...parsed.data, id: parsed.data.id || randomId("rule") }) }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "ROUTE_RULE_CREATE_FAILED" }); }
});

app.patch("/api/v1/admin/routing-rules/:id", (req, res) => {
  const parsed = z.object({ name: z.string().min(2).max(80).optional(), channelIds: z.array(z.string()).optional(), amountMin: z.number().int().nonnegative().optional(), amountMax: z.number().int().positive().optional(), priority: z.number().int().min(1).max(10000).optional(), weight: z.number().int().min(1).max(10000).optional() }).refine((value) => value.amountMin == null || value.amountMax == null || value.amountMin <= value.amountMax, { message: "amountMin must be <= amountMax" }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_ROUTE_RULE", details: parsed.error.flatten() });
  const unknown = (parsed.data.channelIds ?? []).filter((id) => !getChannel(id));
  if (unknown.length) return res.status(400).json({ error: "CHANNEL_NOT_FOUND", channelIds: unknown });
  try { const rule = updateRouteRule(String(req.params.id), parsed.data); return res.json({ data: rule }); }
  catch (error) { return res.status(404).json({ error: error instanceof Error ? error.message : "ROUTE_RULE_UPDATE_FAILED" }); }
});

app.patch("/api/v1/admin/routing-rules/:id/status", (req, res) => {
  const parsed = z.object({ status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_ROUTE_RULE_STATUS" });
  const rule = listRouteRules().find((item) => item.id === String(req.params.id));
  if (!rule) return res.status(404).json({ error: "ROUTE_RULE_NOT_FOUND" });
  setRouteRuleStatus(String(req.params.id), parsed.data.status);
  return res.json({ data: listRouteRules().find((item) => item.id === String(req.params.id)) });
});

app.post("/api/v1/admin/orders/batch-query", async (req, res) => {
  const parsed = z.object({ ids: z.array(z.string().min(1).max(80)).min(1).max(50) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_BATCH_QUERY", details: parsed.error.flatten() });
  const results: Array<Record<string, unknown>> = [];
  for (const id of parsed.data.ids) {
    const order = getOrder(id);
    if (!order) { results.push({ id, status: "NOT_FOUND" }); continue; }
    const channel = resolveChannelMerchant(order.channelId, order.wechatMerchantId);
    if (!channel) { results.push({ id, status: "CHANNEL_NOT_FOUND" }); continue; }
    try {
      const provider = config.mockPayment ? new MockPaymentProvider() : new WechatNativeProvider();
      const result = await provider.queryOrder({ mchId: channel.mchId, appId: String(channel.appId), outTradeNo: order.channelOutTradeNo, credentialRef: channel.credentialRef });
      insertPaymentAttempt(order.id, channel.id, "BATCH_QUERY", result.tradeState);
      if (result.tradeState === "SUCCESS") updateOrderPayment(order.id, { status: "SUCCESS", transactionId: result.transactionId });
      else if (result.tradeState === "CLOSED") updateOrderPayment(order.id, { status: "CLOSED" });
      recordOrderExceptionAction({ orderId: order.id, action: "QUERY", operator: (req as Request & { adminUser?: { username?: string } }).adminUser?.username ?? "local-admin", result: result.tradeState, note: "批量查单" });
      recordChannelHealth(channel.id, { success: true, failureThreshold: config.channelFailureThreshold });
      results.push({ id, status: result.tradeState, order: getOrder(order.id) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "BATCH_QUERY_FAILED";
      monitorMerchantFromProviderError(channel, message);
      insertPaymentAttempt(order.id, channel.id, "BATCH_QUERY_FAILED", message);
      recordOrderExceptionAction({ orderId: order.id, action: "QUERY", operator: (req as Request & { adminUser?: { username?: string } }).adminUser?.username ?? "local-admin", result: "FAILED", note: message });
      recordChannelHealth(channel.id, { success: false, error: message, failureThreshold: config.channelFailureThreshold });
      results.push({ id, status: "QUERY_FAILED", error: message });
    }
  }
  createAuditLog({ action: "ORDER_BATCH_QUERY", targetType: "orders", detail: { count: parsed.data.ids.length } });
  return res.json({ data: results, summary: { total: results.length, success: results.filter((item) => item.status === "SUCCESS").length, closed: results.filter((item) => item.status === "CLOSED").length, failed: results.filter((item) => ["FAILED", "QUERY_FAILED", "NOT_FOUND", "CHANNEL_NOT_FOUND"].includes(String(item.status))).length, unknown: results.filter((item) => !["SUCCESS", "CLOSED", "FAILED", "QUERY_FAILED", "NOT_FOUND", "CHANNEL_NOT_FOUND"].includes(String(item.status))).length } });
});

app.post("/api/v1/orders", rateLimit({ windowMs: 60_000, max: 300, key: (req) => `${req.ip}:${String(req.headers["x-merchant-code"] ?? "anonymous")}` }), async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_ORDER", details: parsed.error.flatten() });
  const input = parsed.data;
  if (input.collectionMode === "QR" && input.paymentMethod !== "NATIVE") return res.status(400).json({ error: "QR_MODE_NATIVE_ONLY" });
  const merchantRequest = verifyMerchantRequest(req);
  if (merchantRequest.error) return res.status(401).json({ error: merchantRequest.error });
  let quotaMerchant = false;
  if (config.merchantApiAuthEnabled || config.merchantSignatureRequired) {
    const platformMerchant = merchantRequest.merchant;
    if (!platformMerchant) return res.status(401).json({ error: "MERCHANT_AUTH_REQUIRED" });
    input.merchantId = String(platformMerchant.id);
    const risk = checkMerchantOrderRisk(input.merchantId, input.amount);
    if (!risk.allowed) { createAuditLog({ action: "ORDER_RISK_BLOCK", targetType: "platform_merchant", targetId: input.merchantId, detail: { reason: risk.reason, amount: input.amount } }); return res.status(429).json({ error: risk.reason, risk: { dailyOrderCount: risk.dailyOrderCount, dailyAmount: risk.dailyAmount, maxOrderAmount: risk.maxOrderAmount, dailyOrderLimit: risk.dailyOrderLimit, dailyAmountLimit: risk.dailyAmountLimit } }); }
    quotaMerchant = true;
  } else if (listPlatformMerchants().some((item) => String(item.id) === String(input.merchantId))) {
    const risk = checkMerchantOrderRisk(input.merchantId, input.amount);
    if (!risk.allowed) { createAuditLog({ action: "ORDER_RISK_BLOCK", targetType: "platform_merchant", targetId: input.merchantId, detail: { reason: risk.reason, amount: input.amount } }); return res.status(429).json({ error: risk.reason, risk: { dailyOrderCount: risk.dailyOrderCount, dailyAmount: risk.dailyAmount, maxOrderAmount: risk.maxOrderAmount, dailyOrderLimit: risk.dailyOrderLimit, dailyAmountLimit: risk.dailyAmountLimit } }); }
    quotaMerchant = true;
  }
  const existing = findOrderByClientRequest(input.merchantId, input.clientRequestNo);
  if (existing) {
    const existingEntry = input.entryMode === "PUBLIC_ACCOUNT_ARTICLE" ? getPublicPaymentEntryByOrder(existing.id) : undefined;
    if (existingEntry) {
      const existingToken = getPublicPaymentEntryToken(existing.id);
      const existingDraft = getWechatArticleDraftByOrder(existing.id);
      if (existingToken) return res.json({ data: existing, provider: "PUBLIC_ACCOUNT_ARTICLE", idempotent: true, entry: { payUrl: `${publicBaseUrlForRequest(req)}/public-pay/${encodeURIComponent(existingToken)}`, qrDataUrl: existingEntry.qrDataUrl, previewUrl: existingDraft?.previewUrl ?? null, draftMediaId: existingDraft?.draftMediaId ?? null, expiresAt: existingEntry.expiresAt } });
    }
    return res.json({ data: existing, idempotent: true });
  }
  if (input.clientMerchantId) {
    const clientMerchant = getClientMerchant(input.clientMerchantId);
    if (!clientMerchant || clientMerchant.status !== "ACTIVE") return res.status(409).json({ error: "CLIENT_MERCHANT_NOT_AVAILABLE" });
    const clientChannels = listClientMerchantChannels(input.clientMerchantId);
    if (input.channelId && clientChannels.length && !clientChannels.some((item) => String(item.channelId || item.id) === input.channelId)) return res.status(403).json({ error: "CLIENT_MERCHANT_CHANNEL_NOT_AUTHORIZED" });
    const clientRisk = checkClientMerchantOrderRisk(input.clientMerchantId, input.amount);
    if (!clientRisk.allowed) { createAuditLog({ action: "ORDER_RISK_BLOCK", targetType: "client_merchant", targetId: input.clientMerchantId, detail: { reason: clientRisk.reason, amount: input.amount } }); return res.status(429).json({ error: clientRisk.reason, risk: { dailyAmount: clientRisk.dailyAmount, dailyAmountLimit: clientRisk.dailyAmountLimit, singleOrderLimit: clientRisk.singleOrderLimit, balanceWarning: clientRisk.balanceWarning } }); }
  }
  const merchantChannelIds = (config.merchantApiAuthEnabled || config.merchantSignatureRequired) ? listMerchantChannelIds(input.merchantId) : undefined;
  if (merchantChannelIds && merchantChannelIds.length === 0) return res.status(409).json({ error: "MERCHANT_CHANNEL_NOT_CONFIGURED" });
  if (input.channelId && merchantChannelIds && !merchantChannelIds.includes(input.channelId)) return res.status(403).json({ error: "CHANNEL_ACCESS_DENIED" });
  if (input.channelId && merchantChannelIds && !listMerchantChannelSettings(input.merchantId).some((item) => String(item.id) === input.channelId && Number(item.enabled) === 1)) return res.status(409).json({ error: "MERCHANT_CHANNEL_DISABLED" });
  const device = requestDeviceInfo(req, input);
  const initialBlockMatch = findActiveMemberBlock({ platformMerchantId: input.merchantId, channelId: input.channelId, keys: memberBlockKeys(device) });
  if (initialBlockMatch) {
    recordMemberBlockMatch(initialBlockMatch, { platformMerchantId: input.merchantId, channelId: input.channelId, amount: input.amount, phase: "PRE_ROUTE" });
    return res.status(403).json({ error: "MEMBER_BLOCKED" });
  }
  const clientBoundChannels = input.clientMerchantId ? listClientMerchantChannels(input.clientMerchantId).map((item) => String(item.channelId || item.id)) : [];
  let routeChannelIds = input.channelId ? [input.channelId] : (clientBoundChannels.length ? clientBoundChannels : merchantChannelIds);
  if (input.collectionMode === "QR") {
    const candidates = routeChannelIds?.length ? routeChannelIds : listChannels().map((item) => String(item.id));
    routeChannelIds = candidates.filter((id) => isQrChannelEnabled(id));
    if (!routeChannelIds.length) return res.status(409).json({ error: "QR_MODE_DISABLED" });
  }
  let channel: ReturnType<typeof chooseRoutedPaymentTarget> | undefined;
  let order: ReturnType<typeof getOrder>;
  let platformOrderNo = "";
  let channelOutTradeNo = "";
  let nativeNotifyUrl = "";
  let jsapiOpenid = "";
  let jsapiPaymentAppId = "";
  let jsapiProviderAppId = "";
  const excludedTargetKeys = new Set<string>();
  let lastRouteError = "NO_ROUTE_TARGET_AVAILABLE";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      channel = chooseRoutedPaymentTarget(input.amount, routeChannelIds, input.clientMerchantId, input.merchantId, excludedTargetKeys, input.paymentMethod);
    } catch (error) {
      lastRouteError = error instanceof Error ? error.message : "NO_ROUTE_TARGET_AVAILABLE";
      break;
    }
    if (!channel || channel.status !== "ACTIVE") { lastRouteError = "CHANNEL_NOT_AVAILABLE"; break; }
    const channelBlockMatch = findActiveMemberBlock({ platformMerchantId: input.merchantId, channelId: channel.id, keys: memberBlockKeys(device) });
    if (channelBlockMatch) {
      recordMemberBlockMatch(channelBlockMatch, { platformMerchantId: input.merchantId, channelId: channel.id, amount: input.amount, phase: "CHANNEL_ROUTE" });
      lastRouteError = "MEMBER_BLOCKED";
      if (input.channelId) break;
      routeChannelIds = (routeChannelIds || []).filter((id) => id !== channel!.id);
      channel = undefined;
      continue;
    }
    nativeNotifyUrl = `${publicBaseUrlForRequest(req)}${channel.notifyPath}/${encodeURIComponent(channel.mchId)}`;
    if (!config.mockPayment && input.collectionMode === "NATIVE" && !isProductionCallbackUrl(nativeNotifyUrl)) {
      lastRouteError = "PUBLIC_CALLBACK_URL_REQUIRED";
      break;
    }
    const channelRisk = checkChannelOrderRisk(channel.id, { amount: input.amount, deviceIp: device.deviceIp, userId: device.userId, deviceCountry: device.deviceCountry, deviceProvince: device.deviceProvince, deviceCity: device.deviceCity });
    if (!channelRisk.allowed) {
      lastRouteError = channelRisk.reason || "CHANNEL_RISK_BLOCKED";
      createAuditLog({ action: "CHANNEL_RISK_BLOCK", targetType: "channel", targetId: channel.id, detail: { reason: lastRouteError, amount: input.amount, deviceIp: device.deviceIp, userId: device.userId || undefined } });
      if (input.channelId) break;
      routeChannelIds = (routeChannelIds || []).filter((id) => id !== channel!.id);
      channel = undefined;
      continue;
    }
    if (input.paymentMethod === "JSAPI") {
      const capability = channel.merchantInternalId ? getMerchantPaymentMethod(String(channel.merchantInternalId), "JSAPI") : undefined;
      if (!capability || capability.status !== "ACTIVE" || capability.appStatus !== "ACTIVE") {
        lastRouteError = "JSAPI_NOT_ENABLED_FOR_MERCHANT";
        if (input.channelId) break;
        routeChannelIds = (routeChannelIds || []).filter((id) => id !== channel!.id); channel = undefined; continue;
      }
      jsapiPaymentAppId = String(capability.appId);
      jsapiProviderAppId = String(capability.appid);
      if (!input.oauthToken && input.entryMode !== "PUBLIC_ACCOUNT_ARTICLE") {
        const returnUrl = String(input.oauthReturnUrl || req.headers.referer || `${publicBaseUrlForRequest(req)}/`);
        const appConfig = getWechatApp(jsapiPaymentAppId);
        if (!appConfig || !appSecretConfigured(jsapiPaymentAppId)) return res.status(409).json({ error: "JSAPI_OAUTH_REQUIRED", authorizeUrl: null });
        if (!oauthReturnUrlAllowed(appConfig, returnUrl)) return res.status(400).json({ error: "OAUTH_RETURN_URL_NOT_ALLOWED" });
        const state = createWechatOAuthState({ appId: jsapiPaymentAppId, returnUrl, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() });
        const authorizeUrl = config.mockPayment && config.nodeEnv !== "production"
          ? `${publicBaseUrlForRequest(req)}/api/v1/dev/wechat/oauth/mock?state=${encodeURIComponent(state)}`
          : buildWechatAuthorizeUrl(req, appConfig, state);
        return res.status(428).json({ error: "JSAPI_OAUTH_REQUIRED", authorizeUrl, state, expiresIn: 300 });
      }
      if (input.entryMode !== "PUBLIC_ACCOUNT_ARTICLE") {
        const oauth = consumeWechatOAuthToken(input.oauthToken!);
        if (!oauth) return res.status(401).json({ error: "INVALID_OR_EXPIRED_OAUTH_TOKEN" });
        if (oauth.appId !== jsapiPaymentAppId) return res.status(401).json({ error: "OAUTH_APP_MISMATCH" });
        jsapiOpenid = oauth.openid;
        const openidHash = crypto.createHash("sha256").update(jsapiOpenid, "utf8").digest("hex");
        const openidBlockMatch = findActiveMemberBlock({ platformMerchantId: input.merchantId, channelId: channel.id, keys: memberBlockKeys(device, openidHash) });
        if (openidBlockMatch) {
          recordMemberBlockMatch(openidBlockMatch, { platformMerchantId: input.merchantId, channelId: channel.id, amount: input.amount, phase: "OAUTH" });
          return res.status(403).json({ error: "MEMBER_BLOCKED" });
        }
      }
    }
    platformOrderNo = `P${Date.now()}${randomId("p").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)}`.slice(0, 32);
    channelOutTradeNo = newTradeNo(channel.id);
    const expireAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    try {
      insertOrder({ merchantId: input.merchantId, clientMerchantId: input.clientMerchantId, platformOrderNo, channelId: channel.id, wechatMerchantId: channel.merchantInternalId, channelOutTradeNo, amount: input.amount, description: input.description, paymentMethod: input.paymentMethod, collectionMode: input.collectionMode, paymentAppId: input.paymentMethod === "JSAPI" ? jsapiPaymentAppId : channel.appInternalId, paymentOpenid: input.paymentMethod === "JSAPI" ? jsapiOpenid : null, clientRequestNo: input.clientRequestNo, expireAt, routeRuleId: channel.routeRuleId, routeSnapshot: channel.routeSnapshot, routeSelectedAt: new Date().toISOString(), ...device });
    } catch (error) {
      const duplicate = findOrderByClientRequest(input.merchantId, input.clientRequestNo);
      if (duplicate) return res.json({ data: duplicate, idempotent: true });
      return res.status(409).json({ error: error instanceof Error ? error.message : "ORDER_CREATE_CONFLICT" });
    }
    order = getOrder(platformOrderNo);
    if (!order) return res.status(500).json({ error: "ORDER_CREATE_FAILED" });
    let quotaReserved = false;
    try {
      if (quotaMerchant) { reserveMerchantQuota(String(input.merchantId), order.id, Number(order.amount)); quotaReserved = true; }
      reserveRouteCapacity(order.id, channel);
      if (input.entryMode === "PUBLIC_ACCOUNT_ARTICLE") {
        if (input.paymentMethod !== "JSAPI") throw new Error("PUBLIC_ARTICLE_REQUIRES_JSAPI");
        const rawToken = crypto.randomBytes(32).toString("base64url");
        const pagePath = "/public-pay";
        const payUrl = `${publicBaseUrlForRequest(req)}/public-pay/${encodeURIComponent(rawToken)}`;
        if (!config.mockPayment && !payUrl.startsWith("https://")) throw new Error("PUBLIC_PAYMENT_URL_HTTPS_REQUIRED");
        const articleQrUrl = `${payUrl}?from_article=1`;
        let qrDataUrl = await QRCode.toDataURL(articleQrUrl, { width: 480, margin: 2 });
        const entry = createPublicPaymentEntry({ orderId: order.id, token: rawToken, tokenHash: crypto.createHash("sha256").update(rawToken, "utf8").digest("hex"), pagePath, qrDataUrl, expiresAt: String(order.expireAt) });
        const articleStartedAt = Date.now();
        recordPublicPaymentEvent({ orderId: order.id, entryId: entry.id, eventType: "ARTICLE_STARTED" });
        const appConfig = getWechatApp(jsapiPaymentAppId);
        const appSecret = appSecretConfigured(jsapiPaymentAppId) ? getAppSecret(jsapiPaymentAppId) : (config.mockPayment ? "mock-app-secret" : "");
        if (!appConfig || !appSecret) throw new Error("JSAPI_APP_SECRET_NOT_CONFIGURED");
        const article = await createPublicAccountArticle({ appId: String(appConfig.appid), appSecret, title: `订单支付-${order.platformOrderNo}`, description: input.description, amountYuan: (Number(order.amount) / 100).toFixed(2), payUrl, qrDataUrl, mock: config.mockPayment });
        upsertWechatArticleDraft({ orderId: order.id, entryId: entry.id, appId: jsapiPaymentAppId, draftMediaId: article.draftMediaId, previewUrl: article.previewUrl, qrMediaUrl: article.qrMediaUrl, coverMediaId: article.coverMediaId, status: "READY", expiresAt: order.expireAt });
        recordPublicPaymentEvent({ orderId: order.id, entryId: entry.id, eventType: "ARTICLE_READY", durationMs: Date.now() - articleStartedAt });
        recordPublicPaymentEvent({ orderId: order.id, entryId: entry.id, eventType: article.previewUrl ? "PREVIEW_READY" : "PREVIEW_UNAVAILABLE" });
        if (!article.previewUrl) recordPublicPaymentEvent({ orderId: order.id, entryId: entry.id, eventType: "FALLBACK_JSAPI", errorCode: "PREVIEW_URL_UNAVAILABLE" });
        if (article.previewUrl) {
          // External QR/wake entry points DIRECTLY at the temp preview page
          // (mp.weixin.qq.com article), so scanning opens the preview article
          // without any intermediate browser page.
          const previewLink = String(article.previewUrl).replace(/^http:\/\//i, "https://");
          const externalQrDataUrl = await QRCode.toDataURL(previewLink, { width: 480, margin: 2 });
          updatePublicPaymentEntry(entry.id, { qrDataUrl: externalQrDataUrl });
          qrDataUrl = externalQrDataUrl;
        }
        updateOrderPayment(order.id, { status: "QR_CREATED", qrDataUrl });
        insertPaymentAttempt(order.id, channel.id, "PUBLIC_ARTICLE_READY");
        createAuditLog({ action: "ORDER_CREATE_PUBLIC_ACCOUNT_ARTICLE", targetType: "order", targetId: order.platformOrderNo, detail: { channelId: channel.id, amount: order.amount, entryId: entry.id } });
        return res.status(201).json({ data: getOrder(order.id), provider: "PUBLIC_ACCOUNT_ARTICLE", entry: { payUrl, qrDataUrl, previewUrl: article.previewUrl, fallbackToJsapi: !article.previewUrl, draftMediaId: article.draftMediaId, expiresAt: order.expireAt } });
      }
      const qrCode = input.collectionMode === "QR" ? reserveQrCodeForOrder(channel.id, order.id, input.amount) : undefined;
      if (input.collectionMode === "QR" && qrCode) {
        const qrDataUrl = await QRCode.toDataURL(String(qrCode.payload), { width: 320, margin: 2 });
        updateOrderPayment(order.id, { status: "QR_CREATED", codeUrl: String(qrCode.payload), qrDataUrl });
        insertPaymentAttempt(order.id, channel.id, "QR_CODE_SUCCESS");
        createAuditLog({ action: "QR_CODE_ORDER_CREATE", targetType: "order", targetId: order.platformOrderNo, detail: { channelId: channel.id, qrCodeId: qrCode.id, amount: order.amount } });
        return res.status(201).json({ data: getOrder(order.id), provider: "QR_CODE", qrCodeId: qrCode.id });
      }
      if (input.collectionMode === "QR") {
        releaseRouteCapacity(order.id);
        if (quotaReserved) releaseMerchantQuota(order.id);
        db.prepare("DELETE FROM orders WHERE id = ?").run(order.id);
        lastRouteError = isQrChannelEnabled(channel.id) ? "QR_CODE_UNAVAILABLE" : "QR_MODE_DISABLED";
        if (input.channelId) { channel = undefined; order = undefined; break; }
        routeChannelIds = (routeChannelIds || []).filter((id) => id !== channel!.id);
        channel = undefined; order = undefined; continue;
      }
      break;
    } catch (error) {
      const failedOrder = order;
      const failedChannel = channel;
      if (!failedOrder || !failedChannel) break;
      const failureMessage = error instanceof Error ? error.message : "PUBLIC_ARTICLE_CREATE_FAILED";
      if (input.entryMode === "PUBLIC_ACCOUNT_ARTICLE") {
        const failedEntry = getPublicPaymentEntryByOrder(failedOrder.id);
        const failedToken = getPublicPaymentEntryToken(failedOrder.id);
        if (failedEntry) {
          upsertWechatArticleDraft({ orderId: failedOrder.id, entryId: failedEntry.id, appId: jsapiPaymentAppId || String(failedOrder.paymentAppId || ""), status: "FAILED", wechatErrmsg: failureMessage, expiresAt: failedOrder.expireAt });
          recordPublicPaymentEvent({ orderId: failedOrder.id, entryId: failedEntry.id, eventType: "ARTICLE_FAILED", errorCode: failureMessage });
          recordPublicPaymentEvent({ orderId: failedOrder.id, entryId: failedEntry.id, eventType: "FALLBACK_JSAPI", errorCode: failureMessage });
        }
        insertPaymentAttempt(failedOrder.id, failedChannel.id, "PUBLIC_ARTICLE_FAILED", failureMessage);
        if (failedEntry && failedToken) {
          try { updateOrderPayment(failedOrder.id, { status: "QR_CREATED", qrDataUrl: failedEntry.qrDataUrl ?? undefined }); } catch { /* keep the order payable through JSAPI */ }
          createAuditLog({ action: "PUBLIC_ARTICLE_FALLBACK_JSAPI", targetType: "order", targetId: failedOrder.platformOrderNo, detail: { channelId: failedChannel.id, reason: failureMessage } });
          return res.status(201).json({ data: getOrder(failedOrder.id), provider: "PUBLIC_ACCOUNT_ARTICLE_FALLBACK", entry: { payUrl: `${publicBaseUrlForRequest(req)}/public-pay/${encodeURIComponent(failedToken)}`, qrDataUrl: failedEntry.qrDataUrl, previewUrl: null, fallbackToJsapi: true, expiresAt: failedOrder.expireAt } });
        }
        if (quotaReserved) releaseMerchantQuota(failedOrder.id);
        try { updateOrderPayment(failedOrder.id, { status: "FAILED" }); } catch { /* preserve the original failure */ }
        return res.status(502).json({ error: "PUBLIC_ARTICLE_CREATE_FAILED", message: failureMessage, order: getOrder(failedOrder.id) });
      }
      if (quotaReserved) releaseMerchantQuota(failedOrder.id);
      try { releaseRouteCapacity(failedOrder.id); } catch { /* capacity may not have been reserved */ }
      db.prepare("DELETE FROM orders WHERE id = ?").run(failedOrder.id);
      lastRouteError = failureMessage;
      const retryable = lastRouteError.includes("CONCURRENCY") || lastRouteError.includes("LIMIT");
      if (retryable) {
        excludedTargetKeys.add(`${failedChannel.id}:${failedChannel.platformMerchantId ?? ""}:${failedChannel.merchantInternalId ?? ""}`);
        channel = undefined; order = undefined; continue;
      }
      break;
    }
  }
  if (!channel || !order) {
    const statusCode = lastRouteError === "PUBLIC_CALLBACK_URL_REQUIRED" ? 503 : lastRouteError.includes("CONCURRENCY") || lastRouteError.includes("LIMIT") ? 429 : 409;
    return res.status(statusCode).json({ error: lastRouteError });
  }
  let providerError = "PAYMENT_PROVIDER_ERROR";
  for (let providerAttempt = 0; providerAttempt < 3; providerAttempt += 1) {
    const provider = config.mockPayment ? new MockPaymentProvider() : new WechatNativeProvider();
    const nativeRequest: NativeOrderRequest = {
      appId: channel.appId,
      mchId: channel.mchId,
      description: input.description,
      outTradeNo: channelOutTradeNo,
      amount: input.amount,
      notifyUrl: nativeNotifyUrl,
      attach: platformOrderNo,
      credentialRef: channel.credentialRef,
      clientIp: String(req.ip || req.socket.remoteAddress || "127.0.0.1").replace(/^::ffff:/, "")
    };
    try {
      if (input.paymentMethod === "JSAPI") {
        const jsapiRequest: JsapiOrderRequest = { ...nativeRequest, appId: jsapiProviderAppId, openid: jsapiOpenid };
        const result = await provider.createJsapiOrder(jsapiRequest);
        updateOrderPayment(order.id, { status: "PAYING" });
        insertPaymentAttempt(order.id, channel.id, "SUCCESS");
        recordChannelHealth(channel.id, { success: true, failureThreshold: config.channelFailureThreshold });
        createAuditLog({ action: "ORDER_CREATE_JSAPI", targetType: "order", targetId: order.platformOrderNo, detail: { channelId: channel.id, amount: order.amount, providerAttempt } });
        return res.status(201).json({ data: getOrder(order.id), provider: result.provider, payment: result.payParams });
      }
      const result = await provider.createNativeOrder(nativeRequest);
      const qrDataUrl = await QRCode.toDataURL(result.codeUrl, { width: 320, margin: 2 });
      updateOrderPayment(order.id, { status: "QR_CREATED", codeUrl: result.codeUrl, qrDataUrl });
      insertPaymentAttempt(order.id, channel.id, "SUCCESS");
      recordChannelHealth(channel.id, { success: true, failureThreshold: config.channelFailureThreshold });
      createAuditLog({ action: "ORDER_CREATE", targetType: "order", targetId: order.platformOrderNo, detail: { channelId: channel.id, amount: order.amount, providerAttempt } });
      return res.status(201).json({ data: getOrder(order.id), provider: result.provider });
    } catch (error) {
      providerError = error instanceof Error ? error.message : "CREATE_FAILED";
      insertPaymentAttempt(order.id, channel.id, "FAILED", providerError);
      recordChannelHealth(channel.id, { success: false, error: providerError, failureThreshold: config.channelFailureThreshold });
      monitorMerchantFromProviderError(channel, providerError);
      if (input.paymentMethod === "JSAPI") break;
      if (providerAttempt >= 2) break;
      const failedChannelId = channel.id;
      excludedTargetKeys.add(`${channel.id}:${channel.platformMerchantId ?? ""}:${channel.merchantInternalId ?? ""}`);
      try {
        const fallback = chooseRoutedPaymentTarget(input.amount, routeChannelIds, input.clientMerchantId, input.merchantId, excludedTargetKeys, input.paymentMethod);
        const fallbackRisk = checkChannelOrderRisk(fallback.id, { amount: input.amount, deviceIp: device.deviceIp, userId: device.userId, deviceCountry: device.deviceCountry, deviceProvince: device.deviceProvince, deviceCity: device.deviceCity });
        if (!fallbackRisk.allowed) { routeChannelIds = (routeChannelIds || []).filter((id) => id !== fallback.id); throw new Error(fallbackRisk.reason || "CHANNEL_RISK_BLOCKED"); }
        const fallbackOutTradeNo = newTradeNo(fallback.id);
        reassignOrderRoute(order.id, fallback, fallbackOutTradeNo);
        reserveRouteCapacity(order.id, fallback);
        channel = fallback;
        channelOutTradeNo = fallbackOutTradeNo;
        order = getOrder(order.id)!;
        createAuditLog({ action: "ORDER_ROUTE_FALLBACK", targetType: "order", targetId: order.platformOrderNo, detail: { fromChannelId: failedChannelId, toChannelId: fallback.id, providerAttempt: providerAttempt + 1 } });
      } catch (fallbackError) {
        providerError = fallbackError instanceof Error ? fallbackError.message : providerError;
        break;
      }
    }
  }
  updateOrderPayment(order.id, { status: "FAILED" });
  return res.status(502).json({ error: "PAYMENT_PROVIDER_ERROR", message: providerError, order: getOrder(order.id) });
});

app.get("/api/v1/orders/:id", rateLimit({ windowMs: 60_000, max: 120, key: (req) => `${req.ip}:order-status:${req.params.id}` }), (req, res) => {
  const order = getOrder(String(req.params.id));
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  const merchantRequest = verifyMerchantRequest(req);
  if (merchantRequest.error) return res.status(401).json({ error: merchantRequest.error });
  if (config.merchantApiAuthEnabled || config.merchantSignatureRequired) {
    if (!merchantRequest.merchant) return res.status(401).json({ error: "MERCHANT_AUTH_REQUIRED" });
    if (String(merchantRequest.merchant.id) !== String(order.merchantId)) return res.status(403).json({ error: "ORDER_ACCESS_DENIED" });
    return res.json({ data: order });
  }
  return res.json({ data: publicOrder(order) });
});

app.post("/api/v1/orders/:id/simulate-paid", (req, res) => {
  if (!config.mockPayment || config.nodeEnv === "production") return res.status(404).json({ error: "NOT_AVAILABLE" });
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  const merchantRequest = verifyMerchantRequest(req);
  if (merchantRequest.error) return res.status(401).json({ error: merchantRequest.error });
  if ((config.merchantApiAuthEnabled || config.merchantSignatureRequired) && String(merchantRequest.merchant?.id) !== String(order.merchantId)) return res.status(403).json({ error: "ORDER_ACCESS_DENIED" });
  if (order.status === "SUCCESS") return res.json({ data: order, idempotent: true });
  updateOrderPayment(order.id, { status: "SUCCESS", transactionId: `mock_tx_${Date.now()}` });
  const entry = getPublicPaymentEntryByOrder(order.id);
  if (entry) updatePublicPaymentEntry(entry.id, { status: "PAID", usedAt: new Date().toISOString() });
  return res.json({ data: getOrder(order.id) });
});

app.post("/api/v1/orders/:id/query", requireAdmin, async (req, res) => {
  const order = getOrder(String(req.params.id));
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  const channel = resolveChannelMerchant(order.channelId, order.wechatMerchantId);
  if (!channel) return res.status(409).json({ error: "CHANNEL_NOT_FOUND" });
  if (config.mockPayment) { insertPaymentAttempt(order.id, channel.id, "QUERY", order.status); createAuditLog({ action: "ORDER_QUERY", targetType: "order", targetId: order.platformOrderNo, detail: { channelId: channel.id, provider: "mock" } }); return res.json({ data: order, provider: "mock" }); }
  try {
    const provider = new WechatNativeProvider();
    const result = await provider.queryOrder({ mchId: channel.mchId, appId: String(channel.appId), outTradeNo: order.channelOutTradeNo, credentialRef: channel.credentialRef });
    insertPaymentAttempt(order.id, channel.id, "QUERY", result.tradeState);
    if (result.tradeState === "SUCCESS") updateOrderPayment(order.id, { status: "SUCCESS", transactionId: result.transactionId });
    if (result.tradeState === "CLOSED") updateOrderPayment(order.id, { status: "CLOSED" });
    createAuditLog({ action: "ORDER_QUERY", targetType: "order", targetId: order.platformOrderNo, detail: { channelId: channel.id, provider: "wechatpay", tradeState: result.tradeState } });
    return res.json({ data: getOrder(order.id), provider: "wechatpay", tradeState: result.tradeState });
  } catch (error) {
    const message = error instanceof Error ? error.message : "QUERY_FAILED";
    monitorMerchantFromProviderError(channel, message);
    insertPaymentAttempt(order.id, channel.id, "QUERY_FAILED", message);
    createAuditLog({ action: "ORDER_QUERY_FAILED", targetType: "order", targetId: order.platformOrderNo, detail: { channelId: channel.id } });
    return res.status(502).json({ error: "QUERY_FAILED", message });
  }
});

app.post("/api/v1/orders/:id/close", requireAdmin, async (req, res) => {
  const order = getOrder(String(req.params.id));
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  const channel = resolveChannelMerchant(order.channelId, order.wechatMerchantId);
  if (!channel) return res.status(409).json({ error: "CHANNEL_NOT_FOUND" });
  try {
    if (!config.mockPayment) {
      const provider = new WechatNativeProvider();
      await provider.closeOrder({ mchId: channel.mchId, appId: String(channel.appId), outTradeNo: order.channelOutTradeNo, credentialRef: channel.credentialRef });
    }
    closeOrder(order.id);
    createAuditLog({ action: "ORDER_CLOSE", targetType: "order", targetId: order.platformOrderNo, detail: { channelId: channel.id } });
    return res.json({ data: getOrder(order.id) });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "CLOSE_FAILED" });
  }
});

const refundSchema = z.object({
  amount: z.number().int().positive().optional(),
  reason: z.string().min(1).max(80).default("用户申请退款"),
  refundNo: z.string().regex(/^[a-zA-Z0-9_-]{2,64}$/).optional()
});

app.post("/api/v1/orders/:id/refunds", requireAdmin, async (req, res) => {
  const parsed = refundSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_REFUND", details: parsed.error.flatten() });
  const order = getOrder(String(req.params.id));
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  const requestedRefundNo = parsed.data.refundNo ?? String(req.headers["x-idempotency-key"] ?? "");
  if (requestedRefundNo && !/^[a-zA-Z0-9_-]{2,64}$/.test(requestedRefundNo)) return res.status(400).json({ error: "INVALID_REFUND_IDEMPOTENCY_KEY" });
  if (requestedRefundNo) {
    const existingRefund = getRefund(requestedRefundNo);
    if (existingRefund) {
      if (String(existingRefund.orderId) !== String(order.id)) return res.status(409).json({ error: "REFUND_IDEMPOTENCY_CONFLICT" });
      return res.json({ data: existingRefund, idempotent: true });
    }
  }
  if (order.status !== "SUCCESS") return res.status(409).json({ error: "ORDER_NOT_PAID" });
  const amount = parsed.data.amount ?? order.amount;
  if (getRefundedAmount(order.id) + amount > order.amount) return res.status(409).json({ error: "REFUND_AMOUNT_EXCEEDED" });
  const channel = resolveChannelMerchant(order.channelId, order.wechatMerchantId);
  if (!channel) return res.status(409).json({ error: "CHANNEL_NOT_FOUND" });
  const refundNo = requestedRefundNo || `R${Date.now()}${randomId("r").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)}`.slice(0, 32);
  try {
    // 先落库退款意图并占住退款额度，再调用微信，避免并发请求在外部接口侧重复扣款。
    try {
      insertRefund({ orderId: order.id, refundNo, amount, reason: parsed.data.reason, status: "PROCESSING", approvalStatus: "APPROVED", requestedBy: (req as Request & { adminUser?: { username?: string } }).adminUser?.username ?? "admin" });
    } catch (insertError) {
      const existingRefund = getRefund(refundNo);
      if (existingRefund && String(existingRefund.orderId) === String(order.id)) return res.json({ data: existingRefund, idempotent: true });
      throw insertError;
    }
    let providerStatus = "PROCESSING";
    let providerRefundId: string | undefined;
    if (!config.mockPayment) {
      const provider = new WechatNativeProvider();
      const result = await provider.refund({ mchId: channel.mchId, outTradeNo: order.channelOutTradeNo, outRefundNo: refundNo, refundAmount: amount, totalAmount: order.amount, reason: parsed.data.reason, notifyUrl: `${publicBaseUrlForRequest(req)}${channel.notifyPath}/${encodeURIComponent(channel.mchId)}/refund`, credentialRef: channel.credentialRef });
      providerStatus = result.status;
      providerRefundId = result.refundId;
    } else {
      const provider = new MockPaymentProvider();
      const result = await provider.refund({ mchId: channel.mchId, outTradeNo: order.channelOutTradeNo, outRefundNo: refundNo, refundAmount: amount, totalAmount: order.amount, reason: parsed.data.reason, notifyUrl: `${publicBaseUrlForRequest(req)}${channel.notifyPath}/${encodeURIComponent(channel.mchId)}/refund`, credentialRef: channel.credentialRef });
      providerStatus = result.status;
      providerRefundId = result.refundId;
    }
    const refund = updateRefundStatus(refundNo, providerStatus, providerRefundId);
    if (!refund) throw new Error("REFUND_NOT_FOUND");
    createAuditLog({ action: "REFUND_CREATE", targetType: "refund", targetId: refundNo, detail: { platformOrderNo: order.platformOrderNo, amount, status: providerStatus } });
    return res.status(201).json({ data: refund });
  } catch (error) {
    const message = error instanceof Error ? error.message : "refund failed";
    monitorMerchantFromProviderError(channel, message);
    if (["REFUND_AMOUNT_EXCEEDED", "REFUND_AMOUNT_INVALID", "ORDER_NOT_PAID", "ORDER_NOT_FOUND"].includes(message)) return res.status(409).json({ error: message });
    return res.status(502).json({ error: "REFUND_FAILED", message });
  }
});

app.post("/api/v1/admin/refunds/:refundNo/approve", async (req: Request & { adminUser?: { username?: string } }, res) => {
  const refund = getRefund(String(req.params.refundNo));
  if (!refund) return res.status(404).json({ error: "REFUND_NOT_FOUND" });
  if (refund.approvalStatus !== "PENDING") return res.status(409).json({ error: "REFUND_ALREADY_REVIEWED" });
  const reviewer = req.adminUser?.username ?? "admin";
  if (!claimRefundApproval(String(refund.refundNo), reviewer)) return res.status(409).json({ error: "REFUND_ALREADY_REVIEWED" });
  const order = getOrder(String(refund.orderId)); const channel = order ? resolveChannelMerchant(order.channelId, order.wechatMerchantId) : undefined;
  if (!order || !channel) return res.status(409).json({ error: "REFUND_CONTEXT_NOT_FOUND" });
  try {
    const provider = config.mockPayment ? new MockPaymentProvider() : new WechatNativeProvider();
    const result = await provider.refund({ mchId: channel.mchId, outTradeNo: order.channelOutTradeNo, outRefundNo: String(refund.refundNo), refundAmount: Number(refund.refundAmount), totalAmount: order.amount, reason: String(refund.reason), notifyUrl: `${publicBaseUrlForRequest(req)}${channel.notifyPath}/${encodeURIComponent(channel.mchId)}/refund`, credentialRef: channel.credentialRef });
    const approval = updateRefundApproval(String(refund.refundNo), "APPROVED", reviewer);
    if (!approval || approval.approvalStatus !== "APPROVED") return res.status(409).json({ error: "REFUND_ALREADY_REVIEWED" });
    const updated = updateRefundStatus(String(refund.refundNo), result.status, result.refundId);
    createAuditLog({ action: "REFUND_APPROVE", operator: req.adminUser?.username ?? "admin", targetType: "refund", targetId: String(refund.refundNo), detail: { status: result.status, providerRefundId: result.refundId } });
    return res.json({ data: updated });
  } catch (error) { const message = error instanceof Error ? error.message : "refund provider failed"; monitorMerchantFromProviderError(channel, message); restoreRefundApproval(String(refund.refundNo)); return res.status(502).json({ error: "REFUND_PROVIDER_FAILED", message }); }
});
app.post("/api/v1/admin/refunds/:refundNo/reject", (req: Request & { adminUser?: { username?: string } }, res) => {
  const parsed = z.object({ reason: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "REFUND_REJECT_REASON_REQUIRED" });
  const refund = getRefund(String(req.params.refundNo));
  if (!refund) return res.status(404).json({ error: "REFUND_NOT_FOUND" });
  if (refund.approvalStatus !== "PENDING") return res.status(409).json({ error: "REFUND_ALREADY_REVIEWED" });
  const reviewer = req.adminUser?.username ?? "admin";
  if (!claimRefundApproval(String(refund.refundNo), reviewer)) return res.status(409).json({ error: "REFUND_ALREADY_REVIEWED" });
  const updated = updateRefundApproval(String(refund.refundNo), "REJECTED", reviewer, parsed.data.reason);
  if (!updated || updated.approvalStatus !== "REJECTED") return res.status(409).json({ error: "REFUND_ALREADY_REVIEWED" });
  createAuditLog({ action: "REFUND_REJECT", operator: req.adminUser?.username ?? "admin", targetType: "refund", targetId: String(refund.refundNo), detail: { reason: parsed.data.reason } });
  return res.json({ data: updated });
});

app.post("/api/v1/merchant/orders/:id/refunds", rateLimit({ windowMs: 60_000, max: 60, key: (req) => `${req.ip}:${String(req.headers["x-merchant-code"] ?? "merchant")}` }), requireMerchantRole("OWNER", "FINANCE"), async (req: MerchantRequest, res) => {
  const parsed = refundSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_REFUND", details: parsed.error.flatten() });
  const order = getOrder(String(req.params.id));
  if (!order || String(order.merchantId) !== String(req.merchant!.id)) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  const requestedRefundNo = parsed.data.refundNo ?? String(req.headers["x-idempotency-key"] ?? "");
  if (requestedRefundNo && !/^[a-zA-Z0-9_-]{2,64}$/.test(requestedRefundNo)) return res.status(400).json({ error: "INVALID_REFUND_IDEMPOTENCY_KEY" });
  if (requestedRefundNo) {
    const existing = getRefund(requestedRefundNo);
    if (existing) return String(existing.orderId) === String(order.id) ? res.json({ data: existing, idempotent: true }) : res.status(409).json({ error: "REFUND_IDEMPOTENCY_CONFLICT" });
  }
  if (order.status !== "SUCCESS") return res.status(409).json({ error: "ORDER_NOT_PAID" });
  const amount = parsed.data.amount ?? order.amount;
  if (getRefundedAmount(order.id) + amount > order.amount) return res.status(409).json({ error: "REFUND_AMOUNT_EXCEEDED" });
  const refundNo = requestedRefundNo || `R${Date.now()}${randomId("r").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)}`.slice(0, 32);
  try {
    const refund = insertRefund({ orderId: order.id, refundNo, amount, reason: parsed.data.reason, status: "PENDING", approvalStatus: "PENDING", requestedBy: String(req.merchant!.code) });
    createAuditLog({ action: "MERCHANT_REFUND_REQUEST", operator: String(req.merchant!.code), targetType: "refund", targetId: refundNo, detail: { platformOrderNo: order.platformOrderNo, amount, status: "PENDING" } });
    return res.status(202).json({ data: refund, message: "退款申请已提交，等待平台审核" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "refund failed";
    if (["REFUND_AMOUNT_EXCEEDED", "REFUND_AMOUNT_INVALID", "ORDER_NOT_PAID", "ORDER_NOT_FOUND"].includes(message)) return res.status(409).json({ error: message });
    return res.status(502).json({ error: "REFUND_FAILED", message });
  }
});

app.get("*", (_req, res) => res.sendFile(path.resolve("public/index.html")));

let botLastHealth = new Map<string, string>();
let botLastCallbackAlert = 0;
let botLastComplaintAlert = new Map<string, number>();
let botLastReportDate = "";
async function runBotNotificationPass(): Promise<void> {
  const settings = getBotSettings();
  if (!settings.enabled || !settings.configured) return;
  const notify = settings.notificationSettings as Record<string, unknown>;
  const thresholds = settings.thresholds as Record<string, unknown>;
  const monitoring = getMonitoring();
  for (const channel of monitoring) {
    const key = String(channel.channelId); const state = String(channel.circuitState); const previous = botLastHealth.get(key); botLastHealth.set(key, state);
    if (notify.channelCircuit && state === "OPEN" && previous !== "OPEN") await broadcastTelegram(`通道告警：${key}\n通道已熔断，连续失败 ${channel.consecutiveFailures} 次。\n最近错误：${channel.lastError || "暂无"}`, "CHANNEL_CIRCUIT", String(settings.adminGroupId || ""), [], key);
    const failureThreshold = Number(thresholds.channelFailureCount || 0);
    if (notify.channelFailure && failureThreshold > 0 && Number(channel.consecutiveFailures) >= failureThreshold && previous !== `FAIL:${channel.consecutiveFailures}`) { botLastHealth.set(key, `FAIL:${channel.consecutiveFailures}`); await broadcastTelegram(`通道告警：${key}\n连续失败已达到 ${channel.consecutiveFailures} 次，请检查通道配置。`, "CHANNEL_FAILURE", String(settings.adminGroupId || ""), [], key); }
  }
  const callbacks = listCallbackTasks(500); const pending = callbacks.filter((item) => ["PENDING", "RETRYING", "DEAD"].includes(String(item.status))).length; const callbackThreshold = Number(thresholds.callbackFailureCount || 0);
  if (notify.callbackFailure && callbackThreshold > 0 && pending >= callbackThreshold && pending !== botLastCallbackAlert) { botLastCallbackAlert = pending; await broadcastTelegram(`回调告警：当前有 ${pending} 条回调任务待处理或失败，请及时处理。`, "CALLBACK_FAILURE", String(settings.adminGroupId || "")); }
  const complaintThreshold = Number(thresholds.complaintCount || 0);
  if (notify.complaint && complaintThreshold > 0) for (const merchant of listMerchants() as Array<Record<string, any>>) { const count = Number(merchant.complaintCount || 0); const id = String(merchant.id); if (count >= complaintThreshold && botLastComplaintAlert.get(id) !== count) { botLastComplaintAlert.set(id, count); await broadcastTelegram(`投诉告警：商户号 ${merchant.mchid || id}\n当前投诉数量 ${count}，已达到阈值 ${complaintThreshold}。`, "COMPLAINT", String(settings.adminGroupId || ""), [], undefined, id); } }
  if (notify.dailyReport && settings.reportEnabled && settings.reportTime === new Date().toTimeString().slice(0, 5) && botLastReportDate !== new Date().toISOString().slice(0, 10)) { botLastReportDate = new Date().toISOString().slice(0, 10); const overview = getOverview(); await broadcastTelegram(`每日对账简报\n订单：${overview.orders}\n成功：${overview.successOrders}\n待处理：${overview.pendingOrders}\n退款：${overview.refunds}`, "DAILY_REPORT", String(settings.adminGroupId || "")); }
}

const httpServer = app.listen(config.port, () => {
  console.log(`Wechat multi-channel pay listening on http://localhost:${config.port}`);
  console.log(`Payment mode: ${config.mockPayment ? "MOCK" : "WECHAT APIv2 Native"}`);
  console.log(`Admin auth: ${config.adminAuthEnabled ? "ENABLED" : "DISABLED"}`);
  console.log(`Reconciliation scheduler: ${config.reconciliationEnabled ? `ENABLED (${config.reconciliationIntervalMinutes}m)` : "DISABLED"}`);
  console.log(`Settlement scheduler: ${config.settlementAutoEnabled ? `ENABLED (${config.settlementAutoIntervalMinutes}m)` : "DISABLED"}`);
  console.log(`Payment recovery: ${config.paymentRecoveryEnabled ? `ENABLED (${config.paymentRecoveryIntervalMinutes}m)` : "DISABLED"}`);
  console.log(`Callback retry: ${config.callbackRetryEnabled ? `ENABLED (${config.callbackRetryIntervalMinutes}m)` : "DISABLED"}`);
  console.log(`Merchant webhooks: ${config.merchantWebhookEnabled ? `ENABLED (${config.merchantWebhookIntervalMinutes}m)` : "DISABLED"}`);
  startReconciliationScheduler();
  startSettlementScheduler();
  startPaymentRecoveryScheduler();
  startRefundRecoveryScheduler();
  startCallbackRetryScheduler();
  startMerchantWebhookScheduler();
  const botTimer = setInterval(() => { void runBotNotificationPass().catch((error) => console.error("BOT notification failed", error)); }, 60_000);
  botTimer.unref();
  const qrMonitorTimer = setInterval(() => { try { runQrMonitorPass(); } catch (error) { console.error("QR monitor failed", error); } }, 60_000);
  qrMonitorTimer.unref();
  const publicPaymentExpiryTimer = setInterval(() => { try { expirePublicPaymentEntries(); } catch (error) { console.error("Public payment expiry failed", error); } }, 60_000);
  publicPaymentExpiryTimer.unref();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    httpServer.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}






