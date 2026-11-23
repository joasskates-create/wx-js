const form = document.querySelector('#order-form');
const amountInput = document.querySelector('#amount');
const descriptionInput = document.querySelector('#description');
const collectionModeInput = document.querySelector('#collection-mode');
const paymentMethodInput = document.querySelector('#payment-method');
const entryModeInput = document.querySelector('#entry-mode');
const result = document.querySelector('#result');
const qr = document.querySelector('#qr');
const jsapiPay = document.querySelector('#jsapi-pay');
const status = document.querySelector('#status');
const orderMeta = document.querySelector('#order-meta');
const message = document.querySelector('#message');
const simulate = document.querySelector('#simulate');
const countdown = document.querySelector('#countdown');
const refreshStatus = document.querySelector('#refresh-status');
const copyOrder = document.querySelector('#copy-order');
const pendingOrderKey = 'wechat_pending_jsapi_order';
let currentOrder;
let pollTimer;
let countdownTimer;

document.querySelectorAll('[data-amount]').forEach((button) => {
  button.addEventListener('click', () => { amountInput.value = button.dataset.amount; });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const paymentMethod = paymentMethodInput.value;
  const collectionMode = collectionModeInput?.value || 'NATIVE';
  const entryMode = entryModeInput?.value || 'DIRECT';
  message.textContent = collectionMode === 'QR' ? '正在分配挂码…' : entryMode === 'PUBLIC_ACCOUNT_ARTICLE' ? '正在生成公众号临时图文…' : paymentMethod === 'JSAPI' ? '正在准备公众号授权…' : '正在调用微信 Native 下单…';
  await createOrder({
    merchantId: 'demo-merchant',
    clientRequestNo: `cashier_${Date.now()}`,
    amount: Number(amountInput.value),
    description: descriptionInput.value,
    paymentMethod,
    collectionMode,
    entryMode,
    ...(paymentMethod === 'JSAPI' && entryMode === 'DIRECT' ? { oauthReturnUrl: `${location.origin}${location.pathname}` } : {})
  });
});

collectionModeInput?.addEventListener('change', () => {
  const qrMode = collectionModeInput.value === 'QR';
  const jsapiOption = paymentMethodInput.querySelector('option[value="JSAPI"]');
  if (jsapiOption) jsapiOption.disabled = qrMode;
  if (qrMode && paymentMethodInput.value === 'JSAPI') paymentMethodInput.value = 'NATIVE';
});

async function createOrder(payload) {
  const response = await fetch('/api/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
  const paymentMethod = body.data?.paymentMethod || paymentMethodInput.value;
  const collectionMode = body.data?.collectionMode || collectionModeInput?.value || 'NATIVE';
  currentOrder = body.data;
  result.classList.remove('hidden');
  status.classList.remove('success');
  qr.classList.toggle('hidden', paymentMethod !== 'NATIVE');
  jsapiPay.classList.toggle('hidden', paymentMethod !== 'JSAPI' || body.provider === 'PUBLIC_ACCOUNT_ARTICLE');
  if (paymentMethod === 'NATIVE') qr.src = currentOrder.qrDataUrl;
  if (body.provider === 'PUBLIC_ACCOUNT_ARTICLE') { qr.classList.remove('hidden'); qr.src = body.entry?.qrDataUrl || ''; }
  status.textContent = `待支付 · 通道 ${currentOrder.channelId}`;
  orderMeta.innerHTML = `订单号：${currentOrder.platformOrderNo}<br>金额：¥${(currentOrder.amount / 100).toFixed(2)}<br>有效期：${new Date(currentOrder.expireAt).toLocaleString()}`;
  simulate.classList.toggle('hidden', body.provider !== 'mock');
  message.textContent = body.provider === 'PUBLIC_ACCOUNT_ARTICLE' ? `公众号临时图文已生成：${body.entry?.previewUrl || ''}；请在微信内打开专属页面支付。` : collectionMode === 'QR' ? '请使用微信扫一扫完成挂码支付。' : paymentMethod === 'JSAPI' ? '订单已创建，请点击“调起微信支付”。' : '请使用微信扫一扫完成 Native 支付。';
  if (paymentMethod === 'JSAPI' && body.payment) {
    jsapiPay.dataset.params = JSON.stringify(body.payment);
    if (window.WeixinJSBridge) invokeJsapiPay(body.payment);
  }
  clearInterval(pollTimer);
  clearInterval(countdownTimer);
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
  pollTimer = setInterval(pollOrder, 2000);
  pollOrder();
}

jsapiPay.addEventListener('click', () => {
  try { invokeJsapiPay(JSON.parse(jsapiPay.dataset.params || '{}')); } catch { message.textContent = '公众号支付参数无效，请重新下单'; }
});

function invokeJsapiPay(params) {
  if (!window.WeixinJSBridge?.invoke) { message.textContent = '请在微信内打开页面后发起公众号支付'; return; }
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

refreshStatus.addEventListener('click', async () => { refreshStatus.disabled = true; await pollOrder(); refreshStatus.disabled = false; });
copyOrder.addEventListener('click', async () => { if (!currentOrder) return; try { await navigator.clipboard.writeText(currentOrder.platformOrderNo); message.textContent = '订单号已复制'; } catch { message.textContent = `订单号：${currentOrder.platformOrderNo}`; } });

window.addEventListener('load', () => {
  const token = new URLSearchParams(location.search).get('oauth_token');
  const pending = sessionStorage.getItem(pendingOrderKey);
  if (!token || !pending) return;
  try {
    history.replaceState({}, document.title, `${location.pathname}${location.hash}`);
    createOrder({ ...JSON.parse(pending), oauthToken: token });
  } catch { sessionStorage.removeItem(pendingOrderKey); }
});

function updateCountdown() {
  if (!currentOrder?.expireAt) return;
  const seconds = Math.max(0, Math.floor((new Date(currentOrder.expireAt).getTime() - Date.now()) / 1000));
  countdown.textContent = `订单有效期：${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  if (seconds === 0 && !['SUCCESS', 'CLOSED', 'FAILED'].includes(currentOrder.status)) { status.textContent = '订单已过期'; message.textContent = '订单已过期，请重新下单'; clearInterval(pollTimer); clearInterval(countdownTimer); }
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
