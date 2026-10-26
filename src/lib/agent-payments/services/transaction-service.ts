import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export type TransactionFilters = {
  appAccountId: string;
  agentId?: number;
  merchant?: string;
  status?: string;
  category?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
};

export async function listTransactions(filters: TransactionFilters) {
  const where: Prisma.TreasuryTransactionWhereInput = {
    appAccountId: filters.appAccountId,
    ...(filters.agentId !== undefined ? { agentId: filters.agentId } : {}),
    ...(filters.merchant
      ? { merchant: { contains: filters.merchant, mode: "insensitive" } }
      : {}),
    ...(filters.status
      ? { status: filters.status as Prisma.EnumTreasuryTxStatusFilter["equals"] }
      : {}),
    ...(filters.category
      ? { category: { equals: filters.category, mode: "insensitive" } }
      : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };

  const take = Math.min(filters.limit ?? 50, 100);
  const skip = filters.offset ?? 0;

  const [items, total] = await Promise.all([
    prisma.treasuryTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: {
        agent: { select: { id: true, name: true } },
      },
    }),
    prisma.treasuryTransaction.count({ where }),
  ]);

  return { items, total, limit: take, offset: skip };
}
