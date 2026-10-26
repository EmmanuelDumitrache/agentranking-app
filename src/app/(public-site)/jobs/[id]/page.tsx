import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildSeoMetadata } from "@/lib/seo";
import { getJobDisplayTitle, truncateJobText } from "@/lib/jobs/display";
import { getPartnerJobDetail } from "@/lib/jobs/get-partner-job-detail";
import { JOBS_DETAIL_BACK_LABEL } from "@/lib/jobs-page-config";
import { absoluteUrl } from "@/lib/site-url";
import { SOCIAL_OG_IMAGE_PATHS } from "@/lib/social-og-images";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { JobDetailClient } from "./job-detail-client";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const result = await getPartnerJobDetail(id);
  if (!result) return { title: "Job not found | AgentRanking Jobs" };
  const title = getJobDisplayTitle(result.job);
  const description = truncateJobText(
    result.job.description || `Open listing on ${result.job.partnerDisplayName}.`,
    155,
  );
  return buildSeoMetadata({
    path: `/jobs/${id}`,
    title: `${title} | AgentRanking Jobs`,
    description,
    ogImagePath: SOCIAL_OG_IMAGE_PATHS.jobs,
  });
}
export default async function PartnerJobDetailPage({ params }: Props) {
  const { id } = await params;
  const result = await getPartnerJobDetail(id);
  if (!result) notFound();
  const { job, matchedAgents } = result;
  const displayTitle = getJobDisplayTitle(job);
  const schema = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: displayTitle,
    description: job.description,
    datePosted: job.firstSeenAt,
    validThrough: job.expiresAt ?? undefined,
    hiringOrganization: {
      "@type": "Organization",
      name: job.partnerDisplayName,
      url: job.sourceJobUrl,
    },
    url: absoluteUrl(`/jobs/${id}`),
    identifier: {
      "@type": "PropertyValue",
      name: job.partnerDisplayName,
      value: job.externalId,
    },
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <PublicSitePageShell className="jobs-detail-shell">
        <Link href="/jobs" className="jobs-back-link">
          ← {JOBS_DETAIL_BACK_LABEL}
        </Link>
        <JobDetailClient job={job} matchedAgents={matchedAgents} />
      </PublicSitePageShell>
    </>
  );
}
