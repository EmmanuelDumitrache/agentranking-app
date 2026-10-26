import { NextRequest, NextResponse } from "next/server";
import { buildTrustOraclePayload, InvalidWalletError } from "@/lib/trust-oracle";
/**
 * Trust Oracle — public wallet reputation endpoint.
 *
 *   GET /api/v1/reputation/:wallet
 *
 * Consumers:
 *   - Any AI agent or AgentKit example doing a pre-x402 trust check
 *
 * Contract (stable): unregistered wallets return **200** with
 * `isRegistered: false` and `recommendation: 'caution'`. Invalid formats
 * return 400. This is intentional — LLM callers need a consistent signal,
 * not a 404 to branch on.
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
// Short edge cache — trust data changes slowly (minutes), and agents will
// often re-query the same wallet in a session. SWR keeps it warm without
// extending staleness too far for a security-adjacent lookup.
const CACHE_HEADER = "public, s-maxage=30, stale-while-revalidate=120";
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ wallet: string }> }
) {
  const { wallet } = await params;
  const raw = typeof wallet === "string" ? decodeURIComponent(wallet) : "";
  try {
    const payload = await buildTrustOraclePayload(raw);
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
          wallet: raw,
        },
        { status: 400, headers: CORS_HEADERS }
      );
    }
    console.error("[trust-oracle] unexpected error:", err);
    return NextResponse.json(
      {
        error: "internal_error",
        message: Error.isError(err) ? err.message : String(err),
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}