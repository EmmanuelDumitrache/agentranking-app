import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { getClientIp } from "@/lib/client-ip";
/** Logical session length when "Remember this device" is off */
export const ADMIN_SESSION_DEFAULT_MS = 8 * 60 * 60 * 1000;
/** Logical session length for "Remember this device" */
export const ADMIN_SESSION_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
/** Iron-session seal TTL — must cover the longest logical session */
export const ADMIN_IRON_SESSION_TTL_SEC = 30 * 24 * 60 * 60;
const COOKIE_NAME = "agentranking_admin_session";
export interface AdminSession {
  username: string;
  createdAt: number;
  /** When this login should stop being accepted (encrypted in cookie) */
  expiresAt: number;
  /** Best-effort last request IP (login or heartbeat) */
  lastAccessIp?: string;
  lastAccessAt?: number;
}
export function computeAdminSessionExpiresAt(rememberMe: boolean): number {
  return Date.now() + (rememberMe ? ADMIN_SESSION_REMEMBER_MS : ADMIN_SESSION_DEFAULT_MS);
}
/** Strip accidental quotes/newlines from dashboard or secret-manager copy-paste */
function normalizeEnvString(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  let s = value.trim().replace(/^\uFEFF/, "");
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s.length ? s : undefined;
}
/**
 * `Secure` cookies are not stored on plain HTTP — breaks admin login behind `NODE_ENV=production`
 * without TLS unless you opt out (self‑hosted LAN, raw `next start` on :3000, etc.).
 */
function adminCookieSecure(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  const insecureExplicit =
    process.env.ADMIN_COOKIE_INSECURE === "1" || process.env.ADMIN_COOKIE_INSECURE === "true";
  return !insecureExplicit;
}
export function getSessionOptions() {
  const secret = normalizeEnvString(process.env.ADMIN_SESSION_SECRET);
  if (!secret || secret.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be set and at least 32 characters");
  }
  return {
    cookieName: COOKIE_NAME,
    password: secret,
    ttl: ADMIN_IRON_SESSION_TTL_SEC,
    cookieOptions: {
      httpOnly: true,
      secure: adminCookieSecure(),
      sameSite: "lax" as const,
      path: "/",
    },
  };
}
function sessionStillValid(session: AdminSession): boolean {
  if (!session.username || !session.createdAt) return false;
  const exp =
    session.expiresAt && session.expiresAt > session.createdAt
      ? session.expiresAt
      : session.createdAt + ADMIN_SESSION_DEFAULT_MS;
  return Date.now() <= exp;
}
export function isAdminSessionStillValid(session: AdminSession): boolean {
  return sessionStillValid(session);
}
/**
 * Non-secret hints for admin dashboard (session cookie behavior).
 */
export function getAdminSecurityDisplayHints(): {
  nodeEnv: string;
  adminCookieInsecureOptIn: boolean;
  secureCookieWhenProduction: boolean;
} {
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    adminCookieInsecureOptIn:
      process.env.ADMIN_COOKIE_INSECURE === "1" || process.env.ADMIN_COOKIE_INSECURE === "true",
    secureCookieWhenProduction: adminCookieSecure(),
  };
}
/**
 * Read session from a Request (e.g. middleware / proxy).
 * Does not mutate the response; use only for auth checks.
 */
export async function getSessionFromRequest(request: Request): Promise<AdminSession | null> {
  try {
    const options = getSessionOptions();
    const res = new Response();
    const session = await getIronSession<AdminSession>(request, res, options);
    if (!sessionStillValid(session)) return null;
    return session;
  } catch {
    return null;
  }
}
export async function getSession(): Promise<AdminSession | null> {
  try {
    const cookieStore = await cookies();
    const session = await getIronSession<AdminSession>(cookieStore, getSessionOptions());
    if (!sessionStillValid(session)) {
      session.destroy();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}
/**
 * Records best-effort last access IP/time and re-saves the session. Returns the session for use in the same request.
 */
export async function touchAdminSessionFromRequest(request: NextRequest | Request): Promise<AdminSession | null> {
  try {
    const cookieStore = await cookies();
    const session = await getIronSession<AdminSession>(cookieStore, getSessionOptions());
    if (!sessionStillValid(session) || !session.username) {
      return null;
    }
    const ip = getClientIp(request);
    const now = Date.now();
    const ipChanged = Boolean(ip && ip !== session.lastAccessIp);
    const stale =
      !session.lastAccessAt || now - session.lastAccessAt > 60_000;
    if (ip) session.lastAccessIp = ip;
    session.lastAccessAt = now;
    if (ipChanged || stale) {
      await session.save();
    }
    return session;
  } catch {
    return null;
  }
}
export async function createSession(username: string, rememberMe = false): Promise<void> {
  const cookieStore = await cookies();
  const session = await getIronSession<AdminSession>(cookieStore, getSessionOptions());
  const now = Date.now();
  session.username = username;
  session.createdAt = now;
  session.expiresAt = computeAdminSessionExpiresAt(rememberMe);
  await session.save();
}
export async function destroySession(): Promise<void> {
  try {
    const cookieStore = await cookies();
    const session = await getIronSession<AdminSession>(cookieStore, getSessionOptions());
    session.destroy();
  } catch {
    // ignore
  }
}