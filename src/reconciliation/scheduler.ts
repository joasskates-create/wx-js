import { config } from "../config.js";
import { createAuditLog, createReconciliationRun, createSettlementStatement, getChannel, importReconciliationBill, listChannels, listPlatformMerchants, listReconciliationRuns } from "../db.js";
import { withDistributedLock } from "../infra/lock.js";
import { MockPaymentProvider } from "../payment/mock.js";
import { WechatNativeProvider } from "../payment/wechat-native.js";

function dateRange(billDate: string): { dateFrom: string; dateTo: string } {
  const start = new Date(`${billDate}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate) || !Number.isFinite(start.getTime())) throw new Error("INVALID_BILL_DATE");
  return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
}

function existingRun(channelId: string, dateFrom: string, dateTo: string): Record<string, unknown> | undefined {
  return listReconciliationRuns(500).find((item) => item.channelId === channelId && item.dateFrom === dateFrom && item.dateTo === dateTo);
}

export async function runChannelReconciliation(channelId: string, billDate: string): Promise<Record<string, unknown>> {
  const channel = getChannel(channelId);
  if (!channel) throw new Error("CHANNEL_NOT_FOUND");
  const range = dateRange(billDate);
  const previous = existingRun(channelId, range.dateFrom, range.dateTo);
  if (previous) return previous;
  const run = createReconciliationRun({ ...range, channelId });
  try {
    const provider = config.mockPayment ? new MockPaymentProvider() : new WechatNativeProvider();
    const bill = await provider.downloadTradeBill({ mchId: channel.mchId, billDate, credentialRef: channel.credentialRef });
    if (bill.items.length) {
      const items = bill.items.map((item) => ({ ...item, channelId }));
      return importReconciliationBill(String(run.id), items);
    }
    createAuditLog({ action: "RECONCILIATION_EMPTY", targetType: "reconciliation", targetId: String(run.id), detail: { channelId, billDate, provider: config.mockPayment ? "mock" : "wechatpay" } });
    return run;
  } catch (error) {
    createAuditLog({ action: "RECONCILIATION_FAILED", targetType: "reconciliation", targetId: String(run.id), detail: { channelId, billDate, message: error instanceof Error ? error.message : "download failed" } });
    throw error;
  }
}

export async function runPreviousDayReconciliation(): Promise<void> {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  now.setUTCDate(now.getUTCDate() - 1);
  const billDate = now.toISOString().slice(0, 10);
  for (const channel of listChannels().filter((item) => item.status === "ACTIVE")) {
    try { await runChannelReconciliation(channel.id, billDate); }
    catch (error) { console.error(`[reconciliation] ${channel.id} ${billDate}:`, error); }
  }
}

export async function runPreviousDaySettlements(): Promise<void> {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  now.setUTCDate(now.getUTCDate() - 1);
  const billDate = now.toISOString().slice(0, 10);
  const range = dateRange(billDate);
  for (const merchant of listPlatformMerchants().filter((item) => item.status === "ACTIVE")) {
    try {
      const statement = createSettlementStatement({ merchantId: String(merchant.id), dateFrom: range.dateFrom, dateTo: range.dateTo });
      createAuditLog({ action: "SETTLEMENT_AUTO_GENERATE", targetType: "settlement", targetId: String(statement.id), detail: { merchantId: merchant.id, billDate } });
    } catch (error) {
      createAuditLog({ action: "SETTLEMENT_AUTO_GENERATE_FAILED", targetType: "platform_merchant", targetId: String(merchant.id), detail: { billDate, message: error instanceof Error ? error.message : "settlement generation failed" } });
    }
  }
}

export function startReconciliationScheduler(): NodeJS.Timeout | undefined {
  if (!config.reconciliationEnabled) return undefined;
  const intervalMs = config.reconciliationIntervalMinutes * 60 * 1000;
  const timer = setInterval(() => { void runPreviousDayReconciliation(); }, intervalMs);
  void runPreviousDayReconciliation();
  return timer;
}

export function startSettlementScheduler(): NodeJS.Timeout | undefined {
  if (!config.settlementAutoEnabled) return undefined;
  const intervalMs = config.settlementAutoIntervalMinutes * 60 * 1000;
  const run = () => { void withDistributedLock("settlement-auto", Math.max(60_000, intervalMs), async () => runPreviousDaySettlements()); };
  const timer = setInterval(run, intervalMs);
  run();
  return timer;
}
