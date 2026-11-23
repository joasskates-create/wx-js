import crypto from "node:crypto";
import type { JsapiOrderRequest, JsapiOrderResponse, NativeOrderRequest, NativeOrderResponse, QueryOrderRequest, QueryOrderResponse, QueryRefundRequest, RefundRequest, TradeBillItem, TradeBillRequest } from "../types.js";
import { getCredentials } from "../security/credentials.js";
import type { PaymentProvider } from "./provider.js";

function xmlCdata(value: unknown): string {
  return String(value ?? "").replace(/]]>/g, "]]]]><![CDATA[>");
}

function xmlUnescape(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export function parseWechatV2Xml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const source = String(xml || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  for (const match of source.matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) result[match[1]] = xmlUnescape(match[2]);
  return result;
}

export function buildWechatV2Sign(params: Record<string, unknown>, apiV2Key: string): string {
  const content = Object.keys(params).filter((key) => key !== "sign" && params[key] !== undefined && params[key] !== null && String(params[key]) !== "").sort().map((key) => `${key}=${String(params[key])}`).join("&");
  return crypto.createHash("md5").update(`${content}&key=${apiV2Key}`, "utf8").digest("hex").toUpperCase();
}

function toXml(params: Record<string, unknown>): string {
  return `<xml>${Object.entries(params).map(([key, value]) => `<${key}><![CDATA[${xmlCdata(value)}]]></${key}>`).join("")}</xml>`;
}

async function fetchWechat(urlPath: string, body: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://api.mch.weixin.qq.com${urlPath}`, { method: "POST", headers: { Accept: "application/xml,text/xml", "Content-Type": "text/xml" }, body, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`WECHAT_V2_${response.status}:${text}`);
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("WECHAT_REQUEST_TIMEOUT");
    throw error;
  } finally { clearTimeout(timeout); }
}

async function requestV2(path: string, params: Record<string, unknown>, mchId: string, credentialRef: string): Promise<Record<string, string>> {
  const credentials = getCredentials(credentialRef);
  const signed = { ...params, mch_id: mchId, nonce_str: crypto.randomBytes(16).toString("hex") };
  const response = parseWechatV2Xml(await fetchWechat(path, toXml({ ...signed, sign: buildWechatV2Sign(signed, credentials.apiV2Key) })));
  if (response.return_code !== "SUCCESS" || (response.result_code && response.result_code !== "SUCCESS")) throw new Error(`WECHAT_V2_${response.err_code || response.return_code || response.result_code || "FAILED"}:${response.err_code_des || response.return_msg || ""}`);
  return response;
}

export class WechatNativeProvider implements PaymentProvider {
  async createNativeOrder(input: NativeOrderRequest): Promise<NativeOrderResponse> {
    const response = await requestV2("/pay/unifiedorder", { appid: input.appId, body: input.description, out_trade_no: input.outTradeNo, total_fee: input.amount, spbill_create_ip: input.clientIp || "127.0.0.1", notify_url: input.notifyUrl, trade_type: "NATIVE", attach: input.attach }, input.mchId, input.credentialRef);
    if (!response.code_url) throw new Error("WECHAT_V2_MISSING_CODE_URL");
    return { provider: "wechatpay", codeUrl: response.code_url };
  }

  async createJsapiOrder(input: JsapiOrderRequest): Promise<JsapiOrderResponse> {
    const response = await requestV2("/pay/unifiedorder", { appid: input.appId, body: input.description, out_trade_no: input.outTradeNo, total_fee: input.amount, spbill_create_ip: input.clientIp || "127.0.0.1", notify_url: input.notifyUrl, trade_type: "JSAPI", attach: input.attach, openid: input.openid }, input.mchId, input.credentialRef);
    if (!response.prepay_id) throw new Error("WECHAT_V2_MISSING_PREPAY_ID");
    const credentials = getCredentials(input.credentialRef);
    const payParams = { appId: input.appId, timeStamp: String(Math.floor(Date.now() / 1000)), nonceStr: crypto.randomBytes(16).toString("hex"), package: `prepay_id=${response.prepay_id}`, signType: "MD5" as const };
    return { provider: "wechatpay", prepayId: response.prepay_id, payParams: { ...payParams, paySign: buildWechatV2Sign(payParams, credentials.apiV2Key) } };
  }

  async queryOrder(input: QueryOrderRequest): Promise<QueryOrderResponse> {
    const response = await requestV2("/pay/orderquery", { out_trade_no: input.outTradeNo }, input.mchId, input.credentialRef);
    return { tradeState: response.trade_state || "UNKNOWN", transactionId: response.transaction_id, raw: response };
  }

  async closeOrder(input: QueryOrderRequest): Promise<void> { await requestV2("/pay/closeorder", { out_trade_no: input.outTradeNo }, input.mchId, input.credentialRef); }
  async refund(_input: RefundRequest): Promise<{ refundId?: string; status: string; raw?: unknown }> { throw new Error("WECHAT_V2_REFUND_REQUIRES_CERTIFICATE"); }
  async queryRefund(_input: QueryRefundRequest): Promise<{ refundId?: string; status: string; raw?: unknown }> { throw new Error("WECHAT_V2_REFUND_REQUIRES_CERTIFICATE"); }
  async downloadTradeBill(_input: TradeBillRequest): Promise<{ items: TradeBillItem[]; raw?: unknown }> { throw new Error("WECHAT_V2_BILL_REQUIRES_CERTIFICATE"); }
}
