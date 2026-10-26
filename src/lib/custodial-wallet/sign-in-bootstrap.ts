import type { User } from "next-auth";
import { prisma } from "@/lib/db";
import { isSyntheticWalletEmail, normalizeDashboardEmail } from "@/lib/dashboard/auth-users";
import { ensureAppAccountForProfile } from "@/lib/custodial-wallet/bootstrap";
import { classifyWallet } from "@/lib/trust-oracle-logic";
type AuthUser = User & { walletAddress?: string | null };
export async function resolveUserProfileForAuthUser(user: AuthUser) {
  const email = user.email ? normalizeDashboardEmail(user.email) : "";
  if (email && !isSyntheticWalletEmail(email)) {
    return prisma.userProfile.findUnique({ where: { email } });
  }
  const wallet = user.walletAddress?.trim();
  if (!wallet) return null;
  const walletKind = classifyWallet(wallet);
  return prisma.userProfile.findFirst({
    where: walletKind === "evm"
      ? { walletAddress: { equals: wallet.toLowerCase(), mode: "insensitive" } }
      : { OR: [{ walletAddress: wallet }, { solanaWallet: wallet }] },
  });
}
/** Provision AppAccount + custodial account wallet for any successful sign-in. */
export async function bootstrapAppAccountAfterSignIn(user: AuthUser): Promise<void> {
  const profile = await resolveUserProfileForAuthUser(user);
  if (!profile) return;
  await ensureAppAccountForProfile({
    id: profile.id,
    displayName: profile.displayName,
    email: profile.email,
    avatarUrl: profile.avatarUrl,
  });
}
