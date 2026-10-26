"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { publicSiteRoutes } from "@/lib/public-site/routes";
import { PublicSiteSection } from "@/components/public-site/public-site-section";
import { PublicSiteMetrics } from "@/components/public-site/public-site-metrics";
import type {
  PublicSiteHomeStats,
  SphereImageData,
} from "@/lib/public-site/home-types";
import { TrendingUp } from "lucide-react";
const SphereImageGrid = dynamic(
  () => import("@/components/public-site/sphere-image-grid"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center" style={{ width: 420, height: 420 }}>
        <div className="text-xs text-white/15 animate-pulse">Loading sphere...</div>
      </div>
    ),
  },
);
type Props = {
  readonly sphereImages: readonly SphereImageData[];
  readonly stats: PublicSiteHomeStats;
  readonly tokenLaunchCount: number;
  readonly nativeAgentCount: number;
};
const EYEBROW = "Ranked Agents";
const TITLE = "The world's best AI agents";
const DESC = "200k+ agents indexed by AR Score — discover the top-ranked identities spanning every major chain.";
export function SphereRankingSection({
  sphereImages,
  stats,
  tokenLaunchCount,
  nativeAgentCount,
}: Props) {
  return (
    <PublicSiteSection
      id="ranking"
      eyebrow={EYEBROW}
      title={TITLE}
      description={DESC}
    >
      <PublicSiteMetrics
        stats={stats}
        tokenLaunchCount={tokenLaunchCount}
        nativeAgentCount={nativeAgentCount}
        className="border-0 py-0 pt-4"
      />
      <div className="flex flex-col items-center gap-4 pt-6">
        <SphereImageGrid
          images={sphereImages as import("@/components/public-site/sphere-image-grid").SphereImageData[]}
          containerSize={420}
        />
        <Link
          href={publicSiteRoutes.ranking}
          className="ui-btn ui-btn-secondary ui-btn-sm whitespace-nowrap"
        >
          <TrendingUp className="mr-1.5 h-4 w-4" aria-hidden />
          View all
        </Link>
      </div>
    </PublicSiteSection>
  );
}
