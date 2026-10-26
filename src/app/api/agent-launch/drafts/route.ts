import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import { recordAgentLaunchEvent } from "@/lib/agent-launch/events";
import { agentLaunchLinkageForCreate } from "@/lib/agent-launch/agent-db-id";
import { serializeAgentLaunch } from "@/lib/agent-launch/serialize";
import { assertLaunchOwnsAgentDbId } from "@/lib/agent-launch/selected-agent";
import { validateCreatorWallet } from "@/lib/agent-launch/validation";
import { getLaunchWalletSession } from "@/lib/launch-wallet-session/session";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  const body = (await request.json()) as {
    agentId?: string;
    creatorWallet?: string;
  };
  const agentId = body.agentId?.trim() || null;
  const creatorWallet = body.creatorWallet?.trim() || null;
  const session = await getServerSession(authOptions);
  const ownership = await assertLaunchOwnsAgentDbId(session, agentId);
  if (!ownership.ok) {
    return NextResponse.json(
      { error: "Not authorized for this agent" },
      { status: ownership.status },
    );
  }
  const walletSession = await getLaunchWalletSession();
  if (!agentId?.trim()) {
    if (!walletSession || walletSession.chain !== "solana") {
      return NextResponse.json(
        { error: "Solana wallet session required for quick launches." },
        { status: 401 },
      );
    }
    if (walletSession.wallet !== creatorWallet?.trim()) {
      return NextResponse.json(
        { error: "Creator wallet must match verified session wallet." },
        { status: 403 },
      );
    }
  }
  const walletError = validateCreatorWallet(creatorWallet ?? undefined);
  if (!creatorWallet?.trim()) {
    return NextResponse.json({ error: "Creator wallet is required" }, { status: 400 });
  }
  if (walletError) {
    return NextResponse.json({ error: walletError }, { status: 400 });
  }
  const config = getAgentLaunchConfig();
  const linkage = agentLaunchLinkageForCreate(agentId);
  const launch = await prisma.agentLaunch.create({
    data: {
      ...linkage,
      creatorWallet,
      network: config.network,
      arTreasuryWallet: config.treasury,
      creationFeeLamports: config.creationFeeLamports,
      creatorShareBps: config.creatorShareBps,
      arShareBps: config.arShareBps,
      launchStatus: "draft",
      feeSharingStatus: "pending",
      launchKind: agentId?.trim() ? "agentranking" : "wallet_quick",
    },
  });
  await recordAgentLaunchEvent({
    launchId: launch.id,
    type: "draft_created",
    payloadJson: { agentId, creatorWallet },
  });
  return NextResponse.json({
    id: launch.id,
    launchStatus: launch.launchStatus,
    launch: serializeAgentLaunch(launch),
  });
}
