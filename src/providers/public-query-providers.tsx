"use client";

import { QueryProvider } from "@/providers/query-provider";

/** TanStack Query scope for public routes that render query-backed islands. */
export function PublicQueryProviders({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return <QueryProvider>{children}</QueryProvider>;
}
