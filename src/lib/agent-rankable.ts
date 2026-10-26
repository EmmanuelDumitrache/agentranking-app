/**
 * Minimum identity + trust band helpers for organic ranking display.
 */
import { displayOrganicRank } from "@/lib/utils";
export type ProtocolTrustBand = "High" | "Medium" | "Low";
export type AgentRankableInput = {
  name?: string | null;
  chainId?: number | null;
  agentId?: number | null;
  description?: string | null;
  image?: string | null;
  metadata?: Array<{ key?: string; value?: string }> | null;
  services?: Array<{ name?: string; endpoint?: string | null }> | null;
};
/** Minimum data to assign AR Score and global rank (signals boost score, not eligibility). */
export function isAgentRankable(row: AgentRankableInput): boolean {
  const name = (row.name ?? "").trim();
  if (!name) return false;
  const chainId = row.chainId;
  const agentId = row.agentId;
  if (chainId == null || !Number.isFinite(chainId) || chainId <= 0) return false;
  if (agentId == null || !Number.isFinite(agentId) || agentId === 88888) return false;
  const hasDescription = (row.description ?? "").trim().length > 0;
  const hasImage = (row.image ?? "").trim().length > 0;
  const hasMetadata = (row.metadata ?? []).some(
    (m) => (m.key ?? "").trim() || (m.value ?? "").trim(),
  );
  const hasServices = (row.services ?? []).some((s) => (s.name ?? "").trim());
  return hasDescription || hasImage || hasMetadata || hasServices;
}
/** Table trust column band from Protocol Trust sub-score (0–100). */
export function protocolTrustBand(score: number): ProtocolTrustBand {
  const s = Math.round(score);
  if (s >= 60) return "High";
  if (s >= 35) return "Medium";
  return "Low";
}
export function displayOrganicRankLabel(
  rank: number | null | undefined,
  options: { rankable: boolean },
): string {
  if (!options.rankable) return "Insufficient data";
  return displayOrganicRank(rank);
}
export type OrganicRankSource = "db" | "live" | "none";
export type ResolvedOrganicRank = {
  rank: number;
  organicRank: number;
  rankSource: OrganicRankSource;
  rankable: boolean;
};
export function resolveOrganicRank(input: {
  dbRank: number | null | undefined;
  liveRank: number | null | undefined;
  rankable: boolean;
}): ResolvedOrganicRank {
  const db = Math.max(0, Math.round(Number(input.dbRank ?? 0)));
  const live = Math.max(0, Math.round(Number(input.liveRank ?? 0)));
  if (!input.rankable) {
    return { rank: 0, organicRank: 0, rankSource: "none", rankable: false };
  }
  if (db > 0) {
    return { rank: db, organicRank: db, rankSource: "db", rankable: true };
  }
  if (live > 0) {
    return { rank: live, organicRank: live, rankSource: "live", rankable: true };
  }
  return { rank: 0, organicRank: 0, rankSource: "none", rankable: true };
}
/** Primary protocol label for list tables. */
export function agentProtocolLabel(row: {
  sapVerified?: boolean | null;
  sapTwinMatch?: boolean | null;
  metaplexVerified?: boolean | null;
  listingRegistrySource?: string | null;
  x402Support?: boolean | null;
  mppSupport?: boolean | null;
  services?: Array<{ name?: string }> | null;
}): string {
  if (row.sapVerified || row.sapTwinMatch) return "SAP";
  if (row.metaplexVerified || row.listingRegistrySource === "metaplex") return "Metaplex";
  if (row.x402Support) return "x402";
  if (row.mppSupport) return "MPP";
  const svc = (row.services ?? []).map((s) => (s.name ?? "").toUpperCase());
  if (svc.some((n) => n.includes("A2A"))) return "A2A";
  return "ERC-8004";
}