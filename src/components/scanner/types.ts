import type { ReactNode } from "react";
import type { AgentListBadgeId } from "@/lib/agent-list-status-badges";
import type { HomeTrustLabel } from "@/lib/home-discovery-display";
import type { RiskTier } from "@/lib/verification/providers/types";
export type ScannerSortColumn =
  | "name"
  | "chain"
  | "protocol"
  | "reviews"
  | "ar"
  | "trust"
  | "age";
export type ScannerViewMode = "full" | "latest";
export type ScannerTabId =
  | "all"
  | "latest"
  | "verified"
  | "metaplex"
  | "sap"
  | "xpay"
  | "mcp"
  | "trending";
export type ScannerTabDef = {
  id: ScannerTabId;
  label: string;
  icon?: ReactNode;
  live?: boolean;
};
export type ScannerAgentRow = {
  id: number;
  href: string;
  name: string;
  image?: string;
  isPremiumVerified: boolean;
  isVerified: boolean;
  chainId: number;
  chain: { shortName: string; color: string; icon: string };
  deploymentCount?: number;
  chainLogoStack?: Array<{
    chainId: number;
    icon: string;
    chainShortName: string;
    chainName: string;
  }>;
  protocolLabel: string;
  rankLabel: string;
  rankTitle: string;
  rankCompact: boolean;
  ar: number;
  arEmpty: boolean;
  trustLabel: HomeTrustLabel;
  reputation: number;
  reviews: number;
  age?: string | Date;
  lastSeen?: string | Date;
  statusBadgeIds: AgentListBadgeId[];
  statusLabels: string[];
  metaLine: string;
  /** Optional KYA passport tier — when present, Verified Agent badge renders. */
  kyaRiskTier?: RiskTier;
  kyaRiskScore?: number;
  kyaPassportId?: string;
};
export type ScannerSortOption = {
  value: string;
  label: string;
};