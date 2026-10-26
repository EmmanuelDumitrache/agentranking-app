import { BPS_TOTAL } from "@/lib/agent-launch/constants";
import { parseAgentLaunchNetwork } from "@/lib/agent-launch/network";
import { resolveArOpsWallet } from "@/lib/ar-token-public";
import { trySolanaPublicKey } from "@/lib/ar-token-ledger";
/** Default creator share of Pump creator fees (70%). */
export const AGENTRANKING_CREATOR_SHARE_BPS = 7000;
/** Default AgentRanking platform share of Pump creator fees (30%). */
export const AGENTRANKING_PLATFORM_SHARE_BPS = 3000;
/** Native agent creation — no AgentRanking charge (MVP). */
export const AGENT_CREATION_FEE_SOL = 0;
/** One-time AgentRanking platform fee at token launch (MVP default: free). */
export const TOKEN_LAUNCH_PLATFORM_FEE_SOL = 0;
/**
 * Minimum optional initial buy bundled into Pump create.
 * Zero is supported — backend uses createV2 without buy when lamports are 0.
 */
export const DEFAULT_INITIAL_BUY_SOL = 0;
const LAMPORTS_PER_SOL = BigInt(1_000_000_000);
export type AgentLaunchEconomics = {
  creatorShareBps: number;
  platformShareBps: number;
  agentCreationFeeLamports: bigint;
  tokenLaunchPlatformFeeLamports: bigint;
  initialBuyLamports: bigint;
  feeRecipientWallet: string;
};
function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}
function parseSolToLamports(raw: string | undefined, fallbackSol: number): bigint {
  if (!raw?.trim()) return solToLamports(fallbackSol);
  const parsed = Number.parseFloat(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return solToLamports(fallbackSol);
  return BigInt(Math.round(parsed * Number(LAMPORTS_PER_SOL)));
}
export function solToLamports(sol: number): bigint {
  if (!Number.isFinite(sol) || sol <= 0) return BigInt(0);
  return BigInt(Math.round(sol * Number(LAMPORTS_PER_SOL)));
}
export function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / Number(LAMPORTS_PER_SOL);
}
/** Human-readable SOL label; returns null when amount is zero (hide in UI). */
export function formatSolLamportsLabel(lamports: bigint): string | null {
  if (lamports <= BigInt(0)) return null;
  const sol = lamportsToSol(lamports);
  if (sol >= 1) return `${sol.toFixed(2).replace(/\.?0+$/, "")} SOL`;
  if (sol >= 0.01) return `${sol.toFixed(2)} SOL`;
  return `${sol.toFixed(4)} SOL`;
}
export function formatFeeShareLabel(creatorBps: number, platformBps: number): string {
  return `${creatorBps / 100}% creator / ${platformBps / 100}% AgentRanking`;
}
function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}
/**
 * Resolves the wallet that receives AgentRanking's share of Pump creator fees
 * and any optional token-launch platform fee.
 * Falls back to the platform ops (fee) wallet when AGENTRANKING_FEE_RECIPIENT_WALLET is unset.
 */
export function resolveAgentRankingFeeRecipientWallet(): string {
  const explicit = readEnv("AGENTRANKING_FEE_RECIPIENT_WALLET");
  if (explicit) return explicit;
  return resolveArOpsWallet();
}
function resolveTokenLaunchPlatformFeeLamports(): bigint {
  return parseSolToLamports(
    readEnv("TOKEN_LAUNCH_PLATFORM_FEE_SOL"),
    TOKEN_LAUNCH_PLATFORM_FEE_SOL,
  );
}
function resolveInitialBuyLamports(): bigint {
  return parseSolToLamports(
    readEnv("AGENTRANKING_MIN_INITIAL_BUY_SOL"),
    DEFAULT_INITIAL_BUY_SOL,
  );
}
export function getAgentLaunchEconomics(): AgentLaunchEconomics {
  const creatorShareBps = parseNonNegativeInt(
    readEnv("AGENTRANKING_CREATOR_SHARE_BPS"),
    AGENTRANKING_CREATOR_SHARE_BPS,
  );
  const platformShareBps = parseNonNegativeInt(
    readEnv("AGENTRANKING_PLATFORM_SHARE_BPS"),
    AGENTRANKING_PLATFORM_SHARE_BPS,
  );
  const tokenLaunchPlatformFeeLamports = resolveTokenLaunchPlatformFeeLamports();
  const agentCreationFeeLamports = parseSolToLamports(
    readEnv("AGENT_CREATION_FEE_SOL"),
    AGENT_CREATION_FEE_SOL,
  );
  const initialBuyLamports = resolveInitialBuyLamports();
  return {
    creatorShareBps,
    platformShareBps,
    agentCreationFeeLamports,
    tokenLaunchPlatformFeeLamports,
    initialBuyLamports,
    feeRecipientWallet: resolveAgentRankingFeeRecipientWallet(),
  };
}
export function validateFeeShareBps(creatorBps: number, platformBps: number): string | null {
  if (creatorBps + platformBps !== BPS_TOTAL) {
    return `Creator and platform shares must total ${BPS_TOTAL} bps (got ${creatorBps} + ${platformBps})`;
  }
  if (creatorBps <= 0 || platformBps <= 0) {
    return "Creator and platform shares must each be greater than zero";
  }
  return null;
}
export function validateFeeRecipientWallet(
  wallet: string | null | undefined,
  label = "Fee recipient wallet",
): string | null {
  if (!wallet?.trim()) {
    return `${label} is not configured`;
  }
  if (!trySolanaPublicKey(wallet.trim())) {
    return `${label} must be a valid Solana public key`;
  }
  return null;
}
type AgentLaunchEconomicsValidationInput = Omit<
  AgentLaunchEconomics,
  "feeRecipientWallet"
> & {
  feeRecipientWallet: string | null | undefined;
};

export function validateAgentLaunchEconomics(
  economics: AgentLaunchEconomicsValidationInput,
  options?: { requireFeeRecipient?: boolean },
): string[] {
  const errors: string[] = [];
  const shareError = validateFeeShareBps(
    economics.creatorShareBps,
    economics.platformShareBps,
  );
  if (shareError) errors.push(shareError);
  if (economics.tokenLaunchPlatformFeeLamports < BigInt(0)) {
    errors.push("Token launch platform fee cannot be negative");
  }
  if (economics.initialBuyLamports < BigInt(0)) {
    errors.push("Initial buy lamports cannot be negative");
  }
  const requireRecipient = options?.requireFeeRecipient ?? false;
  if (requireRecipient || economics.feeRecipientWallet) {
    const walletError = validateFeeRecipientWallet(economics.feeRecipientWallet);
    if (walletError) errors.push(walletError);
  }
  return errors;
}
/** Pump create + metadata + fee-share txs (excludes optional bundled buy). */
export const PUMP_LAUNCH_NETWORK_FEE_ESTIMATE_LAMPORTS = 25_000_000n;

export function estimatePumpLaunchRequiredLamports(
  economics: Pick<
    AgentLaunchEconomics,
    "tokenLaunchPlatformFeeLamports" | "initialBuyLamports"
  > = getAgentLaunchEconomics(),
): bigint {
  return (
    PUMP_LAUNCH_NETWORK_FEE_ESTIMATE_LAMPORTS +
    economics.tokenLaunchPlatformFeeLamports +
    economics.initialBuyLamports
  );
}

export function formatEstimatedSolLamports(lamports: bigint): string {
  const formatted = formatSolLamportsLabel(lamports);
  return formatted ? `~${formatted}` : "~0 SOL";
}

/** True when chain wiring must have a configured fee recipient. */
export function shouldRequireFeeRecipientInProduction(): boolean {
  const isProduction = process.env.NODE_ENV === "production";
  try {
    const network = parseAgentLaunchNetwork(process.env.AGENT_LAUNCH_NETWORK);
    return isProduction || network === "mainnet-beta";
  } catch {
    return isProduction;
  }
}
