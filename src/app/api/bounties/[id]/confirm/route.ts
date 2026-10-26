import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BOUNTY_PLATFORM_FEE_PCT } from "@/lib/product-config";
import { unlockedStakeTierForWallet } from "@/lib/ar-holder-tier-resolve";
import { normalizeSolanaAddress } from "@/lib/sap-claim-message";
import { hasDashboardIdentity, ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { getJobProducer } from "@/jobs/boss";
import { recordTrustEventInTx } from "@/lib/trust-event-store";
import { getPublicSiteUrl } from "@/lib/site-url";
type Props = { params: Promise<{ id: string }> };
export async function POST(req: NextRequest, { params }: Props) {
  try {
    const session = await getServerSession(authOptions);
    if (!hasDashboardIdentity(session)) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const { id } = await params;
    const bounty = await prisma.bounty.findUnique({ where: { id } });
    if (!bounty) return NextResponse.json({ error: "Bounty not found" }, { status: 404 });
    if (bounty.status !== "claimed") {
      return NextResponse.json(
        { error: "Bounty must be in 'claimed' state to confirm." },
        { status: 409 },
      );
    }
    // Verify the caller is the original poster via email or wallet match
    const profile = await ensureMinimalUserProfile(session);
    const sessionEmail = session?.user?.email?.toLowerCase() ?? "";
    const sessionWallet = profile?.walletAddress?.toLowerCase() ?? "";
    const posterEmail = bounty.posterEmail?.toLowerCase() ?? "";
    const posterWallet = bounty.posterWallet?.toLowerCase() ?? "";
    const emailMatch = posterEmail && sessionEmail && posterEmail === sessionEmail;
    const walletMatch = posterWallet && sessionWallet && posterWallet === sessionWallet;
    if (!emailMatch && !walletMatch) {
      return NextResponse.json(
        { error: "Only the original poster can confirm completion." },
        { status: 403 },
      );
    }
    const platformFee = bounty.usdcAmount * BOUNTY_PLATFORM_FEE_PCT;
    let holderFeeSharePct = 0;
    const posterWalletNorm = normalizeSolanaAddress(posterWallet);
    if (posterWalletNorm) {
      try {
        const { tier } = await unlockedStakeTierForWallet(posterWalletNorm);
        if (tier) holderFeeSharePct = tier.bountyFeeSharePct;
      } catch (err) {
        console.error("[bounties/confirm] holder tier lookup failed:", err);
      }
    }
    const holderFeeShareUsd = Math.round(bounty.usdcAmount * (holderFeeSharePct / 100) * 100) / 100;
    const agentPayout = bounty.usdcAmount - platformFee - holderFeeShareUsd;
    // TODO: Helio split payment — release agentPayout to claimedAgent's wallet,
    //       platformFee to TREASURY_ADDRESS, via Helio on Base.
    //       escrowTx holds the Helio escrow handle to call .release() on.
    const priorEvidence =
      bounty.completionEvidence && typeof bounty.completionEvidence === "object"
        ? (bounty.completionEvidence as Record<string, unknown>)
        : {};
    await getJobProducer();
    const completed = await prisma.$transaction(async (tx) => {
      const transitioned = await tx.bounty.updateMany({
        where: { id, status: "claimed" },
        data: {
          status: "completed",
          completionEvidence: {
            ...priorEvidence,
            holderFeeSharePct,
            holderFeeShareUsd,
            platformFeeUSDC: platformFee,
            agentPayoutUSDC: agentPayout,
          },
        },
      });
      if (transitioned.count !== 1) return false;
      if (bounty.claimedByAgentId) {
        await recordTrustEventInTx(tx, {
          agentId: bounty.claimedByAgentId,
          eventType: "bounty_completed",
          scoreDelta: 5,
          evidenceUrl: `${getPublicSiteUrl()}/jobs`,
          onChainTx: "",
          eventKey: `bounty_completed:${id}`,
        });
      }
      return true;
    });
    if (!completed) {
      const current = await prisma.bounty.findUnique({ where: { id }, select: { status: true } });
      return NextResponse.json(
        { error: `Bounty is already ${current?.status ?? "unavailable"}.` },
        { status: 409 },
      );
    }
    return NextResponse.json({
      id,
      status: "completed",
      platformFeeUSDC: platformFee.toFixed(2),
      holderFeeShareUSDC: holderFeeShareUsd.toFixed(2),
      holderFeeSharePct,
      agentPayoutUSDC: agentPayout.toFixed(2),
      // TODO: escrow release tx hash
      releaseTx: null,
    });
  } catch (err) {
    console.error("[POST /api/bounties/[id]/confirm]", err);
    return NextResponse.json({ error: "Failed to confirm bounty" }, { status: 500 });
  }
}
