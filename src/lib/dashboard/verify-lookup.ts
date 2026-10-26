import { normalizeVerifySearchQuery } from "@/lib/dashboard/verify-search-query";
export { normalizeVerifySearchQuery };
export type VerifyClaimChain = {
  chainId: number;
  agentId: number;
  shortName: string;
  color: string;
  icon: string;
};
export type VerifyAgentLookup = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  image: string;
  isPremiumVerified?: boolean;
  canClaim?: boolean | null;
  slug?: string | null;
  profilePath?: string | null;
  remoteOnly?: boolean;
  /** Multi-chain deployments included when verifying this identity (same normalized display name / product). */
  claimChains?: VerifyClaimChain[];
  chain: { name: string; shortName: string; color: string; icon: string };
};
