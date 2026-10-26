import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getJobProducer } from "@/jobs/boss";
import { enqueueApplicationJobInTx } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
type PublishAgentAlertEventInput = {
  agentId: number | null;
  eventType: string;
  eventKey: string;
  payload: Prisma.InputJsonValue;
  occurredAt?: Date;
};
export async function publishAgentAlertEventInTx(
  tx: Prisma.TransactionClient,
  input: PublishAgentAlertEventInput,
): Promise<string> {
  const event = await tx.agentAlertEvent.upsert({
    where: { eventKey: input.eventKey },
    create: {
      agentId: input.agentId,
      eventType: input.eventType,
      eventKey: input.eventKey,
      payload: input.payload,
      occurredAt: input.occurredAt ?? new Date(),
    },
    update: {},
    select: { id: true },
  });
  await enqueueApplicationJobInTx(
    tx,
    JOB_QUEUES.ALERT_EVALUATE,
    { v: 1, id: event.id },
    { singletonKey: event.id },
  );
  return event.id;
}
export async function queueAgentAlertTestDelivery(
  ruleId: number,
  userProfileId: number,
): Promise<{ eventId: string; deliveryId: string } | null> {
  await getJobProducer();
  return prisma.$transaction(async (tx) => {
    const rule = await tx.agentAlertRule.findFirst({
      where: { id: ruleId, userProfileId },
      select: { id: true, agentId: true },
    });
    if (!rule) return null;
    const event = await tx.agentAlertEvent.create({
      data: {
        agentId: rule.agentId,
        eventType: "agentranking.alert.test",
        eventKey: `alert-test:${rule.id}:${randomUUID()}`,
        payload: {
          source: "agentranking.io",
          note: "Durable AgentRanking alert test delivery.",
        },
        occurredAt: new Date(),
      },
      select: { id: true },
    });
    const delivery = await tx.agentAlertDelivery.create({
      data: { eventId: event.id, ruleId: rule.id },
      select: { id: true },
    });
    await enqueueApplicationJobInTx(
      tx,
      JOB_QUEUES.ALERT_WEBHOOK_DELIVER,
      { v: 1, id: delivery.id },
      { singletonKey: delivery.id },
    );
    return { eventId: event.id, deliveryId: delivery.id };
  });
}