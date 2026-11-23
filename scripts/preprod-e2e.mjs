const base = process.env.BASE_URL ?? 'http://127.0.0.1:3310';
if (process.env.E2E_ALLOW_MUTATION !== 'true') throw new Error('SET_E2E_ALLOW_MUTATION=true_TO_RUN');
async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers: { 'content-type': 'application/json', ...(options.headers ?? {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path} ${response.status} ${JSON.stringify(body)}`);
  return body;
}
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const clientRequestNo = `e2e-${suffix}`;
const orderPayload = { merchantId: 'demo-merchant', clientRequestNo, amount: 100, description: '预生产验收' };
const created = await call('/api/v1/orders', { method: 'POST', body: JSON.stringify(orderPayload) });
const order = created.data;
const duplicate = await call('/api/v1/orders', { method: 'POST', body: JSON.stringify(orderPayload) });
if (duplicate.data.id !== order.id || !duplicate.data.platformOrderNo) throw new Error('ORDER_IDEMPOTENCY_FAILED');
await call(`/api/v1/orders/${encodeURIComponent(order.id)}/simulate-paid`, { method: 'POST', body: '{}' });
const paid = await call(`/api/v1/orders/${encodeURIComponent(order.id)}`);
if (paid.data.status !== 'SUCCESS') throw new Error(`ORDER_NOT_SUCCESS:${paid.data.status}`);
const refundNo = `e2e-refund-${suffix}`;
const refund = await call(`/api/v1/orders/${encodeURIComponent(order.id)}/refunds`, { method: 'POST', body: JSON.stringify({ amount: 100, refundNo, reason: '预生产验收' }) });
if (!['SUCCESS', 'PROCESSING', 'PENDING'].includes(refund.data.status)) throw new Error(`REFUND_STATUS_INVALID:${refund.data.status}`);
const refundDuplicate = await call(`/api/v1/orders/${encodeURIComponent(order.id)}/refunds`, { method: 'POST', body: JSON.stringify({ amount: 100, refundNo, reason: '预生产验收' }) });
if (refundDuplicate.data.refundNo !== refundNo || !refundDuplicate.idempotent) throw new Error('REFUND_IDEMPOTENCY_FAILED');
const overRefund = await fetch(`${base}/api/v1/orders/${encodeURIComponent(order.id)}/refunds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: 1, reason: '超额退款验收' }) });
if (overRefund.status !== 409) throw new Error(`REFUND_LIMIT_NOT_ENFORCED:${overRefund.status}`);
await call('/ready');
console.log(JSON.stringify({ ok: true, orderId: order.id, platformOrderNo: order.platformOrderNo, idempotentOrder: duplicate.data.id === order.id, refundNo: refund.data.refundNo, refundStatus: refund.data.status, idempotentRefund: Boolean(refundDuplicate.idempotent), overRefundStatus: overRefund.status }, null, 2));
