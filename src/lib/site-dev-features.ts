/**
 * Central gate for local-only product shortcuts such as remote verification imports
 * and development lookup fallbacks. Production stays off even if another flag is set.
 *
 * Set `SITE_DEV_FEATURES=false` (or `0`) to hard-disable these shortcuts locally.
 */
export function siteDevFeaturesExplicitlyDisabled(): boolean {
  const value = process.env.SITE_DEV_FEATURES?.trim().toLowerCase();
  return value === "false" || value === "0";
}
export function siteDevFeaturesEnabled(): boolean {
  return process.env.NODE_ENV === "development" && !siteDevFeaturesExplicitlyDisabled();
}
