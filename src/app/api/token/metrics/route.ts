import { NextResponse } from "next/server";
import { buildArTokenMetrics } from "@/lib/ar-token-metrics";
import { readArTokenMetricsPayload } from "@/lib/ar-token-admin-data";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(await readArTokenMetricsPayload());
  } catch (err) {
    console.error("[token/metrics] GET error:", err);
    return NextResponse.json(buildArTokenMetrics(null, []));
  }
}