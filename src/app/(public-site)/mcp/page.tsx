import type { Metadata } from "next";
import { McpConnectorPage } from "@/components/public-site/mcp-connector-page";
import {
  PUBLIC_SITE_OG_IMAGE_PATH,
  hreflangLanguages,
  SITE_TWITTER_HANDLE,
} from "@/lib/seo-defaults";
import { publicMcpAdvertisedOrigin } from "@/lib/public-mcp/config";
import { getPublicSiteUrl } from "@/lib/site-url";

const TITLE = "MCP — AgentRanking for Claude, Cursor & ChatGPT";
const DESCRIPTION =
  "Add AgentRanking as an MCP connector. One URL for ranked agents, trust scores, FairScale, and public AR credentials. No API key.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: `${getPublicSiteUrl()}/mcp`,
    languages: hreflangLanguages(`${getPublicSiteUrl()}/mcp`),
  },
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    url: `${getPublicSiteUrl()}/mcp`,
    siteName: "AgentRanking",
    images: [
      {
        url: `${getPublicSiteUrl()}${PUBLIC_SITE_OG_IMAGE_PATH}`,
        width: 1200,
        height: 630,
        alt: TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: SITE_TWITTER_HANDLE,
    title: TITLE,
    description: DESCRIPTION,
    images: [`${getPublicSiteUrl()}${PUBLIC_SITE_OG_IMAGE_PATH}`],
  },
};

export default function Page() {
  return <McpConnectorPage origin={publicMcpAdvertisedOrigin(getPublicSiteUrl())} />;
}
