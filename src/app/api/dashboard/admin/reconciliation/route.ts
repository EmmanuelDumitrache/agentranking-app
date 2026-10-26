import { NextResponse } from "next/server";
import { buildReconciliationReport } from "@/lib/llm-provider/reconciliation";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const report = await buildReconciliationReport();
    return NextResponse.json(report);
  } catch (err) {
    console.error("[admin/reconciliation] error:", err);
    return NextResponse.json(
      { error: "Failed to build reconciliation report", code: "REPORT_FAILED" },
      { status: 500 },
    );
  }
}