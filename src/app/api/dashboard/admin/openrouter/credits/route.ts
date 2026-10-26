import { NextResponse } from "next/server";
import {
  fetchOpenRouterCredits,
  getCreditsStatus,
} from "@/lib/llm-provider/openrouter-credits";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const credits = await fetchOpenRouterCredits();
    if (!credits) {
      return NextResponse.json({
        provider: "openrouter",
        availableUsdCents: null,
        warningLevel: "unknown" as const,
      });
    }
    const availableUsdCents = credits.remaining === null
      ? null
      : Math.round(credits.remaining * 100);
    return NextResponse.json({
      provider: "openrouter",
      availableUsdCents,
      warningLevel: getCreditsStatus(credits),
    });
  } catch (err) {
    console.error("[admin/openrouter/credits] unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error", code: "BALANCE_ERROR" },
      { status: 500 },
    );
  }
}