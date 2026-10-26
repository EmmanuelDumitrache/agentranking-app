import { getJobProducer } from "@/jobs/boss";
import { enqueueApplicationJobsInTx } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import { prisma } from "@/lib/db";
import { getPublicSiteUrl } from "@/lib/site-url";
import {
  NOTIFICATION_KINDS,
} from "@/lib/notification-delivery";
import { agentPublicUrl } from "@/lib/agent-public-url";
export type SapNewAgentNotifyPayload = {
  agentDbId: number;
  agentId: number;
  name: string;
  sapAgentPda: string;
  capabilityKeys: string[];
};
type SapNewAgentNotification = SapNewAgentNotifyPayload & { chainId: number };
const SAP_NOTIFICATION_BATCH_SIZE = 500;
function profileUrl(agentId: number, chainId: number, name: string): string {
  return agentPublicUrl(getPublicSiteUrl(), { chainId, agentId, name });
}
function buildNotificationPayload(item: SapNewAgentNotification) {
  const capabilities = item.capabilityKeys.slice(0, 8);
  const url = profileUrl(item.agentId, item.chainId, item.name);
  return {
    agentDbId: item.agentDbId,
    agentId: item.agentId,
    chainId: item.chainId,
    name: item.name,
    sapAgentPda: item.sapAgentPda,
    capabilityKeys: capabilities,
    profileUrl: url,
    message: [
      "🤖 New SAP agent indexed on AgentRanking",
      `Name: ${item.name}`,
      `Capabilities: ${capabilities.length ? capabilities.join(", ") : "—"}`,
      `Profile: ${url}`,
    ].join("\n"),
  };
}
/** Queue durable webhook/Telegram notifications for newly indexed SAP agents. */
export async function queueSapNewAgentNotifications(
  items: readonly SapNewAgentNotification[],
): Promise<{ webhook: number; telegram: number }> {
  if (items.length === 0) return { webhook: 0, telegram: 0 };
  const webhookUrl = process.env.WEBHOOK_URL?.trim() ?? "";
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const telegramChatId = process.env.TELEGRAM_CHAT_ID?.trim() ?? "";
  if (!webhookUrl && !(telegramToken && telegramChatId)) {
    return { webhook: 0, telegram: 0 };
  }
  await getJobProducer();
  let webhook = 0;
  let telegram = 0;
  for (let offset = 0; offset < items.length; offset += SAP_NOTIFICATION_BATCH_SIZE) {
    const batch = items.slice(offset, offset + SAP_NOTIFICATION_BATCH_SIZE);
    const deliveries = batch.flatMap((item) => {
      const payload = buildNotificationPayload(item);
      return [
        ...(webhookUrl ? [{
          idempotencyKey: `sap-agent:${item.agentDbId}:webhook`,
          channel: "webhook",
          kind: NOTIFICATION_KINDS.SAP_AGENT_INDEXED_WEBHOOK,
          recipient: webhookUrl,
          payload,
        }] : []),
        ...(telegramToken && telegramChatId ? [{
          idempotencyKey: `sap-agent:${item.agentDbId}:telegram`,
          channel: "telegram",
          kind: NOTIFICATION_KINDS.SAP_AGENT_INDEXED_TELEGRAM,
          recipient: telegramChatId,
          payload,
        }] : []),
      ];
    });
    if (deliveries.length === 0) continue;
    await prisma.$transaction(async (tx) => {
      await tx.notificationDelivery.createMany({
        data: deliveries,
        skipDuplicates: true,
      });
      const persisted = await tx.notificationDelivery.findMany({
        where: { idempotencyKey: { in: deliveries.map((delivery) => delivery.idempotencyKey) } },
        select: { id: true },
      });
      await enqueueApplicationJobsInTx(
        tx,
        JOB_QUEUES.NOTIFICATION_DELIVER,
        persisted.map((delivery) => ({
          data: { v: 1 as const, id: delivery.id },
          singletonKey: delivery.id,
        })),
        { returnIds: false },
      );
    }, { maxWait: 10_000, timeout: 30_000 });
    if (webhookUrl) webhook += batch.length;
    if (telegramToken && telegramChatId) telegram += batch.length;
  }
  return { webhook, telegram };
}
