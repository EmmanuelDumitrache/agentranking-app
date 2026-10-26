import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { fetchFairscaleAssessmentScore } from "@/lib/fairscale/client.server";
import {
  fairscaleAutoRefreshEnabled,
  fairscaleEnabled,
  resolveFairscaleApiKey,
  resolveFairscaleCacheTtlMs,
  resolveFairscaleFailureRetryMs,
} from "@/lib/fairscale/config";
import { resolveFairscaleWalletForAgent } from "@/lib/fairscale/eligibility.server";
import { enqueueFairscaleAssessment } from "@/lib/fairscale/jobs";
import {
  resolveFairscaleRecommendationLabel,
  resolveFairscaleRecommendationTier,
} from "@/lib/fairscale/recommendation";
import { serializeFairscaleAssessment } from "@/lib/fairscale/serialize";
import { normalizeFairscaleScore } from "@/lib/fairscale/score";
import type { FairscaleAssessmentStatus, FairscalePublicAssessment, FairscaleScoreResponse } from "@/lib/fairscale/types";
import { sanitizeBoundedJson } from "@/lib/inference-providers/validation";
function jsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return sanitizeBoundedJson(value) as Prisma.InputJsonValue;
}
function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function scoreRow(agentDbId: number, walletAddress: string, walletSource: string | null, data: FairscaleScoreResponse) {
  const score = normalizeFairscaleScore(data.score);
  const now = new Date();
  return {
    agentId: agentDbId,
    walletAddress,
    walletSource,
    status: score === null ? "temporarily_unavailable" : "scored",
    score,
    tier: data.tier?.trim().slice(0, 100) || null,
    recommendationTier: resolveFairscaleRecommendationTier({ recommendation: data.recommendation, tier: data.tier }),
    recommendationLabel: resolveFairscaleRecommendationLabel({ recommendation: data.recommendation, score }),
    pillars: jsonValue(data.pillars),
    signals: jsonValue(data.signals),
    redFlags: jsonValue(data.red_flags),
    badges: jsonValue(data.badges),
    verifications: jsonValue(data.verifications),
    descriptionAlignment: jsonValue(data.description_alignment),
    provider: data.meta?.provider?.trim().slice(0, 200) || "FairScale",
    scoredAt: parseDate(data.meta?.scored_at),
    fetchedAt: now,
    lastAttemptAt: now,
    expiresAt: new Date(
      now.getTime() + (score === null ? resolveFairscaleFailureRetryMs() : resolveFairscaleCacheTtlMs()),
    ),
    lastError: score === null ? data.error?.trim().slice(0, 2_000) || "No FairScale score returned" : null,
  };
}
async function recordUnavailable(input: {
  agentDbId: number;
  status: FairscaleAssessmentStatus;
  walletAddress: string | null;
  walletSource: string | null;
  error: string | null;
  preserveScore?: boolean;
}): Promise<void> {
  const now = new Date();
  const existing = await prisma.fairscaleAgentAssessment.findUnique({ where: { agentId: input.agentDbId } });
  if (
    input.preserveScore
    && existing?.status === "scored"
    && existing.walletAddress === input.walletAddress
  ) {
    await prisma.fairscaleAgentAssessment.update({
      where: { agentId: input.agentDbId },
      data: { lastAttemptAt: now, lastError: input.error?.slice(0, 2_000) ?? null },
    });
    return;
  }
  const unavailable = {
    walletAddress: input.walletAddress,
    walletSource: input.walletSource,
    status: input.status,
    score: null,
    tier: null,
    recommendationTier: null,
    recommendationLabel: null,
    pillars: Prisma.JsonNull,
    signals: Prisma.JsonNull,
    redFlags: Prisma.JsonNull,
    badges: Prisma.JsonNull,
    verifications: Prisma.JsonNull,
    descriptionAlignment: Prisma.JsonNull,
    provider: null,
    scoredAt: null,
    fetchedAt: null,
    lastAttemptAt: now,
    lastError: input.error?.slice(0, 2_000) ?? null,
    expiresAt: new Date(now.getTime() + resolveFairscaleFailureRetryMs()),
  };
  await prisma.fairscaleAgentAssessment.upsert({
    where: { agentId: input.agentDbId },
    create: { agentId: input.agentDbId, ...unavailable },
    update: unavailable,
  });
}
export async function assessFairscaleAgent(agentDbId: number): Promise<{ status: string }> {
  if (!fairscaleEnabled()) return { status: "disabled" };
  const resolution = await resolveFairscaleWalletForAgent(agentDbId);
  if (resolution.status !== "pending" || !resolution.walletAddress) {
    await recordUnavailable({
      agentDbId,
      status: resolution.status,
      walletAddress: resolution.walletAddress,
      walletSource: resolution.walletSource,
      error: null,
    });
    return { status: resolution.status };
  }
  if (!resolveFairscaleApiKey()) throw new Error("FAIRSCALE_API_KEY is not configured");
  const result = await fetchFairscaleAssessmentScore(resolution.walletAddress);
  if (!result.ok) {
    await recordUnavailable({
      agentDbId,
      status: "temporarily_unavailable",
      walletAddress: resolution.walletAddress,
      walletSource: resolution.walletSource,
      error: result.error.message,
      preserveScore: true,
    });
    if (result.error.retryable) throw result.error;
    return { status: "temporarily_unavailable" };
  }
  const row = scoreRow(agentDbId, resolution.walletAddress, resolution.walletSource, result.data);
  await prisma.fairscaleAgentAssessment.upsert({ where: { agentId: agentDbId }, create: row, update: row });
  return { status: row.status };
}
function retryCooldownActive(row: {
  lastAttemptAt: Date | null;
  lastError: string | null;
  status: string;
} | null): boolean {
  if (!row || (row.status === "scored" && !row.lastError)) return false;
  return Boolean(
    row.lastAttemptAt
    && row.lastAttemptAt.getTime() + resolveFairscaleFailureRetryMs() > Date.now(),
  );
}
export async function refreshFairscaleAssessmentForAgent(agentDbId: number): Promise<{
  assessment: FairscalePublicAssessment;
  enqueued: boolean;
  cooldown: boolean;
}> {
  const [existing, resolution] = await Promise.all([
    prisma.fairscaleAgentAssessment.findUnique({ where: { agentId: agentDbId } }),
    resolveFairscaleWalletForAgent(agentDbId),
  ]);
  const sameWallet = Boolean(
    existing
    && resolution.walletAddress
    && existing.walletAddress === resolution.walletAddress,
  );
  const fresh = Boolean(
    sameWallet
    && existing?.expiresAt
    && existing.expiresAt.getTime() > Date.now()
    && existing.status === "scored",
  );
  const cooldown = sameWallet && (fresh || retryCooldownActive(existing));
  let enqueued = false;
  if (
    !cooldown
    && resolution.status === "pending"
    && resolution.walletAddress
    && fairscaleEnabled()
    && resolveFairscaleApiKey()
  ) {
    enqueued = Boolean(await enqueueFairscaleAssessment(agentDbId));
  }
  return {
    assessment: await getFairscaleAssessmentForAgent(agentDbId, { queueRefresh: false }),
    enqueued,
    cooldown,
  };
}
export async function getFairscaleAssessmentForAgent(
  agentDbId: number,
  options?: { queueRefresh?: boolean },
): Promise<FairscalePublicAssessment> {
  const [row, resolution] = await Promise.all([
    prisma.fairscaleAgentAssessment.findUnique({ where: { agentId: agentDbId } }),
    resolveFairscaleWalletForAgent(agentDbId),
  ]);
  const resolutionChanged = Boolean(
    row
    && (
      row.walletAddress !== resolution.walletAddress
      || (
        row.walletAddress === null
        && resolution.walletAddress === null
        && row.status !== resolution.status
      )
    ),
  );
  const stale = Boolean(
    !row
    || !row.expiresAt
    || row.expiresAt.getTime() <= Date.now()
    || resolutionChanged,
  );
  const allowQueue = options?.queueRefresh === true
    || (options?.queueRefresh !== false && fairscaleAutoRefreshEnabled());
  if (allowQueue && stale && fairscaleEnabled() && resolveFairscaleApiKey()
      && resolution.status === "pending"
      && (resolutionChanged || !retryCooldownActive(row))) {
    try {
      await enqueueFairscaleAssessment(agentDbId);
    } catch (error) {
      console.warn("[fairscale] could not enqueue stale assessment refresh", {
        agentDbId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (row && !resolutionChanged) return serializeFairscaleAssessment(row, { stale });
  return {
    ...serializeFairscaleAssessment(null),
    status: resolution.status === "pending" ? "pending" : resolution.status,
    walletAddress: resolution.walletAddress,
    walletSource: resolution.walletSource,
    stale: true,
  };
}
