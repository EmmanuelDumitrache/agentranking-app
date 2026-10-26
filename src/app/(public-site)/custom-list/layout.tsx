import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { defaultOgImageMetadata, hreflangLanguages, ROBOTS_NOINDEX_UTILITY } from "@/lib/seo-defaults";
const title = "Custom List Agent | AgentRanking";
const description =
  "List an AI agent that isn't automatically detected by our RPC sync. Pay with ETH, USDC, or SOL.";
const canonical = absoluteUrl("/custom-list");
const og = defaultOgImageMetadata();
export const metadata: Metadata = {
  title,
  description,
  robots: ROBOTS_NOINDEX_UTILITY,
  alternates: { canonical, languages: hreflangLanguages(canonical) },
  openGraph: {
    type: "website",
    title,
    description,
    url: canonical,
    siteName: "AgentRanking",
    images: [{ ...og, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [og.url],
  },
};
export default function CustomListLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
