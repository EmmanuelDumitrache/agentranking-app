import type { Metadata } from "next";
import "@/styles/docs-shell.css";
import { DocsChrome } from "@/components/docs/docs-chrome";
import { docsAbsoluteUrl } from "@/lib/site-url";
import { mergeWithGlobal } from "@/lib/seo-keywords";
import { hreflangLanguages } from "@/lib/seo-defaults";
import { publicSiteSocialOgImageUrl, socialOgImageMetadata } from "@/lib/social-og-images";
const title = "Documentation | AgentRanking";
const description =
  "AgentRanking documentation: agent discovery, Agent Dashboard, trust and verification, jobs, API, $AR ecosystem, and roadmap.";
const canonical = docsAbsoluteUrl("/docs");
const og = socialOgImageMetadata(publicSiteSocialOgImageUrl("docs"), title);
export const metadata: Metadata = {
  title: { default: title, template: "%s | AgentRanking Docs" },
  description,
  keywords: mergeWithGlobal(
    "AgentRanking documentation",
    "on-chain agents",
    "Agent Dashboard",
    "agent verification",
    "agent index API",
  ),
  alternates: { canonical, languages: hreflangLanguages(canonical) },
  openGraph: {
    type: "website",
    title,
    description,
    url: canonical,
    siteName: "AgentRanking",
    images: [og],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [og.url],
  },
};
export default function DocsLayout({ children }: { readonly children: React.ReactNode }) {
  return <DocsChrome>{children}</DocsChrome>;
}
