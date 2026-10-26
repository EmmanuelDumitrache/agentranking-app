"use client";
import { useEffect, useMemo, useState } from "react";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { DocsSiteHeader } from "@/components/docs/docs-site-header";
import { buildPublicNavLinks, publicPageUrls } from "@/lib/public-page-urls";
/** Activates public nav tokens on `<html>` without public-site marketing backgrounds. */
function DocsHtmlScope({ children }: { readonly children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add("ar-public", "docs-route");
    return () => {
      document.documentElement.classList.remove("ar-public", "docs-route");
    };
  }, []);
  return <div className="docs-root ar-public docs-route">{children}</div>;
}
export function DocsChrome({ children }: { readonly children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navLinks = useMemo(() => buildPublicNavLinks(), []);
  return (
    <DocsHtmlScope>
      <DocsSiteHeader
        homeHref="/"
        verifyHref="/dashboard"
        stakeHref={publicPageUrls.stake}
        links={navLinks}
        onOpenDocsMenu={() => setMobileNavOpen(true)}
      />
      <div className="docs-shell">
        <div className="docs-layout">
          <aside className="docs-sidebar" aria-label="Documentation sections">
            <DocsSidebar />
          </aside>
          {mobileNavOpen ? (
            <>
              <button
                type="button"
                className="docs-mobile-drawer-backdrop"
                aria-label="Close documentation menu"
                onClick={() => setMobileNavOpen(false)}
              />
              <div className="docs-mobile-drawer">
                <DocsSidebar onNavigate={() => setMobileNavOpen(false)} className="h-full" />
              </div>
            </>
          ) : null}
          <main className="docs-main">
            <div className="docs-content">{children}</div>
          </main>
        </div>
      </div>
    </DocsHtmlScope>
  );
}
