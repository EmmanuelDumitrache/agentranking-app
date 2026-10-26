import type { Metadata } from "next";
import { LockedSupplyPageContent } from "@/components/public-site/locked-supply-page";
import { fetchPublishedStreamflowLocksLive } from "@/lib/streamflow-vesting-live";
import {
  PUBLIC_SITE_OG_IMAGE_PATH,
  hreflangLanguages,
  SITE_TWITTER_HANDLE,
} from "@/lib/seo-defaults";
import { getPublicSiteUrl } from "@/lib/site-url";
const TITLE = "$AR lock registry | AgentRanking";
const DESCRIPTION =
  "Public registry of $AR team vesting locks on Streamflow. 5% of supply (50M AR) in two published cliff locks — verify on-chain before trading.";
const PUBLIC_SITE_URL = getPublicSiteUrl();
const LOCKED_SUPPLY_URL = `${PUBLIC_SITE_URL}/locked-supply`;
const LOCKED_SUPPLY_OG = `${PUBLIC_SITE_URL}${PUBLIC_SITE_OG_IMAGE_PATH}`;
export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: LOCKED_SUPPLY_URL,
    languages: hreflangLanguages(LOCKED_SUPPLY_URL),
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: LOCKED_SUPPLY_URL,
    siteName: "AgentRanking",
    type: "website",
    images: [{ url: LOCKED_SUPPLY_OG, width: 1200, height: 630, alt: "AgentRanking" }],
  },
  twitter: {
    card: "summary_large_image",
    site: SITE_TWITTER_HANDLE,
    title: TITLE,
    description: DESCRIPTION,
    images: [LOCKED_SUPPLY_OG],
  },
  icons: {
    icon: [{ url: "/icon.png", sizes: "256x256", type: "image/png" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};
export const dynamic = "force-dynamic";
export default async function LockedSupplyPage() {
  const initialLiveData = await fetchPublishedStreamflowLocksLive().catch(() => null);
  return <LockedSupplyPageContent initialLiveData={initialLiveData} />;
}
