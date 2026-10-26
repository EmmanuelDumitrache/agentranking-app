import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdStripAdvertiserMeta } from "@/lib/ad-order-agent-name";
import { allowClientTestnetFromServer } from "@/lib/env-deploy";
import { claimPaymentTransactionInTx, verifyPayment, isTestMode, multiplyPaymentAmount } from "@/lib/payment-verify";
import { generateOrderNumber } from "@/lib/order-number";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 30;
const AD_PER_DAY: Record<string, string> = { ETH: "0.012", USDC: "25", SOL: "0.18" };
const AD_PER_DAY_TEST: Record<string, string> = { ETH: "0.000012", USDC: "0.025", SOL: "0.00018" };
function calcExpectedAmount(currency: string, days: number, testMode: boolean): string {
  const token = currency as "ETH" | "USDC" | "SOL";
  const rate = (testMode ? AD_PER_DAY_TEST : AD_PER_DAY)[token];
  if (!rate) throw new Error(`No ad rate configured for ${token}`);
  return multiplyPaymentAmount(rate, days, token);
}
/**
 * GET /api/ads/square — active square sidebar ads with banners.
 */
export async function GET() {
  try {
    const rows = await prisma.adOrderSquare.findMany({
      where: { status: "active", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "asc" },
      take: 40,
      select: {
        id: true,
        bannerUrl: true,
        linkUrl: true,
        adIconKey: true,
        adAccentColor: true,
        expiresAt: true,
        txHash: true,
      },
    });
    const ads: Array<{
      id: number;
      bannerUrl: string;
      linkUrl: string;
      expiresAt: Date;
      agentName: string | null;
      agentImage: string | null;
      isVerified: boolean;
      isPremiumVerified: boolean;
      isVipAd: boolean;
      adIconKey: string;
      adAccentColor: string;
    }> = [];
    for (const row of rows) {
      const banner = (row.bannerUrl ?? "").trim();
      if (!banner) continue;
      const meta = await getAdStripAdvertiserMeta(row.txHash, row.linkUrl ?? "");
      const { txHash: _t, ...ad } = row;
      ads.push({
        ...ad,
        bannerUrl: banner,
        agentName: meta.name,
        agentImage: meta.image,
        isVerified: meta.isVerified,
        isPremiumVerified: meta.isPremiumVerified,
        isVipAd: meta.isVipAd,
        adIconKey: row.adIconKey,
        adAccentColor: row.adAccentColor,
      });
    }
    return NextResponse.json({ ads });
  } catch (err) {
    return NextResponse.json({ ads: [], error: String(err) });
  }
}
/**
 * POST /api/ads/square — create a square sidebar ad order
 * Body: { bannerUrl, linkUrl?, days, txHash, wallet, paymentToken, clientTestnet? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const bannerUrl = (body.bannerUrl as string)?.trim();
    const linkUrl = ((body.linkUrl as string) || "").trim();
    const days = Number(body.days);
    const txHash = (body.txHash as string)?.trim();
    const wallet = (body.wallet as string)?.trim();
    const paymentToken = ((body.paymentToken as string) || "ETH").toUpperCase();
    const clientTestnet = body.clientTestnet === true;
    if (!bannerUrl || !txHash || !wallet) {
      return NextResponse.json({ error: "Missing required fields: bannerUrl, txHash, wallet" }, { status: 400 });
    }
    if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
      return NextResponse.json({ error: `days must be an integer between ${MIN_DAYS} and ${MAX_DAYS}` }, { status: 400 });
    }
    if (!["ETH", "USDC", "SOL"].includes(paymentToken)) {
      return NextResponse.json({ error: "paymentToken must be ETH, USDC, or SOL" }, { status: 400 });
    }
    const testMode = isTestMode() || (clientTestnet && allowClientTestnetFromServer());
    const expectedAmount = calcExpectedAmount(paymentToken, days, testMode);
    const result = await verifyPayment(paymentToken, txHash, "banner_ad", wallet, days, clientTestnet, expectedAmount);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const { orderNumber } = await prisma.$transaction(async (tx) => {
      await claimPaymentTransactionInTx(tx, result.transactionId, result.paymentToken);
      const ad = await tx.adOrderSquare.create({
        data: { bannerUrl, linkUrl, days, txHash: result.transactionId, paidAmount: result.paidAmount, currency: result.currency, paymentToken: result.paymentToken, wallet: result.payerWallet, status: "pending", expiresAt },
      });
      const generated = generateOrderNumber(ad.id, "Q");
      await tx.adOrderSquare.update({ where: { id: ad.id }, data: { orderNumber: generated } });
      return { orderNumber: generated };
    });
    return NextResponse.json({ success: true, orderNumber, message: "Square ad submitted. Goes live after review (usually within 24h).", expiresAt });
  } catch (err) {
    return NextResponse.json({ error: Error.isError(err) ? err.message : "Failed to submit" }, { status: 500 });
  }
}
