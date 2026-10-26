import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  describeCustodialProvisionError,
  ensureAgentCustodialWallet,
  getCustodialProvisionBlocker,
} from "@/lib/custodial-wallet/bootstrap";
import { serializeCustodialWalletPublic } from "@/lib/custodial-wallet/serialize";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { solscanAccountUrlForNetwork } from "@/lib/custodial-wallet/solscan";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ agentDbId: string }> };
export async function POST(_request: Request, context: RouteContext) {
  const { agentDbId } = await context.params;
  const id = Number.parseInt(agentDbId, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = await getDashboardAccess(session);
  if (!access.ownedAgents.some((agent) => agent.id === id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const blocker = getCustodialProvisionBlocker();
  if (!blocker.ok) {
    return NextResponse.json(
      { error: describeCustodialProvisionError(blocker.code) },
      { status: 503 },
    );
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return NextResponse.json({ error: "No profile" }, { status: 400 });
  }
  const publicKey = await ensureAgentCustodialWallet(id, profile.id);
  if (!publicKey) {
    return NextResponse.json(
      { error: "Could not provision agent wallet. Ensure the agent is AgentRanking-native." },
      { status: 500 },
    );
  }
  const network = getAgentLaunchConfig().network;
  return NextResponse.json({
    wallet: serializeCustodialWalletPublic({
      publicKey,
      scope: "AGENT",
    }),
    solscanUrl: solscanAccountUrlForNetwork(publicKey, network),
    alreadyProvisioned: false,
  });
}
