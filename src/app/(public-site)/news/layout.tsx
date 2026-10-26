import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getPublicSiteUrl } from "@/lib/site-url";
import { mergeWithGlobal, SEO_EXTRA_NEWS } from "@/lib/seo-keywords";
import { hreflangLanguages } from "@/lib/seo-defaults";
import { publicSiteSocialOgImageUrl } from "@/lib/social-og-images";
const PUBLIC_SITE_URL = getPublicSiteUrl();
const NEWS_URL = `${PUBLIC_SITE_URL}/news`;
const newsTitle = "Crypto AI Agent News, ERC-8004 & x402 Guides | AgentRanking";
const newsDescription =
  "Read AgentRanking news for crypto AI agents, ERC-8004, SAP, x402 payments, MCP servers, agent rankings, verification, and on-chain agent discovery.";
const defaultImage = publicSiteSocialOgImageUrl("news");
export const metadata: Metadata = {
  title: newsTitle,
  description: newsDescription,
  keywords: mergeWithGlobal(...SEO_EXTRA_NEWS),
  alternates: {
    canonical: NEWS_URL,
    languages: hreflangLanguages(NEWS_URL),
  },
  openGraph: {
    type: "website",
    title: newsTitle,
    description: newsDescription,
    url: NEWS_URL,
    siteName: "AgentRanking",
    images: [{ url: defaultImage, alt: "AgentRanking News & Research", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: newsTitle,
    description: newsDescription,
    images: [defaultImage],
  },
};
export default function NewsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <>{children}</>;
}
