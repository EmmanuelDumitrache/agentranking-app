import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { ensureAppAccountForProfile } from "@/lib/custodial-wallet/bootstrap";
import { requireDashboardWalletSession } from "@/lib/dashboard/wallet-api-auth";
import { ensureTreasuryWallet } from "./services/wallet-service";

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkTreasuryRateLimit(key: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export async function requireTreasurySession(session: Session | null) {
  const auth = await requireDashboardWalletSession(session);
  if (!auth.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: auth.error }, { status: auth.status }),
    };
  }

  const rateKey = `treasury:${auth.profile.id}`;
  if (!checkTreasuryRateLimit(rateKey)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 }),
    };
  }

  const account = await ensureAppAccountForProfile({
    id: auth.profile.id,
    displayName: auth.profile.displayName,
    email: auth.profile.email,
    avatarUrl: auth.profile.avatarUrl,
  });
  await ensureTreasuryWallet(account.id);

  return {
    ok: true as const,
    profile: auth.profile,
    appAccountId: account.id,
  };
}
