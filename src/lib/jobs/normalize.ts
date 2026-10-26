import type { PartnerJobSource, PartnerJobUpsertInput } from "@/lib/jobs/types";
import { stripUrlsForPreview } from "@/lib/jobs/display";
import { mergePostedBy, pickPostedByFromRaw } from "@/lib/jobs/job-poster";
import {
  buildEarnFiApplyUrl,
  buildWurkApplyUrl,
  pickRawJobUrl,
} from "@/lib/jobs/partner-job-urls";
import { stableExternalIdFromUrl } from "@/lib/jobs/hash";
function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => asString(v)).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}
function inferCategoryFromTags(tags: string[], jobType: string): string {
  const joined = `${tags.join(" ")} ${jobType}`.toLowerCase();
  if (/social|twitter|x\.com|instagram|telegram|discord|follow|like|repost|comment|quote/.test(joined)) return "social";
  if (/feedback|review|rating|human/.test(joined)) return "human_feedback";
  if (/research|analysis|survey/.test(joined)) return "research";
  if (/data|scraping|etl|dataset/.test(joined)) return "data";
  if (/growth|marketing|campaign/.test(joined)) return "growth";
  if (/contest|competition|winner/.test(joined)) return "contests";
  if (/manual|verification|proof/.test(joined)) return "manual";
  if (/on.?chain|solana|usdc|x402|crypto|web3/.test(joined)) return "on_chain";
  return "general";
}
function normalizeTags(tags: string[], category: string, jobType: string): string[] {
  const set = new Set<string>();
  for (const t of tags) set.add(t.toLowerCase());
  if (category && category !== "general") set.add(category);
  if (jobType) set.add(jobType.toLowerCase());
  return [...set].slice(0, 20);
}
/**
 * Derive the semantic category facets stored for SQL filtering. Mirrors the
 * keyword sets used by matchesCategoryFilter() so the persisted `facets` column
 * can replace Node-side category evaluation with a native array predicate.
 */
export function deriveJobFacets(category: string, jobType: string, tags: string[]): string[] {
  const hay = `${category} ${jobType} ${tags.join(" ")}`.toLowerCase();
  const out: string[] = [];
  const patterns: ReadonlyArray<readonly [string, RegExp]> = [
    ["social", /social|twitter|x_|instagram|telegram|discord/],
    ["human_feedback", /human|feedback|review|rating/],
    ["research", /research|survey|analysis/],
    ["data", /data|scraping|dataset/],
    ["growth", /growth|marketing|campaign/],
    ["contests", /contest|competition|winner/],
    ["manual", /manual|verification|proof/],
    ["on_chain", /on.?chain|solana|usdc|x402|crypto|web3/],
  ];
  for (const [facet, re] of patterns) {
    if (re.test(hay)) out.push(facet);
  }
  return out;
}
export type EarnFiRawJob = Record<string, unknown>;
function isEarnFiPlaceholderTitle(title: string, taskType: string): boolean {
  const t = title.trim().toLowerCase();
  if (!t || t === "earnfi job" || t === "earnfi listing") return true;
  if (taskType && t === `earnfi ${taskType.toLowerCase()} job`) return true;
  if (/^earnfi\s+\w+\s+job$/i.test(title.trim())) return true;
  if (taskType && t === taskType.toLowerCase()) return true;
  if (/\s+on\s+earnfi$/i.test(title.trim())) return true;
  if (["campaign", "job", "task", "social", "listing", "work", "custom", "general"].includes(t)) return true;
  return false;
}
function pickEarnFiTitle(rawTitle: string, description: string, taskType: string): string {
  if (rawTitle && !isEarnFiPlaceholderTitle(rawTitle, taskType)) {
    return truncateText(stripUrlsForPreview(rawTitle.replace(/\s+/g, " ")), 100);
  }
  const descClean = description ? stripUrlsForPreview(description.replace(/\s+/g, " ")) : "";
  if (descClean) return truncateText(descClean, 100);
  if (taskType) {
    const label = taskType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return `${label} on EarnFi`;
  }
  return "EarnFi listing";
}
export function normalizeEarnFiJob(raw: EarnFiRawJob): PartnerJobUpsertInput {
  const id =
    asString(raw.id) ||
    asString(raw.job_id) ||
    asString(raw.jobId) ||
  "";
  const taskType = asString(raw.task_type) || asString(raw.taskType) || asString(raw.type);
  const rawTitle = asString(raw.title);
  const description =
    asString(raw.description) ||
    asString(raw.instructions) ||
    asString(raw.summary) ||
    "";
  const title = pickEarnFiTitle(rawTitle, description, taskType);
  const rawStatus = asString(raw.status);
  const status = (
    rawStatus ||
    (raw.active === false || asString(raw.active) === "false" ? "closed" : "open")
  ).toLowerCase();
  const rewardPerUser = raw.reward_per_user ?? raw.rewardPerUser ?? raw.reward;
  const slots = raw.slots ?? raw.max_slots ?? raw.maxSlots;
  let rewardAmount: string | null = null;
  if (rewardPerUser != null) {
    const per = Number(rewardPerUser);
    const slotCount = slots != null ? Number(slots) : 1;
    if (Number.isFinite(per)) {
      const total = Number.isFinite(slotCount) ? per * slotCount : per;
      rewardAmount = String(total);
    }
  }
  const sourceJobUrl =
    pickRawJobUrl(raw) ||
    buildEarnFiApplyUrl(id || null);
  const sourceStatusUrl = asString(raw.status_url) || asString(raw.statusUrl) || null;
  const externalId = id || stableExternalIdFromUrl("earnfi", sourceJobUrl);
  const tags = asStringArray(raw.tags);
  const jobType = taskType || asString(raw.job_type) || "task";
  const category = asString(raw.category) || inferCategoryFromTags(tags, jobType);
  const instructionsOnly = asString(raw.instructions);
  const baseRequirements = raw.requirements ?? raw.verification_requirements ?? null;
  const requirementsWithInstructions =
    instructionsOnly && instructionsOnly !== description
      ? mergeAgentInstructions(baseRequirements, instructionsOnly)
      : baseRequirements;
  const earnFiPoster = pickPostedByFromRaw(raw, [
    "creator_handle",
    "creator_name",
    "creator",
    "brand_name",
    "brand",
    "project_name",
    "campaign_name",
    "organization",
  ]);
  const requirements = mergePostedBy(requirementsWithInstructions, earnFiPoster);
  const normalizedTags = normalizeTags(tags, category, jobType);
  return {
    source: "earnfi",
    externalId,
    title,
    description,
    category,
    jobType,
    rewardAmount,
    rewardCurrency: asString(raw.reward_currency) || asString(raw.currency) || "USDC",
    chain: asString(raw.chain) || asString(raw.network) || "solana",
    status: status === "paused" ? "paused" : status === "closed" || status === "completed" ? "closed" : "open",
    applyUrl: sourceJobUrl,
    sourceJobUrl,
    sourceStatusUrl,
    sourceSecret: asString(raw.secret) || null,
    requirements,
    tags: normalizedTags,
    facets: deriveJobFacets(category, jobType, normalizedTags),
    raw,
    expiresAt: raw.expires_at || raw.expiresAt ? new Date(String(raw.expires_at ?? raw.expiresAt)) : null,
  };
}
export type WurkRawJob = Record<string, unknown>;
export type WurkNormalizeContext = {
  wurkUsd?: number | null;
};
type ResolvedWurkReward = { amount: string | null; currency: string };
function formatWurkUsdAmount(wurkAmount: string, wurkUsd: number): string | null {
  const usd = Number(wurkAmount) * wurkUsd;
  if (!Number.isFinite(usd) || usd <= 0) return null;
  if (usd >= 1) return usd.toFixed(2);
  if (usd >= 0.01) return usd.toFixed(2);
  return usd.toFixed(4);
}
function resolveWurkTokenReward(
  alternativeAmount: string,
  alternativeTicker: string,
  context?: WurkNormalizeContext,
): ResolvedWurkReward {
  const ticker = (alternativeTicker || "WURK").trim().toUpperCase();
  if (context?.wurkUsd && ticker === "WURK") {
    const usd = formatWurkUsdAmount(alternativeAmount, context.wurkUsd);
    if (usd) return { amount: usd, currency: "USD" };
  }
  return { amount: alternativeAmount, currency: ticker };
}
function resolveWurkSocialReward(raw: WurkRawJob, context?: WurkNormalizeContext): ResolvedWurkReward {
  const usd = asString(raw.reward_per_retweet_usd);
  if (usd) return { amount: usd, currency: "USD" };
  const alternative = asString(raw.reward_per_retweet_alternative);
  if (alternative) {
    return resolveWurkTokenReward(alternative, asString(raw.alternative_ticker) || "WURK", context);
  }
  const sol = asString(raw.reward_per_retweet_sol);
  if (sol) return { amount: sol, currency: "SOL" };
  return { amount: null, currency: "USD" };
}
function resolveWurkCustomReward(raw: WurkRawJob, context?: WurkNormalizeContext): ResolvedWurkReward {
  const usdPerCreator = asString(raw.reward_per_creator_usd);
  if (usdPerCreator) return { amount: usdPerCreator, currency: "USD" };
  const alternativePerCreator = asString(raw.reward_per_creator_alternative);
  if (alternativePerCreator) {
    return resolveWurkTokenReward(
      alternativePerCreator,
      asString(raw.alternative_ticker) || "WURK",
      context,
    );
  }
  const alternativeBounty = asString(raw.bounty_total_alternative);
  if (alternativeBounty) {
    return resolveWurkTokenReward(
      alternativeBounty,
      asString(raw.alternative_ticker) || "WURK",
      context,
    );
  }
  const solPerCreator = asString(raw.reward_per_creator_sol);
  if (solPerCreator) return { amount: solPerCreator, currency: "SOL" };
  const solBounty = asString(raw.bounty_total_sol);
  if (solBounty) return { amount: solBounty, currency: "SOL" };
  return { amount: null, currency: "USD" };
}
function truncateText(value: string, maxLen: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1).trimEnd()}…`;
}
function mergeAgentInstructions(requirements: unknown, instructions: string): Record<string, unknown> {
  if (requirements == null) {
    return { agent_instructions: instructions };
  }
  if (typeof requirements === "object" && !Array.isArray(requirements)) {
    return { ...(requirements as Record<string, unknown>), agent_instructions: instructions };
  }
  return { details: requirements, agent_instructions: instructions };
}
function inferWurkListingKind(raw: WurkRawJob): "social" | "custom" | "api" {
  const explicit = asString(raw._wurkListingKind);
  if (explicit === "social" || explicit === "custom") return explicit;
  if (asString(raw.jobId) || asString(raw.jobLink) || asString(raw.job_link)) return "api";
  if (asString(raw.custom_short_id) || (asString(raw.job_mode) && asString(raw.description))) {
    return "custom";
  }
  if (asString(raw.short_id) && asString(raw.job_type)) return "social";
  return "api";
}
function normalizeWurkSocialCard(raw: WurkRawJob, context?: WurkNormalizeContext): PartnerJobUpsertInput {
  const shortId = asString(raw.short_id);
  const jobType = asString(raw.job_type) || "social";
  const tweet = raw.tweet_snapshot;
  const tweetText =
    tweet && typeof tweet === "object" ? asString((tweet as Record<string, unknown>).text) : "";
  const creatorHandle = asString(raw.creator_handle) || asString(raw.creator_name);
  const creator = creatorHandle || "WURK";
  const tweetClean = tweetText ? stripUrlsForPreview(tweetText.replace(/\s+/g, " ")) : "";
  const title = tweetClean
    ? truncateText(tweetClean, 100)
    : `@${creator} repost campaign`;
  const description = tweetText || title;
  const reward = resolveWurkSocialReward(raw, context);
  const applyUrl = shortId ? buildWurkApplyUrl(`social:${shortId}`) : buildWurkApplyUrl("");
  const externalId = shortId ? `social:${shortId}` : stableExternalIdFromUrl("wurk", applyUrl);
  const workStatus = (asString(raw.work_status) || "open").toLowerCase();
  const tags = asStringArray(raw.tags);
  if (jobType) tags.push(jobType);
  tags.push("social");
  const category = inferCategoryFromTags(tags, jobType);
  const baseRequirements = raw.add_requirements ?? raw.work_add_requirements ?? null;
  const requirements = mergePostedBy(baseRequirements, creatorHandle || null);
  const normalizedTags = normalizeTags(tags, category, jobType);
  return {
    source: "wurk",
    externalId,
    title,
    description,
    category,
    jobType,
    rewardAmount: reward.amount,
    rewardCurrency: reward.currency,
    chain: "solana",
    status:
      workStatus === "closed" || workStatus === "completed" || asString(raw.open_slots) === "0"
        ? "closed"
        : "open",
    applyUrl,
    sourceJobUrl: applyUrl,
    sourceStatusUrl: null,
    sourceSecret: null,
    requirements,
    tags: normalizedTags,
    facets: deriveJobFacets(category, jobType, normalizedTags),
    raw,
    expiresAt: null,
  };
}
function normalizeWurkCustomCard(raw: WurkRawJob, context?: WurkNormalizeContext): PartnerJobUpsertInput {
  const shortId = asString(raw.custom_short_id) || asString(raw.work_short_id);
  const uuid = asString(raw.id);
  const jobMode = asString(raw.job_mode) || "custom";
  const categoryMain = asString(raw.category_main) || "General";
  const categorySub = asString(raw.category_sub);
  const description = asString(raw.description);
  const title =
    categorySub && categorySub !== categoryMain
      ? `${categoryMain} · ${categorySub} (${jobMode})`
      : `${categoryMain} · ${jobMode}`;
  const applyUrl = shortId
    ? buildWurkApplyUrl(`custom:${shortId}`)
    : buildWurkApplyUrl("");
  const externalId = shortId
    ? `custom:${shortId}`
    : uuid
      ? `custom:${uuid}`
      : stableExternalIdFromUrl("wurk", applyUrl);
  const workStatus = (asString(raw.work_status) || asString(raw.status) || "open").toLowerCase();
  const reward = resolveWurkCustomReward(raw, context);
  const tags = asStringArray(raw.tags);
  if (raw.agent_help === 1 || raw.agent_help === true) tags.push("agent_help", "human_feedback");
  if (jobMode) tags.push(jobMode);
  const category =
    raw.agent_help === 1 || raw.agent_help === true
      ? "human_feedback"
      : inferCategoryFromTags(tags, jobMode);
  const normalizedTags = normalizeTags(tags, category, jobMode);
  return {
    source: "wurk",
    externalId,
    title: description ? truncateText(description.replace(/\s+/g, " "), 140) : title,
    description: description || title,
    category,
    jobType: jobMode,
    rewardAmount: reward.amount,
    rewardCurrency: reward.currency,
    chain: "solana",
    status: workStatus === "closed" || workStatus === "completed" ? "closed" : "open",
    applyUrl,
    sourceJobUrl: applyUrl,
    sourceStatusUrl: null,
    sourceSecret: asString(raw.secret_agent_help) || null,
    requirements: raw.add_requirements ?? null,
    tags: normalizedTags,
    facets: deriveJobFacets(category, jobMode, normalizedTags),
    raw,
    expiresAt: null,
  };
}
export function normalizeWurkJob(raw: WurkRawJob, context?: WurkNormalizeContext): PartnerJobUpsertInput {
  const listingKind = inferWurkListingKind(raw);
  if (listingKind === "social") {
    return normalizeWurkSocialCard(raw, context);
  }
  if (listingKind === "custom") {
    return normalizeWurkCustomCard(raw, context);
  }
  const id =
    asString(raw.id) ||
    asString(raw.jobId) ||
    asString(raw.job_id) ||
    "";
  const jobType = asString(raw.job_type) || asString(raw.type) || asString(raw.taskType) || "task";
  const title = asString(raw.title) || asString(raw.name) || (jobType ? `WURK ${jobType}` : "WURK job");
  const description =
    asString(raw.description) ||
    asString(raw.instructions) ||
    asString(raw.prompt) ||
    "";
  const jobLink = asString(raw.jobLink) || asString(raw.job_link) || asString(raw.url);
  const statusUrl = asString(raw.statusUrl) || asString(raw.status_url) || null;
  const externalId = id || stableExternalIdFromUrl("wurk", jobLink || buildWurkApplyUrl(""));
  const applyUrl = buildWurkApplyUrl(externalId, raw);
  const sourceJobUrl = applyUrl;
  const tags = asStringArray(raw.tags);
  const category = asString(raw.category) || inferCategoryFromTags(tags, jobType);
  const reward = raw.reward ?? raw.amount ?? raw.budget;
  let rewardAmount: string | null = null;
  if (reward != null && Number.isFinite(Number(reward))) {
    rewardAmount = String(reward);
  }
  const normalizedTags = normalizeTags(tags, category, jobType);
  return {
    source: "wurk",
    externalId,
    title,
    description,
    category,
    jobType,
    rewardAmount,
    rewardCurrency: asString(raw.reward_currency) || asString(raw.currency) || "USDC",
    chain: asString(raw.chain) || asString(raw.network) || "solana",
    status: (asString(raw.status) || "open").toLowerCase(),
    applyUrl: sourceJobUrl,
    sourceJobUrl,
    sourceStatusUrl: statusUrl,
    sourceSecret: asString(raw.secret) || null,
    requirements: raw.requirements ?? raw.proof_requirements ?? null,
    tags: normalizedTags,
    facets: deriveJobFacets(category, jobType, normalizedTags),
    raw,
    expiresAt: raw.expiresAt || raw.expires_at ? new Date(String(raw.expiresAt ?? raw.expires_at)) : null,
  };
}
export function matchesCategoryFilter(
  category: string,
  jobType: string,
  source: PartnerJobSource,
  tags: string[],
  filter: string,
): boolean {
  if (filter === "all") return true;
  if (filter === "earnfi") return source === "earnfi";
  if (filter === "wurk") return source === "wurk";
  const hay = `${category} ${jobType} ${tags.join(" ")}`.toLowerCase();
  switch (filter) {
    case "social":
      return /social|twitter|x_|instagram|telegram|discord/.test(hay);
    case "human_feedback":
      return /human|feedback|review|rating/.test(hay);
    case "research":
      return /research|survey|analysis/.test(hay);
    case "data":
      return /data|scraping|dataset/.test(hay);
    case "growth":
      return /growth|marketing|campaign/.test(hay);
    case "contests":
      return /contest|competition|winner/.test(hay);
    case "manual":
      return /manual|verification|proof/.test(hay);
    case "on_chain":
      return /on.?chain|solana|usdc|x402|crypto|web3/.test(hay);
    default:
      return category.toLowerCase() === filter || tags.some((t) => t === filter);
  }
}