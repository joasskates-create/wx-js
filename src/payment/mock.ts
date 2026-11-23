import type { JsapiOrderRequest, NativeOrderRequest, NativeOrderResponse, QueryOrderRequest, QueryOrderResponse, QueryRefundRequest, RefundRequest, TradeBillItem, TradeBillRequest } from "../types.js";
import type { PaymentProvider } from "./provider.js";

export class MockPaymentProvider implements PaymentProvider {
  async createNativeOrder(input: NativeOrderRequest): Promise<NativeOrderResponse> {
    return {
      provider: "mock",
      codeUrl: `mock://wechatpay/${encodeURIComponent(input.outTradeNo)}?amount=${input.amount}`
    };
  }

  async createJsapiOrder(input: JsapiOrderRequest) {
    const prepayId = `mock_prepay_${input.outTradeNo}`;
    return { provider: "mock" as const, prepayId, payParams: { appId: input.appId, timeStamp: String(Math.floor(Date.now() / 1000)), nonceStr: "mock_nonce", package: `prepay_id=${prepayId}`, signType: "MD5" as const, paySign: "MOCK" } };
  }

  async queryOrder(_input: QueryOrderRequest): Promise<QueryOrderResponse> {
    return { tradeState: "NOTPAY" };
  }

  async closeOrder(_input: QueryOrderRequest): Promise<void> {
    return;
  }

  async refund(input: RefundRequest): Promise<{ refundId?: string; status: string }> {
    return { refundId: `mock_refund_${input.outRefundNo}`, status: "SUCCESS" };
  }

  async queryRefund(input: QueryRefundRequest): Promise<{ refundId?: string; status: string }> {
    return { refundId: `mock_refund_${input.outRefundNo}`, status: "SUCCESS" };
  }

  async downloadTradeBill(_input: TradeBillRequest): Promise<{ items: TradeBillItem[]; raw?: unknown }> {
    return { items: [], raw: { provider: "mock", message: "mock bill is empty; use manual import for test data" } };
  }
}
