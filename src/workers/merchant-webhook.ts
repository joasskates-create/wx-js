import crypto from "node:crypto";
import { config } from "../config.js";
import { createAuditLog, listRetryableMerchantWebhooks, markMerchantWebhookFailure, markMerchantWebhookSuccess } from "../db.js";
import { withDistributedLock } from "../infra/lock.js";

let running = false;

export async function runMerchantWebhookPass(): Promise<{ scanned: number; succeeded: number; failed: number }> {
  if (running) return { scanned: 0, succeeded: 0, failed: 0 };
  const result = await withDistributedLock("merchant-webhook", 60_000, async () => {
    running = true;
    const summary = { scanned: 0, succeeded: 0, failed: 0 };
    try {
      const deliveries = listRetryableMerchantWebhooks(50);
      summary.scanned = deliveries.length;
      for (const delivery of deliveries) {
        const attempts = Number(delivery.attempts) + 1;
        try {
          const payload = String(delivery.payload);
          const timestamp = String(Math.floor(Date.now() / 1000));
          const signature = crypto.createHmac("sha256", String(delivery.secret)).update(`${timestamp}\n${payload}`).digest("hex");
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10_000);
          try {
            const response = await fetch(String(delivery.url), { method: "POST", headers: { "content-type": "application/json", "x-merchant-event": String(delivery.eventType), "x-merchant-delivery": String(delivery.id), "x-merchant-timestamp": timestamp, "x-merchant-signature": signature }, body: payload, signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP_${response.status}`);
          } finally { clearTimeout(timeout); }
          markMerchantWebhookSuccess(String(delivery.id)); summary.succeeded += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "MERCHANT_WEBHOOK_FAILED";
          markMerchantWebhookFailure(String(delivery.id), message, attempts); summary.failed += 1;
          if (attempts >= 8) createAuditLog({ action: "MERCHANT_WEBHOOK_DEAD_LETTER", operator: "system", targetType: "merchant_webhook", targetId: String(delivery.id), detail: { merchantId: delivery.merchantId, eventType: delivery.eventType, error: message } });
        }
      }
      return summary;
    } finally { running = false; }
  });
  return result ?? { scanned: 0, succeeded: 0, failed: 0 };
}

export function startMerchantWebhookScheduler(): NodeJS.Timeout | undefined {
  if (!config.merchantWebhookEnabled) return undefined;
  const timer = setInterval(() => { void runMerchantWebhookPass(); }, config.merchantWebhookIntervalMinutes * 60 * 1000);
  void runMerchantWebhookPass();
  return timer;
}
