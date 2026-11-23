const base = process.env.BASE_URL ?? 'http://127.0.0.1:3310';
const cases = [
  ['ready', `${base}/ready`],
  ['unknown-channel', `${base}/webhooks/wechatpay/missing`],
  ['malformed-transaction', `${base}/webhooks/wechatpay/demo-channel`],
  ['malformed-refund', `${base}/webhooks/wechatpay/demo-channel/refund`]
];
const results = [];
for (const [name, url] of cases) {
  const options = name.startsWith('malformed') ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' } : {};
  const response = await fetch(url, options);
  results.push({ name, status: response.status });
}
const health = await fetch(`${base}/health`);
if (!health.ok) throw new Error(`HEALTH_FAILED:${health.status}`);
console.log(JSON.stringify({ ok: true, results }, null, 2));
