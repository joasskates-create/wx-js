(function () {
  const token = location.pathname.split('/').filter(Boolean).pop() || '';
  const $ = (id) => document.getElementById(id);
  let info;
  let previewUrl = null;
  let previewAppId = null;
  let fallbackToJsapi = false;
  let wakeAttempted = false;
  let wakeTimer;
  let handoff = null;
  let handoffPromise = null;
  const WAKE_WAIT_MS = 12_000;

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
  function telemetry(eventType, detail = {}) {
    try {
      fetch('/api/v1/public-pay/' + encodeURIComponent(token) + '/telemetry', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventType, detail }), keepalive: true
      }).catch(() => {});
    } catch { /* telemetry must never interrupt payment */ }
  }
  function syncWechatActions(payable) {
    const insideWechat = inWechat();
    $('wechat-open').classList.toggle('hidden', insideWechat || !payable);
    $('pay').classList.toggle('hidden', !insideWechat || !payable);
    if (!payable) {
      $('wechat-open').classList.add('hidden');
      $('copy-link').classList.add('hidden');
      $('pay').classList.add('hidden');
    }
  }
  async function load() {
    const response = await fetch('/api/v1/public-pay/' + encodeURIComponent(token));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || '支付入口不可用');
    info = body.data;
    previewAppId = typeof info.article?.appId === 'string' ? info.article.appId : null;
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
    return { payable, article: info.article || { status: 'PENDING', appId: null, fallbackToJsapi: false } };
  }
  async function ensureHandoff() {
    if (!previewUrl) return null;
    if (handoff && new Date(handoff.expiresAt).getTime() > Date.now() + 15_000) return handoff;
    if (handoffPromise) return handoffPromise;
    handoffPromise = (async () => {
      const response = await fetch('/api/v1/public-pay/' + encodeURIComponent(token) + '/handoff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || body.error || '微信中转链接生成失败');
      handoff = body.data;
      if (typeof handoff.appId === 'string' && handoff.appId) previewAppId = handoff.appId;
      return handoff;
    })();
    try { return await handoffPromise; } finally { handoffPromise = null; }
  }
  function openPreviewPage() {
    if (!previewUrl) { startPay().catch((error) => { $('hint').className = 'hint error'; $('hint').textContent = error.message; }); return; }
    telemetry('PREVIEW_NAVIGATION_ATTEMPTED', { source: 'in_wechat' });
    $('hint').className = 'hint';
    $('hint').textContent = '正在进入临时公众号文章…';
    window.setTimeout(() => { window.location.replace(previewUrl); }, 120);
  }
  function showCopyFallback() {
    $('wechat-open').classList.remove('hidden');
    $('copy-link').classList.remove('hidden');
    $('hint').textContent = '如果微信没有进入文章，请点击“复制预览页链接”，在微信聊天中粘贴打开';
  }
  function wechatWebviewScheme(targetUrl) {
    const params = new URLSearchParams();
    if (previewAppId) params.set('appid', previewAppId);
    params.set('url', targetUrl);
    return 'weixin://dl/businesswebview/link/?' + params.toString();
  }
  async function wakeWechat(options = {}) {
    const useJsapiFallback = Boolean(options.fallbackToJsapi || fallbackToJsapi || !previewUrl);
    if (inWechat()) {
      if (useJsapiFallback) { startPay().catch((error) => { $('hint').className = 'hint error'; $('hint').textContent = error.message; }); return; }
      openPreviewPage();
      return;
    }
    if (!isMobile()) { $('hint').textContent = '请使用手机微信打开此页面'; showCopyFallback(); return; }
    $('hint').textContent = useJsapiFallback ? '文章暂时不可用，正在打开微信支付…' : '正在唤醒微信并进入临时公众号文章…';
    window.clearTimeout(wakeTimer);
    if (useJsapiFallback) {
      const payPage = info?.entry?.payUrl || location.href;
      const target = wechatWebviewScheme(payPage);
      telemetry('WAKE_ATTEMPTED', { target: 'jsapi', platform: /Android/i.test(navigator.userAgent) ? 'android' : 'ios' });
      try { window.location.href = target; } catch { /* browser refused the scheme */ }
      wakeTimer = window.setTimeout(showCopyFallback, WAKE_WAIT_MS);
      return;
    }
    let targetUrl;
    try {
      const current = await ensureHandoff();
      targetUrl = current?.bridgeUrl || previewUrl;
    } catch (error) {
      telemetry('WAKE_HANDOFF_UNAVAILABLE', { reason: error instanceof Error ? error.message : 'HANDOFF_CREATE_FAILED' });
      $('hint').className = 'hint error';
      $('hint').textContent = '公众号中转链接暂时不可用，请稍后重新点击“打开微信继续支付”';
      showCopyFallback();
      return;
    }
    const ua = navigator.userAgent;
    const platform = /Android/i.test(ua) ? 'android' : 'ios';
    telemetry('WAKE_ATTEMPTED', { target: targetUrl === previewUrl ? 'preview_fallback' : 'bridge', platform });
    let launched = false;
    const markLaunched = () => {
      if (launched) return;
      launched = true;
      telemetry('WAKE_APP_SWITCHED', { platform });
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') markLaunched();
    };
    const onPageHide = () => markLaunched();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onPageHide, { once: true });
    // Both platforms first receive the same direct user-gesture Scheme attempt.
    // iOS may ignore the url parameter; the timed fallback opens the official
    // WeChat gateway for the exact preview URL.
    try { window.location.href = wechatWebviewScheme(targetUrl); } catch { /* browser refused the scheme */ }
    wakeTimer = window.setTimeout(() => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onPageHide);
      if (launched) {
        $('hint').textContent = '微信已打开，正在加载临时公众号文章…';
        return;
      }
      telemetry('WAKE_WAIT_TIMEOUT', { platform, waitMs: WAKE_WAIT_MS });
      $('hint').className = 'hint error';
      $('hint').textContent = '微信可能正在启动，请稍候；如果仍未进入，请再次点击“打开微信继续支付”';
      showCopyFallback();
    }, WAKE_WAIT_MS);
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
  $('copy-link').addEventListener('click', async () => {
    const link = handoff?.bridgeUrl || previewUrl || info?.entry?.payUrl || location.href;
    telemetry('COPY_LINK_USED', { target: handoff?.bridgeUrl ? 'bridge' : 'preview' });
    try {
      await navigator.clipboard.writeText(link);
      $('hint').className = 'hint';
      $('hint').textContent = '链接已复制：打开微信 → 任意聊天 → 粘贴 → 点链接即可进入';
    } catch {
      window.prompt('复制下方链接，打开微信粘贴到任意聊天后点击：', link);
    }
  });
  $('pay').addEventListener('click', () => startPay().catch((error) => { $('hint').className = 'hint error'; $('hint').textContent = error.message; $('pay').disabled = false; }));
  (async function start() {
    const deadline = Date.now() + 15_000;
    let result;
    do {
      result = await load();
      const pending = result.payable && ['PENDING', 'CREATING', 'PROCESSING'].includes(String(result.article?.status || ''));
      if (!pending || Date.now() >= deadline) break;
      $('hint').textContent = '请稍候，正在准备支付…';
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    } while (Date.now() < deadline);
    const { payable, article } = result;
    $('loading-view').classList.add('hidden');
    $('order-view').classList.remove('hidden');
    syncWechatActions(payable);
    if (!payable) { $('hint').textContent = '订单已支付、关闭或过期'; return; }
    const params = new URLSearchParams(location.search);
    const oauthToken = params.get('oauth_token');
    const wakePreview = params.get('wake_preview') === '1';
    if (oauthToken) return startPay();
    fallbackToJsapi = Boolean(article?.fallbackToJsapi || !previewUrl);
    if (fallbackToJsapi) {
      $('hint').textContent = '公众号文章暂时不可用，正在切换微信支付…';
      if (inWechat()) return startPay();
      if (!wakeAttempted) { wakeAttempted = true; wakeWechat({ fallbackToJsapi: true }); }
      return;
    }
    // Prepare the one-time relay ticket before a user gesture is needed.
    ensureHandoff().catch(() => {});
    if (wakePreview && inWechat()) { openPreviewPage(); return; }
    if (inWechat()) { openPreviewPage(); return; }
    if (!wakeAttempted) { wakeAttempted = true; wakeWechat(); }
  })().catch((error) => setError(error.message));
})();
