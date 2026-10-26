import "server-only";

import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import {
  LAUNCH_WALLET_IRON_TTL_SEC,
  LAUNCH_WALLET_SESSION_COOKIE,
  LAUNCH_WALLET_SESSION_TTL_MS,
  type LaunchWalletChain,
} from "@/lib/launch-wallet-session/constants";

export type LaunchWalletSessionData = {
  wallet: string;
  chain: LaunchWalletChain;
  createdAt: number;
  expiresAt: number;
  challengeId: string;
};

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

function launchCookieSecure(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  const insecureExplicit =
    process.env.LAUNCH_WALLET_COOKIE_INSECURE === "1" ||
    process.env.LAUNCH_WALLET_COOKIE_INSECURE === "true";
  return !insecureExplicit;
}

export function getLaunchWalletSessionOptions() {
  const secret =
    normalizeEnvString(process.env.LAUNCH_WALLET_SESSION_SECRET) ??
    normalizeEnvString(process.env.NEXTAUTH_SECRET) ??
    normalizeEnvString(process.env.ADMIN_SESSION_SECRET);
  if (!secret || secret.length < 32) {
    throw new Error(
      "LAUNCH_WALLET_SESSION_SECRET, NEXTAUTH_SECRET, or ADMIN_SESSION_SECRET must be set (32+ chars)",
    );
  }
  return {
    cookieName: LAUNCH_WALLET_SESSION_COOKIE,
    password: secret,
    ttl: LAUNCH_WALLET_IRON_TTL_SEC,
    cookieOptions: {
      httpOnly: true,
      secure: launchCookieSecure(),
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

function sessionStillValid(session: LaunchWalletSessionData): boolean {
  return Boolean(
    session.wallet &&
      session.chain &&
      session.createdAt > 0 &&
      session.expiresAt > Date.now(),
  );
}

export async function getLaunchWalletSession(): Promise<LaunchWalletSessionData | null> {
  try {
    const cookieStore = await cookies();
    const session = await getIronSession<LaunchWalletSessionData>(
      cookieStore,
      getLaunchWalletSessionOptions(),
    );
    if (!sessionStillValid(session)) {
      session.destroy();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function getLaunchWalletSessionFromRequest(
  request: Request,
): Promise<LaunchWalletSessionData | null> {
  try {
    const options = getLaunchWalletSessionOptions();
    const res = new Response();
    const session = await getIronSession<LaunchWalletSessionData>(request, res, options);
    if (!sessionStillValid(session)) return null;
    return session;
  } catch {
    return null;
  }
}

export async function createLaunchWalletSession(input: {
  wallet: string;
  chain: LaunchWalletChain;
  challengeId: string;
}): Promise<LaunchWalletSessionData> {
  const cookieStore = await cookies();
  const session = await getIronSession<LaunchWalletSessionData>(
    cookieStore,
    getLaunchWalletSessionOptions(),
  );
  const now = Date.now();
  session.wallet = input.wallet;
  session.chain = input.chain;
  session.challengeId = input.challengeId;
  session.createdAt = now;
  session.expiresAt = now + LAUNCH_WALLET_SESSION_TTL_MS;
  await session.save();
  return session;
}

export async function destroyLaunchWalletSession(): Promise<void> {
  try {
    const cookieStore = await cookies();
    const session = await getIronSession<LaunchWalletSessionData>(
      cookieStore,
      getLaunchWalletSessionOptions(),
    );
    session.destroy();
  } catch {
    // ignore
  }
}

export async function touchLaunchWalletSessionFromRequest(
  request: NextRequest | Request,
): Promise<LaunchWalletSessionData | null> {
  const session = await getLaunchWalletSession();
  if (!session) return null;
  void request;
  return session;
}
