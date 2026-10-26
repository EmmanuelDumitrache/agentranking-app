"use client";

import { useHydrated } from "@/hooks/use-hydrated";

export function DashboardSkipLink() {
  const hydrated = useHydrated();

  if (!hydrated) return null;

  return (
    <a href="#dashboard-main-content" className="ui-skip-link">
      Skip to main content
    </a>
  );
}
