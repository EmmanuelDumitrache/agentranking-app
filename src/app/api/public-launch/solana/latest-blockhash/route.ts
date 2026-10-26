import { NextRequest, NextResponse } from "next/server";
import {
  getAgentLaunchLatestBlockhash,
  getAgentLaunchNetwork,
} from "@/lib/agent-launch/solana";
import { parseAgentLaunchNetwork } from "@/lib/agent-launch/network";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;
/**
 * Same-origin latest-blockhash read via server-side RPCs. The result is not
 * cached because blockhashes expire and callers use it to construct a payment.
 */
export async function GET(request: NextRequest) {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) return limited;
  let network: ReturnType<typeof getAgentLaunchNetwork>;
  try {
    const rawNetwork = request.nextUrl.searchParams.get("network")?.trim();
    network = rawNetwork ? parseAgentLaunchNetwork(rawNetwork) : getAgentLaunchNetwork();
  } catch {
    return NextResponse.json(
      { error: "Invalid Solana network" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const latest = await getAgentLaunchLatestBlockhash(network);
    return NextResponse.json(
      {
        ok: true,
        network,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch latest blockhash";
    return NextResponse.json(
      { error: message },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
