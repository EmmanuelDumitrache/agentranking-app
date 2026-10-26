/**
 * Native AR Agent Score — public readiness/trust/completeness score for
 * agents created through the AgentRanking platform.
 *
 * Score range: 0–100, composed of 7 weighted components.
 */
export type NativeAgentScoreTier =
  | "gold"
  | "silver"
  | "bronze"
  | "basic"
  | "unscored";
export type ScoreComponent = {
  score: number;
  max: number;
  reasons: string[];
  missing: string[];
};
export type NativeAgentScoreBreakdown = {
  total: number;
  tier: NativeAgentScoreTier;
  label: string;
  identity: ScoreComponent;
  verification: ScoreComponent;
  wallet: ScoreComponent;
  tokenization: ScoreComponent;
  capabilities: ScoreComponent;
  activity: ScoreComponent;
  developer: ScoreComponent;
};
type ScoreInput = {
  name: string | null;
  description: string | null;
  image: string | null;
  hasWebsite: boolean;
  hasTwitter: boolean;
  hasTelegram: boolean;
  hasGithub: boolean;
  agentMode: string | null;
  archetype: string | null;
  publicVerificationStatus: string | null;
  isVerified: boolean;
  arVerificationStatus: string | null;
  hasAgentWallet: boolean;
  agentWalletPublicKey: string | null;
  hasTokenLaunched: boolean;
  tokenMint: string | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenImageUrl: string | null;
  tokenHasMetadata: boolean;
  tokenHasMarketLinks: boolean;
  capabilitiesCount: number;
  mcpOffersCount: number;
  x402Support: boolean;
  sapCapabilitiesCount: number;
  hasRecentActivity: boolean; // last 7 days
  hasRecentLaunch: boolean; // token launched in last 30 days
  hasGithubConnection: boolean;
};
const WEIGHTS = {
  identity: 25,
  verification: 20,
  wallet: 15,
  tokenization: 15,
  capabilities: 10,
  activity: 10,
  developer: 5,
} as const;
function tierForScore(total: number): NativeAgentScoreTier {
  if (total >= 90) return "gold";
  if (total >= 75) return "silver";
  if (total >= 50) return "bronze";
  if (total >= 25) return "basic";
  return "unscored";
}
function tierLabel(tier: NativeAgentScoreTier): string {
  switch (tier) {
    case "gold":
      return "Gold";
    case "silver":
      return "Silver";
    case "bronze":
      return "Bronze";
    case "basic":
      return "Basic";
    case "unscored":
      return "Unscored";
  }
}
export function computeNativeAgentScore(input: ScoreInput): NativeAgentScoreBreakdown {
  // ── Identity completeness (25 pts) ──
  const identityReasons: string[] = [];
  const identityMissing: string[] = [];
  let identityScore = 0;
  if (input.image && input.image.length > 0) {
    identityScore += 5;
    identityReasons.push("Avatar set");
  } else {
    identityMissing.push("Avatar");
  }
  if (input.name && input.name.length > 0) {
    identityScore += 5;
    identityReasons.push("Name set");
  } else {
    identityMissing.push("Name");
  }
  if (input.description && input.description.length > 20) {
    identityScore += 8;
    identityReasons.push("Description/persona");
  } else if (input.description && input.description.length > 0) {
    identityScore += 3;
    identityReasons.push("Short description");
  } else {
    identityMissing.push("Description");
  }
  const socialCount = [
    input.hasWebsite,
    input.hasTwitter,
    input.hasTelegram,
    input.hasGithub,
  ].filter(Boolean).length;
  if (socialCount >= 3) {
    identityScore += 6;
    identityReasons.push(`${socialCount} social links`);
  } else if (socialCount >= 1) {
    identityScore += 3;
    identityReasons.push(`${socialCount} social link${socialCount > 1 ? "s" : ""}`);
  } else {
    identityMissing.push("Social links");
  }
  const metadataFields = [input.agentMode, input.archetype].filter(
    (f) => f && f !== "unknown" && f !== "",
  );
  if (metadataFields.length >= 2) {
    identityScore += 1;
    identityReasons.push("Metadata complete");
  } else if (metadataFields.length === 0) {
    identityMissing.push("Metadata (mode/archetype)");
  }
  identityScore = Math.min(identityScore, WEIGHTS.identity);
  // ── Verification (20 pts) ──
  const verificationReasons: string[] = [];
  const verificationMissing: string[] = [];
  let verificationScore = 0;
  const vStatus = (input.publicVerificationStatus ?? "").toLowerCase();
  const arVStatus = (input.arVerificationStatus ?? "").toLowerCase();
  if (vStatus === "verified" || arVStatus === "verified") {
    verificationScore += 20;
    verificationReasons.push("AgentRanking verified");
  } else if (vStatus === "in_review" || vStatus === "submitted" || arVStatus === "pending") {
    verificationScore += 5;
    verificationReasons.push("Verification in review");
    verificationMissing.push("Verification pending");
  } else if (input.isVerified) {
    verificationScore += 10;
    verificationReasons.push("Indexed verified");
    verificationMissing.push("Upgrade to AgentRanking verification");
  } else {
    verificationMissing.push("Unverified");
  }
  verificationScore = Math.min(verificationScore, WEIGHTS.verification);
  // ── Agent wallet / on-chain identity (15 pts) ──
  const walletReasons: string[] = [];
  const walletMissing: string[] = [];
  let walletScore = 0;
  if (input.hasAgentWallet && input.agentWalletPublicKey) {
    walletScore += 8;
    walletReasons.push("Agent wallet generated");
  } else {
    walletMissing.push("Agent wallet not generated");
  }
  if (input.agentWalletPublicKey) {
    walletScore += 4;
    walletReasons.push("Wallet has public address");
  }
  if (input.hasRecentActivity) {
    walletScore += 3;
    walletReasons.push("Recent wallet activity");
  } else {
    walletMissing.push("No recent wallet activity");
  }
  walletScore = Math.min(walletScore, WEIGHTS.wallet);
  // ── Tokenization (15 pts) ──
  const tokenReasons: string[] = [];
  const tokenMissing: string[] = [];
  let tokenScore = 0;
  if (input.hasTokenLaunched && input.tokenMint) {
    tokenScore += 8;
    tokenReasons.push("Token launched");
  } else {
    tokenMissing.push("No token launched");
  }
  if (input.tokenName && input.tokenSymbol && input.tokenImageUrl) {
    tokenScore += 3;
    tokenReasons.push("Token metadata complete");
  } else if (input.hasTokenLaunched) {
    tokenMissing.push("Token metadata incomplete");
  }
  if (input.tokenHasMarketLinks) {
    tokenScore += 4;
    tokenReasons.push("Market links available");
  } else if (input.hasTokenLaunched) {
    tokenMissing.push("No market links");
  }
  tokenScore = Math.min(tokenScore, WEIGHTS.tokenization);
  // ── Capabilities / skills (10 pts) ──
  const capReasons: string[] = [];
  const capMissing: string[] = [];
  let capScore = 0;
  const totalCap =
    input.capabilitiesCount + input.mcpOffersCount + input.sapCapabilitiesCount +
    (input.x402Support ? 1 : 0);
  if (totalCap >= 3) {
    capScore += 10;
    capReasons.push(`${totalCap} capabilities`);
  } else if (totalCap >= 1) {
    capScore += 5;
    capReasons.push(`${totalCap} capabilit${totalCap === 1 ? "y" : "ies"}`);
  } else {
    capMissing.push("No capabilities configured");
  }
  capScore = Math.min(capScore, WEIGHTS.capabilities);
  // ── Activity / freshness (10 pts) ──
  const activityReasons: string[] = [];
  const activityMissing: string[] = [];
  let activityScore = 0;
  if (input.hasRecentActivity) {
    activityScore += 5;
    activityReasons.push("Activity in last 7 days");
  }
  if (input.hasRecentLaunch) {
    activityScore += 5;
    activityReasons.push("Token launch in last 30 days");
  } else if (!input.hasRecentActivity) {
    activityMissing.push("No recent activity");
  }
  activityScore = Math.min(activityScore, WEIGHTS.activity);
  // ── Developer proof (5 pts) ──
  const devReasons: string[] = [];
  const devMissing: string[] = [];
  let devScore = 0;
  if (input.hasGithubConnection) {
    devScore += 5;
    devReasons.push("GitHub connected");
  } else {
    devMissing.push("GitHub not connected");
  }
  devScore = Math.min(devScore, WEIGHTS.developer);
  const total = identityScore + verificationScore + walletScore +
    tokenScore + capScore + activityScore + devScore;
  const tier = tierForScore(total);
  return {
    total: Math.min(total, 100),
    tier,
    label: tierLabel(tier),
    identity: { score: identityScore, max: WEIGHTS.identity, reasons: identityReasons, missing: identityMissing },
    verification: { score: verificationScore, max: WEIGHTS.verification, reasons: verificationReasons, missing: verificationMissing },
    wallet: { score: walletScore, max: WEIGHTS.wallet, reasons: walletReasons, missing: walletMissing },
    tokenization: { score: tokenScore, max: WEIGHTS.tokenization, reasons: tokenReasons, missing: tokenMissing },
    capabilities: { score: capScore, max: WEIGHTS.capabilities, reasons: capReasons, missing: capMissing },
    activity: { score: activityScore, max: WEIGHTS.activity, reasons: activityReasons, missing: activityMissing },
    developer: { score: devScore, max: WEIGHTS.developer, reasons: devReasons, missing: devMissing },
  };
}
