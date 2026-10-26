import { NewsPageClient } from "@/components/news/news-page-client";
import { PublicSiteContentShell } from "@/components/public-site/content-shell";
import { listPublishedNewsArticles } from "@/lib/news/store";
export const revalidate = 300;
export default async function NewsPage() {
  const articles = await listPublishedNewsArticles();
  return (
    <PublicSiteContentShell>
      <NewsPageClient articles={articles} />
    </PublicSiteContentShell>
  );
}
