import { agentProtocolLabel } from "@/lib/agent-rankable";
import { getAgentListStatusBadges } from "@/lib/agent-list-status-badges";
import {
  homeArScore,
  homeArScoreIsEmpty,
  homeOrganicRankLabel,
  homeTrustDisplayLabel,
  type HomeDiscoveryAgent,
} from "@/lib/home-discovery-display";
import type { MiniAgent } from "@/components/home/home-types";
import type { ScannerAgentRow } from "@/components/scanner/types";
export function buildScannerAgentRow(
  agent: MiniAgent,
  options?: { pageRank?: number },
): ScannerAgentRow {
  const href = agent.profilePath;
  const rank =
    options?.pageRank != null && options.pageRank > 0
      ? {
          label: `#${options.pageRank}`,
          title: `Rank #${options.pageRank} in this index`,
          compact: false,
        }
      : homeOrganicRankLabel(agent as HomeDiscoveryAgent);
  const badges = getAgentListStatusBadges(agent, { variant: "home" }).slice(0, 3);
  const protocolLabel = agentProtocolLabel(agent);
  const verified = !!(agent.isVerified || agent.isPremiumVerified);
  const chainName = agent.chain.shortName;
  const metaParts = [protocolLabel, chainName];
  if (verified) metaParts.push("Verified");
  return {
    id: agent.id,
    href,
    name: agent.name,
    image: agent.image,
    isPremiumVerified: !!agent.isPremiumVerified,
    isVerified: verified,
    chainId: agent.chainId,
    chain: agent.chain,
    deploymentCount: agent.deploymentCount,
    chainLogoStack: agent.chainLogoStack,
    protocolLabel,
    rankLabel: rank.label,
    rankTitle: rank.title,
    rankCompact: !!rank.compact,
    ar: homeArScore(agent as HomeDiscoveryAgent),
    arEmpty: homeArScoreIsEmpty(agent as HomeDiscoveryAgent),
    trustLabel: homeTrustDisplayLabel(agent as HomeDiscoveryAgent),
    reputation: Math.round(agent.reputationScore ?? 0),
    reviews: agent.totalFeedback ?? 0,
    age: agent.listedAt ?? agent.createdAt,
    lastSeen: agent.lastActiveAt ?? agent.listedAt ?? agent.createdAt,
    statusBadgeIds: badges.map((b) => b.id),
    statusLabels: badges.map((b) => b.label),
    metaLine: metaParts.join(" · "),
  };
}
export function scannerArScoreClass(score: number, empty: boolean): string {
  if (empty) return "text-[var(--ar-text-muted)] opacity-50";
  if (score >= 80) return "text-[var(--ar-text-primary)]";
  if (score >= 60) return "text-[var(--ar-success)]";
  if (score >= 40) return "text-[var(--ar-text-secondary)]";
  return "text-[var(--ar-text-tertiary)]";
}
export function scannerTrustClass(label: ScannerAgentRow["trustLabel"]): string {
  if (label === "Verified") return "scanner-trust-verified";
  if (label === "High") return "text-[var(--ar-success)] opacity-90";
  if (label === "Medium") return "text-[var(--ar-text-secondary)]";
  return "text-[var(--ar-text-muted)]";
}
