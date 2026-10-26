import { prisma } from "@/lib/db";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { normalizeAgentNameKey } from "@/lib/agent-name-key";
import { collectUrlKeysForTwinMatch } from "@/lib/sap-twin-url-keys";
import {
  getPublicApiCached,
  getPublicApiCacheNamespaceGeneration,
} from "@/lib/public-api-cache";
export {
  collectUrlKeysForTwinMatch,
  normalizeAgentListingUrl,
  type TwinMatchAgentShape,
} from "@/lib/sap-twin-url-keys";
export type SapTwinRef = { id: number; agentId: number; chainId: number };
/**
 * Candidate index for resolving EVM listings to a unique SAP-verified row.
 * Name keys are search heuristics only; URL/owner/source signals must carry
 * identity decisions when a name is ambiguous.
 */
export type SapTwinIndex = {
  readonly byExactNameKey: Readonly<Record<string, readonly SapTwinRef[]>>;
  readonly entries: ReadonlyArray<{ readonly nameKey: string; readonly ref: SapTwinRef }>;
  readonly byNormUrl: Readonly<Record<string, readonly SapTwinRef[]>>;
};
function identityNameKeyFromSapStats(sapStats: unknown): string | null {
  if (sapStats == null || typeof sapStats !== "object") return null;
  const name = (sapStats as Record<string, unknown>).identityName;
  return typeof name === "string" ? normalizeAgentNameKey(name) : null;
}
function intersectIdSets(sets: Array<ReadonlySet<number>>): Set<number> {
  if (sets.length === 0) return new Set();
  let acc = new Set(sets[0]!);
  for (let i = 1; i < sets.length; i += 1) acc = acc.intersection(sets[i]!);
  return acc;
}
function addNameKeyForRef(
  byExactNameKey: Record<string, SapTwinRef[]>,
  entries: Array<{ nameKey: string; ref: SapTwinRef }>,
  nameKey: string | null,
  ref: SapTwinRef,
): void {
  if (!nameKey) return;
  byExactNameKey[nameKey] ??= [];
  if (!byExactNameKey[nameKey].some((candidate) => candidate.id === ref.id)) {
    byExactNameKey[nameKey].push(ref);
  }
  entries.push({ nameKey, ref });
}
function addNormUrlForRef(
  byNormUrl: Record<string, SapTwinRef[]>,
  normKey: string,
  ref: SapTwinRef,
): void {
  byNormUrl[normKey] ??= [];
  if (!byNormUrl[normKey].some((candidate) => candidate.id === ref.id)) {
    byNormUrl[normKey].push(ref);
  }
}
async function loadSapTwinIndex(): Promise<SapTwinIndex> {
  const rows = await prisma.agent.findMany({
    where: { sapVerified: true, isActive: true },
    select: {
      id: true,
      agentId: true,
      chainId: true,
      name: true,
      agentURI: true,
      sapX402Endpoint: true,
      sapStats: true,
      services: { select: { name: true, endpoint: true }, take: 16 },
    },
  });
  const byExactNameKey: Record<string, SapTwinRef[]> = {};
  const entries: Array<{ nameKey: string; ref: SapTwinRef }> = [];
  const byNormUrl: Record<string, SapTwinRef[]> = {};
  for (const row of rows) {
    const ref = { id: row.id, agentId: row.agentId, chainId: row.chainId };
    const nameKeys = new Set<string>();
    const canonicalNameKey = normalizeAgentNameKey(row.name);
    if (canonicalNameKey) nameKeys.add(canonicalNameKey);
    const identityNameKey = identityNameKeyFromSapStats(row.sapStats);
    if (identityNameKey) nameKeys.add(identityNameKey);
    for (const nameKey of nameKeys) addNameKeyForRef(byExactNameKey, entries, nameKey, ref);
    for (const key of collectUrlKeysForTwinMatch({
      agentURI: row.agentURI,
      sapX402Endpoint: row.sapX402Endpoint,
      services: row.services,
    })) {
      addNormUrlForRef(byNormUrl, key, ref);
    }
  }
  return { byExactNameKey, entries, byNormUrl };
}
function isSapTwinRef(value: unknown): value is SapTwinRef {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "number" && Number.isSafeInteger(row.id) &&
    typeof row.agentId === "number" && Number.isSafeInteger(row.agentId) &&
    typeof row.chainId === "number" && Number.isSafeInteger(row.chainId)
  );
}
function isSapTwinIndex(value: unknown): value is SapTwinIndex {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.byExactNameKey == null || typeof row.byExactNameKey !== "object" || Array.isArray(row.byExactNameKey)) return false;
  if (row.byNormUrl == null || typeof row.byNormUrl !== "object" || Array.isArray(row.byNormUrl)) return false;
  if (!Array.isArray(row.entries) || row.entries.length > 100_000) return false;
  return row.entries.every((entry) => {
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) return false;
    const candidate = entry as Record<string, unknown>;
    return typeof candidate.nameKey === "string" && candidate.nameKey.length <= 1_024 && isSapTwinRef(candidate.ref);
  });
}
export async function getCachedSapTwinIndex(): Promise<SapTwinIndex> {
  const cacheNamespace = "sap:twin-index";
  const cacheGeneration = await getPublicApiCacheNamespaceGeneration(cacheNamespace);
  const result = await getPublicApiCached({
    key: `${cacheNamespace}:v2:g${cacheGeneration}`,
    freshTtlSeconds: 60 * 60,
    staleTtlSeconds: 24 * 60 * 60,
    maxPayloadBytes: 16 * 1024 * 1024,
    load: loadSapTwinIndex,
    validate: isSapTwinIndex,
  });
  return result.value;
}
export function resolveUniqueSapTwinFromUrls(
  normKeys: readonly string[],
  index: SapTwinIndex,
  nameKey: string | null = null,
): SapTwinRef | null {
  const keys = [...new Set(normKeys.filter(Boolean))];
  if (keys.length === 0) return null;
  const sets: Array<Set<number>> = [];
  for (const key of keys) {
    const rows = index.byNormUrl[key];
    if (!rows?.length) return null;
    sets.push(new Set(rows.map((row) => row.id)));
  }
  const intersection = intersectIdSets(sets);
  if (intersection.size === 0) return null;
  let candidateIds = intersection;
  if (candidateIds.size > 1 && nameKey) {
    const matchingNameIds = new Set(
      (index.byExactNameKey[nameKey] ?? []).map((candidate) => candidate.id),
    );
    candidateIds = candidateIds.intersection(matchingNameIds);
  }
  if (candidateIds.size !== 1) return null;
  const id = [...candidateIds][0]!;
  return index.byNormUrl[keys[0]!]!.find((row) => row.id === id) ?? null;
}
export function resolveUniqueSapTwinForEvmRow(
  agent: {
    readonly name: string;
    readonly chainId: number;
    readonly sapVerified?: boolean | null;
    readonly agentURI?: string | null;
    readonly sapX402Endpoint?: string | null;
    readonly services?: ReadonlyArray<{ name: string; endpoint: string }>;
  },
  index: SapTwinIndex,
): SapTwinRef | null {
  if (agent.sapVerified === true || agent.chainId === SOLANA_CHAIN_ID) return null;
  const urlKeys = collectUrlKeysForTwinMatch(agent);
  return resolveUniqueSapTwinFromUrls(
    urlKeys,
    index,
    normalizeAgentNameKey(agent.name),
  );
}
export type AgentRowForSapTwin = {
  readonly name: string;
  readonly chainId: number;
  readonly sapVerified?: boolean | null;
  readonly agentURI?: string | null;
  readonly sapX402Endpoint?: string | null;
  readonly services?: ReadonlyArray<{ name: string; endpoint: string }>;
};
export function attachSapTwinMatchToAgentsSync<T extends AgentRowForSapTwin>(
  rows: readonly T[],
  index: SapTwinIndex,
): (T & { sapTwinMatch: boolean })[] {
  return rows.map((agent) => ({
    ...agent,
    sapTwinMatch: resolveUniqueSapTwinForEvmRow(agent, index) != null,
  }));
}
