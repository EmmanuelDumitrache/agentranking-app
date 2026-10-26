import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { verifyAndDiscoverMcpConnection } from "@/features/agent-chat/server/mcp/discovery-service";
import {
  getMcpProviderManifest,
  listMcpProviderManifests,
} from "@/features/agent-chat/server/mcp/provider-registry";
import { mcpErrorCode } from "@/features/agent-chat/server/mcp/errors";
import {
  evaluateMcpConnectionPlatformPolicy,
  listActiveMcpAdminRules,
  mcpScheduledDiscoveryEnabled,
} from "@/features/agent-chat/server/mcp/platform-policy";

const BASE_REFRESH_AGE_MS = 24 * 60 * 60_000;
const MAX_JITTER_MS = 6 * 60 * 60_000;
const BATCH_SIZE = 100;
const CONCURRENCY = 2;

function stableJitter(connectionId: string): number {
  const digest = createHash("sha256").update(connectionId).digest();
  return digest.readUInt32BE(0) % MAX_JITTER_MS;
}

export async function mcpCatalogRefreshJob(): Promise<{
  considered: number;
  refreshed: number;
  failed: number;
}> {
  if (!await mcpScheduledDiscoveryEnabled()) {
    return { considered: 0, refreshed: 0, failed: 0 };
  }
  const now = Date.now();
  const manifestChangeFilters = listMcpProviderManifests().map((manifest) => ({
    providerKey: manifest.key,
    OR: [
      { manifestVersion: null },
      { manifestVersion: { not: manifest.manifestVersion } },
    ],
  }));
  const select = {
    id: true,
    appAccountId: true,
    providerKey: true,
    endpointOrigin: true,
    manifestVersion: true,
    lastDiscoveredAt: true,
  } as const;
  const eligible = {
    deletedAt: null,
    disabledAt: null,
    status: { in: ["READY", "DEGRADED"] as Array<"READY" | "DEGRADED"> },
  };
  const loadCandidates = async () => {
    const changed = manifestChangeFilters.length
      ? await prisma.agentMcpConnection.findMany({
          where: { ...eligible, OR: manifestChangeFilters },
          select,
          orderBy: [{ updatedAt: "asc" as const }, { id: "asc" as const }],
          take: BATCH_SIZE,
        })
      : [];
    const remaining = BATCH_SIZE - changed.length;
    if (remaining <= 0) return changed;
    const aged = await prisma.agentMcpConnection.findMany({
      where: {
        ...eligible,
        id: changed.length ? { notIn: changed.map((connection) => connection.id) } : undefined,
        OR: [
          { lastDiscoveredAt: null },
          { lastDiscoveredAt: { lte: new Date(now - BASE_REFRESH_AGE_MS) } },
        ],
      },
      select,
      orderBy: [{ lastDiscoveredAt: "asc" as const }, { id: "asc" as const }],
      take: remaining,
    });
    return [...changed, ...aged];
  };
  const [candidates, rules] = await Promise.all([
    loadCandidates(),
    listActiveMcpAdminRules(),
  ]);
  const due = candidates.filter((connection) => {
    if (!evaluateMcpConnectionPlatformPolicy({
      phase: "scheduled-refresh",
      appAccountId: connection.appAccountId,
      providerKey: connection.providerKey,
      endpointOrigin: connection.endpointOrigin,
      connectionId: connection.id,
      rules,
    }).allowed) return false;
    const manifestChanged = Boolean(
      connection.providerKey
      && getMcpProviderManifest(connection.providerKey)?.manifestVersion !== connection.manifestVersion,
    );
    if (manifestChanged || !connection.lastDiscoveredAt) return true;
    return now - connection.lastDiscoveredAt.getTime()
      >= BASE_REFRESH_AGE_MS + stableJitter(connection.id);
  });
  let cursor = 0;
  let refreshed = 0;
  let failed = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, async () => {
    for (;;) {
      const index = cursor++;
      const connection = due[index];
      if (!connection) return;
      try {
        await verifyAndDiscoverMcpConnection({
          appAccountId: connection.appAccountId,
          connectionId: connection.id,
          operation: "discover",
        });
        refreshed += 1;
      } catch (error) {
        failed += 1;
        console.warn("[mcp-refresh] connection refresh failed", {
          providerKey: connection.providerKey,
          errorCode: mcpErrorCode(error),
        });
      }
    }
  }));
  return { considered: due.length, refreshed, failed };
}
