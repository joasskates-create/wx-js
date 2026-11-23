import crypto from "node:crypto";

type AccessToken = { token: string; expiresAt: number };
const accessTokens = new Map<string, AccessToken>();

function jsonHeaders(): HeadersInit { return { "content-type": "application/json" }; }

async function readWechatJson(response: Response): Promise<Record<string, any>> {
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw new Error(`WECHAT_HTTP_${response.status}`);
  if (Number(body.errcode || 0) !== 0) throw new Error(`WECHAT_API_${body.errcode}:${body.errmsg || "UNKNOWN"}`);
  return body;
}

export async function getPublicAccountAccessToken(appId: string, appSecret: string): Promise<string> {
  const cached = accessTokens.get(appId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const body = await readWechatJson(await fetch(url));
  const token = String(body.access_token || "");
  if (!token) throw new Error("WECHAT_ACCESS_TOKEN_EMPTY");
  accessTokens.set(appId, { token, expiresAt: Date.now() + Math.max(60, Number(body.expires_in || 7200)) * 1000 });
  return token;
}

function imageBuffer(dataUrl: string): Buffer {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error("QR_DATA_URL_INVALID");
  return Buffer.from(match[2], "base64");
}

async function uploadImage(accessToken: string, dataUrl: string, filename: string, permanent = false): Promise<Record<string, any>> {
  const form = new FormData();
  const bytes = new Uint8Array(imageBuffer(dataUrl));
  form.append("media", new Blob([bytes], { type: "image/png" }), filename);
  const endpoint = permanent
    ? `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${encodeURIComponent(accessToken)}&type=thumb`
    : `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(accessToken)}`;
  return readWechatJson(await fetch(endpoint, { method: "POST", body: form }));
}

export interface ArticleDraftResult { draftMediaId: string; previewUrl: string | null; qrMediaUrl: string; coverMediaId?: string; }

async function getDraftPreviewUrl(accessToken: string, draftMediaId: string): Promise<string | null> {
  const delays = [0, 500, 1_000, 2_000, 4_000, 8_000];
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const draft = await readWechatJson(await fetch(`https://api.weixin.qq.com/cgi-bin/draft/get?access_token=${encodeURIComponent(accessToken)}`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ media_id: draftMediaId })
      }));
      const item = Array.isArray(draft.news_item) ? draft.news_item[0] : undefined;
      let url = typeof item?.url === "string" ? item.url.trim() : "";
      if (!/^https?:\/\//i.test(url)) continue;
      // WeChat draft/get may return the temp-article link as http://; upgrade
      // it so the external handoff and in-WeChat WebView use HTTPS.
      if (/^http:\/\//i.test(url)) url = url.replace(/^http:/i, "https:");
      if (/^https:\/\/mp\.weixin\.qq\.com\//i.test(url)) return url;
    } catch {
      // Temporary propagation/API errors are retried with backoff. The caller
      // still retains its JSAPI fallback if the preview never becomes ready.
    }
  }
  return null;
}

export async function createPublicAccountArticle(input: {
  appId: string;
  appSecret: string;
  title: string;
  description: string;
  amountYuan: string;
  payUrl: string;
  qrDataUrl: string;
  mock?: boolean;
}): Promise<ArticleDraftResult> {
  if (input.mock) {
    const id = crypto.createHash("sha256").update(`${input.appId}:${input.payUrl}`).digest("hex").slice(0, 24);
    return { draftMediaId: `mock-draft-${id}`, previewUrl: null, qrMediaUrl: input.qrDataUrl };
  }
  const accessToken = await getPublicAccountAccessToken(input.appId, input.appSecret);
  const image = await uploadImage(accessToken, input.qrDataUrl, `payment-${Date.now()}.png`, false);
  const qrMediaUrl = String(image.url || "");
  if (!qrMediaUrl) throw new Error("WECHAT_QR_IMAGE_URL_EMPTY");
  const cover = await uploadImage(accessToken, input.qrDataUrl, `cover-${Date.now()}.png`, true);
  const coverMediaId = String(cover.media_id || "");
  if (!coverMediaId) throw new Error("WECHAT_COVER_MEDIA_ID_EMPTY");
  const content = `<p>${input.description}</p><p>订单金额：${input.amountYuan} 元</p><h2>请长按识别二维码继续支付</h2><p><img src="${qrMediaUrl}" /></p><p>支付入口：<a href="${input.payUrl}">${input.payUrl}</a></p>`;
  const draft = await readWechatJson(await fetch(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST", headers: jsonHeaders(), body: JSON.stringify({
      articles: [{ article_type: "news", title: input.title, author: "", digest: input.description, content, content_source_url: input.payUrl, thumb_media_id: coverMediaId, need_open_comment: 0, only_fans_can_comment: 0 }]
    })
  }));
  const draftMediaId = String(draft.media_id || "");
  if (!draftMediaId) throw new Error("WECHAT_DRAFT_MEDIA_ID_EMPTY");
  // draft/add only returns the media_id. draft/get may expose the temporary
  // article URL in news_item[0].url; some account/API versions do not return
  // it, so callers must retain the fallback path when it is unavailable.
  const previewUrl = await getDraftPreviewUrl(accessToken, draftMediaId);
  return { draftMediaId, previewUrl, qrMediaUrl, coverMediaId };
}
