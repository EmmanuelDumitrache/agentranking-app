import { Prisma } from "@/generated/prisma/client";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  readBoundedJsonObject,
} from "@/lib/bounded-http-body";
import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { AgentLaunchError } from "@/lib/agent-launch/errors";
import { recordAgentLaunchEvent } from "@/lib/agent-launch/events";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import {
  assertLaunchReadyForFeeShare,
  loadAgentLaunchOrThrow,
} from "@/lib/agent-launch/launch-access";
import { buildAgentPassportFromLaunch } from "@/lib/agent-launch/passport";
import { serializeAgentLaunch } from "@/lib/agent-launch/serialize";
import { syncInferenceProvidersFromLaunch } from "@/lib/inference-providers/agent-bindings.server";
import { applyLaunchProfileEnrichment } from "@/lib/agent-launch/apply-launch-profile-enrichment.server";
import { resolveLaunchAgentDbId } from "@/lib/agent-launch/linked-agent";
import { assertAgentLaunchChainConfig } from "@/lib/agent-launch/solana";
import { verifyFeeShareTransaction } from "@/lib/agent-launch/tx-verify";
import { parseSolanaPubkey } from "@/lib/agent-launch/validation";
import { buildTokenLaunchFeedEvent } from "@/lib/public-site/ar-live-feed-builders.server";
import { publishArLiveFeedEvent } from "@/lib/public-site/ar-live-feed-publish.server";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  try {
    const body = await readBoundedJsonObject(request, 32 * 1024) as {
      launchId?: string;
      signature?: string;
      sharingConfig?: string;
    };
    const launchId = body.launchId?.trim();
    const signature = body.signature?.trim();
    if (!launchId || !signature) {
      return NextResponse.json(
        { error: "launchId and signature are required" },
        { status: 400 },
      );
    }
    const launch = await loadAgentLaunchOrThrow(launchId);
    assertLaunchReadyForFeeShare(launch);
    const config = getAgentLaunchConfig();
    const { treasury } = assertAgentLaunchChainConfig();
    if (!launch.mint || !launch.creatorWallet) {
      return NextResponse.json({ error: "Launch missing mint or creator wallet" }, { status: 400 });
    }
    const mint = parseSolanaPubkey(launch.mint, "Mint");
    const creatorWallet = parseSolanaPubkey(launch.creatorWallet, "Creator wallet");
    const arTreasury = parseSolanaPubkey(treasury, "Treasury");
    const creatorShareBps = launch.creatorShareBps ?? config.creatorShareBps;
    const arShareBps = launch.arShareBps ?? config.arShareBps;
    const verification = await verifyFeeShareTransaction({
      signature,
      mint,
      expectedCreator: creatorWallet,
      expectedTreasury: arTreasury,
      creatorShareBps,
      arShareBps,
      sharingConfig: body.sharingConfig?.trim(),
    });
    if (!verification.ok) {
      return NextResponse.json(
        { error: verification.reason ?? "Fee-share transaction verification failed" },
        { status: 400 },
      );
    }
    const sharingConfig = verification.sharingConfig ?? body.sharingConfig?.trim() ?? null;
    const updated = await prisma.agentLaunch.update({
      where: { id: launchId },
      data: {
        feeShareTx: signature,
        feeSharingConfig: sharingConfig,
        feeSharingStatus: "active",
        launchStatus: "indexed",
        arTreasuryWallet: treasury,
        passportJson: buildAgentPassportFromLaunch({
          ...launch,
          feeShareTx: signature,
          feeSharingConfig: sharingConfig,
          feeSharingStatus: "active",
          launchStatus: "indexed",
          arTreasuryWallet: treasury,
        }) as unknown as Prisma.InputJsonValue,
      },
    });
    await recordAgentLaunchEvent({
      launchId,
      type: "fee_share_active",
      txSignature: signature,
      payloadJson: {
        sharingConfig: verification.sharingConfig,
        creatorShareBps,
        arShareBps,
      },
    });
    await syncInferenceProvidersFromLaunch(updated);
    const agentDbId = resolveLaunchAgentDbId(updated);
    if (agentDbId) {
      const agent = await prisma.agent.findUnique({
        where: { id: agentDbId },
        select: {
          archetype: true,
          services: {
            where: { sourceKind: "dashboard" },
            select: { name: true, endpoint: true, version: true },
          },
        },
      });
      await applyLaunchProfileEnrichment(agentDbId, updated.id, {
        website: updated.profileWebsite ?? "",
        github: updated.profileGithub ?? "",
        archetype: agent?.archetype?.trim() ?? "",
        capabilityTags: updated.profileTags ?? [],
        services:
          agent?.services.map((service) => ({
            name: service.name,
            endpoint: service.endpoint,
            version: service.version ?? "",
          })) ?? [],
        twitter: updated.profileTwitter ?? undefined,
        telegram: updated.profileTelegram ?? undefined,
        tokenImageUrl: updated.tokenImageUrl ?? undefined,
        tokenName: updated.tokenName ?? undefined,
        tokenDescription: updated.tokenDescription ?? undefined,
      });
    }
    if (updated.mint) {
      publishArLiveFeedEvent(
        buildTokenLaunchFeedEvent({
          launchId: updated.id,
          mint: updated.mint,
          tokenSymbol: updated.tokenSymbol,
          tokenName: updated.tokenName,
          profileDisplayName: updated.profileDisplayName,
          createdAt: updated.createdAt,
          chain: "solana",
        }),
      );
    }
    return NextResponse.json({
      ok: true,
      launch: serializeAgentLaunch(updated),
      signature,
      sharingConfig: verification.sharingConfig,
    });
  } catch (error) {
    if (error instanceof HttpBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof InvalidJsonBodyError || error instanceof InvalidHttpBodyEncodingError) {
      return NextResponse.json({ error: error.message }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof AgentLaunchError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = Error.isError(error) ? error.message : "Failed to confirm fee share";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
