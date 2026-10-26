import type { PublicPartnerJob } from "@/lib/jobs/types";
export type JobStatusBadge = "open" | "closed" | "paused" | "stale" | "sync_pending";
export function getJobStatusBadge(
  status: string,
  lastSeenAt?: string | null,
): { label: string; variant: JobStatusBadge } {
  const s = status.toLowerCase();
  if (s === "open") return { label: "Open", variant: "open" };
  if (s === "paused") return { label: "Open", variant: "open" };
  if (s === "closed") {
    if (lastSeenAt) {
      const days = (Date.now() - new Date(lastSeenAt).getTime()) / (1000 * 60 * 60 * 24);
      if (days > 14) return { label: "Stale", variant: "stale" };
    }
    return { label: "Closed", variant: "closed" };
  }
  if (s === "sync_pending") return { label: "Sync pending", variant: "sync_pending" };
  return { label: status, variant: "closed" };
}
export function getJobTypeBadgeLabel(job: Pick<PublicPartnerJob, "category" | "jobType" | "tags" | "source">): string {
  const category = job.category?.trim();
  const jobType = job.jobType?.trim();
  if (job.source === "wurk" && jobType) return formatLabel(jobType);
  if (category) return formatLabel(category);
  if (jobType) return formatLabel(jobType);
  if (job.tags.length > 0) return formatLabel(job.tags[0] ?? "");
  if (job.source === "wurk") return "Human-in-loop";
  return "Task";
}
const TYPE_LABELS: Record<string, string> = {
  human_feedback: "Human-in-loop",
  human_in_loop: "Human-in-loop",
  on_chain: "On-chain",
  social: "Social",
  feedback: "Feedback",
  research: "Research",
  growth: "Growth",
  contest: "Contest",
  contests: "Contest",
  manual: "Manual",
  campaign: "Growth",
  repost: "Social",
  challenge: "Contest",
  comment: "Social",
  like: "Social",
  follow: "Social",
  moderation: "Moderation",
  tagging: "Tagging",
  ranking: "Ranking",
};
function formatLabel(raw: string): string {
  const key = raw.toLowerCase().replace(/\s+/g, "_");
  if (TYPE_LABELS[key]) return TYPE_LABELS[key]!;
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}