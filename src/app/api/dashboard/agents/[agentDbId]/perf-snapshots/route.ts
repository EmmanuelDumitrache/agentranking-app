import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireDashboardFeatureForApi } from "@/lib/dashboard/access";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { dashboardUserOwnsAgentDbId } from "@/lib/dashboard/ownership-check";
import { getPerformanceSnapshots } from "@/lib/agent-perf-snapshots";
export const dynamic = "force-dynamic";
async function assertProAgentAccess(session: Session | null, agentDbId: number) {
  const dashboardAccess = await requireDashboardFeatureForApi(session, "perf_snapshots");
  if (!dashboardAccess.ok) {
    return {
      error: (dashboardAccess.status === 401 ? "Unauthorized" : "subscription_required") as string,
      status: dashboardAccess.status,
    };
  }
  const resolved = await ensureMinimalUserProfile(session);
  if (!resolved) {
    return { error: "No Agent Dashboard profile", status: 400 as const };
  }
  const profile = await prisma.userProfile.findUnique({
    where: { id: resolved.id },
    select: { walletAddress: true, solanaWallet: true },
  });
  const w = profile?.walletAddress?.trim() || profile?.solanaWallet?.trim() || "";
  const owned = await dashboardUserOwnsAgentDbId(w || null, agentDbId, resolved.id);
  if (!owned) {
    return { error: "Forbidden", status: 403 as const };
  }
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: { id: true, owner: true, verifiedWallet: true },
  });
  if (!agent) return { error: "Agent not found", status: 404 as const };
  return { agent };
}
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> }
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdRaw } = await params;
  const agentDbId = Number.parseInt(agentDbIdRaw, 10);
  if (!Number.isFinite(agentDbId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const gate = await assertProAgentAccess(session, agentDbId);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const snapshots = await getPerformanceSnapshots(agentDbId, { limit: 120 });
  return NextResponse.json({ snapshots });
}
