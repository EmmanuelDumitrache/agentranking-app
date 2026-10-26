import type { PublicPartnerJob } from "@/lib/jobs/types";
import {
  getJobDisplayTitle,
  stripUrlsForPreview,
} from "@/lib/jobs/display";
import { getJobTypeBadgeLabel } from "@/lib/jobs/job-badges";
/** Higher = richer title + description (used for default "Recommended" sort). */
export function scoreJobListingQuality(job: PublicPartnerJob): number {
  const typeLabel = getJobTypeBadgeLabel(job);
  const partnerName = job.partnerDisplayName || (job.source === "earnfi" ? "EarnFi" : "WURK");
  const genericFallback = `${typeLabel} on ${partnerName}`;
  const displayTitle = getJobDisplayTitle(job);
  const description = stripUrlsForPreview(job.description);
  const storedTitle = stripUrlsForPreview(job.title);
  let score = 0;
  if (displayTitle !== genericFallback) score += 45;
  if (description.length >= 80) score += 35;
  else if (description.length >= 30) score += 25;
  else if (description.length >= 12) score += 10;
  if (storedTitle.length >= 20 && storedTitle !== displayTitle) score += 10;
  if (job.rewardAmount && Number(job.rewardAmount) > 0) score += 5;
  if (displayTitle === genericFallback) score -= 40;
  if (description.length < 8) score -= 25;
  if (/^earnfi(\s+\w+)?\s+job$/i.test(storedTitle)) score -= 30;
  return score;
}
export function compareJobsRecommended(a: PublicPartnerJob, b: PublicPartnerJob): number {
  const qualityDelta = scoreJobListingQuality(b) - scoreJobListingQuality(a);
  if (qualityDelta !== 0) return qualityDelta;
  const rewardA = Number(a.rewardAmount ?? 0);
  const rewardB = Number(b.rewardAmount ?? 0);
  if (rewardB !== rewardA) return rewardB - rewardA;
  return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
}
/** Fetch-all cap — current catalog is ~100–600 rows; sort in memory for correct ranking. */
export const JOB_LIST_IN_MEMORY_SORT_CAP = 10000;