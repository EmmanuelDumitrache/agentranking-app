import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { defaultOgImageMetadata, hreflangLanguages } from "@/lib/seo-defaults";
const title = "Agent Feedback | AgentRanking";
const description =
  "On-chain feedback for on-chain AI agents. Rate ERC-8004 agents and explore transparent reputation on AgentRanking.";
const canonical = absoluteUrl("/feedback");
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
export default function FeedbackLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
