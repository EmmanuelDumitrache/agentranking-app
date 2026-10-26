import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { holderTierJson, unlockedStakeTierForWallet } from "@/lib/ar-holder-tier-resolve";
import { findActiveArReferralCodeForOwner } from "@/lib/referral-db";
import { normalizeReferralOwnerWallet } from "@/lib/referral-owner-wallet";
import {
  REFERRAL_COMMISSION_LABELS,
  REFERRAL_COMMISSION_RATES,
} from "@/lib/product-config";
import { normalizeSolanaAddress } from "@/lib/sap-claim-message";
import { requireLaunchWalletSessionForAddress } from "@/lib/launch-wallet-session/request-auth.server";
export const dynamic = "force-dynamic";
function emptyStatsPayload(setupWarning?: string) {
  return {
    code: null as string | null,
    url: null as string | null,
    totalClicks: 0,
    totalConversions: 0,
    pendingUsd: 0,
    approvedUsd: 0,
    paidUsd: 0,
    conversions: [],
    ...(setupWarning ? { setupWarning } : {}),
  };
}
export async function GET(request: NextRequest) {
  const walletRaw = request.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  const wallet = normalizeReferralOwnerWallet(walletRaw);
  if (!wallet) {
    return NextResponse.json({ error: "wallet is required" }, { status: 400 });
  }
  const access = await requireLaunchWalletSessionForAddress(request, "solana", wallet);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, code: "WALLET_SESSION_REQUIRED" },
      { status: access.status },
    );
  }
  try {
    const refCode = await findActiveArReferralCodeForOwner(prisma, access.wallet, walletRaw);
    if (!refCode) {
      return NextResponse.json(emptyStatsPayload());
    }
    const [totalClicks, totalConversions] = await Promise.all([
      prisma.arReferralEvent.count({
        where: { referralCodeId: refCode.id, conversionStatus: { not: "disqualified" } },
      }),
      prisma.arReferralEvent.count({
        where: { referralCodeId: refCode.id, conversionStatus: "qualified" },
      }),
    ]);
    let commissions: Array<{
      id: string;
      orderNumber: string;
      productLabel: string;
      productType: string;
      orderUsd: number;
      commissionPct: number;
      commissionUsd: number;
      status: string;
      paidAt: Date | null;
      referredWallet: string;
      referredEmail: string;
      createdAt: Date;
    }> = [];
    commissions = await prisma.arReferralCommission.findMany({
      where: { referralCodeId: refCode.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderNumber: true,
        productLabel: true,
        productType: true,
        orderUsd: true,
        commissionPct: true,
        commissionUsd: true,
        status: true,
        paidAt: true,
        referredWallet: true,
        referredEmail: true,
        createdAt: true,
      },
    });
    const pendingUsd = commissions
      .filter((c) => c.status === "pending")
      .reduce((sum, c) => sum + c.commissionUsd, 0);
    const approvedUsd = commissions
      .filter((c) => c.status === "approved")
      .reduce((sum, c) => sum + c.commissionUsd, 0);
    const paidUsd = commissions
      .filter((c) => c.status === "paid")
      .reduce((sum, c) => sum + c.commissionUsd, 0);
    let referralMultiplier = 1;
    let stakeTier: ReturnType<typeof holderTierJson> | null = null;
    const solWallet = normalizeSolanaAddress(access.wallet);
    if (solWallet) {
      const { tier } = await unlockedStakeTierForWallet(solWallet);
      if (tier) {
        referralMultiplier = tier.referralMultiplier;
        stakeTier = holderTierJson(tier);
      }
    }
    const effectiveRates = Object.entries(REFERRAL_COMMISSION_RATES).map(([productType, baseRate]) => {
      const effective = Math.round(baseRate * referralMultiplier * 10000) / 10000;
      return {
        productType,
        label: REFERRAL_COMMISSION_LABELS[productType] ?? productType,
        baseRatePct: Math.round(baseRate * 10000) / 100,
        effectiveRatePct: Math.round(effective * 10000) / 100,
      };
    });
    return NextResponse.json({
      code: refCode.code,
      url: `/r/${refCode.code}`,
      totalClicks,
      totalConversions,
      pendingUsd: Math.round(pendingUsd * 100) / 100,
      approvedUsd: Math.round(approvedUsd * 100) / 100,
      paidUsd: Math.round(paidUsd * 100) / 100,
      referralMultiplier,
      stakeTier,
      effectiveRates,
      conversions: commissions.map((c) => ({
        id: c.id,
        orderNumber: c.orderNumber,
        productLabel: c.productLabel,
        productType: c.productType,
        orderUsd: c.orderUsd,
        commissionPct: c.commissionPct,
        commissionUsd: c.commissionUsd,
        status: c.status,
        paidAt: c.paidAt?.toISOString() ?? null,
        referredLabel: c.referredEmail
          ? c.referredEmail.replace(/(.{3}).+(@.+)/, "$1…$2")
          : c.referredWallet
            ? `${c.referredWallet.slice(0, 6)}…${c.referredWallet.slice(-4)}`
            : "—",
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[referrals/my-stats] error:", err);
    const detail =
      process.env.NODE_ENV === "development" && Error.isError(err) ? err.message : undefined;
    return NextResponse.json(
      { error: "Failed to load stats", ...(detail ? { detail } : {}) },
      { status: 500 },
    );
  }
}
