import { NextRequest, NextResponse } from "next/server";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { AgentLaunchError } from "@/lib/agent-launch/errors";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import {
  assertLaunchDraftReadyForCreate,
  loadAgentLaunchOrThrow,
} from "@/lib/agent-launch/launch-access";
import { buildAgentLaunchCreateTransaction } from "@/lib/agent-launch/pump-create";
import { pumpBondingCurveExists } from "@/lib/agent-launch/pump-onchain";
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
    assertLaunchDraftReadyForCreate(launch);
    const config = getAgentLaunchConfig();
    const { treasury } = assertAgentLaunchChainConfig();
    const creatorWallet = parseSolanaPubkey(body.creatorWallet!, "Creator wallet");
    const mint = parseSolanaPubkey(body.mint!, "Mint");
    const rawUri =
      launch.metadataUri ?? launch.passportUri ?? `mock://metadata/${launchId}`;
    // Log launch payload for audit (no private keys)
    console.log(
      JSON.stringify({
        phase: "launch_payload",
        launchId,
        mint: mint.toBase58(),
        network: launch.network,
        agentDbId: launch.agentDbId,
        agentId: launch.agentId,
        tokenName: launch.tokenName,
        tokenSymbol: launch.tokenSymbol,
        userDescription: launch.tokenDescription,
        metadataUri: rawUri,
        metadataJson: launch.metadataJson
          ? {
              name: (launch.metadataJson as Record<string, unknown>)?.name,
              symbol: (launch.metadataJson as Record<string, unknown>)?.symbol,
              description: String((launch.metadataJson as Record<string, unknown>)?.description ?? "").slice(0, 100),
              external_url: (launch.metadataJson as Record<string, unknown>)?.external_url,
            }
          : null,
        tokenImageUrl: launch.tokenImageUrl,
        creatorWallet: creatorWallet.toBase58(),
        treasury,
        creatorShareBps: launch.creatorShareBps,
        arShareBps: launch.arShareBps,
        profileTwitter: launch.profileTwitter,
        profileTelegram: launch.profileTelegram,
      }),
    );
    if (launch.creatorWallet && launch.creatorWallet !== creatorWallet.toBase58()) {
      return NextResponse.json({ error: "Creator wallet does not match draft" }, { status: 400 });
    }
    // Hard guard: mainnet tokens must use a real (non-mock) metadata URI
    if (launch.network === "mainnet-beta" && rawUri.startsWith("mock://")) {
      return NextResponse.json(
        {
          error:
            "Mainnet tokens require a real metadata provider. Set AGENT_LAUNCH_METADATA_PROVIDER=ipfs, verify the configured remote Kubo endpoint, and re-publish metadata before launching.",
          code: "mainnet_requires_real_metadata",
        },
        { status: 400 },
      );
    }
    // Mainnet: metadata URI must start with ipfs:// or https://
    if (
      launch.network === "mainnet-beta" &&
      !rawUri.startsWith("ipfs://") &&
      !rawUri.startsWith("https://")
    ) {
      return NextResponse.json(
        {
          error: `Mainnet metadata URI must start with ipfs:// or https:// (got: ${rawUri.slice(0, 50)}...). Re-publish metadata with a real provider.`,
          code: "mainnet_metadata_uri_invalid",
        },
        { status: 400 },
      );
    }
    if (await pumpBondingCurveExists(mint)) {
      return NextResponse.json(
        {
          error:
            "This token mint already exists on Pump.fun. Do not submit another create transaction — recover the launch instead.",
          code: "mint_already_on_chain",
          mint: mint.toBase58(),
        },
        { status: 409 },
      );
    }
    const result = await buildAgentLaunchCreateTransaction({
      creatorWallet,
      mint,
      treasury: parseSolanaPubkey(treasury, "Treasury"),
      name: launch.tokenName!.trim(),
      symbol: launch.tokenSymbol!.trim(),
      uri: rawUri,
      creationFeeLamports: config.creationFeeLamports,
      initialBuyLamports: config.initialBuyLamports,
    });
    return NextResponse.json({
      transaction: result.transactionBase64,
      mint: result.mint,
      network: result.network,
      pumpCreateIncluded: result.pumpCreateIncluded,
      initialBuyIncluded: result.initialBuyIncluded,
      warnings: result.warnings,
      requiresSigners: result.requiresSigners,
    });
  } catch (error) {
    if (error instanceof AgentLaunchError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = Error.isError(error) ? error.message : "Failed to build create transaction";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
