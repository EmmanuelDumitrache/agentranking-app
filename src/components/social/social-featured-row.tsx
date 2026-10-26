"use client";
import type { SocialProfileListItem } from "@/components/social/social-types";
import { SocialProfileCard } from "@/components/social/social-profile-card";
import type { SocialViewerSnapshot } from "@/components/social/social-types";
export function SocialFeaturedRow({
  profiles,
  initialViewer,
}: {
  readonly profiles: SocialProfileListItem[];
  readonly initialViewer: SocialViewerSnapshot;
}) {
  if (profiles.length === 0) return null;
  return (
    <section className="social-featured">
      <h2 className="social-section-title">Featured builders</h2>
      <div className="social-featured-scroll">
        {profiles.map((profile) => (
          <SocialProfileCard
            key={profile.id}
            profile={profile}
            initialFollowerAddress={initialViewer.followerAddress}
            initialFollowing={initialViewer.followingByWallet[profile.walletAddress.toLowerCase()]}
          />
        ))}
      </div>
    </section>
  );
}
