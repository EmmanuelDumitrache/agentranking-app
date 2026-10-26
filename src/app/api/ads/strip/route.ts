import { NextRequest, NextResponse } from "next/server";
import { mapWithConcurrency } from "@/lib/async-pool";
import { prisma } from "@/lib/db";
import { getAdStripAdvertiserMeta } from "@/lib/ad-order-agent-name";
import { allowClientTestnetFromServer } from "@/lib/env-deploy";
import { claimPaymentTransactionInTx, verifyPayment, isTestMode, multiplyPaymentAmount } from "@/lib/payment-verify";
import { generateOrderNumber } from "@/lib/order-number";
import { normalizeStripAdDisplayText } from "@/lib/strip-ad-text";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 30;
const STRIP_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
};
type StripGetPayload = { ads: Array<Record<string, unknown>> };
const AD_PER_DAY: Record<string, string> = { ETH: "0.01", USDC: "20", SOL: "0.15" };
const AD_PER_DAY_TEST: Record<string, string> = { ETH: "0.00001", USDC: "0.02", SOL: "0.00015" };
function calcExpectedAmount(currency: string, days: number, testMode: boolean): string {
  const token = currency as "ETH" | "USDC" | "SOL";
  const rate = (testMode ? AD_PER_DAY_TEST : AD_PER_DAY)[token];
  if (!rate) throw new Error(`No ad rate configured for ${token}`);
  return multiplyPaymentAmount(rate, days, token);
}
/**
 * GET /api/ads/strip — active strip rows with non-empty text (top bar is text promos only).
 * Banner-only creatives are omitted here; they still run in sidebar + /api/ads/popup-pool.
 * Response never includes banner URLs for the strip UI (text + link only).
 */
export async function GET() {
  try {
    const rows = await prisma.adOrderStrip.findMany({
      where: { status: "active", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "asc" },
      take: 40,
      select: {
        id: true,
        adText: true,
        linkUrl: true,
        adIconKey: true,
        adAccentColor: true,
        expiresAt: true,
        txHash: true,
      },
    });
    const rowsWithText = rows
      .map((row) => ({ row, adTextTrim: (row.adText ?? "").trim() }))
      .filter(({ adTextTrim }) => adTextTrim.length > 0);
    const ads = await mapWithConcurrency(
      rowsWithText,
      8,
      async ({ row, adTextTrim }) => {
        const meta = await getAdStripAdvertiserMeta(row.txHash, row.linkUrl ?? "");
        const { txHash: _t, ...rest } = row;
        return {
          ...rest,
          adText: normalizeStripAdDisplayText(adTextTrim),
          agentName: meta.name,
          agentImage: meta.image,
          isVerified: meta.isVerified,
          isPremiumVerified: meta.isPremiumVerified,
          isVipAd: meta.isVipAd,
        };
      },
    );
    const payload: StripGetPayload = {
      ads: ads as Array<Record<string, unknown>>,
    };
    return NextResponse.json(payload, { headers: STRIP_CACHE_HEADERS });
  } catch (err) {
    return NextResponse.json(
      { ads: [], error: String(err) },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  }
}
/**
 * POST /api/ads/strip — create a strip ad order
 * Body: { adText?, bannerUrl?, linkUrl?, days, txHash, wallet, paymentToken, clientTestnet? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const adText = normalizeStripAdDisplayText((body.adText as string) || "");
    const bannerUrl = ((body.bannerUrl as string) || "").trim();
    const linkUrl = ((body.linkUrl as string) || "").trim();
    const days = Number(body.days);
    const txHash = (body.txHash as string)?.trim();
    const wallet = (body.wallet as string)?.trim();
    const paymentToken = ((body.paymentToken as string) || "ETH").toUpperCase();
    const clientTestnet = body.clientTestnet === true;
    if (!txHash || !wallet || (!adText && !bannerUrl)) {
      return NextResponse.json({ error: "Missing required fields: txHash, wallet, and adText or bannerUrl" }, { status: 400 });
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
      const ad = await tx.adOrderStrip.create({
        data: { adText, bannerUrl, linkUrl, days, txHash: result.transactionId, paidAmount: result.paidAmount, currency: result.currency, paymentToken: result.paymentToken, wallet: result.payerWallet, status: "pending", expiresAt },
      });
      const generated = generateOrderNumber(ad.id, "S");
      await tx.adOrderStrip.update({ where: { id: ad.id }, data: { orderNumber: generated } });
      return { orderNumber: generated };
    });
    return NextResponse.json({ success: true, orderNumber, message: "Strip ad submitted. Goes live after review (usually within 24h).", expiresAt });
  } catch (err) {
    return NextResponse.json({ error: Error.isError(err) ? err.message : "Failed to submit" }, { status: 500 });
  }
}
