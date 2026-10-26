import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  ADMIN_LAYER_ACTIVITY_KEY,
  ADMIN_LAYER_PROFILE_KEY,
  ADMIN_LAYER_PROTOCOL_TRUST_KEY,
  ADMIN_LAYER_REPUTATION_KEY,
  type AdminScoringLayerKey,
  ADMIN_SCORING_LAYER_KEYS,
  adminScoringLayerMetaKey,
  parseAdminScoringLayerOverrides,
} from "@/lib/admin-scoring-layer-overrides";
const LAYER_DB_KEYS = [
  ADMIN_LAYER_PROFILE_KEY,
  ADMIN_LAYER_PROTOCOL_TRUST_KEY,
  ADMIN_LAYER_REPUTATION_KEY,
  ADMIN_LAYER_ACTIVITY_KEY,
] as const;
const DB_KEY_TO_LAYER: Record<string, AdminScoringLayerKey> = {
  [ADMIN_LAYER_PROFILE_KEY]: "profile",
  [ADMIN_LAYER_PROTOCOL_TRUST_KEY]: "protocolTrust",
  [ADMIN_LAYER_REPUTATION_KEY]: "reputation",
  [ADMIN_LAYER_ACTIVITY_KEY]: "activity",
};
type SqlRead = Pick<PrismaClient, "$queryRaw">;
type SqlWrite = Pick<PrismaClient, "$executeRaw">;
export async function loadAdminScoringLayerOverridesFromDb(
  db: SqlRead,
  agentPk: number,
): Promise<Partial<Record<AdminScoringLayerKey, number>>> {
  const rows = await db.$queryRaw<{ key: string; value: string }[]>`
    SELECT "key", "value"
    FROM "AgentMetadata"
    WHERE "agentId" = ${agentPk}
      AND "key" IN (${Prisma.join([...LAYER_DB_KEYS])})
  `;
  const out: Partial<Record<AdminScoringLayerKey, number>> = {};
  for (const r of rows) {
    const layer = DB_KEY_TO_LAYER[r.key];
    if (!layer) continue;
    const n = Number(r.value);
    if (!Number.isFinite(n)) continue;
    out[layer] = Math.max(0, Math.min(100, Math.round(n)));
  }
  return out;
}
export async function mergedScoringLayerOverridesForAgent(
  db: SqlRead,
  agentPk: number,
  metadataRows: Array<{ key: string; value: string }> | null | undefined,
): Promise<Partial<Record<AdminScoringLayerKey, number>>> {
  const fromMeta = parseAdminScoringLayerOverrides(metadataRows);
  const fromSql = await loadAdminScoringLayerOverridesFromDb(db, agentPk);
  return { ...fromMeta, ...fromSql };
}
export async function applyAdminScoringLayerOverridesSql(
  db: SqlWrite,
  agentPk: number,
  patch: Partial<Record<AdminScoringLayerKey, number | null>>,
): Promise<void> {
  for (const layer of ADMIN_SCORING_LAYER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, layer)) continue;
    const val = patch[layer];
    const key = adminScoringLayerMetaKey(layer);
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
export async function deleteAllAdminScoringLayerOverrideRows(
  db: SqlWrite,
  agentPk: number,
): Promise<void> {
  await db.$executeRaw`
    DELETE FROM "AgentMetadata"
    WHERE "agentId" = ${agentPk}
      AND "key" IN (${Prisma.join([...LAYER_DB_KEYS])})
  `;
}