import { NextRequest, NextResponse } from "next/server";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { AgentLaunchError } from "@/lib/agent-launch/errors";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import {
  assertLaunchReadyForFeeShare,
  loadAgentLaunchOrThrow,
} from "@/lib/agent-launch/launch-access";
import { buildAgentLaunchFeeShareTransaction } from "@/lib/agent-launch/pump-fee-sharing";
import { assertAgentLaunchChainConfig } from "@/lib/agent-launch/solana";
import {
  parseSolanaPubkey,
  validateCreatorWallet,
  validateMintPubkey,
} from "@/lib/agent-launch/validation";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  try {
    const body = (await request.json()) as {
      launchId?: string;
      creatorWallet?: string;
      mint?: string;
    };
    const launchId = body.launchId?.trim();
    if (!launchId) {
      return NextResponse.json({ error: "launchId is required" }, { status: 400 });
    }
    const creatorError = validateCreatorWallet(body.creatorWallet);
    const mintError = validateMintPubkey(body.mint);
    if (creatorError || mintError) {
      return NextResponse.json(
        { error: [creatorError, mintError].filter(Boolean).join("; ") },
        { status: 400 },
      );
    }
    const launch = await loadAgentLaunchOrThrow(launchId);
    assertLaunchReadyForFeeShare(launch);
    const config = getAgentLaunchConfig();
    const { treasury } = assertAgentLaunchChainConfig();
    const creatorWallet = parseSolanaPubkey(body.creatorWallet!, "Creator wallet");
    const mint = parseSolanaPubkey(body.mint!, "Mint");
    if (launch.mint && launch.mint !== mint.toBase58()) {
      return NextResponse.json({ error: "Mint does not match launch record" }, { status: 400 });
    }
    const creatorShareBps = launch.creatorShareBps ?? config.creatorShareBps;
    const arShareBps = launch.arShareBps ?? config.arShareBps;
    const result = await buildAgentLaunchFeeShareTransaction({
      creatorWallet,
      mint,
      treasury: parseSolanaPubkey(treasury, "Treasury"),
      creatorShareBps,
      arShareBps,
    });
    if (!result.feeSharingWired || !result.transactionBase64) {
      return NextResponse.json(
        {
          error: "Pump fee-sharing transaction is not wired yet",
          code: "pump_fee_share_not_wired",
          sharingConfig: result.sharingConfig,
          shares: result.shares,
          warnings: result.warnings,
        },
        { status: 501 },
      );
    }
    return NextResponse.json({
      transaction: result.transactionBase64,
      sharingConfig: result.sharingConfig,
      shares: result.shares,
      network: result.network,
      warnings: result.warnings,
    });
  } catch (error) {
    if (error instanceof AgentLaunchError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = Error.isError(error) ? error.message : "Failed to build fee-share transaction";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
