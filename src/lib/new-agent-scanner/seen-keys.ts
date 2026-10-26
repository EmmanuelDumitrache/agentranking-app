export const NEW_SCANNER_SEEN_KEYS_STORAGE_KEY = "agentranking-new-scanner-seen-keys";
const MAX_SEEN_KEYS = 120;
export function readNewScannerSeenKeys(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(NEW_SCANNER_SEEN_KEYS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is string => typeof k === "string"));
  } catch {
    return new Set();
  }
}
export function writeNewScannerSeenKeys(keys: Iterable<string>): void {
  if (typeof window === "undefined") return;
  try {
    const arr = [...keys].slice(0, MAX_SEEN_KEYS);
    window.sessionStorage.setItem(NEW_SCANNER_SEEN_KEYS_STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // ignore quota / private mode
  }
}
export function agentListingKey(chainId: number, agentId: number): string {
  return `${chainId}-${agentId}`;
}
export function computeMissedAgentKeys(
  agents: ReadonlyArray<{ chainId: number; agentId: number }>,
  seenKeys: ReadonlySet<string>,
): { missedKeys: string[]; staggerByKey: Map<string, number> } {
  const missedKeys: string[] = [];
  for (const agent of agents) {
    const key = agentListingKey(agent.chainId, agent.agentId);
    if (!seenKeys.has(key)) missedKeys.push(key);
  }
  const staggerByKey = new Map(missedKeys.map((key, index) => [key, index]));
  return { missedKeys, staggerByKey };
}