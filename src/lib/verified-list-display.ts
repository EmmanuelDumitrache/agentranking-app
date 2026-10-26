import type { VerifiedAgentListItem } from "@/components/verified/types";
export function verifiedListArScore(agent: VerifiedAgentListItem): number {
  const raw = agent.agentRankScore ?? 0;
  return Math.round(Number(raw) || 0);
}
export function verifiedListX402Label(agent: VerifiedAgentListItem): string {
  if (agent.x402Payable) return "Payable";
  if (agent.x402Detected) return "Detected";
  if (agent.x402Support) return "On";
  return "Not detected";
}
export function verifiedListDevProofLabel(agent: VerifiedAgentListItem): string {
  if (agent.devProofActive || agent.githubConnected) return "Active";
  return "Not connected";
}
export function verifiedListLastUpdated(agent: VerifiedAgentListItem): string | null {
  const raw = agent.lastActiveAt ?? agent.listedAt;
  if (!raw) return null;
  return raw;
}
