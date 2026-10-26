import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PartnerDetailBody } from "@/app/docs/partners/partner-detail-body";
import { MedusaPartnerDetailSections } from "@/components/docs/medusa-partner-detail-sections";
import { DocsPageHeader } from "@/components/docs/docs-page-header";
import {
  getDocsPartnerBySlug,
  listDocsPartners,
  requireDocsPartner,
} from "@/content/docs-partners";
import { defaultOgImageMetadata, hreflangLanguages } from "@/lib/seo-defaults";
import { mergeWithGlobal } from "@/lib/seo-keywords";
import type { DocsPage } from "@/lib/docs/types";
import { docsAbsoluteUrl } from "@/lib/site-url";
type PageProps = {
  readonly params: Promise<{ readonly slug: string }>;
};
function partnerDetailExtra(slug: string): React.ReactNode {
  if (slug === "medusa") return <MedusaPartnerDetailSections />;
  return null;
}
export function generateStaticParams() {
  return listDocsPartners().map((partner) => ({ slug: partner.slug }));
}
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const partner = getDocsPartnerBySlug(slug);
  if (!partner) return {};
  const title = partner.name;
  const description = partner.description;
  const canonical = docsAbsoluteUrl(`/docs/partners/${slug}`);
  const og = defaultOgImageMetadata();
  return {
    title,
    description,
    keywords: mergeWithGlobal("AgentRanking partners", partner.name, "agent ecosystem"),
    alternates: { canonical, languages: hreflangLanguages(canonical) },
    openGraph: {
      type: "article",
      title: `${title} | AgentRanking Docs`,
      description,
      url: canonical,
      siteName: "AgentRanking",
      images: [{ ...og, alt: `${title} | AgentRanking Docs` }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | AgentRanking Docs`,
      description,
      images: [og.url],
    },
  };
}
export default async function DocsPartnerDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const partner = getDocsPartnerBySlug(slug);
  if (!partner) notFound();
  const page: DocsPage = {
    title: partner.name,
    slug: `partners/${slug}`,
    description: partner.description,
    section: "Ecosystem",
  };
  return (
    <article className="docs-page-article">
      <DocsPageHeader page={page} />
      <div className="docs-prose">
        <p className="docs-p">{partner.description}</p>
        <PartnerDetailBody partner={requireDocsPartner(slug)}>
          {partnerDetailExtra(slug)}
        </PartnerDetailBody>
        <p className="docs-small">
          <Link href="/docs/partners" className="docs-link">
            ← All partners
          </Link>
        </p>
      </div>
    </article>
  );
}