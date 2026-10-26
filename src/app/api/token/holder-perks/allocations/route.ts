import { randomUUIDv7 } from "@/lib/uuid-v7";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Prisma } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureMinimalUserProfile, hasDashboardIdentity } from "@/lib/dashboard/session-profile";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import {
  formatHolderTokenAmount,
  getHolderTierById,
  holderTierMeetsOrExceeds,
  HOLDER_POWER_BOOST_PERK,
  HOLDER_STAKE_BADGE_PERK,
  isHolderAgentPerkType,
} from "@/lib/ar-holder-perk-config";
import { computePortfolioStakeMetrics } from "@/lib/ar-holder-tier-math";
import {
  computeStakeBalancesByTier,
  holderTierJson,
  normalizeStakeWallet,
  recordedStakePositionsForWallet,
  resolveHolderTiers,
} from "@/lib/ar-holder-tier-resolve";
import {
  hasActiveHolderPerkCooldown,
  holderPerkCooldownErrorMessage,
} from "@/lib/holder-perk-cooldown";
import { holderPerkPeriodKey } from "@/lib/holder-perk-period-key";
import { applyDaoVotesAdminChange } from "@/lib/admin-dao-votes-apply";
import { activeHolderPerksRelationFind } from "@/lib/leaderboard-filters";
import { computeDaoVoteBreakdown } from "@/lib/powerboost-payload";
import { verifySolanaSignMessage } from "@/lib/sap-claim-verify";
import { isFreshStakePerkTimestamp, parseStakePerkMessage } from "@/lib/stake-perk-message";
export const dynamic = "force-dynamic";
type AllocationRow = {
  id: string;
  wallet: string;
  agentId: number;
  perkType: string;
  tierId: string;
  boostUnits: number;
  status: string;
  periodKey: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
function perkExpiresAt(minLockDays: number, now = new Date()): Date {
  const days = Math.max(1, minLockDays);
  return new Date(now.getTime() + days * 86_400_000);
}
async function sessionProfileId(): Promise<number | null> {
  const session = await getServerSession(authOptions);
  if (!hasDashboardIdentity(session)) return null;
  const profile = await ensureMinimalUserProfile(session);
  return profile?.id ?? null;
}
async function agentExistsForPerkApply(agentDbId: number) {
  return prisma.agent.findFirst({
    where: { id: agentDbId, isActive: true },
    select: { id: true, name: true },
  });
}
async function listEligibleAgents(wallet: string, userProfileId: number | null) {
  const or: Prisma.AgentWhereInput[] = [
    { owner: wallet },
    { verifiedWallet: wallet },
    { sapOwnerWallet: wallet },
    {
      metadata: {
        some: { key: "agentWallet", value: wallet },
      },
    },
  ];
  if (userProfileId != null) {
    or.push({ sapOperatorClaim: { userProfileId } });
  }
  const agents = await prisma.agent.findMany({
    where: { OR: or, isActive: true },
    select: {
      id: true,
      agentId: true,
      chainId: true,
      name: true,
      image: true,
      score: true,
      powerScore: true,
      activeBoosts: true,
      adminPowerAdjust: true,
      isVerified: true,
      isPremiumVerified: true,
      sapVerified: true,
      chain: { select: { shortName: true, color: true, icon: true } },
    },
    orderBy: [{ isPremiumVerified: "desc" }, { score: "desc" }],
    take: 50,
  });
  return agents.map((a) => ({
    ...a,
    slug: toAgentUrlSlug(a.name),
    profilePath: agentPublicPath(a),
  }));
}
async function readAllocations(wallet: string): Promise<AllocationRow[]> {
  return prisma.$queryRaw<AllocationRow[]>`
    SELECT *
    FROM "ArHolderAgentPerk"
    WHERE "wallet" = ${wallet}
      AND "status" = 'active'
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
    ORDER BY "updatedAt" DESC
  `;
}
export async function GET(req: NextRequest) {
  const wallet = normalizeStakeWallet(req.nextUrl.searchParams.get("wallet"));
  if (!wallet) return NextResponse.json({ error: "wallet query parameter is required" }, { status: 400 });
  const userProfileId = await sessionProfileId();
  const tiers = await resolveHolderTiers();
  const [positions, agents, allocations] = await Promise.all([
    recordedStakePositionsForWallet(wallet),
    listEligibleAgents(wallet, userProfileId),
    readAllocations(wallet),
  ]);
  const balances = computeStakeBalancesByTier(positions, tiers);
  const portfolioMetrics = computePortfolioStakeMetrics(positions);
  return NextResponse.json({
    wallet,
    cooldownDays: {
      power_boost: 14,
      stake_badge: 7,
    },
    stakeBalanceRaw: balances.stakeBalanceRaw.toString(),
    stakeBalanceTotalRaw: balances.total.toString(),
    recordedMaxLockDays: portfolioMetrics.maxLockDurationDays,
    recordedDaysUntilLastUnlock: portfolioMetrics.daysUntilLastUnlock,
    activeStakeCount: positions.length,
    stakeBalanceMinLock7dRaw: balances.node.toString(),
    stakeBalanceMinLock14dRaw: balances.validator.toString(),
    stakeBalanceMinLock30dRaw: balances.core.toString(),
    stakeBalancesByTierId: {
      node: balances.node.toString(),
      validator: balances.validator.toString(),
      core: balances.core.toString(),
    },
    stakeTier: balances.stakeTier ? holderTierJson(balances.stakeTier) : null,
    tiers: tiers.map(holderTierJson),
    agents,
    allocations: allocations.map((row) => ({
      ...row,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      agentName: agents.find((a) => a.id === row.agentId)?.name ?? null,
    })),
  });
}
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const wallet = normalizeStakeWallet(typeof body.wallet === "string" ? body.wallet : "");
  const agentDbId = Number(body.agentDbId);
  const perkType = typeof body.perkType === "string" ? body.perkType : "";
  const tierId = typeof body.tierId === "string" ? body.tierId : "";
  if (!wallet) return NextResponse.json({ error: "wallet is required" }, { status: 400 });
  const signMessage = typeof body.signMessage === "string" ? body.signMessage : "";
  const signSignature = typeof body.signSignature === "string" ? body.signSignature : "";
  const signPublicKey = typeof body.signPublicKey === "string" ? body.signPublicKey : "";
  if (signMessage && signSignature && signPublicKey) {
    const parsed = parseStakePerkMessage(signMessage);
    if (
      !parsed ||
      normalizeStakeWallet(parsed.wallet) !== wallet ||
      !isFreshStakePerkTimestamp(parsed.atMs) ||
      !verifySolanaSignMessage(signMessage, signSignature, signPublicKey)
    ) {
      return NextResponse.json({ error: "Invalid wallet signature for holder perk." }, { status: 403 });
    }
  }
  if (!Number.isInteger(agentDbId) || agentDbId <= 0) {
    return NextResponse.json({ error: "agentDbId is required" }, { status: 400 });
  }
  if (!isHolderAgentPerkType(perkType)) {
    return NextResponse.json({ error: "Unsupported holder perk" }, { status: 400 });
  }
  const requestedTier = getHolderTierById(tierId);
  if (!requestedTier) return NextResponse.json({ error: "Unknown holder tier" }, { status: 400 });
  const agent = await agentExistsForPerkApply(agentDbId);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  const tiers = await resolveHolderTiers();
  const effectiveRequestedTier = tiers.find((tier) => tier.id === requestedTier.id) ?? requestedTier;
  const positions = await recordedStakePositionsForWallet(wallet);
  const balances = computeStakeBalancesByTier(positions, tiers);
  const stakeTier = balances.stakeTier;
  if (!holderTierMeetsOrExceeds(stakeTier, requestedTier)) {
    return NextResponse.json(
      {
        error: `Recorded stake does not meet ${effectiveRequestedTier.label}: need ≥${formatHolderTokenAmount(effectiveRequestedTier.minBalanceRaw)} $AR in active positions with lock ≥${effectiveRequestedTier.minLockDays} days.`,
      },
      { status: 403 },
    );
  }
  if (await hasActiveHolderPerkCooldown(prisma, wallet, agentDbId, perkType)) {
    return NextResponse.json(
      { error: holderPerkCooldownErrorMessage(perkType, agent.name) },
      { status: 409 },
    );
  }
  const boostUnits = perkType === HOLDER_POWER_BOOST_PERK ? effectiveRequestedTier.boostUnits : 0;
  const expiresAt = perkExpiresAt(effectiveRequestedTier.minLockDays);
  const pKey = holderPerkPeriodKey(agentDbId, perkType);
  const id = randomUUIDv7();
  const rows = await prisma.$queryRaw<AllocationRow[]>`
    INSERT INTO "ArHolderAgentPerk"
      ("id", "wallet", "agentId", "perkType", "tierId", "boostUnits", "status", "periodKey", "expiresAt", "updatedAt")
    VALUES
      (${id}, ${wallet}, ${agentDbId}, ${perkType}, ${effectiveRequestedTier.id}, ${boostUnits}, 'active', ${pKey}, ${expiresAt}, NOW())
    ON CONFLICT ("wallet", "perkType", "periodKey")
    DO UPDATE SET
      "agentId" = EXCLUDED."agentId",
      "tierId" = EXCLUDED."tierId",
      "boostUnits" = EXCLUDED."boostUnits",
      "status" = 'active',
      "expiresAt" = EXCLUDED."expiresAt",
      "updatedAt" = NOW()
    RETURNING *
  `;
  if (perkType === HOLDER_POWER_BOOST_PERK) {
    await applyDaoVotesAdminChange(prisma, [agentDbId]).catch((err) => {
      console.error("[holder-perks/allocations] dao votes sync failed:", err);
    });
  }
  const now = new Date();
  const activePerkWhere = {
    agentId: agentDbId,
    status: "active" as const,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
  const agentAfter =
    perkType === HOLDER_POWER_BOOST_PERK
      ? await prisma.agent.findUnique({
          where: { id: agentDbId },
          select: {
            powerScore: true,
            activeBoosts: true,
            adminPowerAdjust: true,
            holderAgentPerks: activeHolderPerksRelationFind(),
          },
        })
      : null;
  const voteBreakdown = agentAfter ? computeDaoVoteBreakdown(agentAfter) : null;
  const [powerAgg, badgeCount] = await Promise.all([
    perkType === HOLDER_POWER_BOOST_PERK
      ? prisma.arHolderAgentPerk.aggregate({
          where: { ...activePerkWhere, perkType: HOLDER_POWER_BOOST_PERK },
          _sum: { boostUnits: true },
          _count: { _all: true },
        })
      : null,
    perkType === HOLDER_STAKE_BADGE_PERK
      ? prisma.arHolderAgentPerk.count({
          where: { ...activePerkWhere, perkType: HOLDER_STAKE_BADGE_PERK },
        })
      : null,
  ]);
  return NextResponse.json({
    ok: true,
    allocation: rows[0] ?? null,
    stakeTier: stakeTier ? holderTierJson(stakeTier) : null,
    applied: {
      perkType,
      tierId: effectiveRequestedTier.id,
      tierName: effectiveRequestedTier.name,
      boostUnits,
      agentName: agent.name,
      badgeLabel: perkType === HOLDER_STAKE_BADGE_PERK ? effectiveRequestedTier.badgeLabel : null,
      stakingVotesContributed:
        perkType === HOLDER_POWER_BOOST_PERK ? boostUnits : undefined,
      daoVotesTotal: voteBreakdown?.total,
      paidBoostVotes: voteBreakdown?.paidBoostVotes,
      adminVotes: voteBreakdown?.adminVotes,
      stakingVotesOnAgent: voteBreakdown?.stakingVotes,
      totalPowerBoostUnits: powerAgg?._sum.boostUnits ?? undefined,
      powerBoostBackerCount: powerAgg?._count._all ?? undefined,
      stakeBadgeBackerCount: badgeCount ?? undefined,
    },
  });
}
