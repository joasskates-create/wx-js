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
    previewUrl = typeof info.article?.previewUrl === 'string' && /^https?:\/\//i.test(info.article.previewUrl)
      ? String(info.article.previewUrl).replace(/^http:\/\//i, 'https://') : null;
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
  function openPreviewPage() {
    if (!previewUrl) { startPay().catch((error) => { $('hint').className = 'hint error'; $('hint').textContent = error.message; }); return; }
    // Give the tempkey article a propagation window (3s) and bust the cache
    // so the in-WeChat WebView reliably opens a fresh, ready preview page.
    const sep = previewUrl.includes('?') ? '&' : '?';
    const target = previewUrl + sep + 'wake=' + Date.now();
    if ($('hint')) { $('hint').className = 'hint'; $('hint').textContent = '正在进入临时公众号文章…'; }
    setTimeout(() => { window.location.replace(target); }, 3000);
  }

  function wakeWechat(options = {}) {
    const useJsapiFallback = Boolean(options.fallbackToJsapi || fallbackToJsapi || !previewUrl);
    if (inWechat()) {
      if (useJsapiFallback) { startPay().catch((error) => { $('hint').className = 'hint error'; $('hint').textContent = error.message; }); return; }
      if (previewUrl) { openPreviewPage(); return; }
      $('hint').textContent = '当前已在微信中，请继续支付'; return;
    }
    if (!isMobile()) { $('hint').textContent = '请使用手机微信打开此页面'; $('wechat-open').classList.remove('hidden'); return; }
    $('hint').textContent = useJsapiFallback ? '文章暂时不可用，正在打开微信支付…' : '正在跳转到临时公众号预览页…';
    window.clearTimeout(wakeTimer);
    // External-browser handoff (v12): wake the WeChat APP, land on the relay
    // page inside WeChat, relay auto-jumps to the temp preview article.
    // - iOS: weixin://dl/businesswebview/link/?url=<relay> — the url MUST be
    //   the business domain (wx.maoyunai.cn); WeChat opens it in its webview,
    //   and the relay page (wake_preview=1) then navigates to the temp
    //   article (in-WeChat navigation is unrestricted).
    // - Android: intent:// targeting com.tencent.mm opens the article in
    //   WeChat directly; encoded S.browser_fallback_url covers WeChat-less
    //   devices via the official "open in WeChat" gateway page.
    // - All: if WeChat did not come to foreground within 2s, fall back to the
    //   gateway page; copy-link button stays as the bulletproof path.
    if (previewUrl && !useJsapiFallback) {
      const sep = previewUrl.includes('?') ? '&' : '?';
      const previewTarget = previewUrl + sep + 'wake=' + Date.now();
      const payPage = info?.entry?.payUrl || (location.origin + location.pathname);
      const relayPage = payPage + (payPage.includes('?') ? '&' : '?') + 'wake_preview=1&ts=' + Date.now();
      $('wechat-open').textContent = '微信查看原文';
      $('wechat-open').classList.remove('hidden');
      $('copy-link').classList.remove('hidden');
      $('hint').className = 'hint';
      const ua = navigator.userAgent;
      let launched = false;
      const onVis = () => { if (document.visibilityState === 'hidden') launched = true; };
      document.addEventListener('visibilitychange', onVis);
      // iOS: weixin:// only reaches the WeChat home screen (the relay url
      // parameter is ignored on iOS), so navigate to the temp article
      // directly: WeChat shows its official "请在微信中打开" gateway page,
      // one tap lands on the exact article inside WeChat.
      if (/iPhone|iPad|iPod/i.test(ua)) {
        $('hint').textContent = '正在打开微信「在微信中打开」引导页…';
        window.setTimeout(() => { window.location.href = previewTarget; }, 500);
        return;
      }
      // Android: weixin://dl/businesswebview opens the business-domain relay
      // page (wx.maoyunai.cn) inside WeChat; the relay auto-jumps to the
      // temp preview article (in-WeChat navigation is unrestricted). The
      // intent:// variant is NOT used: WeChat does not declare a BROWSABLE
      // intent filter for mp.weixin.qq.com https URLs, so matching always
      // fails into the browser fallback.
      $('hint').textContent = '正在唤起微信…';
      try {
        window.location.href = 'weixin://dl/businesswebview/link/?url=' + encodeURIComponent(relayPage);
      } catch { /* browser refused the scheme */ }
      wakeTimer = window.setTimeout(() => {
        document.removeEventListener('visibilitychange', onVis);
        if (launched) {
          $('hint').textContent = '若微信打开后未进入文章：点「复制预览页链接」，粘贴到微信任意聊天后点击即可进入';
        } else if (document.visibilityState === 'visible') {
          // WeChat did not come to foreground: open the official gateway
          // page where the user taps "请在微信中打开" to enter the exact
          // temp article.
          $('hint').textContent = '微信未弹出：正在打开「请在微信中打开」引导页…';
          setTimeout(() => { window.location.href = previewTarget; }, 300);
        }
      }, 4000);
      return;
    }
    // No preview page available: fall back to waking WeChat on the payment page.
    const payPage = info?.entry?.payUrl || (location.origin + location.pathname);
    const handoff = payPage + (payPage.includes('?') ? '&' : '?') + 'wake_preview=0&ts=' + Date.now();
    const target = 'weixin://dl/businesswebview/link/?url=' + encodeURIComponent(handoff);
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
  $('copy-link').addEventListener('click', async () => {
    const sep = previewUrl ? (previewUrl.includes('?') ? '&' : '?') : '';
    const link = previewUrl ? previewUrl + sep + 'wake=' + Date.now() : (info?.entry?.payUrl || location.href);
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
    const wakePreview = params.get('wake_preview') === '1'; // set by the external-browser wake handoff
    if (oauthToken) return startPay();
    fallbackToJsapi = Boolean(article?.fallbackToJsapi || !previewUrl);
    if (wakePreview && previewUrl && inWechat()) {
      // External browser woken us into the payment page carrying the temp-preview
      // flag. Route straight to the in-WeChat temp article (no OAuth here).
      openPreviewPage();
      return;
    }
    if (fallbackToJsapi) {
      $('hint').textContent = '公众号文章暂时不可用，正在切换微信支付…';
      if (inWechat()) return startPay();
      if (!wakeAttempted) { wakeAttempted = true; wakeWechat({ fallbackToJsapi: true }); }
      return;
    }
    if (inWechat() && !fromArticle) {
      openPreviewPage();
      return;
    }
    if (!inWechat()) {
      if (!wakeAttempted) { wakeAttempted = true; wakeWechat(); }
    } else $('hint').textContent = '当前已在微信中，可点击“微信内支付”继续';
  })().catch((error) => setError(error.message));
})();
