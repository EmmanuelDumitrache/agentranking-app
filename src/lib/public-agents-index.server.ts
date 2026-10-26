import { prisma } from "@/lib/db";
import { isMetaplexGenesisLaunch } from "@/lib/agent-launch/launch-venue";
import {
  getDexscreenerMarketsForAddresses,
  getDexscreenerMarketsForMints,
} from "@/lib/public-site/dexscreener";
import type { TokenMarketSnapshot } from "@/lib/public-site/dexscreener";
import { loadPublicAgentsPreview } from "@/lib/public-agents";
import {
  pickPublicAgentLinkedTokenFromPreview,
  type PublicAgentPreview,
} from "@/lib/public-agent-display";
import type { PublicAgentLinkedToken } from "@/lib/public-agent-token";
import { getOrInsert, getOrInsertComputed } from "@/lib/map-upsert";
import { agentPublicPath } from "@/lib/agent-public-url";
import { sanitizeAgentImageUrl } from "@/lib/image-utils";
import { withInheritedAgentVerification } from "@/lib/public-site/agent-verification";
import { toPublicAgentCredential, type PublicAgentCredential } from "@/lib/verification/public-agent-credential";
import { isAgentSolanaDirectoryListed } from "@/lib/agent-solana-registration/display";
const TRADE_EVENT_TYPES = ["test_buy_confirmed", "test_sell_confirmed"] as const;
export type PublicAgentIndexModel = {
  readonly id: number;
  readonly agentId: number;
  readonly chainId: number;
  readonly name: string;
  readonly image: string;
  readonly description: string;
  readonly isVerified: boolean;
  readonly isPremiumVerified: boolean;
  readonly publicVerificationStatus: string;
  readonly arVerificationStatus: string | null;
  readonly ownerAccountVerified?: boolean;
  readonly credential: PublicAgentCredential;
  readonly isSolanaDirectoryListed: boolean;
  readonly agentRankScore: number | null;
  readonly listedAt: string | null;
  readonly lastActiveAt: string | null;
  readonly profileHref: string;
  readonly linkedToken: PublicAgentLinkedToken | null;
  readonly linkedTokenChain: "solana" | "robinhood" | null;
  readonly linkedTokenVenue: "PumpSwap" | "Metaplex" | "Robinhood" | null;
  readonly market: TokenMarketSnapshot | null;
  readonly launchCreatedAt: string | null;
  readonly totalFeesDistributedLamports: string | null;
  readonly buyCount: number;
  readonly sellCount: number;
};
type AgentRow = Awaited<ReturnType<typeof loadPublicAgentsPreview>>[number];
export async function loadPublicAgentsIndex(limit = 500): Promise<PublicAgentIndexModel[]> {
  const agents = await loadPublicAgentsPreview(limit);
  if (agents.length === 0) return [];
  const robinhoodLaunches = await prisma.robinhoodChainLaunch.findMany({
    where: { agentDbId: { in: agents.map((agent) => agent.id) } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      agentDbId: true,
      tokenAddress: true,
      tokenName: true,
      tokenSymbol: true,
      createdAt: true,
    },
  });
  const robinhoodByAgent = new Map<number, (typeof robinhoodLaunches)[number]>();
  for (const launch of robinhoodLaunches) {
    if (launch.agentDbId != null) {
      getOrInsert(robinhoodByAgent, launch.agentDbId, launch);
    }
  }
  const launchIds = agents
    .map((agent) => pickPublicAgentLinkedTokenFromPreview(agent as PublicAgentPreview)?.launchId)
    .filter((id): id is string => Boolean(id));
  const [eventCounts, solanaMarketMap, robinhoodMarketMap] = await Promise.all([
    loadTradeEventCounts(launchIds),
    loadSolanaMarketMap(agents),
    getDexscreenerMarketsForAddresses(
      "robinhood",
      robinhoodLaunches.map((launch) => launch.tokenAddress),
    ),
  ]);
  return agents.map((agent) =>
    mapAgentRow(
      agent,
      robinhoodByAgent.get(agent.id) ?? null,
      eventCounts,
      solanaMarketMap,
      robinhoodMarketMap,
    ),
  );
}
async function loadTradeEventCounts(launchIds: readonly string[]) {
  if (launchIds.length === 0) return new Map<string, { buys: number; sells: number }>();
  const events = await prisma.agentLaunchEvent.findMany({
    where: { launchId: { in: [...launchIds] }, type: { in: [...TRADE_EVENT_TYPES] } },
    select: { launchId: true, type: true },
  });
  const counts = new Map<string, { buys: number; sells: number }>();
  for (const event of events) {
    const row = getOrInsertComputed(counts, event.launchId, () => ({ buys: 0, sells: 0 }));
    if (event.type === "test_buy_confirmed") row.buys += 1;
    if (event.type === "test_sell_confirmed") row.sells += 1;
  }
  return counts;
}
async function loadSolanaMarketMap(agents: readonly AgentRow[]) {
  const mints = agents
    .map((agent) => pickPublicAgentLinkedTokenFromPreview(agent as PublicAgentPreview)?.mint)
    .filter((mint): mint is string => Boolean(mint));
  if (mints.length === 0) return new Map<string, TokenMarketSnapshot>();
  return getDexscreenerMarketsForMints(mints);
}
function mapAgentRow(
  agent: AgentRow,
  robinhoodLaunch: {
    readonly id: string;
    readonly tokenAddress: string;
    readonly tokenName: string | null;
    readonly tokenSymbol: string | null;
    readonly createdAt: Date;
  } | null,
  eventCounts: ReadonlyMap<string, { buys: number; sells: number }>,
  solanaMarketMap: ReadonlyMap<string, TokenMarketSnapshot>,
  robinhoodMarketMap: ReadonlyMap<string, TokenMarketSnapshot>,
): PublicAgentIndexModel {
  const preview = agent as PublicAgentPreview;
  const solanaToken = pickPublicAgentLinkedTokenFromPreview(preview);
  const solanaLaunch = agent.agentLaunches[0] ?? null;
  const useRobinhood =
    robinhoodLaunch != null &&
    (solanaLaunch === null || robinhoodLaunch.createdAt > solanaLaunch.createdAt);
  let linkedToken: PublicAgentLinkedToken | null = solanaToken;
  let linkedTokenChain: "solana" | "robinhood" | null =
    solanaToken ? "solana" : null;
  let linkedTokenVenue: "PumpSwap" | "Metaplex" | "Robinhood" | null =
    solanaToken ? "PumpSwap" : null;
  const solanaLaunchKind = solanaLaunch?.launchKind ?? null;
  if (solanaToken && isMetaplexGenesisLaunch(solanaLaunchKind)) {
    linkedTokenVenue = "Metaplex";
  }
  if (useRobinhood) {
    linkedToken = {
      launchId: robinhoodLaunch.id,
      mint: robinhoodLaunch.tokenAddress,
      tokenName: robinhoodLaunch.tokenName,
      tokenSymbol: robinhoodLaunch.tokenSymbol,
      launchHref: `/tokens/robinhood/${robinhoodLaunch.tokenAddress}`,
    };
    linkedTokenChain = "robinhood";
    linkedTokenVenue = "Robinhood";
  }
  const counts =
    solanaToken
      ? (eventCounts.get(solanaToken.launchId) ?? { buys: 0, sells: 0 })
      : { buys: 0, sells: 0 };
  let market: TokenMarketSnapshot | null = null;
  if (linkedToken) {
    market = useRobinhood
      ? robinhoodMarketMap.get(linkedToken.mint) ?? null
      : solanaMarketMap.get(linkedToken.mint) ?? null;
  }
  const launchCreatedAt = useRobinhood
    ? robinhoodLaunch.createdAt.toISOString()
    : solanaLaunch?.createdAt?.toISOString() ?? null;
  const inherited = withInheritedAgentVerification({
    arVerificationStatus: agent.arVerificationStatus ?? null,
    publicVerificationStatus: agent.publicVerificationStatus,
    isVerified: agent.isVerified,
    isPremiumVerified: agent.isPremiumVerified,
    ownerAccount: preview.ownerAccount ?? null,
  });
  return {
    id: agent.id,
    agentId: agent.agentId,
    chainId: agent.chainId,
    name: agent.name,
    image: sanitizeAgentImageUrl(agent.image),
    description: agent.description,
    isVerified: inherited.isVerified,
    isPremiumVerified: inherited.isPremiumVerified,
    publicVerificationStatus: agent.publicVerificationStatus,
    arVerificationStatus: inherited.arVerificationStatus,
    ownerAccountVerified: inherited.ownerAccountVerified,
    credential: toPublicAgentCredential(preview.ownerAccount ?? null),
    isSolanaDirectoryListed: isAgentSolanaDirectoryListed(agent),
    agentRankScore: agent.agentRankScore ?? null,
    listedAt: agent.listedAt?.toISOString() ?? null,
    lastActiveAt: agent.lastActiveAt?.toISOString() ?? null,
    profileHref: agentPublicPath(agent),
    linkedToken,
    linkedTokenChain,
    linkedTokenVenue,
    market,
    launchCreatedAt,
    totalFeesDistributedLamports:
      solanaLaunch?.totalFeesDistributedLamports == null
        ? null
        : String(solanaLaunch.totalFeesDistributedLamports),
    buyCount: counts.buys,
    sellCount: counts.sells,
  };
}
