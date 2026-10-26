import type { PublicPartnerJob } from "@/lib/jobs/types";
const WURK_AGENT_TYPES = new Set([
  "feedback",
  "review",
  "moderation",
  "tagging",
  "ranking",
  "vote",
  "human",
  "human_in_loop",
  "human-in-loop",
  "social",
  "tag",
  "rate",
  "survey",
]);
const EARNFI_AGENT_TYPES = new Set([
  "campaign",
  "contest",
  "social",
  "follow",
  "bounty",
  "execution",
  "agent_task",
  "work",
  "task",
  "creator",
  "community",
]);
const AGENT_READY_CATEGORIES = new Set([
  "social",
  "growth",
  "feedback",
  "human_feedback",
  "research",
  "contest",
  "contests",
  "manual",
  "on_chain",
  "campaign",
  "moderation",
  "tagging",
  "ranking",
]);
const AGENT_READY_TAGS = new Set([
  "social",
  "growth",
  "feedback",
  "review",
  "moderation",
  "tagging",
  "ranking",
  "campaign",
  "contest",
  "bounty",
  "human",
  "agent",
  "execution",
  "twitter",
  "x",
]);
function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}
function matchesSet(value: string, set: Set<string>): boolean {
  const n = norm(value);
  if (!n) return false;
  if (set.has(n)) return true;
  for (const item of set) {
    if (n.includes(item) || item.includes(n)) return true;
  }
  return false;
}
/**
 * A job is agent-ready when it can plausibly be routed to agents, workflows, or human partners.
 * Does not imply full autonomous completion.
 */
export function isAgentReadyJob(job: Pick<
  PublicPartnerJob,
  "source" | "category" | "jobType" | "tags" | "status" | "applyUrl" | "sourceJobUrl"
>): boolean {
  const source = norm(job.source);
  const category = norm(job.category);
  const jobType = norm(job.jobType);
  const tags = job.tags.map(norm);
  const isOpen = job.status === "open" || job.status === "paused";
  const hasLink = Boolean(job.applyUrl?.trim() || job.sourceJobUrl?.trim());
  if (source === "wurk") {
    if (
      matchesSet(category, WURK_AGENT_TYPES) ||
      matchesSet(jobType, WURK_AGENT_TYPES) ||
      tags.some((t) => matchesSet(t, WURK_AGENT_TYPES))
    ) {
      return isOpen && hasLink;
    }
  }
  if (source === "earnfi") {
    if (
      matchesSet(category, EARNFI_AGENT_TYPES) ||
      matchesSet(jobType, EARNFI_AGENT_TYPES) ||
      tags.some((t) => matchesSet(t, EARNFI_AGENT_TYPES))
    ) {
      return isOpen && hasLink;
    }
  }
  if (
    matchesSet(category, AGENT_READY_CATEGORIES) ||
    tags.some((t) => matchesSet(t, AGENT_READY_TAGS))
  ) {
    return isOpen && hasLink;
  }
  return isOpen && hasLink;
}