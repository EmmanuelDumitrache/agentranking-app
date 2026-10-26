import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { defaultOgImageMetadata, hreflangLanguages } from "@/lib/seo-defaults";
const title = "Terms of Service | AgentRanking";
const description =
  "Terms of service for AgentRanking. Rules and disclaimers for using the on-chain AI agent directory.";
const canonical = absoluteUrl("/terms");
const og = defaultOgImageMetadata();
export const metadata: Metadata = {
  title,
  description,
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
export default function TermsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
