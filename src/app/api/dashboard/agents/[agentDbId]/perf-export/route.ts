import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireDashboardFeatureForApi } from "@/lib/dashboard/access";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { dashboardUserOwnsAgentDbId } from "@/lib/dashboard/ownership-check";
export const dynamic = "force-dynamic";
async function assertProAgentAccess(session: Session | null, agentDbId: number) {
  const dashboardAccess = await requireDashboardFeatureForApi(session, "exports");
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
    select: { id: true, owner: true, verifiedWallet: true, name: true },
  });
  if (!agent) return { error: "Agent not found", status: 404 as const };
  return { agent };
}
function escapeCsvCell(v: string | number): string {
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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
  const rows = await prisma.agentPerfSnapshot.findMany({
    where: { agentId: agentDbId },
    orderBy: { capturedAt: "asc" },
    take: 500,
  });
  const header = [
    "capturedAt",
    "txCount",
    "profitableTxCount",
    "grossProfitUsd",
    "totalFeesUsd",
    "netPnlUsd",
    "volumeUsd",
    "winRate",
    "burnToEarnRatio",
    "avgPnlPercent",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.capturedAt.toISOString(),
        r.txCount,
        r.profitableTxCount,
        r.grossProfitUsd,
        r.totalFeesUsd,
        r.netPnlUsd,
        r.volumeUsd,
        r.winRate,
        r.burnToEarnRatio,
        r.avgPnlPercent,
      ]
        .map(escapeCsvCell)
        .join(",")
    );
  }
  const safeName = (gate.agent.name || "agent").replace(/[^\w\-]+/g, "_").slice(0, 40);
  const filename = `perf-snapshots-${safeName}-${agentDbId}.csv`;
  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
