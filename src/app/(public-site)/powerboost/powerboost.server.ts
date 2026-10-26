import "server-only";
import {
  POWERBOOST_PERIODS,
  getPowerBoostPayload,
  type PowerBoostPeriod,
} from "@/lib/public-statistics/service";
import type { PowerBoostData } from "@/app/(public-site)/powerboost/powerboost-types";
export type PowerBoostPageParams = Readonly<{
  page: number;
  perPage: 20;
  period: PowerBoostPeriod;
}>;
type PowerBoostAgentDto = PowerBoostData["agents"][number];
type PowerBoostSourceAgent = Awaited<
  ReturnType<typeof getPowerBoostPayload>
>["value"]["agents"][number] & {
  chain: PowerBoostAgentDto["chain"];
  sapTwinMatch?: boolean;
};
function firstString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
function boundedPage(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
}
function normalizePeriod(value: string | undefined): PowerBoostPeriod {
  return value && (POWERBOOST_PERIODS as readonly string[]).includes(value)
    ? (value as PowerBoostPeriod)
    : "all";
}
export function normalizePowerBoostSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): PowerBoostPageParams {
  return {
    page: boundedPage(firstString(searchParams.page)),
    perPage: 20,
    period: normalizePeriod(firstString(searchParams.period)),
  };
}
function toPowerBoostAgentDto(raw: PowerBoostSourceAgent): PowerBoostAgentDto {
  return {
    id: raw.id,
    agentId: raw.agentId,
    chainId: raw.chainId,
    name: raw.name,
    image: raw.image,
    owner: raw.owner,
    score: raw.score,
    rank: raw.rank,
    totalFeedback: raw.totalFeedback,
    hasDuplicateName: raw.hasDuplicateName,
    sapVerified: raw.sapVerified,
    sapTwinMatch: raw.sapTwinMatch,
    isVerified: raw.isVerified,
    isPremiumVerified: raw.isPremiumVerified,
    hotScore: raw.hotScore,
    powerScore: raw.powerScore,
    daoVotes: raw.daoVotes,
    stakingVotes: raw.stakingVotes,
    paidBoostVotes: raw.paidBoostVotes,
    adminVotes: raw.adminVotes,
    activeBoosts: raw.activeBoosts,
    adminPowerAdjust: raw.adminPowerAdjust,
    hasHolderPowerBoost: raw.hasHolderPowerBoost,
    holderPowerBoostBackerCount: raw.holderPowerBoostBackerCount,
    holderPowerBoostUnits: raw.holderPowerBoostUnits,
    lastActiveAt:
      raw.lastActiveAt instanceof Date
        ? raw.lastActiveAt.toISOString()
        : raw.lastActiveAt ?? null,
    slug: raw.slug,
    profilePath: raw.profilePath,
    chain: {
      name: raw.chain.name,
      shortName: raw.chain.shortName,
      color: raw.chain.color,
      icon: raw.chain.icon,
    },
  };
}
export async function readPowerBoostPageData(
  params: PowerBoostPageParams,
): Promise<Readonly<{ data: PowerBoostData; generatedAtMs: number }>> {
  const result = await getPowerBoostPayload(params);
  const generatedAtMs = Date.parse(result.generatedAt);
  const data: PowerBoostData = {
    agents: result.value.agents.map((agent) =>
      toPowerBoostAgentDto(agent as PowerBoostSourceAgent),
    ),
    total: result.value.total,
    page: result.value.page,
    perPage: result.value.perPage,
    totalPages: result.value.totalPages,
  };
  return {
    data,
    generatedAtMs: Number.isFinite(generatedAtMs) ? generatedAtMs : Date.now(),
  };
}
