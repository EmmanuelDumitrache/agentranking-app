import { prisma } from "@/lib/db";
import { BOUNTY_PLATFORM_FEE_PCT } from "@/lib/product-config";
import { unlockedStakeTierForWallet } from "@/lib/ar-holder-tier-resolve";
import { normalizeSolanaAddress } from "@/lib/sap-claim-message";
import { recordTrustEventInTx } from "@/lib/trust-event-store";
export async function releaseBountyIfDue(bountyId: string, now = new Date()) {
  const bounty = await prisma.bounty.findUnique({
    where: { id: bountyId },
    include: {
      claimedAgent: { select: { id: true } },
      disputes: { where: { status: "open" }, select: { id: true } },
    },
  });
  if (!bounty || bounty.status !== "claimed" || !bounty.autoReleaseAt || bounty.autoReleaseAt > now || bounty.disputes.length > 0) return null;
  const platformFee = bounty.usdcAmount * BOUNTY_PLATFORM_FEE_PCT;
  let holderFeeSharePct = 0;
  const posterWallet = normalizeSolanaAddress(bounty.posterWallet);
  if (posterWallet) {
    try {
      const { tier } = await unlockedStakeTierForWallet(posterWallet);
      if (tier) holderFeeSharePct = tier.bountyFeeSharePct;
    } catch (error) {
      console.error("[job/bounty-auto-release] holder tier lookup", error);
    }
  }
  const holderFeeShareUsd = Math.round(bounty.usdcAmount * (holderFeeSharePct / 100) * 100) / 100;
  const agentPayout = bounty.usdcAmount - platformFee - holderFeeShareUsd;
  const priorEvidence = bounty.completionEvidence && typeof bounty.completionEvidence === "object"
    ? bounty.completionEvidence as Record<string, unknown>
    : {};
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.bounty.updateMany({
      where: {
        id: bountyId,
        status: "claimed",
        autoReleaseAt: { lte: now },
        disputes: { none: { status: "open" } },
      },
      data: {
        status: "completed",
        completionEvidence: {
          ...priorEvidence,
          holderFeeSharePct,
          holderFeeShareUsd,
          platformFeeUSDC: platformFee,
          agentPayoutUSDC: agentPayout,
          autoReleased: true,
          autoReleasedAt: now.toISOString(),
        },
      },
    });
    if (claimed.count !== 1) return null;
    // External escrow release remains intentionally unwired; chain/payment side effects require their own persisted idempotency record.
    if (bounty.claimedByAgentId) {
      await recordTrustEventInTx(tx, {
        agentId: bounty.claimedByAgentId,
        eventType: "bounty_completed",
        scoreDelta: 5,
        evidenceUrl: "/jobs",
        onChainTx: "",
        eventKey: `bounty_completed:${bountyId}`,
      });
    }
    return { id: bountyId, payout: agentPayout, fee: platformFee };
  });
}
