import {
  pickPublicAgentLinkedToken,
  type PublicAgentLinkedToken,
} from "@/lib/public-agent-token";
import type { OwnerAccountVerificationFields } from "@/lib/public-site/agent-verification";
/** Client-safe preview row for native AgentRanking agents (matches server select). */
export type PublicAgentPreview = {
  readonly id: number;
  readonly agentId: number;
  readonly chainId: number;
  readonly name: string;
  readonly image: string;
  readonly description: string;
  readonly score?: number | null;
  readonly agentRankScore?: number | null;
  readonly isVerified: boolean;
  readonly isPremiumVerified: boolean;
  readonly publicVerificationStatus: string;
  readonly arVerificationStatus?: string | null;
  readonly ownerAccount?: OwnerAccountVerificationFields | null;
  readonly lastActiveAt?: Date | string | null;
  readonly listedAt?: Date | string | null;
  readonly tokenAddress: string | null;
  readonly metaplexAgentTokenMint: string | null;
  readonly metadata?: ReadonlyArray<{ readonly key: string; readonly value: string }>;
  readonly agentLaunches: ReadonlyArray<{
    readonly id: string;
    readonly mint: string | null;
    readonly tokenSymbol: string | null;
    readonly tokenName: string | null;
    readonly launchKind?: string | null;
    readonly launchStatus: string;
    readonly feeSharingStatus: string;
    readonly profileWebsite?: string | null;
    readonly profileTwitter?: string | null;
    readonly profileTelegram?: string | null;
  }>;
};
export function pickPublicAgentLinkedTokenFromPreview(
  agent: PublicAgentPreview,
): PublicAgentLinkedToken | null {
  return pickPublicAgentLinkedToken(agent.agentLaunches);
}
export function isPublicAgentTokenized(agent: PublicAgentPreview): boolean {
  const linked = pickPublicAgentLinkedTokenFromPreview(agent);
  return Boolean(linked || agent.tokenAddress || agent.metaplexAgentTokenMint);
}
export function socialsFromPublicAgentPreview(agent: PublicAgentPreview): {
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
} {
  const meta = new Map(
    (agent.metadata ?? []).map((entry) => [entry.key.toLowerCase(), entry.value] as const),
  );
  const launch = agent.agentLaunches[0];
  return {
    twitter:
      launch?.profileTwitter ||
      meta.get("twitter") ||
      meta.get("twitterurl") ||
      null,
    telegram:
      launch?.profileTelegram ||
      meta.get("telegram") ||
      meta.get("telegramurl") ||
      null,
    website:
      launch?.profileWebsite ||
      meta.get("website") ||
      meta.get("websiteurl") ||
      null,
  };
}
