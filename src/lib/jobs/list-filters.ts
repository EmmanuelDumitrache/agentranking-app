import type { JobMinRewardFilter, JobPostedWithinFilter } from "@/lib/jobs/types";
export function parseMinRewardFilter(value: string | undefined): JobMinRewardFilter {
  if (value === "0.1" || value === "1" || value === "10") return value;
  return "any";
}
export function parsePostedWithinFilter(value: string | undefined): JobPostedWithinFilter {
  if (value === "24h" || value === "7d" || value === "30d") return value;
  return "all";
}
export function minRewardThreshold(filter: JobMinRewardFilter): number | null {
  if (filter === "any") return null;
  return Number(filter);
}
export function postedWithinCutoff(filter: JobPostedWithinFilter): Date | null {
  const hours =
    filter === "24h" ? 24 : filter === "7d" ? 24 * 7 : filter === "30d" ? 24 * 30 : null;
  if (hours == null) return null;
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}