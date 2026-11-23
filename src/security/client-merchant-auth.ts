import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { createClientMerchantSession, deleteClientMerchantSession, getClientMerchantByUsername, getClientMerchantFromSession, recordClientMerchantLoginFailure, resetClientMerchantLoginFailures } from "../db.js";
import { verifyPassword } from "./password.js";
import { verifyTotp } from "./totp.js";

export interface ClientMerchantRequest extends Request { clientMerchant?: Record<string, unknown>; }
function tokenHash(token: string): string { return crypto.createHash("sha256").update(token).digest("hex"); }
function sessionToken(req: Request): string | undefined { const cookie = req.headers.cookie ?? ""; return (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined) ?? req.headers["x-client-merchant-session"]?.toString() ?? cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("client_merchant_session="))?.slice("client_merchant_session=".length); }
export function loginClientMerchant(username: string, password: string, otp?: string): { token: string; merchant: Record<string, unknown> } | { error: string } {
  const user = getClientMerchantByUsername(username);
  if (!user || user.status !== "ACTIVE") return { error: "CLIENT_MERCHANT_INVALID_CREDENTIALS" };
  if (user.lockedUntil && new Date(String(user.lockedUntil)).getTime() > Date.now()) return { error: "CLIENT_MERCHANT_LOGIN_LOCKED" };
  if (!user.passwordHash || !verifyPassword(password, user.passwordHash)) { recordClientMerchantLoginFailure(String(user.id)); return { error: "CLIENT_MERCHANT_INVALID_CREDENTIALS" }; }
  if (Number(user.twoFactorEnabled || 0) === 1 && (!otp || !user.twoFactorSecret || !verifyTotp(user.twoFactorSecret, otp))) return { error: "CLIENT_MERCHANT_2FA_REQUIRED" };
  resetClientMerchantLoginFailures(String(user.id)); const token = crypto.randomBytes(32).toString("base64url");
  createClientMerchantSession(String(user.id), tokenHash(token), new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString());
  return { token, merchant: { id: user.id, code: user.code, name: user.name, twoFactorEnabled: Number(user.twoFactorEnabled || 0) === 1 } };
}
export function requireClientMerchantSession(req: ClientMerchantRequest, res: Response, next: NextFunction): void {
  const token = sessionToken(req); const merchant = token ? getClientMerchantFromSession(tokenHash(token)) : undefined;
  if (!merchant) { res.status(401).json({ error: "CLIENT_MERCHANT_SESSION_REQUIRED" }); return; }
  const allowlist = String(merchant.loginIpAllowlist ?? "").split("|").map((item) => item.trim()).filter(Boolean); const ip = String(req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  if (allowlist.length && !allowlist.includes("*") && !allowlist.includes(ip)) { res.status(403).json({ error: "CLIENT_MERCHANT_IP_NOT_ALLOWED" }); return; }
  req.clientMerchant = merchant; next();
}
export function logoutClientMerchant(req: Request): void { const token = sessionToken(req); if (token) deleteClientMerchantSession(tokenHash(token)); }
