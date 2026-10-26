import { ARCHETYPES } from "@/lib/archetype-classifier";
export type DirectoryChip = {
  id: string;
  label: string;
  params: Record<string, string>;
  /** Param key used to detect active state (first key in params). */
  activeKey: string;
};
export const DIRECTORY_PRIMARY_CHIPS: readonly DirectoryChip[] = [
  { id: "verified", label: "Verified", params: { verified: "true" }, activeKey: "verified" },
  { id: "live", label: "Live", params: { active: "24h" }, activeKey: "active" },
  { id: "new", label: "New", params: { sort: "created_desc" }, activeKey: "sort" },
  { id: "high-score", label: "High Score", params: { minScore: "50" }, activeKey: "minScore" },
  { id: "wallet", label: "Has Wallet", params: { hasWallet: "true" }, activeKey: "hasWallet" },
  { id: "payments", label: "Payments", params: { x402: "true" }, activeKey: "x402" },
  { id: "mcp", label: "MCP", params: { skills: "mcp" }, activeKey: "skills" },
  { id: "xpay", label: "xPay", params: { xpay: "true" }, activeKey: "xpay" },
  { id: "tokenized", label: "Tokenized", params: { metaplex: "true", metaplexBoundToken: "true" }, activeKey: "metaplexBoundToken" },
];
export const DIRECTORY_SOURCE_CHIPS: readonly DirectoryChip[] = [
  { id: "sap", label: "SAP", params: { sapVerified: "true" }, activeKey: "sapVerified" },
  { id: "covenant", label: "Covenant", params: { covenant: "true" }, activeKey: "covenant" },
  { id: "hatcher", label: "Hatcher", params: { hatcher: "true" }, activeKey: "hatcher" },
  { id: "metaplex", label: "Metaplex", params: { metaplex: "true" }, activeKey: "metaplex" },
];
export const DIRECTORY_MODE_CHIPS: readonly DirectoryChip[] = [
  { id: "autonomous", label: "Autonomous", params: { agentMode: "autonomous" }, activeKey: "agentMode" },
  { id: "copilot", label: "Co-pilot", params: { agentMode: "copilot" }, activeKey: "agentMode" },
  { id: "hybrid", label: "Hybrid", params: { agentMode: "hybrid" }, activeKey: "agentMode" },
];
export const DIRECTORY_CATEGORY_CHIPS: readonly DirectoryChip[] = ARCHETYPES.filter(
  (a) => a.slug !== "telegram",
).map((a) => ({
  id: `arch-${a.slug}`,
  label: a.label,
  params: { archetype: a.slug },
  activeKey: "archetype",
}));
export const DIRECTORY_SORT_OPTIONS = [
  { value: "agent_rank_desc", label: "AR Score (high → low)" },
  { value: "agent_rank_asc", label: "AR Score (low → high)" },
  { value: "created_desc", label: "Newest" },
  { value: "created_asc", label: "Oldest" },
  { value: "feedback_desc", label: "Most reviews" },
  { value: "protocol_trust_desc", label: "Protocol trust" },
] as const;
export const DIRECTORY_TIME_WINDOWS = [
  { value: "all", label: "All", param: "" },
  { value: "live", label: "New", param: "live" },
  { value: "24h", label: "24h", param: "24h" },
  { value: "7d", label: "7d", param: "7d" },
  { value: "30d", label: "30d", param: "30d" },
] as const;
export function isChipActive(
  chip: DirectoryChip,
  params: URLSearchParams,
): boolean {
  return Object.entries(chip.params).every(([key, expected]) => {
    if (key === "page") return true;
    if (key === "sort" && chip.id === "new") {
      return (params.get("sort") ?? "") === "created_desc";
    }
    if (key === "skills") {
      return (params.get("skills") ?? "").split(",").includes(expected);
    }
    return (params.get(key) ?? "") === expected;
  });
}
export function toggleChipParams(
  chip: DirectoryChip,
  params: URLSearchParams,
): Record<string, string> {
  const active = isChipActive(chip, params);
  const updates: Record<string, string> = { page: "1" };
  if (active) {
    for (const key of Object.keys(chip.params)) {
      if (key !== "page") updates[key] = "";
    }
    return updates;
  }
  return { ...chip.params, page: "1" };
}
export function draftFromSearchParams(params: URLSearchParams): Record<string, string> {
  const keys = [
    "sort",
    "chain",
    "service",
    "minScore",
    "minFeedback",
    "active",
    "archetype",
    "agentMode",
    "socials",
    "sapVerified",
    "covenant",
    "hasWallet",
    "x402",
    "xpay",
    "verified",
    "skills",
    "metaplex",
    "metaplexBoundToken",
    "hatcher",
    "binanceCompatible",
    "searchScope",
  ];
  const draft: Record<string, string> = {};
  for (const key of keys) {
    const v = params.get(key);
    if (v) draft[key] = v;
  }
  return draft;
}
export function isChipActiveInDraft(chip: DirectoryChip, draft: Record<string, string>): boolean {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(draft)) {
    if (value) params.set(key, value);
  }
  return isChipActive(chip, params);
}
export function toggleChipInDraft(
  chip: DirectoryChip,
  draft: Record<string, string>,
): Record<string, string> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(draft)) {
    if (value) params.set(key, value);
  }
  return { ...draft, ...toggleChipParams(chip, params) };
}
const ALL_CHIP_GROUPS = [
  ...DIRECTORY_PRIMARY_CHIPS,
  ...DIRECTORY_SOURCE_CHIPS,
  ...DIRECTORY_MODE_CHIPS,
  ...DIRECTORY_CATEGORY_CHIPS,
] as const;
export function countDirectoryActiveFilters(params: URLSearchParams): number {
  let count = 0;
  const scalarKeys = [
    "chain",
    "service",
    "minScore",
    "minFeedback",
    "active",
    "archetype",
    "agentMode",
    "binanceCompatible",
    "searchScope",
  ];
  for (const key of scalarKeys) {
    if (params.get(key)) count += 1;
  }
  if (params.get("socials")) count += 1;
  if (params.get("sort") && params.get("sort") !== "agent_rank_desc") count += 1;
  for (const chip of ALL_CHIP_GROUPS) {
    if (isChipActive(chip, params)) count += 1;
  }
  return count;
}
/** API / URL param keys managed by the directory filters drawer. */
export const DIRECTORY_FILTER_PARAM_KEYS = [
  "chain",
  "service",
  "minScore",
  "minFeedback",
  "active",
  "archetype",
  "agentMode",
  "socials",
  "sapVerified",
  "covenant",
  "hasWallet",
  "x402",
  "xpay",
  "verified",
  "skills",
  "metaplex",
  "metaplexBoundToken",
  "hatcher",
  "binanceCompatible",
  "searchScope",
] as const;
export function appendDirectoryDraftToSearchParams(
  params: URLSearchParams,
  draft: Record<string, string>,
): void {
  for (const key of DIRECTORY_FILTER_PARAM_KEYS) {
    const value = draft[key];
    if (value) params.set(key, value);
    else params.delete(key);
  }
}
export function countDirectoryActiveFiltersFromDraft(draft: Record<string, string>): number {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(draft)) {
    if (value) params.set(key, value);
  }
  return countDirectoryActiveFilters(params);
}
export function hasDirectoryFilters(draft: Record<string, string>): boolean {
  return countDirectoryActiveFiltersFromDraft(draft) > 0;
}
