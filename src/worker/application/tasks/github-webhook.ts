import { prisma } from "@/lib/db";
import {
  handleNormalizedGithubWebhookEvent,
  type NormalizedGithubWebhookEvent,
} from "@/lib/dashboard/github-sync";
import type { GithubWebhookPayload } from "@/jobs/contracts";
import { GITHUB_PROCESSING_STALE_MS, staleBefore } from "@/jobs/domain-lease";
const PROVIDER = "github";
function normalizedEvent(payload: GithubWebhookPayload): NormalizedGithubWebhookEvent {
  return {
    event: payload.event,
    action: payload.action,
    installationId: payload.installationId,
    repositories: payload.repositories,
    removedRepositories: payload.removedRepositories,
    repositoryFullName: payload.repositoryFullName,
  };
}
export async function processGithubWebhook(payload: GithubWebhookPayload) {
  const receipt = await prisma.webhookReceipt.findUnique({
    where: { provider_providerEventId: { provider: PROVIDER, providerEventId: payload.deliveryId } },
  });
  if (!receipt) return { ok: true, skipped: "receipt_missing" };
  if (receipt.payloadHash !== payload.payloadHash) {
    throw new Error(`GitHub webhook payload hash mismatch for delivery ${payload.deliveryId}`);
  }
  if (receipt.status === "processed") return { ok: true, skipped: "already_processed" };
  const staleCutoff = staleBefore(GITHUB_PROCESSING_STALE_MS);
  const claimedAt = new Date();
  const claimed = await prisma.webhookReceipt.updateMany({
    where: {
      id: receipt.id,
      payloadHash: payload.payloadHash,
      OR: [
        { status: { in: ["pending", "failed"] } },
        { status: "processing", processingAt: { lte: staleCutoff } },
      ],
    },
    data: {
      status: "processing",
      attempts: { increment: 1 },
      processingAt: claimedAt,
      processedAt: null,
      lastError: null,
    },
  });
  if (claimed.count !== 1) {
    throw new Error(`GitHub delivery ${payload.deliveryId} is already leased by another worker`);
  }
  try {
    const result = await handleNormalizedGithubWebhookEvent(normalizedEvent(payload));
    const completed = await prisma.webhookReceipt.updateMany({
      where: { id: receipt.id, status: "processing", processingAt: claimedAt },
      data: { status: "processed", processedAt: new Date(), lastError: null },
    });
    if (completed.count !== 1) {
      console.warn(`[github-webhook] Delivery ${payload.deliveryId} completed after its receipt lease changed`);
    }
    return { ok: true, ...result };
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    try {
      await prisma.webhookReceipt.updateMany({
        where: { id: receipt.id, status: "processing", processingAt: claimedAt },
        data: { status: "failed", lastError: message.slice(0, 10_000) },
      });
    } catch (persistError) {
      throw new AggregateError(
        [error, persistError],
        `GitHub delivery ${payload.deliveryId} and failure-state persistence both failed`,
      );
    }
    throw error;
  }
}
