export type WorkReadyAgentInput = {
  id: number;
  name: string;
  description: string;
  image: string;
  isVerified: boolean;
  isPremiumVerified: boolean;
  archetype: string;
  sapCapabilities: unknown;
  agentRankScore: number;
  workReadyStatus: string;
  featuredWorkReady: boolean;
  workReadyReasons: string[];
  verifiedWallet: string;
  sapX402Endpoint: string | null;
  x402Support: boolean;
  services?: { endpoint: string }[];
  mcpOffers?: { isPublished: boolean }[];
  paidServices?: { isPublished: boolean; endpointUrl: string }[];
  githubConnections?: { status: string }[];
  verificationSignals?: { signalType: string; status: string }[];
};

export function isPubliclyFeatured(agent: WorkReadyAgentInput): boolean {
  return agent.featuredWorkReady || agent.workReadyStatus === "approved";
}

export const WORK_READY_PUBLIC_WHERE = {
  isActive: true,
  OR: [{ featuredWorkReady: true }, { workReadyStatus: "approved" }],
};

const PUBLIC_REASON_LABELS: Record<string, string> = {
  verified_owner: "Verified owner",
  profile_complete: "Profile complete",
  category_or_capability: "Capabilities listed",
  action_surface: "Service/contact URL available",
  devproof_bonus: "GitHub / DevProof connected",
  wallet_linked: "Wallet linked",
  x402_surface: "x402 endpoint added",
  mcp_endpoint: "MCP endpoint added",
  manual_approval: "Manually approved by AgentRanking",
};

export function formatWorkReadyReasons(reasons: readonly string[]): string[] {
  return reasons
    .map((reason) => {
      const key = String(reason).trim();
      if (!key) return "";
      if (PUBLIC_REASON_LABELS[key]) return PUBLIC_REASON_LABELS[key]!;
      if (key.startsWith("admin:")) return null;
      return key.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
    })
    .filter((reason): reason is string => Boolean(reason));
}
