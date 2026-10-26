import { NextRequest, NextResponse } from "next/server";
import { AgentLaunchError } from "@/lib/agent-launch/errors";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import { loadAgentLaunchOrThrow } from "@/lib/agent-launch/launch-access";
import { confirmOrRecoverTokenCreate } from "@/lib/agent-launch/launch-create-confirm.server";
import { serializeAgentLaunch } from "@/lib/agent-launch/serialize";
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
      signature?: string;
      mint?: string;
      creatorWallet?: string;
    };
    const launchId = body.launchId?.trim();
    const signature = body.signature?.trim();
    if (!launchId || !signature) {
      return NextResponse.json(
        { error: "launchId and signature are required" },
        { status: 400 },
      );
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
    const creatorWallet = parseSolanaPubkey(body.creatorWallet!, "Creator wallet");
    const mint = parseSolanaPubkey(body.mint!, "Mint");
    if (launch.creatorWallet && launch.creatorWallet !== creatorWallet.toBase58()) {
      return NextResponse.json({ error: "Creator wallet does not match draft" }, { status: 400 });
    }
    const result = await confirmOrRecoverTokenCreate({
      launch,
      launchId,
      signature,
      mint,
      creatorWallet,
    });
    return NextResponse.json({
      ok: true,
      recovered: result.recovered,
      launch: serializeAgentLaunch(result.launch),
      signature: result.signature,
    });
  } catch (error) {
    if (error instanceof AgentLaunchError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = Error.isError(error) ? error.message : "Failed to confirm create";
    const isPumpMissing = message.includes("bonding curve not found");
    return NextResponse.json(
      {
        error: message,
        code: isPumpMissing ? "pump_create_missing" : undefined,
      },
      { status: isPumpMissing ? 400 : 500 },
    );
  }
}
