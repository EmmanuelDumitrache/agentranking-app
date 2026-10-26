import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { loadAgentWalletTransfers } from "@/lib/dashboard/wallet-page";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const { agentDbId } = await params;
  const id = /^\d+$/.test(agentDbId) ? Number(agentDbId) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid agent ID" }, { status: 400 });
  }
  const limitParam = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "10", 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 10;
  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    const error = access.status === 401 ? "Unauthorized" : access.status === 403 ? "Forbidden" : "Agent not found";
    return NextResponse.json({ error }, { status: access.status });
  }
  try {
    return NextResponse.json({ transfers: await loadAgentWalletTransfers(id, limit) });
  } catch (error) {
    console.error("[agent-transfers]", error);
    return NextResponse.json({ error: "Failed to load transfers" }, { status: 500 });
  }
}
