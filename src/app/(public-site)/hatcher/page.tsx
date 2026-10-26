import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { defaultOgImageMetadata, hreflangLanguages, SITE_TWITTER_HANDLE } from "@/lib/seo-defaults";
import { loadHatcherDashboardData } from "@/lib/hatcher/hatcher-dashboard";
import { HatcherDashboardClient } from "./hatcher-dashboard-client";
const canonical = absoluteUrl("/hatcher");
const og = defaultOgImageMetadata();
const title = "Hatcher Agents — Partner-Indexed Discovery | AgentRanking";
const description =
  "Browse Hatcher public agents indexed on AgentRanking: frameworks, passports, MCP manifests, and partner discovery scores.";
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
    images: [{ ...og, alt: "AgentRanking Hatcher partner agents" }],
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
export default async function HatcherAgentsPage() {
  const data = await loadHatcherDashboardData();
  return <HatcherDashboardClient data={data} />;
}
