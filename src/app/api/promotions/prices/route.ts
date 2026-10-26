import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getTreasuryAddresses,
  getTestPrices,
  isTestMode,
} from "@/lib/payment-verify";
export const dynamic = "force-dynamic";
const CURRENCY_KEY_MAP: Record<string, string> = {
  ETH: "eth_base",
  USDC: "usdc_base",
  SOL: "sol",
};
/**
 * GET /api/promotions/prices
 * Returns slot prices grouped by slot type → durationDays → currency.
 * Shape: { prices: { hot: { 7: { eth_base: "0.05", usdc_base: "100", sol: "0.8" } } }, treasury, testMode }
 */
export async function GET() {
  try {
    let prices: Record<string, Record<number, Record<string, string>>>;
    if (isTestMode()) {
      const raw = getTestPrices();
      // Convert from slotType → currencyKey → durationMap  →  slotType → duration → currencyKey
      prices = {};
      for (const [slotType, currencyDurMap] of Object.entries(raw)) {
        prices[slotType] = {};
        for (const [currencyKey, durMap] of Object.entries(currencyDurMap)) {
          for (const [dur, amount] of Object.entries(
            durMap as Record<number, string>
          )) {
            const d = Number(dur);
            if (!prices[slotType][d]) prices[slotType][d] = {};
            prices[slotType][d][currencyKey] = amount as string;
          }
        }
      }
    } else {
      const rows = await prisma.promotionPrice.findMany({
        orderBy: [{ slotType: "asc" }, { durationDays: "asc" }, { currency: "asc" }],
      });
      prices = {};
      for (const row of rows) {
        if (!prices[row.slotType]) prices[row.slotType] = {};
        if (!prices[row.slotType][row.durationDays])
          prices[row.slotType][row.durationDays] = {};
        const key =
          CURRENCY_KEY_MAP[row.currency] || row.currency.toLowerCase();
        prices[row.slotType][row.durationDays][key] = row.amount;
      }
    }
    const treasury = getTreasuryAddresses();
    return NextResponse.json({
      prices,
      treasury,
      testMode: isTestMode(),
    });
  } catch (err) {
    console.error("GET /api/promotions/prices error:", err);
    return NextResponse.json(
      { error: "Failed to fetch prices" },
      { status: 500 }
    );
  }
}