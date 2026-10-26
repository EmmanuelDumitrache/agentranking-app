import "server-only";
import { prisma } from "@/lib/db";
import { getTestPrices, getTreasuryAddresses, isTestMode } from "@/lib/payment-verify";
import type {
  CustomListPaymentToken,
  CustomListPricingDto,
} from "@/app/(public-site)/custom-list/custom-list-types";
const DURATION_DAYS = 7 as const;
const TOKENS = ["ETH", "USDC", "SOL"] as const satisfies readonly CustomListPaymentToken[];
const TEST_PRICE_KEYS: Record<CustomListPaymentToken, string> = {
  ETH: "eth_base",
  USDC: "usdc_base",
  SOL: "sol",
};

export function unavailableCustomListPricing(): CustomListPricingDto {
  return {
    durationDays: DURATION_DAYS,
    prices: { ETH: null, USDC: null, SOL: null },
    treasury: { evm: null, sol: null },
    testMode: isTestMode(),
  };
}
export async function readCustomListPricing(): Promise<CustomListPricingDto> {
  const testMode = isTestMode();
  const prices: Record<CustomListPaymentToken, string | null> = {
    ETH: null,
    USDC: null,
    SOL: null,
  };
  if (testMode) {
    const raw = getTestPrices().custom_listing ?? {};
    for (const token of TOKENS) {
      prices[token] = raw[TEST_PRICE_KEYS[token]]?.[DURATION_DAYS] ?? null;
    }
  } else {
    const rows = await prisma.promotionPrice.findMany({
      where: {
        slotType: "custom_listing",
        durationDays: DURATION_DAYS,
        currency: { in: [...TOKENS] },
      },
      select: { currency: true, amount: true },
    });
    for (const row of rows) {
      if ((TOKENS as readonly string[]).includes(row.currency)) {
        prices[row.currency as CustomListPaymentToken] = row.amount;
      }
    }
  }
  return {
    durationDays: DURATION_DAYS,
    prices,
    treasury: getTreasuryAddresses(),
    testMode,
  };
}
