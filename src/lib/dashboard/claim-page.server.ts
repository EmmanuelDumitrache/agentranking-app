import "server-only";
import { prisma } from "@/lib/db";

export type DashboardClaimTokenInfo = {
  readonly valid: boolean;
  readonly email?: string;
  readonly displayName?: string;
  readonly isClaimed?: boolean;
  readonly error?: string;
};

export async function readDashboardClaimToken(
  token: string,
): Promise<DashboardClaimTokenInfo> {
  const normalized = token.trim();
  if (!normalized) return { valid: false, error: "Token required." };

  const profile = await prisma.userProfile.findUnique({
    where: { claimToken: normalized },
    select: {
      email: true,
      isClaimed: true,
      claimTokenExpiresAt: true,
      displayName: true,
    },
  });
  if (!profile) return { valid: false, error: "Invalid link." };
  if (profile.claimTokenExpiresAt && profile.claimTokenExpiresAt < new Date()) {
    return { valid: false, error: "Link expired." };
  }
  return {
    valid: true,
    ...(profile.email ? { email: profile.email } : {}),
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    isClaimed: profile.isClaimed,
  };
}
