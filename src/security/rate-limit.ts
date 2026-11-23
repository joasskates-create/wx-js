import type { NextFunction, Request, Response } from "express";

const buckets = new Map<string, { startedAt: number; count: number }>();

export function rateLimit(options: { windowMs: number; max: number; key?: (req: Request) => string }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = options.key?.(req) ?? req.ip ?? "unknown";
    const now = Date.now();
    const current = buckets.get(key);
    const bucket = !current || now - current.startedAt >= options.windowMs ? { startedAt: now, count: 0 } : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > options.max) {
      res.setHeader("Retry-After", Math.ceil((options.windowMs - (now - bucket.startedAt)) / 1000));
      res.status(429).json({ error: "RATE_LIMITED" });
      return;
    }
    next();
  };
}

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, bucket] of buckets) if (bucket.startedAt < cutoff) buckets.delete(key);
}, 10 * 60 * 1000).unref();
