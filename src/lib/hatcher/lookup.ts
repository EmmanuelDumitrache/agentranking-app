import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import { HATCHER_ID_METADATA_KEY } from "@/lib/hatcher/config";
/**
 * Resolve internal Agent.id from Hatcher Explore id (AgentMetadata `hatcher_id`).
 */
export async function lookupAgentDbIdByHatcherId(
  hatcherId: string,
  tx?: Prisma.TransactionClient,
): Promise<number | null> {
  const id = hatcherId.trim();
  if (!id) return null;
  const client = tx ?? prisma;
  const row = await client.agentMetadata.findFirst({
    where: { key: HATCHER_ID_METADATA_KEY, value: id },
    select: { agentId: true },
  });
  return row?.agentId ?? null;
}
/** Load agent DB id with transient pool retry (public API / reputation check). */
export async function lookupAgentDbIdByHatcherIdWithRetry(
  hatcherId: string,
): Promise<number | null> {
  return withTransientPoolRetry(() => lookupAgentDbIdByHatcherId(hatcherId));
}