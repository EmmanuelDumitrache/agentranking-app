import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  ADMIN_TRUST_DIM_COMPLIANCE_KEY,
  ADMIN_TRUST_DIM_ENDPOINTS_KEY,
  ADMIN_TRUST_DIM_FRESHNESS_KEY,
  ADMIN_TRUST_DIM_METADATA_KEY,
  ADMIN_TRUST_DIM_POPULARITY_KEY,
  ADMIN_TRUST_DIM_QUALITY_KEY,
  ADMIN_TRUST_DIM_SOCIAL_KEY,
  ADMIN_TRUST_DIM_VERIFIED_REVENUE_KEY,
  type AdminTrustDimensionKey,
  ADMIN_TRUST_DIMENSION_KEYS,
  adminTrustDimensionMetaKey,
  parseAdminTrustDimensionOverrides,
} from "@/lib/admin-trust-dimension-overrides";
const TRUST_DIM_DB_KEYS = [
  ADMIN_TRUST_DIM_METADATA_KEY,
  ADMIN_TRUST_DIM_ENDPOINTS_KEY,
  ADMIN_TRUST_DIM_SOCIAL_KEY,
  ADMIN_TRUST_DIM_COMPLIANCE_KEY,
  ADMIN_TRUST_DIM_QUALITY_KEY,
  ADMIN_TRUST_DIM_POPULARITY_KEY,
  ADMIN_TRUST_DIM_FRESHNESS_KEY,
  ADMIN_TRUST_DIM_VERIFIED_REVENUE_KEY,
] as const;
const DB_KEY_TO_DIM: Record<string, AdminTrustDimensionKey> = {
  [ADMIN_TRUST_DIM_METADATA_KEY]: "metadata",
  [ADMIN_TRUST_DIM_ENDPOINTS_KEY]: "endpoints",
  [ADMIN_TRUST_DIM_SOCIAL_KEY]: "social",
  [ADMIN_TRUST_DIM_COMPLIANCE_KEY]: "compliance",
  [ADMIN_TRUST_DIM_QUALITY_KEY]: "quality",
  [ADMIN_TRUST_DIM_POPULARITY_KEY]: "popularity",
  [ADMIN_TRUST_DIM_FRESHNESS_KEY]: "freshness",
  [ADMIN_TRUST_DIM_VERIFIED_REVENUE_KEY]: "verifiedRevenue",
};
type SqlRead = Pick<PrismaClient, "$queryRaw">;
type SqlWrite = Pick<PrismaClient, "$executeRaw">;
/** Reliable read — admin list uses metadata take(300) and can omit these rows. */
export async function loadAdminTrustDimensionOverridesFromDb(
  db: SqlRead,
  agentPk: number,
): Promise<Partial<Record<AdminTrustDimensionKey, number>>> {
  const rows = await db.$queryRaw<{ key: string; value: string }[]>`
    SELECT "key", "value"
    FROM "AgentMetadata"
    WHERE "agentId" = ${agentPk}
      AND "key" IN (${Prisma.join([...TRUST_DIM_DB_KEYS])})
  `;
  const out: Partial<Record<AdminTrustDimensionKey, number>> = {};
  for (const r of rows) {
    const dim = DB_KEY_TO_DIM[r.key];
    if (!dim) continue;
    const n = Number(r.value);
    if (!Number.isFinite(n)) continue;
    out[dim] = Math.max(0, Math.min(100, Math.round(n)));
  }
  return out;
}
export async function mergedTrustDimensionOverridesForAgent(
  db: SqlRead,
  agentPk: number,
  metadataRows: Array<{ key: string; value: string }> | null | undefined,
): Promise<Partial<Record<AdminTrustDimensionKey, number>>> {
  const fromMeta = parseAdminTrustDimensionOverrides(metadataRows);
  const fromSql = await loadAdminTrustDimensionOverridesFromDb(db, agentPk);
  return { ...fromMeta, ...fromSql };
}
/**
 * Raw SQL upsert pattern — DELETE then INSERT (no unique on agentId+key).
 * Values: number 0–100, or null to remove override rows only.
 */
export async function applyAdminTrustDimensionOverridesSql(
  db: SqlWrite,
  agentPk: number,
  patch: Partial<Record<AdminTrustDimensionKey, number | null>>,
): Promise<void> {
  for (const dim of ADMIN_TRUST_DIMENSION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, dim)) continue;
    const val = patch[dim];
    const key = adminTrustDimensionMetaKey(dim);
    await db.$executeRaw`
      DELETE FROM "AgentMetadata"
      WHERE "agentId" = ${agentPk} AND "key" = ${key}
    `;
    if (val !== null && typeof val === "number" && Number.isFinite(val)) {
      const str = String(Math.max(0, Math.min(100, Math.round(val))));
      await db.$executeRaw`
        INSERT INTO "AgentMetadata" ("agentId", "key", "value")
        VALUES (${agentPk}, ${key}, ${str})
      `;
    }
  }
}
export async function deleteAllAdminTrustDimensionOverrideRows(db: SqlWrite, agentPk: number): Promise<void> {
  await db.$executeRaw`
    DELETE FROM "AgentMetadata"
    WHERE "agentId" = ${agentPk}
      AND "key" IN (${Prisma.join([...TRUST_DIM_DB_KEYS])})
  `;
}