import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  readBoundedJsonObject,
} from "@/lib/bounded-http-body";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import { buildAgentPassportPreview } from "@/lib/agent-launch/passport";
import { mergeDemoPassportOverrides } from "@/lib/agent-launch/demo-templates";
import { publishLaunchMetadata, getMetadataProviderConfig } from "@/lib/agent-launch/metadata-provider";
import { recordAgentLaunchEvent } from "@/lib/agent-launch/events";
import { serializeAgentLaunch } from "@/lib/agent-launch/serialize";
import { resolveLaunchAgentDbId } from "@/lib/agent-launch/linked-agent";
import { assertKuboContentAvailable } from "@/lib/ipfs/kubo";
import { validateMintPubkey } from "@/lib/agent-launch/validation";
import {
  assertAgentLaunchDraftAccess,
  loadLaunchAccessContext,
} from "@/lib/launch-wallet-session/auth";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  let body: {
    launchId?: string;
    passportOverrides?: Record<string, unknown>;
    imagePlaceholder?: string | null;
    mint?: string | null;
    twitter?: string | null;
    telegram?: string | null;
  };
  try {
    body = await readBoundedJsonObject(request, 256 * 1024) as typeof body;
  } catch (error) {
    const status = error instanceof HttpBodyTooLargeError ? 413 : 400;
    const message = error instanceof InvalidJsonBodyError
      || error instanceof InvalidHttpBodyEncodingError
      || error instanceof HttpBodyTooLargeError
      ? error.message
      : "Invalid request body";
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
  const launchId = body.launchId?.trim();
  if (!launchId) {
    return NextResponse.json({ error: "launchId is required" }, { status: 400 });
  }
  const existing = await prisma.agentLaunch.findUnique({ where: { id: launchId } });
  if (!existing) {
    return NextResponse.json({ error: "Launch not found" }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  const accessContext = await loadLaunchAccessContext(session);
  const access = await assertAgentLaunchDraftAccess(existing, accessContext);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  if (existing.launchStatus !== "draft") {
    return NextResponse.json(
      { error: "Metadata can only be published while the launch is in draft status" },
      { status: 409 },
    );
  }
  const proposedMint = body.mint?.trim() || existing.mint?.trim() || null;
  if (!proposedMint) {
    return NextResponse.json({ error: "Mint is required before metadata publication" }, { status: 400 });
  }
  const mintError = validateMintPubkey(proposedMint);
  if (mintError) {
    return NextResponse.json({ error: mintError }, { status: 400 });
  }
  if (existing.mint && proposedMint !== existing.mint) {
    return NextResponse.json(
      { error: "Proposed mint does not match the launch mint" },
      { status: 409 },
    );
  }
  let agentName: string | undefined;
  const agentDbId = resolveLaunchAgentDbId(existing);
  if (agentDbId) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentDbId },
      select: { name: true },
    });
    agentName = agent?.name;
  }
  const passportJson = buildAgentPassportPreview({
    launch: { ...existing, mint: proposedMint },
    agentName,
    passportOverrides: mergeDemoPassportOverrides(existing, body.passportOverrides),
  });
  const providerConfig = getMetadataProviderConfig();
  try {
    const published = await publishLaunchMetadata({
      launch: existing,
      passportJson,
      imagePlaceholder: body.imagePlaceholder,
      creatorShareBps: existing.creatorShareBps,
      arShareBps: existing.arShareBps,
      proposedMint,
      twitter: body.twitter?.trim() || null,
      telegram: body.telegram?.trim() || null,
    });
    // Prove the controlled Kubo node can resolve both newly pinned objects before saving.
    // Server-side validation stays on the private RPC plane rather than looping through
    // the public gateway and external DNS/TLS path.
    let metadataAvailable = published.provider === "mock";
    if (published.provider === "ipfs") {
      await Promise.all([
        assertKuboContentAvailable(published.metadataUri, { timeoutMs: 15_000 }),
        assertKuboContentAvailable(published.passportUri, { timeoutMs: 15_000 }),
      ]);
      metadataAvailable = true;
    }
    const launch = await prisma.agentLaunch.update({
      where: { id: launchId },
      data: {
        metadataUri: published.metadataUri,
        passportUri: published.passportUri,
        passportJson: published.passportJson as unknown as Prisma.InputJsonValue,
        metadataJson: published.tokenMetadataJson as unknown as Prisma.InputJsonValue,
      },
    });
    await recordAgentLaunchEvent({
      launchId: launch.id,
      type: "metadata_generated",
      payloadJson: {
        metadataUri: published.metadataUri,
        passportUri: published.passportUri,
        provider: published.provider,
        mock: published.provider === "mock",
        gatewayMetadataUrl: published.gatewayMetadataUrl ?? null,
        gatewayPassportUrl: published.gatewayPassportUrl ?? null,
        metadataAvailable,
      },
    });
    return NextResponse.json({
      metadataUri: published.metadataUri,
      passportUri: published.passportUri,
      passportJson: published.passportJson,
      tokenMetadataJson: published.tokenMetadataJson,
      provider: published.provider,
      gatewayMetadataUrl: published.gatewayMetadataUrl ?? null,
      gatewayPassportUrl: published.gatewayPassportUrl ?? null,
      launch: serializeAgentLaunch(launch),
    });
  } catch (error) {
    const message = Error.isError(error) ? error.message : "Failed to generate metadata";
    const isIpfsConfig =
      providerConfig.provider === "ipfs" &&
      (message.includes("IPFS") || message.includes("Kubo") || message.includes("AGENT_LAUNCH_IPFS"));
    return NextResponse.json(
      {
        error: message,
        code: isIpfsConfig ? "metadata_provider_not_configured" : "metadata_generation_failed",
        provider: providerConfig.provider,
      },
      { status: isIpfsConfig ? 501 : 500 },
    );
  }
}
