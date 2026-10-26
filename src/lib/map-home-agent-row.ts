import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { computeProtocolTrustScoreFromAgentDimensions } from "@/lib/agent-score";
import { computeTrustScore, trustSignalsFromMetadataAndAgent } from "@/lib/trust-score";
type RowIn = {
  chainId: number;
  agentId: number;
  name: string;
  isVerified?: boolean;
  isPremiumVerified?: boolean;
  stars?: number | null;
  totalFeedback?: number | null;
  createdAt?: Date | string;
  metadata?: Array<{ key: string; value: string }>;
  services?: Array<{ name: string; endpoint: string }>;
  // Optional dimension fields — when present we use computeProtocolTrustScoreFromAgentDimensions for consistency with agent page
  scoreMetadata?: number | null;
  scoreServices?: number | null;
  scoreWallet?: number | null;
  scoreQuality?: number | null;
  scorePopularity?: number | null;
  scoreFreshness?: number | null;
  activeBoosts?: number | null;
  adminPowerAdjust?: number | null;
  powerScore?: number | null;
  agentRankScore?: number | null;
  reputationScore?: number | null;
  // Compliance + social flags — used for accurate trust score matching the detail page
  x402Support?: boolean | null;
  binanceCompatible?: boolean | null;
  holderAgentPerks?: ReadonlyArray<{ id: string }> | null;
};
/** Current descriptive URL slug plus computed trust for home/cache payloads (metadata stripped from output).
 *  Uses computeProtocolTrustScoreFromAgentDimensions (dimension-based) when dimension fields are available,
 *  falling back to metadata-based computeTrustScore otherwise.
 */
export function mapHomeAgentRow<T extends RowIn>(
  row: T
): Omit<T, "metadata" | "holderAgentPerks"> & {
  slug: string;
  profilePath: string;
  protocolTrustScore: number;
  agentRankScore: number;
  reputationScore: number;
  hasHolderPowerBoost: boolean;
} {
  const { metadata, holderAgentPerks, ...rest } = row;
  const hasHolderPowerBoost = (holderAgentPerks?.length ?? 0) > 0;
  const hasDimensions = typeof rest.scoreMetadata === "number" && typeof rest.scoreServices === "number";
  const protocolTrustScore = hasDimensions
    ? computeProtocolTrustScoreFromAgentDimensions({
        scoreMetadata: rest.scoreMetadata,
        scoreServices: rest.scoreServices,
        scoreWallet: rest.scoreWallet,
        scoreQuality: rest.scoreQuality,
        scorePopularity: rest.scorePopularity,
        scoreFreshness: rest.scoreFreshness,
        // Pass compliance + social fields so list view matches the detail page
        x402Support: rest.x402Support,
        binanceCompatible: rest.binanceCompatible,
        metadata,
        services: rest.services,
      })
    : computeTrustScore(
        trustSignalsFromMetadataAndAgent({
          ...rest,
          stars: rest.stars ?? undefined,
          totalFeedback: rest.totalFeedback ?? undefined,
          metadata: metadata ?? [],
        })
      );
  const agentRankScore = Math.round(rest.agentRankScore ?? 0);
  const reputationScore = Math.round(
    rest.reputationScore ?? 0,
  );
  return {
    ...rest,
    slug: toAgentUrlSlug(row.name),
    profilePath: agentPublicPath(row),
    protocolTrustScore,
    agentRankScore,
    reputationScore,
    hasHolderPowerBoost,
  };
}
export function mapHomeAgentRows<T extends RowIn>(rows: T[]) {
  return rows.map(mapHomeAgentRow);
}
