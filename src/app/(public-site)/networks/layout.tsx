import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { mergeWithGlobal } from "@/lib/seo-keywords";
import { defaultOgImageMetadata, hreflangLanguages } from "@/lib/seo-defaults";
const netTitle = "Networks | AgentRanking";
const netDescription =
  "Networks supported by AgentRanking: EVM chains with ERC-8004 registries plus Solana (on-chain agent registry). Browse agents by chain.";
const canonical = absoluteUrl("/networks");
const netOg = defaultOgImageMetadata();
export const metadata: Metadata = {
  title: netTitle,
  description: netDescription,
  keywords: mergeWithGlobal(
    "supported blockchains",
    "multi-chain AI agents",
    "chain directory",
    "on-chain agents by chain",
  ),
  alternates: { canonical, languages: hreflangLanguages(canonical) },
  openGraph: {
    type: "website",
    title: netTitle,
    description: netDescription,
    url: canonical,
    siteName: "AgentRanking",
    images: [{ ...netOg, alt: netTitle }],
  },
  twitter: {
    card: "summary_large_image",
    title: netTitle,
    description: netDescription,
    images: [netOg.url],
  },
};
export default function NetworksLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
