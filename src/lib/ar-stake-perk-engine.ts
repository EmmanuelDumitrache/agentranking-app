import { prisma } from "@/lib/db";
import { normalizeStakeWallet, parseAmountUiToTierRaw } from "@/lib/ar-holder-tier-resolve";
export interface StakeUnlockResult {
  unlockedPerks: string[];
  activePositions: Array<{
    id: string;
    wallet: string;
    amountUi: string;
    amountRaw: string;
    durationSec: number;
    lockEndAt: Date | null;
    poolAddress: string;
    txSignature: string;
    status: string;
    source: string;
  }>;
  appliedRules: Array<{ ruleId: string; ruleName: string; perkSlug: string }>;
  appliedOverrides: Array<{ perkSlug: string; overrideType: string; adminNote: string }>;
}
/**
 * Compute which perk slugs a wallet has earned via staking.
 *
 * Logic:
 * 1. Load active positions (status=active) for the wallet.
 * 2. Load all active rules ordered by priority desc.
 * 3. A rule matches if ANY position satisfies: amountRaw >= minStakeRaw AND
 *    durationSec >= minLockDays * 86400.
 * 4. Apply admin overrides last: force_lock removes, force_unlock adds.
 *    Expired overrides are ignored.
 */
export async function computeStakePerksForWallet(walletRaw: string): Promise<StakeUnlockResult> {
  const wallet = normalizeStakeWallet(walletRaw);
  const now = new Date();
  const [positions, rules, overrides] = await Promise.all([
    prisma.arStakePosition.findMany({
      where: { wallet, status: "active" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.arStakePerkRule.findMany({
      where: { isActive: true },
      orderBy: { priority: "desc" },
    }),
    prisma.arStakePerkOverride.findMany({
      where: {
        wallet,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
  ]);
  const unlockedSet = new Set<string>();
  const appliedRules: StakeUnlockResult["appliedRules"] = [];
  for (const rule of rules) {
    const minStake = BigInt(rule.minStakeRaw || "0");
    const minSec = rule.minLockDays * 86400;
    const matches = positions.some((pos) => {
      const byUi = parseAmountUiToTierRaw(pos.amountUi);
      const posAmount =
        byUi > BigInt(0)
          ? byUi
          : /^\d+$/.test(pos.amountRaw || "")
            ? BigInt(pos.amountRaw)
            : BigInt(0);
      if (posAmount < minStake) return false;
      if (minSec > 0 && pos.durationSec < minSec) return false;
      return true;
    });
    if (matches && !unlockedSet.has(rule.perkSlug)) {
      unlockedSet.add(rule.perkSlug);
      appliedRules.push({ ruleId: rule.id, ruleName: rule.name, perkSlug: rule.perkSlug });
    }
  }
  const appliedOverrides: StakeUnlockResult["appliedOverrides"] = [];
  for (const ov of overrides) {
    if (ov.overrideType === "force_lock") {
      unlockedSet.delete(ov.perkSlug);
    } else if (ov.overrideType === "force_unlock") {
      unlockedSet.add(ov.perkSlug);
    }
    appliedOverrides.push({
      perkSlug: ov.perkSlug,
      overrideType: ov.overrideType,
      adminNote: ov.adminNote,
    });
  }
  return {
    unlockedPerks: Array.from(unlockedSet),
    activePositions: positions.map((p) => ({
      id: p.id,
      wallet: p.wallet,
      amountUi: p.amountUi,
      amountRaw: p.amountRaw,
      durationSec: p.durationSec,
      lockEndAt: p.lockEndAt,
      poolAddress: p.poolAddress,
      txSignature: p.txSignature,
      status: p.status,
      source: p.source,
    })),
    appliedRules,
    appliedOverrides,
  };
}