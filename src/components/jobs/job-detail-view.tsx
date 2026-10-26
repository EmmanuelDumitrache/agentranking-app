"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { PublicPartnerJob } from "@/lib/jobs/types";
import type { MatchedAgent } from "@/lib/jobs/matching";
import {
  getJobAgentInstructions,
  shouldShowRequirementsSection,
} from "@/lib/jobs/agent-instructions";
import { getJobPartnerBrand } from "@/lib/jobs/partners/branding";
import { getJobStatusBadge, getJobTypeBadgeLabel } from "@/lib/jobs/job-badges";
import {
  formatJobExpiry,
  formatJobPostedAge,
  formatJobReward,
  getJobDisplayDescription,
  getJobDisplayTitle,
} from "@/lib/jobs/display";
import { formatJobPosterLine } from "@/lib/jobs/job-poster";
import { isAgentReadyJob } from "@/lib/jobs/agent-ready";
import { PartnerLogo } from "@/components/jobs/partner-logo";
import { JobsStatusPill } from "@/components/jobs/jobs-status-pill";
import { WorkReadyBadge } from "@/components/jobs/work-ready-badge";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { cn } from "@/lib/utils";
type Props = {
  readonly job: PublicPartnerJob;
  readonly matchedAgents: MatchedAgent[];
  readonly onPartnerOpen?: () => void;
};
export function JobDetailView({ job, matchedAgents, onPartnerOpen }: Props) {
  const brand = getJobPartnerBrand(job.source);
  const rewardLabel = formatJobReward(job);
  const title = getJobDisplayTitle(job);
  const description = getJobDisplayDescription(job);
  const agentInstructions = getJobAgentInstructions(job);
  const showRequirements = shouldShowRequirementsSection(job.requirements, agentInstructions);
  const status = getJobStatusBadge(job.status, job.lastSeenAt);
  const posted = formatJobPostedAge(job);
  const expiry = formatJobExpiry(job);
  const typeLabel = getJobTypeBadgeLabel(job);
  const posterLine = formatJobPosterLine(job);
  const showAbout = shouldShowAboutSection(title, description, agentInstructions);
  const metaParts = [
    posterLine,
    posted,
    expiry,
    isAgentReadyJob(job) ? "Agent-ready" : null,
  ].filter(Boolean);
  return (
    <article className="jobs-detail">
      <header className="jobs-detail-header">
        <div className="jobs-detail-partner">
          <PartnerLogo source={job.source} variant="icon" size="sm" />
          <span className="jobs-detail-partner-name">{job.partnerDisplayName}</span>
          <span className="jobs-card-dot" aria-hidden>
            ·
          </span>
          <span>{typeLabel}</span>
        </div>
        <h1 className="jobs-detail-title">{title}</h1>
        {metaParts.length > 0 ? <p className="jobs-detail-meta">{metaParts.join(" · ")}</p> : null}
        <dl className="jobs-detail-stats">
          <StatCell label="Pay">{rewardLabel ?? "—"}</StatCell>
          <StatCell label="Status">
            <JobsStatusPill
              label={status.label}
              active={status.variant === "open"}
              muted={status.variant !== "open"}
            />
          </StatCell>
          <StatCell label="Posted">{posted?.replace(/^Posted /, "") ?? "—"}</StatCell>
          <StatCell label="Type">{typeLabel}</StatCell>
        </dl>
        <JobDetailCta job={job} onOpen={onPartnerOpen} />
      </header>
      {agentInstructions ? (
        <section className="jobs-detail-section">
          <h2 className="jobs-detail-section-title">What to do</h2>
          <div className="jobs-detail-panel">
            <p className="jobs-detail-body">{formatBody(agentInstructions)}</p>
          </div>
        </section>
      ) : null}
      {showAbout ? (
        <section className="jobs-detail-section">
          <h2 className="jobs-detail-section-title">About</h2>
          <p className="jobs-detail-body jobs-detail-body--muted">{formatBody(description)}</p>
        </section>
      ) : null}
      {showRequirements ? <RequirementsSection requirements={job.requirements} /> : null}
      <section className="jobs-detail-section">
        <div className="jobs-detail-section-head">
          <h2 className="jobs-detail-section-title">Matching agents</h2>
          <Link href="/jobs#work-ready" className="jobs-text-link">
            Browse agents
          </Link>
        </div>
        {matchedAgents.length === 0 ? (
          <p className="jobs-detail-body jobs-detail-body--muted">
            No close matches yet. You can still complete this job on {job.partnerDisplayName}.
          </p>
        ) : (
          <ul className="jobs-agent-list">
            {matchedAgents.map((agent) => (
              <li key={agent.id} className="jobs-agent-row">
                <AgentAvatar image={agent.image} name={agent.name} size="sm" className="jobs-agent-avatar" />
                <div className="jobs-agent-copy">
                  <div className="jobs-agent-name-row">
                    <span className="jobs-agent-name">{agent.name}</span>
                    <WorkReadyBadge
                      agent={{
                        workReadyStatus: agent.workReadyStatus,
                        featuredWorkReady: agent.featuredWorkReady,
                      }}
                      variant="compact"
                    />
                  </div>
                  <p className="jobs-agent-meta">
                    AR {agent.agentRankScore}
                    {agent.archetype ? ` · ${agent.archetype}` : ""}
                  </p>
                  <Link
                    href={agent.profilePath}
                    className="jobs-text-link jobs-agent-profile-link"
                  >
                    View profile
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <footer className="jobs-detail-footer">
        <p className="jobs-detail-footer-title">{job.partnerDisplayName}</p>
        <p className="jobs-detail-body jobs-detail-body--muted">
          {brand?.shortDescription ??
            "Listings are synced from the partner marketplace on a regular schedule."}
        </p>
        <div className="jobs-detail-footer-links">
          {brand?.docsUrl ? (
            <a
              href={brand.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="jobs-text-link jobs-detail-footer-link"
            >
              Partner docs
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : null}
          {brand?.websiteUrl ? (
            <a
              href={brand.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="jobs-text-link"
            >
              {brand.websiteUrl.replace(/^https?:\/\//, "")}
            </a>
          ) : null}
        </div>
        <p className="jobs-detail-ref">
          {job.chain ? `${formatLabel(job.chain)} · ` : null}
          Ref {job.externalId}
        </p>
      </footer>
    </article>
  );
}
function StatCell({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="jobs-detail-stat">
      <dt className="jobs-detail-stat-label">{label}</dt>
      <dd className="jobs-detail-stat-value">{children}</dd>
    </div>
  );
}
function shouldShowAboutSection(
  title: string,
  description: string,
  agentInstructions: string | null,
): boolean {
  const about = description.trim();
  if (!about) return false;
  if (agentInstructions && normalizeText(about) === normalizeText(agentInstructions)) return false;
  if (normalizeText(about) === normalizeText(title)) return false;
  return true;
}
function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
function formatLabel(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function formatBody(text: string): string {
  const trimmed = text?.trim();
  if (!trimmed) return "No details provided.";
  return trimmed.replace(/\n{3,}/g, "\n\n");
}
function RequirementsSection({ requirements }: { readonly requirements: unknown }) {
  if (requirements == null) return null;
  if (typeof requirements === "string" && requirements.trim()) {
    return (
      <section className="jobs-detail-section">
        <h2 className="jobs-detail-section-title">Requirements</h2>
        <p className="jobs-detail-body jobs-detail-body--muted whitespace-pre-wrap">{requirements}</p>
      </section>
    );
  }
  if (Array.isArray(requirements) && requirements.length > 0) {
    return (
      <section className="jobs-detail-section">
        <h2 className="jobs-detail-section-title">Requirements</h2>
        <ul className="jobs-detail-list">
          {requirements.map((item, i) => (
            <li key={i}>{String(item)}</li>
          ))}
        </ul>
      </section>
    );
  }
  if (typeof requirements === "object") {
    const hiddenKeys = new Set([
      "agent_instructions",
      "agentInstructions",
      "posted_by",
      "postedBy",
      "creator_handle",
      "creatorHandle",
      "creator_name",
      "creatorName",
    ]);
    const entries = Object.entries(requirements as Record<string, unknown>).filter(
      ([key, value]) => value != null && value !== "" && !hiddenKeys.has(key),
    );
    if (entries.length === 0) return null;
    return (
      <section className="jobs-detail-section">
        <h2 className="jobs-detail-section-title">Requirements</h2>
        <ul className="jobs-detail-kv-list">
          {entries.map(([key, value]) => (
            <li key={key}>
              <span className="jobs-detail-kv-key">{key.replace(/_/g, " ")}: </span>
              {String(value)}
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return null;
}
export function JobDetailCta({
  job,
  onOpen,
  className,
}: {
  readonly job: PublicPartnerJob;
  readonly onOpen?: () => void;
  readonly className?: string;
}) {
  return (
    <a
      href={job.applyUrl || job.sourceJobUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpen}
      className={cn("ar-btn ar-btn-primary jobs-detail-cta", className)}
    >
      Apply on {job.partnerDisplayName}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
    </a>
  );
}
