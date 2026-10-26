import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireDashboardAccessForApi } from "@/lib/dashboard/access";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import { dashboardUserOwnsAgentDbId } from "@/lib/dashboard/ownership-check";
export type DashboardAgentForMcp = {
  id: number;
  owner: string;
  verifiedWallet: string | null;
  isVerified: boolean;
  isPremiumVerified: boolean;
};
export type DashboardMcpAccessOk = {
  ok: true;
  wallet: string;
  agent: DashboardAgentForMcp;
};
export type DashboardMcpAccessErr = {
  ok: false;
  response: NextResponse;
};
export async function requireDashboardAgentForMcp(
  agentDbId: number,
): Promise<DashboardMcpAccessOk | DashboardMcpAccessErr> {
  const session = await getServerSession(authOptions);
  const dashboardAccess = await requireDashboardAccessForApi(session);
  if (!dashboardAccess.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: dashboardAccess.status === 401 ? "Unauthorized" : "subscription_required" },
        { status: dashboardAccess.status },
      ),
    };
  }
  const resolved = await getDashboardUserProfile(session);
  if (!resolved) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "No Agent Dashboard profile for this session. Try signing in again or verify an agent first.",
          code: "NO_PROFILE",
        },
        { status: 400 },
      ),
    };
  }
  const walletFromProfile = resolved.walletAddress?.trim() || resolved.solanaWallet?.trim();
  const walletFromSession = session?.user?.walletAddress?.trim();
  const w = walletFromProfile ?? walletFromSession ?? "";
  const owned = await dashboardUserOwnsAgentDbId(w || null, agentDbId, resolved.id);
  if (!owned) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden." }, { status: 403 }) };
  }
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      id: true,
      owner: true,
      verifiedWallet: true,
      isVerified: true,
      isPremiumVerified: true,
    },
  });
  if (!agent) {
    return { ok: false, response: NextResponse.json({ error: "Agent not found." }, { status: 404 }) };
  }
  return { ok: true, wallet: w, agent };
}
export function agentCanPublishMcpOffers(
  agent: Pick<DashboardAgentForMcp, "isVerified" | "isPremiumVerified">,
): boolean {
  void agent;
  // Agent Dashboard MCP listings are gated by wallet ownership (requireDashboardAgentForMcp), not KYA.
  return true;
}
