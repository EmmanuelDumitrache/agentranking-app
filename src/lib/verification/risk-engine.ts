import type { RiskTier } from "./providers/types";
import {
  getSanctionsScreener,
  type SanctionsScreenResult,
} from "./screening";

/** Bump when scoring weights or tier boundaries change — stored on RiskAssessment. */
export const ASSESSOR_VERSION = "1.0.0";

export type RiskFactorKey =
  | "ownershipProven"
  | "onchainAgeDays"
  | "transactionHistory"
  | "counterpartyDiversity"
  | "endpointLiveness"
  | "capabilityDeclaration"
  | "sanctionsScreening"
  | "platformReputation";

export interface RiskFactorBreakdown {
  ownershipProven: { points: number; max: 25; proven: boolean };
  onchainAgeDays: { points: number; max: 15; days: number };
  transactionHistory: { points: number; max: 15; txCount: number; volumeUsd: number };
  counterpartyDiversity: { points: number; max: 10; uniqueCounterparties: number };
  endpointLiveness: { points: number; max: 10; alive: boolean };
  capabilityDeclaration: { points: number; max: 10; consistent: boolean };
  sanctionsScreening: {
    points: number;
    max: 10;
    clean: boolean;
    hardFail: boolean;
    hitCount: number;
  };
  platformReputation: { points: number; max: 5; reputationScore: number };
}

export interface RiskEngineInput {
  ownershipProven: boolean;
  onchainAgeDays: number;
  txCount: number;
  volumeUsd: number;
  uniqueCounterparties: number;
  endpointAlive: boolean;
  capabilityConsistent: boolean;
  walletAddresses: string[];
  platformReputationScore: number; // 0–100 existing AgentRanking score
  /** Optional precomputed sanctions result (tests / cron). */
  sanctionsResult?: SanctionsScreenResult;
}

export interface RiskEngineResult {
  score: number;
  tier: RiskTier;
  factors: RiskFactorBreakdown;
  assessorVersion: string;
  hardFail: boolean;
}

export function scoreOnchainAgeDays(days: number): number {
  if (days >= 365) return 15;
  if (days >= 90) return 10;
  if (days >= 30) return 5;
  return 0;
}

/** Log-scale blend of count + volume into 0–15. */
export function scoreTransactionHistory(txCount: number, volumeUsd: number): number {
  const countScore = Math.min(10, Math.log10(Math.max(txCount, 0) + 1) * 4);
  const volumeScore = Math.min(5, Math.log10(Math.max(volumeUsd, 0) + 1) * 1.2);
  return Math.min(15, Math.round(countScore + volumeScore));
}

export function scoreCounterpartyDiversity(uniqueCounterparties: number): number {
  if (uniqueCounterparties <= 0) return 0;
  if (uniqueCounterparties >= 50) return 10;
  if (uniqueCounterparties >= 20) return 8;
  if (uniqueCounterparties >= 10) return 6;
  if (uniqueCounterparties >= 5) return 4;
  return 2;
}

export function scorePlatformReputation(reputationScore: number): number {
  const clamped = Math.max(0, Math.min(100, reputationScore));
  return Math.round((clamped / 100) * 5);
}

export function tierFromScore(score: number): RiskTier {
  if (score >= 80) return "PRIVILEGED";
  if (score >= 60) return "ELEVATED";
  if (score >= 40) return "STANDARD";
  if (score >= 20) return "BASIC";
  return "UNRATED";
}

export function publicFactorSummary(factors: RiskFactorBreakdown): Record<
  RiskFactorKey,
  { points: number; max: number }
> {
  return {
    ownershipProven: { points: factors.ownershipProven.points, max: factors.ownershipProven.max },
    onchainAgeDays: { points: factors.onchainAgeDays.points, max: factors.onchainAgeDays.max },
    transactionHistory: {
      points: factors.transactionHistory.points,
      max: factors.transactionHistory.max,
    },
    counterpartyDiversity: {
      points: factors.counterpartyDiversity.points,
      max: factors.counterpartyDiversity.max,
    },
    endpointLiveness: {
      points: factors.endpointLiveness.points,
      max: factors.endpointLiveness.max,
    },
    capabilityDeclaration: {
      points: factors.capabilityDeclaration.points,
      max: factors.capabilityDeclaration.max,
    },
    sanctionsScreening: {
      points: factors.sanctionsScreening.points,
      max: factors.sanctionsScreening.max,
    },
    platformReputation: {
      points: factors.platformReputation.points,
      max: factors.platformReputation.max,
    },
  };
}

export async function computeRiskScore(input: RiskEngineInput): Promise<RiskEngineResult> {
  const screener = getSanctionsScreener();
  const sanctions =
    input.sanctionsResult ?? (await screener.screenAddresses(input.walletAddresses));

  const hardFail = !sanctions.clean;
  if (hardFail) {
    const factors: RiskFactorBreakdown = {
      ownershipProven: { points: 0, max: 25, proven: input.ownershipProven },
      onchainAgeDays: { points: 0, max: 15, days: input.onchainAgeDays },
      transactionHistory: {
        points: 0,
        max: 15,
        txCount: input.txCount,
        volumeUsd: input.volumeUsd,
      },
      counterpartyDiversity: {
        points: 0,
        max: 10,
        uniqueCounterparties: input.uniqueCounterparties,
      },
      endpointLiveness: { points: 0, max: 10, alive: input.endpointAlive },
      capabilityDeclaration: { points: 0, max: 10, consistent: input.capabilityConsistent },
      sanctionsScreening: {
        points: 0,
        max: 10,
        clean: false,
        hardFail: true,
        hitCount: sanctions.hits.length,
      },
      platformReputation: {
        points: 0,
        max: 5,
        reputationScore: input.platformReputationScore,
      },
    };
    return {
      score: 0,
      tier: "UNRATED",
      factors,
      assessorVersion: ASSESSOR_VERSION,
      hardFail: true,
    };
  }

  const factors: RiskFactorBreakdown = {
    ownershipProven: {
      points: input.ownershipProven ? 25 : 0,
      max: 25,
      proven: input.ownershipProven,
    },
    onchainAgeDays: {
      points: scoreOnchainAgeDays(input.onchainAgeDays),
      max: 15,
      days: input.onchainAgeDays,
    },
    transactionHistory: {
      points: scoreTransactionHistory(input.txCount, input.volumeUsd),
      max: 15,
      txCount: input.txCount,
      volumeUsd: input.volumeUsd,
    },
    counterpartyDiversity: {
      points: scoreCounterpartyDiversity(input.uniqueCounterparties),
      max: 10,
      uniqueCounterparties: input.uniqueCounterparties,
    },
    endpointLiveness: {
      points: input.endpointAlive ? 10 : 0,
      max: 10,
      alive: input.endpointAlive,
    },
    capabilityDeclaration: {
      points: input.capabilityConsistent ? 10 : 0,
      max: 10,
      consistent: input.capabilityConsistent,
    },
    sanctionsScreening: {
      points: 10,
      max: 10,
      clean: true,
      hardFail: false,
      hitCount: 0,
    },
    platformReputation: {
      points: scorePlatformReputation(input.platformReputationScore),
      max: 5,
      reputationScore: input.platformReputationScore,
    },
  };

  const score = Math.min(
    100,
    Object.values(factors).reduce((sum, f) => sum + f.points, 0),
  );

  return {
    score,
    tier: tierFromScore(score),
    factors,
    assessorVersion: ASSESSOR_VERSION,
    hardFail: false,
  };
}
