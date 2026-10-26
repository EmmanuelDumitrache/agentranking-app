"use client";
import Link from "next/link";
import { memo } from "react";
import { AlertTriangle, BadgeCheck, ChevronDown, Loader2 } from "lucide-react";
import { getDashboardHomeUrl } from "@/lib/site-url";
import { cn, timeAgo, truncateAddress } from "@/lib/utils";
import type { SocialProfileListItem } from "@/components/social/social-types";
import {
  profileDisplayName,
  reputationClass,
  SocialProfileAvatar,
} from "@/components/social/social-profile-card";
import { SocialFollowButton } from "@/components/social/social-follow-button";
import type { SocialViewerSnapshot } from "@/components/social/social-types";
const ProfileRow = memo(function ProfileRow({ profile, initialViewer }: { readonly profile: SocialProfileListItem; readonly initialViewer: SocialViewerSnapshot }) {
  const href = `/profiles/${profile.walletAddress}`;
  const name = profileDisplayName(profile);
  const repLabel =
    profile.reputation.status === "ok"
      ? profile.reputation.label
      : "Not enough signals yet";
  const lastLabel = profile.aggregate.lastActiveAt
    ? timeAgo(profile.aggregate.lastActiveAt)
    : timeAgo(profile.createdAt);
  return (
    <tr className="social-directory-row">
      <td className="social-directory-cell social-directory-cell--profile">
        <Link href={href} className="social-directory-profile-link">
          <SocialProfileAvatar profile={profile} size="sm" />
          <span className="min-w-0">
            <span className="social-directory-name-row">
              {profile.profileVerified ? (
                <BadgeCheck className="social-verified-icon" aria-hidden />
              ) : null}
              <span className="social-directory-name">{name}</span>
            </span>
            <span className="social-directory-handle">
              {profile.username ? `@${profile.username}` : truncateAddress(profile.walletAddress, 4)}
            </span>
          </span>
        </Link>
      </td>
      <td className="social-directory-cell social-directory-cell--num">
        {profile.aggregate.linkedAgentCount}
      </td>
      <td className="social-directory-cell social-directory-cell--num">
        {profile.aggregate.linkedAgentCount > 0 ? profile.aggregate.avgArScore : "—"}
      </td>
      <td className={cn("social-directory-cell social-directory-cell--center", reputationClass(repLabel))}>
        {repLabel}
      </td>
      <td className="social-directory-cell social-directory-cell--center">
        {profile.profileVerified ? (
          <span className="social-verified-yes">Yes</span>
        ) : (
          <span className="social-directory-muted">—</span>
        )}
      </td>
      <td className="social-directory-cell social-directory-cell--tags">
        <div className="social-directory-tags">
          {profile.protocolTags.slice(0, 2).map((tag) => (
            <span key={tag} className="social-tag">
              {tag}
            </span>
          ))}
        </div>
      </td>
      <td className="social-directory-cell social-directory-cell--meta">{lastLabel}</td>
      <td className="social-directory-cell social-directory-cell--actions">
        <div className="social-directory-actions">
          <SocialFollowButton
            targetWallet={profile.walletAddress}
            followOptions={{ targetLabel: name }}
            initialFollowerAddress={initialViewer.followerAddress}
            initialFollowing={initialViewer.followingByWallet[profile.walletAddress.toLowerCase()]}
          />
          <Link href={href} className="ar-btn ar-btn-secondary social-directory-view-btn">
            View
          </Link>
        </div>
      </td>
    </tr>
  );
});
export function SocialProfileDirectory({
  profiles,
  total,
  totalIsExact = true,
  isLoading,
  isError,
  onRetry,
  hasMore,
  onLoadMore,
  loadingMore,
  emptyMessage,
  initialViewer,
}: {
  readonly profiles: SocialProfileListItem[];
  readonly total?: number;
  readonly totalIsExact?: boolean;
  readonly isLoading?: boolean;
  readonly isError?: boolean;
  readonly onRetry?: () => void;
  readonly hasMore?: boolean;
  readonly onLoadMore?: () => void;
  readonly loadingMore?: boolean;
  readonly emptyMessage?: string;
  readonly initialViewer: SocialViewerSnapshot;
}) {
  return (
    <section className="social-directory">
      <header className="social-directory-header">
        <h2 className="social-section-title">Directory</h2>
        {!isLoading && !isError && profiles.length > 0 && total != null ? (
          <span className="social-directory-count">
            {total.toLocaleString()}{totalIsExact ? "" : "+"} profiles
          </span>
        ) : null}
      </header>
      {isLoading ? (
        <div className="social-directory-state" role="status" aria-busy="true">
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          Loading profiles…
        </div>
      ) : null}
      {isError && profiles.length === 0 ? (
        <div className="social-directory-error" role="alert">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Could not load profiles.</span>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="social-directory-retry">
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {!isLoading && !isError && profiles.length === 0 ? (
        <div className="social-empty">
          <p className="social-empty-title">{emptyMessage ?? "No profiles found."}</p>
          <p className="social-empty-copy">
            Claim or verify an agent to build your profile reputation.
          </p>
          <Link href={getDashboardHomeUrl()} className="ar-btn ar-btn-primary social-empty-cta">
            Open Agent Dashboard
          </Link>
        </div>
      ) : null}
      {!isLoading && !isError && profiles.length > 0 ? (
        <>
          <div className="social-directory-table-wrap">
            <div className="social-directory-table-scroll">
              <table className="social-directory-table">
                <colgroup>
                  <col className="social-directory-col social-directory-col--profile" />
                  <col className="social-directory-col social-directory-col--num" />
                  <col className="social-directory-col social-directory-col--num" />
                  <col className="social-directory-col social-directory-col--rep" />
                  <col className="social-directory-col social-directory-col--verified" />
                  <col className="social-directory-col social-directory-col--tags" />
                  <col className="social-directory-col social-directory-col--meta" />
                  <col className="social-directory-col social-directory-col--actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" className="social-directory-th social-directory-th--profile">
                      Profile
                    </th>
                    <th scope="col" className="social-directory-th social-directory-th--num">
                      Agents
                    </th>
                    <th scope="col" className="social-directory-th social-directory-th--num">
                      Avg AR
                    </th>
                    <th scope="col" className="social-directory-th social-directory-th--center">
                      Reputation
                    </th>
                    <th scope="col" className="social-directory-th social-directory-th--center">
                      Verified
                    </th>
                    <th scope="col" className="social-directory-th social-directory-th--tags">
                      Protocols
                    </th>
                    <th scope="col" className="social-directory-th social-directory-th--meta">
                      Active
                    </th>
                    <th scope="col" className="social-directory-th social-directory-th--actions">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => (
                    <ProfileRow key={profile.id} profile={profile} initialViewer={initialViewer} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {hasMore ? (
            <div className="social-load-more">
              <button
                type="button"
                disabled={loadingMore}
                onClick={onLoadMore}
                className="ar-btn ar-btn-secondary social-load-more-btn"
              >
                {loadingMore ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                )}
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
