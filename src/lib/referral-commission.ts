import { prisma } from "@/lib/db";
import {
  REFERRAL_COMMISSION_RATES,
  REFERRAL_COMMISSION_LABELS,
} from "@/lib/product-config";
import { extractReferralCodeFromInput } from "@/lib/referral-code-utils";
import { unlockedStakeTierForWallet } from "@/lib/ar-holder-tier-resolve";
import { normalizeSolanaAddress } from "@/lib/sap-claim-message";
import { normalizeReferralOwnerWallet } from "@/lib/referral-owner-wallet";
export function normalizeReferralBuyerWallet(wallet: string): string {
  const trimmed = wallet.trim();
  if (!trimmed) return "";
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed)
    ? trimmed.toLowerCase()
    : normalizeReferralOwnerWallet(trimmed);
}
function referredAttributionKey(wallet: string, email?: string): string {
  return normalizeReferralBuyerWallet(wallet) || (email ?? "").trim().toLowerCase();
}
interface OrderLike {
  id: string;
  orderNumber: string;
  productType: string;
  usdPrice: number;
  wallet: string;
  email: string;
}
/**
 * After an order is activated, create a pending ArReferralCommission if the
 * order carried a valid referral code. The explicit idempotency key is a
 * business invariant; pg-boss retries must not create duplicate commissions.
 */
export async function createReferralCommission(
  order: OrderLike,
  referralCode: string,
  idempotencyKey = `order:${order.id}`,
): Promise<void> {
  const code = extractReferralCodeFromInput(referralCode);
  if (!code) return;
  const baseRate = REFERRAL_COMMISSION_RATES[order.productType];
  if (!baseRate) return; // product type not eligible for commissions
  const refRecord = await prisma.arReferralCode.findUnique({
    where: { code },
    select: { id: true, ownerWallet: true, isActive: true },
  });
  if (!refRecord?.isActive) return;
  // Guard: don't credit self-referrals
  if (normalizeReferralBuyerWallet(refRecord.ownerWallet) === normalizeReferralBuyerWallet(order.wallet)) return;
  const referredNorm = referredAttributionKey(order.wallet, order.email);
  if (!referredNorm) return;
  let referralMultiplier = 1;
  const referrerWallet = normalizeSolanaAddress(refRecord.ownerWallet);
  if (referrerWallet) {
    const { tier } = await unlockedStakeTierForWallet(referrerWallet);
    if (tier) referralMultiplier = tier.referralMultiplier;
  }
  const effectiveRate = Math.round(baseRate * referralMultiplier * 10000) / 10000;
  const commissionUsd = Math.round(order.usdPrice * effectiveRate * 100) / 100;
  const productLabel = REFERRAL_COMMISSION_LABELS[order.productType] ?? order.productType;
  await prisma.arReferralCommission.upsert({
    where: { idempotencyKey },
    create: {
      referralCodeId: refRecord.id,
      referrerWallet: refRecord.ownerWallet,
      referredWallet: referredNorm,
      referredEmail: order.email ?? "",
      orderId: order.productType === "pro_subscription" ? null : order.id,
      idempotencyKey,
      orderNumber: order.orderNumber,
      productType: order.productType,
      productLabel,
      orderUsd: order.usdPrice,
      commissionPct: effectiveRate,
      commissionUsd,
      status: "pending",
    },
    update: {},
  });
  // Upgrade any existing visit/pending event for this wallet+code to "qualified"
  await prisma.arReferralEvent.updateMany({
    where: {
      referralCodeId: refRecord.id,
      referrerWallet: refRecord.ownerWallet,
      referredWallet: referredNorm,
    },
    data: { conversionStatus: "qualified" },
  });
}
