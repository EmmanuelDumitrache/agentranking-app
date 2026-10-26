import type { RegistrationMetaEntry } from "@/lib/agent-identity";
export type { RegistrationMetaEntry };
export type EvmAddress = `0x${string}`;
export type AgentHandle = {
  chainId: number;
  agentId: number;
};
export type ValidationMethod = "crypto_economic" | "zkml" | "tee" | "unknown";
export type ValidationAttemptStatus = "requested" | "responded" | "passed" | "failed";
export type RankingTier = "unranked" | "listed" | "verified" | "attested" | "elite";
export type AgentCard = {
  name?: string;
  description?: string;
  image?: string;
  capabilities?: string[];
  mcpEndpoints?: string[];
  paymentTokens?: string[];
  x402Support?: boolean;
};
export type ChainIdentityDeployment = {
  handle: AgentHandle;
  owner: string;
  agentWallet: string | null;
  tokenURI: string;
  explorerUrl: string | null;
  agentCard: AgentCard | null;
  registrationRefs: RegistrationMetaEntry[];
  indexed: boolean;
  agentDbId?: number;
  slug?: string;
  profilePath?: string;
};
export type ReputationFeedbackRow = {
  clientAddress: string;
  value: number;
  valueDecimals: number;
  displayScore: number;
  tag1: string;
  tag2: string;
  revoked: boolean;
  feedbackIndex: number | null;
};
export type ChainReputationFootprint = {
  handle: AgentHandle;
  clients: string[];
  rows: ReputationFeedbackRow[];
  reputationScore: number;
};
export type ValidationRecord = {
  chainId: number;
  agentId: number;
  method: ValidationMethod;
  validatorAddress: string;
  requestHash: string;
  responseHash: string;
  responseURI: string;
  requestURI: string;
  score: number | null;
  status: ValidationAttemptStatus;
  blockNumber: number | null;
  logIndex: number | null;
  txHash: string;
  attestedAt: Date | null;
  tag: string;
};
export type ChainValidationFootprint = {
  handle: AgentHandle;
  records: ValidationRecord[];
  latestPass: ValidationRecord | null;
  hasRecentPass: boolean;
};
export type ChainFetchStage = "identity" | "reputation" | "validation";
export type ChainFetchError = {
  chainId: number;
  agentId?: number;
  stage: ChainFetchStage;
  message: string;
  retryable: boolean;
};
export type UnifiedAgentProfile = {
  wallet: EvmAddress;
  deployments: ChainIdentityDeployment[];
  reputationByChain: ChainReputationFootprint[];
  validationByChain: ChainValidationFootprint[];
  clusterKey: string | null;
  sourceChains: number[];
  fetchedAt: string;
  partialErrors: ChainFetchError[];
  ranking?: RankingTierResult;
};
export type RankingTierResult = {
  tier: RankingTier;
  score: number;
  reasons: string[];
  validationBoost: number;
};
/** Normalize and validate an EVM address; returns null when invalid. */
export function normalizeEvmAddress(value: string): EvmAddress | null {
  const trimmed = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return null;
  return trimmed.toLowerCase() as EvmAddress;
}
