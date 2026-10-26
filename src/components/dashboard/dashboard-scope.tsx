"use client";

import { useEffect } from "react";

const HTML_CLASS = "agentranking-app";

/** Applies dashboard document styling without owning product providers. */
export function DashboardScope({ children }: { readonly children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add(HTML_CLASS, "dark");
    document.documentElement.style.colorScheme = "dark";
    return () => {
      document.documentElement.classList.remove(HTML_CLASS, "dark");
      document.documentElement.style.colorScheme = "";
    };
  }, []);

  return children;
}
