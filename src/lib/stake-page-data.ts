import type { ArTokenMetricsView } from "@/lib/ar-token-metrics";
/** Static stake-page copy and derived pool data. Live metrics are loaded by the page API. */
import {
  ESTIMATE_ONLY_LABEL,
  FEE_ALLOCATION_SHORT,
  FEE_ALLOCATION_TREASURY_SHORT,
  LIVE_TRACKING_COMING_SOON,
} from "@/lib/token-economy-copy";
export type StakePageMetricsDto = Readonly<{
  generatedAt: string;
  totals: ArTokenMetricsView["totals"];
}>;
export type OnChainStakeLockDays = 7 | 30;
export type StakeActivityRow = {
  id: string;
  timeAgo: string;
  source: string;
  amount: string;
  action: string;
  txHash: string | null;
  status: "Completed" | "Pending" | "Coming soon";
};
export const stakeActivityRows: StakeActivityRow[] = [];
export const STAKE_ACTIVITY_EMPTY =
  "Flywheel events will appear here after launch.";
export const STAKE_ACTIVITY_PLACEHOLDER_ROWS = [
  { id: "sk-buyback", label: "Buyback pending" },
  { id: "sk-rewards", label: "Reward cycle pending" },
  { id: "sk-treasury", label: "Treasury allocation pending" },
] as const;
export const STAKE_FAQ_ITEMS = [
  {
    q: "Are rewards guaranteed?",
    a: "No. Rewards are dynamic and depend on selected platform fees, reward pool balance, staking participation, and lock duration.",
  },
  {
    q: "Is this fixed APY?",
    a: "No. AgentRanking does not advertise fixed APY. Rewards depend on real platform usage.",
  },
  {
    q: "What percentage of fees goes to staking?",
    a: `${FEE_ALLOCATION_SHORT} ${FEE_ALLOCATION_TREASURY_SHORT}`,
  },
  {
    q: "What happens to the remaining 20%?",
    a: "Treasury, development, infrastructure, marketing, partnerships, and operations.",
  },
  {
    q: "Are tokens locked?",
    a: "Yes. Live stake pools use Streamflow locks on Solana. Tokens unlock when the selected lock period ends.",
  },
  {
    q: "Can I unstake early?",
    a: "Depends on the Streamflow pool settings. Some locks may require waiting until the full period ends.",
  },
  {
    q: "Is AgentRanking custodial?",
    a: "No. Staking uses Streamflow-powered lock pools. AgentRanking does not custody user wallets.",
  },
  {
    q: "What wallet do I need?",
    a: "A Solana wallet such as Phantom, Solflare, or Backpack.",
  },
] as const;
export { ESTIMATE_ONLY_LABEL, LIVE_TRACKING_COMING_SOON };
