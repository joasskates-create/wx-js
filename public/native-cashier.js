const form = document.querySelector('#native-order-form');
const amountInput = document.querySelector('#native-amount');
const descriptionInput = document.querySelector('#native-description');
const result = document.querySelector('#native-result');
const qr = document.querySelector('#native-qr');
const status = document.querySelector('#native-status');
const orderMeta = document.querySelector('#native-order-meta');
const message = document.querySelector('#native-message');
const simulate = document.querySelector('#native-simulate');
const countdown = document.querySelector('#native-countdown');
const refreshStatus = document.querySelector('#native-refresh-status');
const copyOrder = document.querySelector('#native-copy-order');
let currentOrder;
let pollTimer;
let countdownTimer;

document.querySelectorAll('[data-amount]').forEach((button) => {
  button.addEventListener('click', () => { amountInput.value = button.dataset.amount; });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '正在调用微信 Native 下单…';
  const response = await fetch('/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchantId: 'demo-merchant',
      clientRequestNo: `native_cashier_${Date.now()}`,
      amount: Number(amountInput.value),
      description: descriptionInput.value,
      paymentMethod: 'NATIVE',
      collectionMode: 'NATIVE',
      entryMode: 'DIRECT'
    })
  });
  const body = await response.json();
  if (!response.ok) { message.textContent = body.message || body.error || '下单失败'; return; }
  renderOrder(body);
});

function renderOrder(body) {
  currentOrder = body.data;
  result.classList.remove('hidden');
  status.classList.remove('success');
  qr.src = currentOrder.qrDataUrl || '';
  status.textContent = `待支付 · 通道 ${currentOrder.channelId}`;
  orderMeta.innerHTML = `订单号：${currentOrder.platformOrderNo}<br>金额：¥${(currentOrder.amount / 100).toFixed(2)}<br>有效期：${new Date(currentOrder.expireAt).toLocaleString()}`;
  simulate.classList.toggle('hidden', body.provider !== 'mock');
  message.textContent = '请使用微信扫一扫完成 Native 支付。';
  clearInterval(pollTimer);
  clearInterval(countdownTimer);
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
  pollTimer = setInterval(pollOrder, 2000);
  pollOrder();
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
