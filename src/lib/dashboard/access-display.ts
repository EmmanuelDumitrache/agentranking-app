import type { ArHolderTier } from "@/lib/ar-holder-perk-config";
import { getHolderTierDisplayName } from "@/lib/ar-holder-perk-config";
export type DashboardAccessSource = "pro" | "sap" | "stake" | "none";
export function dashboardAccessPlanLabel(input: {
  dashboardAccessSource: DashboardAccessSource;
  dashboardTier: ArHolderTier | null;
  subscriptionPlan?: string | null;
  dashboardUnlocked?: boolean;
}): string {
  const { dashboardAccessSource, dashboardTier, subscriptionPlan, dashboardUnlocked } = input;
  if (dashboardAccessSource === "pro") return "Pro · Premium";
  if (dashboardAccessSource === "sap") return "SAP Operator · Premium";
  if (dashboardAccessSource === "stake" && dashboardTier) {
    const name = getHolderTierDisplayName(dashboardTier);
    if (dashboardTier.id === "core" || dashboardTier.id === "validator") {
      return `${name} Staker · Premium`;
    }
    return `${name} Staker`;
  }
  if (dashboardUnlocked) return "Dashboard Access";
  if (subscriptionPlan?.trim()) return subscriptionPlan.trim();
  return "Free Plan";
}
export function dashboardHasPremiumAccess(dashboardAccessSource: DashboardAccessSource, dashboardTier: ArHolderTier | null): boolean {
  if (dashboardAccessSource === "pro" || dashboardAccessSource === "sap") return true;
  if (dashboardAccessSource === "stake" && dashboardTier && (dashboardTier.id === "validator" || dashboardTier.id === "core")) {
    return true;
  }
  return false;
}
