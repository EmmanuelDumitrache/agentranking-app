import type { PublicPartnerJob } from "@/lib/jobs/types";
import { getJobTypeBadgeLabel } from "@/lib/jobs/job-badges";
import { timeAgo } from "@/lib/utils";
const URL_PATTERN = /https?:\/\/\S+/gi;
export function truncateJobText(value: string, maxLen: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1).trimEnd()}…`;
}
/** Remove bare URLs from preview copy (t.co, x.com, etc.). */
export function stripUrlsForPreview(text: string): string {
  return text
    .replace(URL_PATTERN, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
}
function isMostlyUrl(text: string): boolean {
  const stripped = stripUrlsForPreview(text);
  if (!stripped) return true;
  if (!/https?:\/\//i.test(text)) return false;
  return stripped.length < 12;
}
function headlineFromText(text: string, maxLen = 110): string | null {
  const cleaned = stripJobTypePrefix(stripUrlsForPreview(text));
  if (!cleaned || cleaned.length < 8 || isMostlyUrl(text)) return null;
  return truncateJobText(cleaned, maxLen);
}
function partnerDisplayName(job: PublicPartnerJob): string {
  return job.partnerDisplayName || (job.source === "earnfi" ? "EarnFi" : "WURK");
}
function genericTypeOnPartnerTitle(typeLabel: string, partnerName: string): string {
  return `${typeLabel} on ${partnerName}`;
}
/** Drop redundant "Repost ·" style prefixes when meta line already shows the type. */
function stripJobTypePrefix(text: string): string {
  return text
    .replace(
      /^(repost|social|comment|like|follow|quote|campaign|growth|feedback|contest|challenge)\s*[·•]\s*/i,
      "",
    )
    .trim();
}
function isGenericStoredHeadline(headline: string, job: PublicPartnerJob): boolean {
  const typeLabel = getJobTypeBadgeLabel(job);
  const partnerName = partnerDisplayName(job);
  const h = headline.trim().toLowerCase();
  if (!h) return true;
  if (h === genericTypeOnPartnerTitle(typeLabel, partnerName).toLowerCase()) return true;
  if (h === typeLabel.toLowerCase()) return true;
  if (job.jobType && h === job.jobType.toLowerCase().replace(/_/g, " ")) return true;
  if (job.category && h === job.category.toLowerCase().replace(/_/g, " ")) return true;
  if (job.source === "earnfi") {
    if (/^earnfi(\s+\w+)?\s+job$/i.test(headline.trim())) return true;
    if (h === "earnfi listing") return true;
    if (/^custom job on earnfi$/i.test(headline.trim())) return true;
    if (/\s+on\s+earnfi$/i.test(headline.trim())) return true;
    if (["campaign", "job", "task", "social", "listing", "work", "custom", "general"].includes(h)) return true;
  }
  return false;
}
/** Public headline — prefers real copy over generic type/partner labels. */
export function getJobDisplayTitle(job: PublicPartnerJob): string {
  const typeLabel = getJobTypeBadgeLabel(job);
  const partnerName = partnerDisplayName(job);
  const fallback = genericTypeOnPartnerTitle(typeLabel, partnerName);
  const fromTitle = headlineFromText(job.title);
  if (fromTitle && !isGenericStoredHeadline(fromTitle, job) && !looksLikeBriefBodyCopy(fromTitle)) {
    return fromTitle;
  }
  const fromDescription = headlineFromText(job.description);
  if (fromDescription && !looksLikeBriefBodyCopy(fromDescription)) {
    return fromDescription;
  }
  return fallback;
}
/** Minimal grid card title — same as display title but never leaves URL-only rows generic. */
export function getJobCardTitle(job: PublicPartnerJob): string {
  return getJobDisplayTitle(job);
}
/** Optional one-line teaser for cards; omitted when empty or redundant. */
export function getJobCardTeaser(job: PublicPartnerJob): string | null {
  const title = getJobCardTitle(job);
  const fromDescription = stripJobTypePrefix(stripUrlsForPreview(job.description.trim()));
  if (!fromDescription || fromDescription.length < 12) return null;
  if (fromDescription === title || fromDescription.startsWith(title)) return null;
  const fromTitle = stripJobTypePrefix(stripUrlsForPreview(job.title.trim()));
  if (fromDescription === fromTitle) return null;
  const teaser = truncateJobText(fromDescription, 100);
  if (!teaser || teaser === title || title.startsWith(teaser)) return null;
  return teaser;
}
export function getJobDisplayDescription(job: PublicPartnerJob): string {
  const description = job.description.trim();
  if (description) return description;
  const title = getJobDisplayTitle(job);
  const genericFallback = genericTypeOnPartnerTitle(
    getJobTypeBadgeLabel(job),
    partnerDisplayName(job),
  );
  if (title && title !== genericFallback) return title;
  return "Complete this task on the partner site for full requirements and payout details.";
}
export function formatJobPostedAge(job: Pick<PublicPartnerJob, "firstSeenAt">): string | null {
  const seen = job.firstSeenAt?.trim();
  if (!seen) return null;
  const at = new Date(seen);
  if (Number.isNaN(at.getTime())) return null;
  return `Posted ${timeAgo(at)} ago`;
}
export function formatJobExpiry(job: Pick<PublicPartnerJob, "expiresAt">): string | null {
  const raw = job.expiresAt?.trim();
  if (!raw) return null;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return null;
  if (at.getTime() < Date.now()) return "Expired";
  return `Expires ${at.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}
export function formatJobReward(job: Pick<PublicPartnerJob, "rewardAmount" | "rewardCurrency">): string | null {
  if (!job.rewardAmount) return null;
  const amount = job.rewardAmount.trim();
  if (!amount) return null;
  const currency = (job.rewardCurrency || "").trim().toUpperCase();
  if (currency === "USD") return `$${amount}`;
  if (currency === "SOL") return `${amount} SOL`;
  if (currency === "USDC") return `${amount} USDC`;
  if (currency === "WURK") return `${formatWurkTokenAmount(amount)} $WURK`;
  if (currency) return `${amount} ${currency}`;
  return amount;
}
function formatWurkTokenAmount(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2).replace(/\.?0+$/, "");
  return n.toFixed(4).replace(/\.?0+$/, "");
}
function looksLikeBriefBodyCopy(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.startsWith("task:") ||
    lower.startsWith("give this") ||
    lower.includes("your article should") ||
    lower.includes("rules:") ||
    lower.includes("requirements:")
  );
}