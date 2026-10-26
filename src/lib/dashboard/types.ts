/** Serializable agent row for dashboard shell (no Date objects in client props). */
export type DashboardAgentSummary = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  image: string;
  score: number;
  protocolTrustScore: number;
  isVerified: boolean;
  isPremiumVerified: boolean;
  arVerificationStatus: string;
  description: string | null;
  chatEnabled: boolean;
  isSolanaRegistered: boolean;
};
