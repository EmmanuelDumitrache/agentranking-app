import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  ARTICLES as STATIC_ARTICLES,
  type ArticleCategory,
  type NewsArticle,
} from "@/content/news/articles";
function isProductionBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function bundledPublishedNewsArticles(): NewsArticle[] {
  return [...STATIC_ARTICLES].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

type SiteNewsRow = {
  slug: string;
  title: string;
  excerpt: string;
  content: string | null;
  contentBeforeList: string | null;
  contentAfterList: string | null;
  image: string;
  publishedAt: Date;
  author: string;
  category: string | null;
  agentList: unknown;
  howToSteps: unknown;
  faq: unknown;
  newsEmbeds: unknown;
  published: boolean;
};
function parseJsonField<T>(value: unknown): T | undefined {
  if (value == null) return undefined;
  return value as T;
}
export function rowToNewsArticle(row: SiteNewsRow): NewsArticle {
  return {
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    content: row.content ?? undefined,
    contentBeforeList: row.contentBeforeList ?? undefined,
    contentAfterList: row.contentAfterList ?? undefined,
    image: row.image,
    publishedAt: row.publishedAt.toISOString(),
    author: row.author,
    category: (row.category as ArticleCategory | null) ?? undefined,
    agentList: parseJsonField(row.agentList),
    howToSteps: parseJsonField(row.howToSteps),
    faq: parseJsonField(row.faq),
    newsEmbeds: parseJsonField(row.newsEmbeds),
  };
}
export function newsArticleToRowInput(article: NewsArticle & { published?: boolean }) {
  return {
    slug: article.slug.trim(),
    title: article.title.trim(),
    excerpt: article.excerpt.trim(),
    content: article.content ?? null,
    contentBeforeList: article.contentBeforeList ?? null,
    contentAfterList: article.contentAfterList ?? null,
    image: article.image.trim(),
    publishedAt: new Date(article.publishedAt),
    author: article.author.trim() || "AgentRanking",
    category: article.category ?? null,
    agentList: article.agentList == null ? Prisma.JsonNull : (article.agentList as unknown as Prisma.InputJsonValue),
    howToSteps: article.howToSteps == null ? Prisma.JsonNull : (article.howToSteps as unknown as Prisma.InputJsonValue),
    faq: article.faq == null ? Prisma.JsonNull : (article.faq as unknown as Prisma.InputJsonValue),
    newsEmbeds: article.newsEmbeds == null ? Prisma.JsonNull : (article.newsEmbeds as unknown as Prisma.InputJsonValue),
    published: article.published ?? true,
  };
}
async function countDbArticles(): Promise<number> {
  return prisma.siteNewsArticle.count();
}
export async function listPublishedNewsArticles(): Promise<NewsArticle[]> {
  // Production artifact generation must not depend on runtime database access.
  // Bundled articles are the build-time snapshot; ISR refreshes from Prisma later.
  if (isProductionBuildPhase()) return bundledPublishedNewsArticles();
  const count = await countDbArticles();
  if (count === 0) return bundledPublishedNewsArticles();
  const rows = await prisma.siteNewsArticle.findMany({
    where: { published: true },
    orderBy: { publishedAt: "desc" },
  });
  return rows.map(rowToNewsArticle);
}
export async function listLatestPublishedNewsArticles(limit: number): Promise<NewsArticle[]> {
  const articles = await listPublishedNewsArticles();
  return articles.slice(0, Math.max(0, limit));
}
export async function listAllNewsArticlesAdmin(): Promise<(NewsArticle & { id: number; published: boolean })[]> {
  const count = await countDbArticles();
  if (count === 0) {
    return STATIC_ARTICLES.map((article, index) => ({
      ...article,
      id: -(index + 1),
      published: true,
    }));
  }
  const rows = await prisma.siteNewsArticle.findMany({ orderBy: { publishedAt: "desc" } });
  return rows.map((row) => ({
    ...rowToNewsArticle(row),
    id: row.id,
    published: row.published,
  }));
}
export async function getNewsArticleBySlug(slug: string): Promise<NewsArticle | undefined> {
  // generateMetadata and static page generation both execute during `next build`.
  // Resolve bundled articles locally in that phase and defer DB-backed overrides to ISR.
  if (isProductionBuildPhase()) return STATIC_ARTICLES.find((a) => a.slug === slug);
  const count = await countDbArticles();
  if (count === 0) {
    return STATIC_ARTICLES.find((a) => a.slug === slug);
  }
  const row = await prisma.siteNewsArticle.findFirst({
    where: { slug, published: true },
  });
  if (!row) return undefined;
  return rowToNewsArticle(row);
}
export async function getNewsArticleBySlugAdmin(
  slug: string,
): Promise<(NewsArticle & { id: number; published: boolean }) | undefined> {
  const row = await prisma.siteNewsArticle.findUnique({ where: { slug } });
  if (!row) {
    const staticArticle = STATIC_ARTICLES.find((a) => a.slug === slug);
    if (!staticArticle) return undefined;
    return { ...staticArticle, id: 0, published: true };
  }
  return { ...rowToNewsArticle(row), id: row.id, published: row.published };
}
export async function importStaticNewsArticles(): Promise<{ imported: number; updated: number }> {
  let imported = 0;
  let updated = 0;
  for (const article of STATIC_ARTICLES) {
    const data = newsArticleToRowInput(article);
    const existing = await prisma.siteNewsArticle.findUnique({ where: { slug: article.slug } });
    if (existing) {
      await prisma.siteNewsArticle.update({ where: { slug: article.slug }, data });
      updated += 1;
    } else {
      await prisma.siteNewsArticle.create({ data });
      imported += 1;
    }
  }
  return { imported, updated };
}
export async function upsertNewsArticle(
  input: NewsArticle & { published?: boolean },
): Promise<NewsArticle> {
  const data = newsArticleToRowInput(input);
  const row = await prisma.siteNewsArticle.upsert({
    where: { slug: data.slug },
    create: data,
    update: data,
  });
  return rowToNewsArticle(row);
}
export async function deleteNewsArticleBySlug(slug: string): Promise<boolean> {
  const result = await prisma.siteNewsArticle.deleteMany({ where: { slug } });
  return result.count > 0;
}
