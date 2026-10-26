"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import Link from "next/link";
import { memo } from "react";
import { BadgeCheck, Bot } from "lucide-react";
import { SocialFollowButton } from "@/components/social/social-follow-button";
import { cn, truncateAddress } from "@/lib/utils";
import type { SocialProfileListItem } from "@/components/social/social-types";
export function profileDisplayName(profile: SocialProfileListItem): string {
  return profile.displayName || profile.username || truncateAddress(profile.walletAddress, 6);
}
export function reputationClass(label: string): string {
  if (label === "Elite") return "social-rep social-rep--elite";
  if (label === "High") return "social-rep social-rep--high";
  if (label === "Medium") return "social-rep social-rep--medium";
  if (label === "Insufficient data" || label === "Not enough signals yet") {
    return "social-rep social-rep--muted";
  }
  return "social-rep";
}
export function SocialProfileAvatar({
  profile,
  size = "md",
}: {
  readonly profile: SocialProfileListItem;
  readonly size?: "sm" | "md";
}) {
  const className = size === "sm" ? "social-avatar social-avatar--sm" : "social-avatar";
  if (profile.avatarUrl) {
    return (
      <RuntimeImage
        src={profile.avatarUrl}
        alt=""
        className={className}
        loading="lazy"
      />
    );
  }
  return (
    <div className={cn(className, "social-avatar-fallback")}>
      <Bot className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} aria-hidden />
    </div>
  );
}
export const SocialProfileCard = memo(function SocialProfileCard({
  profile,
  initialFollowerAddress,
  initialFollowing,
}: {
  readonly profile: SocialProfileListItem;
  readonly initialFollowerAddress?: string | null;
  readonly initialFollowing?: boolean;
}) {
  const name = profileDisplayName(profile);
  const href = `/profiles/${profile.walletAddress}`;
  const repLabel =
    profile.reputation.status === "ok"
      ? profile.reputation.label
      : "Not enough signals yet";
  return (
    <article className="social-card">
      <Link href={href} className="social-card-identity">
        <SocialProfileAvatar profile={profile} />
        <div className="min-w-0 flex-1">
          <div className="social-card-name-row">
            {profile.profileVerified ? (
              <BadgeCheck className="social-verified-icon" aria-hidden />
            ) : null}
            <span className="social-card-name">{name}</span>
          </div>
          <p className="social-card-handle">
            {profile.username ? `@${profile.username}` : truncateAddress(profile.walletAddress, 4)}
          </p>
        </div>
      </Link>
      <div className="social-card-metrics">
        <div className="social-card-metric">
          <span className="social-card-metric-label">Agents</span>
          <span className="social-card-metric-value">{profile.aggregate.linkedAgentCount}</span>
        </div>
        <div className="social-card-metric">
          <span className="social-card-metric-label">Avg AR</span>
          <span className="social-card-metric-value">
            {profile.aggregate.linkedAgentCount > 0 ? profile.aggregate.avgArScore : "—"}
          </span>
        </div>
      </div>
      {profile.aggregate.topAgentName ? (
        <p className="social-card-top-agent">
          Top: <span>{profile.aggregate.topAgentName}</span>
        </p>
      ) : null}
      <p className={reputationClass(repLabel)}>{repLabel}</p>
      {profile.protocolTags.length > 0 ? (
        <div className="social-card-tags">
          {profile.protocolTags.slice(0, 4).map((tag) => (
            <span key={tag} className="social-tag">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      <div className="social-card-actions">
        <Link href={href} className="ar-btn ar-btn-secondary social-card-view-btn">
          View
        </Link>
        <SocialFollowButton
          targetWallet={profile.walletAddress}
          initialFollowerAddress={initialFollowerAddress}
          initialFollowing={initialFollowing}
          followOptions={{ targetLabel: name }}
        />
      </div>
    </article>
  );
});
