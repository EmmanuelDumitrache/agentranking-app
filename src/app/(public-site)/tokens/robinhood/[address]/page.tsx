import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { RobinhoodPublicTokenDetailPage } from "@/components/public-site/robinhood-token-detail-page";
import { RobinhoodTokenPendingClient } from "@/components/robinhood-chain/robinhood-token-pending-client";
import { getRobinhoodLaunchByAddress } from "@/lib/robinhood-chain/record-launch.server";
import { loadRobinhoodPublicTokenDetailData } from "@/lib/public-site/robinhood-token-detail-data.server";
import { publicSitePageMetadata } from "@/lib/public-site/seo-metadata";
import { robinhoodTokenSocialOgImageUrl } from "@/lib/social-og-images";
type Props = { params: Promise<{ address: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  const launch = await getRobinhoodLaunchByAddress(address);
  const title = launch?.tokenName || launch?.tokenSymbol || "Token";
  const description =
    launch?.tokenDescription || "Robinhood Chain token launch on AgentRanking.";
  return publicSitePageMetadata({
    title: `${title} | Robinhood Chain | AgentRanking`,
    description,
    path: `/tokens/robinhood/${address}`,
    imageUrl: robinhoodTokenSocialOgImageUrl(address),
  });
}
export const dynamic = "force-dynamic";
export default async function RobinhoodTokenDetailRoute({ params }: Props) {
  const { address } = await params;
  const data = await loadRobinhoodPublicTokenDetailData(address);
  if (!data) {
    return (
      <PublicSitePageShell>
        <div className="ui-page-stack py-8">
          <Link
            href="/tokens/robinhood"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
          >
            <ArrowLeft className="size-3.5" />
            All Robinhood Chain tokens
          </Link>
          <RobinhoodTokenPendingClient address={address} />
        </div>
      </PublicSitePageShell>
    );
  }
  return (
    <PublicSitePageShell>
      <div className="py-8">
        <RobinhoodPublicTokenDetailPage data={data} />
      </div>
    </PublicSitePageShell>
  );
}
