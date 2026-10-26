import { NextResponse } from "next/server";
import { computeAccountBalances } from "@/lib/llm-provider/reconciliation";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const accounts = await computeAccountBalances();
    const totalIssued = accounts.reduce(
      (sum, a) => sum + a.totalCreditsIssued,
      0,
    );
    const totalDebited = accounts.reduce(
      (sum, a) => sum + a.totalCreditsDebited,
      0,
    );
    return NextResponse.json({
      totalCreditsIssued: totalIssued,
      totalCreditsDebited: totalDebited,
      activeAccounts: accounts.filter((a) => a.ledgerEntryCount > 0).length,
      accounts,
    });
  } catch (err) {
    console.error("[admin/credits/summary] error:", err);
    return NextResponse.json(
      { error: "Failed to compute credit summary", code: "SUMMARY_FAILED" },
      { status: 500 },
    );
  }
}