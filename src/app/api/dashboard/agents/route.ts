import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireDashboardAccessForApi } from "@/lib/dashboard/access";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { createNativeAgentRankingAgent } from "@/lib/dashboard/native-agent";
import { tryRegisterAgentOnSolana } from "@/lib/agent-solana-registration/service";
import {
  assertAgentCreationAllowed,
  countNativeAgentsForProfile,
  loadAppAccountSummary,
} from "@/lib/app-account-summary";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { buildOwnedAgentsWhere } from "@/lib/dashboard/agent-ownership";
import { normalizeStoredAgentImageUrl } from "@/lib/image-utils";
import { completeOnboarding } from "@/lib/onboarding";
import {
  loadAgentPublicReferralScalarsBulk,
  mergePublicReferralScalarsIntoRecord,
} from "@/lib/agent-public-referral-db";
export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getServerSession(authOptions);
  const dashboardAccess = await requireDashboardAccessForApi(session);
  if (!dashboardAccess.ok) {
    return NextResponse.json(
      { error: dashboardAccess.status === 401 ? "Unauthorized" : "subscription_required" },
      { status: dashboardAccess.status },
    );
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return NextResponse.json({ agents: [] });
  }
  const full = await prisma.userProfile.findUnique({
    where: { id: profile.id },
    select: { walletAddress: true, solanaWallet: true },
  });
  const agents = await prisma.agent.findMany({
    where: buildOwnedAgentsWhere({
      id: profile.id,
      walletAddress: full?.walletAddress ?? null,
      solanaWallet: full?.solanaWallet ?? null,
    }),
    select: {
      id: true,
      agentId: true,
      chainId: true,
      name: true,
      description: true,
      image: true,
      score: true,
      rank: true,
      isVerified: true,
      isPremiumVerified: true,
      isVerifiedRevenue: true,
      archetype: true,
      tokenAddress: true,
      publicReferralCode: true,
      publicReferralDestination: true,
      publicReferralInfo: true,
      chain: { select: { name: true, shortName: true, color: true, icon: true } },
      services: { select: { id: true, name: true, endpoint: true, version: true } },
      metadata: { select: { id: true, key: true, value: true } },
    },
    orderBy: { score: "desc" },
  });
  const refById = await loadAgentPublicReferralScalarsBulk(
    prisma,
    agents.map((a) => a.id),
  );
  const agentsWithReferral = agents.map((a) =>
    mergePublicReferralScalarsIntoRecord(a, refById.get(a.id) ?? null),
  );
  return NextResponse.json({ agents: agentsWithReferral });
}
type CreateAgentBody = {
  name?: string;
  description?: string;
  persona?: string;
  image?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  github?: string;
  tags?: string[];
  agentWallet?: string;
};
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return NextResponse.json({ error: "Profile required" }, { status: 403 });
  }
  let body: CreateAgentBody;
  try {
    body = (await request.json()) as CreateAgentBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const agentCount = await countNativeAgentsForProfile(profile.id);
    const accountSummary = await loadAppAccountSummary(session);
    const maxAgents = accountSummary?.maxAgents ?? 3;
    assertAgentCreationAllowed(agentCount, maxAgents);
    const agent = await createNativeAgentRankingAgent(
      {
        id: profile.id,
        walletAddress: profile.walletAddress,
        solanaWallet: profile.solanaWallet,
      },
      {
        name: body.name ?? "",
        description: body.description,
        persona: body.persona,
        image: body.image ? normalizeStoredAgentImageUrl(body.image) : undefined,
        website: body.website,
        twitter: body.twitter,
        telegram: body.telegram,
        github: body.github,
        tags: body.tags,
        agentWallet: body.agentWallet,
      },
    );
    await completeOnboarding(profile.id);
    const registration = await tryRegisterAgentOnSolana(agent.id);
    revalidatePath("/dashboard", "layout");
    revalidatePath("/agents", "layout");
    return NextResponse.json({
      ok: true,
      agent: {
        id: agent.id,
        agentId: agent.agentId,
        chainId: agent.chainId,
        name: agent.name,
      },
      registration: registration.ok
        ? {
            listed: true,
            directoryAsset: registration.result.directoryAsset,
            directoryTx: registration.result.directoryTx,
          }
        : {
            listed: false,
            reason: registration.reason,
            message: registration.message,
          },
    });
  } catch (error) {
    const message = Error.isError(error) ? error.message : "Create failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
