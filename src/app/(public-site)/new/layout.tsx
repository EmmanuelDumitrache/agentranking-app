import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { mergeWithGlobal, SEO_EXTRA_NEW } from "@/lib/seo-keywords";
import { defaultOgImageMetadata, hreflangLanguages } from "@/lib/seo-defaults";
const newTitle = "New AI Agents | AgentRanking";
const newDescription =
  "Recently launched on-chain AI agents across Ethereum, Base, and more. Discover the latest ERC-8004 agents.";
const canonical = absoluteUrl("/new");
const newOg = defaultOgImageMetadata();
export const metadata: Metadata = {
  title: newTitle,
  description: newDescription,
  keywords: mergeWithGlobal(...SEO_EXTRA_NEW),
  alternates: { canonical, languages: hreflangLanguages(canonical) },
  openGraph: {
    type: "website",
    title: newTitle,
    description: newDescription,
    url: canonical,
    siteName: "AgentRanking",
    images: [{ ...newOg, alt: newTitle }],
  },
  twitter: {
    card: "summary_large_image",
    title: newTitle,
    description: newDescription,
    images: [newOg.url],
  },
};
export default function NewLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
