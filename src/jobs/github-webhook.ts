import { prisma } from "@/lib/db";
import { getJobProducer } from "./boss";
import { enqueueApplicationJobInTx } from "./producer";
import { JOB_QUEUES } from "./queues";
import type { GithubWebhookPayload } from "./contracts";
import { GITHUB_PROCESSING_STALE_MS, staleBefore } from "./domain-lease";

const PROVIDER = "github";

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

export async function enqueueGithubWebhook(
  payload: GithubWebhookPayload,
): Promise<{ accepted: boolean; duplicate: boolean; state: string }> {
  await getJobProducer();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.webhookReceipt.create({
        data: {
          provider: PROVIDER,
          providerEventId: payload.deliveryId,
          payloadHash: payload.payloadHash,
          status: "pending",
          attempts: 0,
          processingAt: new Date(),
        },
      });
      await enqueueApplicationJobInTx(
        tx,
        JOB_QUEUES.GITHUB_WEBHOOK_PROCESS,
        payload,
        { singletonKey: payload.deliveryId },
      );
    });
    return { accepted: true, duplicate: false, state: "pending" };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  const existing = await prisma.webhookReceipt.findUnique({
    where: { provider_providerEventId: { provider: PROVIDER, providerEventId: payload.deliveryId } },
  });
  if (!existing) throw new Error(`GitHub webhook receipt ${payload.deliveryId} disappeared after a uniqueness conflict`);
  if (existing.payloadHash !== payload.payloadHash) {
    throw new Error(`GitHub delivery ${payload.deliveryId} was reused with a different payload`);
  }
  if (existing.status === "processed" || existing.status === "pending") {
    return { accepted: true, duplicate: true, state: existing.status };
  }

  const staleCutoff = staleBefore(GITHUB_PROCESSING_STALE_MS);
  if (existing.status === "processing" && existing.processingAt > staleCutoff) {
    return { accepted: true, duplicate: true, state: "processing" };
  }

  const requeued = await prisma.$transaction(async (tx) => {
    const reset = await tx.webhookReceipt.updateMany({
      where: {
        id: existing.id,
        payloadHash: payload.payloadHash,
        OR: [
          { status: "failed" },
          { status: "processing", processingAt: { lte: staleCutoff } },
        ],
      },
      data: { status: "pending", lastError: null, processedAt: null },
    });
    if (reset.count !== 1) return false;
    await enqueueApplicationJobInTx(
      tx,
      JOB_QUEUES.GITHUB_WEBHOOK_PROCESS,
      payload,
      { singletonKey: payload.deliveryId },
    );
    return true;
  });

  return requeued
    ? { accepted: true, duplicate: true, state: "requeued" }
    : { accepted: true, duplicate: true, state: existing.status };
}
