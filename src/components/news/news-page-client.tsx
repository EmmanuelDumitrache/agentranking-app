"use client";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CATEGORY_LABELS, type ArticleCategory, type NewsArticle } from "@/content/news/articles";
import { cn } from "@/lib/utils";
const ALL_CATEGORIES = Object.entries(CATEGORY_LABELS) as [ArticleCategory, string][];
export function NewsPageClient({ articles }: { readonly articles: readonly NewsArticle[] }) {
  const [activeCategory, setActiveCategory] = useState<ArticleCategory | "all">("all");
  const filtered = useMemo(() => {
    if (activeCategory === "all") return articles;
    return articles.filter((article) => article.category === activeCategory);
  }, [activeCategory, articles]);
  return (
    <main className="news-page">
      <div className="news-shell ar-public-container">
        <header className="news-header">
          <p className="ar-public-label mb-3">AgentRanking News</p>
          <h1 className="news-header-title">News</h1>
          <p className="news-header-sub">
            ERC-8004 ecosystem updates, crypto AI agent guides, MCP notes, x402 payments, and protocol explainers.
          </p>
        </header>
        <div className="news-filters" role="tablist" aria-label="Article categories">
          <button
            type="button"
            role="tab"
            aria-selected={activeCategory === "all"}
            className={cn("news-filter-pill", activeCategory === "all" && "news-filter-pill--active")}
            onClick={() => setActiveCategory("all")}
          >
            All
          </button>
          {ALL_CATEGORIES.map(([cat, label]) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={activeCategory === cat}
              className={cn("news-filter-pill", activeCategory === cat && "news-filter-pill--active")}
              onClick={() => setActiveCategory(cat)}
            >
              {label}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <p className="news-empty">No articles in this category yet.</p>
        ) : (
          <div className="news-grid">
            {filtered.map((article) => (
              <Link key={article.slug} href={`/news/${article.slug}`} className="news-card group">
                <div className="news-card-media">
                  <Image
                    src={article.image}
                    alt=""
                    fill
                    className="news-card-image"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                  {article.category ? (
                    <span className="news-card-category">{CATEGORY_LABELS[article.category]}</span>
                  ) : null}
                </div>
                <div className="news-card-body">
                  <time dateTime={article.publishedAt} className="news-card-date">
                    {format(new Date(article.publishedAt), "d MMM yyyy")}
                  </time>
                  <h2 className="news-card-title">{article.title}</h2>
                  <p className="news-card-excerpt">{article.excerpt}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}