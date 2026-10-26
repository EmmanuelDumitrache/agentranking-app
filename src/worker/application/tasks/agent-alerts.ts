import { createHmac } from "node:crypto";
import { enqueueApplicationJobsInTx } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import { prisma } from "@/lib/db";
import { DOMAIN_DELIVERY_STALE_MS, staleBefore } from "@/jobs/domain-lease";
import { isPermanentOutboundTargetError, requestPublicHttp } from "@/lib/outbound-http";
import { validateWebhookUrl } from "@/lib/webhook-url";
type AgentOwnershipEvidence = {
  owner: string;
  verifiedWallet: string;
  sapOwnerWallet: string | null;
  sapOperatorClaim: { userProfileId: number } | null;
  metadata: Array<{ value: string }>;
  orders: Array<{ wallet: string }>;
};
// A batch of global-rule deliveries for one event asks for identical ownership
// evidence. Coalesce only overlapping reads: retaining completed authorization
// evidence would introduce a stale-permission window.
const ownershipEvidenceLoads = new Map<number, Promise<AgentOwnershipEvidence | null>>();
const ALERT_RULE_PAGE_SIZE = 1_000;
function loadAgentOwnershipEvidence(agentId: number): Promise<AgentOwnershipEvidence | null> {
  const cached = ownershipEvidenceLoads.get(agentId);
  if (cached) return cached;
  const load = prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      owner: true,
      verifiedWallet: true,
      sapOwnerWallet: true,
      sapOperatorClaim: { select: { userProfileId: true } },
      metadata: { where: { key: "agentWallet" }, select: { value: true } },
      orders: {
        where: {
          status: "paid",
          productType: { in: ["kya_verify", "verification_bundle"] },
        },
        select: { wallet: true },
      },
    },
  });
  ownershipEvidenceLoads.set(agentId, load);
  const clear = () => {
    if (ownershipEvidenceLoads.get(agentId) === load) ownershipEvidenceLoads.delete(agentId);
  };
  void load.then(clear, clear);
  return load;
}
function ruleMatchesEvent(eventTypes: readonly string[] | null | undefined, eventType: string): boolean {
  if (!eventTypes || eventTypes.length === 0) return false;
  return (
    eventTypes.includes("*") ||
    eventTypes.includes("agent.event") ||
    eventTypes.includes(eventType)
  );
}
async function globalRuleOwnsAgent(
  agentId: number,
  profile: { id: number; walletAddress: string | null; solanaWallet: string | null },
): Promise<boolean> {
  const evidence = await loadAgentOwnershipEvidence(agentId);
  return evidence != null && profileOwnsAgent(profile, evidence);
}
function profileOwnsAgent(
  profile: { id: number; walletAddress: string | null; solanaWallet: string | null },
  evidence: {
    owner: string;
    verifiedWallet: string;
    sapOwnerWallet: string | null;
    sapOperatorClaim: { userProfileId: number } | null;
    metadata: Array<{ value: string }>;
    orders: Array<{ wallet: string }>;
  },
): boolean {
  if (evidence.sapOperatorClaim?.userProfileId === profile.id) return true;
  const evmWallet = profile.walletAddress?.trim() ?? "";
  if (evmWallet) {
    const caseInsensitive = /^0x[0-9a-fA-F]{40}$/.test(evmWallet);
    const matches = (candidate: string | null | undefined) =>
      caseInsensitive
        ? candidate?.toLowerCase() === evmWallet.toLowerCase()
        : candidate === evmWallet;
    if (
      matches(evidence.owner) ||
      (evidence.verifiedWallet !== "" && matches(evidence.verifiedWallet)) ||
      evidence.metadata.some((row) => matches(row.value)) ||
      evidence.orders.some((row) => matches(row.wallet))
    ) return true;
  }
  const solanaWallet = profile.solanaWallet?.trim() ?? "";
  return solanaWallet !== "" && (
    evidence.sapOwnerWallet === solanaWallet ||
    evidence.owner === solanaWallet ||
    evidence.orders.some((row) => row.wallet === solanaWallet)
  );
}

async function ownedGlobalRuleProfileIds(
  evidence: AgentOwnershipEvidence,
): Promise<number[]> {
  const walletCandidates = [...new Set([
    evidence.owner,
    evidence.verifiedWallet,
    ...evidence.metadata.map((row) => row.value),
    ...evidence.orders.map((row) => row.wallet),
  ].map((value) => value.trim()).filter(Boolean))];
  const evmWalletCandidates = walletCandidates.filter((value) =>
    /^0x[0-9a-fA-F]{40}$/.test(value),
  );
  const solanaWalletCandidates = [...new Set([
    evidence.sapOwnerWallet ?? "",
    evidence.owner,
    ...evidence.orders.map((row) => row.wallet),
  ].map((value) => value.trim()).filter(Boolean))];
  if (
    evidence.sapOperatorClaim == null &&
    walletCandidates.length === 0 &&
    solanaWalletCandidates.length === 0
  ) return [];
  const profiles = await prisma.userProfile.findMany({
    where: {
      OR: [
        ...(evidence.sapOperatorClaim
          ? [{ id: evidence.sapOperatorClaim.userProfileId }]
          : []),
        ...evmWalletCandidates.map((wallet) => ({
          walletAddress: { equals: wallet, mode: "insensitive" as const },
        })),
        ...(walletCandidates.length > 0
          ? [{ walletAddress: { in: walletCandidates } }]
          : []),
        ...(solanaWalletCandidates.length > 0
          ? [{ solanaWallet: { in: solanaWalletCandidates } }]
          : []),
      ],
    },
    select: { id: true },
  });
  return profiles.map((profile) => profile.id);
}

export async function evaluateAgentAlertEvent(eventId: string) {
  const event = await prisma.agentAlertEvent.findUnique({
    where: { id: eventId },
    select: { id: true, agentId: true, eventType: true },
  });
  if (!event) return { ok: true, skipped: "event_missing" };
  if (event.agentId == null) return { ok: true, skipped: "event_has_no_agent" };
  const agentId = event.agentId;
  let candidateCount = 0;
  let matchingRules = 0;
  let deliveriesCreated = 0;
  const scanRules = async (scope: {
    agentId: number | null;
    userProfileId?: { in: number[] };
  }): Promise<void> => {
    let lastRuleId = 0;
    for (;;) {
      const candidates = await prisma.agentAlertRule.findMany({
        where: {
          ...scope,
          id: { gt: lastRuleId },
          isActive: true,
          // Native text[] predicate — only rules subscribed to this event class
          // (or the generic wildcards) are hydrated from the database.
          eventTypes: { hasSome: [event.eventType, "agent.event", "*"] },
        },
        select: { id: true, eventTypes: true },
        orderBy: { id: "asc" },
        take: ALERT_RULE_PAGE_SIZE,
      });
      if (candidates.length === 0) break;
      candidateCount += candidates.length;
      lastRuleId = candidates[candidates.length - 1]!.id;
      const eligible = candidates.filter((rule) =>
        ruleMatchesEvent(rule.eventTypes, event.eventType),
      );
      matchingRules += eligible.length;
      if (eligible.length > 0) {
        deliveriesCreated += await prisma.$transaction(async (tx) => {
          const deliveries = await tx.agentAlertDelivery.createManyAndReturn({
            data: eligible.map((rule) => ({ eventId: event.id, ruleId: rule.id })),
            skipDuplicates: true,
            select: { id: true },
          });
          await enqueueApplicationJobsInTx(
            tx,
            JOB_QUEUES.ALERT_WEBHOOK_DELIVER,
            deliveries.map((delivery) => ({
              data: { v: 1 as const, id: delivery.id },
              singletonKey: delivery.id,
            })),
            { returnIds: false },
          );
          return deliveries.length;
        }, { maxWait: 10_000, timeout: 30_000 });
      }
      if (candidates.length < ALERT_RULE_PAGE_SIZE) break;
    }
  };

  // Agent-specific and global rules have different selective indexes. Keeping
  // them as separate scans avoids an OR bitmap over every active global rule,
  // and global candidates are restricted to profiles that can own this agent
  // before any rule JSON is hydrated.
  await scanRules({ agentId });
  const globalRuleExists = await prisma.agentAlertRule.findFirst({
    where: { agentId: null, isActive: true },
    select: { id: true },
  });
  if (globalRuleExists) {
    const ownershipEvidence = await loadAgentOwnershipEvidence(agentId);
    const ownedGlobalProfileIds = ownershipEvidence == null
      ? []
      : await ownedGlobalRuleProfileIds(ownershipEvidence);
    if (ownedGlobalProfileIds.length > 0) {
      await scanRules({
        agentId: null,
        userProfileId: { in: ownedGlobalProfileIds },
      });
    }
  }
  return {
    ok: true,
    candidates: candidateCount,
    matchingRules,
    deliveriesCreated,
  };
}
function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
function webhookBody(input: {
  deliveryId: string;
  event: { id: string; agentId: number | null; eventType: string; payload: unknown; occurredAt: Date };
  ruleId: number;
}): string {
  return JSON.stringify({
    source: "agentranking.io",
    type: input.event.eventType === "agentranking.alert.test"
      ? "agentranking.alert.test"
      : "agentranking.agent.event",
    deliveryId: input.deliveryId,
    eventId: input.event.id,
    ruleId: input.ruleId,
    agentId: input.event.agentId,
    eventType: input.event.eventType,
    occurredAt: input.event.occurredAt.toISOString(),
    deliveredAt: new Date().toISOString(),
    data: input.event.payload,
  });
}
export async function deliverAgentAlertWebhook(deliveryId: string) {
  const claimStaleBefore = staleBefore(DOMAIN_DELIVERY_STALE_MS);
  type ClaimedAlertDelivery = {
    id: string;
    eventId: string;
    eventAgentId: number | null;
    eventType: string;
    eventPayload: unknown;
    occurredAt: Date;
    ruleId: number;
    ruleAgentId: number | null;
    webhookUrl: string;
    secret: string | null;
    eventTypes: string[];
    ruleActive: boolean;
    userProfileId: number;
    walletAddress: string | null;
    solanaWallet: string | null;
  };
  const [claimed] = await prisma.$queryRaw<ClaimedAlertDelivery[]>`
    WITH claimed AS (
      UPDATE agent_alert_deliveries
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
      RETURNING id, event_id, rule_id
    )
    SELECT
      claimed.id,
      event.id AS "eventId",
      event.agent_id AS "eventAgentId",
      event.event_type AS "eventType",
      event.payload AS "eventPayload",
      event.occurred_at AS "occurredAt",
      rule.id AS "ruleId",
      rule."agentId" AS "ruleAgentId",
      rule."webhookUrl" AS "webhookUrl",
      rule.secret,
      rule."eventTypes" AS "eventTypes",
      rule."isActive" AS "ruleActive",
      profile.id AS "userProfileId",
      profile."walletAddress" AS "walletAddress",
      profile.solana_wallet AS "solanaWallet"
    FROM claimed
    INNER JOIN agent_alert_events AS event ON event.id = claimed.event_id
    INNER JOIN "AgentAlertRule" AS rule ON rule.id = claimed.rule_id
    INNER JOIN "UserProfile" AS profile ON profile.id = rule."userProfileId"
  `;
  if (!claimed) {
    const current = await prisma.agentAlertDelivery.findUnique({
      where: { id: deliveryId },
      select: { status: true },
    });
    if (!current) return { ok: true, skipped: "delivery_missing" };
    if (current.status === "delivered" || current.status === "skipped") {
      return { ok: true, skipped: current.status };
    }
    throw new Error(`Alert delivery ${deliveryId} is already leased by another worker`);
  }
  const delivery = {
    id: claimed.id,
    event: {
      id: claimed.eventId,
      agentId: claimed.eventAgentId,
      eventType: claimed.eventType,
      payload: claimed.eventPayload,
      occurredAt: claimed.occurredAt,
    },
    rule: {
      id: claimed.ruleId,
      agentId: claimed.ruleAgentId,
      webhookUrl: claimed.webhookUrl,
      secret: claimed.secret,
      eventTypes: claimed.eventTypes,
      isActive: claimed.ruleActive,
      userProfile: {
        id: claimed.userProfileId,
        walletAddress: claimed.walletAddress,
        solanaWallet: claimed.solanaWallet,
      },
    },
  };
  const isTest = delivery.event.eventType === "agentranking.alert.test";
  if (!isTest && !delivery.rule.isActive) {
    await prisma.agentAlertDelivery.update({ where: { id: delivery.id }, data: { status: "skipped", attempts: { decrement: 1 }, lastError: "rule_inactive" } });
    return { ok: true, skipped: "rule_inactive" };
  }
  if (!isTest && !ruleMatchesEvent(delivery.rule.eventTypes, delivery.event.eventType)) {
    await prisma.agentAlertDelivery.update({ where: { id: delivery.id }, data: { status: "skipped", attempts: { decrement: 1 }, lastError: "event_type_no_longer_matches" } });
    return { ok: true, skipped: "event_type_no_longer_matches" };
  }
  if (delivery.event.agentId != null) {
    if (delivery.rule.agentId != null && delivery.rule.agentId !== delivery.event.agentId) {
      await prisma.agentAlertDelivery.update({ where: { id: delivery.id }, data: { status: "skipped", attempts: { decrement: 1 }, lastError: "rule_agent_changed" } });
      return { ok: true, skipped: "rule_agent_changed" };
    }
    if (delivery.rule.agentId == null) {
      const ownsAgent = await globalRuleOwnsAgent(delivery.event.agentId, delivery.rule.userProfile);
      if (!ownsAgent) {
        await prisma.agentAlertDelivery.update({ where: { id: delivery.id }, data: { status: "skipped", attempts: { decrement: 1 }, lastError: "agent_no_longer_owned" } });
        return { ok: true, skipped: "agent_no_longer_owned" };
      }
    }
  }
  if (!validateWebhookUrl(delivery.rule.webhookUrl).ok) {
    const message = "Stored alert webhook URL is no longer allowed";
    await prisma.agentAlertDelivery.update({
      where: { id: delivery.id },
      data: { status: "terminal_failed", lastError: message, lastHttpStatus: null },
    });
    return { ok: false, delivered: false, retryable: false, reason: "invalid_webhook_url" };
  }
  const body = webhookBody({ deliveryId: delivery.id, event: delivery.event, ruleId: delivery.rule.id });
  const timestamp = String(Date.now());
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "AgentRanking-BotAlerts/2.0",
    "X-AgentRanking-Timestamp": timestamp,
    "X-AgentRanking-Delivery-Id": delivery.id,
  };
  const secret = delivery.rule.secret?.trim();
  if (secret) {
    headers["X-AgentRanking-Signature"] = createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
  }
  try {
    const response = await requestPublicHttp(delivery.rule.webhookUrl, {
      method: "POST",
      headers,
      body,
      timeoutMs: 12_000,
      maxResponseBytes: 2_000,
      maxRedirects: 0,
    });
    const responsePreview = response.body;
    if (response.status >= 200 && response.status < 300) {
      await prisma.agentAlertDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "delivered",
          deliveredAt: new Date(),
          lastHttpStatus: response.status,
          responsePreview,
          lastError: null,
        },
      });
      return { ok: true, delivered: true, status: response.status };
    }
    const message = `Alert webhook returned HTTP ${response.status}`.slice(0, 10_000);
    const retryable = shouldRetryStatus(response.status);
    await prisma.agentAlertDelivery.update({
      where: { id: delivery.id },
      data: {
        status: retryable ? "failed" : "terminal_failed",
        lastHttpStatus: response.status,
        responsePreview,
        lastError: message,
      },
    });
    if (retryable) throw new Error(message);
    return { ok: false, delivered: false, status: response.status, retryable: false };
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    if (isPermanentOutboundTargetError(error)) {
      await prisma.agentAlertDelivery.update({
        where: { id: delivery.id },
        data: { status: "terminal_failed", lastError: message.slice(0, 10_000) },
      });
      return { ok: false, delivered: false, retryable: false, reason: "target_rejected" };
    }
    try {
      await prisma.agentAlertDelivery.update({
        where: { id: delivery.id },
        data: { status: "failed", lastError: message.slice(0, 10_000) },
      });
    } catch (stateError) {
      throw new AggregateError(
        [error, stateError],
        "Agent alert delivery failed and its failure state could not be persisted",
      );
    }
    throw error;
  }
}
