/**
 * Baseline trust score (0–100) from on-registry signals + metadata.
 * Sybil resistance layer before verified execution and revenue scoring.
 */
export type TrustSignals = {
  isVerified: boolean;
  isPremiumVerified: boolean;
  stars: number;
  totalFeedback: number;
  /** Approximate average feedback 0–5 when feedback exists */
  avgFeedbackValue: number | null;
  ageDays: number;
  hasTwitter: boolean;
  twitterFollowers: number;
  hasGithub: boolean;
  hasWebsite: boolean;
  /** ERC-8211 execution standard (on-chain registration JSON → AgentMetadata key supportsERC8211) */
  supportsERC8211: boolean;
};
function parseFollowers(raw: string): number {
  const n = Number.parseInt(raw.replaceAll(/[,_\s]/g, ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
/** Build metadata map from AgentMetadata rows */
export function metadataKeyValueMap(metadata: Array<{ key: string; value: string }>): Record<string, string> {
  const m: Record<string, string> = {};
  for (const row of metadata) {
    m[row.key] = row.value;
  }
  return m;
}
export function trustSignalsFromMetadataAndAgent(agent: {
  isVerified?: boolean;
  isPremiumVerified?: boolean;
  stars?: number;
  totalFeedback?: number;
  createdAt?: Date | string;
  metadata?: Array<{ key: string; value: string }>;
}): TrustSignals {
  const meta = agent.metadata ? metadataKeyValueMap(agent.metadata) : {};
  const tw =
    meta.twitter?.trim() ||
    meta.x?.trim() ||
    meta.twitterUrl?.trim() ||
    meta.xUrl?.trim() ||
    "";
  const hasTwitter = tw.length > 0 || /\bx\.com\/|twitter\.com\//i.test(JSON.stringify(meta));
  const gh = meta.github?.trim() || meta.githubUrl?.trim() || "";
  const hasGithub = gh.length > 0;
  const followers =
    parseFollowers(meta.twitterFollowers ?? meta.xFollowers ?? meta.followers ?? "0");
  let created: Date;
  if (agent.createdAt instanceof Date) created = agent.createdAt;
  else if (typeof agent.createdAt === "string") created = new Date(agent.createdAt);
  else created = new Date();
  const ageDays = Math.max(0, (Date.now() - created.getTime()) / (86_400_000));
  const supportsERC8211 = meta.supportsERC8211?.trim().toLowerCase() === "true";
  return {
    isVerified: Boolean(agent.isVerified),
    isPremiumVerified: Boolean(agent.isPremiumVerified),
    stars: Number(agent.stars) || 0,
    totalFeedback: Number(agent.totalFeedback) || 0,
    avgFeedbackValue: null,
    ageDays,
    hasTwitter,
    twitterFollowers: followers,
    hasGithub,
    hasWebsite: Boolean(meta.website?.trim() || meta.url?.trim()),
    supportsERC8211,
  };
}
/** When you have feedback rows, pass avg value; else use null */
export function computeTrustScore(signals: TrustSignals): number {
  let score = 0;
  if (signals.isPremiumVerified) score += 40;
  else if (signals.isVerified) score += 20;
  if (signals.supportsERC8211) score += 15;
  if (signals.hasTwitter) score += 10;
  if (signals.twitterFollowers > 1000) score += 5;
  if (signals.twitterFollowers > 10_000) score += 5;
  if (signals.hasGithub) score += 5;
  if (signals.hasWebsite) score += 5;
  score += Math.min(signals.totalFeedback * 0.5, 10);
  score += Math.min(signals.stars * 0.2, 5);
  if (signals.avgFeedbackValue != null && Number.isFinite(signals.avgFeedbackValue)) {
    score += Math.min((signals.avgFeedbackValue / 5) * 5, 5);
  }
  score += Math.min(signals.ageDays / 30, 5);
  return Math.round(Math.min(100, score));
}
