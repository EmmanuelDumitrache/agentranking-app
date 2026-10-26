/**
 * FAST_LOCAL development profile — local laptop only.
 * Enable explicitly with `FAST_LOCAL=1` for diagnostics. Never set it on production/VPS.
 */
let warnedFastLocalOnProduction = false;
function readFastLocalEnv(): boolean {
  return (
    process.env.FAST_LOCAL === "1" ||
    process.env.NEXT_PUBLIC_FAST_LOCAL === "1"
  );
}
/** True when FAST_LOCAL=1 and not production (safe for all fast-path gates). */
export function isFastLocal(): boolean {
  if (process.env.NODE_ENV === "production") {
    if (readFastLocalEnv() && !warnedFastLocalOnProduction) {
      warnedFastLocalOnProduction = true;
      console.warn(
        "[fast-local] FAST_LOCAL=1 is ignored when NODE_ENV=production. Remove FAST_LOCAL from deployed env.",
      );
    }
    return false;
  }
  return readFastLocalEnv();
}
export function skipExternalEnrichment(): boolean {
  return isFastLocal() || process.env.AGENT_DETAIL_SKIP_EXPLORER === "1";
}
export function skipLiveOrganicRank(): boolean {
  return isFastLocal();
}
/** Off in dev — ISR `unstable_cache` background revalidation errors caused refresh loops on agent pages. */
export function allowAgentDetailCacheInDev(): boolean {
  return false;
}
export function limitFeedbackCount(defaultCount: number): number {
  return isFastLocal() ? 10 : defaultCount;
}
export function limitRankSnapshots(defaultCount: number): number {
  return isFastLocal() ? 14 : defaultCount;
}
export function slugResolveMaxAgents(defaultMax: number): number {
  return isFastLocal() ? 2_000 : defaultMax;
}
export function skipOobeExplorerCalls(): boolean {
  return isFastLocal();
}
/** Skip on-demand Validation Registry eth_getLogs during dev (DB rows only). */
export function skipChainVerificationRpc(): boolean {
  return isFastLocal();
}
/** Allow dev-skip auth on a beta deployment when BETA_DEV_LOGIN_ENABLED=true.
 *  Only the beta PM2 process should have this env set — never production. */
export function isBetaDevLoginEnabled(): boolean {
  return process.env.BETA_DEV_LOGIN_ENABLED === "true";
}