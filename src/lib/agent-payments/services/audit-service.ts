import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export async function writeAuditLog(params: {
  appAccountId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.treasuryAuditLog.create({
    data: {
      appAccountId: params.appAccountId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}
