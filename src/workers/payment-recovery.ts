import { config } from "../config.js";
import { closeOrder, createAuditLog, getChannel, insertPaymentAttempt, listRecoveryOrders, recordChannelHealth, recordOrderExceptionAction, updateOrderPayment } from "../db.js";
import { MockPaymentProvider } from "../payment/mock.js";
import { WechatNativeProvider } from "../payment/wechat-native.js";
import { withDistributedLock } from "../infra/lock.js";

let running = false;

export async function runPaymentRecoveryPass(channelIds?: string[]): Promise<{ scanned: number; updated: number; closed: number; failed: number }> {
  if (running) return { scanned: 0, updated: 0, closed: 0, failed: 0 };
  const result = await withDistributedLock("payment-recovery", Math.max(60_000, config.paymentRecoveryIntervalMinutes * 60_000), async () => {
    running = true;
    const passResult = { scanned: 0, updated: 0, closed: 0, failed: 0 };
    try {
    const scoped = channelIds?.map(String);
    const orders = listRecoveryOrders(500).filter((item) => !scoped?.length || scoped.includes(String(item.channelId)));
    passResult.scanned = orders.length;
    for (const item of orders) {
      const channel = getChannel(String(item.channelId));
      if (!channel) continue;
      try {
        const provider = config.mockPayment ? new MockPaymentProvider() : new WechatNativeProvider();
        const query = await provider.queryOrder({ mchId: String(item.mchid), outTradeNo: String(item.channelOutTradeNo), credentialRef: String(item.credentialRef) });
        insertPaymentAttempt(String(item.id), String(item.channelId), "RECOVERY_QUERY", query.tradeState);
        if (query.tradeState === "SUCCESS") {
          updateOrderPayment(String(item.id), { status: "SUCCESS", transactionId: query.transactionId });
          recordOrderExceptionAction({ orderId: String(item.id), action: "QUERY", result: "SUCCESS", note: "恢复任务查单确认支付成功" });
          passResult.updated += 1;
        } else if (query.tradeState === "CLOSED") {
          updateOrderPayment(String(item.id), { status: "CLOSED" });
          recordOrderExceptionAction({ orderId: String(item.id), action: "QUERY", result: "CLOSED", note: "恢复任务查单确认已关闭" });
          passResult.updated += 1;
          passResult.closed += 1;
        } else if (query.tradeState === "NOTPAY" && new Date(String(item.expireAt)).getTime() < Date.now()) {
          await provider.closeOrder({ mchId: String(item.mchid), outTradeNo: String(item.channelOutTradeNo), credentialRef: String(item.credentialRef) });
          closeOrder(String(item.id));
          recordOrderExceptionAction({ orderId: String(item.id), action: "CLOSE", result: "SUCCESS", note: "订单已过期且查单未支付，自动关单" });
          passResult.updated += 1;
          passResult.closed += 1;
        } else if (query.tradeState === "NOTPAY") {
          recordOrderExceptionAction({ orderId: String(item.id), action: "QUERY", result: "NOTPAY", note: "恢复任务查单未支付，订单仍在有效期内" });
        } else {
          recordOrderExceptionAction({ orderId: String(item.id), action: "QUERY", result: "UNKNOWN", note: `微信交易状态：${query.tradeState}` });
        }
        recordChannelHealth(channel.id, { success: true, failureThreshold: config.channelFailureThreshold });
      } catch (error) {
        passResult.failed += 1;
        const message = error instanceof Error ? error.message : "RECOVERY_QUERY_FAILED";
        insertPaymentAttempt(String(item.id), String(item.channelId), "RECOVERY_FAILED", message);
        recordChannelHealth(channel.id, { success: false, error: message, failureThreshold: config.channelFailureThreshold });
        recordOrderExceptionAction({ orderId: String(item.id), action: "QUERY", result: "FAILED", note: message });
        createAuditLog({ action: "PAYMENT_RECOVERY_FAILED", targetType: "order", targetId: String(item.platformOrderNo), detail: { channelId: channel.id, message } });
      }
    }
    return passResult;
    } finally { running = false; }
  });
  return result ?? { scanned: 0, updated: 0, closed: 0, failed: 0 };
}

export function startPaymentRecoveryScheduler(): NodeJS.Timeout | undefined {
  if (!config.paymentRecoveryEnabled) return undefined;
  const timer = setInterval(() => { void runPaymentRecoveryPass(); }, config.paymentRecoveryIntervalMinutes * 60 * 1000);
  void runPaymentRecoveryPass();
  return timer;
}
