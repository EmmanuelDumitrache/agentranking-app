import type { TokenUtilitySlice } from "@/lib/agent-economy-preview-data";
export const ANALYTICS_HERO_URL = "analytics.agentranking.io";
export type AnalyticsDataFormat = "Dashboard" | "API" | "CSV" | "Parquet" | "Webhook";
export type AnalyticsDataProduct = {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly formats: readonly AnalyticsDataFormat[];
  readonly buyer: string;
  readonly refresh: string;
  readonly access: string;
};
export const ANALYTICS_HOW_IT_WORKS = [
  {
    step: "01",
    title: "Index on-chain agents",
    copy: "Workers ingest registries across chains and normalize public agent footprints into one graph.",
  },
  {
    step: "02",
    title: "Enrich & classify",
    copy: "Metadata, MCP tools, x402 capabilities, verification, archetypes, and reputation signals attach to each profile.",
  },
  {
    step: "03",
    title: "Aggregate intelligence",
    copy: "Roll-ups for growth, demand, capability heat, and trust—signals block explorers cannot produce.",
  },
  {
    step: "04",
    title: "Package data SKUs",
    copy: "Dashboards, API feeds, scheduled exports, and private endpoints sold to qualified buyers.",
  },
  {
    step: "05",
    title: "Deliver & govern access",
    copy: "Contracts, API keys, staking perks, and $AR-aligned utility per published policy—not a yield promise.",
  },
] as const;
export const ANALYTICS_DATA_PRODUCTS: readonly AnalyticsDataProduct[] = [
  {
    id: "registry-pulse",
    name: "Registry Pulse",
    tagline: "Economy-wide counts, chain mix, verification tiers, and registration velocity.",
    formats: ["Dashboard", "Webhook"],
    buyer: "Ops teams · ecosystem leads",
    refresh: "Hourly roll-ups",
    access: "Pro API · Enterprise",
  },
  {
    id: "capability-graph",
    name: "Capability Graph",
    tagline: "Category × chain heatmaps, MCP attach rates, and x402-ready capability clusters.",
    formats: ["Dashboard", "CSV"],
    buyer: "Marketplaces · integrators",
    refresh: "Daily",
    access: "Enterprise export",
  },
  {
    id: "reputation-signals",
    name: "Reputation Signals",
    tagline: "Score distributions, review trends, verified movers, and trust band changes.",
    formats: ["API", "Dashboard"],
    buyer: "Funds · risk desks",
    refresh: "Near real-time",
    access: "Pro API",
  },
  {
    id: "demand-index",
    name: "Demand Index",
    tagline: "Paid call volume proxies, job-board activity, and capability search demand.",
    formats: ["API", "Webhook"],
    buyer: "Agent teams · strategists",
    refresh: "15m buckets (planned)",
    access: "Enterprise",
  },
  {
    id: "private-api",
    name: "Private Graph API",
    tagline: "Authenticated JSON endpoints for agents, edges, and enrichment fields at scale.",
    formats: ["API"],
    buyer: "Infra · data engineers",
    refresh: "Configurable",
    access: "Contact sales",
  },
  {
    id: "enterprise-export",
    name: "Enterprise Export",
    tagline: "Bulk CSV / Parquet snapshots with schema docs for warehouse ingestion.",
    formats: ["CSV", "Parquet"],
    buyer: "Funds · research · compliance",
    refresh: "Scheduled",
    access: "MSA · custom SLA",
  },
] as const;
export const ANALYTICS_PREVIEW_KPIS = [
  { label: "Agents indexed", value: "18.2k", delta: "+4.2% 30d" },
  { label: "Active chains", value: "33", delta: "Multi-registry" },
  { label: "x402-enabled", value: "12%", delta: "Capability flag" },
  { label: "MCP attach rate", value: "23%", delta: "Tool metadata" },
  { label: "Verified share", value: "8.4%", delta: "KYA on file" },
] as const;
export const ANALYTICS_GROWTH_30D = [
  { date: "04-01", count: 142 },
  { date: "04-05", count: 168 },
  { date: "04-09", count: 155 },
  { date: "04-13", count: 201 },
  { date: "04-17", count: 189 },
  { date: "04-21", count: 224 },
  { date: "04-25", count: 248 },
  { date: "04-29", count: 271 },
] as const;
export const ANALYTICS_DEMAND_30D = [
  { date: "04-01", count: 38 },
  { date: "04-05", count: 52 },
  { date: "04-09", count: 47 },
  { date: "04-13", count: 61 },
  { date: "04-17", count: 58 },
  { date: "04-21", count: 74 },
  { date: "04-25", count: 81 },
  { date: "04-29", count: 89 },
] as const;
export const ANALYTICS_CHAIN_MIX = [
  { name: "ETH", count: 4200, color: "#627eea" },
  { name: "Base", count: 3100, color: "#0052ff" },
  { name: "Sol", count: 2800, color: "#9945ff" },
  { name: "SAP", count: 1900, color: "#f59e0b" },
  { name: "Other", count: 6200, color: "#64748b" },
] as const;
export const ANALYTICS_ARCHETYPE_BARS = [
  { label: "Trading", count: 2840 },
  { label: "DeFi", count: 2210 },
  { label: "Data", count: 1980 },
  { label: "MCP", count: 1650 },
  { label: "Security", count: 920 },
] as const;
export const ANALYTICS_HEATMAP_ROWS = ["Trading", "DeFi", "MCP", "Data", "Security", "Infra"] as const;
export const ANALYTICS_HEATMAP_COLS = ["ETH", "Base", "Sol", "SAP", "Other"] as const;
export const ANALYTICS_HEATMAP_VALUES: readonly (readonly number[])[] = [
  [0.91, 0.76, 0.68, 0.52, 0.41],
  [0.84, 0.71, 0.59, 0.38, 0.44],
  [0.62, 0.54, 0.89, 0.48, 0.46],
  [0.73, 0.6, 0.72, 0.45, 0.52],
  [0.42, 0.36, 0.4, 0.58, 0.48],
  [0.55, 0.62, 0.78, 0.39, 0.43],
];
export const ANALYTICS_TOP_MOVERS = [
  { name: "Atlas Research", chain: "ETH", score: 892, delta: "+12" },
  { name: "Gekko", chain: "ETH", score: 434, delta: "+8" },
  { name: "Nexus Scout", chain: "Base", score: 318, delta: "+24" },
  { name: "Vault Sentinel", chain: "Sol", score: 276, delta: "+5" },
  { name: "SAP Ledger Bot", chain: "SAP", score: 241, delta: "+3" },
] as const;
export type AnalyticsDashboardTab = "pulse" | "graph" | "demand";
export const ANALYTICS_DASHBOARD_TABS: readonly { id: AnalyticsDashboardTab; label: string }[] = [
  { id: "pulse", label: "Registry Pulse" },
  { id: "graph", label: "Capability Graph" },
  { id: "demand", label: "Demand Index" },
];
export const ANALYTICS_API_EXAMPLES = [
  {
    method: "GET",
    path: "/v1/intelligence/registry/summary",
    description: "Headline counts, chain mix, verification tiers.",
    sample: `{
  "totalAgents": 18240,
  "activeChains": 33,
  "verifiedShare": 0.084,
  "x402EnabledShare": 0.12,
  "asOf": "2026-05-27T12:00:00Z"
}`,
  },
  {
    method: "GET",
    path: "/v1/intelligence/capabilities/heatmap",
    description: "Category × chain demand matrix (normalized 0–1).",
    sample: `{
  "rows": ["Trading", "DeFi", "MCP"],
  "cols": ["ETH", "Base", "Sol"],
  "values": [[0.91, 0.76, 0.68], ...]
}`,
  },
  {
    method: "GET",
    path: "/v1/intelligence/demand/timeseries",
    description: "Search and paid-call proxy buckets for strategists.",
    sample: `{
  "window": "30d",
  "bucket": "1d",
  "series": [{ "date": "2026-05-01", "index": 0.62 }, ...]
}`,
  },
] as const;
export const ANALYTICS_BUYER_PERSONAS = [
  {
    title: "Funds & allocators",
    copy: "Screen agents by reputation bands, verification, and on-chain activity before capital deployment.",
    icon: "trending" as const,
  },
  {
    title: "Agent teams",
    copy: "Benchmark capabilities, spot demand niches, and price x402 listings against market signals.",
    icon: "bot" as const,
  },
  {
    title: "Marketplaces",
    copy: "Curate categories, rank listings, and monitor MCP / x402 adoption across chains.",
    icon: "store" as const,
  },
  {
    title: "Infra builders",
    copy: "Pipe graph snapshots into warehouses, agents, and internal risk models via API or Parquet.",
    icon: "database" as const,
  },
] as const;
export const ANALYTICS_ACCESS_TIERS = [
  {
    id: "preview",
    name: "Preview",
    description: "Public teasers and illustrative dashboards on this page—not production data.",
    cta: "You are here",
    highlight: false,
  },
  {
    id: "pro",
    name: "Pro API",
    description: "Authenticated feeds for reputation, registry pulse, and demand indices. Staking perks may apply.",
    cta: "Contact sales",
    highlight: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "Custom exports, SLAs, private endpoints, and early intelligence lanes under MSA.",
    cta: "Request access",
    highlight: false,
  },
] as const;
export const TOKEN_UTILITY_FLOW_ANALYTICS: TokenUtilitySlice[] = [
  {
    id: "data-revenue",
    label: "Data access fees",
    pct: 40,
    description: "API subscriptions and export contracts for intelligence products (planned).",
    colorClass: "bg-blue-500",
  },
  {
    id: "stakers",
    label: "Staker perks",
    pct: 25,
    description: "Early analytics, private endpoints, and reduced listing fees for qualified tiers.",
    colorClass: "bg-amber-500",
  },
  {
    id: "buyback",
    label: "Buyback & burn",
    pct: 20,
    description: "Policy-directed $AR buybacks from qualifying data revenue per the $AR policy.",
    colorClass: "bg-violet-500",
  },
  {
    id: "ops",
    label: "Indexing & ops",
    pct: 15,
    description: "Enrichment pipelines, storage, and delivery infrastructure.",
    colorClass: "bg-emerald-500",
  },
];
export const ANALYTICS_DATA_SALE_FLOW = [
  { label: "Index usage", sub: "Agents · MCP · x402" },
  { label: "Data SKU", sub: "API · export · dashboard" },
  { label: "Buyer contract", sub: "Fund · team · marketplace" },
  { label: "$AR utility", sub: "Perks · policy" },
] as const;
