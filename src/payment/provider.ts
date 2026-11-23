import type { JsapiOrderRequest, JsapiOrderResponse, NativeOrderRequest, NativeOrderResponse, QueryOrderRequest, QueryOrderResponse, QueryRefundRequest, RefundRequest, TradeBillItem, TradeBillRequest } from "../types.js";

export interface PaymentProvider {
  createNativeOrder(input: NativeOrderRequest): Promise<NativeOrderResponse>;
  createJsapiOrder(input: JsapiOrderRequest): Promise<JsapiOrderResponse>;
  queryOrder(input: QueryOrderRequest): Promise<QueryOrderResponse>;
  closeOrder(input: QueryOrderRequest): Promise<void>;
  refund(input: RefundRequest): Promise<{ refundId?: string; status: string; raw?: unknown }>;
  queryRefund(input: QueryRefundRequest): Promise<{ refundId?: string; status: string; raw?: unknown }>;
  downloadTradeBill(input: TradeBillRequest): Promise<{ items: TradeBillItem[]; raw?: unknown }>;
}
