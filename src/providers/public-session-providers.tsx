"use client";

import { SessionProvider } from "@/providers/session-provider";

/** NextAuth session scope for public profile/follow interactions. */
export function PublicSessionProviders({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return <SessionProvider>{children}</SessionProvider>;
}
