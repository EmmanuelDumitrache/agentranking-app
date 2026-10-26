import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { defaultOgImageMetadata, hreflangLanguages, SITE_TWITTER_HANDLE } from "@/lib/seo-defaults";
import { loadCovenantDashboardData } from "@/lib/covenant/covenant-dashboard";
import { CovenantDashboardClient } from "./covenant-dashboard-client";
const canonical = absoluteUrl("/covenant");
const og = defaultOgImageMetadata();
const title = "Covenant Agents — Runtime-Verified SAP Partners | AgentRanking";
const description =
  "Browse Covenant runtime agents indexed via SAP: audit-root verification status, x402 payment support, and AgentRanking trust scores on Solana.";
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
    images: [{ ...og, alt: "AgentRanking Covenant partner agents" }],
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
export default async function CovenantAgentsPage() {
  const data = await loadCovenantDashboardData();
  return <CovenantDashboardClient data={data} />;
}
