import { NextResponse } from "next/server";
import { computeProviderUsage } from "@/lib/llm-provider/reconciliation";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(
    Number.parseInt(searchParams.get("days") || "7", 10) || 7,
    365,
  );
  try {
    const usage = await computeProviderUsage({ days });
    return NextResponse.json(usage);
  } catch (err) {
    console.error("[admin/provider-usage] error:", err);
    return NextResponse.json(
      { error: "Failed to compute provider usage", code: "USAGE_FAILED" },
      { status: 500 },
    );
  }
}