import type { WorkReadyAgentInput } from "@/lib/jobs/work-ready";
import { isPubliclyFeatured } from "@/lib/jobs/work-ready";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
export type JobMatchInput = {
  title: string;
  description: string;
  category: string;
  jobType: string;
  tags: string[];
};
export type MatchedAgent = {
  id: number;
  name: string;
  image: string;
  slug: string;
  chainId: number;
  agentId: number;
  profilePath: string;
  archetype: string;
  agentRankScore: number;
  isVerified: boolean;
  isPremiumVerified: boolean;
  featuredWorkReady: boolean;
  workReadyStatus: string;
  matchScore: number;
  matchedTerms: string[];
  matchReasons: string[];
};
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "for",
  "to",
  "of",
  "in",
  "on",
  "with",
  "job",
  "task",
  "agent",
]);
const REASON_LABELS: Record<string, string> = {
  work_ready: "Work Ready",
  featured_work_ready: "Featured Work Ready",
  verified_owner: "Verified owner",
  category_match: "Category match",
  tag_match: "Tag match",
  capability_match: "Capability match",
  devproof_connected: "DevProof connected",
  wallet_linked: "Wallet linked",
  endpoint_signal: "MCP/x402/service endpoint",
  ar_score: "Strong AR score",
};
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_+\-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}
function agentKeywords(agent: WorkReadyAgentInput): Set<string> {
  const set = new Set<string>();
  if (agent.archetype?.trim()) {
    set.add(agent.archetype.toLowerCase());
    for (const t of tokenize(agent.archetype)) set.add(t);
  }
  const caps = agent.sapCapabilities;
  if (Array.isArray(caps)) {
    for (const c of caps) set.add(String(c).toLowerCase());
  } else if (caps && typeof caps === "object") {
    for (const k of Object.keys(caps as Record<string, unknown>)) {
      set.add(k.toLowerCase());
    }
  }
  for (const r of agent.workReadyReasons) set.add(r.toLowerCase());
  for (const t of tokenize(agent.name)) set.add(t);
  for (const t of tokenize(agent.description)) set.add(t.slice(0, 40));
  return set;
}
function hasDevProof(agent: WorkReadyAgentInput): boolean {
  if (agent.githubConnections?.some((c) => c.status === "active")) return true;
  return (
    agent.verificationSignals?.some(
      (s) =>
        (s.signalType === "devproof_active" || s.signalType === "github_verified") &&
        s.status === "verified",
    ) ?? false
  );
}
function hasEndpointSignal(agent: WorkReadyAgentInput): boolean {
  if (agent.sapX402Endpoint?.trim() || agent.x402Support) return true;
  if (agent.services?.some((s) => s.endpoint?.trim())) return true;
  if (agent.mcpOffers?.some((o) => o.isPublished)) return true;
  if (agent.paidServices?.some((p) => p.isPublished && p.endpointUrl?.trim())) return true;
  return false;
}
function parseCapabilities(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>);
  return [];
}
function formatCategoryReason(category: string): string {
  const label = category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return `${label} category match`;
}
export function matchAgentsToJob(
  job: JobMatchInput,
  agents: Array<WorkReadyAgentInput & { chainId?: number; agentId?: number }>,
  limit = 6,
): MatchedAgent[] {
  const jobTerms = new Set([
    ...tokenize(job.title),
    ...tokenize(job.description),
    ...tokenize(job.category),
    ...tokenize(job.jobType),
    ...job.tags.map((t) => t.toLowerCase()),
  ]);
  const jobCategory = job.category.toLowerCase();
  const jobTags = job.tags.map((t) => t.toLowerCase());
  const scored: MatchedAgent[] = [];
  for (const agent of agents) {
    const keywords = agentKeywords(agent);
    const matchedTerms = [...jobTerms].filter((t) => keywords.has(t));
    const reasons: string[] = [];
    let matchScore = 0;
    if (agent.workReadyStatus === "approved") {
      matchScore += 5;
      reasons.push(REASON_LABELS.work_ready!);
    }
    if (agent.featuredWorkReady) {
      matchScore += 4;
      if (!reasons.includes(REASON_LABELS.featured_work_ready!)) {
        reasons.push(REASON_LABELS.featured_work_ready!);
      }
    }
    if (agent.isPremiumVerified || agent.isVerified) {
      matchScore += 3;
      reasons.push(REASON_LABELS.verified_owner!);
    }
    const archetype = agent.archetype?.toLowerCase() ?? "";
    if (jobCategory && archetype && (archetype.includes(jobCategory) || jobCategory.includes(archetype))) {
      matchScore += 2;
      reasons.push(formatCategoryReason(job.category || agent.archetype));
    }
    const caps = parseCapabilities(agent.sapCapabilities).map((c) => c.toLowerCase());
    const tagOverlap = jobTags.filter((t) => keywords.has(t) || caps.some((c) => c.includes(t) || t.includes(c)));
    if (tagOverlap.length > 0) {
      matchScore += 2;
      const tag = tagOverlap[0]!;
      reasons.push(`${tag.replace(/_/g, " ")} tag match`);
    } else if (matchedTerms.length > 0) {
      matchScore += 2;
      reasons.push(REASON_LABELS.tag_match!);
    }
    const capOverlap = caps.filter((c) => jobTerms.has(c) || [...jobTerms].some((t) => c.includes(t)));
    if (capOverlap.length > 0) {
      matchScore += 2;
      reasons.push(`${capOverlap[0]!.replace(/_/g, " ")} capability match`);
    }
    if (hasDevProof(agent)) {
      matchScore += 1;
      reasons.push(REASON_LABELS.devproof_connected!);
    }
    if (agent.verifiedWallet?.trim()) {
      matchScore += 1;
      reasons.push(REASON_LABELS.wallet_linked!);
    }
    if (hasEndpointSignal(agent)) {
      matchScore += 1;
      reasons.push(REASON_LABELS.endpoint_signal!);
    }
    const ar = Math.max(0, Math.round(agent.agentRankScore));
    const arBonus = Math.min(ar, 100) / 50;
    if (arBonus > 0) {
      matchScore += arBonus;
      if (ar >= 60) reasons.push(REASON_LABELS.ar_score!);
    }
    if (matchedTerms.length === 0 && !isPubliclyFeatured(agent) && matchScore < 5) continue;
    if (matchScore <= 0 && matchedTerms.length === 0) continue;
    const chainId = agent.chainId ?? 0;
    const agentId = agent.agentId ?? agent.id;
    scored.push({
      id: agent.id,
      name: agent.name,
      image: agent.image,
      slug: toAgentUrlSlug(agent.name),
      chainId,
      agentId,
      profilePath: agentPublicPath({ chainId, agentId, name: agent.name }),
      archetype: agent.archetype,
      agentRankScore: ar,
      isVerified: agent.isVerified,
      isPremiumVerified: agent.isPremiumVerified,
      featuredWorkReady: agent.featuredWorkReady,
      workReadyStatus: agent.workReadyStatus,
      matchScore,
      matchedTerms,
      matchReasons: [...new Set(reasons)].slice(0, 4),
    });
  }
  scored.sort((a, b) => b.matchScore - a.matchScore);
  return scored.slice(0, limit);
}
