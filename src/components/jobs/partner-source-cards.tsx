"use client";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  getJobPartnerBrand,
  PARTNER_SOURCE_STATUS_LABELS,
  WURK_AWAITING_FEED_DETAIL,
  WURK_ROUTE_HUMAN_WORK_URL,
  type PartnerSourceDisplayStatus,
} from "@/lib/jobs/partners/branding";
import { PartnerLogo } from "@/components/jobs/partner-logo";
import { JobsStatusPill } from "@/components/jobs/jobs-status-pill";
import { cn } from "@/lib/utils";
import type { PartnerJobSource } from "@/lib/jobs/types";
export type PartnerSourceCardData = {
  source: string;
  displayName: string;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  jobCount: number;
  websiteUrl?: string;
  docsUrl?: string | null;
  displayStatus?: string;
  statusDetail?: string;
};
type Props = {
  readonly partners: PartnerSourceCardData[];
  readonly compact?: boolean;
};
export function PartnerSourceCards({ partners, compact = false }: Props) {
  const ordered = ["earnfi", "wurk"]
    .map((s) => partners.find((p) => p.source === s))
    .filter((p): p is PartnerSourceCardData => Boolean(p));
  if (ordered.length === 0) return null;
  return (
    <section className={cn("jobs-sidebar-panel", compact && "jobs-sidebar-panel--compact")}>
      <h2 className="jobs-sidebar-title">Partner sources</h2>
      {!compact ? (
        <p className="jobs-sidebar-subcopy">Verified partners supplying job listings.</p>
      ) : null}
      <div className="jobs-partner-source-list">
        {ordered.map((partner) => (
          <PartnerSourceCard key={partner.source} partner={partner} compact={compact} />
        ))}
      </div>
    </section>
  );
}
function PartnerSourceCard({
  partner,
  compact,
}: {
  readonly partner: PartnerSourceCardData;
  readonly compact: boolean;
}) {
  const brand = getJobPartnerBrand(partner.source);
  const displayStatus = (partner.displayStatus ?? "sync_pending") as PartnerSourceDisplayStatus;
  const statusLabel = PARTNER_SOURCE_STATUS_LABELS[displayStatus] ?? displayStatus;
  const lastSyncLabel = formatSyncTime(partner.lastSyncAt);
  const isEarnFi = partner.source === "earnfi";
  const isWurk = partner.source === "wurk";
  const statusActive = displayStatus === "active";
  return (
    <article className="jobs-partner-source-card">
      <div className="jobs-partner-source-head">
        <PartnerLogo
          source={partner.source}
          variant={isEarnFi ? "wordmark" : "icon"}
          size={compact ? "sm" : "md"}
        />
        <div className="min-w-0 flex-1">
          <div className="jobs-partner-source-title-row">
            {!isEarnFi ? (
              <h3 className="jobs-partner-source-name">{brand?.displayName ?? partner.displayName}</h3>
            ) : null}
            <JobsStatusPill label={statusLabel} active={statusActive} muted={!statusActive} />
          </div>
          {brand?.trustLabel ? (
            <p className="jobs-partner-source-trust">{brand.trustLabel}</p>
          ) : null}
        </div>
      </div>
      {!compact && brand?.cardDescription ? (
        <p className="jobs-partner-source-desc">{brand.cardDescription}</p>
      ) : null}
      {partner.statusDetail && displayStatus !== "active" ? (
        <p className="jobs-partner-source-detail">
          {isWurk && displayStatus === "awaiting_feed" ? WURK_AWAITING_FEED_DETAIL : partner.statusDetail}
        </p>
      ) : null}
      <dl className="jobs-partner-source-stats">
        <div>
          <dt>Active jobs</dt>
          <dd>{partner.jobCount}</dd>
        </div>
        <div>
          <dt>Last synced</dt>
          <dd>{lastSyncLabel}</dd>
        </div>
      </dl>
      <div className="jobs-partner-source-links">
        <a
          href={brand?.websiteUrl ?? partner.websiteUrl ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="jobs-text-link"
        >
          {isWurk ? "View WURK" : "Visit"}
          <ExternalLink className="h-2.5 w-2.5" aria-hidden />
        </a>
        {brand?.docsUrl || partner.docsUrl ? (
          <Link
            href={brand?.docsUrl ?? partner.docsUrl ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="jobs-text-link jobs-text-link--muted"
          >
            {isWurk ? "Developer docs" : "Docs"}
          </Link>
        ) : null}
        {isWurk ? (
          <a
            href={WURK_ROUTE_HUMAN_WORK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="jobs-text-link"
          >
            Route human work
            <ExternalLink className="h-2.5 w-2.5" aria-hidden />
          </a>
        ) : null}
      </div>
    </article>
  );
}
function formatSyncTime(iso: string | null): string {
  if (!iso) return "Never synced";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
export function buildPartnerSourceCardsFromApi(
  partners: PartnerSourceCardData[],
): PartnerSourceCardData[] {
  return partners;
}
export function defaultPartnerSourceCards(): PartnerSourceCardData[] {
  return (["earnfi", "wurk"] as PartnerJobSource[]).map((source) => {
    const brand = getJobPartnerBrand(source)!;
    const wurkDefaults =
      source === "wurk"
        ? {
            displayStatus: "sync_pending" as const,
            statusDetail: "Marketplace sync runs every 15 minutes.",
          }
        : {
            displayStatus: "missing_api_key" as const,
            statusDetail: "Configure EARNFI_WORK_API_KEY to sync listings.",
          };
    return {
      source,
      displayName: brand.displayName,
      enabled: true,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastSyncError: null,
      jobCount: 0,
      websiteUrl: brand.websiteUrl,
      docsUrl: brand.docsUrl,
      ...wurkDefaults,
    };
  });
}