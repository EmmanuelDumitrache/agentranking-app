import type { Metadata } from "next";
import {
  StakePageBody,
  StakeSeoSection,
  StakingDashboardHeader,
  StakingStatsGrid,
} from "@/app/stake/components";
import {
  buildPublicFooterColumns,
  buildStakeNavLinks,
  publicPageUrls,
} from "@/lib/public-page-urls";
import {
  StakeSiteFooter,
  StakeHashScroll,
  StakeSiteNav,
  StakeSiteShell,
} from "@/app/stake/shell";
import { getPublicHomeKeywords } from "@/lib/seo-keywords";
import { getStakeSiteUrl } from "@/lib/site-url";
import {
  hreflangLanguages,
  SITE_BRAND_NAME,
  SITE_TWITTER_HANDLE,
  STAKE_PAGE_DESCRIPTION,
  STAKE_PAGE_OG_TITLE,
  STAKE_PAGE_TITLE,
} from "@/lib/seo-defaults";
import { socialOgImageMetadata, stakeSocialOgImageUrl } from "@/lib/social-og-images";
import { readStakePageMetrics } from "@/lib/stake-page-summary.server";
import { readStreamflowPoolConfig } from "@/lib/stake-pool-config.server";
import { StakeQueryProviders } from "@/providers/stake-query-providers";
const STAKE_URL = getStakeSiteUrl();
const STAKE_OG_IMAGE_URL = stakeSocialOgImageUrl();
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata: Metadata = {
  metadataBase: new URL(STAKE_URL),
  title: STAKE_PAGE_TITLE,
  description: STAKE_PAGE_DESCRIPTION,
  applicationName: SITE_BRAND_NAME,
  alternates: {
    canonical: STAKE_URL,
    languages: hreflangLanguages(STAKE_URL),
  },
  keywords: getPublicHomeKeywords(),
  openGraph: {
    type: "website",
    locale: "en_US",
    title: STAKE_PAGE_OG_TITLE,
    description: STAKE_PAGE_DESCRIPTION,
    url: STAKE_URL,
    siteName: SITE_BRAND_NAME,
    images: [
      socialOgImageMetadata(STAKE_OG_IMAGE_URL, "Stake $AR — AgentRanking ecosystem rewards"),
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: SITE_TWITTER_HANDLE,
    creator: SITE_TWITTER_HANDLE,
    title: STAKE_PAGE_OG_TITLE,
    description: STAKE_PAGE_DESCRIPTION,
    images: [STAKE_OG_IMAGE_URL],
  },
  robots: { index: true, follow: true },
};
export default async function StakePage() {
  const [initialMetrics, initialPoolConfig] = await Promise.all([
    readStakePageMetrics().catch(() => null),
    readStreamflowPoolConfig().catch(() => null),
  ]);
  const footerColumns = buildPublicFooterColumns();
  const stakeNavLinks = buildStakeNavLinks();
  return (
    <StakeSiteShell>
      <StakeHashScroll />
      <StakeSiteNav
        homeHref={publicPageUrls.stake}
        appHref={publicPageUrls.app}
        verifyHref={publicPageUrls.verify}
        links={stakeNavLinks}
        connectWalletHref="#stake"
      />
      <StakeQueryProviders>
        <StakingDashboardHeader />
        <StakingStatsGrid initialMetrics={initialMetrics} />
        <StakePageBody initialMetrics={initialMetrics} initialPoolConfig={initialPoolConfig} />
      </StakeQueryProviders>
      <StakeSeoSection />
      <StakeSiteFooter
        homeHref={publicPageUrls.publicSite}
        columns={footerColumns}
        privacyHref={`${publicPageUrls.app}/privacy`}
        termsHref={`${publicPageUrls.app}/terms`}
      />
    </StakeSiteShell>
  );
}
