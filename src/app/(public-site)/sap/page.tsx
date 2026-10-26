import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { hreflangLanguages, defaultOgImageMetadata, SITE_TWITTER_HANDLE } from "@/lib/seo-defaults";
import { getSapSeoKeywords } from "@/lib/seo-keywords";
import { SapOobePartnershipBand } from "@/components/sap/sap-oobe-partnership";
import { getSapDashboardData } from "@/lib/sap-dashboard";
import { SapDashboardClient } from "./sap-dashboard-client";
const canonical = absoluteUrl("/sap");
const sapOg = defaultOgImageMetadata();
const sapTitle =
  "Synapse Agent Protocol (SAP) Stats — Verified Agents & OOBE Integration | AgentRanking";
const sapDescription =
  "Live SAP indexer stats: verified agents, capabilities breadth, leaderboard links, and how AgentRanking discovers Synapse registrations for developers integrating Solana agents.";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: sapTitle,
  description: sapDescription,
  keywords: getSapSeoKeywords(),
  alternates: {
    canonical,
    languages: hreflangLanguages(canonical),
  },
  openGraph: {
    type: "website",
    url: canonical,
    siteName: "AgentRanking",
    title: sapTitle,
    description: sapDescription,
    images: [{ ...sapOg, alt: "AgentRanking SAP Synapse Agent Protocol ecosystem" }],
  },
  twitter: {
    card: "summary_large_image",
    site: SITE_TWITTER_HANDLE,
    creator: SITE_TWITTER_HANDLE,
    title: sapTitle,
    description: sapDescription,
    images: [sapOg.url],
  },
};
export default async function SapEcosystemPage() {
  const data = await getSapDashboardData();
  return (
    <>
      <div className="mx-auto w-full max-w-7xl px-4 pt-3 sm:pt-4 md:px-6 md:pt-6 2xl:max-w-[88rem]">
        <SapOobePartnershipBand agentCount={data.totals.sapUniqueAgents} />
      </div>
      <SapDashboardClient data={data} />
    </>
  );
}