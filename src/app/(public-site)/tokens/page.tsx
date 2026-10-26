import type { Metadata } from "next";
import { loadAllLaunchIndexCards } from "@/lib/agent-launch/launch-index-data.server";
import { PublicTokensIndex } from "@/components/public-site/public-tokens-index";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { PublicSitePageHeader } from "@/components/public-site/public-site-ui";
import { OFFICIAL_PUBLIC_TOKENS } from "@/lib/public-site/official-tokens";
import { getDexscreenerMarketsForMints } from "@/lib/public-site/dexscreener";
import { publicSitePageMetadata } from "@/lib/public-site/seo-metadata";
import { publicSiteSocialOgImageUrl } from "@/lib/social-og-images";
export const metadata: Metadata = publicSitePageMetadata({
  title: "Tokens | AgentRanking",
  description:
    "Track the official $AR token and tokenized agents launched through AgentRanking — searchable launchpad leaderboard on Solana and Robinhood Chain.",
  path: "/tokens",
  imageUrl: publicSiteSocialOgImageUrl("tokens"),
});
export const dynamic = "force-dynamic";
export default async function PublicTokensPage() {
  const [cards, officialMarkets] = await Promise.all([
    loadAllLaunchIndexCards(),
    getDexscreenerMarketsForMints(OFFICIAL_PUBLIC_TOKENS.map((t) => t.mint)),
  ]);
  return (
    <PublicSitePageShell>
      <PublicSitePageHeader
        title="Top tokens"
        description="Track the official $AR token and tokenized agents launched through AgentRanking on Solana and Robinhood Chain."
      />
      <PublicTokensIndex
        cards={cards}
        officialTokens={OFFICIAL_PUBLIC_TOKENS}
        officialMarkets={officialMarkets}
      />
    </PublicSitePageShell>
  );
}
