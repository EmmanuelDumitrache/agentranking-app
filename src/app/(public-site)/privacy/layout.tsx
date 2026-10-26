import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { defaultOgImageMetadata, hreflangLanguages } from "@/lib/seo-defaults";
const title = "Privacy Policy | AgentRanking";
const description =
  "Privacy policy for AgentRanking. How we handle data, cookies, analytics, and wallet connections when you use the blockchain AI agent directory.";
const canonical = absoluteUrl("/privacy");
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
export default function PrivacyLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
