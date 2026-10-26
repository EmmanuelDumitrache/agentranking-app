"use client";

import { usePathname } from "next/navigation";

export function DashboardNavigationProgress() {
  const pathname = usePathname() ?? "";

  return (
    <div
      className="ui-nav-progress ui-nav-progress--active pointer-events-none absolute inset-x-0 top-0 z-50 h-px overflow-hidden"
      aria-hidden
    >
      <span key={pathname} className="ui-nav-progress-bar" />
    </div>
  );
}
