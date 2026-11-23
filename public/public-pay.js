(function () {
  const token = location.pathname.split('/').filter(Boolean).pop() || '';
  const $ = (id) => document.getElementById(id);
  let info;
  let previewUrl = null;
  let fallbackToJsapi = false;
  let wakeAttempted = false;
  let wakeTimer;

  function inWechat() { return /MicroMessenger/i.test(navigator.userAgent); }
  function isMobile() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }
  function formatDate(value) {
    if (!value) return '--';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
  }
  function setError(message) {
    $('loading-view').classList.add('hidden');
    $('order-view').classList.remove('hidden');
    $('hint').className = 'hint error';
    $('hint').textContent = message;
  }
  function syncWechatActions(payable) {
    const insideWechat = inWechat();
    $('wechat-open').classList.toggle('hidden', insideWechat || !payable);
    $('pay').classList.toggle('hidden', !insideWechat || !payable);
    if (!payable) {
      $('wechat-open').classList.add('hidden');
      $('pay').classList.add('hidden');
    }
  }
  async function load() {
    const response = await fetch('/api/v1/public-pay/' + encodeURIComponent(token));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || '支付入口不可用');
    info = body.data;
    previewUrl = typeof info.article?.previewUrl === 'string' && /^https:\/\//i.test(info.article.previewUrl)
      ? info.article.previewUrl : null;
    const order = info.order || {};
    $('description').textContent = order.description || '订单支付';
    $('amount').textContent = (Number(order.amount) / 100).toFixed(2) + ' 元';
    $('order-no').textContent = order.platformOrderNo || '--';
    $('created-at').textContent = formatDate(order.createdAt);
    $('expire-at').textContent = formatDate(order.expireAt);
    $('status').textContent = '订单状态：' + (order.status || '--');
    if (info.entry.qrDataUrl) { $('qr').src = info.entry.qrDataUrl; $('qr').hidden = false; }
    const payable = info.entry.status === 'ACTIVE' && ['CREATED', 'ROUTED', 'QR_CREATED'].includes(order.status);
    return { payable, article: info.article || { status: 'PENDING', fallbackToJsapi: false } };
  }
  function wakeWechat(options = {}) {
    const useJsapiFallback = Boolean(options.fallbackToJsapi || fallbackToJsapi || !previewUrl);
    if (inWechat()) {
      if (useJsapiFallback) { startPay().catch((error) => { $('hint').className = 'hint error'; $('hint').textContent = error.message; }); return; }
      if (previewUrl) { window.location.replace(previewUrl); return; }
      $('hint').textContent = '当前已在微信中，请继续支付'; return;
    }
    if (!isMobile()) { $('hint').textContent = '请使用手机微信打开此页面'; $('wechat-open').classList.remove('hidden'); return; }
    $('hint').textContent = useJsapiFallback ? '文章暂时不可用，正在打开微信支付…' : '正在尝试打开微信并进入临时文章…';
    window.clearTimeout(wakeTimer);
    // This internal WebView scheme is best-effort only. If the client/browser
    // refuses it, the fallback button remains available.
    const targetUrl = useJsapiFallback ? info?.entry?.payUrl : previewUrl;
    const target = targetUrl
      ? 'weixin://dl/businessWebview/link/?url=' + encodeURIComponent(targetUrl)
      : 'weixin://';
    try { window.location.href = target; } catch { /* browser refused the scheme */ }
    wakeTimer = window.setTimeout(() => {
      $('wechat-open').classList.remove('hidden');
      $('hint').textContent = '如果微信没有打开，请点击下方按钮重试';
    }, 1400);
  }
  async function startPay() {
    if (!inWechat()) { wakeWechat(); return; }
    const oauthToken = new URLSearchParams(location.search).get('oauth_token');
    if (!oauthToken) { location.href = '/api/v1/public-pay/' + encodeURIComponent(token) + '/oauth/start'; return; }
    $('pay').disabled = true; $('hint').textContent = '正在创建微信支付…';
    const response = await fetch('/api/v1/public-pay/' + encodeURIComponent(token) + '/pay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ oauthToken }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || body.error || '创建支付失败');
    const p = body.payment;
    const invoke = () => WeixinJSBridge.invoke('getBrandWCPayRequest', { appId: p.appId, timeStamp: p.timeStamp, nonceStr: p.nonceStr, package: p.package, signType: p.signType, paySign: p.paySign }, function (result) {
      if (result.err_msg === 'get_brand_wcpay_request:ok') { $('hint').textContent = '支付已提交，请稍候…'; setTimeout(load, 1200); }
      else { $('hint').textContent = '支付未完成：' + result.err_msg; $('pay').disabled = false; }
    });
    if (window.WeixinJSBridge) invoke(); else document.addEventListener('WeixinJSBridgeReady', invoke, { once: true });
  }
  $('wechat-open').addEventListener('click', () => wakeWechat({ fallbackToJsapi }));
  $('pay').addEventListener('click', () => startPay().catch((error) => { $('hint').className = 'hint error'; $('hint').textContent = error.message; $('pay').disabled = false; }));
  (async function start() {
    const deadline = Date.now() + 15_000;
    let result;
    do {
      result = await load();
      const pending = result.payable && ['PENDING', 'CREATING', 'PROCESSING'].includes(String(result.article?.status || ''));
      if (!pending || Date.now() >= deadline) break;
      $('hint').textContent = '请稍候，正在准备支付…';
      await new Promise((resolve) => setTimeout(resolve, 1200));
    } while (Date.now() < deadline);
    const { payable, article } = result;
    $('loading-view').classList.add('hidden');
    $('order-view').classList.remove('hidden');
    syncWechatActions(payable);
    if (!payable) { $('hint').textContent = '订单已支付、关闭或过期'; return; }
    const params = new URLSearchParams(location.search);
    const oauthToken = params.get('oauth_token');
    const fromArticle = params.get('from_article') === '1';
    if (oauthToken) return startPay();
    fallbackToJsapi = Boolean(article?.fallbackToJsapi || !previewUrl);
    if (fallbackToJsapi) {
      $('hint').textContent = '公众号文章暂时不可用，正在切换微信支付…';
      if (inWechat()) return startPay();
      if (!wakeAttempted) { wakeAttempted = true; wakeWechat({ fallbackToJsapi: true }); }
      return;
    }
    if (inWechat() && !fromArticle) {
      $('hint').textContent = '正在进入临时公众号文章…';
      window.location.replace(previewUrl);
      return;
    }
    if (!inWechat()) {
      if (!wakeAttempted) { wakeAttempted = true; wakeWechat(); }
    } else $('hint').textContent = '当前已在微信中，可点击“微信内支付”继续';
  })().catch((error) => setError(error.message));
})();
