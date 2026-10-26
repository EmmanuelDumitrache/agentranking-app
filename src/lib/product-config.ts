// Single source of truth for all AgentRanking payment products
export const USDC_BASE_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_ETH_CONTRACT = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const PAYMENT_CHAIN_ID = 8453; // Base mainnet
export const PAYMENT_CHAIN_ID_ETH = 1; // Ethereum mainnet
export const PAYMENT_CHAIN_ID_BASE_SEPOLIA = 84532;
export const PAYMENT_CHAIN_ID_ETH_SEPOLIA = 11155111;
export const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const USDC_ETH_SEPOLIA = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
export const POWER_BOOST_TEST_USD = 0.01;
export const AD_TIER_TEST_USD = 0.01;
export const KYA_TEST_USD = 0.01;
export type PaymentAsset = "USDC_BASE" | "USDC_ETH";
/** Production payment flows always use mainnet chains and real prices. */
function isProductionPaymentDeploy(): boolean {
  return process.env.NODE_ENV === "production";
}
export function isPaymentTestMode(): boolean {
  if (isProductionPaymentDeploy()) return false;
  return process.env.PAYMENT_TESTNET_MODE === "true";
}
export function isPaymentTestModeClient(): boolean {
  if (isProductionPaymentDeploy()) return false;
  return process.env.NEXT_PUBLIC_PAYMENT_TESTNET_MODE === "true";
}
function isTestMode(): boolean {
  return isPaymentTestMode() || isPaymentTestModeClient();
}
export function getPaymentChainId(asset: PaymentAsset): number {
  if (isTestMode()) {
    return asset === "USDC_BASE" ? PAYMENT_CHAIN_ID_BASE_SEPOLIA : PAYMENT_CHAIN_ID_ETH_SEPOLIA;
  }
  return asset === "USDC_BASE" ? PAYMENT_CHAIN_ID : PAYMENT_CHAIN_ID_ETH;
}
export function getUsdcContract(asset: PaymentAsset): string {
  if (isTestMode()) {
    return asset === "USDC_BASE" ? USDC_BASE_SEPOLIA : USDC_ETH_SEPOLIA;
  }
  return asset === "USDC_BASE" ? USDC_BASE_CONTRACT : USDC_ETH_CONTRACT;
}
export const POWER_BOOST_TIERS = [
  { label: "Mini",     units: 50,   durationHours: 12,  priceUsd: 49  },
  { label: "Standard", units: 100,  durationHours: 24,  priceUsd: 99  },
  { label: "Pro",      units: 300,  durationHours: 48,  priceUsd: 199 },
  { label: "Golden",   units: 1000, durationHours: 168, priceUsd: 499 },
] as const;
export const AD_TIERS = [
  {
    label: "Starter",
    durationDays: 3,
    tweetCount: 0,
    priceUsd: 49,
    description: "3-day text banner + corner popup rotation",
  },
  {
    label: "Growth",
    durationDays: 7,
    tweetCount: 0,
    priceUsd: 99,
    description: "7-day text banner + corner popup + desktop/mobile rotation",
  },
  {
    label: "Launch",
    durationDays: 30,
    tweetCount: 0,
    priceUsd: 199,
    description: "1-month text banner + corner popup + priority rotation",
  },
] as const;
/** Paid text ads: matches the live strip display cap so submitted copy is not silently clipped. */
export const AD_TEXT_MAX_CHARS = 80;
export const KYA_PRICE_USD = 99;
/** Single checkout: KYA (premium verified) + lifetime verified execution-wallet transparency. */
export const VERIFICATION_BUNDLE_PRICE_USD = 99;
export const VERIFICATION_BUNDLE_TIER = "Verification" as const;
export const PRO_SUBSCRIPTION_PRICE_USD = 39;
/** Platform fee deducted at bounty payout release. TODO: enforce via Helio split payment. */
export const BOUNTY_PLATFORM_FEE_PCT = 0.05;
// --- Referral commission rates (fraction of order USD price) ---
export const REFERRAL_COMMISSION_RATES: Record<string, number> = {
  verification_bundle: 0.05,
  kya_verify: 0.05,
  ad: 0.10,
  pro_subscription: 0.10,
};
export const REFERRAL_COMMISSION_LABELS: Record<string, string> = {
  verification_bundle: "Agent Verification",
  kya_verify: "Agent Verification (KYA)",
  ad: "Ad Package",
  pro_subscription: "Agent Dashboard Pro Subscription",
};
// --- Verified execution and revenue signals ---
export const VERIFIED_REVENUE_TIERS = [
  { label: "Monthly", durationDays: 30,  priceUsd: 19,  description: "Monthly Verified Revenue badge" },
  { label: "Annual",  durationDays: 365, priceUsd: 149, description: "Annual Verified Revenue badge (save 34%)" },
] as const;
export const VERIFIED_REVENUE_TEST_USD = 0.01;
export type ProductType =
  | "power_boost"
  | "ad"
  | "kya_verify"
  | "verified_revenue"
  | "verification_bundle"
  | "pro_subscription";
export function getPowerBoostTier(label: string) {
  return POWER_BOOST_TIERS.find((t) => t.label === label) ?? null;
}
export function getAdTier(label: string) {
  return AD_TIERS.find((t) => t.label === label) ?? null;
}
/** Human-readable placement length for ad tiers (UI + email). */
export function formatAdPlacementDurationDays(days: number): string {
  const n = Math.max(0, Math.floor(Number(days)));
  if (n === 1) return "1 day";
  if (n === 30) return "1 month";
  return `${n} days`;
}
export function getVerifiedRevenueTier(label: string) {
  return VERIFIED_REVENUE_TIERS.find((t) => t.label === label) ?? null;
}
export function getTierPrice(productType: ProductType, tierLabel: string): number | null {
  if (productType === "power_boost") return getPowerBoostTier(tierLabel)?.priceUsd ?? null;
  if (productType === "ad") return getAdTier(tierLabel)?.priceUsd ?? null;
  if (productType === "kya_verify") return KYA_PRICE_USD;
  if (productType === "verification_bundle") return VERIFICATION_BUNDLE_PRICE_USD;
  if (productType === "verified_revenue") return getVerifiedRevenueTier(tierLabel)?.priceUsd ?? null;
  if (productType === "pro_subscription") return PRO_SUBSCRIPTION_PRICE_USD;
  return null;
}
export function getTierPriceOrTest(productType: ProductType, tierLabel: string): number | null {
  if (isPaymentTestMode()) {
    if (productType === "power_boost") return getPowerBoostTier(tierLabel) ? POWER_BOOST_TEST_USD : null;
    if (productType === "ad") return getAdTier(tierLabel) ? AD_TIER_TEST_USD : null;
    if (productType === "kya_verify") return KYA_TEST_USD;
    if (productType === "verification_bundle") return KYA_TEST_USD;
    if (productType === "verified_revenue") return getVerifiedRevenueTier(tierLabel) ? VERIFIED_REVENUE_TEST_USD : null;
    if (productType === "pro_subscription") return KYA_TEST_USD;
    return null;
  }
  return getTierPrice(productType, tierLabel);
}
export function usdToUsdc(usdAmount: number): string {
  return usdAmount.toFixed(2);
}
// ─── Helio MoonPay Paylink IDs ────────────────────────────────────────────────
// NEXT_PUBLIC_ variants are read by the client (checkout widget).
// Server-only variants (no prefix) are used in the webhook handler.
/** Full Verification + KYA MoonPay paylink (https://moonpay.hel.io/pay/6a214dc40f9cefb2ba3f0ad3) */
export const DEFAULT_HELIO_VERIFICATION_PAYLINK_ID = "69df1c1bed698ab275ca3dcb";
/** Accept bare paylink ID or full hel.io / moonpay.hel.io checkout URL. */
export function normalizeHelioPaylinkId(raw: string | undefined | null): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  const fromPath = t.match(/\/pay\/([a-f0-9]+)/i)?.[1];
  if (fromPath) return fromPath;
  if (/^[a-f0-9]{20,}$/i.test(t)) return t;
  return t;
}
// Generate human-readable order numbers: AR-PB-20260316-0042
