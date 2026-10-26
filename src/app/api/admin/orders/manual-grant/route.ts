import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { activateOrder } from "@/lib/order-service";
import { activateProSubscriptionInTx } from "@/lib/pro-subscription";
import { normalizeReferralBuyerWallet } from "@/lib/referral-commission";
import { allocateOrderNumber } from "@/lib/order-number";
import {
  POWER_BOOST_TIERS,
  AD_TIERS,
  VERIFIED_REVENUE_TIERS,
  KYA_PRICE_USD,
  VERIFICATION_BUNDLE_PRICE_USD,
  VERIFICATION_BUNDLE_TIER,
  PRO_SUBSCRIPTION_PRICE_USD,
  AD_TEXT_MAX_CHARS,
  getPaymentChainId,
} from "@/lib/product-config";
export const dynamic = "force-dynamic";
const ADMIN_WALLET = "admin-manual";
/**
 * POST /api/admin/orders/manual-grant
 * Admin manually creates and immediately activates a product for any agent/user.
 * Supports: kya_verify, verification_bundle, power_boost, ad, verified_revenue, pro_subscription
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const productType = String(body.productType ?? "").trim();
  const tier        = String(body.tier ?? "").trim();
  const wallet      = String(body.wallet ?? ADMIN_WALLET).trim() || ADMIN_WALLET;
  const email       = String(body.email ?? "").trim().toLowerCase();
  const notes       = String(body.notes ?? "").trim().slice(0, 500);
  // ── Validate product type ────────────────────────────────────────────────
  const validTypes = ["kya_verify", "verification_bundle", "power_boost", "ad", "verified_revenue", "pro_subscription"];
  if (!validTypes.includes(productType)) {
    return NextResponse.json({ error: `Invalid productType. Must be one of: ${validTypes.join(", ")}` }, { status: 400 });
  }
  // ── Resolve agentId (required for most product types) ───────────────────
  const agentIdRaw = body.agentId;
  let agentId: number | null = null;
  if (agentIdRaw !== undefined && agentIdRaw !== null && agentIdRaw !== "") {
    const n = Number(agentIdRaw);
    if (!Number.isFinite(n) || n < 1) return NextResponse.json({ error: "Invalid agentId" }, { status: 400 });
    const agent = await prisma.agent.findUnique({ where: { id: Math.floor(n) } });
    if (!agent) return NextResponse.json({ error: `Agent ${n} not found` }, { status: 404 });
    agentId = Math.floor(n);
  }
  // ── Validate tier + price per product type ───────────────────────────────
  let usdPrice = 0;
  let normalizedTier = tier;
  if (productType === "kya_verify") {
    if (!agentId) return NextResponse.json({ error: "agentId required for kya_verify" }, { status: 400 });
    normalizedTier = "";
    usdPrice = KYA_PRICE_USD;
  } else if (productType === "verification_bundle") {
    if (!agentId) return NextResponse.json({ error: "agentId required for verification_bundle" }, { status: 400 });
    normalizedTier = VERIFICATION_BUNDLE_TIER;
    usdPrice = VERIFICATION_BUNDLE_PRICE_USD;
  } else if (productType === "power_boost") {
    if (!agentId) return NextResponse.json({ error: "agentId required for power_boost" }, { status: 400 });
    const t = POWER_BOOST_TIERS.find((x) => x.label === tier);
    if (!t) return NextResponse.json({ error: `Unknown boost tier. Valid: ${POWER_BOOST_TIERS.map((x) => x.label).join(", ")}` }, { status: 400 });
    usdPrice = t.priceUsd;
    normalizedTier = t.label;
  } else if (productType === "ad") {
    if (!agentId) return NextResponse.json({ error: "agentId required for ad" }, { status: 400 });
    const t = AD_TIERS.find((x) => x.label === tier);
    if (!t) return NextResponse.json({ error: `Unknown ad tier. Valid: ${AD_TIERS.map((x) => x.label).join(", ")}` }, { status: 400 });
    usdPrice = t.priceUsd;
    normalizedTier = t.label;
  } else if (productType === "verified_revenue") {
    if (!agentId) return NextResponse.json({ error: "agentId required for verified_revenue" }, { status: 400 });
    const t = VERIFIED_REVENUE_TIERS.find((x) => x.label === tier);
    if (!t) return NextResponse.json({ error: `Unknown VR tier. Valid: ${VERIFIED_REVENUE_TIERS.map((x) => x.label).join(", ")}` }, { status: 400 });
    usdPrice = t.priceUsd;
    normalizedTier = t.label;
  } else if (productType === "pro_subscription") {
    // pro_subscription targets a user by email or wallet — no agentId needed
    if (!email && wallet === ADMIN_WALLET) {
      return NextResponse.json({ error: "email or wallet required for pro_subscription" }, { status: 400 });
    }
    normalizedTier = "pro";
    usdPrice = PRO_SUBSCRIPTION_PRICE_USD;
  }
  // ── Override price if admin provides one ────────────────────────────────
  if (body.overridePrice !== undefined && body.overridePrice !== null && body.overridePrice !== "") {
    const p = Number(body.overridePrice);
    if (Number.isFinite(p) && p >= 0) usdPrice = p;
  }
  // ── Ad creative fields ───────────────────────────────────────────────────
  const bannerUrl = String(body.bannerUrl ?? "").trim().slice(0, 500);
  const linkUrl   = String(body.linkUrl   ?? "").trim().slice(0, 500);
  const adText    = String(body.adText    ?? "").trim().slice(0, AD_TEXT_MAX_CHARS);
  // ── Create Order record ──────────────────────────────────────────────────
  const paymentAsset = "USDC_BASE";
  const chainId = getPaymentChainId(paymentAsset);
  const prefixMap: Record<string, "P" | "A" | "B" | "VR" | "VB"> = {
    power_boost: "B",
    ad: "A",
    kya_verify: "P",
    verified_revenue: "VR",
    verification_bundle: "VB",
  };
  const prefix = prefixMap[productType] ?? "A";
  const txHash = `admin-grant-${Date.now()}-${randomBytes(6).toString("hex")}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h (won't matter, immediately activated)
  try {
    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const orderNumber = await allocateOrderNumber(tx, prefix, now);
      const order = await tx.order.create({
        data: {
          orderNumber,
          productType,
          tier: normalizedTier,
          usdPrice,
          paymentAsset,
          chainId,
          cryptoAmount: String(usdPrice),
          wallet: normalizeReferralBuyerWallet(wallet) || wallet,
          email,
          status: "pending",
          txHash,
          expiresAt,
          bannerUrl: bannerUrl || undefined,
          linkUrl:   linkUrl   || undefined,
          adText:    adText    || undefined,
          ...(agentId != null ? { agent: { connect: { id: agentId } } } : {}),
        },
      });
      if (productType !== "pro_subscription") return { order, subscription: null };
      const subscription = await activateProSubscriptionInTx(tx, {
        email,
        wallet: wallet === ADMIN_WALLET ? "" : wallet,
      }, now);
      const paidOrder = await tx.order.update({
        where: { id: order.id },
        data: { status: "paid", paidAt: now },
      });
      return { order: paidOrder, subscription };
    });
    if (productType !== "pro_subscription") {
      await activateOrder(result.order.id);
    }
    console.log(`[admin/manual-grant] ${productType}/${normalizedTier} granted — order ${result.order.orderNumber}, agent ${agentId}, wallet ${wallet}, notes: ${notes}`);
    return NextResponse.json({
      ok: true,
      orderId: result.order.id,
      orderNumber: result.order.orderNumber,
      productType,
      tier: normalizedTier,
      ...(result.subscription ? {
        profileId: result.subscription.profileId,
        subscriptionExpiresAt: result.subscription.expiresAt.toISOString(),
      } : {}),
    });
  } catch (err) {
    console.error("[admin/manual-grant] Error:", err);
    return NextResponse.json({ error: Error.isError(err) ? err.message : "Failed to grant product" }, { status: 500 });
  }
}
