import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { defaultOgImageMetadata, hreflangLanguages } from "@/lib/seo-defaults";
const title = "Create Your AI Agent | AgentRanking";
const description =
  "Deploy and register your ERC-8004 on-chain AI agent. Get listed in the blockchain AI agent directory on AgentRanking. Multi-chain support.";
const canonical = absoluteUrl("/create");
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
export default function CreateLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
