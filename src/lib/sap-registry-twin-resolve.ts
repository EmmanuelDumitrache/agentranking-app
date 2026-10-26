/**
 * During SAP indexer upsert: find a unique non-Solana registry Agent row that matches the
 * incoming SAP listing (URL evidence plus an optional name key), so SAP fields attach to the existing profile
 * instead of creating a duplicate Solana row.
 *
 * Uses the same URL normalization as `sap-name-twin` (display twin resolution).
 */
import type { Prisma } from "@/generated/prisma/client";
import { normalizeAgentNameKey } from "@/lib/agent-name-key";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { getOrInsert } from "@/lib/map-upsert";
import { collectUrlKeysForTwinMatch, type TwinMatchAgentShape } from "@/lib/sap-twin-url-keys";
/** Per normalized-host probe; union across hosts before intersecting keys. */
const PER_HOST_QUERY_TAKE = 96;
export type SapIdentityForRegistryMatch = TwinMatchAgentShape & {
  readonly displayName: string;
};
function registryAttachWhere(): Prisma.AgentWhereInput {
  return {
    chainId: { not: SOLANA_CHAIN_ID },
    isActive: true,
    sapAgentPda: null,
    sapVerified: { not: true },
  };
}
function intersectIdSets(sets: Array<ReadonlySet<number>>): Set<number> {
  if (sets.length === 0) return new Set();
  let acc = new Set(sets[0]!);
  for (let i = 1; i < sets.length; i++) {
    acc = acc.intersection(sets[i]!);
  }
  return acc;
}
function hostGuessFromNormKey(key: string): string {
  const i = key.indexOf("/");
  return (i === -1 ? key : key.slice(0, i)).trim().toLowerCase();
}
type CandidateRow = {
  id: number;
  name: string;
  chainId: number;
  agentId: number;
  agentURI: string | null;
  sapX402Endpoint: string | null;
  services: Array<{ name: string; endpoint: string }>;
};
function rowNormKeySet(row: TwinMatchAgentShape): Set<string> {
  return new Set(collectUrlKeysForTwinMatch(row));
}
async function loadCandidatesForNormKeys(
  tx: Prisma.TransactionClient,
  normKeys: readonly string[],
): Promise<CandidateRow[]> {
  const hosts = [
    ...new Set(normKeys.map(hostGuessFromNormKey).filter((h) => h.length >= 3)),
  ];
  if (hosts.length === 0) return [];
  const byId = new Map<number, CandidateRow>();
  for (const host of hosts) {
    const rows = await tx.agent.findMany({
      where: {
        AND: [
          registryAttachWhere(),
          {
            OR: [
              { agentURI: { contains: host, mode: "insensitive" } },
              { sapX402Endpoint: { contains: host, mode: "insensitive" } },
              { services: { some: { endpoint: { contains: host, mode: "insensitive" } } } },
            ],
          },
        ],
      },
      select: {
        id: true,
        name: true,
        chainId: true,
        agentId: true,
        agentURI: true,
        sapX402Endpoint: true,
        services: { select: { name: true, endpoint: true }, take: 24 },
      },
      take: PER_HOST_QUERY_TAKE,
    });
    for (const r of rows) {
      getOrInsert(byId, r.id, r);
    }
  }
  return [...byId.values()];
}
/**
 * Returns internal DB id of the unique registry agent to attach SAP onto, or null if no safe match.
 */
export async function resolveUniqueRegistryRowForSapIdentity(
  tx: Prisma.TransactionClient,
  identity: SapIdentityForRegistryMatch,
): Promise<{ id: number } | null> {
  const normKeys = [...new Set(collectUrlKeysForTwinMatch(identity))].filter(Boolean);
  if (normKeys.length > 0) {
    const candidates = await loadCandidatesForNormKeys(tx, normKeys);
    const sets: Array<Set<number>> = [];
    for (const k of normKeys) {
      const ids = new Set<number>();
      for (const c of candidates) {
        if (rowNormKeySet(c).has(k)) ids.add(c.id);
      }
      sets.push(ids);
    }
    const intersection = intersectIdSets(sets);
    if (intersection.size === 1) {
      return { id: [...intersection][0]! };
    }
    if (intersection.size > 1) {
      const identityNameKey = normalizeAgentNameKey(identity.displayName);
      const nameMatches = candidates.filter((candidate) =>
        intersection.has(candidate.id) &&
        identityNameKey != null &&
        normalizeAgentNameKey(candidate.name) === identityNameKey
      );
      if (nameMatches.length === 1) return { id: nameMatches[0]!.id };
      return null;
    }
    const scored = candidates
      .map((c) => {
        const candidateKeys = rowNormKeySet(c);
        const urlHits = normKeys.filter((k) => candidateKeys.has(k)).length;
        const identityNameKey = normalizeAgentNameKey(identity.displayName);
        const nameHit = identityNameKey != null && normalizeAgentNameKey(c.name) === identityNameKey ? 1 : 0;
        return { candidate: c, score: urlHits * 2 + nameHit };
      })
      .filter((r) => r.score >= 2)
      .sort((a, b) => b.score - a.score);
    if (scored.length > 0 && scored[0]!.score > (scored[1]?.score ?? -1)) {
      return { id: scored[0]!.candidate.id };
    }
  }
  return null;
}
