"use client";
/**
 * Silently bridges the existing AgentRanking NextAuth session into Privy
 * using Privy's `useSubscribeToJwtAuthWithFlag` hook.
 *
 * When the user is signed in via Google (NextAuth), this component:
 *  1. Fetches a short-lived JWT from /api/auth/privy-token
 *  2. Passes it to Privy via useSubscribeToJwtAuthWithFlag
 *  3. Privy validates the JWT against our JWKS endpoint
 *  4. The user is silently authenticated in Privy — no login UI appears
 *  5. Downstream hooks (useWallets, useCreateWallet) work because
 *     the Privy user is authenticated
 *
 * Does NOT call Privy's login().  Does NOT show any modal or OTP prompt.
 */
import { useSession } from "next-auth/react";
import { useCallback, useMemo } from "react";
import { useSubscribeToJwtAuthWithFlag } from "@privy-io/react-auth";
/** One JWT fetch is in-flight at a time (module-level deduplication). */
let _inFlightPromise: Promise<string | undefined> | null = null;
async function fetchPrivyJwt(): Promise<string | undefined> {
  if (_inFlightPromise) return _inFlightPromise;
  _inFlightPromise = (async () => {
    try {
      const res = await fetch("/api/auth/privy-token");
      if (!res.ok) return undefined;
      const data = (await res.json()) as { token?: string };
      return data.token;
    } catch {
      return undefined;
    } finally {
      _inFlightPromise = null;
    }
  })();
  return _inFlightPromise;
}
export function PrivyAuthBridge({ children }: { readonly children?: React.ReactNode }) {
  const { status, data: session } = useSession();
  const isAuthenticated = status === "authenticated" && !!session?.user;
  // Fetch JWT token only when the NextAuth session is authenticated.
  // getExternalJwt is called by Privy when it needs a fresh token;
  // the hook internally manages caching and refresh timing.
  const getExternalJwt = useCallback(
    () => (isAuthenticated ? fetchPrivyJwt() : Promise.resolve(undefined)),
    [isAuthenticated],
  );
  const isAuthenticatedMemo = useMemo(() => isAuthenticated, [isAuthenticated]);
  const isLoadingMemo = useMemo(() => status === "loading", [status]);
  // The hook subscribes to auth state changes — when isAuthenticated flips
  // to true (user signed in), Privy automatically syncs by calling getExternalJwt.
  // When it flips to false (user signed out), Privy signs out too.
  useSubscribeToJwtAuthWithFlag({
    isAuthenticated: isAuthenticatedMemo,
    isLoading: isLoadingMemo,
    getExternalJwt,
    enabled: true,
  });
  // Don't block rendering — children render even while the bridge syncs
  return <>{children}</>;
}
