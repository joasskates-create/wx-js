const form = document.querySelector('#jsapi-order-form');
const amountInput = document.querySelector('#jsapi-amount');
const descriptionInput = document.querySelector('#jsapi-description');
const result = document.querySelector('#jsapi-result');
const payButton = document.querySelector('#jsapi-pay');
const status = document.querySelector('#jsapi-status');
const orderMeta = document.querySelector('#jsapi-order-meta');
const message = document.querySelector('#jsapi-message');
const simulate = document.querySelector('#jsapi-simulate');
const countdown = document.querySelector('#jsapi-countdown');
const refreshStatus = document.querySelector('#jsapi-refresh-status');
const copyOrder = document.querySelector('#jsapi-copy-order');
const pendingOrderKey = 'wechat_pending_jsapi_direct_order';
let currentOrder;
let pollTimer;
let countdownTimer;

document.querySelectorAll('[data-amount]').forEach((button) => {
  button.addEventListener('click', () => { amountInput.value = button.dataset.amount; });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '正在准备公众号授权…';
  await createOrder({
    merchantId: 'demo-merchant',
    clientRequestNo: `jsapi_cashier_${Date.now()}`,
    amount: Number(amountInput.value),
    description: descriptionInput.value,
    paymentMethod: 'JSAPI',
    collectionMode: 'NATIVE',
    entryMode: 'DIRECT',
    oauthReturnUrl: `${location.origin}${location.pathname}`
  });
});

async function createOrder(payload) {
  const response = await fetch('/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok) {
    if (body.error === 'JSAPI_OAUTH_REQUIRED' && body.authorizeUrl) {
      sessionStorage.setItem(pendingOrderKey, JSON.stringify(payload));
      location.href = body.authorizeUrl;
      return;
    }
    message.textContent = body.message || body.error || '下单失败';
    return;
  }
  sessionStorage.removeItem(pendingOrderKey);
  renderOrder(body);
}

function renderOrder(body) {
  currentOrder = body.data;
  result.classList.remove('hidden');
  status.classList.remove('success');
  status.textContent = `待支付 · 通道 ${currentOrder.channelId}`;
  orderMeta.innerHTML = `订单号：${currentOrder.platformOrderNo}<br>金额：¥${(currentOrder.amount / 100).toFixed(2)}<br>有效期：${new Date(currentOrder.expireAt).toLocaleString()}`;
  simulate.classList.toggle('hidden', body.provider !== 'mock');
  payButton.disabled = !body.payment;
  if (body.payment) payButton.dataset.params = JSON.stringify(body.payment);
  message.textContent = '订单已创建，请点击“调起微信支付”。';
  if (body.payment && window.WeixinJSBridge) invokeJsapiPay(body.payment);
  clearInterval(pollTimer);
  clearInterval(countdownTimer);
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
  pollTimer = setInterval(pollOrder, 2000);
  pollOrder();
}

payButton.addEventListener('click', () => {
  try { invokeJsapiPay(JSON.parse(payButton.dataset.params || '{}')); }
  catch { message.textContent = '公众号支付参数无效，请重新下单'; }
});

function invokeJsapiPay(params) {
  if (!window.WeixinJSBridge?.invoke) {
    message.textContent = '请在微信内打开页面后发起公众号支付';
    return;
  }
  window.WeixinJSBridge.invoke('getBrandWCPayRequest', params, (payResult) => {
    if (payResult.err_msg === 'get_brand_wcpay_request:ok') { message.textContent = '支付请求已完成，正在确认订单状态…'; pollOrder(); }
    else if (payResult.err_msg !== 'get_brand_wcpay_request:cancel') message.textContent = payResult.err_msg || '支付未完成';
  });
}

simulate.addEventListener('click', async () => {
  if (!currentOrder) return;
  await fetch(`/api/v1/orders/${currentOrder.id}/simulate-paid`, { method: 'POST' });
  await pollOrder();
});

refreshStatus.addEventListener('click', async () => {
  refreshStatus.disabled = true;
  await pollOrder();
  refreshStatus.disabled = false;
});

copyOrder.addEventListener('click', async () => {
  if (!currentOrder) return;
  try {
    await navigator.clipboard.writeText(currentOrder.platformOrderNo);
    message.textContent = '订单号已复制';
  } catch {
    message.textContent = `订单号：${currentOrder.platformOrderNo}`;
  }
});

window.addEventListener('load', () => {
  const token = new URLSearchParams(location.search).get('oauth_token');
  const pending = sessionStorage.getItem(pendingOrderKey);
  if (!token || !pending) return;
  try {
    history.replaceState({}, document.title, `${location.pathname}${location.hash}`);
    createOrder({ ...JSON.parse(pending), oauthToken: token });
  } catch {
    sessionStorage.removeItem(pendingOrderKey);
  }
});

function updateCountdown() {
  if (!currentOrder?.expireAt) return;
  const seconds = Math.max(0, Math.floor((new Date(currentOrder.expireAt).getTime() - Date.now()) / 1000));
  countdown.textContent = `订单有效期：${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  if (seconds === 0 && !['SUCCESS', 'CLOSED', 'FAILED'].includes(currentOrder.status)) {
    status.textContent = '订单已过期';
    message.textContent = '订单已过期，请重新下单';
    clearInterval(pollTimer);
    clearInterval(countdownTimer);
  }
}

async function pollOrder() {
  if (!currentOrder) return;
  const response = await fetch(`/api/v1/orders/${currentOrder.id}`);
  const body = await response.json();
  if (!response.ok) return;
  currentOrder = body.data;
  status.textContent = currentOrder.status === 'SUCCESS' ? '支付成功' : currentOrder.status === 'CLOSED' ? '订单已关闭' : currentOrder.status === 'FAILED' ? '支付失败' : `待支付 · ${currentOrder.status}`;
  status.classList.toggle('success', currentOrder.status === 'SUCCESS');
  if (['SUCCESS', 'CLOSED', 'FAILED'].includes(currentOrder.status)) {
    clearInterval(pollTimer);
    clearInterval(countdownTimer);
    simulate.classList.add('hidden');
  }
  updateCountdown();
}
