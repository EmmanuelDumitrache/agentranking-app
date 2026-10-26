import type { PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
/** Row shape from raw SQL — works even when Prisma Client was generated before these columns existed. */
export type AgentPublicReferralScalarsRow = {
  public_referral_code: string | null;
  public_referral_destination: string;
  public_referral_info: string;
};
type AgentPublicReferralScalarsRowWithId = AgentPublicReferralScalarsRow & { id: number };
export async function loadAgentPublicReferralScalars(
  db: Pick<PrismaClient, "$queryRaw">,
  agentDbId: number,
): Promise<AgentPublicReferralScalarsRow | null> {
  const rows = await db.$queryRaw<AgentPublicReferralScalarsRow[]>`
    SELECT "public_referral_code", "public_referral_destination", "public_referral_info"
    FROM "Agent"
    WHERE id = ${agentDbId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}
/** Batch load for dashboard lists (My Agents, Referrals). */
export async function loadAgentPublicReferralScalarsBulk(
  db: Pick<PrismaClient, "$queryRaw">,
  agentDbIds: readonly number[],
): Promise<Map<number, AgentPublicReferralScalarsRow>> {
  const map = new Map<number, AgentPublicReferralScalarsRow>();
  if (agentDbIds.length === 0) return map;
  const rows = await db.$queryRaw<AgentPublicReferralScalarsRowWithId[]>`
    SELECT id, "public_referral_code", "public_referral_destination", "public_referral_info"
    FROM "Agent"
    WHERE id IN (${Prisma.join(agentDbIds)})
  `;
  for (const r of rows) {
    map.set(r.id, {
      public_referral_code: r.public_referral_code,
      public_referral_destination: r.public_referral_destination,
      public_referral_info: r.public_referral_info,
    });
  }
  return map;
}
/** Persist referral columns via raw SQL (same reliability as admin PATCH). */
export async function writeAgentPublicReferralScalars(
  db: Pick<PrismaClient, "$executeRaw">,
  agentDbId: number,
  scalars: { code: string | null; destination: string; info: string },
): Promise<void> {
  await db.$executeRaw`
    UPDATE "Agent"
    SET
      "public_referral_code" = ${scalars.code},
      "public_referral_destination" = ${scalars.destination},
      "public_referral_info" = ${scalars.info}
    WHERE id = ${agentDbId}
  `;
}
export function isPostgresUniqueViolation(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return true;
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2010") {
    const m = `${e.message}${JSON.stringify(e.meta ?? {})}`;
    return m.includes("23505") || m.toLowerCase().includes("unique");
  }
  return false;
}
export function mergePublicReferralScalarsIntoRecord<T extends object>(
  record: T,
  row: AgentPublicReferralScalarsRow | null,
): T {
  if (!row) return record;
  return {
    ...record,
    publicReferralCode: row.public_referral_code,
    publicReferralDestination: row.public_referral_destination ?? "",
    publicReferralInfo: row.public_referral_info ?? "",
  };
}