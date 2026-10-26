"use client";
import { useCallback, useState } from "react";
import { ArrowUpRight, BadgeCheck, BookOpen, ChevronDown, Menu, X } from "lucide-react";
import { AgentRankingWordmark } from "@/components/layout/agent-ranking-wordmark";
import { PublicNavLink } from "@/components/public-site/public-nav-link";
import {
  filterPublicNavIslandLinks,
  PUBLIC_NAV_ISLAND_LINK_CLASS,
  PUBLIC_NAV_LAUNCH_CTA_CLASS,
  PUBLIC_NAV_LAUNCH_CTA_LABEL,
  PUBLIC_NAV_LAUNCH_CTA_MOBILE_CLASS,
} from "@/components/public-site/public-nav-island";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  isPublicNavDropdown,
  type PublicNavItem,
  type PublicNavLink as PublicNavLinkItem,
} from "@/lib/site-config";
import { publicSiteRoutes } from "@/lib/public-site/routes";
import { cn } from "@/lib/utils";
type DocsSiteHeaderProps = {
  readonly homeHref: string;
  readonly verifyHref: string;
  readonly stakeHref?: string;
  readonly links: readonly PublicNavItem[];
  readonly onOpenDocsMenu?: () => void;
};
function VerifyLabel() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Verify
    </span>
  );
}
function scrollToSection(hash: string) {
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;
  const reduce = globalThis.window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  const { pathname, search } = globalThis.window.location;
  globalThis.window.history.replaceState(null, "", `${pathname}${search}#${id}`);
}
function MobileNavLink({
  link,
  onNavigate,
}: {
  readonly link: PublicNavLinkItem;
  readonly onNavigate: () => void;
}) {
  if (!link.href) return null;
  const isHash = link.href.startsWith("#");
  return (
    <PublicNavLink
      href={link.href}
      external={link.external}
      className="ar-public-mobile-nav-link group"
      onClick={(e) => {
        if (isHash) {
          e.preventDefault();
          onNavigate();
          requestAnimationFrame(() => scrollToSection(link.href));
          return;
        }
        onNavigate();
      }}
    >
      <span>{link.label}</span>
      {link.external ? (
        <ArrowUpRight
          className="ml-auto h-3.5 w-3.5 text-[var(--ar-text-muted)] opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      ) : null}
    </PublicNavLink>
  );
}
export function DocsSiteHeader({
  homeHref,
  verifyHref,
  stakeHref,
  links,
  onOpenDocsMenu,
}: DocsSiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const islandLinks = filterPublicNavIslandLinks(links);
  const islandLinkClass = PUBLIC_NAV_ISLAND_LINK_CLASS;
  const renderDesktopLink = (link: PublicNavLinkItem) => {
    if (!link.href || link.disabled) return null;
    const isHash = link.href.startsWith("#");
    return (
      <PublicNavLink
        key={`${link.href}-${link.label}`}
        href={link.href}
        external={link.external}
        className={islandLinkClass}
        onClick={
          isHash
            ? (e) => {
                e.preventDefault();
                scrollToSection(link.href);
              }
            : undefined
        }
      >
        {link.label}
      </PublicNavLink>
    );
  };
  const renderDesktopNavItem = (item: PublicNavItem) => {
    if (isPublicNavDropdown(item)) {
      return (
        <DropdownMenu key={item.label}>
          <DropdownMenuTrigger
            className={cn(
              islandLinkClass,
              "inline-flex items-center gap-0.5 outline-none focus-visible:ring-2 focus-visible:ring-[rgba(89,156,231,0.4)]",
            )}
          >
            {item.label}
            <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="ar-public-nav-dropdown min-w-[9.5rem]">
            {item.items.map((sub) =>
              sub.disabled ? (
                <DropdownMenuItem
                  key={sub.label}
                  disabled
                  className="ar-public-nav-dropdown-item ar-public-nav-dropdown-item--disabled"
                >
                  {sub.label}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem key={sub.label} asChild className="ar-public-nav-dropdown-item">
                  <PublicNavLink href={sub.href} external={sub.external} className="w-full cursor-pointer">
                    {sub.label}
                  </PublicNavLink>
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
    return renderDesktopLink(item);
  };
  const renderMobileNavItem = (item: PublicNavItem) => {
    if (isPublicNavDropdown(item)) {
      return (
        <div key={item.label} className="mb-1">
          <p className="ar-public-label px-3 py-1.5">{item.label}</p>
          {item.items.map((sub) =>
            sub.disabled ? (
              <span
                key={sub.label}
                className="ar-public-mobile-nav-link ar-public-mobile-nav-link--disabled"
                aria-disabled
              >
                {sub.label}
              </span>
            ) : (
              <MobileNavLink key={sub.label} link={sub} onNavigate={closeMenu} />
            ),
          )}
        </div>
      );
    }
    return <MobileNavLink key={`${item.href}-${item.label}`} link={item} onNavigate={closeMenu} />;
  };
  return (
    <header className="docs-site-header-bar ar-public-nav ar-public-nav--ghost">
      <div className="docs-site-header-inner">
        <PublicNavLink href={homeHref} className="docs-site-header-logo">
          <AgentRankingWordmark size="compact" className="text-[14px]" priority />
        </PublicNavLink>
        <nav className="docs-site-header-island" aria-label="Primary">
          {islandLinks.map((item) => renderDesktopNavItem(item))}
        </nav>
        <div className="docs-site-header-actions">
          {onOpenDocsMenu ? (
            <button
              type="button"
              className="docs-header-docs-menu"
              onClick={onOpenDocsMenu}
              aria-label="Open documentation menu"
            >
              <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
              <span>Docs</span>
            </button>
          ) : null}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger className="docs-header-site-menu" aria-label="Open site menu">
              <Menu className="h-[18px] w-[18px]" strokeWidth={2} />
            </SheetTrigger>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="ar-public-mobile-nav ar-public-mobile-nav--left flex w-[min(88vw,320px)] flex-col gap-0 overflow-hidden border-[var(--ar-border)] bg-[#111214] p-0 sm:max-w-[320px]"
            >
              <div className="ar-public-mobile-nav-header">
                <SheetTitle className="sr-only">AgentRanking menu</SheetTitle>
                <PublicNavLink href={homeHref} onClick={closeMenu}>
                  <AgentRankingWordmark className="text-[13px]" />
                </PublicNavLink>
                <SheetClose className="ar-public-mobile-nav-close" aria-label="Close menu">
                  <X className="h-4 w-4" />
                </SheetClose>
              </div>
              <nav className="ar-public-mobile-nav-scroll min-h-0 flex-1" aria-label="Mobile">
                <p className="ar-public-label mb-1 px-3">Navigate</p>
                <div className="flex flex-col gap-0.5 px-2">
                  {islandLinks.map((item) => renderMobileNavItem(item))}
                </div>
              </nav>
              <div className="ar-public-mobile-nav-footer shrink-0">
                <p className="ar-public-label mb-2">Get started</p>
                <div className="flex flex-col gap-2">
                  <PublicNavLink
                    href={verifyHref}
                    className="ar-public-btn w-full justify-center"
                    onClick={closeMenu}
                  >
                    <VerifyLabel />
                  </PublicNavLink>
                  {stakeHref ? (
                    <PublicNavLink
                      href={stakeHref}
                      external
                      className="ar-public-btn w-full justify-center"
                      onClick={closeMenu}
                    >
                      Stake
                    </PublicNavLink>
                  ) : null}
                  <PublicNavLink
                    href={publicSiteRoutes.launchAgent}
                    external
                    className={PUBLIC_NAV_LAUNCH_CTA_MOBILE_CLASS}
                    onClick={closeMenu}
                  >
                    {PUBLIC_NAV_LAUNCH_CTA_LABEL}
                  </PublicNavLink>
                </div>
              </div>
            </SheetContent>
          </Sheet>
          <PublicNavLink
            href={publicSiteRoutes.launchAgent}
            external
            className={cn(PUBLIC_NAV_LAUNCH_CTA_CLASS, "max-lg:!hidden")}
          >
            {PUBLIC_NAV_LAUNCH_CTA_LABEL}
          </PublicNavLink>
        </div>
      </div>
    </header>
  );
}
