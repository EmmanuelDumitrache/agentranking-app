import "server-only";
import type { MetaplexLaunchAttempt } from "@/generated/prisma/client";
import {
  METAPLEX_LAUNCH_DEPOSIT_LAMPORTS,
  METAPLEX_LAUNCH_TERMINAL_STATUSES,
  type MetaplexLaunchAttemptStatus,
} from "@/lib/metaplex-launch/constants";
import { isValidIrysGatewayUrl, normalizeIrysGatewayUrl } from "@/lib/metaplex-launch/validation";
export type MetaplexFundingAttemptFields = Pick<
  MetaplexLaunchAttempt,
  "status" | "tokenMint" | "genesisAddress" | "assetAddress" | "imageUri"
> & {
  genesisTxSignatures?: MetaplexLaunchAttempt["genesisTxSignatures"] | null;
};
/** Lamport estimates tuned from mainnet SOLCAT shortfall (Genesis ~0.054 after agent mint). */
export const METAPLEX_PIPELINE_ESTIMATES = {
  irysUpload: 2_000_000,
  agentMint: 5_000_000,
  genesisLaunch: 54_000_000,
  safetyBuffer: 20_000_000,
  indexRetry: 1_000_000,
} as const;
/** Upfront deposit for a fresh launch (Irys + agent + Genesis + buffer). */
export const PUBLIC_METAPLEX_MIN_SOL_LAMPORTS = METAPLEX_LAUNCH_DEPOSIT_LAMPORTS;
export type MetaplexFundingStage =
  | "initial"
  | "post_irys"
  | "post_agent"
  | "post_genesis"
  | "complete";
export type MetaplexFundingQuote = {
  stage: MetaplexFundingStage;
  minLamports: number;
  balanceLamports: number;
  shortfallLamports: number;
  funded: boolean;
  fundingMessage: string;
};
function formatSol(lamports: number): string {
  const sol = lamports / 1_000_000_000;
  if (sol >= 0.1) return sol.toFixed(2);
  if (sol >= 0.01) return sol.toFixed(3);
  return sol.toFixed(4);
}
function hasGenesisTxSignatures(raw: unknown): boolean {
  if (Array.isArray(raw)) return raw.some((v) => typeof v === "string" && v.trim().length > 0);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return hasGenesisTxSignatures(parsed);
    } catch {
      return raw.trim().length > 0;
    }
  }
  return false;
}
/**
 * Genesis address alone is not enough — createLaunch can persist a PDA before
 * sign+send. Until signatures (or token mint) exist, still require Genesis SOL.
 */
export function resolveMetaplexFundingStage(attempt: MetaplexFundingAttemptFields): MetaplexFundingStage {
  const status = attempt.status as MetaplexLaunchAttemptStatus;
  if (status === "COMPLETE") return "complete";
  if (
    attempt.tokenMint?.trim() &&
    ["GENESIS_ONCHAIN_CONFIRMED", "GENESIS_REGISTERED", "AR_INDEX_PENDING"].includes(status)
  ) {
    return "post_genesis";
  }
  if (
    attempt.genesisAddress?.trim() &&
    hasGenesisTxSignatures(attempt.genesisTxSignatures) &&
    (status === "GENESIS_REGISTERED" ||
      status === "GENESIS_ONCHAIN_CONFIRMED" ||
      status === "AR_INDEX_PENDING")
  ) {
    return "post_genesis";
  }
  if (
    status === "GENESIS_SUBMITTED" ||
    status === "GENESIS_PREPARED" ||
    status === "AGENT_REGISTERED" ||
    status === "FAILED_RECOVERABLE" ||
    attempt.assetAddress?.trim()
  ) {
    return "post_agent";
  }
  const imageUri = normalizeIrysGatewayUrl(attempt.imageUri ?? "") ?? attempt.imageUri?.trim() ?? "";
  if (isValidIrysGatewayUrl(imageUri)) return "post_irys";
  return "initial";
}
export function requiredLamportsForMetaplexStage(stage: MetaplexFundingStage): number {
  const { irysUpload, agentMint, genesisLaunch, safetyBuffer, indexRetry } =
    METAPLEX_PIPELINE_ESTIMATES;
  switch (stage) {
    case "initial":
      return irysUpload + agentMint + genesisLaunch + safetyBuffer;
    case "post_irys":
      return agentMint + genesisLaunch + safetyBuffer;
    case "post_agent":
      return genesisLaunch + Math.floor(safetyBuffer / 2);
    case "post_genesis":
      return indexRetry;
    case "complete":
      return 0;
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}
export function buildMetaplexFundingQuote(input: {
  attempt: MetaplexFundingAttemptFields;
  balanceLamports: number;
}): MetaplexFundingQuote {
  const stage = resolveMetaplexFundingStage(input.attempt);
  const minLamports = requiredLamportsForMetaplexStage(stage);
  const shortfallLamports = Math.max(0, minLamports - input.balanceLamports);
  const funded = shortfallLamports === 0;
  let fundingMessage: string;
  if (funded) {
    fundingMessage = "Launch wallet is funded — ready to mint.";
  } else if (stage === "post_agent") {
    fundingMessage = `Send ${formatSol(shortfallLamports)} SOL to finish Genesis token mint.`;
  } else if (stage === "post_irys") {
    fundingMessage = `Send ${formatSol(shortfallLamports)} SOL to complete agent mint and Genesis.`;
  } else {
    fundingMessage = `Send ${formatSol(shortfallLamports)} SOL to finish token launch.`;
  }
  return {
    stage,
    minLamports,
    balanceLamports: input.balanceLamports,
    shortfallLamports,
    funded,
    fundingMessage,
  };
}
export function isRecoverableMetaplexAttemptStatus(status: string): boolean {
  return !METAPLEX_LAUNCH_TERMINAL_STATUSES.has(status as MetaplexLaunchAttemptStatus);
}
