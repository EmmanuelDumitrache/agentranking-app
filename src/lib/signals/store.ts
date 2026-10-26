import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { DerivedSignal } from "@/lib/signals/types";

function toJsonValue(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : value as Prisma.InputJsonValue;
}

function nullableDate(value: Date | null | undefined): Date | null | undefined {
  return value === undefined ? undefined : value;
}

type SignalStoreClient = Pick<Prisma.TransactionClient, "agentVerificationSignal">;

export async function upsertAgentSignals(
  agentId: number,
  signals: DerivedSignal[],
  db: SignalStoreClient = prisma,
) {
  for (const signal of signals) {
    const payloadJson = toJsonValue(signal.payloadJson);
    const verifiedAt = nullableDate(signal.verifiedAt);
    const lastCheckedAt = nullableDate(signal.lastCheckedAt);
    const expiresAt = nullableDate(signal.expiresAt);
    await db.agentVerificationSignal.upsert({
      where: {
        agentId_signalType: { agentId, signalType: signal.signalType },
      },
      create: {
        agentId,
        signalType: signal.signalType,
        status: signal.status,
        source: signal.source,
        confidence: signal.confidence,
        value: signal.value ?? "",
        payloadJson,
        evidenceUrl: signal.evidenceUrl ?? "",
        verifiedAt,
        lastCheckedAt,
        expiresAt,
      },
      update: {
        status: signal.status,
        source: signal.source,
        confidence: signal.confidence,
        value: signal.value ?? "",
        payloadJson,
        evidenceUrl: signal.evidenceUrl ?? "",
        verifiedAt,
        lastCheckedAt,
        expiresAt,
      },
    });
  }
}

export async function listAgentSignals(agentId: number) {
  return prisma.agentVerificationSignal.findMany({
    where: { agentId },
    orderBy: { signalType: "asc" },
  });
}
