"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, Loader2, Newspaper, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_LABELS, type ArticleCategory } from "@/content/news/articles";
import { showToast } from "@/components/ui/toast-simple";
export type AdminArticleDto = {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  content?: string;
  image: string;
  publishedAt: string;
  author: string;
  category?: ArticleCategory;
  published: boolean;
};
const EMPTY_FORM = {
  slug: "",
  title: "",
  excerpt: "",
  content: "",
  image: "/news/articles/boost-visibility-2026.png",
  publishedAt: new Date().toISOString().slice(0, 16),
  author: "AgentRanking",
  category: "guides" as ArticleCategory,
  published: true,
};
async function fetchArticles(): Promise<{ articles: AdminArticleDto[] }> {
  const res = await fetch("/api/admin/news");
  if (!res.ok) throw new Error("Failed to load articles");
  return res.json();
}
export function AdminNewsClient({ initialData }: { readonly initialData: { articles: AdminArticleDto[] } }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-news"],
    queryFn: fetchArticles,
    initialData,
    staleTime: 60_000,
  });
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const articles = useMemo(() => data?.articles ?? [], [data?.articles]);
  const editingArticle = useMemo(
    () => articles.find((article) => article.slug === editingSlug),
    [articles, editingSlug],
  );
  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import-static" }),
      });
      const json = (await res.json()) as { error?: string; imported?: number; updated?: number };
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      return json;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["admin-news"] });
      showToast(`Imported ${result.imported ?? 0}, updated ${result.updated ?? 0}`, "success");
    },
    onError: (err) => showToast(err.message, "error"),
  });
  const saveMutation = useMutation({
    mutationFn: async () => {
      const isEdit = Boolean(editingSlug);
      const res = await fetch(isEdit ? `/api/admin/news/${encodeURIComponent(editingSlug!)}` : "/api/admin/news", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          publishedAt: new Date(form.publishedAt).toISOString(),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Save failed");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-news"] });
      showToast("Article saved", "success");
      setEditingSlug(null);
      setForm(EMPTY_FORM);
    },
    onError: (err) => showToast(err.message, "error"),
  });
  const deleteMutation = useMutation({
    mutationFn: async (slug: string) => {
      const res = await fetch(`/api/admin/news/${encodeURIComponent(slug)}`, { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Delete failed");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-news"] });
      showToast("Article deleted", "success");
      setEditingSlug(null);
      setForm(EMPTY_FORM);
    },
    onError: (err) => showToast(err.message, "error"),
  });
  function startCreate() {
    setEditingSlug(null);
    setForm({ ...EMPTY_FORM, image: "/news/articles/boost-visibility-2026.png" });
  }
  function startEdit(article: AdminArticleDto) {
    setEditingSlug(article.slug);
    setForm({
      slug: article.slug,
      title: article.title,
      excerpt: article.excerpt,
      content: article.content ?? "",
      image: article.image,
      publishedAt: article.publishedAt.slice(0, 16),
      author: article.author,
      category: article.category ?? "guides",
      published: article.published,
    });
  }
  return (
    <div className="container max-w-6xl mx-auto px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Newspaper className="h-5 w-5" />
            News articles
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage /news without redeploying. Import codebase articles once, then edit in place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => importMutation.mutate()} disabled={importMutation.isPending}>
            {importMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-1.5">Import from codebase</span>
          </Button>
          <Button size="sm" onClick={startCreate}>
            <Plus className="h-4 w-4" />
            <span className="ml-1.5">New article</span>
          </Button>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-xl border border-border overflow-hidden">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading articles…</div>
          ) : error ? (
            <div className="p-4 text-sm text-red-400 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error.message}
            </div>
          ) : articles.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No DB articles yet. Click &quot;Import from codebase&quot; to seed existing articles.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left py-2.5 px-4 text-xs text-muted-foreground">Title</th>
                  <th className="text-left py-2.5 px-3 text-xs text-muted-foreground">Category</th>
                  <th className="text-left py-2.5 px-3 text-xs text-muted-foreground">Published</th>
                  <th className="text-right py-2.5 px-4 text-xs text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {articles.map((article) => (
                  <tr key={article.slug} className="border-b border-border hover:bg-muted/20">
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        className="text-left font-medium hover:underline"
                        onClick={() => startEdit(article)}
                      >
                        {article.title}
                      </button>
                      <p className="text-[11px] text-muted-foreground mt-0.5">/{article.slug}</p>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">
                      {article.category ? CATEGORY_LABELS[article.category] : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">
                      {format(new Date(article.publishedAt), "d MMM yyyy")}
                      {!article.published ? (
                        <span className="ml-2 text-[10px] uppercase text-amber-400">Draft</span>
                      ) : null}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex gap-2">
                        <Link href={`/news/${article.slug}`} className="text-xs text-primary hover:underline" target="_blank">
                          View
                        </Link>
                        <button
                          type="button"
                          className="text-xs text-red-400 hover:underline"
                          onClick={() => {
                            if (window.confirm(`Delete "${article.title}"?`)) {
                              deleteMutation.mutate(article.slug);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="rounded-xl border border-border p-4 space-y-3 h-fit lg:sticky lg:top-4">
          <h2 className="text-sm font-semibold">{editingSlug ? "Edit article" : "New article"}</h2>
          {editingArticle?.id != null && editingArticle.id <= 0 ? (
            <p className="text-xs text-amber-400">Static-only article — import to DB before editing rich embeds.</p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="news-slug">Slug</Label>
            <Input id="news-slug" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="news-title">Title</Label>
            <Input id="news-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="news-excerpt">Excerpt</Label>
            <Textarea id="news-excerpt" rows={2} value={form.excerpt} onChange={(e) => setForm((f) => ({ ...f, excerpt: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="news-content">Content (HTML)</Label>
            <Textarea id="news-content" rows={8} value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="news-image">Hero image path</Label>
            <Input id="news-image" value={form.image} onChange={(e) => setForm((f) => ({ ...f, image: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label htmlFor="news-category">Category</Label>
              <select
                id="news-category"
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as ArticleCategory }))}
              >
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="news-date">Published at</Label>
              <Input
                id="news-date"
                type="datetime-local"
                value={form.publishedAt}
                onChange={(e) => setForm((f) => ({ ...f, publishedAt: e.target.value }))}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.published}
              onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked }))}
            />
            Published
          </label>
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
            {editingSlug ? (
              <Button
                size="sm"
                variant="outline"
                className="text-red-400"
                onClick={() => {
                  if (window.confirm("Delete this article?")) deleteMutation.mutate(editingSlug);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
