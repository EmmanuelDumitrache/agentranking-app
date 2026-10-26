"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { PublicPartnerJob } from "@/lib/jobs/types";
import {
  formatJobExpiry,
  formatJobPostedAge,
  formatJobReward,
  getJobCardTeaser,
  getJobCardTitle,
} from "@/lib/jobs/display";
import { getJobAgentInstructionPreview } from "@/lib/jobs/agent-instructions";
import { getJobStatusBadge, getJobTypeBadgeLabel } from "@/lib/jobs/job-badges";
import { PartnerLogo } from "@/components/jobs/partner-logo";
import { JobsStatusPill } from "@/components/jobs/jobs-status-pill";
import { trackJobEvent } from "@/lib/jobs/track-client";
import { isAgentReadyJob } from "@/lib/jobs/agent-ready";
type Props = {
  readonly job: PublicPartnerJob;
};
export function PartnerJobCard({ job }: Props) {
  const title = getJobCardTitle(job);
  const rewardLabel = formatJobReward(job);
  const typeLabel = getJobTypeBadgeLabel(job);
  const postedAge = formatJobPostedAge(job);
  const expiryLabel = formatJobExpiry(job);
  const timingParts = [postedAge, expiryLabel].filter(Boolean);
  const agentPreview = getJobAgentInstructionPreview(job);
  const status = getJobStatusBadge(job.status, job.lastSeenAt);
  const teaser = agentPreview ?? getJobCardTeaser(job);
  const agentReady = isAgentReadyJob(job);
  return (
    <article className="jobs-card">
      <div className="jobs-card-header">
        <div className="jobs-card-partner">
          <PartnerLogo source={job.source} variant="icon" size="xs" />
          <span className="jobs-card-partner-name">{job.partnerDisplayName}</span>
          <span className="jobs-card-dot" aria-hidden>
            ·
          </span>
          <span className="jobs-card-type">{typeLabel}</span>
        </div>
        {rewardLabel ? (
          <span className="jobs-card-reward">{rewardLabel}</span>
        ) : (
          <JobsStatusPill label={status.label} active={status.variant === "open"} muted />
        )}
      </div>
      <h3 className="jobs-card-title">
        <Link
          href={`/jobs/${job.id}`}
          onClick={() => {
            void trackJobEvent({ eventType: "job_clicked", jobId: job.id, source: job.source });
          }}
          className="jobs-card-title-link"
        >
          {title}
        </Link>
      </h3>
      {teaser ? (
        <p className="jobs-card-teaser">
          {agentPreview ? (
            <>
              <span className="jobs-card-teaser-label">Agent instructions · </span>
              {teaser}
            </>
          ) : (
            teaser
          )}
        </p>
      ) : null}
      <div className="jobs-card-footer">
        <div className="jobs-card-meta">
          {timingParts.length > 0 ? <span>{timingParts.join(" · ")}</span> : null}
          {agentReady ? <JobsStatusPill label="Agent-ready" active className="jobs-card-ready-pill" /> : null}
        </div>
        <Link
          href={`/jobs/${job.id}`}
          onClick={() => {
            void trackJobEvent({ eventType: "job_clicked", jobId: job.id, source: job.source });
          }}
          className="jobs-card-link"
        >
          View job
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </article>
  );
}