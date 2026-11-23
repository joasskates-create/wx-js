import type { IncomingHttpHeaders } from "node:http";
import { config } from "../config.js";
import { db, getChannel, getRefund, getOrder, getWechatApp, insertWebhookEvent, resolveChannelMerchantByMchid, updateOrderPayment, updateRefundStatus, getPublicPaymentEntryByOrder, updatePublicPaymentEntry } from "../db.js";
import { getCredentials } from "../security/credentials.js";
import { verifyWechatSignature } from "./callback.js";
import { parseWechatV2Xml } from "./wechat-native.js";

export function processWebhookPayload(channelId: string, rawBody: Buffer, headers: IncomingHttpHeaders, verifySignature = true, mchid?: string): { notificationId: string | null; duplicate: boolean } {
  const channel = mchid ? resolveChannelMerchantByMchid(channelId, mchid) : getChannel(channelId);
  if (!channel) throw new Error("CHANNEL_NOT_FOUND");
  let payload: any;
  let notificationId: string | null = null;
  let eventType = "TRANSACTION.SUCCESS";
  if (config.mockPayment) {
    payload = JSON.parse(rawBody.toString("utf8"));
    notificationId = payload.id ?? `mock-${payload.out_trade_no ?? payload.outTradeNo ?? "unknown"}-${payload.trade_state ?? payload.tradeState ?? "UNKNOWN"}`;
    eventType = payload.event_type ?? eventType;
  } else {
    const credentials = getCredentials(channel.credentialRef);
    payload = verifySignature ? verifyWechatSignature(rawBody, credentials) : parseWechatV2Xml(rawBody.toString("utf8"));
    notificationId = payload.transaction_id || payload.out_trade_no || null;
    eventType = "TRANSACTION.SUCCESS";
  }
  const outTradeNo = payload.out_trade_no ?? payload.outTradeNo;
  const duplicate = !insertWebhookEvent(channelId, notificationId, outTradeNo, eventType, rawBody.toString("utf8"));
  // A channel can serve multiple merchant accounts. When the callback URL
  // includes mchid, bind the notification to the exact merchant selected for
  // the order instead of falling back to the channel's default account.
  const order = (mchid
    ? db.prepare("SELECT id FROM orders WHERE channel_id = ? AND channel_out_trade_no = ? AND (wechat_merchant_id = ? OR (wechat_merchant_id IS NULL AND ? = (SELECT merchant_id FROM channels WHERE id = ?)))").get(channelId, outTradeNo, channel.merchantInternalId ?? null, channel.merchantInternalId ?? null, channelId)
    : db.prepare("SELECT id FROM orders WHERE channel_id = ? AND channel_out_trade_no = ? AND (wechat_merchant_id = ? OR wechat_merchant_id IS NULL)").get(channelId, outTradeNo, channel.merchantInternalId ?? null)) as { id: string } | undefined;
  if (!order) throw new Error("ORDER_NOT_FOUND");
  const fullOrder = getOrder(order.id);
  if (fullOrder && payload.total_fee !== undefined && Number(payload.total_fee) !== Number(fullOrder.amount)) throw new Error("PAYMENT_AMOUNT_MISMATCH");
  if (fullOrder && fullOrder.paymentMethod === "JSAPI" && payload.trade_type && String(payload.trade_type).toUpperCase() !== "JSAPI") throw new Error("PAYMENT_TRADE_TYPE_MISMATCH");
  if (payload.mch_id && String(payload.mch_id) !== String(channel.mchId)) throw new Error("PAYMENT_MCHID_MISMATCH");
  if (fullOrder?.paymentAppId && payload.appid) {
    const app = getWechatApp(String(fullOrder.paymentAppId));
    if (app?.appid && String(app.appid) !== String(payload.appid)) throw new Error("PAYMENT_APPID_MISMATCH");
  }
  if (payload.result_code === "SUCCESS" || payload.trade_state === "SUCCESS" || payload.tradeState === "SUCCESS") {
    updateOrderPayment(order.id, { status: "SUCCESS", transactionId: payload.transaction_id ?? payload.transactionId });
    const entry = getPublicPaymentEntryByOrder(order.id);
    if (entry) updatePublicPaymentEntry(entry.id, { status: "PAID", usedAt: new Date().toISOString() });
  }
  return { notificationId, duplicate };
}

export function processRefundWebhookPayload(channelId: string, rawBody: Buffer, headers: IncomingHttpHeaders, verifySignature = true, mchid?: string): { notificationId: string | null; duplicate: boolean; refundNo: string } {
  const channel = mchid ? resolveChannelMerchantByMchid(channelId, mchid) : getChannel(channelId);
  if (!channel) throw new Error("CHANNEL_NOT_FOUND");
  let payload: any;
  let notificationId: string | null = null;
  if (config.mockPayment) {
    payload = JSON.parse(rawBody.toString("utf8"));
    notificationId = payload.id ?? `mock-refund-${payload.out_refund_no ?? payload.outRefundNo ?? "unknown"}`;
  } else {
    const credentials = getCredentials(channel.credentialRef);
    payload = verifySignature ? verifyWechatSignature(rawBody, credentials) : parseWechatV2Xml(rawBody.toString("utf8"));
    notificationId = payload.transaction_id || payload.out_refund_no || null;
  }
  const refundNo = String(payload.out_refund_no ?? payload.outRefundNo ?? "");
  if (!refundNo) throw new Error("REFUND_NO_MISSING");
  const duplicate = !insertWebhookEvent(channelId, notificationId, refundNo, "REFUND.STATUS", rawBody.toString("utf8"));
  if (!getRefund(refundNo)) throw new Error("REFUND_NOT_FOUND");
  updateRefundStatus(refundNo, String(payload.refund_status ?? payload.refundStatus ?? payload.status ?? "PROCESSING"), payload.refund_id ?? payload.refundId);
  return { notificationId, duplicate, refundNo };
}
