import type { ArHolderTier, ArHolderTierId } from "@/lib/ar-holder-perk-config";
export type DashboardFeature =
  | "referral_tools"
  | "dashboard_previews"
  | "alerts"
  | "compare"
  | "refresh_lanes"
  | "exports"
  | "mcp"
  | "perf_snapshots";
const TIER_FEATURES: Record<ArHolderTierId, readonly DashboardFeature[]> = {
  node: ["referral_tools", "dashboard_previews"],
  validator: [
    "referral_tools",
    "dashboard_previews",
    "alerts",
    "compare",
    "refresh_lanes",
  ],
  core: [
    "referral_tools",
    "dashboard_previews",
    "alerts",
    "compare",
    "refresh_lanes",
    "exports",
    "mcp",
    "perf_snapshots",
  ],
};
export function dashboardFeaturesForTierId(tierId: ArHolderTierId | null | undefined): ReadonlySet<DashboardFeature> {
  if (!tierId) return new Set();
  return new Set(TIER_FEATURES[tierId] ?? []);
}
export function dashboardFeaturesForTier(tier: ArHolderTier | null): ReadonlySet<DashboardFeature> {
  if (!tier) return new Set();
  return dashboardFeaturesForTierId(tier.id);
}
