import { notFound } from "next/navigation";
import { DocsPageSection } from "@/components/docs/docs-master-page";
import { getDocsPageBySlug } from "@/lib/docs/navigation";
export function DocsSinglePage({ slug }: { readonly slug: string }) {
  const page = getDocsPageBySlug(slug);
  if (!page) notFound();
  return (
    <article className="docs-page-article">
      <DocsPageSection page={page} />
    </article>
  );
}