import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { allocateOrderNumber } from "@/lib/order-number";
import { AD_TEXT_MAX_CHARS, getAdTier, getPaymentChainId } from "@/lib/product-config";
import {
  reconcileActiveCheckoutAdPackagesToPublicSlots,
  syncAdPackageToPublicSlots,
} from "@/lib/ad-package-public-sync";
import {
  normalizeAdAccentColor,
  normalizeAdIconKey,
  normalizeAdvertiserDisplayName,
} from "@/lib/ad-theme";
export const dynamic = "force-dynamic";
const ADMIN_MANUAL_WALLET = "admin-manual";
const MAX_URL_LEN = 2048;
const MAX_ORDER_CREATIVE = 500;
const VALID_STATUSES = ["pending", "active"] as const;
/**
 * POST /api/admin/ad-packages/manual
 * Creates a paid Order + AdPackage without checkout (custom link, optional agent).
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const tier = String(body.tier ?? "").trim();
    const tierDef = getAdTier(tier);
    if (!tierDef) {
      return NextResponse.json(
        { error: "tier must be Starter, Growth, or Launch" },
        { status: 400 }
      );
    }
    let durationDays: number = tierDef.durationDays;
    if (body.durationDays !== undefined && body.durationDays !== null) {
      const d = Number(body.durationDays);
      if (!Number.isFinite(d) || d < 1 || d > 365) {
        return NextResponse.json(
          { error: "durationDays must be between 1 and 365" },
          { status: 400 }
        );
      }
      durationDays = Math.floor(d);
    }
    /** Default active so manual placements go live immediately; set pending for drafts. */
    const status = String(body.status ?? "active").trim();
    if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      return NextResponse.json(
        { error: "status must be pending or active" },
        { status: 400 }
      );
    }
    const linkUrl = String(body.linkUrl ?? "").trim().slice(0, MAX_URL_LEN);
    const adText = String(body.adText ?? "").trim().slice(0, AD_TEXT_MAX_CHARS);
    const bannerUrl = String(body.bannerUrl ?? "").trim().slice(0, MAX_URL_LEN);
    const stripAdvertiserName = normalizeAdvertiserDisplayName(body.stripAdvertiserName);
    const adIconKey = normalizeAdIconKey(body.adIconKey);
    const adAccentColor = normalizeAdAccentColor(body.adAccentColor);
    const vipAd = Boolean(body.vipAd);
    const agentIdRaw = body.agentId;
    let agentId: number | undefined;
    if (agentIdRaw !== undefined && agentIdRaw !== null && agentIdRaw !== "") {
      const n = Number(agentIdRaw);
      if (!Number.isFinite(n) || n < 1) {
        return NextResponse.json({ error: "Invalid agentId" }, { status: 400 });
      }
      const agent = await prisma.agent.findUnique({ where: { id: Math.floor(n) } });
      if (!agent) {
        return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      }
      agentId = Math.floor(n);
    }
    const paymentAsset = "USDC_BASE";
    const chainId = getPaymentChainId(paymentAsset);
    const packageExpiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    const txHash = `admin-ad-${Date.now()}-${randomBytes(8).toString("hex")}`;
    const orderBanner = bannerUrl.slice(0, MAX_ORDER_CREATIVE);
    const orderLink = linkUrl.slice(0, MAX_ORDER_CREATIVE);
    const result = await prisma.$transaction(async (tx) => {
      const orderNumber = await allocateOrderNumber(tx, "A");
      const order = await tx.order.create({
        data: {
          orderNumber,
          productType: "ad",
          tier,
          usdPrice: 0,
          paymentAsset,
          chainId,
          cryptoAmount: "0",
          wallet: ADMIN_MANUAL_WALLET,
          email: "",
          status: "paid",
          paidAt: new Date(),
          txHash,
          expiresAt: packageExpiresAt,
          bannerUrl: orderBanner,
          linkUrl: orderLink,
          adText,
          stripAdvertiserName,
          adIconKey,
          adAccentColor,
          ...(agentId != null ? { agent: { connect: { id: agentId } } } : {}),
        },
      });
      const adPackage = await tx.adPackage.create({
        data: {
          orderId: order.id,
          tier,
          durationDays,
          tweetCount: tierDef.tweetCount,
          bannerUrl,
          linkUrl,
          adText,
          stripAdvertiserName,
          adIconKey,
          adAccentColor,
          status,
          vipAd,
          expiresAt: packageExpiresAt,
        },
      });
      return { order, adPackage };
    });
    if (status === "active") {
      try {
        await syncAdPackageToPublicSlots(result.adPackage.id);
        await reconcileActiveCheckoutAdPackagesToPublicSlots();
      } catch (syncErr) {
        console.error("sync after manual ad create:", syncErr);
        const msg = Error.isError(syncErr) ? syncErr.message : String(syncErr);
        return NextResponse.json(
          {
            error: "Ad created but failed to sync public slots",
            details: msg,
            adPackageId: result.adPackage.id,
          },
          { status: 500 }
        );
      }
    }
    return NextResponse.json({
      ok: true,
      adPackage: {
        id: result.adPackage.id,
        orderId: result.order.id,
        orderNumber: result.order.orderNumber,
        status: result.adPackage.status,
      },
    });
  } catch (err) {
    console.error("POST /api/admin/ad-packages/manual:", err);
    return NextResponse.json(
      { error: Error.isError(err) ? err.message : "Failed to create manual ad" },
      { status: 500 }
    );
  }
}
