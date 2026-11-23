export type ChannelStatus = "ACTIVE" | "PAUSED" | "DISABLED";
export type OrderStatus = "CREATED" | "ROUTED" | "QR_CREATED" | "PAYING" | "SUCCESS" | "FAILED" | "UNKNOWN" | "CLOSED";
export type PublicPaymentEntryStatus = "ACTIVE" | "PAID" | "EXPIRED" | "REVOKED" | "FAILED";

export interface Channel {
  id: string;
  name: string;
  subjectId: string;
  subjectName: string;
  appInternalId?: string;
  merchantInternalId?: string;
  merchantCount?: number;
  merchantIds?: string[];
  appId: string;
  mchId: string;
  credentialRef: string;
  notifyPath: string;
  routeWeight: number;
  paymentMethod?: "NATIVE" | "JSAPI";
  routeStrategy?: "HEALTH_WEIGHTED" | "ROUND_ROBIN" | "FAILOVER";
  status: ChannelStatus;
  appStatus?: string;
  merchantStatus?: string;
}

export interface Order {
  id: string;
  merchantId: string;
  platformOrderNo: string;
  channelId: string;
  wechatMerchantId?: string | null;
  channelOutTradeNo: string;
  amount: number;
  description: string;
  status: OrderStatus;
  paymentMethod?: "NATIVE" | "JSAPI";
  paymentAppId?: string | null;
  collectionMode?: "NATIVE" | "QR";
  codeUrl: string | null;
  qrDataUrl: string | null;
  transactionId: string | null;
  clientRequestNo: string;
  userId?: string | null;
  paymentOpenidHash?: string | null;
  expireAt: string;
  createdAt: string;
  paidAt: string | null;
  clientMerchantId?: string | null;
  routeRuleId?: string | null;
  routeSnapshot?: Record<string, unknown> | null;
  routeSelectedAt?: string | null;
  deviceType?: string | null;
  deviceIp?: string | null;
  deviceCountry?: string | null;
  deviceProvince?: string | null;
  deviceCity?: string | null;
  deviceNo?: string | null;
}

export interface NativeOrderRequest {
  appId: string;
  mchId: string;
  description: string;
  outTradeNo: string;
  amount: number;
  notifyUrl: string;
  attach: string;
  credentialRef: string;
  clientIp?: string;
}

export interface NativeOrderResponse {
  codeUrl: string;
  provider: "mock" | "wechatpay";
}

export interface JsapiOrderRequest {
  appId: string;
  mchId: string;
  openid: string;
  description: string;
  outTradeNo: string;
  amount: number;
  notifyUrl: string;
  attach: string;
  credentialRef: string;
  clientIp?: string;
}

export interface JsapiOrderResponse {
  prepayId: string;
  payParams: { appId: string; timeStamp: string; nonceStr: string; package: string; signType: "MD5"; paySign: string };
  provider: "mock" | "wechatpay";
}

export interface PublicPaymentEntry {
  id: string;
  orderId: string;
  tokenHash: string;
  pagePath: string;
  qrDataUrl?: string | null;
  entryMode: "PUBLIC_ACCOUNT_ARTICLE";
  status: PublicPaymentEntryStatus;
  expiresAt: string;
  usedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueryOrderRequest {
  mchId: string;
  appId: string;
  outTradeNo: string;
  credentialRef: string;
}

export interface QueryRefundRequest {
  mchId: string;
  outRefundNo: string;
  credentialRef: string;
}

export interface QueryOrderResponse {
  tradeState: string;
  transactionId?: string;
  raw?: unknown;
}

export interface RefundRequest {
  mchId: string;
  outTradeNo: string;
  outRefundNo: string;
  refundAmount: number;
  totalAmount: number;
  reason: string;
  notifyUrl: string;
  credentialRef: string;
}

export interface TradeBillRequest {
  mchId: string;
  billDate: string;
  credentialRef: string;
}

export interface TradeBillItem {
  outTradeNo?: string;
  transactionId?: string;
  amount: number;
  tradeState: string;
  refundAmount?: number;
  raw?: unknown;
}
