"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, ExternalLink } from "lucide-react";
import { DOCS_SECTIONS, docsHref, type DocsPage } from "@/components/docs/docs-nav";
import { resolveActiveDocsSlug } from "@/lib/docs/navigation";
import { cn } from "@/lib/utils";
import { docsAbsoluteUrl } from "@/lib/site-url";
function DocsNavRow({
  page,
  active,
  onNavigate,
}: {
  readonly page: DocsPage;
  readonly active: boolean;
  readonly onNavigate?: () => void;
}) {
  return (
    <Link
      href={docsHref(page.slug)}
      onClick={onNavigate}
      className="docs-sidebar-link"
      data-active={active ? "true" : undefined}
      aria-current={active ? "page" : undefined}
    >
      <span className="min-w-0 truncate">{page.title}</span>
    </Link>
  );
}
function ExternalDocsLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: string;
}) {
  return (
    <a href={href} className="docs-sidebar-link" target="_blank" rel="noopener noreferrer">
      <span className="min-w-0 truncate">{children}</span>
      <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
    </a>
  );
}
export function DocsSidebar({
  onNavigate,
  className,
}: {
  readonly onNavigate?: () => void;
  readonly className?: string;
}) {
  const pathname = usePathname() ?? "";
  const activeSlug = resolveActiveDocsSlug(pathname);
  return (
    <nav className={cn("docs-sidebar-nav", className)} aria-label="Documentation">
      <div className="docs-sidebar-brand">
        <BookOpen className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
        <span>AgentRanking Docs</span>
      </div>
      <div className="docs-sidebar-groups">
        {DOCS_SECTIONS.map((section) => (
          <div key={section.id} className="docs-sidebar-section">
            <p className="docs-sidebar-section-label">{section.title}</p>
            <ul className="docs-sidebar-list">
              {section.items.map((page) => (
                <li key={page.slug || "overview"}>
                  <DocsNavRow page={page} active={activeSlug === page.slug} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="docs-sidebar-section">
          <p className="docs-sidebar-section-label">Robots</p>
          <ul className="docs-sidebar-list">
            <li>
              <ExternalDocsLink href={docsAbsoluteUrl("/llms.txt")}>Agent crawler file</ExternalDocsLink>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
}