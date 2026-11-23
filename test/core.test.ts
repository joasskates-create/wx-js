import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dbPath = path.resolve("data", `vitest-core-${process.pid}.db`);
process.env.DB_PATH = dbPath;
process.env.MOCK_PAYMENT = "true";

const store = await import("../src/db.ts");
const webhook = await import("../src/payment/webhook-service.ts");

describe("core payment data flows", () => {
  const ids = {
    subject: `test-subject-${process.pid}`,
    app: `test-app-${process.pid}`,
    merchant: `test-mch-${process.pid}`,
    channel: `test-channel-${process.pid}`,
    platformMerchant: `test-partner-${process.pid}`
  };

  beforeAll(() => {
    store.createSubject({ id: ids.subject, name: "测试主体", subjectType: "INDIVIDUAL_BUSINESS" });
    store.createApp({ id: ids.app, subjectId: ids.subject, appid: `wx_test_${process.pid}`, appType: "SERVICE_ACCOUNT" });
    store.createMerchant({ id: ids.merchant, subjectId: ids.subject, mchid: `mch_${process.pid}`, credentialRef: "mock" });
    store.createConfiguredChannel({ id: ids.channel, subjectId: ids.subject, appId: ids.app, merchantId: ids.merchant, routeWeight: 100 });
  });

  it("keeps app and merchant under the same subject", () => {
    expect(() => store.createConfiguredChannel({ id: `bad-${process.pid}`, subjectId: "missing", appId: ids.app, merchantId: ids.merchant, routeWeight: 100 })).toThrow("APP_MERCHANT_SUBJECT_MISMATCH");
  });

  it("calculates settlement and protects status transitions", () => {
    const partner = store.createPlatformMerchant({ id: ids.platformMerchant, code: ids.platformMerchant, name: "测试码商", settlementRate: 2 });
    expect(store.setMerchantChannels(ids.platformMerchant, [ids.channel]).map((item) => item.id)).toEqual([ids.channel]);
    expect(store.getPlatformMerchantDetail(ids.platformMerchant)?.channelCount).toBe(1);
    expect(store.getPlatformMerchantDetail(ids.platformMerchant)?.channels).toHaveLength(1);
    expect(store.listMerchantChannelSettings(ids.platformMerchant)[0].enabled).toBe(1);
    expect(store.updateMerchantChannelSetting(ids.platformMerchant, ids.channel, { enabled: false, routeWeight: 250 })?.routeWeight).toBe(250);
    expect(() => store.chooseChannel(100, [ids.channel], ids.platformMerchant)).toThrow("NO_ACTIVE_CHANNEL");
    expect(store.updateMerchantChannelSetting(ids.platformMerchant, ids.channel, { enabled: true, routeWeight: 250 })?.enabled).toBe(1);
    store.insertOrder({ merchantId: ids.platformMerchant, platformOrderNo: `P-${process.pid}`, channelId: ids.channel, channelOutTradeNo: `T-${process.pid}`, amount: 10000, description: "测试订单", clientRequestNo: `C-${process.pid}`, expireAt: new Date(Date.now() + 60_000).toISOString() });
    const order = store.getOrder(`P-${process.pid}`)!;
    store.updateOrderPayment(order.id, { status: "SUCCESS", transactionId: "TX-TEST" });
    const subMerchantStats = store.getMerchantSubMerchantStats(ids.platformMerchant);
    expect(subMerchantStats).toHaveLength(1);
    expect(subMerchantStats[0].mchId).toBe(`mch_${process.pid}`);
    expect(subMerchantStats[0].successAmount).toBe(10000);
    expect(subMerchantStats[0].todaySuccessRate).toBe(100);
    const subMerchantOrders = store.listMerchantSubMerchantOrders(ids.platformMerchant, ids.merchant, { pageSize: 10 });
    expect(subMerchantOrders?.items).toHaveLength(1);
    expect(subMerchantOrders?.items[0].platformOrderNo).toBe(`P-${process.pid}`);
    expect(store.getMerchantChannelStats(ids.platformMerchant)[0].todaySuccessAmount).toBe(10000);
    const report = store.getSettlementReport({ dateFrom: "2000-01-01T00:00:00.000Z", dateTo: "2999-01-01T00:00:00.000Z", platformMerchantId: ids.platformMerchant });
    expect(report[0].grossAmount).toBe(10000);
    expect(report[0].feeAmount).toBe(200);
    const statement = store.createSettlementStatement({ merchantId: ids.platformMerchant, dateFrom: "2000-01-01T00:00:00.000Z", dateTo: "2999-01-01T00:00:00.000Z" });
    expect(statement.status).toBe("DRAFT");
    expect(store.updateSettlementStatementStatus(String(statement.id), "CONFIRMED")?.status).toBe("CONFIRMED");
    expect(() => store.updateSettlementStatementStatus(String(statement.id), "DRAFT")).toThrow("SETTLEMENT_STATUS_TRANSITION_INVALID");
    expect(partner.apiKey).toMatch(/^cm_/);
  });

  it("records channel circuit state after failures", () => {
    store.recordChannelHealth(ids.channel, { success: false, error: "test", failureThreshold: 2 });
    const health = store.recordChannelHealth(ids.channel, { success: false, error: "test", failureThreshold: 2 });
    expect(health.circuitState).toBe("OPEN");
    store.resetChannelCircuit(ids.channel);
  });

  it("rejects invalid order status transitions", () => {
    const orderNo = `P-transition-${process.pid}`;
    store.insertOrder({ merchantId: ids.platformMerchant, platformOrderNo: orderNo, channelId: ids.channel, channelOutTradeNo: `T-transition-${process.pid}`, amount: 100, description: "transition", clientRequestNo: `C-transition-${process.pid}`, expireAt: new Date(Date.now() + 60_000).toISOString() });
    const order = store.getOrder(orderNo)!;
    store.updateOrderPayment(order.id, { status: "SUCCESS", transactionId: "TX-TRANSITION" });
    expect(() => store.updateOrderPayment(order.id, { status: "CLOSED" })).toThrow("ORDER_STATUS_TRANSITION_INVALID");
  });

  it("matches and revokes scoped member blocks", () => {
    const block = store.createMemberBlock({
      scopeType: "PLATFORM_MERCHANT",
      scopeId: ids.platformMerchant,
      reason: "测试风控命中",
      createdBy: "vitest",
      keys: [{ keyType: "MEMBER_ID", value: "member-core-test" }, { keyType: "IP", value: "203.0.113.8" }]
    });
    const match = store.findActiveMemberBlock({ platformMerchantId: ids.platformMerchant, channelId: ids.channel, keys: [{ keyType: "IP", value: "203.0.113.8" }] });
    expect(match?.block.id).toBe(block.id);
    expect(match?.keyType).toBe("IP");
    expect(store.revokeMemberBlock(String(block.id), "vitest", "测试解封")?.status).toBe("REVOKED");
    expect(store.findActiveMemberBlock({ platformMerchantId: ids.platformMerchant, channelId: ids.channel, keys: [{ keyType: "MEMBER_ID", value: "member-core-test" }] })).toBeUndefined();
  });

  it("closes the refund recovery loop", () => {
    const orderNo = `P-refund-${process.pid}`;
    store.insertOrder({ merchantId: ids.platformMerchant, platformOrderNo: orderNo, channelId: ids.channel, channelOutTradeNo: `T-refund-${process.pid}`, amount: 200, description: "refund", clientRequestNo: `C-refund-${process.pid}`, expireAt: new Date(Date.now() + 60_000).toISOString() });
    const order = store.getOrder(orderNo)!;
    store.updateOrderPayment(order.id, { status: "SUCCESS", transactionId: "TX-REFUND" });
    store.insertRefund({ orderId: order.id, refundNo: `R-refund-${process.pid}`, amount: 100, reason: "test", status: "PROCESSING" });
    expect(store.updateRefundStatus(`R-refund-${process.pid}`, "SUCCESS")?.status).toBe("SUCCESS");
    expect(store.getRefundedAmount(order.id)).toBe(100);
    expect(() => store.insertRefund({ orderId: order.id, refundNo: `R-refund-over-${process.pid}`, amount: 101, reason: "over", status: "PROCESSING" })).toThrow("REFUND_AMOUNT_EXCEEDED");
    expect(() => store.updateRefundStatus(`R-refund-${process.pid}`, "PROCESSING")).toThrow("REFUND_STATUS_TRANSITION_INVALID");
  });

  it("handles refund callbacks idempotently", () => {
    const orderNo = `P-callback-refund-${process.pid}`;
    store.insertOrder({ merchantId: ids.platformMerchant, platformOrderNo: orderNo, channelId: ids.channel, channelOutTradeNo: `T-callback-refund-${process.pid}`, amount: 200, description: "refund callback", clientRequestNo: `C-callback-refund-${process.pid}`, expireAt: new Date(Date.now() + 60_000).toISOString() });
    const order = store.getOrder(orderNo)!;
    store.updateOrderPayment(order.id, { status: "SUCCESS", transactionId: "TX-CALLBACK-REFUND" });
    store.insertRefund({ orderId: order.id, refundNo: `R-callback-${process.pid}`, amount: 100, reason: "test", status: "PROCESSING" });
    const payload = Buffer.from(JSON.stringify({ id: `refund-event-${process.pid}`, out_refund_no: `R-callback-${process.pid}`, refund_status: "SUCCESS", refund_id: "mock-refund-id" }));
    expect(webhook.processRefundWebhookPayload(ids.channel, payload, {}).duplicate).toBe(false);
    expect(webhook.processRefundWebhookPayload(ids.channel, payload, {}).duplicate).toBe(true);
    expect(store.getRefund(`R-callback-${process.pid}`)?.status).toBe("SUCCESS");
  });

  it("requires platform approval before a merchant refund becomes recoverable", () => {
    const orderNo = `P-approval-${process.pid}`;
    store.insertOrder({ merchantId: ids.platformMerchant, platformOrderNo: orderNo, channelId: ids.channel, channelOutTradeNo: `T-approval-${process.pid}`, amount: 300, description: "approval", clientRequestNo: `C-approval-${process.pid}`, expireAt: new Date(Date.now() + 60_000).toISOString() });
    const order = store.getOrder(orderNo)!;
    store.updateOrderPayment(order.id, { status: "SUCCESS", transactionId: "TX-APPROVAL" });
    const refundNo = `R-approval-${process.pid}`;
    store.insertRefund({ orderId: order.id, refundNo, amount: 100, reason: "merchant request", status: "PENDING", approvalStatus: "PENDING", requestedBy: "partner" });
    expect(store.listRecoverableRefunds().some((item) => item.refundNo === refundNo)).toBe(false);
    expect(store.updateRefundApproval(refundNo, "APPROVED", "admin")?.approvalStatus).toBe("APPROVED");
    expect(store.listRecoverableRefunds().some((item) => item.refundNo === refundNo)).toBe(true);
    expect(store.updateRefundApproval(refundNo, "REJECTED", "admin", "资料不全")?.status).toBe("ABNORMAL");
  });

  it("enforces merchant order risk limits", () => {
    const limitedId = `limited-${process.pid}`;
    store.createPlatformMerchant({ id: limitedId, code: limitedId, name: "限额码商", maxOrderAmount: 500, dailyAmountLimit: 800, dailyOrderLimit: 2 });
    expect(store.checkMerchantOrderRisk(limitedId, 501).reason).toBe("ORDER_AMOUNT_LIMIT_EXCEEDED");
    expect(store.checkMerchantOrderRisk(limitedId, 400).allowed).toBe(true);
  });

  it("enforces channel risk policy with region, IP and user limits", () => {
    store.updateChannelRiskPolicy(ids.channel, { singleIpPaymentLimit: 1, userIdPaymentLimit: 1, amountMin: 100, amountMax: 500, regionBlacklist: "上海" });
    expect(store.checkChannelOrderRisk(ids.channel, { amount: 50, deviceIp: "10.0.0.1", userId: "u-risk" }).reason).toBe("CHANNEL_AMOUNT_BELOW_MINIMUM");
    expect(store.checkChannelOrderRisk(ids.channel, { amount: 200, deviceIp: "10.0.0.1", userId: "u-risk", deviceProvince: "上海" }).reason).toBe("CHANNEL_REGION_BLOCKED");
    store.insertOrder({ merchantId: ids.platformMerchant, platformOrderNo: `P-risk-${process.pid}`, channelId: ids.channel, channelOutTradeNo: `T-risk-${process.pid}`, amount: 200, description: "risk", clientRequestNo: `C-risk-${process.pid}`, userId: "u-risk", deviceIp: "10.0.0.1", expireAt: new Date(Date.now() + 60_000).toISOString() });
    expect(store.checkChannelOrderRisk(ids.channel, { amount: 200, deviceIp: "10.0.0.1", userId: "u-risk" }).reason).toBe("CHANNEL_IP_LIMIT_EXCEEDED");
    store.updateChannelRiskPolicy(ids.channel, { singleIpPaymentLimit: 0, userIdPaymentLimit: 0, amountMin: 0, amountMax: 0, regionBlacklist: "" });
  });

  it("validates pooled route targets and reserves merchant capacity", () => {
    store.setPlatformMerchantWechatBindings(ids.platformMerchant, [{ wechatMerchantId: ids.merchant, maxConcurrency: 1, routeWeight: 100 }]);
    store.setChannelPlatformMerchantPolicies(ids.channel, [{ platformMerchantId: ids.platformMerchant, maxConcurrency: 1, routeWeight: 100 }]);
    expect(store.getChannelPreflight(ids.channel)?.routingReady).toBe(true);
    const target = store.chooseRoutedPaymentTarget(100, [ids.channel], undefined, ids.platformMerchant);
    const orderNo = `P-route-capacity-${process.pid}`;
    store.insertOrder({ merchantId: ids.platformMerchant, platformOrderNo: orderNo, channelId: ids.channel, wechatMerchantId: target.merchantInternalId, channelOutTradeNo: `T-route-capacity-${process.pid}`, amount: 100, description: "route capacity", clientRequestNo: `C-route-capacity-${process.pid}`, expireAt: new Date(Date.now() + 60_000).toISOString(), routeRuleId: target.routeRuleId, routeSnapshot: target.routeSnapshot });
    const order = store.getOrder(orderNo)!;
    store.reserveRouteCapacity(order.id, target);
    expect(() => store.chooseRoutedPaymentTarget(100, [ids.channel], undefined, ids.platformMerchant)).toThrow("NO_ROUTE_TARGET_AVAILABLE");
    store.releaseRouteCapacity(order.id);
    expect(store.getRouteAllocation(order.id)?.status).toBe("RELEASED");
  });

  it("persists Native and挂码 collection modes independently", () => {
    const nativeNo = `P-mode-native-${process.pid}`;
    store.insertOrder({ merchantId: ids.platformMerchant, platformOrderNo: nativeNo, channelId: ids.channel, channelOutTradeNo: `T-mode-native-${process.pid}`, amount: 100, description: "native mode", clientRequestNo: `C-mode-native-${process.pid}`, expireAt: new Date(Date.now() + 60_000).toISOString(), collectionMode: "NATIVE" });
    expect(store.getOrder(nativeNo)?.collectionMode).toBe("NATIVE");
    const qrNo = `P-mode-qr-${process.pid}`;
    store.insertOrder({ merchantId: ids.platformMerchant, platformOrderNo: qrNo, channelId: ids.channel, channelOutTradeNo: `T-mode-qr-${process.pid}`, amount: 100, description: "qr mode", clientRequestNo: `C-mode-qr-${process.pid}`, expireAt: new Date(Date.now() + 60_000).toISOString(), collectionMode: "QR" });
    expect(store.getOrder(qrNo)?.collectionMode).toBe("QR");
    expect(store.listRecoveryOrders().some((item) => item.platformOrderNo === qrNo)).toBe(false);
  });

  it("manages WeChat merchant enablement and daily amount limits", () => {
    expect(store.updateMerchantSettings(ids.merchant, { dailyAmountLimit: 100 })?.dailyAmountLimit).toBe(100);
    expect(() => store.chooseRoutedPaymentTarget(101, [ids.channel])).toThrow("NO_ROUTE_TARGET_AVAILABLE");
    store.updateMerchantSettings(ids.merchant, { dailyAmountLimit: 0 });
    store.setMerchantStatus(ids.merchant, "DISABLED");
    expect(() => store.chooseRoutedPaymentTarget(100, [ids.channel])).toThrow("NO_ROUTE_TARGET_AVAILABLE");
    store.setMerchantStatus(ids.merchant, "ACTIVE");
  });
});

afterAll(() => {
  store.db.close();
  for (const file of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) if (fs.existsSync(file)) fs.unlinkSync(file);
});
