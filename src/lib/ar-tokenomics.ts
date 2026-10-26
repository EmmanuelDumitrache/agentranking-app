/** Canonical $AR tokenomics copy and figures for the public site, documentation, and app UI. */
export const AR_TOKEN_SYMBOL = "$AR" as const;
export const AR_TOKEN_NAME = "AgentRanking" as const;
export const AR_TOKEN_CHAIN = "Solana (SPL)" as const;
export const AR_TOTAL_SUPPLY = 1_000_000_000 as const;
export const AR_LAUNCH_MECHANISM =
  "Live on Solana — fair launch via Pump.fun bonding curve. No presale or private allocation." as const;
export type ArSupplySlice = Readonly<{
  readonly key: string;
  readonly name: string;
  readonly percent: number;
  readonly detail: string;
}>;
/** Published supply distribution (percentages are illustrative targets at launch). */
export const AR_SUPPLY_DISTRIBUTION: readonly ArSupplySlice[] = [
  {
    key: "community",
    name: "Community & early buyers",
    percent: 80,
    detail: "Sold via the Pump.fun bonding curve — no presale.",
  },
  {
    key: "liquidity",
    name: "Liquidity pool",
    percent: 17.5,
    detail: "Auto-seeded at graduation; LP burned per launch policy.",
  },
  {
    key: "team",
    name: "Creator / team holdings",
    percent: 5,
    detail:
      "5% policy target on the curve; 4% + 1% (50M $AR) cliff-locked on Streamflow — see the public lock registry at /locked-supply.",
  },
] as const;
export type ArRevenueAllocationSlice = Readonly<{
  readonly key: string;
  readonly percent: number;
  readonly title: string;
  readonly detail: string;
}>;
/** Selected platform fee allocation (policy — not investment advice). */
export const AR_REVENUE_ALLOCATION: readonly ArRevenueAllocationSlice[] = [
  {
    key: "flywheel",
    percent: 80,
    title: "Buybacks & staking",
    detail:
      "Selected platform fees fund $AR buybacks and fee-backed staking rewards for eligible lockers.",
  },
  {
    key: "treasury",
    percent: 20,
    title: "Treasury",
    detail:
      "Infrastructure, development, operations, partnerships, marketing, and ecosystem growth.",
  },
] as const;
export function formatArSupply(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
