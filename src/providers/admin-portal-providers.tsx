"use client";

import { QueryProvider } from "@/providers/query-provider";

/** Providers retained by the admin portal while its existing queries are seeded incrementally. */
export function AdminPortalProviders({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return <QueryProvider>{children}</QueryProvider>;
}
