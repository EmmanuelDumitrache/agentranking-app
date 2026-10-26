import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth";
import { computeStakePerksForWallet } from "@/lib/ar-stake-perk-engine";
import { normalizeStakeWallet } from "@/lib/ar-holder-tier-resolve";
export const dynamic = "force-dynamic";
/** GET /api/admin/ar-token/stake-perks-preview?wallet= */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const wallet = normalizeStakeWallet(req.nextUrl.searchParams.get("wallet"));
  if (!wallet) return NextResponse.json({ error: "wallet is required" }, { status: 400 });
  const result = await computeStakePerksForWallet(wallet);
  return NextResponse.json(result);
}