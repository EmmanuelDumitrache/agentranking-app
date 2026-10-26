import { prisma } from "@/lib/db";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import {
  collectUrlKeysForTwinMatch,
  getCachedSapTwinIndex,
  type SapTwinIndex,
} from "@/lib/sap-name-twin";
import type { RelatedSapIdentityRow } from "@/lib/agent-identity";
const MAX_RELATED_SAP_ROWS = 24;
type SapRowSelect = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  agentURI: string | null;
  sapAgentPda: string | null;
  sapOwnerWallet: string | null;
  sapLastSyncedAt: Date | null;
  isVerified: boolean;
  sapVerified: boolean;
};
const sapSelect = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  agentURI: true,
  sapAgentPda: true,
  sapOwnerWallet: true,
  sapLastSyncedAt: true,
  isVerified: true,
  sapVerified: true,
} as const;
function toRelatedRow(
  row: SapRowSelect,
  matchReason: RelatedSapIdentityRow["matchReason"],
): RelatedSapIdentityRow {
  return {
    id: row.id,
    agentId: row.agentId,
    chainId: row.chainId,
    name: row.name,
    slug: toAgentUrlSlug(row.name),
    profilePath: agentPublicPath(row),
    sapAgentPda: row.sapAgentPda,
    sapOwnerWallet: row.sapOwnerWallet,
    agentURI: row.agentURI,
    sapLastSyncedAt: row.sapLastSyncedAt?.toISOString() ?? null,
    isVerified: row.isVerified,
    matchReason,
  };
}
const MATCH_PRIORITY: Record<RelatedSapIdentityRow["matchReason"], number> = {
  primary: 0,
  twin: 1,
  url: 2,
  owner: 3,
};
function mergeRow(
  map: Map<number, RelatedSapIdentityRow>,
  row: RelatedSapIdentityRow,
): void {
  const existing = map.get(row.id);
  if (!existing) {
    map.set(row.id, row);
    return;
  }
  if (MATCH_PRIORITY[row.matchReason] < MATCH_PRIORITY[existing.matchReason]) {
    map.set(row.id, row);
  }
}
function collectIndexDbIds(index: SapTwinIndex, urlKeys: string[]): number[] {
  const ids = new Set<number>();
  for (const key of urlKeys) {
    for (const ref of index.byNormUrl[key] ?? []) {
      ids.add(ref.id);
    }
  }
  return [...ids];
}
async function fetchSapRowsByIds(ids: number[]): Promise<SapRowSelect[]> {
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)].slice(0, MAX_RELATED_SAP_ROWS);
  return withTransientPoolRetry(() =>
    prisma.agent.findMany({
      where: { id: { in: unique }, sapVerified: true, isActive: true },
      select: sapSelect,
    }),
  );
}
export async function loadRelatedSapIdentityRows(args: {
  agentDbId: number;
  name: string;
  agentURI: string | null;
  sapX402Endpoint: string | null;
  sapOwnerWallet: string | null;
  owner: string | null;
  services: ReadonlyArray<{ name: string; endpoint: string }>;
  sapTwinDbId: number | null;
}): Promise<RelatedSapIdentityRow[]> {
  const map = new Map<number, RelatedSapIdentityRow>();
  const wallet = args.sapOwnerWallet?.trim() || args.owner?.trim() || "";
  const primary = await withTransientPoolRetry(() =>
    prisma.agent.findUnique({
      where: { id: args.agentDbId },
      select: sapSelect,
    }),
  );
  if (primary?.sapAgentPda) {
    mergeRow(map, toRelatedRow(primary, "primary"));
  }
  const index = await getCachedSapTwinIndex();
  const urlKeys = collectUrlKeysForTwinMatch({
    agentURI: args.agentURI,
    sapX402Endpoint: args.sapX402Endpoint,
    services: args.services,
  });
  const indexIds = collectIndexDbIds(index, urlKeys);
  const indexRows = await fetchSapRowsByIds(indexIds);
  for (const row of indexRows) {
    const reason: RelatedSapIdentityRow["matchReason"] =
      row.id === args.sapTwinDbId ? "twin" : "url";
    mergeRow(map, toRelatedRow(row, reason));
  }
  if (args.sapTwinDbId != null && !map.has(args.sapTwinDbId)) {
    const twin = await withTransientPoolRetry(() =>
      prisma.agent.findUnique({
        where: { id: args.sapTwinDbId! },
        select: sapSelect,
      }),
    );
    if (twin?.sapVerified) {
      mergeRow(map, toRelatedRow(twin, "twin"));
    }
  }
  if (wallet) {
    const ownerRows = await withTransientPoolRetry(() =>
      prisma.agent.findMany({
        where: {
          sapVerified: true,
          isActive: true,
          OR: [{ sapOwnerWallet: wallet }, { owner: wallet }],
        },
        select: sapSelect,
        take: 12,
      }),
    );
    for (const row of ownerRows) {
      mergeRow(map, toRelatedRow(row, "owner"));
    }
  }
  const out = [...map.values()];
  out.sort((a, b) => MATCH_PRIORITY[a.matchReason] - MATCH_PRIORITY[b.matchReason]);
  return out.slice(0, MAX_RELATED_SAP_ROWS);
}
export async function loadClaimedSapAgentDbIds(agentDbIds: number[]): Promise<Set<number>> {
  if (agentDbIds.length === 0) return new Set();
  const claims = await withTransientPoolRetry(() =>
    prisma.sapAgentOperatorClaim.findMany({
      where: { agentId: { in: agentDbIds } },
      select: { agentId: true },
    }),
  );
  return new Set(claims.map((c) => c.agentId));
}
