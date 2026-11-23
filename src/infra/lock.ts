import crypto from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { config } from "../config.js";

const localLocks = new Map<string, number>();
let redisClient: RedisClientType | undefined;
let redisConnecting: Promise<RedisClientType | undefined> | undefined;

async function getRedis(): Promise<RedisClientType | undefined> {
  if (!config.redisUrl) return undefined;
  if (redisClient?.isReady) return redisClient;
  if (!redisConnecting) {
    redisConnecting = (async () => {
      try {
        const client = createClient({ url: config.redisUrl });
        client.on("error", () => undefined);
        await client.connect();
        redisClient = client as RedisClientType;
        return redisClient;
      } catch { return undefined; }
      finally { redisConnecting = undefined; }
    })();
  }
  return redisConnecting;
}

export async function withDistributedLock<T>(name: string, ttlMs: number, work: () => Promise<T>): Promise<T | undefined> {
  const token = crypto.randomBytes(16).toString("hex");
  const redis = await getRedis();
  if (redis) {
    const acquired = await redis.set(`wechat-pay:lock:${name}`, token, { NX: true, PX: ttlMs });
    if (acquired !== "OK") return undefined;
    try { return await work(); }
    finally {
      try { await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", { keys: [`wechat-pay:lock:${name}`], arguments: [token] }); } catch { /* lock expiry is the fallback */ }
    }
  }
  const now = Date.now();
  const expires = localLocks.get(name) ?? 0;
  if (expires > now) return undefined;
  localLocks.set(name, now + ttlMs);
  try { return await work(); }
  finally { if ((localLocks.get(name) ?? 0) <= now + ttlMs) localLocks.delete(name); }
}
