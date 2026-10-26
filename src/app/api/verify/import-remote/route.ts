import { NextRequest, NextResponse } from "next/server";
import { importRemoteVerifyAgent } from "@/lib/dashboard/verify-lookup-server";
import { siteDevFeaturesEnabled } from "@/lib/site-dev-features";
import type { VerifyClaimChain } from "@/lib/dashboard/verify-lookup";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  if (!siteDevFeaturesEnabled()) {
    return NextResponse.json({ error: "Not available in production." }, { status: 403 });
  }
  try {
    const body = (await request.json()) as {
      chainId?: number;
      agentId?: number;
      wallet?: string;
      claimChains?: VerifyClaimChain[];
    };
    const chainId = Number(body.chainId);
    const agentId = Number(body.agentId);
    if (!Number.isFinite(chainId) || !Number.isFinite(agentId)) {
      return NextResponse.json({ error: "chainId and agentId are required." }, { status: 400 });
    }
    const agent = await importRemoteVerifyAgent(
      chainId,
      agentId,
      body.wallet,
      body.claimChains,
    );
    return NextResponse.json({ agent });
  } catch (err) {
    const msg = Error.isError(err) ? err.message : "Import failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
