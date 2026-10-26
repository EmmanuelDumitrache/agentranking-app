import type { PartnerJobSource } from "@/lib/jobs/types";
import {
  getPartnerApiKey,
  getPartnerFeedUrl,
  hasWurkListEndpointConfigured,
  wurkRequiresApiKey,
} from "@/lib/jobs/partner-env";
export type JobPartnerBrand = {
  source: PartnerJobSource;
  displayName: string;
  shortDescription: string;
  longDescription?: string;
  cardDescription: string;
  websiteUrl: string;
  docsUrl?: string;
  logoUrl: string;
  logoDarkUrl?: string;
  wordmarkUrl?: string;
  accentClass: string;
  categories: string[];
  trustLabel: string;
};
export const JOB_PARTNER_BRANDS: Record<PartnerJobSource, JobPartnerBrand> = {
  earnfi: {
    source: "earnfi",
    displayName: "EarnFi",
    shortDescription: "Solana work, campaigns, contests, and execution workflows.",
    cardDescription:
      "Campaigns, contests, social tasks, and real-world work flows for agents and communities.",
    longDescription:
      "EarnFi surfaces campaigns, social tasks, contests, creator/community jobs, and agent execution workflows on Solana.",
    websiteUrl: "https://app.earnfi.fun",
    docsUrl: "https://docs.earnfi.fun",
    logoUrl: "/partners/earnfi/icon.png",
    wordmarkUrl: "/partners/earnfi/wordmark.png",
    logoDarkUrl: "/partners/earnfi/wordmark.png",
    accentClass: "text-sky-400 border-sky-500/30 bg-sky-500/10",
    categories: ["campaigns", "social", "contests", "creator", "community", "execution"],
    trustLabel: "Work execution partner",
  },
  wurk: {
    source: "wurk",
    displayName: "WURK",
    shortDescription:
      "Agent-to-human microtasks for feedback, reviews, tagging, social/community tasks, and execution workflows.",
    cardDescription:
      "Agent-to-human microtasks for feedback, reviews, tagging, social/community tasks, and execution workflows.",
    longDescription:
      "WURK is an agent-to-human execution rail using x402, MPP, MCP, OpenAPI, and OpenClaw. Agents hire humans for feedback, polls, reviews, tagging, moderation, and social tasks.",
    websiteUrl: "https://wurk.fun",
    docsUrl: "https://wurk.fun/docs",
    logoUrl: "/partners/wurk/icon.png",
    accentClass: "text-violet-400 border-violet-500/30 bg-violet-500/10",
    categories: [
      "human_feedback",
      "reviews",
      "polls",
      "tagging",
      "social",
      "community",
      "human-in-loop",
    ],
    trustLabel: "Human-in-loop partner",
  },
};
export function getJobPartnerBrand(source: string): JobPartnerBrand | null {
  if (source === "earnfi" || source === "wurk") {
    return JOB_PARTNER_BRANDS[source];
  }
  return null;
}
export type PartnerSourceDisplayStatus =
  | "active"
  | "missing_api_key"
  | "awaiting_feed"
  | "sync_pending"
  | "sync_failed"
  | "cached"
  | "disabled";
export type PartnerSourceIngestionCounts = {
  api?: number;
  feed?: number;
  manual?: number;
  seed?: number;
};
export type PartnerSourceStatusInput = {
  source: string;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  jobCount: number;
  jobsByIngestionMode?: PartnerSourceIngestionCounts;
};
export type PartnerSourceStatusResult = {
  displayStatus: PartnerSourceDisplayStatus;
  statusDetail: string;
};
export const PARTNER_SOURCE_STATUS_LABELS: Record<PartnerSourceDisplayStatus, string> = {
  active: "Active",
  missing_api_key: "Missing API key",
  awaiting_feed: "Awaiting feed",
  sync_pending: "Sync pending",
  sync_failed: "Sync failed",
  cached: "Cached",
  disabled: "Disabled",
};
export const WURK_AWAITING_FEED_DETAIL =
  "No WURK feed is configured. Set WURK_JOBS_FEED_URL or configure the WURK open-jobs endpoints.";
export const WURK_ROUTE_HUMAN_WORK_URL = "https://wurk.fun/docs";
export function resolvePartnerSourceStatus(
  meta: PartnerSourceStatusInput,
): PartnerSourceStatusResult {
  if (!meta.enabled) {
    return { displayStatus: "disabled", statusDetail: "Partner source is disabled." };
  }
  const source = meta.source as PartnerJobSource;
  const feedUrl = getPartnerFeedUrl(source);
  const apiKey = getPartnerApiKey(source);
  const ingestion = meta.jobsByIngestionMode ?? {};
  const syncedJobCount =
    (ingestion.api ?? 0) + (ingestion.feed ?? 0);
  const manualJobCount = ingestion.manual ?? 0;
  if (source === "wurk") {
    const hasListEndpoints = hasWurkListEndpointConfigured();
    if (!feedUrl && !hasListEndpoints) {
      if (manualJobCount > 0) {
        return {
          displayStatus: "cached",
          statusDetail: `${manualJobCount} curated listing(s) available. ${WURK_AWAITING_FEED_DETAIL}`,
        };
      }
      return {
        displayStatus: "awaiting_feed",
        statusDetail: WURK_AWAITING_FEED_DETAIL,
      };
    }
    if (hasListEndpoints && wurkRequiresApiKey() && !apiKey) {
      return {
        displayStatus: "missing_api_key",
        statusDetail: "WURK partner API paths require WURK_API_KEY to sync.",
      };
    }
  } else if (!feedUrl && !apiKey) {
    return {
      displayStatus: "missing_api_key",
      statusDetail: "Configure API key or partner feed URL to sync listings.",
    };
  }
  if (!meta.lastSyncAt) {
    if (source === "wurk" && manualJobCount > 0 && syncedJobCount === 0) {
      return {
        displayStatus: "cached",
        statusDetail: `${manualJobCount} curated listing(s) available.`,
      };
    }
    return {
      displayStatus: "sync_pending",
      statusDetail: "Partner source is connected; awaiting first sync.",
    };
  }
  const hasCachedJobs = meta.jobCount > 0;
  const hasSyncedListings = syncedJobCount > 0;
  const syncFailed = meta.lastSyncStatus === "error";
  const syncPartial = meta.lastSyncStatus === "partial" && Boolean(meta.lastSyncError);
  if (source === "wurk" && hasSyncedListings) {
    return {
      displayStatus: "active",
      statusDetail: hasCachedJobs ? "Listings available." : "Synced; no open listings yet.",
    };
  }
  if (source === "wurk" && !hasSyncedListings && manualJobCount > 0) {
    return {
      displayStatus: "cached",
      statusDetail:
        meta.lastSyncError?.slice(0, 120) ??
        `${manualJobCount} curated listing(s) available while live feed is pending.`,
    };
  }
  if ((syncFailed || syncPartial) && hasCachedJobs) {
    return {
      displayStatus: "cached",
      statusDetail: meta.lastSyncError?.slice(0, 120) ?? "Using cached listings from last sync.",
    };
  }
  if (syncFailed) {
    return {
      displayStatus: "sync_failed",
      statusDetail: meta.lastSyncError?.slice(0, 120) ?? "Last sync failed.",
    };
  }
  if (meta.lastSyncStatus === "ok" || hasCachedJobs) {
    return {
      displayStatus: "active",
      statusDetail: hasCachedJobs ? "Listings available." : "Synced; no open listings yet.",
    };
  }
  return {
    displayStatus: "sync_pending",
    statusDetail: "Awaiting sync.",
  };
}
