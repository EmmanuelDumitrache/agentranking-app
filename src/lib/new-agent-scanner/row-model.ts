import { agentProtocolLabel } from "@/lib/agent-rankable";
import { getAgentListStatusBadges } from "@/lib/agent-list-status-badges";
import {
  homeArScore,
  homeArScoreIsEmpty,
  homeTrustDisplayLabel,
  type HomeDiscoveryAgent,
} from "@/lib/home-discovery-display";
import { countCapabilities } from "@/lib/new-agent-scanner/filters";
import { newAgentSourceLabel } from "@/lib/new-agent-scanner/source-label";
import type { NewAgentScannerAgent, NewAgentScannerRow } from "@/lib/new-agent-scanner/types";
function primaryStatus(agent: NewAgentScannerAgent, badges: ReturnType<typeof getAgentListStatusBadges>): string {
  if (agent.isPremiumVerified || agent.isVerified) return "Verified";
  if (agent.metaplexAgentTokenMint?.trim()) return "Tokenized";
  if (agent.isClaimed === false) return "Claimable";
  const live = badges.find((b) => b.id === "mcp" || b.id === "x402" || b.id === "sap");
  if (live) return "Live";
  return "New";
}
export function buildNewAgentScannerRow(
  agent: NewAgentScannerAgent,
  rank: number,
): NewAgentScannerRow {
  const href = agent.profilePath;
  const badges = getAgentListStatusBadges(agent, { variant: "home" });
  const protocolLabel = agentProtocolLabel(agent);
  const sourceLabel = newAgentSourceLabel(agent);
  const chainName = agent.chain.shortName;
  const verified = !!(agent.isVerified || agent.isPremiumVerified);
  const signalPills = badges.slice(0, 4).map((b) => ({ id: b.id, label: b.label }));
  const metaParts = [sourceLabel, chainName, protocolLabel];
  if (verified) metaParts.push("Verified");
  if (agent.metaplexAgentTokenMint?.trim()) metaParts.push("Tokenized");
  return {
    id: agent.id,
    href,
    rank,
    name: agent.name,
    image: agent.image,
    isPremiumVerified: !!agent.isPremiumVerified,
    isVerified: verified,
    chainId: agent.chainId,
    chain: agent.chain,
    deploymentCount: agent.deploymentCount,
    chainLogoStack: agent.chainLogoStack,
    sourceLabel,
    protocolLabel,
    statusLabel: primaryStatus(agent, badges),
    statusBadgeIds: badges.map((b) => b.id),
    signalPills,
    metaLine: metaParts.join(" · "),
    ar: homeArScore(agent as HomeDiscoveryAgent),
    arEmpty: homeArScoreIsEmpty(agent as HomeDiscoveryAgent),
    trustLabel: homeTrustDisplayLabel(agent as HomeDiscoveryAgent),
    capsCount: countCapabilities(agent),
    capsLabels: badges.slice(0, 3).map((b) => b.label),
    age: agent.listedAt ?? agent.createdAt,
    updated: agent.lastActiveAt ?? agent.listedAt ?? agent.createdAt,
    hasToken: !!agent.metaplexAgentTokenMint?.trim(),
  };
}
export function scannerArTone(score: number, empty: boolean): string {
  if (empty) return "text-[var(--ar-text-muted)] opacity-50";
  if (score >= 80) return "text-[var(--ar-text-primary)]";
  if (score >= 60) return "text-[var(--ar-success)]";
  if (score >= 40) return "text-[var(--ar-text-secondary)]";
  return "text-[var(--ar-text-tertiary)]";
}
export function scannerTrustTone(label: NewAgentScannerRow["trustLabel"]): string {
  if (label === "Verified") return "text-[var(--ar-success)]";
  if (label === "High") return "text-[var(--ar-success)] opacity-90";
  if (label === "Medium") return "text-[var(--ar-text-secondary)]";
  return "text-[var(--ar-text-muted)]";
}
