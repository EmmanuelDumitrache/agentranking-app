import type { PartnerJob } from "@/generated/prisma/client";
import { isAgentReadyJob } from "@/lib/jobs/agent-ready";
import { resolvePartnerJobApplyUrl } from "@/lib/jobs/partner-job-urls";
import type { PublicPartnerJob } from "@/lib/jobs/types";
const SECRET_KEYS = new Set([
  "secret",
  "agent_token",
  "agentToken",
  "api_key",
  "apiKey",
  "source_secret",
  "sourceSecret",
  "payment-signature",
  "payment_signature",
  "authorization",
  "x-api-key",
]);
function sanitizeJson(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map(sanitizeJson);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(k)) continue;
      out[k] = sanitizeJson(v);
    }
    return out;
  }
  return value;
}
type PublicJobRow = Pick<
  PartnerJob,
  | "id"
  | "source"
  | "externalId"
  | "title"
  | "description"
  | "category"
  | "jobType"
  | "rewardAmount"
  | "rewardCurrency"
  | "chain"
  | "status"
  | "applyUrl"
  | "sourceJobUrl"
  | "requirements"
  | "tags"
  | "firstSeenAt"
  | "lastSeenAt"
  | "expiresAt"
  | "ingestionMode"
  | "featured"
>;
export function toPublicPartnerJob(
  row: PublicJobRow,
  partnerDisplayName: string,
): PublicPartnerJob {
  const ingestionMode = row.ingestionMode ?? "api";
  const applyUrl = resolvePartnerJobApplyUrl({
    source: row.source,
    externalId: row.externalId,
    applyUrl: row.applyUrl,
    sourceJobUrl: row.sourceJobUrl,
  });
  const base = {
    id: row.id,
    source: row.source,
    externalId: row.externalId,
    title: row.title,
    description: row.description,
    category: row.category,
    jobType: row.jobType,
    rewardAmount: row.rewardAmount != null ? row.rewardAmount.toString() : null,
    rewardCurrency: row.rewardCurrency,
    chain: row.chain,
    status: row.status,
    applyUrl,
    sourceJobUrl: applyUrl,
    sourceStatusUrl: null,
    requirements: sanitizeJson(row.requirements),
    tags: row.tags,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    partnerDisplayName,
    ingestionMode,
    featured: row.featured ?? false,
    curatedListing: ingestionMode === "manual",
  };
  return {
    ...base,
    agentReady: isAgentReadyJob(base),
  };
}
/** Fields safe to select in public API queries — never include sourceSecret or raw. */
export const PUBLIC_PARTNER_JOB_SELECT = {
  id: true,
  source: true,
  externalId: true,
  title: true,
  description: true,
  category: true,
  jobType: true,
  rewardAmount: true,
  rewardCurrency: true,
  chain: true,
  status: true,
  applyUrl: true,
  sourceJobUrl: true,
  requirements: true,
  tags: true,
  firstSeenAt: true,
  lastSeenAt: true,
  expiresAt: true,
  ingestionMode: true,
  featured: true,
} as const;
export const PUBLIC_JOB_LIST_WHERE = {
  status: { in: ["open", "paused"] as string[] },
  isSample: false,
} as const;