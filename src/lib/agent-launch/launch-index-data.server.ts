import { mapWithConcurrency } from "@/lib/async-pool";
import { prisma } from "@/lib/db";
import { getAgentLaunchNetwork } from "@/lib/agent-launch/solana";
import { isMetaplexGenesisLaunch } from "@/lib/agent-launch/launch-venue";
import { serializeAgentLaunch } from "@/lib/agent-launch/serialize";
import {
  loadLaunchLinkedAgentSummariesByDbId,
  resolveLaunchAgentDbId,
  type LaunchLinkedAgentSummary,
} from "@/lib/agent-launch/linked-agent";
import {
  resolveAgentPassportForDisplay,
  type AgentPassport,
} from "@/lib/agent-launch/passport";
import { resolveLaunchDisplayProfile, passportCapabilityBadges, formatLamportsCompact, lifecycleStatusLabel, isLaunchLifecycleStatus } from "@/lib/agent-launch/launch-profile";
import {
  getDexscreenerMarketsForAddresses,
  getDexscreenerMarketsForMints,
} from "@/lib/public-site/dexscreener";
import type { TokenMarketSnapshot } from "@/lib/public-site/dexscreener";
import { getPumpFunBondingDataBatch } from "@/lib/public-site/pumpfun-bonding";
import {
  resolveRobinhoodGraduation,
  resolveSolanaGraduation,
  type TokenGraduationDisplay,
} from "@/lib/public-site/token-graduation";
import {
  resolveTokenCardMarket,
  resolveTokenCardSocials,
  type TokenCardSocials,
} from "@/lib/public-site/token-card-market";
import { listRobinhoodLaunches } from "@/lib/robinhood-chain/record-launch.server";
import { loadRobinhoodGraduationMetrics } from "@/lib/robinhood-chain/robinhood-graduation.server";
import { robinhoodTokenImageUrl } from "@/lib/robinhood-chain/resolve-token-image";
import type { RobinhoodLaunchRecord } from "@/lib/robinhood-chain/types";
import { getOrInsertComputed } from "@/lib/map-upsert";
const TRADE_EVENT_TYPES = ["test_buy_confirmed", "test_sell_confirmed"];
export type LaunchIndexCardModel = {
  launch: ReturnType<typeof serializeAgentLaunch>;
  profile: ReturnType<typeof resolveLaunchDisplayProfile>;
  tokenImageUrl: string | null;
  passport: AgentPassport | null;
  linkedAgent: LaunchLinkedAgentSummary | null;
  capabilityBadges: string[];
  lifecycleLabel: string;
  buyCount: number;
  sellCount: number;
  totalDistributedLabel: string;
  creatorShareLabel: string;
  arShareLabel: string;
  market: TokenMarketSnapshot | null;
  socials: TokenCardSocials;
  graduation: TokenGraduationDisplay | null;
};
/** Unified card model for mixed Solana + Robinhood token discovery. */
export type TokenDiscoveryCardModel = {
  chain: "solana" | "robinhood";
  id: string;
  tokenSymbol: string | null;
  tokenName: string | null;
  tokenImageUrl: string | null;
  detailHref: string;
  createdAt: string;
  linkedAgent: LaunchLinkedAgentSummary | null;
  market: TokenMarketSnapshot | null;
  socials: TokenCardSocials;
  /** Solana full model */
  launch?: LaunchIndexCardModel;
  /** Robinhood full model */
  rh?: RobinhoodLaunchRecord;
  sourceVerified?: boolean;
  sourceLabel?: string;
  graduation: TokenGraduationDisplay | null;
};
export async function loadLaunchIndexCards(): Promise<LaunchIndexCardModel[]> {
  const networkName = getAgentLaunchNetwork();
  const launches = await prisma.agentLaunch.findMany({
    where: {
      network: networkName,
      launchStatus: "indexed",
      feeSharingStatus: "active",
    },
    orderBy: { createdAt: "desc" },
  });
  if (launches.length === 0) return [];
  const agentIds = launches
    .map((launch) => resolveLaunchAgentDbId(launch))
    .filter((id): id is number => id != null);
  const linkedAgentMap = await loadLaunchLinkedAgentSummariesByDbId(agentIds);
  const launchIds = launches.map((l) => l.id);
  const events = await prisma.agentLaunchEvent.findMany({
    where: { launchId: { in: launchIds }, type: { in: TRADE_EVENT_TYPES } },
    select: { launchId: true, type: true },
  });
  const eventCounts = buildEventCountMap(events);
  const mints = launches.map((l) => l.mint).filter((m): m is string => m != null);
  const marketMap = mints.length > 0
    ? await getDexscreenerMarketsForMints(mints)
    : new Map<string, TokenMarketSnapshot>();
  const mainnetMints = launches
    .filter((l) => {
      const network = l.network?.trim().toLowerCase() ?? "";
      return (network === "mainnet-beta" || network === "mainnet") && l.mint;
    })
    .map((l) => l.mint!)
    .filter((mint, index, arr) => arr.indexOf(mint) === index);
  const pumpFunMap = mainnetMints.length > 0
    ? await getPumpFunBondingDataBatch(mainnetMints)
    : new Map();
  return launches.map((launch) => {
    const serialized = serializeAgentLaunch(launch);
    const passport = launch.passportJson ? resolveAgentPassportForDisplay(launch) : null;
    const profile = resolveLaunchDisplayProfile(launch);
    const counts = eventCounts.get(launch.id) ?? { buys: 0, sells: 0 };
    const creatorPct = launch.creatorShareBps / 100;
    const arPct = launch.arShareBps / 100;
    const agentDbId = resolveLaunchAgentDbId(launch);
    const linkedAgent = agentDbId != null ? (linkedAgentMap.get(agentDbId) ?? null) : null;
    const pumpFun = launch.mint ? (pumpFunMap.get(launch.mint) ?? null) : null;
    const isMetaplex = isMetaplexGenesisLaunch(launch.launchKind);
    const market = resolveTokenCardMarket(
      launch.mint ? (marketMap.get(launch.mint) ?? null) : null,
      pumpFun,
    );
    const graduation = isMetaplex
      ? {
          progressPct: null,
          graduated: false,
          statusLabel: "Genesis",
          detailLabel: "Metaplex Genesis launch",
          showBar: false,
        }
      : launch.mint
        ? resolveSolanaGraduation(pumpFun, market)
        : null;
    const lifecycleStatus = isLaunchLifecycleStatus(launch.launchLifecycleStatus)
      ? launch.launchLifecycleStatus
      : "unknown" as const;
    const socials = resolveTokenCardSocials(profile, pumpFun);
    return {
      launch: serialized,
      profile,
      tokenImageUrl:
        pumpFun?.imageUri ??
        profile.avatarUrl ??
        launch.tokenImageUrl ??
        null,
      passport,
      linkedAgent,
      market,
      socials,
      capabilityBadges: passport ? passportCapabilityBadges(passport) : [],
      lifecycleLabel: lifecycleStatusLabel(lifecycleStatus),
      buyCount: counts.buys,
      sellCount: counts.sells,
      totalDistributedLabel: formatLamportsCompact(launch.totalFeesDistributedLamports),
      creatorShareLabel: `${creatorPct}%`,
      arShareLabel: `${arPct}%`,
      graduation,
    };
  });
}
/** Load Robinhood Chain launches as TokenDiscoveryCardModel entries. */
async function loadRobinhoodIndexCards(): Promise<TokenDiscoveryCardModel[]> {
  const launches = await listRobinhoodLaunches(100);
  const agentIds = launches
    .map((l) => l.agentDbId)
    .filter((id): id is number => id != null);
  const linkedAgentMap = agentIds.length > 0
    ? await loadLaunchLinkedAgentSummariesByDbId(agentIds)
    : new Map<number, LaunchLinkedAgentSummary>();
  const addresses = launches
    .map((l) => l.tokenAddress)
    .filter((addr): addr is string => Boolean(addr));
  const marketMap = addresses.length > 0
    ? await getDexscreenerMarketsForAddresses("robinhood", addresses)
    : new Map<string, TokenMarketSnapshot>();
  const graduationEntries = await mapWithConcurrency(
    launches,
    8,
    async (launch) => {
      const metrics = await loadRobinhoodGraduationMetrics({
        tokenAddress: launch.tokenAddress,
        poolAddress: launch.poolAddress,
      }).catch(() => null);
      return [launch.id, resolveRobinhoodGraduation(launch.poolAddress, metrics)] as const;
    },
  );
  const graduationById = new Map(graduationEntries);
  return launches.map((launch) => {
    const agentDbId = launch.agentDbId;
    const linkedAgent = agentDbId != null ? (linkedAgentMap.get(agentDbId) ?? null) : null;
    const market =
      marketMap.get(launch.tokenAddress) ??
      [...marketMap.entries()].find(
        ([addr]) => addr.toLowerCase() === launch.tokenAddress.toLowerCase(),
      )?.[1] ??
      null;
    return {
      chain: "robinhood" as const,
      id: launch.id,
      tokenSymbol: launch.tokenSymbol,
      tokenName: launch.tokenName,
      tokenImageUrl: robinhoodTokenImageUrl({
        tokenLogoGatewayUrl: launch.tokenLogoGatewayUrl,
        tokenLogoIpfsUri: launch.tokenLogoIpfsUri,
        tokenImageOriginalUrl: launch.tokenImageOriginalUrl,
        tokenImageUrl: launch.tokenImageUrl,
        agentImage: linkedAgent?.image,
        tokenName: launch.tokenName,
        tokenSymbol: launch.tokenSymbol,
      }),
      detailHref: `/tokens/robinhood/${launch.tokenAddress}`,
      createdAt: launch.blockTimestamp,
      linkedAgent,
      market,
      socials: resolveTokenCardSocials({
        twitter: launch.twitter,
        telegram: launch.telegram,
        website: launch.website,
      }),
      rh: launch,
      sourceVerified: launch.sourceVerified,
      sourceLabel: launch.frontendSourceLabel,
      graduation: graduationById.get(launch.id) ?? resolveRobinhoodGraduation(launch.poolAddress, null),
    };
  });
}
/** Load both Solana and Robinhood Chain launch index cards, merged and sorted by recency. */
export async function loadAllLaunchIndexCards(): Promise<TokenDiscoveryCardModel[]> {
  const [solana, robinhood] = await Promise.all([
    loadLaunchIndexCards(),
    loadRobinhoodIndexCards(),
  ]);
  const solanaCards: TokenDiscoveryCardModel[] = solana.map((card) => ({
    chain: "solana" as const,
    id: card.launch.id,
    tokenSymbol: card.launch.tokenSymbol,
    tokenName: card.profile.displayName,
    tokenImageUrl: card.tokenImageUrl,
    detailHref: `/tokens/${card.launch.mint}`,
    createdAt: new Date(card.launch.createdAt).toISOString(),
    linkedAgent: card.linkedAgent,
    market: card.market,
    socials: card.socials,
    graduation: card.graduation,
    launch: card,
  }));
  const merged = [...solanaCards, ...robinhood];
  merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return merged;
}
function buildEventCountMap(events: readonly { launchId: string; type: string }[]): Map<string, { buys: number; sells: number }> {
  const counts = new Map<string, { buys: number; sells: number }>();
  for (const event of events) {
    const row = getOrInsertComputed(counts, event.launchId, () => ({ buys: 0, sells: 0 }));
    if (event.type === "test_buy_confirmed") row.buys += 1;
    if (event.type === "test_sell_confirmed") row.sells += 1;
  }
  return counts;
}
