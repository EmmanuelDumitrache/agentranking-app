"use client";
import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
export function SessionProvider({
  children,
  _disabled,
}: {
  readonly children: React.ReactNode;
  readonly _disabled?: boolean;
}) {
  // Always same-origin `/api/auth/*` — never follow NEXTAUTH_URL absolute
  // provider URLs from apex → app (that redirect breaks CORS on marketing pages).
  return (
    <NextAuthSessionProvider
      basePath="/api/auth"
      refetchOnWindowFocus={false}
      refetchInterval={0}
    >
      {children}
    </NextAuthSessionProvider>
  );
}