import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { agentLaunchApiGuardResponse, assertAgentLaunchServerEnabled } from "@/lib/agent-launch/guards";
import { serializeAgentLaunch } from "@/lib/agent-launch/serialize";
import { sanitizeLaunchProfilePatch } from "@/lib/agent-launch/launch-profile";
import {
  assertAgentLaunchDraftAccess,
  loadLaunchAccessContext,
} from "@/lib/launch-wallet-session/auth";
type RouteContext = { params: Promise<{ launchId: string }> };
const IMMUTABLE_LAUNCH_FIELDS = [
  "mint",
  "creationTx",
  "feeShareTx",
  "feeSharingConfig",
  "feeSharingStatus",
  "launchStatus",
  "launchKind",
  "launchLifecycleStatus",
  "marketSource",
  "totalFeesDistributedLamports",
  "totalCreatorFeesLamports",
  "totalArFeesLamports",
  "lastDistributionAt",
  "creatorWallet",
  "arTreasuryWallet",
  "creatorShareBps",
  "arShareBps",
  "network",
] as const;
export async function PATCH(request: Request, context: RouteContext) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  const { launchId } = await context.params;
  const launch = await prisma.agentLaunch.findUnique({ where: { id: launchId } });
  if (!launch) {
    return NextResponse.json({ error: "Launch not found" }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  const access = await assertAgentLaunchDraftAccess(
    launch,
    await loadLaunchAccessContext(session),
  );
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  for (const key of IMMUTABLE_LAUNCH_FIELDS) {
    if (key in body) {
      return NextResponse.json(
        { error: `Field ${key} is immutable and cannot be edited via profile patch` },
        { status: 400 },
      );
    }
  }
  const patch = sanitizeLaunchProfilePatch(body);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No editable profile fields provided" }, { status: 400 });
  }
  const updated = await prisma.agentLaunch.update({
    where: { id: launchId },
    data: patch,
  });
  return NextResponse.json({ launch: serializeAgentLaunch(updated) });
}
