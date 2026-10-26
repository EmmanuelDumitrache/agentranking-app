import type { Metadata } from "next";
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getNewsArticleBySlug } from "@/lib/news/store";
import type { NewsArticle } from "@/content/news/articles";
import { CATEGORY_LABELS, getAllArticleSlugs } from "@/content/news/articles";
import { ArticleAgentList } from "@/components/news/article-agent-list";
import { TwitterTweetIframe } from "@/components/news/twitter-tweet-iframe";
import { XonaIntegrationWidget } from "@/components/news/xona-integration-widget";
import { SynapseSentinelIntegrationWidget } from "@/components/news/synapse-sentinel-integration-widget";
import {
  AR_NEWS_SYNAPSE_A,
  AR_NEWS_SYNAPSE_B,
  splitNewsArticleMarkers,
} from "@/components/news/news-article-marker-split";
import { splitXonaArticleHtml } from "@/components/news/xona-article-content-split";
import { PublicSiteContentShell } from "@/components/public-site/content-shell";
import { getAgentsForArticle } from "@/lib/article-agents";
import { getPublicSiteUrl } from "@/lib/site-url";
import { hreflangLanguages } from "@/lib/seo-defaults";
import { buildFaqPageStructuredData } from "@/lib/seo-faq-jsonld";
import { format } from "date-fns";
type Props = { params: Promise<{ slug: string }> };
export const revalidate = 3600;
function publicSiteUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${getPublicSiteUrl()}${normalized}`;
}
export function generateStaticParams() {
  // Pre-render bundled editorial content without touching the runtime database.
  // DB-only slugs remain available on demand because dynamicParams defaults to true.
  return getAllArticleSlugs().map((slug) => ({ slug }));
}
function buildMetadata(article: NewsArticle): Metadata {
  const url = publicSiteUrl(`/news/${article.slug}`);
  const imageUrl = publicSiteUrl(article.image);
  const description =
    article.excerpt.length > 160 ? `${article.excerpt.slice(0, 157)}...` : article.excerpt;
  return {
    title: `${article.title} | AgentRanking`,
    description,
    alternates: {
      canonical: url,
      languages: hreflangLanguages(url),
    },
    openGraph: {
      title: article.title,
      description,
      url,
      siteName: "AgentRanking",
      type: "article" as const,
      publishedTime: article.publishedAt,
      authors: [article.author],
      images: [
        {
          url: imageUrl,
          alt: article.title,
          width: 800,
          height: 420,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description,
      images: [imageUrl],
    },
  };
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = await getNewsArticleBySlug(slug);
  if (!article) return { title: "Article Not Found | AgentRanking" };
  return buildMetadata(article);
}
function BreadcrumbListJsonLd({ article }: { article: NewsArticle }) {
  const articleUrl = publicSiteUrl(`/news/${article.slug}`);
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: getPublicSiteUrl() },
            { "@type": "ListItem", position: 2, name: "News", item: publicSiteUrl("/news") },
            { "@type": "ListItem", position: 3, name: article.title, item: articleUrl },
          ],
        }),
      }}
    />
  );
}
function NewsArticleJsonLd({ article }: { article: NewsArticle }) {
  const url = publicSiteUrl(`/news/${article.slug}`);
  const imageUrl = publicSiteUrl(article.image);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    description: article.excerpt,
    image: imageUrl,
    datePublished: article.publishedAt,
    dateModified: article.publishedAt,
    author: {
      "@type": "Organization",
      name: article.author,
      url: getPublicSiteUrl(),
    },
    publisher: {
      "@type": "Organization",
      name: "AgentRanking",
      url: getPublicSiteUrl(),
      logo: {
        "@type": "ImageObject",
        url: publicSiteUrl("/logo-icon.png"),
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
    url,
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
function HowToJsonLd({ article }: { article: NewsArticle }) {
  if (!article.howToSteps || article.howToSteps.length === 0) return null;
  const url = publicSiteUrl(`/news/${article.slug}`);
  const imageUrl = publicSiteUrl(article.image);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: article.title,
    description: article.excerpt,
    image: imageUrl,
    url,
    step: article.howToSteps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
function FAQPageJsonLd({ article }: { article: NewsArticle }) {
  if (!article.faq || article.faq.length === 0) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(buildFaqPageStructuredData(article.faq)),
      }}
    />
  );
}
const XONA_FEATURE_SLUG = "feature-xona-agent-creative-x402-sap";
const SENTINEL_FEATURE_SLUG = "feature-synapse-sentinel-oobe-sap-gateway";
function NewsArticleBody({
  article,
  articleContentClasses,
  agents,
  xonaPieces,
  sentinelPieces,
}: {
  article: NewsArticle;
  articleContentClasses: string;
  agents: Awaited<ReturnType<typeof getAgentsForArticle>>;
  xonaPieces: ReturnType<typeof splitXonaArticleHtml>;
  sentinelPieces: ReturnType<typeof splitNewsArticleMarkers>;
}): ReactNode {
  if (article.agentList != null) {
    return (
      <>
        {article.contentBeforeList != null && (
          <div
            className={articleContentClasses}
            dangerouslySetInnerHTML={{ __html: article.contentBeforeList.trim() }}
          />
        )}
        <ArticleAgentList agents={agents} />
        {article.contentAfterList != null && (
          <div
            className={articleContentClasses}
            dangerouslySetInnerHTML={{ __html: article.contentAfterList.trim() }}
          />
        )}
      </>
    );
  }
  if (
    article.slug === XONA_FEATURE_SLUG &&
    article.newsEmbeds != null &&
    article.content != null &&
    xonaPieces != null
  ) {
    return (
      <>
        <div
          className={articleContentClasses}
          dangerouslySetInnerHTML={{ __html: xonaPieces.leadHtml }}
        />
        <XonaIntegrationWidget />
        <div
          className={articleContentClasses}
          dangerouslySetInnerHTML={{ __html: xonaPieces.seekerMidHtml }}
        />
        <p className="text-xs text-muted-foreground">
          Embedded post below loads live from{" "}
          <a
            href="https://x.com"
            rel="noopener noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            X
          </a>{" "}
          — not an AgentRanking screenshot.
        </p>
        {article.newsEmbeds.tweetIframeIds.map((tweetId) => (
          <TwitterTweetIframe key={tweetId} tweetId={tweetId} />
        ))}
        <p className="text-xs text-muted-foreground -mt-2 mb-6">
          First-party updates from the project post to{" "}
          <a
            href="https://x.com/xona_agent"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            @xona_agent on X
          </a>
          ; this page embeds ecosystem coverage that quotes the same rollout.
        </p>
        <div
          className={articleContentClasses}
          dangerouslySetInnerHTML={{ __html: xonaPieces.tailHtml }}
        />
      </>
    );
  }
  if (article.slug === SENTINEL_FEATURE_SLUG && article.content != null && sentinelPieces != null) {
    const tweetIds = article.newsEmbeds?.tweetIframeIds ?? [];
    return (
      <>
        <div
          className={articleContentClasses}
          dangerouslySetInnerHTML={{ __html: sentinelPieces.leadHtml }}
        />
        <SynapseSentinelIntegrationWidget />
        <div
          className={articleContentClasses}
          dangerouslySetInnerHTML={{ __html: sentinelPieces.middleHtml }}
        />
        {tweetIds.length > 0 ? (
          <>
            <p className="text-xs text-muted-foreground">
              Embedded post below loads live from{" "}
              <a
                href="https://x.com"
                rel="noopener noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                X
              </a>{" "}
              — not an AgentRanking screenshot.
            </p>
            {tweetIds.map((tweetId) => (
              <TwitterTweetIframe key={tweetId} tweetId={tweetId} />
            ))}
            <p className="text-xs text-muted-foreground -mt-2 mb-6">
              OOBE-aligned updates also circulate on{" "}
              <a
                href="https://x.com/SynapseOobe"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                @SynapseOobe
              </a>
              .
            </p>
          </>
        ) : null}
        <div
          className={articleContentClasses}
          dangerouslySetInnerHTML={{ __html: sentinelPieces.tailHtml }}
        />
      </>
    );
  }
  if (article.content != null) {
    return (
      <div
        className={articleContentClasses}
        dangerouslySetInnerHTML={{ __html: article.content.trim() }}
      />
    );
  }
  return null;
}
const articleContentClasses =
  "news-article-prose";
export default async function NewsArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = await getNewsArticleBySlug(slug);
  if (!article) {
    notFound();
  }
  const xonaPieces =
    article.slug === XONA_FEATURE_SLUG && article.newsEmbeds != null && article.content != null
      ? splitXonaArticleHtml(article.content.trim())
      : null;
  const sentinelPieces =
    article.slug === SENTINEL_FEATURE_SLUG && article.content != null
      ? splitNewsArticleMarkers(
          article.content.trim(),
          AR_NEWS_SYNAPSE_A,
          AR_NEWS_SYNAPSE_B,
        )
      : null;
  let agents: Awaited<ReturnType<typeof getAgentsForArticle>> = [];
  if (article.agentList != null) {
    try {
      agents = await getAgentsForArticle({
        sort: article.agentList.sort,
        limit: article.agentList.limit,
        chainId: article.agentList.chainId,
        x402: article.agentList.x402,
      });
    } catch {
      agents = [];
    }
  }
  const isSentinelFeatureArticle = article.slug === SENTINEL_FEATURE_SLUG;
  return (
    <>
      <BreadcrumbListJsonLd article={article} />
      <NewsArticleJsonLd article={article} />
      <HowToJsonLd article={article} />
      <FAQPageJsonLd article={article} />
      <PublicSiteContentShell>
      <main className="news-article-page">
        <article className="news-article-shell">
          <Link href="/news" className="ar-link news-back-link">
            Back to News
          </Link>
          <header className="news-article-header">
            {isSentinelFeatureArticle ? (
              <p className="news-article-kicker">Feature</p>
            ) : article.category ? (
              <p className="news-article-kicker">{CATEGORY_LABELS[article.category]}</p>
            ) : null}
            <time dateTime={article.publishedAt} className="news-article-date">
              {format(new Date(article.publishedAt), "MMMM d, yyyy")}
            </time>
            <h1 className="news-article-title">{article.title}</h1>
            <p className="news-article-excerpt">{article.excerpt}</p>
            <p className="news-article-byline">By {article.author}</p>
          </header>
          <div className="news-article-hero">
            <Image
              src={article.image}
              alt={article.title}
              fill
              className={isSentinelFeatureArticle ? "object-contain" : "object-cover"}
              sizes="(max-width: 768px) 100vw, 768px"
              priority
            />
          </div>
          <NewsArticleBody
            article={article}
            articleContentClasses={articleContentClasses}
            agents={agents}
            xonaPieces={xonaPieces}
            sentinelPieces={sentinelPieces}
          />
        </article>
      </main>
      </PublicSiteContentShell>
    </>
  );
}
