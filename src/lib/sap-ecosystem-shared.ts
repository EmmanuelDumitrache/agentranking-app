import { timeoutSignal } from "@/lib/timing/abort";
/**
 * Pure helpers + DTO types for SAP — safe for `"use client"` imports (no Prisma/pg).
 */
export const SAP_AGENT_WHERE = { sapVerified: true, isActive: true } as const;
/** OOBE / SAP registration count parity — verified on-chain explorers may list inactive agents. */
export const SAP_VERIFIED_AGENT_WHERE = { sapVerified: true } as const;
export type SapCapabilityRow = {
  id?: string;
  protocol?: string;
  version?: string;
  description?: string;
};
export type SapTierRow = {
  tierId?: string;
  pricePerCall?: string;
  rateLimit?: number;
  settlementMode?: unknown;
};
export type SapStatsJson = {
  agentStatsPda?: {
    totalCallsServed?: string;
    isActive?: boolean;
    updatedAt?: string;
  };
  identityReputationScore?: number;
  identityTotalCallsServed?: string;
  identityTotalFeedbacks?: number;
};
export function parseSapCapabilities(raw: unknown): SapCapabilityRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c) => c && typeof c === "object") as SapCapabilityRow[];
}
export function parseSapTiers(raw: unknown): SapTierRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t) => t && typeof t === "object") as SapTierRow[];
}
export function parseSapStats(raw: unknown): SapStatsJson | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as SapStatsJson;
}
export function capabilityKey(c: SapCapabilityRow): string {
  const id = String(c.id ?? "").trim();
  if (id) return id;
  const p = String(c.protocol ?? "").trim();
  const v = String(c.version ?? "").trim();
  return p ? (v ? `${p}@${v}` : p) : "unknown";
}
/** Split `namespace:slug` capability ids and humanize the slug for display (e.g. imageGeneration → image generation). */
export function parseSapCapabilityId(id: string): {
  readonly namespace: string;
  readonly slug: string;
  readonly displayName: string;
  readonly fullId: string;
} {
  const fullId = String(id ?? "").trim();
  const col = fullId.indexOf(":");
  const namespace = col >= 0 ? fullId.slice(0, col).trim() : "";
  const slug = col >= 0 ? fullId.slice(col + 1).trim() : fullId;
  const displayName =
    slug
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .replace(/[-_]+/g, " ")
      .trim() || slug;
  return { namespace, slug, displayName, fullId };
}
export function minTierPriceNumber(tiers: SapTierRow[]): number | null {
  let min: number | null = null;
  for (const t of tiers) {
    const raw = String(t.pricePerCall ?? "").trim();
    if (!raw) continue;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    min = min == null ? n : Math.min(min, n);
  }
  return min;
}
export function reputationFromStats(stats: SapStatsJson | null): number | null {
  if (!stats) return null;
  const r = stats.identityReputationScore;
  return typeof r === "number" && Number.isFinite(r) ? r : null;
}
/** Native-column equivalent of reputationFromStats (no JSON parse). */
export function reputationFromNative(rep: number | null | undefined): number | null {
  return typeof rep === "number" && Number.isFinite(rep) ? rep : null;
}
export function txCountFromStats(stats: SapStatsJson | null): string | null {
  if (!stats) return null;
  const a = stats.agentStatsPda?.totalCallsServed;
  const b = stats.identityTotalCallsServed;
  const s = String(a ?? b ?? "").trim();
  return s || null;
}
/** Native-column equivalent of txCountFromStats (no JSON parse). */
export function txCountFromNative(totalCalls: unknown, identityCalls: unknown): string | null {
  const s = String(totalCalls ?? identityCalls ?? "").trim();
  return s || null;
}
export function volumeFromAgent(
  perfUsd: number | null | undefined,
  stats: SapStatsJson | null
): { label: string; usdPart: number | null; txPart: number | null } {
  const usd = perfUsd != null && Number.isFinite(perfUsd) && perfUsd > 0 ? perfUsd : null;
  const txStr = txCountFromStats(stats);
  const txPart = txStr ? Number.parseFloat(txStr) : null;
  const txOk = txPart != null && Number.isFinite(txPart);
  if (usd != null) {
    return {
      label: `~$${usd.toFixed(0)} (execution wallet)`,
      usdPart: usd,
      txPart: txOk ? txPart : null,
    };
  }
  if (txOk) return { label: String(Math.round(txPart)), usdPart: null, txPart };
  return { label: "—", usdPart: null, txPart: null };
}
export type X402Status = "live" | "offline" | "unknown";
export async function probeX402Endpoint(url: string): Promise<X402Status> {
  const u = url.trim();
  if (!u.startsWith("http://") && !u.startsWith("https://")) return "unknown";
  try {
    const res = await fetch(u, { method: "GET", signal: timeoutSignal(5_000), redirect: "follow" });
    if (res.ok || res.status === 401 || res.status === 402 || res.status === 403 || res.status === 405 || res.status === 429) return "live";
    if (res.status === 404 || res.status === 410 || res.status >= 500) return "offline";
    return "live";
  } catch {
    return "offline";
  }
}
export type SapAgentPublicDto = {
  id: number;
  chainId: number;
  agentId: number;
  name: string;
  slug: string;
  profilePath: string;
  sapAgentPda: string;
  profileScore: number;
  protocolTrustScore: number;
  capabilities: SapCapabilityRow[];
  tiers: SapTierRow[];
  protocols: string[];
  sapStats: SapStatsJson | null;
  reputation: number | null;
  txCountLabel: string | null;
  volumeLabel: string;
  perfTotalVolumeUsd: number | null;
  sapRegisteredAt: string | null;
  sapX402Endpoint: string | null;
};
export type SapComparePayload = {
  readonly a: SapAgentPublicDto;
  readonly b: SapAgentPublicDto;
  readonly x402Status: { readonly a: X402Status; readonly b: X402Status };
};
export const SAP_LEADERBOARD_MODES = [
  "reputation",
  "volume",
  "capabilities",
  "protocols",
  "age",
] as const;
export type LeaderboardMode = (typeof SAP_LEADERBOARD_MODES)[number];
export function normalizeSapLeaderboardMode(value: string | null | undefined): LeaderboardMode {
  const normalized = value?.trim().toLowerCase() ?? "";
  return SAP_LEADERBOARD_MODES.includes(normalized as LeaderboardMode)
    ? (normalized as LeaderboardMode)
    : "reputation";
}
export function normalizeSapComparePda(value: string | null | undefined): string {
  return value?.trim().slice(0, 200) ?? "";
}
export function sapCompareResourceKey(a: string, b: string): string | null {
  const left = normalizeSapComparePda(a);
  const right = normalizeSapComparePda(b);
  return left && right ? `sap-compare:${left}:${right}` : null;
}
export type SapLeaderboardEntry = {
  rank: number;
  chainId: number;
  agentId: number;
  name: string;
  slug: string;
  profilePath: string;
  sapAgentPda: string;
  reputation: number | null;
  volumeUsd: number | null;
  txCountNumeric: number | null;
  capabilityCount: number;
  protocolCount: number;
  sapRegisteredAt: string | null;
  capabilityTags: string[];
};