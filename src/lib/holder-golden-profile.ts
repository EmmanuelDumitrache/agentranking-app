import {
  computeStakeBalancesByTier,
  normalizeStakeWallet,
  type StakePortfolioRow,
} from "@/lib/ar-holder-tier-math";
import {
  resolveHolderTiers,
  unlockedStakeTierForWallet,
} from "@/lib/ar-holder-tier-resolve";
import { prisma } from "@/lib/db";
import { normalizeSolanaAddress } from "@/lib/sap-claim-message";
import { getOrInsertComputed } from "@/lib/map-upsert";
function isCoreTierFromPositions(
  positions: StakePortfolioRow[],
  tiers: Awaited<ReturnType<typeof resolveHolderTiers>>,
): boolean {
  const balances = computeStakeBalancesByTier(positions, tiers);
  return balances.stakeTier?.id === "core";
}
/** Core-tier active stake unlocks golden social profile treatment on /profiles/[wallet]. */
export async function isHolderGoldenProfile(walletRaw: string | null | undefined): Promise<boolean> {
  const wallet = normalizeSolanaAddress(walletRaw ?? "");
  if (!wallet) return false;
  const { tier } = await unlockedStakeTierForWallet(wallet);
  return tier?.id === "core";
}
/** One DB round-trip for many wallets (social directory / featured). */
export async function batchIsHolderGoldenProfile(
  walletsRaw: readonly (string | null | undefined)[],
): Promise<Map<string, boolean>> {
  const wallets = [
    ...new Set(
      walletsRaw
        .map((w) => normalizeStakeWallet(w ?? ""))
        .filter((w): w is string => Boolean(w)),
    ),
  ];
  const out = new Map<string, boolean>();
  if (wallets.length === 0) return out;
  const tiers = await resolveHolderTiers();
  const rows = await prisma.arStakePosition.findMany({
    where: { wallet: { in: wallets }, status: "active" },
    select: {
      wallet: true,
      amountUi: true,
      amountRaw: true,
      durationSec: true,
      lockEndAt: true,
    },
  });
  const byWallet = new Map<string, StakePortfolioRow[]>();
  for (const row of rows) {
    getOrInsertComputed(byWallet, row.wallet, () => []).push({
      amountUi: row.amountUi,
      amountRaw: row.amountRaw,
      durationSec: row.durationSec,
      lockEndAt: row.lockEndAt?.toISOString() ?? null,
    });
  }
  for (const wallet of wallets) {
    out.set(wallet, isCoreTierFromPositions(byWallet.get(wallet) ?? [], tiers));
  }
  return out;
}
