"use client";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { ChevronDown, LayoutDashboard, Menu, Rocket, X } from "lucide-react";
import { AgentRankingWordmark } from "@/components/layout/agent-ranking-wordmark";
import { PublicNavLink } from "@/components/public-site/public-nav-link";
import {
  filterPublicNavIslandLinks,
  PUBLIC_NAV_ISLAND_LINK_ACTIVE_CLASS,
  PUBLIC_NAV_ISLAND_LINK_CLASS,
  PUBLIC_NAV_ISLAND_NAV_CLASS,
  PUBLIC_NAV_ISLAND_NAV_STYLE,
  PUBLIC_NAV_LAUNCH_CTA_CLASS,
  PUBLIC_NAV_LAUNCH_CTA_LABEL,
  PUBLIC_NAV_LAUNCH_CTA_MOBILE_CLASS,
  PUBLIC_NAV_LOGO_LINK_CLASS,
} from "@/components/public-site/public-nav-island";
import { PublicNavLaunchMenuItems } from "@/components/public-site/public-nav-launch-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { publicSiteRoutes } from "@/lib/public-site/routes";
import { getPublicSiteUrl } from "@/lib/site-url";
import {
  isPublicNavDropdown,
  type PublicNavItem,
  type PublicNavLink as PublicNavLinkItem,
} from "@/lib/site-config";
import { cn } from "@/lib/utils";

const launchMenuItemClass =
  "flex w-full cursor-pointer items-center gap-2.5 px-2 py-2";
function normalizePath(href: string): string {
  const withoutHash = href.split("#")[0] ?? href;
  try {
    if (withoutHash.startsWith("http://") || withoutHash.startsWith("https://")) {
      const url = new URL(href);
      return url.pathname.replace(/\/+$/, "") || "/";
    }
  } catch {
    return withoutHash || "/";
  }
  return withoutHash.split("?")[0] || "/";
}
function isActive(pathname: string, href: string): boolean {
  if (href.includes("#")) return false;
  if (href.startsWith("http://") || href.startsWith("https://")) {
    try {
      const url = new URL(href);
      if (typeof window !== "undefined") {
        const currentHost = window.location.hostname.toLowerCase();
        if (url.hostname.toLowerCase() !== currentHost) return false;
      }
      const path = url.pathname.replace(/\/+$/, "") || "/";
      return pathname === path || pathname.startsWith(`${path}/`);
    } catch {
      return false;
    }
  }
  const path = normalizePath(href);
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}
const islandLinkClass = PUBLIC_NAV_ISLAND_LINK_CLASS;
function IslandNavLink({
  link,
  pathname,
}: {
  readonly link: PublicNavLinkItem;
  readonly pathname: string;
}) {
  if (!link.href) return null;
  const active = !link.external && isActive(pathname, link.href);
  return (
    <PublicNavLink
      href={link.href}
      external={link.external}
      pathname={pathname}
      className={cn(
        islandLinkClass,
        active && PUBLIC_NAV_ISLAND_LINK_ACTIVE_CLASS,
      )}
    >
      {link.label}
    </PublicNavLink>
  );
}
function MobileNavLink({
  link,
  pathname,
  onNavigate,
}: {
  readonly link: PublicNavLinkItem;
  readonly pathname: string;
  readonly onNavigate: () => void;
}) {
  if (!link.href) return null;
  const active = !link.external && isActive(pathname, link.href);
  return (
    <PublicNavLink
      href={link.href}
      external={link.external}
      pathname={pathname}
      className={cn(
        "ar-public-mobile-nav-link",
        active && "ar-public-mobile-nav-link--active",
      )}
      onClick={onNavigate}
    >
      {link.label}
    </PublicNavLink>
  );
}
type Props = {
  /** Pass from a Server Component so SSR and hydration use identical links. */
  readonly links: readonly PublicNavItem[];
};
export function PublicSiteNav({ links }: Props) {
  const pathname = usePathname() ?? "";
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const primaryLinks = filterPublicNavIslandLinks(links).filter(
    (item): item is PublicNavLinkItem => !isPublicNavDropdown(item),
  );
  return (
    <header className="ar-public-nav ar-public-nav--ghost sticky top-0 z-50 h-[53px] flex items-center border-b border-transparent">
      <div className="relative flex items-center w-full h-full max-w-full px-4 sm:px-6">
        {/* Logo — always left */}
        <PublicNavLink href={getPublicSiteUrl()} className={PUBLIC_NAV_LOGO_LINK_CLASS}>
          <AgentRankingWordmark
            size="nav"
            priority
            textClassName="hidden sm:inline"
          />
        </PublicNavLink>
        {/* Desktop: centered island nav */}
        <nav
          className={PUBLIC_NAV_ISLAND_NAV_CLASS}
          style={PUBLIC_NAV_ISLAND_NAV_STYLE}
          aria-label="Primary"
        >
          {primaryLinks.map((item) => (
            <IslandNavLink key={item.label} link={item} pathname={pathname} />
          ))}
        </nav>
        {/* Right actions */}
        <div className="ml-auto flex items-center gap-2">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger className="ar-public-mobile-menu-trigger sm:hidden" aria-label="Open menu">
              <Menu className="h-[22px] w-[22px]" strokeWidth={1.75} />
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-[min(90vw,360px)] border-[var(--ar-border)] bg-[#111214] p-0 sm:max-w-[360px]"
              showCloseButton={false}
            >
              <div className="flex items-center justify-between border-b border-[var(--ar-border)] px-5 py-4">
                <SheetTitle className="text-base font-semibold text-[var(--ar-text-primary)]">AgentRanking</SheetTitle>
                <SheetClose className="ar-public-mobile-nav-close" aria-label="Close menu">
                  <X className="h-5 w-5" />
                </SheetClose>
              </div>
              <nav className="flex flex-col gap-1 p-4">
                {primaryLinks.map((item) => (
                  <MobileNavLink key={item.label} link={item} pathname={pathname} onNavigate={closeMobile} />
                ))}
              </nav>
              <div className="border-t border-[var(--ar-border)] p-4 pt-3">
                <p className="ar-public-label mb-2 px-0.5">{PUBLIC_NAV_LAUNCH_CTA_LABEL}</p>
                <div className="flex flex-col gap-2">
                  <PublicNavLaunchMenuItems
                    onNavigate={closeMobile}
                    itemClassName={cn(
                      PUBLIC_NAV_LAUNCH_CTA_MOBILE_CLASS,
                      "inline-flex items-center justify-start gap-2.5 px-3 text-left",
                    )}
                  />
                </div>
              </div>
            </SheetContent>
          </Sheet>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                PUBLIC_NAV_LAUNCH_CTA_CLASS,
                "inline-flex items-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-[rgba(89,156,231,0.4)]",
              )}
              aria-label="Launch options"
            >
              {PUBLIC_NAV_LAUNCH_CTA_LABEL}
              <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="ar-public-nav-dropdown min-w-[15rem]">
              <DropdownMenuItem asChild className="ar-public-nav-dropdown-item">
                <PublicNavLink
                  href={publicSiteRoutes.launchApp}
                  className={launchMenuItemClass}
                >
                  <LayoutDashboard className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium leading-none">App</span>
                    <span className="text-muted-foreground mt-1 block text-[11px] leading-none">
                      Creator dashboard on app.agentranking.io
                    </span>
                  </span>
                </PublicNavLink>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="ar-public-nav-dropdown-item">
                <PublicNavLink
                  href={publicSiteRoutes.launchToken}
                  className={launchMenuItemClass}
                >
                  <Rocket className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium leading-none">Quick launch</span>
                    <span className="text-muted-foreground mt-1 block text-[11px] leading-none">
                      Wallet-only token or agent on agentranking.io
                    </span>
                  </span>
                </PublicNavLink>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
