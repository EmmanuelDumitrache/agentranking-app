import type { Prisma } from "@/generated/prisma/client";
import { publishAgentAlertEventInTx } from "@/lib/agent-alert-events";

type RecordTrustEventInput = {
  agentId: number;
  eventType: string;
  scoreDelta?: number;
  evidenceUrl?: string;
  onChainTx?: string;
  eventKey: string;
  timestamp?: Date;
};

export async function recordTrustEventInTx(
  tx: Prisma.TransactionClient,
  input: RecordTrustEventInput,
): Promise<string> {
  const timestamp = input.timestamp ?? new Date();
  const event = await tx.trustEvent.upsert({
    where: { eventKey: input.eventKey },
    create: {
      agentId: input.agentId,
      eventType: input.eventType,
      scoreDelta: input.scoreDelta ?? 0,
      evidenceUrl: input.evidenceUrl ?? "",
      onChainTx: input.onChainTx ?? "",
      eventKey: input.eventKey,
      timestamp,
    },
    update: {},
    select: { id: true },
  });

  await publishAgentAlertEventInTx(tx, {
    agentId: input.agentId,
    eventType: input.eventType,
    eventKey: `trust:${input.eventKey}`,
    occurredAt: timestamp,
    payload: {
      trustEventId: event.id,
      eventType: input.eventType,
      scoreDelta: input.scoreDelta ?? 0,
      evidenceUrl: input.evidenceUrl ?? "",
      onChainTx: input.onChainTx ?? "",
    },
  });
  return event.id;
}
