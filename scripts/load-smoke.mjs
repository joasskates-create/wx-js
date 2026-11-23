const base = process.env.BASE_URL ?? 'http://127.0.0.1:3310';
const total = Number(process.env.REQUESTS ?? 100);
const started = Date.now();
let ok = 0;
await Promise.all(Array.from({ length: total }, async () => {
  const response = await fetch(`${base}/ready`);
  if (response.ok) ok += 1;
}));
const elapsed = Date.now() - started;
console.log(JSON.stringify({ base, total, ok, failed: total - ok, elapsedMs: elapsed, rps: Math.round(total / Math.max(elapsed / 1000, 0.001)) }, null, 2));
if (ok !== total) process.exitCode = 1;
