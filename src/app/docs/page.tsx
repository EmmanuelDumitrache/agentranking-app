import type { Metadata } from "next";
import { DocsSinglePage } from "@/components/docs/docs-single-page";
import { docsAbsoluteUrl } from "@/lib/site-url";
import { mergeWithGlobal } from "@/lib/seo-keywords";
import { defaultOgImageMetadata, hreflangLanguages } from "@/lib/seo-defaults";
const description =
  "AgentRanking documentation: discover, evaluate, integrate, and monetize on-chain agents with the Agent Index, Agent Dashboard, trust signals, API, MCP, jobs, and $AR ecosystem.";
const canonical = docsAbsoluteUrl("/docs");
const og = defaultOgImageMetadata();
export const metadata: Metadata = {
  title: "Overview",
  description,
  keywords: mergeWithGlobal(
    "AgentRanking docs",
    "on-chain agents",
    "Agent Dashboard",
    "agent verification",
    "$AR staking",
  ),
  alternates: { canonical, languages: hreflangLanguages(canonical) },
  openGraph: {
    type: "website",
    title: `Overview | AgentRanking Docs`,
    description,
    url: canonical,
    siteName: "AgentRanking",
    images: [{ ...og, alt: `Overview | AgentRanking Docs` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `Overview | AgentRanking Docs`,
    description,
    images: [og.url],
  },
};
export default function DocsOverviewPage() {
  return <DocsSinglePage slug="" />;
}
