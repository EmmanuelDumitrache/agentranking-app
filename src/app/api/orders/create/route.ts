import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getJobProducer } from "@/jobs/boss";
import { enqueueApplicationJobInTx } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import { prisma } from "@/lib/db";
import {
  POWER_BOOST_TIERS,
  AD_TIERS,
  AD_TEXT_MAX_CHARS,
  getTierPriceOrTest,
  getPaymentChainId,
  getUsdcContract,
  usdToUsdc,
  isPaymentTestMode,
  VERIFIED_REVENUE_TIERS,
  getVerifiedRevenueTier,
  VERIFICATION_BUNDLE_TIER,
} from "@/lib/product-config";
import { allocateOrderNumber } from "@/lib/order-number";
import { resolveAgentDbIdFromLinkUrl } from "@/lib/resolve-agent-from-link-url";
import { extractReferralCodeFromInput } from "@/lib/referral-code-utils";
import { isValidEmail } from "@/lib/dashboard/auth-validate";
import { NOTIFICATION_KINDS, queueNotificationInTx } from "@/lib/notification-delivery";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  parseBoundedJsonBody,
} from "@/lib/bounded-http-body";
import {
  normalizeAdAccentColor,
  normalizeAdIconKey,
  normalizeAdvertiserDisplayName,
} from "@/lib/ad-theme";
export const dynamic = "force-dynamic";
const TREASURY = process.env.TREASURY_ADDRESS_BASE ?? "";

const CreateOrderBodySchema = z.strictObject({
  productType: z.enum(["power_boost", "ad", "kya_verify", "verified_revenue", "verification_bundle"]),
  tier: z.string().trim().optional(),
  agentId: z.number().int().positive().optional(),
  wallet: z.string().trim().min(1),
  email: z.string().trim().optional(),
  paymentAsset: z.enum(["USDC_BASE", "USDC_ETH"]).optional().default("USDC_BASE"),
  imageUrl: z.string().trim().optional(),
  bannerUrl: z.string().trim().optional(),
  linkUrl: z.string().trim().optional(),
  adText: z.string().trim().optional(),
  stripAdvertiserName: z.string().trim().optional(),
  adIconKey: z.string().trim().optional(),
  adAccentColor: z.string().trim().optional(),
  tokenAddress: z.string().trim().optional(),
  description: z.string().trim().optional(),
  socialLinks: z.record(z.string(), z.string()).optional(),
  services: z.array(z.strictObject({
    name: z.string().trim(),
    endpoint: z.string().trim().optional().default(""),
  })).optional(),
  customTags: z.string().trim().optional(),
  referralCode: z.string().trim().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await parseBoundedJsonBody(request, CreateOrderBodySchema, 256 * 1024);
    const {
      productType,
      tier = "",
      agentId,
      wallet,
      email = "",
      paymentAsset = "USDC_BASE",
      imageUrl = "",
      bannerUrl = "",
      linkUrl = "",
      adText = "",
      stripAdvertiserName = "",
      adIconKey = "",
      adAccentColor = "",
      tokenAddress = "",
      description = "",
      socialLinks = {},
      services = [],
      customTags = "",
      referralCode = "",
    } = body;
    const normalizedTier =
      productType === "verification_bundle" ? (tier.trim() || VERIFICATION_BUNDLE_TIER) : tier;
    // tier is optional for kya_verify (single-tier product) and verification_bundle (defaults)
    if (productType !== "kya_verify" && productType !== "verification_bundle" && !tier) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    const emailTrim = String(email || "").trim().toLowerCase();
    if (
      productType === "kya_verify" ||
      productType === "verification_bundle" ||
      productType === "ad"
    ) {
      if (!isValidEmail(emailTrim)) {
        return NextResponse.json(
          {
            error:
              productType === "ad"
                ? "Valid email is required for your ad receipt and placement updates."
                : "Valid email is required for your receipt.",
          },
          { status: 400 },
        );
      }
    }
    const refCodeNorm = extractReferralCodeFromInput(String(referralCode || "")).slice(0, 80);
    if (refCodeNorm) {
      const refRecord = await prisma.arReferralCode.findUnique({
        where: { code: refCodeNorm },
        select: { code: true, isActive: true, ownerWallet: true },
      });
      const isSelfReferral = refRecord?.ownerWallet?.toLowerCase() === wallet.toLowerCase();
      if (!refRecord?.isActive || isSelfReferral) {
        return NextResponse.json(
          { error: isSelfReferral ? "You cannot use your own referral code." : "Invalid or inactive referral code." },
          { status: 400 },
        );
      }
    }
    // Validate tier and get price
    let usdPrice: number | null;
    let normalizedAdLinkUrl = "";
    if (productType === "power_boost") {
      const t = POWER_BOOST_TIERS.find((x) => x.label === tier);
      if (!t) return NextResponse.json({ error: `Unknown tier: ${tier}` }, { status: 400 });
      if (!agentId) return NextResponse.json({ error: "agentId required for power_boost" }, { status: 400 });
      // Check the agent exists
      const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true } });
      if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      usdPrice = getTierPriceOrTest("power_boost", tier);
    } else if (productType === "ad") {
      const t = AD_TIERS.find((x) => x.label === tier);
      if (!t) return NextResponse.json({ error: `Unknown tier: ${tier}` }, { status: 400 });
      if (!agentId) return NextResponse.json({ error: "agentId required for ad" }, { status: 400 });
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { id: true },
      });
      if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      const linkTrim = String(linkUrl || "").trim();
      if (!linkTrim) {
        return NextResponse.json(
          { error: "Agent page URL (linkUrl) is required for ads" },
          { status: 400 }
        );
      }
      const resolvedFromUrl = await resolveAgentDbIdFromLinkUrl(linkTrim);
      if (resolvedFromUrl == null) {
        return NextResponse.json(
          { error: "Invalid agent page URL. Use the complete current profile URL: /agents/{chainId}/{agentId}/{current-name-slug}" },
          { status: 400 }
        );
      }
      if (resolvedFromUrl !== agentId) {
        return NextResponse.json(
          { error: "Agent page URL does not match the selected agent" },
          { status: 400 }
        );
      }
      normalizedAdLinkUrl = linkTrim;
      usdPrice = getTierPriceOrTest("ad", tier);
    } else if (productType === "verified_revenue") {
      if (!agentId) return NextResponse.json({ error: "agentId required for verified_revenue" }, { status: 400 });
      const vrTier = getVerifiedRevenueTier(tier);
      if (!vrTier) {
        const valid = VERIFIED_REVENUE_TIERS.map((t) => t.label).join(", ");
        return NextResponse.json({ error: `Unknown tier. Valid: ${valid}` }, { status: 400 });
      }
      const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, owner: true, verifiedWallet: true } });
      if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      if (agent.owner.toLowerCase() !== wallet.toLowerCase()) {
        return NextResponse.json({ error: "Wallet does not own this agent" }, { status: 403 });
      }
      if (!agent.verifiedWallet) {
        return NextResponse.json({ error: "Agent has no linked execution wallet. Complete wallet linking first." }, { status: 400 });
      }
      usdPrice = getTierPriceOrTest("verified_revenue", tier);
    } else if (productType === "verification_bundle") {
      if (!agentId) return NextResponse.json({ error: "agentId required for verification_bundle" }, { status: 400 });
      if (normalizedTier !== VERIFICATION_BUNDLE_TIER) {
        return NextResponse.json({ error: `Unknown tier for verification bundle. Use "${VERIFICATION_BUNDLE_TIER}".` }, { status: 400 });
      }
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        include: { metadata: true },
      });
      if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      if (agent.isPremiumVerified) {
        return NextResponse.json(
          { error: "Agent is already premium verified. Use Verified Revenue add-on if you only need execution wallet proof." },
          { status: 400 }
        );
      }
      if (agent.owner.toLowerCase() !== wallet.toLowerCase()) {
        return NextResponse.json({ error: "Wallet does not own this agent" }, { status: 403 });
      }
      if (!agent.verifiedWallet?.trim()) {
        return NextResponse.json({ error: "Link an execution wallet before purchasing Full Verification." }, { status: 400 });
      }
      usdPrice = getTierPriceOrTest("verification_bundle", VERIFICATION_BUNDLE_TIER);
    } else {
      // kya_verify
      if (!agentId) return NextResponse.json({ error: "agentId required for kya_verify" }, { status: 400 });
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        include: { metadata: true },
      });
      if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      if (agent.isPremiumVerified) {
        return NextResponse.json({ error: "Agent is already KYA verified" }, { status: 400 });
      }
      usdPrice = getTierPriceOrTest("kya_verify", tier);
    }
    if (usdPrice == null) return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
    const cryptoAmount = usdToUsdc(usdPrice);
    const chainId = getPaymentChainId(paymentAsset as "USDC_BASE" | "USDC_ETH");
    const usdcContractAddress = getUsdcContract(paymentAsset as "USDC_BASE" | "USDC_ETH");
    // Generate order number using product type prefix
    const typeMap: Record<string, "P" | "A" | "B" | "VR" | "VB"> = {
      power_boost: "B",
      ad: "A",
      kya_verify: "P",
      verified_revenue: "VR",
      verification_bundle: "VB",
    };
    const expiresMinutes = isPaymentTestMode() ? 60 : 60; // 60 min for Helio checkout completion
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);
    const orderData: Parameters<typeof prisma.order.create>[0]["data"] = {
      orderNumber: "",
      productType,
      tier: productType === "verification_bundle" ? VERIFICATION_BUNDLE_TIER : tier,
      usdPrice,
      paymentAsset,
      chainId,
      cryptoAmount,
      wallet: wallet.toLowerCase(),
      email: emailTrim || email,
      ...(agentId != null ? { agent: { connect: { id: agentId } } } : {}),
      expiresAt,
    };
    if (productType === "ad") {
      orderData.bannerUrl = String(bannerUrl || "").trim().slice(0, 500);
      orderData.linkUrl = normalizedAdLinkUrl.slice(0, 500);
      orderData.adText = String(adText || "").trim().slice(0, AD_TEXT_MAX_CHARS);
      orderData.stripAdvertiserName = normalizeAdvertiserDisplayName(stripAdvertiserName);
      orderData.adIconKey = normalizeAdIconKey(adIconKey);
      orderData.adAccentColor = normalizeAdAccentColor(adAccentColor);
    } else if (productType === "kya_verify" || productType === "verification_bundle") {
      orderData.imageUrl = String(imageUrl || "").trim().slice(0, 500);
      orderData.bannerUrl = String(bannerUrl || "").trim().slice(0, 500);
    }
    await getJobProducer();
    const order = await prisma.$transaction(async (tx) => {
      const orderNumber = await allocateOrderNumber(tx, typeMap[productType]);
      const created = await tx.order.create({ data: { ...orderData, orderNumber } });
      await enqueueApplicationJobInTx(tx, JOB_QUEUES.ORDER_EXPIRE, { v: 1, id: created.id }, {
        startAfter: created.expiresAt,
        singletonKey: created.id,
      });
      const notificationRecipient = emailTrim || email;
      if (notificationRecipient) {
        await queueNotificationInTx(tx, {
          idempotencyKey: `order:${created.id}:created`,
          kind: NOTIFICATION_KINDS.ORDER_CREATED,
          recipient: notificationRecipient,
          payload: { orderId: created.id },
        });
      }
      return created;
    });
    // Store referral code on the order (validated above when present)
    let referralAttached: boolean | undefined;
    if (refCodeNorm) {
      referralAttached = true;
      await prisma.$executeRaw`
        UPDATE "Order" SET "referralCode" = ${refCodeNorm} WHERE id = ${order.id}
      `;
    }
    // Set KYA and token fields via raw SQL (avoids Prisma client schema sync issues)
    if (productType === "kya_verify" || productType === "verification_bundle") {
      const rawToken = String(tokenAddress || "").trim();
      const tokenAddr = rawToken
        ? (rawToken.startsWith("0x") ? rawToken.toLowerCase().slice(0, 42) : rawToken.slice(0, 44))
        : "";
      const kyaDesc = String(description || "").trim().slice(0, 500);
      const kyaMeta: Record<string, string> = {};
      for (const [k, v] of Object.entries(socialLinks || {})) {
        const t = String(v || "").trim();
        if (t) kyaMeta[k] = t.slice(0, 500);
      }
      if (String(customTags || "").trim()) {
        kyaMeta.customTags = String(customTags || "").trim().slice(0, 200);
      }
      const kyaSvcs = (services || [])
        .filter((s) => s?.name?.trim())
        .map((s) => ({
          name: String(s.name).trim().slice(0, 20),
          endpoint: String(s.endpoint || "").trim().slice(0, 500),
        }));
      const kyaMetaJson = JSON.stringify(kyaMeta);
      const kyaSvcsJson = JSON.stringify(kyaSvcs);
      await prisma.$executeRaw`
        UPDATE "Order"
        SET "tokenAddress" = ${tokenAddr},
            "kyaDescription" = ${kyaDesc},
            "kyaMetadata" = ${kyaMetaJson},
            "kyaServices" = ${kyaSvcsJson}
        WHERE id = ${order.id}
      `;
    }
    // Log conversion for funnel analytics
    await prisma.conversionEvent.create({
      data: {
        eventType: "order_created",
        productType,
      },
    });
    return NextResponse.json({
      orderId: order.id,
      orderNumber: order.orderNumber,
      usdPrice,
      cryptoAmount,
      paymentAsset,
      treasuryAddress: TREASURY,
      usdcContractAddress,
      chainId,
      expiresAt: order.expiresAt.toISOString(),
      ...(refCodeNorm !== "" ? { referralAttached: referralAttached ?? false } : {}),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid order request: " + (err.issues[0]?.message ?? "malformed") }, { status: 400 });
    }
    if (err instanceof HttpBodyTooLargeError) {
      return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
    }
    if (err instanceof InvalidJsonBodyError || err instanceof InvalidHttpBodyEncodingError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("[orders/create] Error:", err);
    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "development"
            ? `Failed to create order: ${msg}`
            : "Failed to create order",
      },
      { status: 500 }
    );
  }
}
