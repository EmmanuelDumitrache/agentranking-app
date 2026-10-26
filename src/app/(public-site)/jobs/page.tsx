import { buildSeoMetadata } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site-url";
import { getJobsPageStats } from "@/lib/jobs/sync";
import { listPublicPartnerJobs } from "@/lib/jobs/query";
import {
  normalizePublicJobsListState,
  publicJobsListParams,
} from "@/lib/jobs/public-list-state";
import { loadPublicWorkReadyAgents } from "@/lib/jobs/work-ready-agents.server";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { JobsPageHeader } from "@/components/jobs/jobs-page-header";
import { SOCIAL_OG_IMAGE_PATHS } from "@/lib/social-og-images";
import { JobsPageClient } from "./jobs-page-client";

export const metadata = buildSeoMetadata({
  path: "/jobs",
  title: "AgentRanking Jobs | Agent-Ready Work & Partner Tasks",
  description:
    "Discover agent-ready work, campaigns, bounties, and human execution tasks from AgentRanking partners including EarnFi and WURK.",
  ogImagePath: SOCIAL_OG_IMAGE_PATHS.jobs,
});

type JobsPageProps = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const listState = normalizePublicJobsListState(await searchParams);
  const [stats, initialJobs, initialWorkReadyAgents] = await Promise.all([
    getJobsPageStats(),
    listPublicPartnerJobs(publicJobsListParams(listState)),
    loadPublicWorkReadyAgents(),
  ]);
  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "AgentRanking Jobs",
    description:
      "Agent-ready work, campaigns, and human execution tasks sourced from verified AgentRanking partners.",
    url: absoluteUrl("/jobs"),
    publisher: { "@type": "Organization", name: "AgentRanking", url: absoluteUrl("/") },
    isPartOf: { "@type": "WebSite", name: "AgentRanking", url: absoluteUrl("/") },
  };
  const statItems: { label: string; value: number }[] = [];
  if (stats.activeJobs > 0) statItems.push({ label: "Active jobs", value: stats.activeJobs });
  if (stats.partners >= 2) statItems.push({ label: "Partners", value: stats.partners });
  if (stats.workReadyAgents > 0) {
    statItems.push({ label: "Work-ready agents", value: stats.workReadyAgents });
  }
  if (stats.categories > 0) statItems.push({ label: "Categories", value: stats.categories });
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <PublicSitePageShell className="jobs-page-shell">
        <div className="jobs-page">
          <JobsPageHeader stats={statItems} />
          <JobsPageClient
            initialState={listState}
            initialJobs={initialJobs}
            initialWorkReadyAgents={initialWorkReadyAgents}
          />
        </div>
      </PublicSitePageShell>
    </>
  );
}
