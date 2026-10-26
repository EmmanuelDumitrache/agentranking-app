/**
 * `/api/agents` text search scope — which fields participate in `contains` matching.
 * Keeps URL + server parsing in one place for stable behavior.
 */
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
export const AGENTS_SEARCH_SCOPE_VALUES = ["all", "name", "description", "text"] as const;
export type AgentsSearchScope = (typeof AGENTS_SEARCH_SCOPE_VALUES)[number];
const SCOPE_SET = new Set<string>(AGENTS_SEARCH_SCOPE_VALUES);
/** Hard cap for ILIKE patterns — avoids huge payloads and pathological queries. */
export const AGENTS_LIST_SEARCH_MAX_LEN = 120;
export function normalizeAgentListSearch(raw: string): string {
  const t = raw.trim();
  if (t.length <= AGENTS_LIST_SEARCH_MAX_LEN) return t;
  return t.slice(0, AGENTS_LIST_SEARCH_MAX_LEN);
}
/** Base58 (no 0, O, I, l); typical Solana address length is ~43–44 chars. */
export function isLikelySolanaPubkey(trimmed: string): boolean {
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-k]+$/.test(trimmed);
}
export function parseAgentsSearchScopeParam(raw: string | null | undefined): AgentsSearchScope | null {
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (!v || !SCOPE_SET.has(v)) return null;
  return v as AgentsSearchScope;
}
/**
 * Resolves scope: explicit `searchScope` wins; otherwise `nameOnly` maps to `name`
 * when the query is not numeric / address-like.
 */
export function resolveAgentsSearchScope(input: {
  searchScopeParam: string | null | undefined;
  nameOnly: boolean;
  isNumeric: boolean;
  isAddressLike: boolean;
}): AgentsSearchScope {
  const explicit = parseAgentsSearchScopeParam(input.searchScopeParam);
  if (explicit != null) return explicit;
  if (input.nameOnly && !input.isNumeric && !input.isAddressLike) return "name";
  return "all";
}
/** Shared gate for sidebar search, /agents list, compare picker, and `/api/agents`. */
export function isAgentListSearchQueryReady(raw: string): boolean {
  const t = raw.trim();
  if (!t.length) return false;
  const lower = t.toLowerCase();
  if (lower.startsWith("0x")) return t.length >= 10;
  if (/^\d+$/.test(t)) return true;
  if (isLikelySolanaPubkey(t)) return true;
  return t.length >= 2;
}
/** Effective search string for API calls (empty when query is too short to run). */
export function resolveAgentListSearchForApi(raw: string): string {
  const normalized = normalizeAgentListSearch(raw);
  return isAgentListSearchQueryReady(normalized) ? normalized : "";
}
export function getAgentListSearchHint(raw: string): string {
  const searchTrim = raw.trim();
  if (searchTrim.length === 0) {
    return "Type name, paste a Solana (base58) or EVM address, or ERC agent ID";
  }
  if (searchTrim.toLowerCase().startsWith("0x")) return "Type 10+ characters for address search";
  if (/^\d+$/.test(searchTrim)) {
    const n = Number.parseInt(searchTrim, 10);
    if (!Number.isNaN(n) && n === SOLANA_CHAIN_ID) {
      return `${SOLANA_CHAIN_ID} filters Solana (SAP); add a name or paste a wallet / PDA to find one agent`;
    }
    return "Digits = listing agent ID per chain (not Solana chain). Try the agent's name";
  }
  if (isLikelySolanaPubkey(searchTrim)) return "Searching by Solana wallet / SAP PDA…";
  return "Type 2+ characters to search";
}
