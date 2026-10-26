"use client";
import { useEffect } from "react";
const HTML_CLASS = "ar-public";
/** Activates the shared public-site design tokens while the staking site is mounted. */
export function StakeSiteScope({ children }: { readonly children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add(HTML_CLASS);
    return () => {
      document.documentElement.classList.remove(HTML_CLASS);
    };
  }, []);
  return <>{children}</>;
}
