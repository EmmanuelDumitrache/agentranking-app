import type { CSSProperties } from "react";
import {
  isPublicNavDropdown,
  type PublicNavItem,
} from "@/lib/site-config";
/** Island nav link — squared like FilterIsland chips (`rounded-md`). */
export const PUBLIC_NAV_ISLAND_LINK_CLASS =
  "relative rounded-md px-3.5 py-1.5 text-[13px] font-medium tracking-tight text-[var(--ar-text-tertiary)] transition-colors hover:text-[var(--ar-text-primary)]";
export const PUBLIC_NAV_ISLAND_LINK_ACTIVE_CLASS =
  "bg-foreground text-background shadow-sm hover:text-background";
/** Same shell radius/height as Launch CTA (`rounded-lg`, 43px). */
export const PUBLIC_NAV_ISLAND_NAV_CLASS =
  "absolute left-1/2 top-1/2 z-[5] box-border flex h-[43px] -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-lg border px-1.5 py-1 backdrop-blur-[12px] hidden sm:flex";
export const PUBLIC_NAV_ISLAND_NAV_STYLE: CSSProperties = {
  borderColor: "var(--app-border)",
  background: "linear-gradient(180deg, var(--app-panel-raised) 0%, var(--app-panel) 100%)",
  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.035), 0 4px 16px rgba(0, 0, 0, 0.14)",
};
export const PUBLIC_NAV_LAUNCH_CTA_LABEL = "+ Launch";
/** Match FilterIsland radius — do not use pill (`rounded-full`). */
export const PUBLIC_NAV_LAUNCH_CTA_CLASS =
  "ar-public-nav-launch-cta !rounded-lg max-sm:!hidden whitespace-nowrap";
export const PUBLIC_NAV_LAUNCH_CTA_MOBILE_CLASS =
  "ar-public-nav-launch-cta !rounded-lg w-full justify-center py-2.5";
/** Nav items rendered as a separate header CTA, not inside the island. */
export const PUBLIC_NAV_HEADER_CTA_LABELS = new Set(["Launch Agent", "+ Launch Agent"]);
/** Island nav items — excludes header CTAs (Launch Agent is rendered separately). */
export function filterPublicNavIslandLinks(links: readonly PublicNavItem[]): PublicNavItem[] {
  return links.filter((item) => {
    if (isPublicNavDropdown(item)) return true;
    return !PUBLIC_NAV_HEADER_CTA_LABELS.has(item.label);
  });
}
/** Align logo row with island / launch CTA (43px shell). */
export const PUBLIC_NAV_LOGO_LINK_CLASS = "inline-flex min-h-[43px] shrink-0 items-center";
