"use client";

import { QueryProvider } from "@/providers/query-provider";

/**
 * TanStack Query scope for the interactive `/stake` subtree. Kept separate from
 * the public-site provider routing because the stake tree is served under its
 * own layout. Metadata, shell, navigation, and footer stay outside the provider.
 */
export function StakeQueryProviders({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return <QueryProvider>{children}</QueryProvider>;
}