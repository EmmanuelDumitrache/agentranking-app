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
import { buildTestSellTransaction } from "@/lib/agent-launch/pump-buy-sell";
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
      sellerWallet?: string;
      baseAmount?: string;
      slippageBps?: number;
    };
    const launchId = body.launchId?.trim();
    if (!launchId) {
      return NextResponse.json({ error: "launchId is required" }, { status: 400 });
    }
    const walletError = validateSolanaPubkey(body.sellerWallet, "Seller wallet");
    if (walletError) {
      return NextResponse.json({ error: walletError }, { status: 400 });
    }
    const baseAmount = BigInt(body.baseAmount?.trim() || "0");
    if (baseAmount <= BigInt(0)) {
      return NextResponse.json({ error: "baseAmount must be positive" }, { status: 400 });
    }
    const launch = await loadAgentLaunchOrThrow(launchId);
    assertLaunchIndexedForInvestorTest(launch);
    const sellerWallet = parseSolanaPubkey(body.sellerWallet!, "Seller wallet");
    const mint = parseSolanaPubkey(launch.mint!, "Mint");
    const result = await buildTestSellTransaction({
      mint,
      sellerWallet,
      baseAmount,
      slippageBps: body.slippageBps ?? 1000,
    });
    if (!result.sellWired || !result.transactionBase64) {
      return NextResponse.json(
        {
          error: "Pump sell_v2 transaction is not wired yet",
          code: "pump_sell_not_wired",
          warnings: result.warnings,
        },
        { status: 501 },
      );
    }
    return NextResponse.json({
      transaction: result.transactionBase64,
      mint: result.mint,
      sellerWallet: result.sellerWallet,
      network: result.network,
      warnings: result.warnings,
    });
  } catch (error) {
    if (error instanceof AgentLaunchError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = Error.isError(error) ? error.message : "Failed to build test sell transaction";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
