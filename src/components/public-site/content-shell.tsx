import type { ReactNode } from "react";
import { PublicSiteHashScroll } from "@/components/public-site/public-site-hash-scroll";
/**
 * Public content wrapper. Global navigation, background, live chrome, and footer
 * are supplied by the `(public-site)` route-group layout.
 */
export function PublicSiteContentShell({ children }: { readonly children: ReactNode }) {
  return (
    <>
      <PublicSiteHashScroll />
      {children}
    </>
  );
}
