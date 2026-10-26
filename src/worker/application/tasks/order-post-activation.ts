import { prisma } from "@/lib/db";
import { createDashboardAccount } from "@/lib/dashboard/auth";
import { createReferralCommission } from "@/lib/referral-commission";
import { syncDerivedSignalsForAgent } from "@/lib/signals/derive";
import { getJobProducer } from "@/jobs/boss";
import { NOTIFICATION_KINDS, queueNotificationInTx } from "@/lib/notification-delivery";
import { DOMAIN_DELIVERY_STALE_MS, staleBefore } from "@/jobs/domain-lease";
export async function orderPostActivationJob(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { ok: true, skipped: "order_missing" };
  if (order.status !== "paid") return { ok: true, skipped: `order_${order.status}` };
  const claimStaleBefore = staleBefore(DOMAIN_DELIVERY_STALE_MS);
  const [claimed] = await prisma.$queryRaw<Array<{ orderId: string }>>`
    INSERT INTO order_post_activations (
      order_id, status, attempts, created_at, updated_at
    )
    VALUES (${orderId}, 'processing', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (order_id) DO UPDATE SET
      status = 'processing',
      attempts = order_post_activations.attempts + 1,
      last_error = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE order_post_activations.status IN ('pending', 'failed')
      OR (
        order_post_activations.status = 'processing'
        AND order_post_activations.updated_at <= ${claimStaleBefore}
      )
    RETURNING order_id AS "orderId"
  `;
  if (!claimed) {
    const receipt = await prisma.orderPostActivation.findUnique({
      where: { orderId },
      select: { status: true },
    });
    if (receipt?.status === "completed") return { ok: true, skipped: "already_completed" };
    throw new Error(`Order post-activation ${orderId} is already leased by another worker`);
  }
  try {
    if (
      (order.productType === "kya_verify" || order.productType === "verification_bundle") &&
      order.agentId
    ) {
      await syncDerivedSignalsForAgent(order.agentId);
    }
    if (
      (order.productType === "kya_verify" || order.productType === "verification_bundle") &&
      order.email
    ) {
      const account = await createDashboardAccount({
        id: order.id,
        email: order.email,
        wallet: order.wallet,
        agentId: order.agentId,
        productType: order.productType,
      });
      await getJobProducer();
      await prisma.$transaction((tx) => queueNotificationInTx(tx, {
        idempotencyKey: `order:${order.id}:dashboard-claim`,
        kind: NOTIFICATION_KINDS.DASHBOARD_CLAIM,
        recipient: order.email,
        payload: { profileId: account.profileId },
      }));
    }
    const refCode = order.referralCode.trim();
    if (refCode) {
      await createReferralCommission(order, refCode, `order:${order.id}`);
    }
    if (order.email) {
      await getJobProducer();
      await prisma.$transaction((tx) => queueNotificationInTx(tx, {
        idempotencyKey: `order:${order.id}:confirmed`,
        kind: NOTIFICATION_KINDS.ORDER_CONFIRMED,
        recipient: order.email,
        payload: { orderId: order.id },
      }));
    }
    await prisma.orderPostActivation.update({
      where: { orderId },
      data: { status: "completed", completedAt: new Date(), lastError: null },
    });
    return { ok: true, processed: true };
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    try {
      await prisma.orderPostActivation.update({
        where: { orderId },
        data: { status: "failed", lastError: message.slice(0, 10_000) },
      });
    } catch (persistError) {
      throw new AggregateError(
        [error, persistError],
        `Order post-activation ${orderId} and failure-state persistence both failed`,
      );
    }
    throw error;
  }
}
