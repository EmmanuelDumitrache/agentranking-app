import { absoluteUrl } from "@/lib/site-url";
import { buildSeoMetadata } from "@/lib/seo";
import { AnalyticsPreviewPage } from "@/components/public-site/analytics-preview-page";
export const metadata = buildSeoMetadata({
  path: "/analytics",
  title: "Analytics — Agent Intelligence | AgentRanking",
  description:
    "AgentRanking Analytics: intelligence dashboard, data products, API feeds, and exports for the on-chain agent economy.",
  ogTitle: "Analytics — AgentRanking",
  ogDescription:
    "Intelligence layer for the agent economy—dashboards, APIs, and data exports.",
});
export default function AnalyticsPage() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "AgentRanking Analytics",
    description:
      "Preview of planned intelligence products for the on-chain agent economy—data SKUs, APIs, and exports.",
    url: absoluteUrl("/analytics"),
    publisher: { "@type": "Organization", name: "AgentRanking", url: absoluteUrl("/") },
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <AnalyticsPreviewPage />
    </>
  );
}
