import type { Metadata } from "next";
import { PublicSiteHomePage } from "@/components/public-site/public-site-home-page";
import { loadPublicSiteHomeData } from "@/lib/public-site/home-data.server";
import { readPublicStakeSummary } from "@/lib/stake-page-summary.server";
import {
  PUBLIC_HOME_DESCRIPTION,
  PUBLIC_HOME_OG_TITLE,
  PUBLIC_HOME_TITLE,
  hreflangLanguages,
  SITE_BRAND_NAME,
  SITE_TWITTER_HANDLE,
} from "@/lib/seo-defaults";
import { getPublicHomeKeywords } from "@/lib/seo-keywords";
import { getPublicSiteUrl } from "@/lib/site-url";
import { publicSiteSocialOgImageUrl } from "@/lib/social-og-images";
const PUBLIC_SITE_URL = getPublicSiteUrl();
const OG_IMAGE_URL = publicSiteSocialOgImageUrl("home");
export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_SITE_URL),
  title: PUBLIC_HOME_TITLE,
  description: PUBLIC_HOME_DESCRIPTION,
  applicationName: SITE_BRAND_NAME,
  icons: {
    icon: [{ url: `${PUBLIC_SITE_URL}/icon.png`, sizes: "256x256", type: "image/png" }],
    shortcut: `${PUBLIC_SITE_URL}/favicon.ico`,
    apple: [{ url: `${PUBLIC_SITE_URL}/apple-icon.png`, sizes: "180x180", type: "image/png" }],
  },
  alternates: {
    canonical: PUBLIC_SITE_URL,
    languages: hreflangLanguages(PUBLIC_SITE_URL),
  },
  keywords: getPublicHomeKeywords(),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: PUBLIC_SITE_URL,
    siteName: SITE_BRAND_NAME,
    title: PUBLIC_HOME_OG_TITLE,
    description: PUBLIC_HOME_DESCRIPTION,
    images: [{
      url: OG_IMAGE_URL,
      width: 1200,
      height: 630,
      alt: `${SITE_BRAND_NAME} — AI agent rankings & crypto agent discovery`,
    }],
  },
  twitter: {
    card: "summary_large_image",
    site: SITE_TWITTER_HANDLE,
    creator: SITE_TWITTER_HANDLE,
    title: PUBLIC_HOME_OG_TITLE,
    description: PUBLIC_HOME_DESCRIPTION,
    images: [OG_IMAGE_URL],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};
export const revalidate = 60;
async function readOptionalStakeSummary() {
  try {
    return await readPublicStakeSummary();
  } catch (error) {
    console.error("[public-home] staking summary preload failed", error);
    return null;
  }
}
export default async function PublicHomePage() {
  const [data, initialStakeSummary] = await Promise.all([
    loadPublicSiteHomeData(),
    readOptionalStakeSummary(),
  ]);
  return <PublicSiteHomePage data={data} initialStakeSummary={initialStakeSummary} />;
}
