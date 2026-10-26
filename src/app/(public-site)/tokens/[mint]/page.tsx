import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { PublicTokenDetailPage } from "@/components/public-site/token-detail-page";
import { loadPublicTokenDetailData } from "@/lib/public-site/token-detail-data.server";
import { getOfficialPublicToken } from "@/lib/public-site/official-tokens";
import { publicSitePageMetadata } from "@/lib/public-site/seo-metadata";
import { tokenSocialOgImageUrl } from "@/lib/social-og-images";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ mint: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { mint } = await params;
  const official = getOfficialPublicToken(mint);
  if (official) {
    return publicSitePageMetadata({
      title: `${official.name} ($${official.symbol}) | AgentRanking`,
      description: official.description,
      path: `/tokens/${mint}`,
      imageUrl: tokenSocialOgImageUrl(mint),
    });
  }
  const launch = await prisma.agentLaunch.findUnique({ where: { mint } });
  if (!launch) {
    return {
      title: `Token ${mint.slice(0, 8)}… | AgentRanking`,
      robots: { index: false, follow: false },
    };
  }
  const tokenName = launch.profileDisplayName || launch.tokenName || `Token ${mint.slice(0, 8)}…`;
  const symbol = launch.tokenSymbol ? ` ($${launch.tokenSymbol})` : "";
  const description =
    launch.profileShortDescription ||
    launch.tokenDescription ||
    `AgentRanking-launched token ${mint.slice(0, 8)}… on Solana.`;
  return publicSitePageMetadata({
    title: `${tokenName}${symbol} | AgentRanking`,
    description,
    path: `/tokens/${mint}`,
    imageUrl: tokenSocialOgImageUrl(mint),
  });
}
export default async function PublicTokenDetailPageRoute({ params }: Props) {
  const { mint } = await params;
  const data = await loadPublicTokenDetailData(mint);
  return (
    <PublicSitePageShell>
      <PublicTokenDetailPage data={data} />
    </PublicSitePageShell>
  );
}
