/** Homepage marketing copy and section structure — public site + public pages. */
export const SITE_HERO = {
  eyebrow: "VERIFICATION & REPUTATION",
  headline: "The trust layer for on-chain Agents.",
  subheadline:
    "Verify ownership, lock trusted links, and rank with AR Score — multi-chain agent discovery built on signals you can prove.",
} as const;
export type PublicNavLink = {
  readonly href: string;
  readonly label: string;
  readonly external?: boolean;
  readonly disabled?: boolean;
};
export type PublicNavDropdown = {
  readonly kind: "dropdown";
  readonly label: string;
  readonly items: readonly PublicNavLink[];
};
export type PublicNavItem = PublicNavLink | PublicNavDropdown;
export function isPublicNavDropdown(item: PublicNavItem): item is PublicNavDropdown {
  return "kind" in item && item.kind === "dropdown";
}
export type PublicFooterColumn = {
  readonly title: string;
  readonly links: readonly {
    readonly label: string;
    readonly href: string;
    readonly external?: boolean;
  }[];
};
export const STAKE_NAV_PATHS = [
  { path: "/", label: "Home", site: "publicSite" },
  { path: "/agents", label: "Agents", site: "publicSite" },
  { path: "#flywheel", label: "Flywheel", site: "stake" },
  { path: "/docs", label: "Docs", site: "publicSite" },
  { path: "#stake", label: "Stake", site: "stake" },
] as const;
export const SITE_STATS_LABELS = {
  agents: "Agents indexed",
  chains: "Chains tracked",
  mcp: "MCP servers",
  partners: "Partners",
  snapshot: "Snapshot",
} as const;
export const SITE_INDEX_PREVIEW_STATS = {
  agents: "Agents indexed",
  verified: "Verified builders",
  chains: "Chains indexed",
  signals: "Signals tracked",
} as const;
export const SITE_PRODUCT = {
  eyebrow: "PRODUCT",
  title: "One graph for the agent economy.",
  subtitle:
    "Profiles, verification, payments, MCP data, jobs, staking, and analytics are connected into one searchable agent graph.",
} as const;
export const SITE_FLYWHEEL = {
  eyebrow: "FLYWHEEL",
  title: "Fees feed the $AR flywheel.",
  subtitle:
    "Selected platform fees can route into buybacks, staking rewards, treasury, and ecosystem growth.",
  disclaimer:
    "Rewards are variable and depend on platform revenue, pool balance, lock participation, and allocation policy. No fixed APY.",
  loopCaption: "Ecosystem signal feeds more agent activity",
  feeSplit: {
    rewards: "80% → $AR buybacks + staking rewards",
    treasury: "20% → infrastructure, ops, partnerships",
  },
} as const;
export const SITE_FLYWHEEL_ALLOCATION = {
  source: {
    eyebrow: "SOURCE",
    title: "Platform fees from real activity",
    copy: "Verification, listings, tools, and partner usage generate selected revenue.",
  },
  mechanism: { eyebrow: "MECHANISM", title: "Allocation" },
  rows: [
    {
      pct: 80,
      title: "$AR buybacks + staking rewards",
      copy: "Majority of selected fees route to buybacks and eligible staker rewards.",
      accent: true,
    },
    {
      pct: 20,
      title: "Infrastructure + operations",
      copy: "Treasury, ops, and ecosystem partnerships.",
    },
  ],
  loopDetailsSummary: "How the full loop works",
} as const;
export const SITE_FLYWHEEL_NODES = [
  { title: "Agents launch", copy: "Builders deploy agents across chains and protocols." },
  { title: "Platform activity", copy: "Verification, listings, marketplaces, and tools drive usage." },
  { title: "Fees generated", copy: "Selected platform revenue accrues from real activity." },
  {
    title: "80% buyback + rewards",
    copy: "Majority of fees route to $AR buybacks and staking rewards.",
    accent: true,
  },
  { title: "$AR locked", copy: "Stakers lock supply and align with platform growth." },
  { title: "Ecosystem signal", copy: "Stronger graph, discovery, and partner integrations." },
] as const;
export const SITE_FLYWHEEL_PHASES = [
  {
    id: "growth",
    label: "Growth",
    steps: [SITE_FLYWHEEL_NODES[0], SITE_FLYWHEEL_NODES[1]],
  },
  {
    id: "revenue",
    label: "Revenue",
    steps: [SITE_FLYWHEEL_NODES[2]],
  },
  {
    id: "flywheel",
    label: "Rewards loop",
    steps: [SITE_FLYWHEEL_NODES[3], SITE_FLYWHEEL_NODES[4], SITE_FLYWHEEL_NODES[5]],
  },
] as const;
export const SITE_STAKING_PREVIEW = {
  title: "Stake $AR into the AgentRanking flywheel.",
  subcopy:
    "Selected platform fees route into $AR buybacks and staking rewards. Lock longer to receive higher reward weighting.",
  cards: [
    { title: "80% fee allocation", copy: "Selected fees fund buybacks and staking rewards." },
    { title: "Streamflow locks", copy: "On-chain locks through Streamflow on Solana." },
    { title: "Reward pools", copy: "Four lock durations with 10% / 15% / 25% / 50% pool share." },
    { title: "On-chain tracking", copy: "Deposits, locks, and distributions visible on-chain." },
  ],
} as const;
export const SITE_PARTNERS = {
  title: "Partner signal strengthens the graph.",
  subtitle:
    "Integrations improve verification, discovery, and ecosystem signal across indexed agents.",
} as const;
export const SITE_FINAL_CTA = {
  titleLine1: "Get started with AgentRanking.",
  titleLine2: "",
  subcopy: "Browse the index, verify your agent, or stake $AR.",
} as const;
