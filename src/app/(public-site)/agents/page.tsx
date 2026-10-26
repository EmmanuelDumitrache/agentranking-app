import type { Metadata } from "next";
import { PublicRankingPage } from "@/components/ranking/public-ranking-page";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { PublicSitePageHeader } from "@/components/public-site/public-site-ui";
import {
  parsePublicRankingInput,
  readPublicRankingPage,
  readPublicRankingSummary,
  type PublicRankingSearchParams,
} from "@/lib/ranking/public-ranking.server";
import { publicSitePageMetadata } from "@/lib/public-site/seo-metadata";
import { publicSiteSocialOgImageUrl } from "@/lib/social-og-images";

export const metadata: Metadata = publicSitePageMetadata({
  title: "AI Agents | AgentRanking",
  description:
    "Browse AR-listed and indexed agents across every chain — AR Score, verification, and protocol signals in one directory.",
  path: "/agents",
  imageUrl: publicSiteSocialOgImageUrl("agents"),
});

export const dynamic = "force-dynamic";

type Props = {
  readonly searchParams: Promise<PublicRankingSearchParams>;
};

export default async function AgentsPage({ searchParams }: Props) {
  const input = parsePublicRankingInput(await searchParams);
  const data = readPublicRankingPage(input);
  const summary = readPublicRankingSummary();

  return (
    <PublicSitePageShell>
      <PublicSitePageHeader
        eyebrow="Directory"
        title="Agents"
        description="AR-listed launches and the global index. Tap AR to see agents created here."
      />
      <PublicRankingPage input={input} data={data} summary={summary} />
    </PublicSitePageShell>
  );
}
