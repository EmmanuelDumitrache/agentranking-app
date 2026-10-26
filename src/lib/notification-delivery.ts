import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { sendClaimEmail, sendSubscriptionLapsedEmail, sendSubscriptionReminderEmail } from "@/lib/dashboard/auth";
import { sendBountyClaimed, sendOrderConfirmed, sendOrderCreated, sendOrderExpired } from "@/lib/email";
import { enqueueApplicationJobInTx } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import { isPermanentOutboundTargetError, requestPublicHttp } from "@/lib/outbound-http";
import { validateWebhookUrl } from "@/lib/webhook-url";
import { DOMAIN_DELIVERY_STALE_MS, staleBefore } from "@/jobs/domain-lease";
import {
  isRetryableNotificationHttpStatus,
  isTerminalNotificationHttpStatus,
} from "@/lib/notification-delivery-policy";
export const NOTIFICATION_KINDS = {
  ORDER_CREATED: "order_created",
  ORDER_CONFIRMED: "order_confirmed",
  ORDER_EXPIRED: "order_expired",
  BOUNTY_CLAIMED: "bounty_claimed",
  SUBSCRIPTION_EXPIRING: "subscription_expiring",
  SUBSCRIPTION_LAPSED: "subscription_lapsed",
  DASHBOARD_CLAIM: "dashboard_claim",
  PROMO_CONFIRMATION: "promo_confirmation",
  AD_ORDER_CONFIRMATION: "ad_order_confirmation",
  KYA_CONFIRMATION: "kya_confirmation",
  SAP_AGENT_INDEXED_WEBHOOK: "sap_agent_indexed_webhook",
  SAP_AGENT_INDEXED_TELEGRAM: "sap_agent_indexed_telegram",
} as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[keyof typeof NOTIFICATION_KINDS];
export type QueueNotificationInput = {
  idempotencyKey: string;
  channel?: "email" | "webhook" | "telegram";
  kind: NotificationKind;
  recipient: string;
  payload: Prisma.InputJsonValue;
};
export async function queueNotificationInTx(
  tx: Prisma.TransactionClient,
  input: QueueNotificationInput,
): Promise<string> {
  const delivery = await tx.notificationDelivery.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: {
      idempotencyKey: input.idempotencyKey,
      channel: input.channel ?? "email",
      kind: input.kind,
      recipient: input.recipient,
      payload: input.payload,
    },
    update: {},
    select: { id: true },
  });
  await enqueueApplicationJobInTx(tx, JOB_QUEUES.NOTIFICATION_DELIVER, { v: 1, id: delivery.id }, {
    singletonKey: delivery.id,
  });
  return delivery.id;
}
function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
function stringValue(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}
async function requireSuccessfulSend(
  result: { sent: boolean; error?: string },
  deliveryId: string,
): Promise<void> {
  if (!result.sent) throw new Error(`Notification ${deliveryId} was not sent: ${result.error ?? "unknown email provider failure"}`);
}
class TerminalNotificationDeliveryError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
    readonly responsePreview: string | null,
  ) {
    super(message);
    this.name = "TerminalNotificationDeliveryError";
  }
}
function truncateResponse(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 4_000) : null;
}
async function fetchNotificationTarget(
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string; truncated: boolean }> {
  const response = await requestPublicHttp(url, {
    ...init,
    timeoutMs: 10_000,
    maxResponseBytes: 4_000,
    maxRedirects: 0,
  });
  return { status: response.status, body: response.body, truncated: response.truncated };
}
async function deliverSapWebhook(
  recipient: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; responsePreview: string | null }> {
  if (!validateWebhookUrl(recipient).ok) {
    throw new TerminalNotificationDeliveryError("Stored SAP webhook URL is not allowed", null, null);
  }
  let result: Awaited<ReturnType<typeof fetchNotificationTarget>>;
  try {
    result = await fetchNotificationTarget(recipient, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "sap_agent_indexed", agent: payload }),
    });
  } catch (error) {
    if (isPermanentOutboundTargetError(error)) {
      throw new TerminalNotificationDeliveryError(error.message, null, null);
    }
    throw error;
  }
  const preview = truncateResponse(result.body);
  if (result.status < 200 || result.status >= 300) {
    const message = `SAP webhook returned HTTP ${result.status}`;
    if (!isRetryableNotificationHttpStatus(result.status)) {
      throw new TerminalNotificationDeliveryError(message, result.status, preview);
    }
    throw new Error(`${message}: ${preview ?? "empty response"}`);
  }
  return { status: result.status, responsePreview: preview };
}
async function deliverSapTelegram(
  recipient: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; responsePreview: string | null }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured in the worker");
  const result = await fetchNotificationTarget(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: recipient,
        text: stringValue(payload, "message"),
        disable_web_page_preview: false,
      }),
    },
  );
  const preview = truncateResponse(result.body);
  let telegramOk = false;
  try {
    telegramOk = Boolean((JSON.parse(result.body) as { ok?: unknown }).ok);
  } catch {
    telegramOk = false;
  }
  if (result.status < 200 || result.status >= 300 || !telegramOk) {
    const message = `Telegram notification failed with HTTP ${result.status}`;
    if (isTerminalNotificationHttpStatus(result.status)) {
      throw new TerminalNotificationDeliveryError(message, result.status, preview);
    }
    throw new Error(`${message}: ${preview ?? "empty response"}`);
  }
  return { status: result.status, responsePreview: preview };
}
export async function deliverNotification(deliveryId: string) {
  const claimStaleBefore = staleBefore(DOMAIN_DELIVERY_STALE_MS);
  type ClaimedNotification = {
    id: string;
    kind: string;
    recipient: string;
    payload: Prisma.JsonValue;
  };
  const [delivery] = await prisma.$queryRaw<ClaimedNotification[]>`
    UPDATE notification_deliveries
    SET
      status = 'delivering',
      attempts = attempts + 1,
      last_error = NULL,
      last_http_status = NULL,
      response_preview = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${deliveryId}
      AND (
        status IN ('pending', 'failed')
        OR (status = 'delivering' AND updated_at <= ${claimStaleBefore})
      )
    RETURNING id, kind, recipient, payload
  `;
  if (!delivery) {
    const current = await prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      select: { status: true },
    });
    if (!current) return { ok: true, skipped: "missing" };
    if (current.status === "delivered") return { ok: true, skipped: "already_delivered" };
    throw new Error(`Notification ${deliveryId} is already leased by another worker`);
  }
  const payload = jsonObject(delivery.payload);
  try {
    switch (delivery.kind) {
      case NOTIFICATION_KINDS.ORDER_CREATED: {
        const orderId = stringValue(payload, "orderId");
        const order = await prisma.order.findUnique({
          where: { id: orderId },
          include: { agent: { select: { name: true, agentId: true, chainId: true } } },
        });
        if (!order) throw new Error(`Order ${orderId} not found for created notification`);
        await requireSuccessfulSend(await sendOrderCreated(delivery.recipient, order), deliveryId);
        break;
      }
      case NOTIFICATION_KINDS.ORDER_CONFIRMED: {
        const orderId = stringValue(payload, "orderId");
        const order = await prisma.order.findUnique({
          where: { id: orderId },
          include: {
            agent: { select: { name: true, agentId: true, chainId: true } },
            adPackage: { select: { durationDays: true, expiresAt: true } },
          },
        });
        if (!order) throw new Error(`Order ${orderId} not found for confirmed notification`);
        if (order.status !== "paid") throw new Error(`Order ${orderId} is ${order.status}, not paid`);
        await requireSuccessfulSend(await sendOrderConfirmed(delivery.recipient, order), deliveryId);
        break;
      }
      case NOTIFICATION_KINDS.ORDER_EXPIRED: {
        const orderId = stringValue(payload, "orderId");
        const order = await prisma.order.findUnique({
          where: { id: orderId },
          include: { agent: { select: { name: true, agentId: true, chainId: true } } },
        });
        if (!order) throw new Error(`Order ${orderId} not found for expired notification`);
        if (order.status !== "expired") {
          await prisma.notificationDelivery.update({ where: { id: deliveryId }, data: { status: "skipped" } });
          return { ok: true, skipped: "order_not_expired" };
        }
        await requireSuccessfulSend(await sendOrderExpired(delivery.recipient, order), deliveryId);
        break;
      }
      case NOTIFICATION_KINDS.BOUNTY_CLAIMED: {
        const bountyId = stringValue(payload, "bountyId");
        const bounty = await prisma.bounty.findUnique({
          where: { id: bountyId },
          include: { claimedAgent: { select: { name: true } } },
        });
        if (!bounty) throw new Error(`Bounty ${bountyId} not found for claimed notification`);
        if (!bounty.claimedAt || !bounty.claimedByAgentId) throw new Error(`Bounty ${bountyId} is not claimed`);
        await requireSuccessfulSend(await sendBountyClaimed(
          delivery.recipient,
          bounty.title,
          bounty.id,
          bounty.claimedAgent?.name ?? "A verified agent",
          bounty.usdcAmount,
          bounty.autoReleaseAt ?? undefined,
        ), deliveryId);
        break;
      }
      case NOTIFICATION_KINDS.PROMO_CONFIRMATION: {
        const expiresAt = new Date(stringValue(payload, "expiresAt"));
        if (!Number.isFinite(expiresAt.getTime())) throw new Error(`Notification ${deliveryId} has invalid expiresAt`);
        await requireSuccessfulSend(await sendOrderCreated(delivery.recipient, {
          orderNumber: stringValue(payload, "orderNumber"),
          productType: "power_boost",
          tier: stringValue(payload, "slotType"),
          usdPrice: 0,
          cryptoAmount: stringValue(payload, "paidAmount"),
          paymentAsset: stringValue(payload, "currency"),
          expiresAt,
        }), deliveryId);
        break;
      }
      case NOTIFICATION_KINDS.AD_ORDER_CONFIRMATION: {
        const expiresAt = new Date(stringValue(payload, "expiresAt"));
        const days = Number(payload.days);
        if (!Number.isFinite(expiresAt.getTime()) || !Number.isInteger(days) || days <= 0) {
          throw new Error(`Notification ${deliveryId} has invalid ad confirmation data`);
        }
        await requireSuccessfulSend(await sendOrderConfirmed(delivery.recipient, {
          orderNumber: stringValue(payload, "orderNumber"),
          productType: "ad",
          tier: stringValue(payload, "tier") || "Custom",
          usdPrice: 0,
          cryptoAmount: stringValue(payload, "paidAmount"),
          paymentAsset: stringValue(payload, "currency"),
          expiresAt,
          paidAt: new Date(),
          bannerUrl: stringValue(payload, "bannerUrl"),
          linkUrl: stringValue(payload, "linkUrl"),
          adText: stringValue(payload, "adText"),
          stripAdvertiserName: stringValue(payload, "stripAdvertiserName"),
          adPackage: { durationDays: days, expiresAt },
        }), deliveryId);
        break;
      }
      case NOTIFICATION_KINDS.KYA_CONFIRMATION: {
        await requireSuccessfulSend(await sendOrderConfirmed(delivery.recipient, {
          orderNumber: stringValue(payload, "orderNumber"),
          productType: "kya_verify",
          tier: "Standard",
          usdPrice: 0,
          cryptoAmount: stringValue(payload, "paidAmount"),
          paymentAsset: stringValue(payload, "currency"),
          expiresAt: new Date(),
        }), deliveryId);
        break;
      }
      case NOTIFICATION_KINDS.DASHBOARD_CLAIM: {
        const profileId = Number(payload.profileId);
        const profile = await prisma.userProfile.findUnique({ where: { id: profileId } });
        if (!profile?.claimToken || !profile.claimTokenExpiresAt || profile.claimTokenExpiresAt <= new Date()) {
          await prisma.notificationDelivery.update({ where: { id: deliveryId }, data: { status: "skipped" } });
          return { ok: true, skipped: "claim_token_unavailable" };
        }
        await requireSuccessfulSend(await sendClaimEmail(delivery.recipient, profile.claimToken), deliveryId);
        break;
      }
      case NOTIFICATION_KINDS.SUBSCRIPTION_EXPIRING: {
        const profileId = Number(payload.profileId);
        const expiryIso = stringValue(payload, "expiryIso");
        const profile = await prisma.userProfile.findUnique({ where: { id: profileId } });
        if (!profile?.subscriptionExpiresAt || profile.subscriptionStatus !== "active") {
          await prisma.notificationDelivery.update({ where: { id: deliveryId }, data: { status: "skipped" } });
          return { ok: true, skipped: "subscription_not_active" };
        }
        if (profile.subscriptionExpiresAt.toISOString() !== expiryIso) {
          await prisma.notificationDelivery.update({ where: { id: deliveryId }, data: { status: "skipped" } });
          return { ok: true, skipped: "expiry_changed" };
        }
        const helioPayLink = process.env.NEXT_PUBLIC_HELIO_PRO_PAYMENT_LINK ?? "https://hel.io";
        await requireSuccessfulSend(await sendSubscriptionReminderEmail(delivery.recipient, profile.subscriptionExpiresAt, helioPayLink), deliveryId);
        break;
      }
      case NOTIFICATION_KINDS.SUBSCRIPTION_LAPSED: {
        const profileId = Number(payload.profileId);
        const expiryIso = stringValue(payload, "expiryIso");
        const profile = await prisma.userProfile.findUnique({ where: { id: profileId } });
        if (!profile?.subscriptionExpiresAt || profile.subscriptionStatus !== "expired") {
          await prisma.notificationDelivery.update({ where: { id: deliveryId }, data: { status: "skipped" } });
          return { ok: true, skipped: "subscription_not_expired" };
        }
        if (profile.subscriptionExpiresAt.toISOString() !== expiryIso) {
          await prisma.notificationDelivery.update({ where: { id: deliveryId }, data: { status: "skipped" } });
          return { ok: true, skipped: "expiry_changed" };
        }
        const helioPayLink = process.env.NEXT_PUBLIC_HELIO_PRO_PAYMENT_LINK ?? "https://hel.io";
        await requireSuccessfulSend(await sendSubscriptionLapsedEmail(delivery.recipient, helioPayLink), deliveryId);
        break;
      }
      case NOTIFICATION_KINDS.SAP_AGENT_INDEXED_WEBHOOK: {
        const result = await deliverSapWebhook(delivery.recipient, payload);
        await prisma.notificationDelivery.update({
          where: { id: deliveryId },
          data: { lastHttpStatus: result.status, responsePreview: result.responsePreview },
        });
        break;
      }
      case NOTIFICATION_KINDS.SAP_AGENT_INDEXED_TELEGRAM: {
        const result = await deliverSapTelegram(delivery.recipient, payload);
        await prisma.notificationDelivery.update({
          where: { id: deliveryId },
          data: { lastHttpStatus: result.status, responsePreview: result.responsePreview },
        });
        break;
      }
      default:
        throw new Error(`Unsupported notification kind: ${delivery.kind}`);
    }
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: "delivered", deliveredAt: new Date(), lastError: null },
    });
    return { ok: true, delivered: true };
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    if (error instanceof TerminalNotificationDeliveryError) {
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          status: "terminal_failed",
          lastError: message.slice(0, 10_000),
          lastHttpStatus: error.httpStatus,
          responsePreview: error.responsePreview,
        },
      });
      return { ok: false, terminal: true, error: message };
    }
    try {
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: "failed", lastError: message.slice(0, 10_000) },
      });
    } catch (stateError) {
      throw new AggregateError(
        [error, stateError],
        "Notification delivery failed and its failure state could not be persisted",
      );
    }
    throw error;
  }
}
