import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { loadAgentEvmActivity } from "@/lib/dashboard/wallet-page";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentDbId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { agentDbId } = await params;
  const id = /^\d+$/.test(agentDbId) ? Number(agentDbId) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid agent ID" }, { status: 400 });
  }
  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    const error = access.status === 401 ? "Unauthorized" : access.status === 403 ? "Forbidden" : "Agent not found";
    return NextResponse.json({ error }, { status: access.status });
  }
  try {
    return NextResponse.json({ activity: await loadAgentEvmActivity(id, 10) });
  } catch (error) {
    console.error("[evm-activity]", error);
    return NextResponse.json({ error: "Failed to load EVM activity" }, { status: 500 });
  }
}
