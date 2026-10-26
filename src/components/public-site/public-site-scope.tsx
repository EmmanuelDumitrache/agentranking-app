"use client";

import { useEffect } from "react";

const HTML_CLASS = "public-site";
const AR_PUBLIC_CLASS = "ar-public";

/** Applies public-site scoped tokens for the lifetime of the route-group layout. */
export function PublicSiteScope({ children }: { readonly children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add(HTML_CLASS, AR_PUBLIC_CLASS, "dark");
    document.documentElement.style.colorScheme = "dark";
    return () => {
      document.documentElement.classList.remove(HTML_CLASS, AR_PUBLIC_CLASS);
    };
  }, []);

  return <>{children}</>;
}
