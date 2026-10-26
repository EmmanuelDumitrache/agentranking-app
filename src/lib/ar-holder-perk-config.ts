import { formatUnits } from "viem";
const WAD = BigInt(10) ** BigInt(18);
function tokens(amount: number): bigint {
  return BigInt(amount) * WAD;
}
export type ArHolderTierId = "node" | "validator" | "core";
export type ArHolderTier = Readonly<{
  id: ArHolderTierId;
  /** Display name (Node, Validator, Core). */
  name: string;
  /** Lock duration label shown in UI. */
  label: string;
  minBalanceRaw: bigint;
  minLockDays: number;
  /** DAO votes added to one agent per apply (14d cooldown per agent). */
  boostUnits: number;
  referralMultiplier: number;
  bountyFeeSharePct: number;
  agentDashboardAccess: string;
  /** Stake Endorsement Badge label on agents. */
  badgeLabel: string;
  summary: string;
  /** Future pool APY perk — shown as coming soon in staking UI. */
  comingSoonApyLabel?: string;
}>;
export const AR_HOLDER_TIERS: readonly ArHolderTier[] = [
  {
    id: "node",
    name: "Node",
    label: "7 days",
    minBalanceRaw: tokens(250_000),
    minLockDays: 7,
    boostUnits: 15,
    referralMultiplier: 1.05,
    bountyFeeSharePct: 0.25,
    agentDashboardAccess: "Agent Dashboard previews + referral tools",
    badgeLabel: "Backed by stakers",
    summary: "Entry tier: referral engine, Agent Dashboard previews, +15 reputation votes per apply, and stake endorsement badge.",
  },
  {
    id: "validator",
    name: "Validator",
    label: "14 days",
    minBalanceRaw: tokens(500_000),
    minLockDays: 14,
    boostUnits: 50,
    referralMultiplier: 1.2,
    bountyFeeSharePct: 0.75,
    agentDashboardAccess: "Agent Dashboard Premium — alerts, comparisons, refresh lanes",
    badgeLabel: "Backed by stakers",
    comingSoonApyLabel: "Earn $AR APY from the pool — coming soon",
    summary: "Validator tier: premium Agent Dashboard, +50 reputation votes per apply, stronger referral bonus.",
  },
  {
    id: "core",
    name: "Core",
    label: "30 days",
    minBalanceRaw: tokens(1_000_000),
    minLockDays: 30,
    boostUnits: 100,
    referralMultiplier: 1.4,
    bountyFeeSharePct: 1.25,
    agentDashboardAccess: "Agent Dashboard Premium — exports, MCP lanes, full feature set",
    badgeLabel: "Backed by stakers",
    comingSoonApyLabel: "Earn higher $AR APY from the pool — coming soon",
    summary: "Core tier: golden profile, +100 reputation votes per apply, premium Agent Dashboard, highest referral bonus.",
  },
];
export const HOLDER_POWER_BOOST_PERK = "power_boost";
export const HOLDER_STAKE_BADGE_PERK = "stake_badge";
export const HOLDER_AGENT_PERK_TYPES = [HOLDER_POWER_BOOST_PERK, HOLDER_STAKE_BADGE_PERK] as const;
export type HolderAgentPerkType = (typeof HOLDER_AGENT_PERK_TYPES)[number];
export function isHolderAgentPerkType(value: string): value is HolderAgentPerkType {
  return HOLDER_AGENT_PERK_TYPES.includes(value as HolderAgentPerkType);
}
export function formatHolderTokenAmount(raw: bigint): string {
  const n = Number(formatUnits(raw, 18));
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: n >= 1000 ? 0 : 2 });
}
export function getHolderTierById(id: string | null | undefined): ArHolderTier | null {
  return AR_HOLDER_TIERS.find((t) => t.id === id) ?? null;
}
export function getHolderTierDisplayName(tier: ArHolderTier | null | undefined): string {
  if (!tier) return "";
  return tier.name || tier.label;
}
export function holderTierMeetsOrExceeds(current: ArHolderTier | null, required: ArHolderTier): boolean {
  if (!current) return false;
  return AR_HOLDER_TIERS.findIndex((t) => t.id === current.id) >= AR_HOLDER_TIERS.findIndex((t) => t.id === required.id);
}
export function getUnlockedHolderTier(balanceRaw: bigint): ArHolderTier | null {
  let tier: ArHolderTier | null = null;
  for (const candidate of AR_HOLDER_TIERS) {
    if (balanceRaw >= candidate.minBalanceRaw) tier = candidate;
    else break;
  }
  return tier;
}
