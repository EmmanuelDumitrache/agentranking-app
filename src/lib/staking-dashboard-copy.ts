/** Microcopy for the staking dashboard panels. */
export const STAKING_DASHBOARD_LEFT = {
  title: "Stake $AR",
  description: "Connect wallet and choose an eligible lock pool.",
  walletLabel: "Solana wallet",
  walletStatusDisconnected: "Not connected",
  provider: "Phantom",
  connectCta: "Connect Phantom",
  disconnectCta: "Disconnect",
  connectHelper: "Approve in Phantom to begin staking.",
  plannedStakeHint: "Select a live lock period (7, 14, or 30 days) to stake on Streamflow.",
  trustRow: "Powered by Streamflow. AgentRanking does not custody your tokens.",
} as const;
export const STAKING_DASHBOARD_AMOUNT = {
  label: "Amount to stake",
  availablePrefix: "Available:",
  helper:
    "No fixed APY — rewards depend on selected fees, total locked supply, and lock participation.",
} as const;
export const STAKING_DASHBOARD_LOCK = {
  sectionLabel: "Lock period",
  upcomingFootnote: "Soon",
} as const;
export const STAKING_DASHBOARD_REWARD = {
  title: "Reward estimate",
  subtitle: "Preview your lock weighting and share before you stake.",
  rewardSource: "Selected platform fees",
  distributionSource: "Selected platform fees",
  claimStatusLabel: "Claim status",
  claimStatusEmpty: "Nothing to claim",
  emptyEstimate: "Connect wallet to preview your estimated share.",
  emptyAmount: "Enter an amount to preview pool share.",
  infoNote:
    "Estimates vary with platform fees, pool size, and staking participation. Dynamic rewards — not fixed APY.",
  holderLens:
    "Longer locks may receive higher reward weighting. Actual rewards depend on fees and staking participation.",
  positionTitle: "Your position",
  positionEmpty: "No active locks yet.",
} as const;
export const FEE_FLOW_MINI_STEPS = [
  "Fees",
  "Reward pool",
  "Buybacks",
  "Locked stakers",
  "Supply alignment",
  "Long-term growth",
] as const;
