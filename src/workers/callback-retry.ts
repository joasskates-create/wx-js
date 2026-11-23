import { config } from "../config.js";
import { createAuditLog, listRetryableCallbackTasks, markCallbackTaskFailure, markCallbackTaskSuccess } from "../db.js";
import { processRefundWebhookPayload, processWebhookPayload } from "../payment/webhook-service.js";
import { withDistributedLock } from "../infra/lock.js";

let running = false;

export async function runCallbackRetryPass(): Promise<{ scanned: number; succeeded: number; failed: number }> {
  if (running) return { scanned: 0, succeeded: 0, failed: 0 };
  const result = await withDistributedLock("callback-retry", Math.max(60_000, config.callbackRetryIntervalMinutes * 60_000), async () => {
    running = true;
    const passResult = { scanned: 0, succeeded: 0, failed: 0 };
    try {
    const tasks = listRetryableCallbackTasks(50);
    passResult.scanned = tasks.length;
    for (const task of tasks) {
      const attempts = Number(task.attempts) + 1;
      try {
        if (String(task.callbackType) === "REFUND") processRefundWebhookPayload(String(task.channelId), Buffer.from(String(task.payload)), {}, false);
        else processWebhookPayload(String(task.channelId), Buffer.from(String(task.payload)), {}, false);
        markCallbackTaskSuccess(String(task.id)); passResult.succeeded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "CALLBACK_RETRY_FAILED";
        markCallbackTaskFailure(String(task.id), message, attempts); passResult.failed += 1;
        if (attempts >= 8) createAuditLog({ action: "CALLBACK_DEAD_LETTER", targetType: "callback", targetId: String(task.id), detail: { channelId: task.channelId, error: message } });
      }
    }
    return passResult;
    } finally { running = false; }
  });
  return result ?? { scanned: 0, succeeded: 0, failed: 0 };
}

export function startCallbackRetryScheduler(): NodeJS.Timeout | undefined {
  if (!config.callbackRetryEnabled) return undefined;
  const timer = setInterval(() => { void runCallbackRetryPass(); }, config.callbackRetryIntervalMinutes * 60 * 1000);
  void runCallbackRetryPass();
  return timer;
}
