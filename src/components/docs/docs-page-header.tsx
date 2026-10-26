import type { ReactNode } from "react";
import type { DocsPage } from "@/lib/docs/types";
export function DocsPageHeader({
  page,
  children,
}: {
  readonly page: DocsPage;
  readonly children?: ReactNode;
}) {
  return (
    <header className="docs-page-header">
      <p className="docs-page-section-label">{page.section}</p>
      <h1 className="docs-page-title">{page.title}</h1>
      <p className="docs-page-subtitle">{page.description}</p>
      {children ? <div className="mt-4">{children}</div> : null}
    </header>
  );
}