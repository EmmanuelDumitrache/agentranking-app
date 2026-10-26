import type { Metadata } from "next";
import { AgentWorldPageClient } from "@/components/public-site/agent-world-page";
import { loadAgentWorldSnapshot } from "@/lib/public-site/world-data.server";
import {
  PUBLIC_SITE_OG_IMAGE_PATH,
  hreflangLanguages,
  SITE_TWITTER_HANDLE,
} from "@/lib/seo-defaults";
import { publicSiteRoutes } from "@/lib/public-site/routes";
import { getPublicSiteUrl } from "@/lib/site-url";

const TITLE = "Agent World — 3D map of indexed AI agents";
const DESCRIPTION =
  "Fly through AgentRanking's indexed agent warehouse by chain. Explore listed, verified, and dead/spam mix without leaving the public directory.";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: `${getPublicSiteUrl()}${publicSiteRoutes.world}`,
    languages: hreflangLanguages(`${getPublicSiteUrl()}${publicSiteRoutes.world}`),
  },
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    url: `${getPublicSiteUrl()}${publicSiteRoutes.world}`,
    siteName: "AgentRanking",
    images: [
      {
        url: `${getPublicSiteUrl()}${PUBLIC_SITE_OG_IMAGE_PATH}`,
        width: 1200,
        height: 630,
        alt: TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: SITE_TWITTER_HANDLE,
    title: TITLE,
    description: DESCRIPTION,
    images: [`${getPublicSiteUrl()}${PUBLIC_SITE_OG_IMAGE_PATH}`],
  },
};

export default async function WorldPage() {
  const snapshot = await loadAgentWorldSnapshot();
  return <AgentWorldPageClient snapshot={snapshot} />;
}
