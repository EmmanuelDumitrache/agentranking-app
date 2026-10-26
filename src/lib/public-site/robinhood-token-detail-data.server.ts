import "server-only";
import { getRobinhoodLaunchByAddress } from "@/lib/robinhood-chain/record-launch.server";
import type { RobinhoodLaunchRecord } from "@/lib/robinhood-chain/types";
import {
  ROBINHOOD_AR_FEE_BPS,
  ROBINHOOD_CREATOR_FEE_BPS,
} from "@/lib/robinhood-chain/fee-splitter";
import { robinhoodTokenImageUrl } from "@/lib/robinhood-chain/resolve-token-image";
import { loadRobinhoodGraduationMetrics } from "@/lib/robinhood-chain/robinhood-graduation.server";
import { readRobinhoodTokenOnChain } from "@/lib/robinhood-chain/verify-launch.server";
import { loadLaunchLinkedAgentSummariesByDbId } from "@/lib/agent-launch/linked-agent";
import type { LaunchLinkedAgentSummary } from "@/lib/agent-launch/linked-agent";
import { getDexscreenerMarketForRobinhoodToken } from "@/lib/public-site/dexscreener";
import {
  resolveRobinhoodMarketViewModel,
  type PublicTokenMarketViewModel,
} from "@/lib/public-site/market-view-model";
export type RobinhoodPublicTokenDetailData = {
  launch: RobinhoodLaunchRecord;
  imageUrl: string | null;
  linkedAgent: LaunchLinkedAgentSummary | null;
  marketView: PublicTokenMarketViewModel;
  creatorFeeBps: number;
  arFeeBps: number;
};
export async function loadRobinhoodPublicTokenDetailData(
  address: string,
): Promise<RobinhoodPublicTokenDetailData | null> {
  const launch = await getRobinhoodLaunchByAddress(address);
  if (!launch) return null;
  const [market, graduationMetrics, linkedAgentMap, onChain] = await Promise.all([
    getDexscreenerMarketForRobinhoodToken(launch.tokenAddress),
    loadRobinhoodGraduationMetrics({
      tokenAddress: launch.tokenAddress,
      poolAddress: launch.poolAddress,
    }).catch(() => null),
    launch.agentDbId != null
      ? loadLaunchLinkedAgentSummariesByDbId([launch.agentDbId])
      : Promise.resolve(new Map<number, LaunchLinkedAgentSummary>()),
    readRobinhoodTokenOnChain(launch.tokenAddress),
  ]);
  const linkedAgent =
    launch.agentDbId != null ? linkedAgentMap.get(launch.agentDbId) ?? null : null;
  const imageUrl = robinhoodTokenImageUrl({
    tokenLogoGatewayUrl: launch.tokenLogoGatewayUrl,
    tokenLogoIpfsUri: launch.tokenLogoIpfsUri,
    tokenImageOriginalUrl: launch.tokenImageOriginalUrl,
    tokenImageUrl: launch.tokenImageUrl,
    agentImage: linkedAgent?.image,
    tokenName: launch.tokenName,
    tokenSymbol: launch.tokenSymbol,
  });
  const marketView = resolveRobinhoodMarketViewModel({
    tokenAddress: launch.tokenAddress,
    poolAddress: launch.poolAddress,
    market,
    graduationMetrics,
  });
  const splitEnabled = onChain.creatorRecipient
    ? onChain.creatorRecipient.toLowerCase() !== launch.creatorWallet.toLowerCase()
    : Boolean(launch.feeSplitterAddress);
  return {
    launch,
    imageUrl,
    linkedAgent,
    marketView,
    creatorFeeBps: splitEnabled ? ROBINHOOD_CREATOR_FEE_BPS : 10_000,
    arFeeBps: splitEnabled ? ROBINHOOD_AR_FEE_BPS : 0,
  };
}
