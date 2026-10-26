import "server-only";

import { listAllNewsArticlesAdmin } from "@/lib/news/store";
import { requireAdminOperationsSession } from "./auth.server";

export async function readAdminNewsArticles() {
  await requireAdminOperationsSession();
  const articles = await listAllNewsArticlesAdmin();
  return {
    articles: articles.map((article) => ({
      id: article.id,
      slug: article.slug,
      title: article.title,
      excerpt: article.excerpt,
      ...(article.content === undefined ? {} : { content: article.content }),
      ...(article.contentBeforeList === undefined
        ? {}
        : { contentBeforeList: article.contentBeforeList }),
      ...(article.contentAfterList === undefined
        ? {}
        : { contentAfterList: article.contentAfterList }),
      image: article.image,
      publishedAt: article.publishedAt,
      author: article.author,
      ...(article.category === undefined ? {} : { category: article.category }),
      ...(article.agentList === undefined ? {} : { agentList: article.agentList }),
      ...(article.howToSteps === undefined ? {} : { howToSteps: article.howToSteps }),
      ...(article.faq === undefined ? {} : { faq: article.faq }),
      ...(article.newsEmbeds === undefined ? {} : { newsEmbeds: article.newsEmbeds }),
      published: article.published,
    })),
  };
}
