import type { Metadata } from "next";
import { PublicSeoPage } from "@/components/public-site/seo-page";
import { getPublicSiteSeoPage } from "@/lib/public-site-seo-pages";
import { hreflangLanguages } from "@/lib/seo-defaults";
import { getPublicSiteUrl } from "@/lib/site-url";
import { publicSiteSocialOgImageUrl } from "@/lib/social-og-images";
const page = getPublicSiteSeoPage("x402-ai-agents")!;
const url = `${getPublicSiteUrl()}/x402-ai-agents`;
export const metadata: Metadata = {
  title: page.metaTitle,
  description: page.description,
  alternates: {
    canonical: url,
    languages: hreflangLanguages(url),
  },
  openGraph: {
    type: "website",
    title: page.metaTitle,
    description: page.description,
    url,
    siteName: "AgentRanking",
    images: [{ url: publicSiteSocialOgImageUrl("agents"), width: 1200, height: 630, alt: page.metaTitle }],
  },
  twitter: {
    card: "summary_large_image",
    title: page.metaTitle,
    description: page.description,
    images: [publicSiteSocialOgImageUrl("agents")],
  },
};
export default function Page() {
  return <PublicSeoPage page={page} />;
}
