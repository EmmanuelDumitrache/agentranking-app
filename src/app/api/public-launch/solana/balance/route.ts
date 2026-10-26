import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getAgentLaunchSolBalanceLamports } from "@/lib/agent-launch/solana";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;
/**
 * Same-origin SOL balance read via server-side RPCs. The endpoint is rate-limited
 * through the VPS Valkey instance and never exposes provider credentials.
 */
export async function GET(request: NextRequest) {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) return limited;
  const address = request.nextUrl.searchParams.get("address")?.trim() ?? "";
  if (!address) {
    return NextResponse.json(
      { error: "address is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  let publicKey: PublicKey;
  try {
    publicKey = new PublicKey(address);
  } catch {
    return NextResponse.json(
      { error: "Invalid Solana address" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const lamports = await getAgentLaunchSolBalanceLamports(publicKey);
    return NextResponse.json(
      {
        ok: true,
        address: publicKey.toBase58(),
        lamports,
        lamportsStr: String(lamports),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read SOL balance";
    return NextResponse.json(
      { error: message },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
