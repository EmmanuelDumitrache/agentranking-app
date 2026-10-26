import { prisma } from "@/lib/db";
import { enqueueApplicationJobsInTx } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import { DOMAIN_DELIVERY_STALE_MS, staleBefore } from "@/jobs/domain-lease";
import { isPermanentOutboundTargetError, requestPublicHttp } from "@/lib/outbound-http";
import { validateWebhookUrl } from "@/lib/webhook-url";
function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
export async function fanoutMeshSignal(signalId: string) {
  const signal = await prisma.meshSignal.findUnique({ where: { id: signalId } });
  if (!signal) return { ok: true, skipped: "signal_missing" };
  const pageSize = 1_000;
  let cursor: string | undefined;
  let queued = 0;
  do {
    const subscriptions = await prisma.meshSubscription.findMany({
      where: {
        publisherAgentId: signal.publisherAgentId,
        isActive: true,
        webhookEndpoint: { not: "" },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: pageSize,
    });
    if (subscriptions.length === 0) break;
    queued += await prisma.$transaction(async (tx) => {
      const subscriptionIds = subscriptions.map((subscription) => subscription.id);
      const deliveries = await tx.meshSignalDelivery.createManyAndReturn({
        data: subscriptionIds.map((subscriptionId) => ({ signalId, subscriptionId })),
        skipDuplicates: true,
        select: { id: true },
      });
      await enqueueApplicationJobsInTx(
        tx,
        JOB_QUEUES.MESH_WEBHOOK_DELIVER,
        deliveries.map((delivery) => ({
          data: { v: 1 as const, id: delivery.id },
          singletonKey: delivery.id,
        })),
        { returnIds: false },
      );
      return deliveries.length;
    }, { maxWait: 10_000, timeout: 30_000 });
    cursor = subscriptions.at(-1)?.id;
    if (subscriptions.length < pageSize) break;
  } while (cursor);
  return { ok: true, queued };
}
export async function deliverMeshWebhook(deliveryId: string) {
  const claimStaleBefore = staleBefore(DOMAIN_DELIVERY_STALE_MS);
  type ClaimedMeshDelivery = {
    id: string;
    signalId: string;
    publisherAgentId: number;
    payload: unknown;
    signalType: string;
    timestamp: Date;
    subscriberAgentId: number;
    webhookEndpoint: string;
    subscriptionActive: boolean;
  };
  const [delivery] = await prisma.$queryRaw<ClaimedMeshDelivery[]>`
    WITH claimed AS (
      UPDATE mesh_signal_deliveries
      SET
        status = 'delivering',
        attempts = attempts + 1,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${deliveryId}
        AND (
          status IN ('pending', 'failed')
          OR (status = 'delivering' AND updated_at <= ${claimStaleBefore})
        )
      RETURNING id, signal_id, subscription_id
    )
    SELECT
      claimed.id,
      signal.id AS "signalId",
      signal."publisherAgentId" AS "publisherAgentId",
      signal.payload,
      signal."signalType" AS "signalType",
      signal.timestamp,
      subscription."subscriberAgentId" AS "subscriberAgentId",
      subscription."webhookEndpoint" AS "webhookEndpoint",
      subscription."isActive" AS "subscriptionActive"
    FROM claimed
    INNER JOIN "MeshSignal" AS signal ON signal.id = claimed.signal_id
    INNER JOIN "MeshSubscription" AS subscription ON subscription.id = claimed.subscription_id
  `;
  if (!delivery) {
    const current = await prisma.meshSignalDelivery.findUnique({
      where: { id: deliveryId },
      select: { status: true },
    });
    if (!current) return { ok: true, skipped: "missing" };
    if (current.status === "delivered" || current.status === "skipped") {
      return { ok: true, skipped: current.status };
    }
    throw new Error(`Mesh delivery ${deliveryId} is already leased by another worker`);
  }
  if (!delivery.subscriptionActive || !delivery.webhookEndpoint.trim()) {
    await prisma.meshSignalDelivery.update({ where: { id: deliveryId }, data: { status: "skipped", attempts: { decrement: 1 } } });
    return { ok: true, skipped: "subscription_inactive" };
  }
  const endpoint = delivery.webhookEndpoint.trim();
  if (!validateWebhookUrl(endpoint).ok) {
    const message = "Stored mesh webhook URL is no longer allowed";
    await prisma.meshSignalDelivery.update({
      where: { id: deliveryId },
      data: { status: "terminal_failed", lastError: message, lastHttpStatus: null },
    });
    return { ok: false, delivered: false, retryable: false, reason: "invalid_webhook_url" };
  }
  try {
    const response = await requestPublicHttp(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "AgentRanking-Mesh/1.0" },
      body: JSON.stringify({
        signalId: delivery.signalId,
        publisherAgentId: delivery.publisherAgentId,
        subscriberAgentId: delivery.subscriberAgentId,
        signalType: delivery.signalType,
        payload: delivery.payload,
        timestamp: delivery.timestamp.toISOString(),
      }),
      timeoutMs: 10_000,
      maxResponseBytes: 2_000,
      maxRedirects: 0,
    });
    if (response.status < 200 || response.status >= 300) {
      const message = `Webhook returned HTTP ${response.status}`;
      const retryable = shouldRetryStatus(response.status);
      await prisma.meshSignalDelivery.update({
        where: { id: deliveryId },
        data: {
          status: retryable ? "failed" : "terminal_failed",
          lastHttpStatus: response.status,
          lastError: message,
        },
      });
      if (retryable) throw new Error(message);
      return { ok: false, delivered: false, httpStatus: response.status, retryable: false };
    }
    await prisma.meshSignalDelivery.update({
      where: { id: deliveryId },
      data: { status: "delivered", lastHttpStatus: response.status, deliveredAt: new Date(), lastError: null },
    });
    return { ok: true, delivered: true, httpStatus: response.status, responseTruncated: response.truncated };
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    if (isPermanentOutboundTargetError(error)) {
      await prisma.meshSignalDelivery.update({
        where: { id: deliveryId },
        data: { status: "terminal_failed", lastError: message.slice(0, 10_000), lastHttpStatus: null },
      });
      return { ok: false, delivered: false, retryable: false, reason: "target_rejected" };
    }
    const status = /HTTP (\d{3})/.exec(message)?.[1];
    try {
      await prisma.meshSignalDelivery.update({
        where: { id: deliveryId },
        data: {
          status: "failed",
          lastError: message.slice(0, 10_000),
          lastHttpStatus: status ? Number(status) : null,
        },
      });
    } catch (stateError) {
      throw new AggregateError(
        [error, stateError],
        "Mesh delivery failed and its failure state could not be persisted",
      );
    }
    throw error;
  }
}
