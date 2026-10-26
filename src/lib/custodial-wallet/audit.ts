import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
export async function logCustodialWalletAudit(
  walletId: string,
  action: string,
  options?: {
    actorProfileId?: number;
    metadata?: Prisma.InputJsonValue;
    tx?: Prisma.TransactionClient;
  },
): Promise<void> {
  const client = options?.tx ?? prisma;
  await client.custodialWalletAudit.create({
    data: {
      walletId,
      action,
      actorProfileId: options?.actorProfileId,
      metadataJson: options?.metadata,
    },
  });
}