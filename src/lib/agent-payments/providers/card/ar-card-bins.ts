export type ArCardBinOption = {
  bin: string;
  network: "visa" | "mastercard";
  region: string;
  regionCode: string;
  label: string;
  tags: string[];
  requiresDateOfBirth: boolean;
  description: string;
  annualLimitUsd: number;
  security: string;
  validityYears: number;
  platforms: string[];
};

export type ArCardPlatform = {
  id: string;
  name: string;
  shortLabel: string;
  color: string;
};

/** Merchant / wallet platforms commonly supported per BIN program. */
export const AR_CARD_PLATFORMS: Record<string, ArCardPlatform> = {
  facebook: { id: "facebook", name: "Facebook", shortLabel: "f", color: "#1877F2" },
  tiktok: { id: "tiktok", name: "TikTok", shortLabel: "♪", color: "#010101" },
  google: { id: "google", name: "Google", shortLabel: "G", color: "#4285F4" },
  amazon: { id: "amazon", name: "Amazon", shortLabel: "a", color: "#FF9900" },
  openai: { id: "openai", name: "OpenAI", shortLabel: "◎", color: "#10A37F" },
  x: { id: "x", name: "X", shortLabel: "𝕏", color: "#000000" },
  shopify: { id: "shopify", name: "Shopify", shortLabel: "S", color: "#96BF48" },
  starlink: { id: "starlink", name: "Starlink", shortLabel: "✦", color: "#FFFFFF" },
  aliexpress: { id: "aliexpress", name: "AliExpress", shortLabel: "AE", color: "#E62E04" },
  applepay: { id: "applepay", name: "Apple Pay", shortLabel: "", color: "#FFFFFF" },
  samsungpay: { id: "samsungpay", name: "Samsung Pay", shortLabel: "Pay", color: "#1428A0" },
  googlepay: { id: "googlepay", name: "Google Pay", shortLabel: "G", color: "#4285F4" },
  ads: { id: "ads", name: "Ad networks", shortLabel: "Ad", color: "#D4E157" },
  saas: { id: "saas", name: "SaaS", shortLabel: "SaaS", color: "#7C9CFF" },
  logistics: { id: "logistics", name: "Logistics", shortLabel: "📦", color: "#C9A84C" },
  apac: { id: "apac", name: "APAC merchants", shortLabel: "APAC", color: "#2DD4BF" },
};

/** User-selectable Kripicard BIN products (location / bank). */
export const AR_CARD_BIN_CATALOG: ArCardBinOption[] = [
  {
    bin: "441357",
    network: "visa",
    region: "United States",
    regionCode: "US",
    label: "Visa — United States",
    tags: ["ApplePay", "SamsungPay", "GooglePay"],
    requiresDateOfBirth: false,
    description: "Worldwide acceptance with wallet pay support.",
    annualLimitUsd: 150_000,
    security: "3DS · independent PIN",
    validityYears: 3,
    platforms: [
      "facebook",
      "tiktok",
      "google",
      "amazon",
      "openai",
      "x",
      "shopify",
      "starlink",
      "aliexpress",
      "applepay",
      "samsungpay",
      "googlepay",
    ],
  },
  {
    bin: "537872",
    network: "mastercard",
    region: "United States",
    regionCode: "US",
    label: "Mastercard — United States",
    tags: ["3DS"],
    requiresDateOfBirth: true,
    description: "US Mastercard with 3DS. Date of birth required.",
    annualLimitUsd: 100_000,
    security: "3DS · OTP verification",
    validityYears: 3,
    platforms: ["facebook", "amazon", "google", "shopify", "openai", "x", "starlink"],
  },
  {
    bin: "533171",
    network: "mastercard",
    region: "Singapore",
    regionCode: "SG",
    label: "Mastercard — Singapore",
    tags: ["APAC"],
    requiresDateOfBirth: true,
    description: "APAC Mastercard for regional merchants. Date of birth required.",
    annualLimitUsd: 100_000,
    security: "3DS · regional OTP",
    validityYears: 3,
    platforms: ["facebook", "tiktok", "google", "amazon", "shopify", "aliexpress", "apac"],
  },
  {
    bin: "49387519",
    network: "visa",
    region: "Hong Kong",
    regionCode: "HK",
    label: "Visa — Hong Kong PREMIUM",
    tags: ["PREMIUM"],
    requiresDateOfBirth: false,
    description: "Optimized for advertising, SaaS, and logistics.",
    annualLimitUsd: 100_000,
    security: "3DS · elevated trust BIN",
    validityYears: 3,
    platforms: ["facebook", "google", "openai", "shopify", "ads", "saas", "logistics", "x"],
  },
  {
    bin: "49387520",
    network: "visa",
    region: "Hong Kong",
    regionCode: "HK",
    label: "Visa — Hong Kong B2B",
    tags: ["B2B READY"],
    requiresDateOfBirth: false,
    description: "B2B-ready Hong Kong Visa for vendor payments.",
    annualLimitUsd: 100_000,
    security: "3DS · vendor verification",
    validityYears: 3,
    platforms: ["amazon", "shopify", "google", "saas", "logistics", "aliexpress"],
  },
  {
    bin: "539502",
    network: "mastercard",
    region: "Global",
    regionCode: "XX",
    label: "Mastercard — Global",
    tags: ["DEFAULT"],
    requiresDateOfBirth: false,
    description: "Default prepaid Mastercard BIN.",
    annualLimitUsd: 50_000,
    security: "3DS · standard controls",
    validityYears: 3,
    platforms: ["facebook", "google", "amazon", "shopify", "aliexpress"],
  },
  {
    bin: "525847",
    network: "mastercard",
    region: "Global",
    regionCode: "XX",
    label: "Mastercard — Standard",
    tags: ["STANDARD"],
    requiresDateOfBirth: false,
    description: "Standard prepaid Mastercard.",
    annualLimitUsd: 75_000,
    security: "3DS · standard controls",
    validityYears: 3,
    platforms: ["facebook", "google", "amazon", "tiktok", "shopify"],
  },
];

export function getArCardBinOption(bin: string): ArCardBinOption | undefined {
  return AR_CARD_BIN_CATALOG.find((row) => row.bin === bin);
}

export function isKnownArCardBin(bin: string): boolean {
  return AR_CARD_BIN_CATALOG.some((row) => row.bin === bin);
}

/** Kripicard fee estimate for issue (matches their create UI). */
export function estimateArCardIssueFees(amountUsd: number) {
  const cardAmount = Math.max(0, amountUsd);
  const issuanceFee = 5;
  const fundingFee = Math.round(cardAmount * 0.04 * 100) / 100;
  const processingFee = 1;
  const total = Math.round((cardAmount + issuanceFee + fundingFee + processingFee) * 100) / 100;
  return {
    cardAmount,
    issuanceFee,
    fundingFee,
    fundingFeePercent: 4,
    processingFee,
    total,
  };
}

/** Kripicard top-up fee: $1 fixed + 4%. */
export function estimateArCardFundFees(amountUsd: number) {
  const amount = Math.max(0, amountUsd);
  const fixedFee = 1;
  const serviceFee = Math.round(amount * 0.04 * 100) / 100;
  const total = Math.round((amount + fixedFee + serviceFee) * 100) / 100;
  return { amount, fixedFee, serviceFee, serviceFeePercent: 4, total };
}
