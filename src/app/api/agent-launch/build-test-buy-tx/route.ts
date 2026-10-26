import { NextRequest, NextResponse } from "next/server";
import { AgentLaunchError } from "@/lib/agent-launch/errors";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import {
  assertLaunchIndexedForInvestorTest,
  loadAgentLaunchOrThrow,
} from "@/lib/agent-launch/launch-access";
import { buildTestBuyTransaction } from "@/lib/agent-launch/pump-buy-sell";
import {
  parseSolanaPubkey,
  validateSolanaPubkey,
} from "@/lib/agent-launch/validation";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  try {
    const body = (await request.json()) as {
      launchId?: string;
      buyerWallet?: string;
      quoteLamports?: string;
      slippageBps?: number;
    };
    const launchId = body.launchId?.trim();
    if (!launchId) {
      return NextResponse.json({ error: "launchId is required" }, { status: 400 });
    }
    const walletError = validateSolanaPubkey(body.buyerWallet, "Buyer wallet");
    if (walletError) {
      return NextResponse.json({ error: walletError }, { status: 400 });
    }
    const quoteLamports = BigInt(body.quoteLamports?.trim() || "0");
    if (quoteLamports <= BigInt(0)) {
      return NextResponse.json({ error: "quoteLamports must be positive" }, { status: 400 });
    }
    const launch = await loadAgentLaunchOrThrow(launchId);
    assertLaunchIndexedForInvestorTest(launch);
    const buyerWallet = parseSolanaPubkey(body.buyerWallet!, "Buyer wallet");
    const mint = parseSolanaPubkey(launch.mint!, "Mint");
    const result = await buildTestBuyTransaction({
      mint,
      buyerWallet,
      quoteLamports,
      slippageBps: body.slippageBps ?? 1000,
    });
    if (!result.buyWired || !result.transactionBase64) {
      return NextResponse.json(
        {
          error: "Pump buy_v2 transaction is not wired yet",
          code: "pump_buy_not_wired",
          warnings: result.warnings,
        },
        { status: 501 },
      );
    }
    return NextResponse.json({
      transaction: result.transactionBase64,
      mint: result.mint,
      buyerWallet: result.buyerWallet,
      network: result.network,
      warnings: result.warnings,
    });
  } catch (error) {
    if (error instanceof AgentLaunchError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = Error.isError(error) ? error.message : "Failed to build test buy transaction";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
