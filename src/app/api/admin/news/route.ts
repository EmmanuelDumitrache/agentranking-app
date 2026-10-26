import { NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth-session";
import { readAdminNewsArticles } from "@/lib/admin/operations/news.server";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import type { ArticleCategory } from "@/content/news/articles";
import { importStaticNewsArticles, upsertNewsArticle } from "@/lib/news/store";
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
  action?: string;
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
function parseArticleBody(body: ArticleBody) {
  const slug = slugify(body.slug ?? "");
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
export async function GET() {
  try {
    return NextResponse.json(await readAdminNewsArticles());
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as ArticleBody;
    if (body.action === "import-static") {
      const result = await importStaticNewsArticles();
      return NextResponse.json({ ok: true, ...result });
    }
    const parsed = parseArticleBody(body);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const article = await upsertNewsArticle(parsed.article);
    return NextResponse.json({ article });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
