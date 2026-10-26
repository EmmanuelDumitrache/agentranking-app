/**
 * Status chips for agent list tables (trust vs paid placement).
 */
import { hasVisiblePower } from "@/lib/agent-utils";
import { METAPLEX_TOKEN_LINKED_LABEL } from "@/lib/metaplex/config";
import { isMetaplexAgent, isMetaplexPrimaryListing } from "@/lib/metaplex/detect";
export type AgentListBadgeId =
  | "verified"
  | "chainVerified"
  | "identityRegistered"
  | "claimed"
  | "unverified"
  | "duplicate"
  | "sap"
  | "metaplex"
  | "metaplexRegistered"
  | "metaplexBoundToken"
  | "x402"
  | "mcp"
  | "sponsored";
export type AgentListBadge = {
  id: AgentListBadgeId;
  label: string;
  className: string;
};
export type AgentListBadgeInput = {
  isVerified?: boolean | null;
  isPremiumVerified?: boolean | null;
  /** Validation Registry attestation on any cluster deployment (list meta). */
  clusterChainVerified?: boolean | null;
  /** ERC-8004 identity indexed on at least one EVM deployment (list meta). */
  clusterIdentityRegistered?: boolean | null;
  /** Multi-chain list rows (fallback when clusterIdentityRegistered unset). */
  deploymentCount?: number | null;
  isClaimed?: boolean | null;
  hasDuplicateName?: boolean | null;
  sapVerified?: boolean | null;
  sapTwinMatch?: boolean | null;
  listingRegistrySource?: string | null;
  metaplexVerified?: boolean | null;
  metaplexAgentTokenMint?: string | null;
  metaplexAssetAddress?: string | null;
  x402Support?: boolean | null;
  powerScore?: number | null;
  activeBoosts?: number | null;
  adminPowerAdjust?: number | null;
  hasHolderPowerBoost?: boolean | null;
  services?: Array<{ name: string; endpoint?: string | null }> | null;
  metadata?: Array<{ key: string; value?: string }> | null;
};
export type AgentListBadgeOptions = {
  /** Home discovery table: no sponsored chip (protocol column covers ERC-8004). */
  variant?: "home" | "default";
};
function hasMcpEndpoint(agent: AgentListBadgeInput): boolean {
  const svcs = agent.services ?? [];
  if (svcs.some((s) => s.name.toUpperCase() === "MCP" && s.endpoint?.trim())) return true;
  const meta = agent.metadata ?? [];
  const tools = meta.find((m) => m.key === "mcpTools")?.value;
  if (tools) {
    try {
      const arr = JSON.parse(tools);
      return Array.isArray(arr) && arr.length > 0;
    } catch {
      return false;
    }
  }
  return false;
}
/** Ordered badges for an agent row (caller may slice for display). */
export function getAgentListStatusBadges(
  agent: AgentListBadgeInput,
  options?: AgentListBadgeOptions,
): AgentListBadge[] {
  const variant = options?.variant ?? "default";
  const out: AgentListBadge[] = [];
  const verified = !!(agent.isVerified || agent.isPremiumVerified);
  const identityRegistered =
    agent.clusterIdentityRegistered ??
    (typeof agent.deploymentCount === "number" && agent.deploymentCount > 1);
  if (verified) {
    out.push({
      id: "verified",
      label: "Verified",
      className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    });
  } else if (agent.clusterChainVerified) {
    out.push({
      id: "chainVerified",
      label: "Validator attested",
      className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/35",
    });
  } else if (
    identityRegistered &&
    !isMetaplexPrimaryListing({
      listingRegistrySource: agent.listingRegistrySource,
      metaplexAssetAddress: agent.metaplexAssetAddress,
      metaplexVerified: agent.metaplexVerified,
    })
  ) {
    out.push({
      id: "identityRegistered",
      label: "Identity registered",
      className: "bg-cyan-500/15 text-cyan-300 border-cyan-500/35",
    });
  } else if (agent.isClaimed) {
    out.push({
      id: "claimed",
      label: "Claimed",
      className: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    });
  } else {
    out.push({
      id: "unverified",
      label: "Unverified",
      className: "bg-muted/40 text-muted-foreground border-border",
    });
  }
  if (agent.x402Support) {
    out.push({
      id: "x402",
      label: "x402",
      className: "bg-green-500/15 text-green-400 border-green-500/30",
    });
  }
  if (
    isMetaplexAgent({
      listingRegistrySource: agent.listingRegistrySource,
      metaplexAssetAddress: agent.metaplexAssetAddress,
      metaplexVerified: agent.metaplexVerified,
    })
  ) {
    out.push({
      id: "metaplex",
      label: "Metaplex",
      className: "bg-violet-500/15 text-violet-300 border-violet-500/35",
    });
    if (agent.metaplexAgentTokenMint?.trim()) {
      out.push({
        id: "metaplexBoundToken",
        label: METAPLEX_TOKEN_LINKED_LABEL,
        className: "bg-amber-500/15 text-amber-300 border-amber-500/35",
      });
    }
  }
  if (hasMcpEndpoint(agent)) {
    out.push({
      id: "mcp",
      label: "MCP",
      className: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    });
  }
  if (variant !== "home" && hasVisiblePower(agent)) {
    out.push({
      id: "sponsored",
      label: "Sponsored",
      className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    });
  }
  return out;
}