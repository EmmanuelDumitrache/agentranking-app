"use client";
import { usePathname } from "next/navigation";
import { ArLiveFeedWidget } from "@/components/public-site/ar-live-feed";
import { PublicSiteFooter } from "@/components/public-site/public-site-footer";
import { PublicSiteNav } from "@/components/public-site/public-site-nav";
import { PublicWaveBackground } from "@/components/public-site/public-wave-background";
import { cn } from "@/lib/utils";
import type { PublicFooterColumn, PublicNavItem } from "@/lib/site-config";

type Props = {
  readonly children: React.ReactNode;
  readonly navLinks: readonly PublicNavItem[];
  readonly footerColumns: readonly PublicFooterColumn[];
  readonly showFooter?: boolean;
  readonly hideWaveBackground?: boolean;
  readonly hideNav?: boolean;
  readonly mainClassName?: string;
};
function shouldShowLiveFeed(pathname: string): boolean {
  if (pathname === "/" || pathname === "/ranking" || pathname === "/agents") {
    return true;
  }
  if (pathname === "/tokens" || pathname.startsWith("/tokens/")) {
    return true;
  }
  // Public agent dossiers.
  if (pathname.startsWith("/agents/")) {
    return true;
  }
  return false;
}
/** Shared public-site chrome using the canonical application theme. */
export function PublicSiteChrome({
  children,
  navLinks,
  footerColumns,
  showFooter = true,
  hideWaveBackground = false,
  hideNav = false,
  mainClassName,
}: Props) {
  const pathname = usePathname() ?? "";
  const showLiveFeed = shouldShowLiveFeed(pathname);
  return (
    <div
      className={cn(
        "app-surface ui-app relative flex min-h-screen flex-col text-foreground",
        hideWaveBackground ? "ui-app--landing-v3 !bg-[#0f1011]" : "!bg-transparent",
      )}
    >
      {hideWaveBackground ? null : <PublicWaveBackground />}
      {hideNav ? null : <PublicSiteNav links={navLinks} />}
      <main
        className={cn(
          "ui-main ui-main--public-site relative z-10 min-w-0 flex-1",
          mainClassName,
        )}
      >
        {children}
      </main>
      {showFooter ? <PublicSiteFooter columns={footerColumns} /> : null}
      {showLiveFeed ? <ArLiveFeedWidget /> : null}
    </div>
  );
}
