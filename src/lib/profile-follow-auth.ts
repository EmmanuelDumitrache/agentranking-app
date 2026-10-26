import type { Session } from "next-auth";
import { isAddress } from "viem";
import {
  getDashboardUserProfile,
  hasDashboardIdentity,
} from "@/lib/dashboard/session-profile";
import { requireLaunchWalletSessionForAddress } from "@/lib/launch-wallet-session/request-auth.server";
export type FollowAuthResult =
  | { ok: true; followerAddress: string }
  | { ok: false; code: "unauthorized" | "no_wallet" | "mismatch" | "session_required" };
function normalizeEvmWallet(raw: string | null | undefined): string | null {
  const w = raw?.trim();
  if (!w || !isAddress(w)) return null;
  return w.toLowerCase();
}
/**
 * Resolves the follower wallet from NextAuth session (dashboard profile / JWT).
 */
export async function resolveAuthorizedFollower(
  session: Session | null,
): Promise<FollowAuthResult> {
  if (!hasDashboardIdentity(session)) {
    return { ok: false, code: "unauthorized" };
  }
  const fromJwt = normalizeEvmWallet(session?.user?.walletAddress);
  if (fromJwt) return { ok: true, followerAddress: fromJwt };
  const profile = await getDashboardUserProfile(session);
  const fromProfile = normalizeEvmWallet(profile?.walletAddress);
  if (fromProfile) return { ok: true, followerAddress: fromProfile };
  return { ok: false, code: "no_wallet" };
}
/**
 * Session wallet wins when signed in. A connected browser wallet is accepted
 * only when the request carries a verified EVM wallet session cookie.
 */
export async function resolveFollowerForRequest(
  session: Session | null,
  request: Request,
  clientFollower?: string | null,
): Promise<FollowAuthResult> {
  const client = normalizeEvmWallet(clientFollower);
  if (hasDashboardIdentity(session)) {
    const sessionAuth = await resolveAuthorizedFollower(session);
    if (sessionAuth.ok) {
      if (client && client !== sessionAuth.followerAddress) {
        return { ok: false, code: "mismatch" };
      }
      return sessionAuth;
    }
    if (sessionAuth.code !== "no_wallet" || !client) return sessionAuth;
  }
  if (!client) return { ok: false, code: "no_wallet" };
  const walletSession = await requireLaunchWalletSessionForAddress(request, "evm", client);
  if (!walletSession.ok) {
    return {
      ok: false,
      code: walletSession.status === 403 ? "mismatch" : "session_required",
    };
  }
  return { ok: true, followerAddress: walletSession.wallet };
}
