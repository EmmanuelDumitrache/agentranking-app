import type { PrismaClient } from "@/generated/prisma/client";
/**
 * Find active referral row for a wallet using exact `ownerWallet` matches only.
 * Tries canonical Solana base58 first, then raw trimmed query param if it differs.
 */
export async function findActiveArReferralCodeForOwner(
  prisma: PrismaClient,
  normalizedWallet: string,
  walletRawTrimmed: string,
): Promise<{ id: string; code: string } | null> {
  const base = { isActive: true as const };
  let row = await prisma.arReferralCode.findFirst({
    where: { ...base, ownerWallet: normalizedWallet },
    select: { id: true, code: true },
  });
  if (!row && walletRawTrimmed && walletRawTrimmed !== normalizedWallet) {
    row = await prisma.arReferralCode.findFirst({
      where: { ...base, ownerWallet: walletRawTrimmed },
      select: { id: true, code: true },
    });
  }
  return row;
}
