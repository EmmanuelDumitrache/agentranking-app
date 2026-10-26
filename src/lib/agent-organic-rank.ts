import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  isAgentRankable,
  resolveOrganicRank,
  type AgentRankableInput,
  type OrganicRankSource,
  type ResolvedOrganicRank,
} from "@/lib/agent-rankable";
import { skipLiveOrganicRank } from "@/lib/fast-local";
export type { OrganicRankSource, ResolvedOrganicRank };
export { resolveOrganicRank };
type PrismaDb = PrismaClient | Prisma.TransactionClient;
/**
 * Live global organic rank for one agent (detail fallback when DB rank is stale/zero).
 * Cohort: active, non-sentinel agents ordered by agentRankScore DESC.
 */
export async function computeLiveOrganicRank(
  prisma: PrismaDb,
  agentDbId: number,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ rn: bigint | number }>>`
    SELECT ranked.rn
    FROM (
      SELECT
        a.id,
        ROW_NUMBER() OVER (ORDER BY a."agentRankScore" DESC, a.id ASC) AS rn
      FROM "Agent" a
      WHERE a."isActive" = TRUE
        AND a."agentId" <> 88888
        AND a."chainId" > 0
        AND btrim(a.name) <> ''
        AND (
          btrim(a.description) <> ''
          OR btrim(a.image) <> ''
          OR EXISTS (
            SELECT 1 FROM "AgentMetadata" am
            WHERE am."agentId" = a.id
              AND (btrim(am.key) <> '' OR btrim(am.value) <> '')
          )
          OR EXISTS (
            SELECT 1 FROM "AgentService" svc
            WHERE svc."agentId" = a.id AND btrim(svc.name) <> ''
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "AgentBlocklistRule" rule
          WHERE rule.active = TRUE
            AND btrim(rule.value) <> ''
            AND (
              (rule."matchType" = 'name_contains' AND position(lower(rule.value) IN lower(a.name)) > 0)
              OR (rule."matchType" = 'name_exact' AND lower(btrim(a.name)) = lower(btrim(rule.value)))
              OR (rule."matchType" = 'uri_contains' AND position(lower(rule.value) IN lower(a."agentURI")) > 0)
              OR (rule."matchType" = 'uri_exact' AND a."agentURI" = rule.value)
              OR (rule."matchType" = 'owner_wallet' AND lower(btrim(a.owner)) = lower(btrim(rule.value)))
              OR (rule."matchType" = 'agent_key' AND btrim(rule.value) = a."chainId"::text || ':' || a."agentId"::text)
            )
        )
    ) ranked
    WHERE ranked.id = ${agentDbId}
  `;
  const rn = rows[0]?.rn;
  if (rn == null) return 0;
  const value = Number(rn);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export async function resolveAgentOrganicRank(
  prisma: PrismaDb,
  row: AgentRankableInput & {
    id: number;
    rank?: number | null;
  },
): Promise<ResolvedOrganicRank> {
  const rankable = isAgentRankable(row);
  const dbRank = Math.max(0, Number(row.rank ?? 0));
  if (!rankable) {
    return resolveOrganicRank({ dbRank, liveRank: 0, rankable: false });
  }
  if (dbRank > 0 || skipLiveOrganicRank()) {
    return resolveOrganicRank({ dbRank, liveRank: 0, rankable: true });
  }
  const liveRank = await computeLiveOrganicRank(prisma, row.id);
  return resolveOrganicRank({ dbRank, liveRank, rankable: true });
}
