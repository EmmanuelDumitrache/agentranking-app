/**
 * Pure-logic half of the Trust Oracle — no `server-only`, no Prisma imports.
 *
 * Exposes types, wallet validation, and the deterministic recommendation
 * thresholds so they can be unit-tested and reused client-side.
 *
 * Keep in sync with `trust-oracle.ts` (the server-side orchestrator).
 */
export const EVM_WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
/** Base58 (Solana) — permissive range; rely on 32-44 length bracket. */
export const SOLANA_WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export type WalletKind = "evm" | "solana";
export class InvalidWalletError extends Error {
  constructor(public readonly wallet: string) {
    super(`Invalid wallet address: ${wallet}`);
    this.name = "InvalidWalletError";
  }
}
export function classifyWallet(wallet: string): WalletKind | null {
  const w = wallet.trim();
  if (EVM_WALLET_RE.test(w)) return "evm";
  if (SOLANA_WALLET_RE.test(w)) return "solana";
  return null;
}
/** Lowercase EVM addresses; preserve base58 case for Solana. */
export function normalizeWallet(wallet: string): { normalized: string; kind: WalletKind } {
  const kind = classifyWallet(wallet);
  if (!kind) throw new InvalidWalletError(wallet);
  const trimmed = wallet.trim();
  return {
    normalized: kind === "evm" ? trimmed.toLowerCase() : trimmed,
    kind,
  };
}
export type Recommendation = "safe" | "caution" | "high_risk";
export type VerificationTier = "founding_partner" | "community_verified" | "unverified";
export type ReportCounts = { open: number; reviewed: number; total: number };
export type RecommendationInput = {
  protocolTrustScore: number;
  isRegistered: boolean;
  isVerified: boolean;
  isPremiumVerified: boolean;
  isVerifiedRevenue: boolean;
  reviewedReports: number;
  openReports: number;
  blocklisted: boolean;
  lastActivityAgeDays: number | null;
};
/**
 * Deterministic thresholds — kept simple and readable for reviewers (Coinbase /
 * Klavis maintainers will want to audit this). If these change, update the unit
 */
export function computeRecommendation(input: RecommendationInput): Recommendation {
  if (input.blocklisted) return "high_risk";
  if (input.reviewedReports >= 2) return "high_risk";
  if (input.isRegistered && input.protocolTrustScore < 30) return "high_risk";
  if (!input.isRegistered && input.openReports >= 1) return "high_risk";
  if (!input.isRegistered) return "caution";
  const recentEnough =
    input.lastActivityAgeDays == null ? false : input.lastActivityAgeDays <= 60;
  const identityOk =
    input.isPremiumVerified || input.isVerifiedRevenue || (input.isVerified && recentEnough);
  if (identityOk && input.protocolTrustScore >= 70 && input.reviewedReports === 0) return "safe";
  return "caution";
}
export type VerificationFlags = {
  isVerified: boolean;
  isPremiumVerified: boolean;
  isVerifiedRevenue: boolean;
};
export function verificationTier(agent: VerificationFlags | null): VerificationTier {
  if (!agent) return "unverified";
  if (agent.isPremiumVerified || agent.isVerifiedRevenue) return "founding_partner";
  if (agent.isVerified) return "community_verified";
  return "unverified";
}
export type TrustOraclePayload = {
  wallet: string;
  isRegistered: boolean;
  isVerified: boolean;
  verificationTier: VerificationTier;
  protocolTrustScore: number;
  reports: ReportCounts;
  lastActivity: string | null;
  recommendation: Recommendation;
  agent: {
    chainId: number;
    agentId: number;
    name: string;
    slug: string;
    profilePath: string;
  } | null;
  evidence: {
    profileUrl: string | null;
  };
};
/**
 * Plain-text summary for MCP `get_verified_status` — one sentence, LLM-friendly.
 */
