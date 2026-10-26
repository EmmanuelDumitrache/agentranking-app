import { prisma } from "@/lib/db";
import { createReferralCommission, normalizeReferralBuyerWallet } from "@/lib/referral-commission";
import { PRO_SUBSCRIPTION_PRICE_USD } from "@/lib/product-config";
export async function qualifySubscriptionReferral(
  providerEventId: string,
  wallet: string,
  email: string,
) {
  const attributionKeys = [...new Set([
    normalizeReferralBuyerWallet(wallet),
    email.trim().toLowerCase(),
  ].filter(Boolean))];
  if (attributionKeys.length === 0) return { ok: true, skipped: "missing_attribution" };
  const intentEvent = await prisma.arReferralEvent.findFirst({
    where: {
      eventType: "subscription_intent",
      conversionStatus: "pending",
      referredWallet: { in: attributionKeys },
    },
    orderBy: { createdAt: "desc" },
    include: { referralCode: { select: { code: true, ownerWallet: true, isActive: true } } },
  });
  if (!intentEvent) return { ok: true, skipped: "no_pending_intent" };
  const buyerWallet = normalizeReferralBuyerWallet(wallet);
  const ownerWallet = normalizeReferralBuyerWallet(intentEvent.referralCode.ownerWallet);
  if (!intentEvent.referralCode.isActive || (buyerWallet && buyerWallet === ownerWallet)) {
    await prisma.arReferralEvent.updateMany({
      where: { id: intentEvent.id, conversionStatus: "pending" },
      data: { conversionStatus: "disqualified", spamReason: buyerWallet === ownerWallet ? "Self referral" : "Inactive referral code" },
    });
    return { ok: true, skipped: buyerWallet === ownerWallet ? "self_referral" : "inactive_referral" };
  }
  await createReferralCommission({
    id: `subscription:${providerEventId}`,
    orderNumber: `HELIO-${providerEventId.slice(0, 24)}`,
    productType: "pro_subscription",
    usdPrice: PRO_SUBSCRIPTION_PRICE_USD,
    wallet,
    email,
  }, intentEvent.referralCode.code, `subscription:${providerEventId}`);
  await prisma.arReferralEvent.updateMany({
    where: { id: intentEvent.id, conversionStatus: "pending" },
    data: { conversionStatus: "qualified" },
  });
  return { ok: true, qualified: true };
}
