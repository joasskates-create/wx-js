import crypto from "node:crypto";
import type { Request } from "express";
import { config } from "../config.js";
import { authenticatePlatformMerchant, consumeMerchantRequestNonce } from "../db.js";

type RawRequest = Request & { rawBody?: Buffer };

export function merchantSignature(apiKey: string, method: string, path: string, timestamp: string, nonce: string, body: string): string {
  return crypto.createHmac("sha256", apiKey).update(`${timestamp}\n${nonce}\n${method.toUpperCase()}\n${path}\n${body}`).digest("hex");
}

export function verifyMerchantRequest(req: RawRequest): { merchant?: Record<string, unknown>; error?: string } {
  const apiKey = String(req.headers["x-merchant-key"] ?? "");
  const merchant = apiKey ? authenticatePlatformMerchant(apiKey) : undefined;
  if (!config.merchantSignatureRequired) return { merchant };
  const code = String(req.headers["x-merchant-code"] ?? "");
  const timestamp = String(req.headers["x-merchant-timestamp"] ?? "");
  const nonce = String(req.headers["x-merchant-nonce"] ?? "");
  const signature = String(req.headers["x-merchant-signature"] ?? "").toLowerCase();
  if (!merchant || !code || merchant.code !== code || !timestamp || !nonce || !signature) return { error: "MERCHANT_SIGNATURE_REQUIRED" };
  const clientIp = (req.ip ?? "").replace(/^::ffff:/i, "");
  if (config.merchantIpAllowlist.length > 0 && !config.merchantIpAllowlist.includes(clientIp)) return { error: "MERCHANT_IP_NOT_ALLOWED" };
  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp) || Math.abs(Date.now() - numericTimestamp * 1000) > config.merchantSignatureWindowSeconds * 1000) return { error: "MERCHANT_SIGNATURE_EXPIRED" };
  const expected = merchantSignature(apiKey, req.method, req.originalUrl, timestamp, nonce, (req as RawRequest).rawBody?.toString("utf8") ?? JSON.stringify(req.body ?? {}));
  const actualBuffer = Buffer.from(signature, "hex"); const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return { error: "MERCHANT_SIGNATURE_INVALID" };
  if (!consumeMerchantRequestNonce(String(merchant.id), nonce, new Date(Date.now() + config.merchantSignatureWindowSeconds * 1000).toISOString())) return { error: "MERCHANT_SIGNATURE_REPLAY" };
  return { merchant };
}
