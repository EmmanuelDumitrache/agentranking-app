import { prisma } from "@/lib/db";
import { settleDeposit } from "@/lib/llm-credits/settlement";
import { NOTIFICATION_KINDS, queueNotificationInTx } from "@/lib/notification-delivery";
import { releaseBountyIfDue } from "./bounty-auto-release";
export async function bountyAutoReleaseJob(bountyId: string) {
  const result = await releaseBountyIfDue(bountyId);
  return result ?? { ok: true, skipped: true };
}
export async function expireLlmDepositJob(depositId: string) {
  const result = await prisma.llmCreditDeposit.updateMany({
    where: { id: depositId, status: { in: ["CREATED", "AWAITING_PAYMENT"] }, quoteExpiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
  return { ok: true, expired: result.count === 1 };
}
const RETRYABLE_DEPOSIT_REASONS = new Set([
  "no_transaction_found",
  "rpc_error",
  "transaction_not_found",
  "transaction_not_confirmed",
]);
export async function reconcileLlmDepositJob(depositId: string) {
  const result = await settleDeposit(depositId);
  if (!result.ok && RETRYABLE_DEPOSIT_REASONS.has(result.reason)) {
    throw new Error(`Deposit ${depositId} is not settleable yet: ${result.reason}`);
  }
  return result;
}
export async function expireOrderJob(orderId: string) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const [expired] = await tx.$queryRaw<Array<{ email: string }>>`
      UPDATE "Order"
      SET status = 'expired'
      WHERE id = ${orderId}
        AND status = 'pending'
        AND "expiresAt" <= ${now}
      RETURNING email
    `;
    if (!expired) {
      const current = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true, expiresAt: true },
      });
      if (!current) return { ok: true, skipped: "order_missing" };
      if (current.status !== "pending") return { ok: true, skipped: `order_${current.status}` };
      if (current.expiresAt > now) throw new Error(`Order ${orderId} expiration job ran before expiresAt`);
      return { ok: true, expired: false };
    }
    const recipient = expired.email.trim();
    if (recipient) {
      await queueNotificationInTx(tx, {
        idempotencyKey: `order:${orderId}:expired`,
        kind: NOTIFICATION_KINDS.ORDER_EXPIRED,
        recipient,
        payload: { orderId },
      });
    }
    return { ok: true, expired: true, notificationQueued: Boolean(recipient) };
  });
}
