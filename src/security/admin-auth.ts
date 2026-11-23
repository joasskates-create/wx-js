import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { db } from "../db.js";
import { nowIso, randomId } from "../utils.js";
import { hashPassword, verifyPassword } from "./password.js";

export interface AdminUser {
  id: string;
  username: string;
  role: string;
  status: string;
  dataScope?: string;
  dataScopeIds?: string[];
}

const rolePermissions: Record<string, string[]> = {
  SUPER_ADMIN: ["*"],
  OPERATIONS: ["admin:read", "account:read", "account:write", "channel:read", "route:read", "order:read", "order:write", "refund:read", "refund:write", "reconciliation:read", "reconciliation:write", "monitoring:read", "bot:read", "bot:write", "audit:read"],
  FINANCE: ["admin:read", "account:read", "order:read", "refund:read", "reconciliation:read", "reconciliation:write", "audit:read"],
  CHANNEL_ADMIN: ["admin:read", "account:read", "channel:read", "channel:write", "route:read", "route:write", "monitoring:read", "bot:read", "bot:write", "audit:read"],
  AUDITOR: ["admin:read", "account:read", "order:read", "refund:read", "reconciliation:read", "monitoring:read", "audit:read"]
};

export const ADMIN_ROLES = Object.keys(rolePermissions);

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function ensureAdminBootstrap(): void {
  if (!config.adminAuthEnabled || !config.adminPassword) return;
  const exists = db.prepare("SELECT id FROM admin_users WHERE username = ?").get(config.adminUsername) as { id: string } | undefined;
  if (!exists) {
    db.prepare("INSERT INTO admin_users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(randomId("admin"), config.adminUsername, hashPassword(config.adminPassword), "SUPER_ADMIN", nowIso());
  }
}

function normalizeAdminScope(row: Record<string, unknown>): AdminUser { return { id: String(row.id), username: String(row.username), role: String(row.role), status: String(row.status), dataScope: String(row.dataScope ?? row.data_scope ?? 'ALL'), dataScopeIds: String(row.dataScopeIds ?? row.data_scope_ids ?? '').split(',').map((item) => item.trim()).filter(Boolean) }; }
export function listAdminUsers(): AdminUser[] {
  return (db.prepare("SELECT id, username, role, status, data_scope AS dataScope, data_scope_ids AS dataScopeIds FROM admin_users ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map(normalizeAdminScope);
}

export function createAdminUser(username: string, password: string, role: string, dataScope = 'ALL', dataScopeIds: string[] = []): AdminUser {
  if (!ADMIN_ROLES.includes(role)) throw new Error("INVALID_ADMIN_ROLE");
  const id = randomId("admin");
  db.prepare("INSERT INTO admin_users (id, username, password_hash, role, data_scope, data_scope_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, username, hashPassword(password), role, dataScope, dataScopeIds.join(','), nowIso());
  return { id, username, role, status: "ACTIVE", dataScope, dataScopeIds };
}

export function updateAdminUser(id: string, input: { role?: string; status?: "ACTIVE" | "DISABLED"; password?: string; dataScope?: string; dataScopeIds?: string[] }): AdminUser | undefined {
  const current = db.prepare("SELECT id, username, role, status FROM admin_users WHERE id = ?").get(id) as AdminUser | undefined;
  if (!current) return undefined;
  if (input.role && !ADMIN_ROLES.includes(input.role)) throw new Error("INVALID_ADMIN_ROLE");
  const passwordHash = input.password ? hashPassword(input.password) : undefined;
  db.prepare("UPDATE admin_users SET role = COALESCE(?, role), status = COALESCE(?, status), password_hash = COALESCE(?, password_hash), data_scope = COALESCE(?, data_scope), data_scope_ids = COALESCE(?, data_scope_ids) WHERE id = ?")
    .run(input.role ?? null, input.status ?? null, passwordHash ?? null, input.dataScope ?? null, input.dataScopeIds ? input.dataScopeIds.join(',') : null, id);
  return normalizeAdminScope(db.prepare("SELECT id, username, role, status, data_scope AS dataScope, data_scope_ids AS dataScopeIds FROM admin_users WHERE id = ?").get(id) as Record<string, unknown>);
}

export function loginAdmin(username: string, password: string): { token: string; user: AdminUser } | undefined {
  const row = db.prepare("SELECT id, username, password_hash AS passwordHash, role, status, data_scope AS dataScope, data_scope_ids AS dataScopeIds FROM admin_users WHERE username = ?").get(username) as (AdminUser & { passwordHash: string }) | undefined;
  if (!row || row.status !== "ACTIVE" || !verifyPassword(password, row.passwordHash)) return undefined;
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO admin_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(tokenHash(token), row.id, expiresAt, nowIso());
  db.prepare("UPDATE admin_users SET last_login_at = ? WHERE id = ?").run(nowIso(), row.id);
  return { token, user: normalizeAdminScope(row as unknown as Record<string, unknown>) };
}

export function logoutAdmin(token: string | undefined): void {
  if (token) db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(tokenHash(token));
}

export function getAdminFromToken(token: string | undefined): AdminUser | undefined {
  if (!token) return undefined;
  const row = db.prepare(`SELECT u.id, u.username, u.role, u.status, u.data_scope AS dataScope, u.data_scope_ids AS dataScopeIds FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'ACTIVE'`).get(tokenHash(token), nowIso()) as AdminUser | undefined;
  return row ? normalizeAdminScope(row as unknown as Record<string, unknown>) : undefined;
}

export function verifyAdminOperationPassword(userId: string, password: string): boolean {
  const row = db.prepare("SELECT password_hash AS passwordHash FROM admin_users WHERE id = ? AND status = 'ACTIVE'").get(userId) as { passwordHash?: string } | undefined;
  return Boolean(row?.passwordHash && verifyPassword(password, row.passwordHash));
}

export function adminScopeAllows(user: AdminUser | undefined, resource: string, id: string): boolean {
  if (!user || user.role === 'SUPER_ADMIN' || user.dataScope === 'ALL') return true;
  const ids = user.dataScopeIds ?? [];
  if (user.dataScope === 'ASSIGNED_CLIENT_MERCHANTS' && resource === 'client_merchant') return ids.includes(id);
  if (user.dataScope === 'ASSIGNED_CLIENT_MERCHANTS' && resource === 'channel') {
    if (!ids.length) return false;
    const marks = ids.map(() => '?').join(',');
    return Boolean(db.prepare(`SELECT 1 FROM client_merchant_channels WHERE client_merchant_id IN (${marks}) AND channel_id = ? AND status = 'ACTIVE' LIMIT 1`).get(...ids, id));
  }
  if (user.dataScope === 'ASSIGNED_CODE_MERCHANTS' && resource === 'platform_merchant') return ids.includes(id);
  if (user.dataScope === 'ASSIGNED_CODE_MERCHANTS' && resource === 'channel') {
    if (!ids.length) return false;
    const marks = ids.map(() => '?').join(',');
    return Boolean(db.prepare(`SELECT 1 FROM platform_merchant_channels WHERE platform_merchant_id IN (${marks}) AND channel_id = ? LIMIT 1`).get(...ids, id));
  }
  if (user.dataScope === 'ASSIGNED_CHANNELS' && resource === 'channel') return ids.includes(id);
  return false;
}

export function cookieToken(req: Request): string | undefined {
  const header = req.headers.cookie ?? "";
  const item = header.split(";").map((part) => part.trim()).find((part) => part.startsWith("admin_session="));
  return item?.slice("admin_session=".length);
}

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader("Set-Cookie", `admin_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${8 * 60 * 60}${config.secureCookies ? "; Secure" : ""}`);
}

export function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${config.secureCookies ? "; Secure" : ""}`);
}

export function hasPermission(user: AdminUser, permission: string): boolean {
  const permissions = rolePermissions[user.role] ?? [];
  return permissions.includes("*") || permissions.includes(permission);
}

function requiredPermission(req: Request): string {
  const path = req.path;
  if (path.includes("/client-merchant")) return req.method === "GET" ? "account:read" : "account:write";
  if (path.includes("/channels")) return req.method === "GET" ? "channel:read" : "channel:write";
  if (path.includes("/qr-codes") || path.includes("/qr-channel-settings") || path.includes("/qr-monitoring")) return req.method === "GET" ? "channel:read" : "channel:write";
  if (path.includes("/platform-merchants") || path.includes("/merchants") || path.includes("/subjects") || path.includes("/apps")) return req.method === "GET" ? "account:read" : "account:write";
  if (path.includes("/users")) return "account:write";
  if (path.includes("/reconciliation")) return req.method === "GET" ? "reconciliation:read" : "reconciliation:write";
  if (path.includes("/settlement")) return req.method === "GET" ? "reconciliation:read" : "reconciliation:write";
  if (path.includes("/routing-rules")) return req.method === "GET" ? "route:read" : "route:write";
  if (path.includes("/member-block")) return req.method === "GET" ? "order:read" : "order:write";
  if (path.includes("/refund")) return req.method === "GET" ? "refund:read" : "refund:write";
  if (path.includes("/orders")) return req.method === "GET" ? "order:read" : "order:write";
  if (path.includes("/monitoring")) return "monitoring:read";
  if (path.includes("/bot")) return req.method === "GET" ? "bot:read" : "bot:write";
  if (path.includes("/audit")) return "audit:read";
  return req.method === "GET" ? "admin:read" : "admin:write";
}

export function requireAdmin(req: Request & { adminUser?: AdminUser }, res: Response, next: NextFunction): void {
  if (!config.adminAuthEnabled) {
    req.adminUser = { id: "local", username: "local-admin", role: "SUPER_ADMIN", status: "ACTIVE" };
    next();
    return;
  }
  const user = getAdminFromToken(cookieToken(req));
  if (!user) { res.status(401).json({ error: "ADMIN_AUTH_REQUIRED" }); return; }
  if (!hasPermission(user, requiredPermission(req))) { res.status(403).json({ error: "ADMIN_PERMISSION_DENIED" }); return; }
  req.adminUser = user;
  next();
}
