import type { Metadata } from "next";
import { connection } from "next/server";
import { absoluteUrl } from "@/lib/site-url";
import { defaultOgImageMetadata, hreflangLanguages, SITE_TWITTER_HANDLE } from "@/lib/seo-defaults";
import { getSapSeoKeywords } from "@/lib/seo-keywords";
import { getSapCapabilityIndex } from "@/lib/sap-ecosystem";
import { SapCapabilitiesIndexClient } from "@/components/sap/sap-capabilities-index-client";
const canonical = absoluteUrl("/sap/capabilities");
const capOg = defaultOgImageMetadata();
const title = "SAP Capability Directory — Browse Synapse Agent Protocol Skills | AgentRanking";
const description =
  "See which Synapse Agent Protocol agents expose Trading, MCP, swaps, inference, x402,and more — filter-ready capability index powering AgentRanking SAP search.";
export const metadata: Metadata = {
  title,
  description,
  keywords: getSapSeoKeywords(),
  alternates: {
    canonical,
    languages: hreflangLanguages(canonical),
  },
  openGraph: {
    type: "website",
    title,
    description,
    url: canonical,
    siteName: "AgentRanking",
    images: [{ ...capOg, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    site: SITE_TWITTER_HANDLE,
    creator: SITE_TWITTER_HANDLE,
    title,
    description,
    images: [capOg.url],
  },
};
export default async function SapCapabilitiesPage() {
  await connection();
  const capabilities = await getSapCapabilityIndex();
  const rows = capabilities.map((c) => ({
    capabilityId: c.capabilityId,
    description: c.description,
    agentCount: c.agentCount,
    avgPrice: c.avgPrice,
  }));
  return <SapCapabilitiesIndexClient capabilities={rows} />;
}
