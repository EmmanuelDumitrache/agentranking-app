import { DOCS_OVERVIEW, DOCS_SECTIONS } from "@/lib/docs/config";
import { getDocsPageSpec } from "@/lib/docs/content/pages";
import type { DocsNavMatch, DocsPage } from "@/lib/docs/types";
export function docsHref(slug: string): string {
  return slug === "" ? "/docs" : `/docs/${slug}`;
}
export function normalizeDocsPathname(pathname: string): string {
  const t = pathname.replace(/\/+$/, "");
  return t === "" ? "/" : t;
}
export function getAllDocsPages(): readonly DocsPage[] {
  return DOCS_SECTIONS.flatMap((section) => section.items);
}
export function getAllDocsSlugs(): readonly string[] {
  return getAllDocsPages()
    .map((page) => page.slug)
    .filter((slug) => slug !== "");
}
export function getDocsPageBySlug(slug: string): DocsPage | undefined {
  if (slug === "") return DOCS_OVERVIEW;
  return getAllDocsPages().find((page) => page.slug === slug);
}
export function getDocsPageByPathname(pathname: string): DocsPage | undefined {
  const normalized = normalizeDocsPathname(pathname);
  if (normalized === "/docs") return DOCS_OVERVIEW;
  if (!normalized.startsWith("/docs/")) return undefined;
  const slug = normalized.slice("/docs/".length).split("#")[0] ?? "";
  return getDocsPageBySlug(slug);
}
export function resolveActiveDocsSlug(pathname: string): string {
  const page = getDocsPageByPathname(pathname);
  return page?.slug ?? "";
}
export function isDocsPageActive(pathname: string, slug: string): boolean {
  return resolveActiveDocsSlug(pathname) === slug;
}
export function findDocsNavMatch(pathname: string): DocsNavMatch | undefined {
  const page = getDocsPageByPathname(pathname);
  if (!page) return undefined;
  const section = DOCS_SECTIONS.find((s) => s.items.some((item) => item.slug === page.slug));
  if (!section) return undefined;
  return { section, page };
}
export type DocsPrevNext = {
  readonly prev?: DocsPage;
  readonly next?: DocsPage;
};
export function getDocsPrevNext(slug: string): DocsPrevNext {
  const pages = getAllDocsPages();
  const index = pages.findIndex((page) => page.slug === slug);
  if (index === -1) return {};
  return {
    prev: index > 0 ? pages[index - 1] : undefined,
    next: index < pages.length - 1 ? pages[index + 1] : undefined,
  };
}
export function getDocsPageTitle(page: DocsPage): string {
  const spec = getDocsPageSpec(page.slug);
  return spec?.pageTitle ?? page.title;
}
export function getDocsPageSubtitle(page: DocsPage): string {
  const spec = getDocsPageSpec(page.slug);
  return spec?.subtitle ?? page.description;
}