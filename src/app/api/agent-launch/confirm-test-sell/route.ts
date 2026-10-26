import { NextRequest, NextResponse } from "next/server";
import { AgentLaunchError } from "@/lib/agent-launch/errors";
import { recordAgentLaunchEvent } from "@/lib/agent-launch/events";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import {
  assertLaunchIndexedForInvestorTest,
  loadAgentLaunchOrThrow,
} from "@/lib/agent-launch/launch-access";
import { verifyInvestorTestTransaction } from "@/lib/agent-launch/tx-verify";
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
      signature?: string;
      sellerWallet?: string;
    };
    const launchId = body.launchId?.trim();
    const signature = body.signature?.trim();
    if (!launchId || !signature) {
      return NextResponse.json(
        { error: "launchId and signature are required" },
        { status: 400 },
      );
    }
    const walletError = validateSolanaPubkey(body.sellerWallet, "Seller wallet");
    if (walletError) {
      return NextResponse.json({ error: walletError }, { status: 400 });
    }
    const launch = await loadAgentLaunchOrThrow(launchId);
    assertLaunchIndexedForInvestorTest(launch);
    const mint = parseSolanaPubkey(launch.mint!, "Mint");
    const verification = await verifyInvestorTestTransaction(signature, mint);
    if (!verification.ok) {
      return NextResponse.json(
        { error: verification.reason ?? "Sell transaction verification failed" },
        { status: 400 },
      );
    }
    await recordAgentLaunchEvent({
      launchId,
      type: "test_sell_confirmed",
      txSignature: signature,
      payloadJson: {
        sellerWallet: body.sellerWallet?.trim(),
        mint: launch.mint,
      },
    });
    return NextResponse.json({ ok: true, signature, launchId });
  } catch (error) {
    if (error instanceof AgentLaunchError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = Error.isError(error) ? error.message : "Failed to confirm test sell";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
