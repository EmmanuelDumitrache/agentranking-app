import { prisma } from "@/lib/db";
import { getMfaFactorFlags, type MfaFactorFlags } from "@/lib/account-security/flags";
import {
  isSyntheticWalletEmail,
  normalizeDashboardEmail,
} from "@/lib/dashboard/auth-users";
import { isSyntheticXEmail } from "@/lib/oauth-account-link";

function profileWalletWhere(wallet: string) {
  return wallet.startsWith("0x")
    ? { walletAddress: { equals: wallet, mode: "insensitive" as const } }
    : { OR: [{ walletAddress: wallet }, { solanaWallet: wallet }] };
}

export async function resolveProfileMfaForAuthUser(input: {
  email?: string | null;
  walletAddress?: string | null;
}): Promise<{
  profileId: number;
  trustVersion: number;
  flags: MfaFactorFlags;
} | null> {
  const wallet = input.walletAddress?.trim() ?? "";
  if (wallet) {
    const byWallet = await prisma.userProfile.findFirst({
      where: profileWalletWhere(wallet.startsWith("0x") ? wallet.toLowerCase() : wallet),
    });
    if (byWallet) {
      return {
        profileId: byWallet.id,
        trustVersion: byWallet.mfaTrustVersion,
        flags: getMfaFactorFlags(byWallet),
      };
    }
  }
  const email = input.email ? normalizeDashboardEmail(input.email) : "";
  if (!email) return null;
  if (isSyntheticWalletEmail(email) || isSyntheticXEmail(email)) {
    return null;
  }
  const byEmail = await prisma.userProfile.findUnique({ where: { email } });
  if (!byEmail) return null;
  return {
    profileId: byEmail.id,
    trustVersion: byEmail.mfaTrustVersion,
    flags: getMfaFactorFlags(byEmail),
  };
}
