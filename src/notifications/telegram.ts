import { getBotToken, listBotRecipientGroups, recordBotDelivery } from "../db.js";

export const BOT_COMMAND_INSTRUCTIONS = [
  { command: "帮助", description: "查看全部中文命令和使用说明" }, { command: "状态", description: "查看系统运行模式、待处理订单和回调概况" }, { command: "今日", description: "查看今日订单、成功数和收款汇总" }, { command: "健康", description: "查看全部支付通道健康状态" },
  { command: "通道 <通道编码>", description: "查看指定通道健康、熔断和失败次数" }, { command: "商户号 <商户号>", description: "查看商户号状态和风控状态" }, { command: "订单 <订单号>", description: "查询订单状态、金额和所属通道" },
  { command: "设置操作员 @用户", description: "添加群组操作员，仅管理员可用" }, { command: "删除操作员 @用户", description: "删除群组操作员，仅管理员可用" }, { command: "群组ID", description: "获取当前群组 ID" }, { command: "绑定商户 <商户号>", description: "将商户号绑定到当前群组" },
  { command: "+金额 / -金额", description: "添加或扣减下发金额" }, { command: "余额+金额 / 余额-金额", description: "调整已绑定商户余额" }, { command: "记账 金额 备注", description: "新增下发记账，金额可为负数" }, { command: "撤销记账 / 清除记账", description: "撤销最后一笔或清除今日记账" },
  { command: "今日账单 / 昨日账单", description: "查看最近两天的完整记账" }, { command: "今日跑量 / 昨日跑量", description: "查看绑定商户或通道跑量" }, { command: "商户结算 / 确认商户结算", description: "生成或确认商户结算单" }, { command: "通道结算 / 确认通道结算", description: "查看通道结算汇总" },
  { command: "代付撤单 <商户单号>", description: "批量撤销代付单（需接入代付模块）" }, { command: "代付回单 <商户单号>", description: "查看代付回单（需接入代付模块）" }, { command: "查询余额", description: "查询绑定商户余额" }, { command: "查询通道 <通道编码>", description: "查询商户已开通通道" }, { command: "zz 备注", description: "回复发单消息并转发" }, { command: "cmo <单号>", description: "转换并查询系统单号、商户单号和通道单号" }, { command: "群发商户 / 群发通道", description: "将回复的消息发送到绑定接收群组" }, { command: "设置费率", description: "提示进入后台维护码商费率规则" }, { command: "uj / ub / ua / uw", description: "查询 USTD 市场价格（需配置报价源）" }, { command: "计算器 123+321", description: "计算简单四则表达式" }, { command: "自动查单", description: "发送订单号即可查询订单状态" }
];

async function telegramRequest(method: string, body: Record<string, unknown>): Promise<any> {
  const token = getBotToken();
  if (!token) throw new Error("BOT_NOT_CONFIGURED");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000)
  });
  const payload = await response.json() as any;
  if (!response.ok || !payload?.ok) throw new Error(String(payload?.description ?? `TELEGRAM_${response.status}`));
  return payload.result;
}

export async function sendTelegramMessage(chatId: string, text: string, eventType = "MESSAGE"): Promise<void> {
  try { await telegramRequest("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }); recordBotDelivery({ chatId, eventType, message: text, status: "SUCCESS" }); }
  catch (error) { recordBotDelivery({ chatId, eventType, message: text, status: "FAILED", error: error instanceof Error ? error.message : String(error) }); throw error; }
}
export async function setTelegramWebhook(url: string): Promise<void> { await telegramRequest("setWebhook", { url }); }
export async function getTelegramBotInfo(): Promise<Record<string, unknown>> { return await telegramRequest("getMe", {}) as Record<string, unknown>; }
export async function getTelegramChatMember(chatId: string, userId: string): Promise<Record<string, unknown>> { return await telegramRequest("getChatMember", { chat_id: chatId, user_id: userId }) as Record<string, unknown>; }
export async function pinTelegramMessage(chatId: string, messageId: string): Promise<void> { await telegramRequest("pinChatMessage", { chat_id: chatId, message_id: Number(messageId), disable_notification: true }); }
export async function deleteTelegramMessage(chatId: string, messageId: string): Promise<void> { await telegramRequest("deleteMessage", { chat_id: chatId, message_id: Number(messageId) }); }
export async function leaveTelegramChat(chatId: string): Promise<void> { await telegramRequest("leaveChat", { chat_id: chatId }); }
export async function forwardTelegramMessage(chatId: string, fromChatId: string, messageId: string): Promise<void> {
  await telegramRequest("forwardMessage", { chat_id: chatId, from_chat_id: fromChatId, message_id: Number(messageId) });
}
export function configuredBotRecipients(adminGroupId: string, channelId?: string, merchantId?: string): string[] {
  const scoped = listBotRecipientGroups().filter((group) => group.enabled && (group.scopeType === "PLATFORM" || (group.scopeType === "CHANNEL" && channelId && String(group.scopeId) === channelId) || (group.scopeType === "MERCHANT" && merchantId && String(group.scopeId) === merchantId))).map((group) => String(group.chatId));
  return [...new Set([adminGroupId, ...scoped].filter(Boolean))];
}
export function telegramWebhookUrl(requestBase: string, configured: string): string { return configured.trim() || `${requestBase.replace(/\/+$/, "")}/webhooks/telegram`; }

export async function broadcastTelegram(text: string, eventType: string, adminGroupId: string, extraRecipients: string[] = [], channelId?: string, merchantId?: string): Promise<void> {
  const recipients = [...new Set([...configuredBotRecipients(adminGroupId, channelId, merchantId), ...extraRecipients].filter(Boolean))];
  await Promise.allSettled(recipients.map((chatId) => sendTelegramMessage(chatId, text, eventType)));
}

export function isTelegramConfigured(): boolean { return Boolean(getBotToken()); }
