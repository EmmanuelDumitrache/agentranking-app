import { NextRequest, NextResponse } from "next/server";
import {
  checkAgentReputationFromSearchParams,
  InvalidCheckInputError,
  InvalidWalletError,
} from "@/lib/reputation/check-agent-reputation";
/**
 * Unified agent reputation check — public read-only.
 *
 *   GET /api/v1/reputation/check?wallet=0x...
 *   GET /api/v1/reputation/check?chainId=990002&agentId=1
 *   GET /api/v1/reputation/check?hatcherId=<explore-id>
 *
 * Unregistered / unknown identities return **200** with `isRegistered: false`.
 * Invalid query shapes return **400**.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "X-API-Version, X-Trust-Recommendation",
  "X-API-Version": "1",
} as const;
const CACHE_HEADER = "public, s-maxage=30, stale-while-revalidate=120";
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
export async function GET(request: NextRequest) {
  try {
    const payload = await checkAgentReputationFromSearchParams(request.nextUrl.searchParams);
    return NextResponse.json(payload, {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": CACHE_HEADER,
        "X-Trust-Recommendation": payload.recommendation,
      },
    });
  } catch (err) {
    if (err instanceof InvalidWalletError) {
      return NextResponse.json(
        {
          error: "invalid_wallet",
          message:
            "Wallet must be a valid EVM (0x + 40 hex) or Solana (base58, 32-44 chars) address.",
        },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (err instanceof InvalidCheckInputError) {
      return NextResponse.json(
        {
          error: err.code,
          message: err.message,
        },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    console.error("[reputation/check] unexpected error:", err);
    return NextResponse.json(
      {
        error: "internal_error",
        message: Error.isError(err) ? err.message : String(err),
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
