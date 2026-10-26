import type { Metadata } from "next";
import { loadMetaplexDashboardData } from "@/lib/metaplex/metaplex-dashboard";
import { METAPLEX_HUB_PATH } from "@/lib/metaplex/urls";
import { absoluteUrl } from "@/lib/site-url";
import { defaultOgImageMetadata, hreflangLanguages, SITE_TWITTER_HANDLE } from "@/lib/seo-defaults";
import { readOptionalAdminMetaplexHubState } from "@/lib/admin/operations/metaplex.server";
import { MetaplexDashboardClient } from "./metaplex-dashboard-client";
const canonical = absoluteUrl(METAPLEX_HUB_PATH);
const og = defaultOgImageMetadata();
const title = "Metaplex Agent Registry — Indexed Agents | AgentRanking";
const description =
  "Metaplex Agent Registry on AgentRanking: MPL Core assets with AgentIdentity plugins, registration JSON, services, and trust metadata indexed on Solana.";
export const metadata: Metadata = {
  title,
  description,
  alternates: {
    canonical,
    languages: hreflangLanguages(canonical),
  },
  openGraph: {
    type: "website",
    url: canonical,
    siteName: "AgentRanking",
    title,
    description,
    images: [{ ...og, alt: "AgentRanking Metaplex Agent Registry" }],
  },
  twitter: {
    card: "summary_large_image",
    site: SITE_TWITTER_HANDLE,
    creator: SITE_TWITTER_HANDLE,
    title,
    description,
    images: [og.url],
  },
};
export const dynamic = "force-dynamic";
async function readOptionalAdminState() {
  try {
    return await readOptionalAdminMetaplexHubState();
  } catch (error) {
    console.error("[metaplex] admin state preload failed", error);
    return undefined;
  }
}
export default async function MetaplexHubPage() {
  const [data, initialAdminState] = await Promise.all([
    loadMetaplexDashboardData(),
    readOptionalAdminState(),
  ]);
  return <MetaplexDashboardClient data={data} initialAdminState={initialAdminState} />;
}
