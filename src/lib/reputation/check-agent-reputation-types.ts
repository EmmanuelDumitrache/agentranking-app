/**
 * Public reputation-check API types.
 * Pure types — safe to import from tests without server-only.
 */
export type RegistryType = "hatcher" | "metaplex" | "sap" | "covenant" | "erc8004" | "unknown";
export type CheckRecommendation = "safe" | "caution" | "high_risk" | "unknown";
export type AgentReputationCheckInput =
  | { mode: "wallet"; wallet: string }
  | { mode: "chainAgentId"; chainId: number; agentId: number }
  | { mode: "profileUrl"; url: string }
  | { mode: "hatcherId"; hatcherId: string };
export type AgentReputationCheckAgent = {
  name: string;
  slug: string;
  chainId: number;
  agentId: number;
  owner: string;
  profilePath: string;
  profileUrl: string;
  source: string;
};
export type AgentReputationCheckScores = {
  agentRankScore: number | null;
  protocolTrustScore: number | null;
  reputationScore: number | null;
  partnerDiscoveryScore: number | null;
  confidence: string | null;
};
export type AgentReputationCheckVerification = {
  kyaVerified: boolean;
  sapVerified: boolean;
  covenantStatus: string | null;
  hatcherBadge: string | null;
};
export type AgentReputationCheckLinks = {
  profile?: string;
  chat?: string;
  room?: string;
  status?: string;
  passport?: string;
  mcpManifest?: string;
  agentRankingProfile?: string;
};
export type AgentReputationCheckResponse = {
  ok: true;
  isRegistered: boolean;
  registryType: RegistryType;
  recommendation: CheckRecommendation;
  agent: AgentReputationCheckAgent | null;
  scores: AgentReputationCheckScores;
  verification: AgentReputationCheckVerification;
  warnings: string[];
  reasons: string[];
  links: AgentReputationCheckLinks;
  disclaimer: string;
  checkedAt: string;
};
export const HATCHER_REPUTATION_CHECK_DISCLAIMER =
  "Hatcher Indexed means the agent came from Hatcher's public opt-in Explore feed. It is not AgentRanking KYA, SAP verification, or Covenant audit verification.";
export const DEFAULT_REPUTATION_CHECK_DISCLAIMER =
  "Scores and recommendations reflect AgentRanking registry signals. They are not a substitute for your own verification before payments or agent handoffs.";
export class InvalidCheckInputError extends Error {
  constructor(
    message: string,
    public readonly code = "invalid_check_input",
  ) {
    super(message);
    this.name = "InvalidCheckInputError";
  }
}
