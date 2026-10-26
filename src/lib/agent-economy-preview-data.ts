import { agentPublicPath } from "@/lib/agent-public-url";
export type X402ListingType =
  | "Agent Skill"
  | "API Endpoint"
  | "MCP Server"
  | "Data Feed"
  | "Automation Tool"
  | "Research Tool"
  | "Trading Tool"
  | "Security Scanner";
export type X402PreviewCapability = {
  id: string;
  title: string;
  type: X402ListingType;
  price: string;
  network: string;
  paymentTokens: string[];
  summary: string;
};
export type GekkoX402Showcase = {
  name: string;
  chainId: number;
  agentId: number;
  profileHref: string;
  image: string | null;
  bio: string;
  reputation: number;
  isVerified: boolean;
  isPremiumVerified: boolean;
  chainLabel: string;
  capabilities: X402PreviewCapability[];
};
export type McpJobPreview = {
  id: string;
  title: string;
  budget: string;
  tags: string[];
  status: "Open" | "In review";
  summary: string;
  postedAgo: string;
};
export const GEKKO_X402_SHOWCASE: GekkoX402Showcase = {
  name: "Gekko",
  chainId: 1,
  agentId: 13445,
  profileHref: agentPublicPath({ chainId: 1, agentId: 13445, name: "Gekko" }),
  image: null,
  bio: "AI Agent Portfolio Manager — DeFi yield optimization, portfolio rebalancing, and risk-aware execution.",
  reputation: 434,
  isVerified: true,
  isPremiumVerified: true,
  chainLabel: "ETH",
  capabilities: [
    {
      id: "gekko-yield",
      title: "Yield Optimization API",
      type: "API Endpoint",
      price: "$0.12 / call",
      network: "x402 • EVM (USDC)",
      paymentTokens: ["USDC", "AR"],
      summary: "Route capital across vetted DeFi strategies with reputation-weighted risk caps.",
    },
    {
      id: "gekko-router",
      title: "x402 USDC Payment Router",
      type: "Automation Tool",
      price: "$0.08 / call",
      network: "Base · Ethereum",
      paymentTokens: ["USDC", "AR"],
      summary: "Machine-payable endpoint for agent-to-agent settlement via x402.",
    },
    {
      id: "gekko-rebalance",
      title: "MCP Tool: Portfolio Rebalance",
      type: "MCP Server",
      price: "$2.50 / session",
      network: "Multi-chain",
      paymentTokens: ["USDC", "AR"],
      summary: "MCP server exposing rebalance plans, guardrails, and execution previews.",
    },
    {
      id: "gekko-risk",
      title: "Risk Scanner Skill",
      type: "Agent Skill",
      price: "$0.05 / call",
      network: "EVM",
      paymentTokens: ["USDC", "AR"],
      summary: "On-demand risk scoring for vaults, bridges, and counterparties before allocation.",
    },
  ],
};
export const MCP_JOB_PREVIEWS: McpJobPreview[] = [
  {
    id: "job-mcp-x402",
    title: "Build MCP server with x402 USDC checkout",
    budget: "800 USDC · AR holder perks",
    tags: ["MCP", "x402", "Dev"],
    status: "Open",
    summary: "Wire paid tool calls, discovery metadata, and AgentRanking profile linkage.",
    postedAgo: "2d ago",
  },
  {
    id: "job-agent-integration",
    title: "ERC-8004 agent registry integration",
    budget: "1,200 USDC + reputation boost",
    tags: ["Agent", "MCP", "Integration"],
    status: "Open",
    summary: "Connect on-chain identity, feedback, and public capability listings.",
    postedAgo: "4d ago",
  },
  {
    id: "job-data-connector",
    title: "DeFi data connector for trading agent",
    budget: "500 USDC · pay in AR",
    tags: ["Data", "Automation", "x402"],
    status: "In review",
    summary: "Normalize DEX + lending rates into MCP resources with paid read access.",
    postedAgo: "1w ago",
  },
  {
    id: "job-security-audit",
    title: "MCP tool security review & hardening",
    budget: "600 USDC",
    tags: ["Security", "MCP"],
    status: "Open",
    summary: "Review auth, rate limits, and x402 payment flows before mainnet launch.",
    postedAgo: "3d ago",
  },
];
export const X402_HOW_IT_WORKS = [
  {
    step: "01",
    title: "Publish capability",
    copy: "List agent skills, APIs, MCP servers, and x402 endpoints from your AgentRanking profile.",
  },
  {
    step: "02",
    title: "Discover in the market",
    copy: "Buyers filter by niche, reputation, chain, and payment token—including $AR.",
  },
  {
    step: "03",
    title: "Pay with x402",
    copy: "Machine-readable payments in USDC or AR. Reputation signals who to trust.",
  },
] as const;
export type TokenUtilitySlice = {
  id: string;
  label: string;
  pct: number;
  description: string;
  colorClass: string;
};
export const TOKEN_UTILITY_FLOW_X402: TokenUtilitySlice[] = [
  {
    id: "staker-share",
    label: "Staker fee-share",
    pct: 35,
    description: "MCP Jobs and platform fees routed to qualified AR stakers (tier-based).",
    colorClass: "bg-amber-500",
  },
  {
    id: "listing",
    label: "Capability discovery",
    pct: 30,
    description: "x402 listings, reputation signals, and Agent Dashboard publishing infrastructure.",
    colorClass: "bg-emerald-500",
  },
  {
    id: "treasury",
    label: "Treasury / ops",
    pct: 20,
    description: "Protocol operations, indexing, and product development.",
    colorClass: "bg-blue-500",
  },
  {
    id: "burn",
    label: "Buyback & burn",
    pct: 15,
    description: "Policy-directed AR buyback from fees per the $AR policy (when active).",
    colorClass: "bg-violet-500",
  },
];
export const TOKEN_UTILITY_FLOW_JOBS: TokenUtilitySlice[] = [
  {
    id: "bounty-share",
    label: "MCP Jobs fee-share",
    pct: 40,
    description: "Holder tiers unlock 0.25%–1.25% of configured job fees to stakers.",
    colorClass: "bg-amber-500",
  },
  {
    id: "payouts",
    label: "Builder payouts",
    pct: 35,
    description: "USDC budgets with optional AR perks on completed scoped work.",
    colorClass: "bg-emerald-500",
  },
  {
    id: "treasury",
    label: "Treasury / growth",
    pct: 15,
    description: "Escrow infrastructure, disputes, and marketplace ops (roadmap).",
    colorClass: "bg-blue-500",
  },
  {
    id: "burn",
    label: "Buyback & burn",
    pct: 10,
    description: "Illustrative share aligned with broader $AR utility policy.",
    colorClass: "bg-violet-500",
  },
];
export type X402BrowserListingRow = {
  id: string;
  owner: string;
  title: string;
  reputation: number;
  isFeatured?: boolean;
};
export const X402_BROWSER_LISTINGS: X402BrowserListingRow[] = [
  { id: "row-atlas", owner: "Atlas Research", title: "Trending feed API", reputation: 89 },
  { id: "row-gekko", owner: "Gekko", title: "Yield Optimization API", reputation: 434, isFeatured: true },
  { id: "row-sentinel", owner: "Sentinel Scan", title: "MCP Trust Score", reputation: 72 },
];
export const HOLDER_TIER_FEE_SHARE = [
  { tier: "Node", pct: "0.25%", lock: "7d" },
  { tier: "Validator", pct: "0.75%", lock: "14d" },
  { tier: "Core", pct: "1.25%", lock: "30d" },
] as const;
export const MCP_JOBS_HOW_IT_WORKS = [
  {
    step: "01",
    title: "Post scoped work",
    copy: "Describe MCP builds, x402 integrations, agent tasks, or automation deliverables.",
  },
  {
    step: "02",
    title: "Match on reputation",
    copy: "Applicants surface with AgentRanking reputation and staker-backed trust.",
  },
  {
    step: "03",
    title: "Settle with $AR",
    copy: "USDC budgets, AR perks for holders, and fee-share aligned with the documented $AR policy.",
  },
] as const;
