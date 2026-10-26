import type { FairscaleAgentAssessment } from "@/generated/prisma/client";
import { resolveFairscaleFailureRetryMs } from "@/lib/fairscale/config";
import type {
  FairscaleAssessmentStatus,
  FairscalePublicAssessment,
} from "@/lib/fairscale/types";
type FairscaleRefreshRow = Pick<
  FairscaleAgentAssessment,
  "status" | "expiresAt" | "lastAttemptAt" | "lastError"
>;
/** Next time an assessment may hit FairScale again (null = refresh allowed now). */
export function fairscaleNextRefreshAt(
  row: FairscaleRefreshRow | null,
): Date | null {
  if (!row) return null;
  const expiry = row.expiresAt;
  const retryAt = row.lastError && row.lastAttemptAt
    ? new Date(row.lastAttemptAt.getTime() + resolveFairscaleFailureRetryMs())
    : null;
  if (!expiry) return retryAt;
  if (!retryAt) return expiry;
  return retryAt.getTime() > expiry.getTime() ? retryAt : expiry;
}
export function fairscaleRefreshAllowed(
  row: FairscaleRefreshRow | null,
): boolean {
  const next = fairscaleNextRefreshAt(row);
  return next === null || next.getTime() <= Date.now();
}
export function emptyFairscalePublicAssessment(
  status: FairscaleAssessmentStatus = "temporarily_unavailable",
): FairscalePublicAssessment {
  return {
    status,
    walletAddress: null,
    walletSource: null,
    score: null,
    tier: null,
    recommendationTier: null,
    recommendationLabel: null,
    pillars: null,
    signals: null,
    redFlags: null,
    badges: null,
    verifications: null,
    descriptionAlignment: null,
    provider: null,
    scoredAt: null,
    fetchedAt: null,
    expiresAt: null,
    nextRefreshAt: null,
    fromCache: false,
    stale: false,
  };
}
export function serializeFairscaleAssessment(
  row: FairscaleAgentAssessment | null,
  options?: { stale?: boolean },
): FairscalePublicAssessment {
  if (!row) {
    return emptyFairscalePublicAssessment("missing_wallet");
  }
  const now = Date.now();
  const expiresAtMs = row.expiresAt?.getTime() ?? 0;
  const stale =
    options?.stale === true ||
    (row.status === "scored" && expiresAtMs > 0 && expiresAtMs < now);
  const nextRefresh = fairscaleNextRefreshAt(row);
  return {
    status: row.status as FairscalePublicAssessment["status"],
    walletAddress: row.walletAddress,
    walletSource: row.walletSource as FairscalePublicAssessment["walletSource"],
    score: row.score,
    tier: row.tier,
    recommendationTier: row.recommendationTier,
    recommendationLabel: row.recommendationLabel,
    pillars: (row.pillars as FairscalePublicAssessment["pillars"]) ?? null,
    signals: row.signals ?? null,
    redFlags: row.redFlags ?? null,
    badges: row.badges ?? null,
    verifications: row.verifications ?? null,
    descriptionAlignment: row.descriptionAlignment ?? null,
    provider: row.provider,
    scoredAt: row.scoredAt?.toISOString() ?? null,
    fetchedAt: row.fetchedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    nextRefreshAt: nextRefresh?.toISOString() ?? null,
    fromCache: true,
    stale,
  };
}
