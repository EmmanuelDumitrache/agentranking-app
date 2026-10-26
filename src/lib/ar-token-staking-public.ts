import { isLocalAppDevHost } from "@/lib/product-host";
/** Operator SDK pool setup — also enabled for local development. */
export function isArStakingSetupToolsEnabled(host?: string | null): boolean {
  if (process.env.NEXT_PUBLIC_AR_STAKING_SETUP_TOOLS === "true") return true;
  if (process.env.NODE_ENV === "development") return true;
  if (host && isLocalAppDevHost(host)) return true;
  return false;
}