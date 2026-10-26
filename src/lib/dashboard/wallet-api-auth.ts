import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
export async function requireDashboardWalletSession(session: Session | null) {
  if (!hasDashboardSessionIdentity(session)) {
    return { ok: false as const, status: 401 as const, error: "Unauthorized" };
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return { ok: false as const, status: 400 as const, error: "No dashboard profile for this session." };
  }
  const full = await prisma.userProfile.findUnique({
    where: { id: profile.id },
    select: {
      id: true,
      email: true,
      displayName: true,
      avatarUrl: true,
      walletAddress: true,
      solanaWallet: true,
    },
  });
  if (!full) {
    return { ok: false as const, status: 503 as const, error: "Profile temporarily unavailable." };
  }
  return { ok: true as const, profile: full };
}
