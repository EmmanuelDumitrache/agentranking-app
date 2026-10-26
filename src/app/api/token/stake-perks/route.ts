import { NextRequest, NextResponse } from "next/server";
import { computeStakePerksForWallet } from "@/lib/ar-stake-perk-engine";
import { normalizeStakeWallet } from "@/lib/ar-holder-tier-resolve";
export const dynamic = "force-dynamic";
/**
 * GET /api/token/stake-perks?wallet=<solana_pubkey>
 * Returns perk slugs unlocked via staking rules + overrides (merged server-side).
 */
export async function GET(req: NextRequest) {
  const wallet = normalizeStakeWallet(req.nextUrl.searchParams.get("wallet"));
  if (!wallet) {
    return NextResponse.json({ error: "wallet query parameter is required" }, { status: 400 });
  }
  try {
    const result = await computeStakePerksForWallet(wallet);
    return NextResponse.json({
      unlockedSlugs: result.unlockedPerks,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[stake-perks]", err);
    return NextResponse.json({ error: "Failed to compute stake perks" }, { status: 500 });
  }
}