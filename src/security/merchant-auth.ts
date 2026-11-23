import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import crypto from "node:crypto";
import { createMerchantSession, createMerchantUserSession, deleteMerchantSession, deleteMerchantUserSession, getMerchantFromSession, getMerchantUserByUsername, getMerchantUserSession, markMerchantUserLogin, touchPlatformMerchantActivity } from "../db.js";
import { verifyPassword } from "./password.js";

export interface MerchantRequest extends Request { merchant?: Record<string, unknown>; }

export function merchantCookieToken(req: Request): string | undefined {
  const cookie = req.headers.cookie ?? "";
  return cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("merchant_session="))?.slice("merchant_session=".length);
}

export function setMerchantSessionCookie(res: Response, token: string): void {
  res.setHeader("Set-Cookie", `merchant_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${8 * 60 * 60}${config.secureCookies ? "; Secure" : ""}`);
}

export function clearMerchantSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `merchant_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${config.secureCookies ? "; Secure" : ""}`);
}

function tokenHash(token: string): string { return crypto.createHash("sha256").update(token).digest("hex"); }
export function loginMerchant(merchantId: string): string { return createMerchantSession(merchantId); }
export function loginMerchantUser(username: string, password: string): { token: string; merchant: Record<string, unknown> } | undefined {
  const user = getMerchantUserByUsername(username);
  if (!user || user.status !== "ACTIVE" || user.merchantStatus !== "ACTIVE" || !verifyPassword(password, user.passwordHash)) return undefined;
  const token = crypto.randomBytes(32).toString("base64url");
  createMerchantUserSession(String(user.id), String(user.merchantId), tokenHash(token), new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString());
  markMerchantUserLogin(String(user.id));
  touchPlatformMerchantActivity(String(user.merchantId));
  return { token, merchant: { id: user.merchantId, code: user.code, name: user.name, username: user.username, role: user.role, mustChangePassword: user.mustChangePassword, settlementRate: user.settlementRate } };
}
export function logoutMerchant(token: string | undefined): void { if (token) { deleteMerchantSession(token); deleteMerchantUserSession(tokenHash(token)); } }
export function getMerchantFromRequest(req: Request): Record<string, unknown> | undefined {
  const token = merchantCookieToken(req);
  if (!token) return undefined;
  const userSession = getMerchantUserSession(tokenHash(token));
  if (userSession) { touchPlatformMerchantActivity(String(userSession.merchantId)); return { ...userSession, id: userSession.merchantId }; }
  return getMerchantFromSession(token);
}

export function requireMerchant(req: MerchantRequest, res: Response, next: NextFunction): void {
  const merchant = getMerchantFromRequest(req);
  if (!merchant) { res.status(401).json({ error: "MERCHANT_AUTH_REQUIRED" }); return; }
  req.merchant = merchant;
  next();
}
