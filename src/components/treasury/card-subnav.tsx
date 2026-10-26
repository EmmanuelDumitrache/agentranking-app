"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const CARD_LINKS = [
  { href: "/dashboard/card", label: "Overview", exact: true },
  { href: "/dashboard/card/manage", label: "Manage" },
  { href: "/dashboard/card/agents", label: "Agents" },
  { href: "/dashboard/card/transactions", label: "Transactions" },
  { href: "/dashboard/card/settings", label: "Policies" },
] as const;

type IndicatorState = {
  left: number;
  width: number;
  ready: boolean;
};

export function CardSubnav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const linkRefs = useRef(new Map<string, HTMLAnchorElement>());
  const [indicator, setIndicator] = useState<IndicatorState>({
    left: 0,
    width: 0,
    ready: false,
  });

  const activeHref =
    CARD_LINKS.find(({ href, ...rest }) => {
      const exact = "exact" in rest && rest.exact;
      return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
    })?.href ?? CARD_LINKS[0].href;

  const syncIndicator = useCallback(() => {
    const nav = navRef.current;
    const activeLink = linkRefs.current.get(activeHref);
    if (!nav || !activeLink) return;

    const navRect = nav.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    setIndicator({
      left: linkRect.left - navRect.left + nav.scrollLeft,
      width: linkRect.width,
      ready: true,
    });
  }, [activeHref]);

  useLayoutEffect(() => {
    syncIndicator();
  }, [syncIndicator, pathname]);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const onResize = () => syncIndicator();
    window.addEventListener("resize", onResize);
    nav.addEventListener("scroll", onResize, { passive: true });

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => syncIndicator())
        : null;
    observer?.observe(nav);
    for (const link of linkRefs.current.values()) {
      observer?.observe(link);
    }

    return () => {
      window.removeEventListener("resize", onResize);
      nav.removeEventListener("scroll", onResize);
      observer?.disconnect();
    };
  }, [syncIndicator]);

  return (
    <div className="ui-card-subnav-wrap">
      <nav ref={navRef} className="ui-card-subnav" aria-label="Card sections">
        <span
          className={cn("ui-card-subnav__indicator", indicator.ready && "is-ready")}
          style={{
            width: indicator.width,
            transform: `translateX(${indicator.left}px)`,
          }}
          aria-hidden
        />
        {CARD_LINKS.map(({ href, label }) => {
          const active = href === activeHref;
          return (
            <Link
              key={href}
              ref={(node) => {
                if (node) linkRefs.current.set(href, node);
                else linkRefs.current.delete(href);
              }}
              href={href}
              className={cn("ui-card-subnav__link", active && "ui-card-subnav__link--active")}
              aria-current={active ? "page" : undefined}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
