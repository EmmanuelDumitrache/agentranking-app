import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { mergeWithGlobal } from "@/lib/seo-keywords";
import { defaultOgImageMetadata, hreflangLanguages } from "@/lib/seo-defaults";
const contactPath = "/contact";
const contactTitle = "Contact | AgentRanking";
const contactDescription =
  "Get in touch with the AgentRanking team about the blockchain AI agent directory, ERC-8004 listings, partnerships, or support.";
const canonical = absoluteUrl(contactPath);
const defaultOg = defaultOgImageMetadata();
export const metadata: Metadata = {
  title: contactTitle,
  description: contactDescription,
  keywords: mergeWithGlobal("contact AgentRanking", "ERC-8004 directory support"),
  alternates: {
    canonical,
    languages: hreflangLanguages(canonical),
  },
  openGraph: {
    type: "website",
    title: contactTitle,
    description: contactDescription,
    url: canonical,
    siteName: "AgentRanking",
    images: [{ ...defaultOg, alt: contactTitle }],
  },
  twitter: {
    card: "summary_large_image",
    title: contactTitle,
    description: contactDescription,
    images: [defaultOg.url],
  },
};
export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
