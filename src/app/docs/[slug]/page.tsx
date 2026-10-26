import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsSinglePage } from "@/components/docs/docs-single-page";
import { getAllDocsSlugs, getDocsPageBySlug, getDocsPageTitle, getDocsPageSubtitle } from "@/lib/docs/navigation";
import { docsAbsoluteUrl } from "@/lib/site-url";
import { mergeWithGlobal } from "@/lib/seo-keywords";
import { defaultOgImageMetadata, hreflangLanguages } from "@/lib/seo-defaults";
type PageProps = {
  readonly params: Promise<{ readonly slug: string }>;
};
export function generateStaticParams() {
  return getAllDocsSlugs().map((slug) => ({ slug }));
}
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getDocsPageBySlug(slug);
  if (!page) return {};
  const title = getDocsPageTitle(page);
  const description = getDocsPageSubtitle(page);
  const canonical = docsAbsoluteUrl(`/docs/${slug}`);
  const og = defaultOgImageMetadata();
  return {
    title,
    description,
    keywords: mergeWithGlobal("AgentRanking docs", page.title, page.section),
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
export default async function DocsSlugPage({ params }: PageProps) {
  const { slug } = await params;
  const page = getDocsPageBySlug(slug);
  if (!page || page.slug === "") notFound();
  return <DocsSinglePage slug={slug} />;
}