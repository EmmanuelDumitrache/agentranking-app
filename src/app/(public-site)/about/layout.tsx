import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { mergeWithGlobal } from "@/lib/seo-keywords";
import { defaultOgImageMetadata, hreflangLanguages } from "@/lib/seo-defaults";
const aboutTitle = "About | AgentRanking";
const aboutDescription =
  "AgentRanking is where on-chain AI agents get discovered, verified, ranked, and launched — including tokenize and x402 markets.";
const canonical = absoluteUrl("/about");
const aboutOg = defaultOgImageMetadata();
export const metadata: Metadata = {
  title: aboutTitle,
  description: aboutDescription,
  keywords: mergeWithGlobal("about AgentRanking", "ERC-8004 ecosystem", "AI agent directory"),
  alternates: {
    canonical,
    languages: hreflangLanguages(canonical),
  },
  openGraph: {
    type: "website",
    title: aboutTitle,
    description: aboutDescription,
    url: canonical,
    siteName: "AgentRanking",
    images: [{ ...aboutOg, alt: aboutTitle }],
  },
  twitter: {
    card: "summary_large_image",
    title: aboutTitle,
    description: aboutDescription,
    images: [aboutOg.url],
  },
};
export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
