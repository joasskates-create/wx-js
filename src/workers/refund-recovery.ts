import { config } from "../config.js";
import { createAuditLog, getChannel, listRecoverableRefunds, updateRefundStatus } from "../db.js";
import { MockPaymentProvider } from "../payment/mock.js";
import { WechatNativeProvider } from "../payment/wechat-native.js";
import { withDistributedLock } from "../infra/lock.js";

let running = false;

export async function runRefundRecoveryPass(): Promise<{ scanned: number; updated: number; failed: number }> {
  if (running) return { scanned: 0, updated: 0, failed: 0 };
  const result = await withDistributedLock("refund-recovery", Math.max(60_000, config.refundRecoveryIntervalMinutes * 60_000), async () => {
    running = true;
    const passResult = { scanned: 0, updated: 0, failed: 0 };
    try {
      const refunds = listRecoverableRefunds(100);
      passResult.scanned = refunds.length;
      for (const item of refunds) {
        const channel = getChannel(String(item.channelId));
        if (!channel) continue;
        try {
          const provider = config.mockPayment ? new MockPaymentProvider() : new WechatNativeProvider();
          const result = await provider.queryRefund({ mchId: String(item.mchid), outRefundNo: String(item.refundNo), credentialRef: String(item.credentialRef) });
          updateRefundStatus(String(item.refundNo), result.status, result.refundId);
          passResult.updated += 1;
        } catch (error) {
          passResult.failed += 1;
          createAuditLog({ action: "REFUND_RECOVERY_FAILED", targetType: "refund", targetId: String(item.refundNo), detail: { message: error instanceof Error ? error.message : "REFUND_QUERY_FAILED" } });
        }
      }
      return passResult;
    } finally { running = false; }
  });
  return result ?? { scanned: 0, updated: 0, failed: 0 };
}

export function startRefundRecoveryScheduler(): NodeJS.Timeout | undefined {
  if (!config.refundRecoveryEnabled) return undefined;
  const timer = setInterval(() => { void runRefundRecoveryPass(); }, config.refundRecoveryIntervalMinutes * 60 * 1000);
  void runRefundRecoveryPass();
  return timer;
}
