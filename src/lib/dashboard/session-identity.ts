import type { Session } from "next-auth";
/** True when the session can access dashboard APIs (OAuth/credentials email or wallet SIWE). */
export function hasDashboardSessionIdentity(session: Session | null | undefined): boolean {
  return Boolean(session?.user?.email?.trim() || session?.user?.walletAddress?.trim());
}
