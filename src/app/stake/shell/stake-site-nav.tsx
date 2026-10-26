"use client";
import { useCallback, useState } from "react";
import { ArrowUpRight, BadgeCheck, ChevronDown, Menu, X } from "lucide-react";
import { AgentRankingWordmark } from "@/components/layout/agent-ranking-wordmark";
import { StakeSiteLink } from "@/app/stake/shell/stake-site-link";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  isPublicNavDropdown as isStakeSiteNavDropdown,
  type PublicNavItem as StakeSiteNavItem,
  type PublicNavLink as StakeSiteLinkItem,
} from "@/lib/site-config";
import { cn } from "@/lib/utils";
export type StakeSiteNavProps = {
  readonly homeHref: string;
  readonly appHref: string;
  readonly verifyHref: string;
  readonly links: readonly StakeSiteNavItem[];
  readonly connectWalletHref?: string;
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
  readonly link: StakeSiteLinkItem;
  readonly onNavigate: () => void;
}) {
  if (!link.href) return null;
  const isHash = link.href.startsWith("#");
  return (
    <StakeSiteLink
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
    </StakeSiteLink>
  );
}
export function StakeSiteNav({
  homeHref,
  appHref,
  verifyHref,
  links,
  connectWalletHref = "#stake",
}: StakeSiteNavProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const navLinkClass =
    "relative rounded-md px-2.5 py-1.5 text-[12px] text-[var(--ar-text-tertiary)] transition-colors hover:bg-[var(--ar-glass-fill-hover)] hover:text-[var(--ar-text-primary)]";
  const renderDesktopLink = (link: StakeSiteLinkItem) => {
    if (!link.href || link.disabled) return null;
    const isActiveStake = link.label === "Stake";
    const isHash = link.href.startsWith("#");
    const className = cn(navLinkClass, isActiveStake && "text-[var(--ar-text-primary)]");
    return (
      <StakeSiteLink
        key={`${link.href}-${link.label}`}
        href={link.href}
        external={link.external}
        className={className}
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
      </StakeSiteLink>
    );
  };
  const renderDesktopNavItem = (item: StakeSiteNavItem) => {
    if (isStakeSiteNavDropdown(item)) {
      return (
        <DropdownMenu key={item.label}>
          <DropdownMenuTrigger
            className={cn(
              navLinkClass,
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
                  <StakeSiteLink href={sub.href} external={sub.external} className="w-full cursor-pointer">
                    {sub.label}
                  </StakeSiteLink>
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
    return renderDesktopLink(item);
  };
  const renderMobileNavItem = (item: StakeSiteNavItem) => {
    if (isStakeSiteNavDropdown(item)) {
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
    <header
      className="sticky top-0 z-50 border-0 bg-transparent"
      style={{ height: "var(--ar-public-nav-height)" }}
    >
      <div className="ar-public-container relative flex h-full items-center justify-between gap-2 sm:gap-3">
        <StakeSiteLink href={homeHref} className="relative z-10 shrink-0">
          <AgentRankingWordmark variant="icon" className="h-8 w-8 xl:hidden" priority />
          <AgentRankingWordmark className="hidden text-[14px] xl:inline-flex" priority />
        </StakeSiteLink>
        <nav
          className="ar-public-nav-island absolute left-1/2 hidden -translate-x-1/2 xl:flex"
          aria-label="Primary"
        >
          {links.map((item) => renderDesktopNavItem(item))}
        </nav>
        <div className="relative z-10 hidden items-center justify-end gap-2 xl:flex">
          <StakeSiteLink href={verifyHref} className="ar-public-btn">
            <VerifyLabel />
          </StakeSiteLink>
          <StakeSiteLink href={appHref} className="ar-public-btn ar-public-btn-primary">
            Open App
          </StakeSiteLink>
          <a href={connectWalletHref} className="ar-public-btn">
            Connect Wallet
          </a>
        </div>
        <div className="relative z-10 ml-auto flex items-center justify-end xl:hidden">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger
              className="ar-public-btn ar-public-mobile-menu-trigger h-9 w-9 p-0"
              aria-label="Open menu"
            >
              <Menu className="h-[18px] w-[18px]" strokeWidth={2} />
            </SheetTrigger>
            <SheetContent
              side="right"
              showCloseButton={false}
              className="ar-public-mobile-nav flex w-[min(88vw,320px)] flex-col gap-0 overflow-hidden border-[var(--ar-border)] bg-[#111214] p-0 sm:max-w-[320px]"
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100dvh",
                maxHeight: "100dvh",
                overflow: "hidden",
              }}
            >
              <div className="ar-public-mobile-nav-header">
                <StakeSiteLink href={homeHref} onClick={closeMenu}>
                  <AgentRankingWordmark className="text-[13px]" />
                </StakeSiteLink>
                <SheetClose className="ar-public-mobile-nav-close" aria-label="Close menu">
                  <X className="h-4 w-4" />
                </SheetClose>
              </div>
              <nav
                className="ar-public-mobile-nav-scroll min-h-0 flex-1"
                aria-label="Mobile"
                style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch" }}
              >
                <p className="ar-public-label mb-1 px-3">Navigate</p>
                <div className="flex flex-col gap-0.5 px-2">
                  {links.map((item) => renderMobileNavItem(item))}
                </div>
              </nav>
              <div className="ar-public-mobile-nav-footer shrink-0" style={{ flexShrink: 0 }}>
                <p className="ar-public-label mb-2">Get started</p>
                <div className="flex flex-col gap-2">
                  <StakeSiteLink
                    href={verifyHref}
                    className="ar-public-btn w-full justify-center"
                    onClick={closeMenu}
                  >
                    <VerifyLabel />
                  </StakeSiteLink>
                  <StakeSiteLink
                    href={appHref}
                    className="ar-public-btn ar-public-btn-primary w-full justify-center"
                    onClick={closeMenu}
                  >
                    Open App
                  </StakeSiteLink>
                  <a
                    href={connectWalletHref}
                    className="ar-public-btn w-full justify-center text-center"
                    onClick={closeMenu}
                  >
                    Connect Wallet
                  </a>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
