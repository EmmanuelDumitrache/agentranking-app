import { AR_SOLANA_MINT } from "@/lib/ar-token-public";
import { AR_TOKEN_SYMBOL, AR_TOTAL_SUPPLY, formatArSupply } from "@/lib/ar-tokenomics";
export type ArTokenLockCategory = "team" | "treasury" | "other";
export type ArTokenLockStatus = "locked" | "unlocking" | "completed" | "planned";
export type ArTokenLockEntry = Readonly<{
  readonly id: string;
  readonly title: string;
  readonly category: ArTokenLockCategory;
  /** Share of 1B fixed supply (e.g. 4 for the first team cliff). */
  readonly percentOfSupply: number;
  readonly amountTokens: number;
  readonly streamflowContractId: string;
  /** ISO-8601 instant (UTC) for the cliff / full unlock. */
  readonly unlockAtIso: string;
  readonly status: ArTokenLockStatus;
  readonly summary: string;
  readonly details: readonly string[];
  readonly sortOrder: number;
  readonly publishedAt?: string;
}>;

const STREAMFLOW_MAINNET_BASE = "https://app.streamflow.finance/contract/solana/mainnet";
export function streamflowContractUrl(contractId: string): string {
  return `${STREAMFLOW_MAINNET_BASE}/${contractId.trim()}`;
}

/** Published on-chain locks — append entries when new Streamflow contracts go live. */
export const AR_TOKEN_LOCKS: readonly ArTokenLockEntry[] = [
  {
    id: "team-cliff-1",
    title: "First team lock (cliff)",
    category: "team",
    percentOfSupply: 4,
    amountTokens: 40_000_000,
    streamflowContractId: "9nGHNoRWjpkLfWThFEZNukehzecH4Bm87tbYCUSazRCD",
    unlockAtIso: "2027-05-24T14:00:00.000Z",
    status: "locked",
    summary:
      "40,000,000 AR (4% of total supply) in a single cliff unlock on Streamflow — immutable contract, verify before relying on any schedule.",
    details: [
      `Token: ${AR_TOKEN_SYMBOL} (AgentRanking) · SPL mint ${AR_SOLANA_MINT}`,
      "This contract is immutable on Streamflow — it cannot be canceled or transferred.",
      "Unlock type: cliff (100% of locked amount unlocks at the scheduled date).",
      "Supply chart shows a 5% team policy target; this entry is the first published 4% lock. Additional team or treasury locks may be added to this registry.",
      "Always verify amount, unlock time, and recipient on Streamflow and Solscan — not investment advice.",
    ],
    sortOrder: 10,
    publishedAt: "2026-05-23",
  },
  {
    id: "team-cliff-2",
    title: "Second team lock (cliff)",
    category: "team",
    percentOfSupply: 1,
    amountTokens: 10_000_000,
    streamflowContractId: "HaeNHuYDgFYLQdDEEPHmPJr6swvbmZPBn1rL1WpTA52N",
    unlockAtIso: "2027-05-24T14:00:00.000Z",
    status: "locked",
    summary:
      "10,000,000 AR (1% of total supply) in a single cliff unlock on Streamflow — immutable contract, verify before relying on any schedule.",
    details: [
      `Token: ${AR_TOKEN_SYMBOL} (AgentRanking) · SPL mint ${AR_SOLANA_MINT}`,
      "This contract is immutable on Streamflow — it cannot be canceled or transferred.",
      "Unlock type: cliff (100% of locked amount unlocks at the scheduled date).",
      "Second 1% cliff lock on Streamflow — see the locked-supply registry for all published team contracts.",
      "Always verify amount, unlock time, and recipient on Streamflow and Solscan — not investment advice.",
    ],
    sortOrder: 20,
    publishedAt: "2026-05-25",
  },
  {
    id: "team-cliff-3",
    title: "Third team lock (cliff)",
    category: "team",
    percentOfSupply: 1,
    amountTokens: 10_000_000,
    streamflowContractId: "HeB8yMwX6ryq9Ri19BcCy7BrmXnPU9zAdCHPzHPkeF6w",
    unlockAtIso: "2027-05-24T14:00:00.000Z",
    status: "locked",
    summary:
      "10,000,000 AR (1% of total supply) in a single cliff unlock on Streamflow — immutable contract, verify before relying on any schedule.",
    details: [
      `Token: ${AR_TOKEN_SYMBOL} (AgentRanking) · SPL mint ${AR_SOLANA_MINT}`,
      "This contract is immutable on Streamflow — it cannot be canceled or transferred.",
      "Unlock type: cliff (100% of locked amount unlocks at the scheduled date).",
      "Published alongside the other team cliff locks; amounts and schedules are aggregated on the locked-supply page.",
      "Always verify amount, unlock time, and recipient on Streamflow and Solscan — not investment advice.",
    ],
    sortOrder: 30,
    publishedAt: "2026-05-27",
  },
] as const;
export function isPublishedLock(lock: ArTokenLockEntry): boolean {
  return lock.status !== "planned";
}
export function sortedArTokenLocks(): readonly ArTokenLockEntry[] {
  return [...AR_TOKEN_LOCKS].sort((a, b) => a.sortOrder - b.sortOrder);
}
export function publishedArTokenLocks(): readonly ArTokenLockEntry[] {
  return sortedArTokenLocks().filter(isPublishedLock);
}
export function arTokenLockTotals(): {
  readonly count: number;
  readonly totalLockedTokens: number;
  readonly totalPercentOfSupply: number;
  readonly plannedCount: number;
  readonly plannedPercentOfSupply: number;
  readonly plannedTokens: number;
} {
  const locks = sortedArTokenLocks();
  const published = locks.filter(isPublishedLock);
  const planned = locks.filter((lock) => lock.status === "planned");
  const totalLockedTokens = published.reduce((sum, lock) => sum + lock.amountTokens, 0);
  const totalPercentOfSupply = published.reduce((sum, lock) => sum + lock.percentOfSupply, 0);
  const plannedPercentOfSupply = planned.reduce((sum, lock) => sum + lock.percentOfSupply, 0);
  const plannedTokens = planned.reduce((sum, lock) => sum + lock.amountTokens, 0);
  return {
    count: published.length,
    totalLockedTokens,
    totalPercentOfSupply,
    plannedCount: planned.length,
    plannedPercentOfSupply,
    plannedTokens,
  };
}
export function formatLockTokenAmount(amount: number): string {
  return `${formatArSupply(amount)} ${AR_TOKEN_SYMBOL}`;
}
export function formatLockUnlockDate(unlockAtIso: string): string {
  const trimmed = unlockAtIso.trim();
  if (!trimmed) return "Estimate TBA";
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return "Estimate TBA";
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Australia/Brisbane",
  }).format(date);
}
export function formatPercentOfTotalSupply(percent: number): string {
  return `${percent}% of ${formatArSupply(AR_TOTAL_SUPPLY)} supply`;
}
