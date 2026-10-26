import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth-session";
import type { ArticleCategory } from "@/content/news/articles";
import {
  deleteNewsArticleBySlug,
  getNewsArticleBySlugAdmin,
  upsertNewsArticle,
} from "@/lib/news/store";
export const dynamic = "force-dynamic";
const CATEGORIES = new Set<ArticleCategory>([
  "protocol",
  "guides",
  "mcp",
  "telegram",
  "payments",
  "rankings",
  "ecosystem",
]);
function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
type ArticleBody = {
  slug?: string;
  title?: string;
  excerpt?: string;
  content?: string;
  image?: string;
  publishedAt?: string;
  author?: string;
  category?: string | null;
  published?: boolean;
};
function parseBody(body: ArticleBody, existingSlug?: string) {
  const slug = slugify(body.slug ?? existingSlug ?? "");
  const title = body.title?.trim() ?? "";
  const excerpt = body.excerpt?.trim() ?? "";
  const image = body.image?.trim() ?? "";
  if (!slug) return { error: "Slug is required." };
  if (!title) return { error: "Title is required." };
  if (!excerpt) return { error: "Excerpt is required." };
  if (!image) return { error: "Image URL is required." };
  const publishedAt = body.publishedAt ? new Date(body.publishedAt) : new Date();
  if (Number.isNaN(publishedAt.getTime())) {
    return { error: "Invalid published date." };
  }
  const categoryRaw = body.category?.trim();
  const category =
    categoryRaw && CATEGORIES.has(categoryRaw as ArticleCategory)
      ? (categoryRaw as ArticleCategory)
      : undefined;
  return {
    article: {
      slug,
      title,
      excerpt,
      content: body.content?.trim() || undefined,
      image,
      publishedAt: publishedAt.toISOString(),
      author: body.author?.trim() || "AgentRanking",
      category,
      published: body.published ?? true,
    },
  };
}
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { slug } = await params;
  try {
    const article = await getNewsArticleBySlugAdmin(slug);
    if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ article });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { slug } = await params;
  try {
    const existing = await getNewsArticleBySlugAdmin(slug);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = (await request.json()) as ArticleBody;
    const parsed = parseBody(body, slug);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const article = await upsertNewsArticle({
      ...existing,
      ...parsed.article,
      content: parsed.article.content ?? existing.content,
      contentBeforeList: existing.contentBeforeList,
      contentAfterList: existing.contentAfterList,
      agentList: existing.agentList,
      howToSteps: existing.howToSteps,
      faq: existing.faq,
      newsEmbeds: existing.newsEmbeds,
    });
    if (slug !== parsed.article.slug) {
      await deleteNewsArticleBySlug(slug);
    }
    return NextResponse.json({ article });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { slug } = await params;
  try {
    const deleted = await deleteNewsArticleBySlug(slug);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}