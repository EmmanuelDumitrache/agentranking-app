import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { autoRecoverStuckAgentLaunch } from "@/lib/agent-launch/auto-recover-launch.server";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import { recordAgentLaunchEvent } from "@/lib/agent-launch/events";
import { agentLaunchLinkageForUpdate } from "@/lib/agent-launch/agent-db-id";
import { serializeAgentLaunch } from "@/lib/agent-launch/serialize";
import { assertLaunchOwnsAgentDbId } from "@/lib/agent-launch/selected-agent";
import { validateDraftPatch } from "@/lib/agent-launch/validation";
import {
  applyLaunchProfileEnrichment,
  sanitizeLaunchProfileEnrichmentInput,
} from "@/lib/agent-launch/apply-launch-profile-enrichment.server";
import {
  assertAgentLaunchDraftAccess,
  loadLaunchAccessContext,
} from "@/lib/launch-wallet-session/auth";
import { assertImmutableCreatorWallet } from "@/lib/launch-wallet-session/wallet-match";
export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  const { id } = await params;
  let launch = await prisma.agentLaunch.findUnique({ where: { id } });
  if (!launch) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  const accessContext = await loadLaunchAccessContext(session);
  const access = await assertAgentLaunchDraftAccess(launch, accessContext);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const creatorWallet =
    request.nextUrl.searchParams.get("creatorWallet")?.trim() ||
    launch.creatorWallet?.trim() ||
    null;
  const recovery = await autoRecoverStuckAgentLaunch(launch, creatorWallet);
  launch = recovery.launch;
  return NextResponse.json({
    launch: serializeAgentLaunch(launch),
    recovered: recovery.recovered,
    recoveredMint: recovery.mint ?? null,
    recoveredSignature: recovery.signature ?? null,
  });
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  const { id } = await params;
  const existing = await prisma.agentLaunch.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  const body = (await request.json()) as {
    agentId?: string;
    tokenName?: string;
    tokenSymbol?: string;
    tokenDescription?: string;
    tokenImageUrl?: string;
    creatorWallet?: string;
    passportJson?: unknown;
    profileWebsite?: string;
    profileTwitter?: string;
    profileTelegram?: string;
    profileGithub?: string;
    profileTags?: string[];
    archetype?: string;
    profileServices?: Array<{ name?: string; endpoint?: string; version?: string }>;
  };
  const patchErrors = validateDraftPatch(body);
  if (patchErrors.length > 0) {
    return NextResponse.json({ error: patchErrors.join("; ") }, { status: 400 });
  }
  const session = await getServerSession(authOptions);
  const accessContext = await loadLaunchAccessContext(session);
  const access = await assertAgentLaunchDraftAccess(existing, accessContext);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const immutableWallet = assertImmutableCreatorWallet(
    existing.creatorWallet,
    body.creatorWallet,
    "solana",
  );
  if (!immutableWallet.ok) {
    return NextResponse.json({ error: immutableWallet.error }, { status: 409 });
  }
  const ownership = await assertLaunchOwnsAgentDbId(
    session,
    body.agentId !== undefined ? body.agentId : existing.agentId,
  );
  if (!ownership.ok) {
    return NextResponse.json(
      { error: "Not authorized for this agent" },
      { status: ownership.status },
    );
  }
  if (body.agentId !== undefined && existing.launchStatus !== "draft") {
    return NextResponse.json(
      { error: "Agent id can only be updated while launch is in draft status" },
      { status: 409 },
    );
  }
  const data: Prisma.AgentLaunchUpdateInput = {};
  if (body.agentId !== undefined) {
    Object.assign(data, agentLaunchLinkageForUpdate(body.agentId));
  }
  if (body.tokenName !== undefined) data.tokenName = body.tokenName.trim();
  if (body.tokenSymbol !== undefined) data.tokenSymbol = body.tokenSymbol.trim().toUpperCase();
  if (body.tokenDescription !== undefined) data.tokenDescription = body.tokenDescription.trim();
  if (body.tokenImageUrl !== undefined) data.tokenImageUrl = body.tokenImageUrl.trim();
  if (body.creatorWallet !== undefined) data.creatorWallet = body.creatorWallet.trim();
  if (body.passportJson !== undefined) {
    data.passportJson = body.passportJson as Prisma.InputJsonValue;
  }
  const launch = await prisma.agentLaunch.update({
    where: { id },
    data,
  });
  const agentDbId = launch.agentDbId;
  const hasProfilePatch =
    body.profileWebsite !== undefined ||
    body.profileTwitter !== undefined ||
    body.profileTelegram !== undefined ||
    body.profileGithub !== undefined ||
    body.profileTags !== undefined ||
    body.archetype !== undefined ||
    body.profileServices !== undefined;
  if (agentDbId && hasProfilePatch) {
    try {
      const enrichment = sanitizeLaunchProfileEnrichmentInput({
        website: body.profileWebsite,
        github: body.profileGithub,
        archetype: body.archetype,
        capabilityTags: body.profileTags,
        services: body.profileServices,
        twitter: body.profileTwitter,
        telegram: body.profileTelegram,
        tokenImageUrl: body.tokenImageUrl ?? launch.tokenImageUrl,
        tokenName: body.tokenName ?? launch.tokenName,
        tokenDescription: body.tokenDescription ?? launch.tokenDescription,
      });
      await applyLaunchProfileEnrichment(agentDbId, launch.id, enrichment);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid profile enrichment";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }
  const refreshed = hasProfilePatch
    ? await prisma.agentLaunch.findUnique({ where: { id } })
    : launch;
  await recordAgentLaunchEvent({
    launchId: launch.id,
    type: "draft_updated",
    payloadJson: { fields: Object.keys(data) },
  });
  return NextResponse.json({ launch: serializeAgentLaunch(refreshed ?? launch) });
}
