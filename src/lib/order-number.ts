import type { Prisma } from "@/generated/prisma/client";

export type OrderType = "P" | "A" | "S" | "Q" | "B" | "VR" | "VB"; // VB = verification bundle (KYA + verified revenue)

function orderDateKey(at: Date): string {
  return at.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Generate a human-readable order number: AR-{type}-YYYYMMDD-NNNN
 * Prefix AR = AgentRanking. Type P or A. Date for reference. NNNN = zero-padded id.
 */
export function generateOrderNumber(
  id: number,
  type: OrderType = "P",
  at = new Date(),
): string {
  const date = orderDateKey(at);
  const padded = String(id).padStart(4, "0");
  return `AR-${type}-${date}-${padded}`;
}

/**
 * Allocate the next daily Order number inside the caller's transaction.
 *
 * The transaction-scoped advisory lock serializes all product prefixes for the
 * UTC date, preserving the existing single daily sequence. Taking the maximum
 * surviving suffix instead of counting rows also prevents number reuse after
 * an order has been deleted.
 */
export async function allocateOrderNumber(
  tx: Prisma.TransactionClient,
  type: OrderType = "P",
  at = new Date(),
): Promise<string> {
  const date = orderDateKey(at);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`order-number:${date}`}, 0))`;
  const pattern = `^AR-[A-Z]+-${date}-([0-9]+)$`;
  const rows = await tx.$queryRaw<Array<{ maxSequence: bigint }>>`
    SELECT COALESCE(
      MAX((SUBSTRING("orderNumber" FROM ${pattern}))::bigint),
      0::bigint
    ) AS "maxSequence"
    FROM "Order"
    WHERE "orderNumber" LIKE ${`AR-%-${date}-%`}
  `;
  const next = (rows[0]?.maxSequence ?? 0n) + 1n;
  if (next > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Daily order number sequence exceeds the safe integer domain");
  }
  return generateOrderNumber(Number(next), type, at);
}
