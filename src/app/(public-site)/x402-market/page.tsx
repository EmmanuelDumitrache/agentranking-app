import { absoluteUrl } from "@/lib/site-url";
import { buildSeoMetadata } from "@/lib/seo";
import { X402MarketPreviewPage } from "@/components/public-site/x402-market-preview-page";
export const metadata = buildSeoMetadata({
  path: "/x402-market",
  title: "x402 Market — Paid Agent Capabilities | AgentRanking",
  description:
    "Discover paid agent skills, APIs, MCP servers, and x402-ready services ranked by reputation.",
  ogTitle: "x402 Market — AgentRanking",
  ogDescription:
    "Paid x402-ready agent capabilities, MCP servers, and services on AgentRanking.",
});
export default function X402MarketPage() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "x402 Market",
    description:
      "AgentRanking marketplace for discovering paid agent capabilities, MCP servers, APIs, and x402-ready services.",
    url: absoluteUrl("/x402-market"),
    publisher: { "@type": "Organization", name: "AgentRanking", url: absoluteUrl("/") },
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <X402MarketPreviewPage />
    </>
  );
}
