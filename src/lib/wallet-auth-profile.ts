import { prisma } from "@/lib/db";
import { normalizeSolanaAddress } from "@/lib/sap-claim-message";
/**
 * Resolves the UserProfile used for wallet (SIWE) sign-in.
 * - Existing row with this wallet
 * - Otherwise, auto-provision a minimal wallet-only row (dashboard verification, settings, etc.)
 */
export async function resolveUserProfileForWalletCredentials(walletLower: string) {
  const norm = walletLower.toLowerCase();
  const byWallet = await prisma.userProfile.findFirst({
    where: { walletAddress: { equals: norm, mode: "insensitive" } },
  });
  if (byWallet) return byWallet;
  return prisma.userProfile.create({
    data: { walletAddress: norm },
  });
}
/**
 * Resolves or creates UserProfile for Solana (Phantom) sign-in.
 * Always provisions a minimal profile so staking and Agent Dashboard can link the wallet.
 */
export async function resolveUserProfileForSolanaCredentials(walletRaw: string) {
  const norm = normalizeSolanaAddress(walletRaw);
  if (!norm) return null;
  const existing = await prisma.userProfile.findFirst({
    where: {
      OR: [
        { solanaWallet: norm },
        { walletAddress: norm },
      ],
    },
  });
  if (existing) {
    const staleStakerLabel =
      existing.displayName?.startsWith("Staker ") && existing.displayName.includes("…");
    const needsSolanaWallet = existing.solanaWallet !== norm;
    const needsWalletAddress = existing.walletAddress !== norm;
    if (needsSolanaWallet || needsWalletAddress || staleStakerLabel) {
      return prisma.userProfile.update({
        where: { id: existing.id },
        data: {
          solanaWallet: norm,
          walletAddress: norm,
          ...(staleStakerLabel ? { displayName: null } : {}),
        },
      });
    }
    return existing;
  }
  return prisma.userProfile.create({
    data: { walletAddress: norm, solanaWallet: norm },
  });
}
